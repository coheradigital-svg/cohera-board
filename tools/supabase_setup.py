# -*- coding: utf-8 -*-
"""One-shot setup of the Supabase project through the Management API.

Needs SUPABASE_ACCESS_TOKEN in the COHERA DIGITAL .env (a personal access token from
supabase.com/dashboard/account/tokens). Then:
  1. runs supabase/schema.sql
  2. inserts the team emails into allowed_emails
  3. reads the project's API keys and writes
       SUPABASE_URL + SUPABASE_SERVICE_KEY  -> .env  (private, for tools/board.py)
       url + anonKey                        -> config.js (public, for the page)
Secrets never print to the console; only lengths and prefixes.

    python tools/supabase_setup.py
"""
import io, json, os, sys, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = r"C:\Claude Code projects\COHERA DIGITAL\.env"
PROJECT_REF = "kndbflswmtlwojxrbbey"
TEAM = [("yani.goranov@coheradigital.com", "Яни"),
        ("kancho.bonev@coheradigital.com", "Кънчо"),
        ("evelin.treneva@coheradigital.com", "Еви")]


def read_env():
    d = {}
    if os.path.exists(ENV):
        for line in io.open(ENV, encoding="utf-8"):
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1); d[k.strip()] = v.strip()
    return d


def write_env(updates):
    lines = io.open(ENV, encoding="utf-8").read().splitlines() if os.path.exists(ENV) else []
    seen = set()
    out = []
    for line in lines:
        k = line.split("=", 1)[0].strip() if "=" in line else None
        if k in updates:
            out.append("%s=%s" % (k, updates[k])); seen.add(k)
        else:
            out.append(line)
    for k, v in updates.items():
        if k not in seen:
            out.append("%s=%s" % (k, v))
    io.open(ENV, "w", encoding="utf-8", newline="\n").write("\n".join(out) + "\n")


def api(method, path, token, body=None):
    req = urllib.request.Request("https://api.supabase.com" + path, method=method,
                                 data=json.dumps(body).encode("utf-8") if body is not None else None)
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            raw = r.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        sys.exit("Supabase API %s on %s %s: %s" % (e.code, method, path, e.read().decode("utf-8", "replace")[:600]))


def run_sql(token, sql):
    return api("POST", "/v1/projects/%s/database/query" % PROJECT_REF, token, {"query": sql})


def main():
    env = read_env()
    token = env.get("SUPABASE_ACCESS_TOKEN")
    if not token:
        sys.exit("SUPABASE_ACCESS_TOKEN липсва в .env")
    print("token: ok (%d chars, %s...)" % (len(token), token[:4]))

    schema = io.open(os.path.join(ROOT, "supabase", "schema.sql"), encoding="utf-8").read()
    run_sql(token, schema)
    print("1. schema: ok")

    values = ", ".join("('%s', '%s')" % (e, p) for e, p in TEAM)
    run_sql(token, "insert into public.allowed_emails (email, person) values %s on conflict (email) do update set person = excluded.person;" % values)
    rows = run_sql(token, "select email, person from public.allowed_emails order by email;")
    print("2. allowed emails:", ", ".join(r["email"] for r in rows))

    keys = api("GET", "/v1/projects/%s/api-keys?reveal=true" % PROJECT_REF, token)
    anon = next((k["api_key"] for k in keys if k.get("name") == "anon"), None)
    service = next((k["api_key"] for k in keys if k.get("name") == "service_role"), None)
    if not anon or not service:
        sys.exit("ключовете не се намират в отговора: %s" % [k.get("name") for k in keys])
    url = "https://%s.supabase.co" % PROJECT_REF
    write_env({"SUPABASE_URL": url, "SUPABASE_SERVICE_KEY": service})
    cfg = os.path.join(ROOT, "config.js")
    io.open(cfg, "w", encoding="utf-8", newline="\n").write(
        "/* Public settings for the hosted board. The anon key is meant to be public: rows are protected by\n"
        "   sign-in and row-level security in Supabase, not by hiding this file. */\n"
        "window.BOARD_CONFIG = {\n  url: %s,\n  anonKey: %s\n};\n" % (json.dumps(url), json.dumps(anon)))
    print("3. keys: url + service -> .env, anon -> config.js (anon %d chars, service %d chars)" % (len(anon), len(service)))

    tables = run_sql(token, "select table_name from information_schema.tables where table_schema='public' order by 1;")
    print("tables:", ", ".join(t["table_name"] for t in tables))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
