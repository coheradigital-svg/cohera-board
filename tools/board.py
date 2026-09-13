# -*- coding: utf-8 -*-
"""Claude's door into the board. Reads and writes rows in Supabase with the service key.

    python tools/board.py list tasks
    python tools/board.py get tasks t-fees
    python tools/board.py set tasks t-x '{"title":"...","assignee":"Кънчо","due":"2026-09-20","status":"todo"}'
    python tools/board.py update tasks t-x '{"status":"done"}'
    python tools/board.py delete tasks t-x
    python tools/board.py intake "Invoice from Bioshop for August" bioshop
    python tools/board.py task "Check Romania value" --client bioshop --who Кънчо --due 2026-09-17 --size 60 --pri 1

Keys come from the .env in the COHERA DIGITAL repo:
    SUPABASE_URL=https://xxxx.supabase.co
    SUPABASE_SERVICE_KEY=...   (service role, never put it in the page)
Every document written here carries source: "claude".
"""
import io, json, os, sys, time, urllib.error, urllib.parse, urllib.request, uuid, datetime

ENV = r"C:\Claude Code projects\COHERA DIGITAL\.env"


def env(key):
    for line in io.open(ENV, encoding="utf-8"):
        if line.startswith(key + "="):
            return line.split("=", 1)[1].strip()
    sys.exit("%s липсва в %s" % (key, ENV))


URL = env("SUPABASE_URL").rstrip("/")
KEY = env("SUPABASE_SERVICE_KEY")


def call(method, table, params=None, body=None, prefer=None):
    q = ("?" + urllib.parse.urlencode(params)) if params else ""
    req = urllib.request.Request(URL + "/rest/v1/" + table + q, method=method,
                                 data=json.dumps(body).encode("utf-8") if body is not None else None)
    req.add_header("apikey", KEY)
    req.add_header("Authorization", "Bearer " + KEY)
    req.add_header("Content-Type", "application/json")
    if prefer:
        req.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        sys.exit("Supabase %s on %s %s: %s" % (e.code, method, table, e.read().decode("utf-8", "replace")[:400]))


def now():
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")


def get(table, doc_id):
    rows = call("GET", table, {"id": "eq." + doc_id, "select": "id,data"})
    return rows[0]["data"] if rows else None


def set_doc(table, doc_id, data):
    data = dict(data)
    data.setdefault("id", doc_id)
    data.setdefault("source", "claude")
    call("POST", table, body={"id": doc_id, "data": data}, prefer="resolution=merge-duplicates,return=minimal")
    return data


def update_doc(table, doc_id, patch):
    cur = get(table, doc_id) or {}
    cur.update(patch)
    cur["updatedAt"] = now()
    return set_doc(table, doc_id, cur)


def delete_doc(table, doc_id):
    call("DELETE", table, {"id": "eq." + doc_id}, prefer="return=minimal")


def list_docs(table, limit=200):
    rows = call("GET", table, {"select": "id,data", "order": "updated_at.desc", "limit": str(limit)})
    return [r["data"] for r in rows]


def new_id():
    return uuid.uuid4().hex[:10]


def main(argv):
    if not argv:
        print(__doc__); return
    cmd = argv[0]
    if cmd == "list":
        for d in list_docs(argv[1]):
            print(json.dumps(d, ensure_ascii=False))
    elif cmd == "get":
        print(json.dumps(get(argv[1], argv[2]), ensure_ascii=False, indent=1))
    elif cmd == "set":
        print(json.dumps(set_doc(argv[1], argv[2], json.loads(argv[3])), ensure_ascii=False))
    elif cmd == "update":
        print(json.dumps(update_doc(argv[1], argv[2], json.loads(argv[3])), ensure_ascii=False))
    elif cmd == "delete":
        delete_doc(argv[1], argv[2]); print("deleted")
    elif cmd == "intake":
        d = {"title": argv[1], "client": argv[2] if len(argv) > 2 else "", "arrivedAt": now(), "dispositionedAt": None, "to": "", "source": "claude"}
        print(json.dumps(set_doc("intake", new_id(), d), ensure_ascii=False))
    elif cmd == "task":
        opts = {"client": "", "who": "", "due": None, "size": None, "pri": 0, "first": ""}
        title = argv[1]; i = 2
        while i < len(argv):
            k = argv[i].lstrip("-"); v = argv[i + 1] if i + 1 < len(argv) else ""
            if k in opts: opts[k] = v
            i += 2
        d = {"title": title, "firstStep": opts["first"], "client": opts["client"], "assignee": opts["who"], "due": opts["due"],
             "size": int(opts["size"]) if opts["size"] else None, "priority": int(opts["pri"] or 0), "status": "todo",
             "createdAt": now(), "createdBy": "claude", "source": "claude"}
        print(json.dumps(set_doc("tasks", new_id(), d), ensure_ascii=False))
    else:
        print(__doc__)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main(sys.argv[1:])
