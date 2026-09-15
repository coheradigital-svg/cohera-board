# -*- coding: utf-8 -*-
"""Качва функцията, която Телеграм звъни, и я вписва при Телеграм.

Досега ботът питаше Телеграм веднъж на час от GitHub Actions. Копчетата
въртяха и се отказваха, защото Телеграм чака отговор за секунди. Оттук нататък
той звъни на Supabase в мига, в който някой пише или натиска.

    python tools/deploy_webhook.py          # качва функцията и я вписва
    python tools/deploy_webhook.py --status # показва какво знае Телеграм

Ключовете идват от .env в COHERA DIGITAL.
"""
import io, json, os, sys, uuid, urllib.error, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = r"C:\Claude Code projects\COHERA DIGITAL\.env"
REF = "kndbflswmtlwojxrbbey"
NAME = "telegram"


def env(key, need=True):
    if os.environ.get(key):
        return os.environ[key].strip()
    if os.path.exists(ENV):
        for line in io.open(ENV, encoding="utf-8"):
            if line.startswith(key + "="):
                return line.split("=", 1)[1].strip()
    if need:
        sys.exit("%s липсва в .env" % key)
    return None


def api(method, path, token, body=None, ctype="application/json", raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request("https://api.supabase.com" + path, method=method, data=data)
    req.add_header("Authorization", "Bearer " + token)
    if data is not None:
        req.add_header("Content-Type", ctype)
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            t = r.read().decode("utf-8")
            return json.loads(t) if t.strip().startswith(("{", "[")) else t
    except urllib.error.HTTPError as e:
        sys.exit("Supabase %s на %s %s: %s" % (e.code, method, path, e.read().decode("utf-8", "replace")[:600]))


def tg(method, token, **params):
    data = urllib.parse.urlencode(params).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(
                "https://api.telegram.org/bot%s/%s" % (token, method), data=data), timeout=40) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return json.loads(e.read().decode("utf-8", "replace"))


def deploy(acc, src):
    """Качва функцията през multipart, както го иска Management API."""
    b = "----cohera" + uuid.uuid4().hex
    meta = {"name": NAME, "entrypoint_path": "index.ts", "verify_jwt": False}
    parts = []
    parts.append('--%s\r\nContent-Disposition: form-data; name="metadata"\r\n'
                 'Content-Type: application/json\r\n\r\n%s\r\n' % (b, json.dumps(meta)))
    parts.append('--%s\r\nContent-Disposition: form-data; name="file"; filename="index.ts"\r\n'
                 'Content-Type: application/typescript\r\n\r\n%s\r\n' % (b, src))
    parts.append("--%s--\r\n" % b)
    body = "".join(parts).encode("utf-8")
    return api("POST", "/v1/projects/%s/functions/deploy?slug=%s" % (REF, NAME), acc,
               ctype="multipart/form-data; boundary=" + b, raw=body)


def main(argv):
    bot = env("BOARD_BOT_TOKEN")
    if "--status" in argv:
        print(json.dumps(tg("getWebhookInfo", bot), ensure_ascii=False, indent=1))
        return

    acc = env("SUPABASE_ACCESS_TOKEN")
    secret = env("TELEGRAM_WEBHOOK_SECRET", need=False) or uuid.uuid4().hex
    src = io.open(os.path.join(ROOT, "supabase", "functions", NAME, "index.ts"), encoding="utf-8").read()

    print("1. качвам функцията...")
    d = deploy(acc, src)
    print("   готово:", (d or {}).get("status", "ok") if isinstance(d, dict) else "ok")

    print("2. слагам тайните на функцията...")
    api("POST", "/v1/projects/%s/secrets" % REF, acc, [
        {"name": "BOARD_BOT_TOKEN", "value": bot},
        {"name": "TELEGRAM_WEBHOOK_SECRET", "value": secret},
    ])
    print("   готово")

    url = "https://%s.supabase.co/functions/v1/%s" % (REF, NAME)
    print("3. казвам на Телеграм да звъни на", url)
    r = tg("setWebhook", bot, url=url, secret_token=secret,
           allowed_updates=json.dumps(["message", "callback_query"]),
           drop_pending_updates="false")
    print("   Телеграм:", r.get("description") or r)

    if not env("TELEGRAM_WEBHOOK_SECRET", need=False):
        print()
        print("Запиши това в .env, за да може функцията да се пре-качва после:")
        print("TELEGRAM_WEBHOOK_SECRET=" + secret)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main(sys.argv[1:])
