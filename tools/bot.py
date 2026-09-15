# -*- coding: utf-8 -*-
"""Личен телеграм бот към борда. Един бот, три лични чата.

Идеята е проста: бордът стои в браузъра, но човекът е с телефона. Ботът носи
деня до него сутрин, прибира каквото му хрумне през деня, и вечер пита какво
е станало. Нищо не се измисля, всичко идва от същите редове в Supabase.

    python tools/bot.py --sutrin     # сутрешното бутане, по един лист на човек
    python tools/bot.py --vecher     # вечерната докладна
    python tools/bot.py --chetene    # прибира отговорите и новите неща от чата
    python tools/bot.py --kuki       # показва кой е свързан

Свързване: човекът пише /start на бота и избира името си. Оттам нататък
чатът му е вързан и не го пита повече.

Токенът е BOARD_BOT_TOKEN в .env. Ако го няма, пада на TELEGRAM_BOT_TOKEN,
тоест ползва същия бот като парите на Биошоп.
"""
import io, json, os, sys, datetime, urllib.error, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = r"C:\Claude Code projects\COHERA DIGITAL\.env"
HORA = ["Яни", "Кънчо", "Еви"]
M3 = ["яну", "фев", "мар", "апр", "май", "юни", "юли", "авг", "сеп", "окт", "ное", "дек"]


def env(key, default=None):
    """Средата бие .env, за да върви и в GitHub Actions."""
    if os.environ.get(key):
        return os.environ[key].strip()
    if os.path.exists(ENV):
        for line in io.open(ENV, encoding="utf-8"):
            if line.startswith(key + "="):
                return line.split("=", 1)[1].strip()
    if default is not None:
        return default
    sys.exit("%s липсва и в средата, и в .env" % key)


URL = env("SUPABASE_URL").rstrip("/")
KEY = env("SUPABASE_SERVICE_KEY")
TOKEN = env("BOARD_BOT_TOKEN", env("TELEGRAM_BOT_TOKEN"))
API = "https://api.telegram.org/bot%s/" % TOKEN


# ---------- Supabase ----------

def db(method, table, params=None, body=None, prefer=None):
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
        sys.exit("Supabase %s на %s %s: %s" % (e.code, method, table, e.read().decode("utf-8", "replace")[:400]))


def rows(table):
    return [dict(r["data"], id=r["id"]) for r in (db("GET", table, {"select": "id,data"}) or [])]


def put(table, doc):
    d = dict(doc)
    rid = d.pop("id")
    db("POST", table, {}, [{"id": rid, "data": d}], "resolution=merge-duplicates")


def meta(key, default=None):
    r = db("GET", "meta", {"select": "data", "id": "eq." + key})
    return (r[0]["data"] if r else None) or default


def set_meta(key, value):
    db("POST", "meta", {}, [{"id": key, "data": value}], "resolution=merge-duplicates")


# ---------- Телеграм ----------

def tg(method, **params):
    data = urllib.parse.urlencode({k: (json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v)
                                   for k, v in params.items() if v is not None}).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(API + method, data=data), timeout=40) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        print("телеграм %s: %s" % (e.code, e.read().decode("utf-8", "replace")[:250]))
        return {"ok": False}


def send(chat, text, buttons=None):
    kb = {"inline_keyboard": buttons} if buttons else None
    return tg("sendMessage", chat_id=chat, text=text, parse_mode="HTML",
              disable_web_page_preview="true", reply_markup=kb)


# ---------- ден ----------

def today():
    return datetime.date.today().isoformat()


def human(iso):
    if not iso:
        return ""
    d = datetime.date.fromisoformat(iso)
    n = (d - datetime.date.today()).days
    if n == 0:
        return "днес"
    if n == 1:
        return "утре"
    if n == -1:
        return "вчера"
    if n < 0:
        return "просрочена с %d дни" % -n
    return "%d %s" % (d.day, M3[d.month - 1])


def load():
    """Всичко, което трябва за един ден, с едно дърпане на таблиците."""
    tasks = [t for t in rows("tasks") if not t.get("deleted")]
    picks = rows("picks")
    day = today()
    picked = set()
    for p in picks:
        if p.get("day") == day:
            picked.update(p.get("ids") or [])
    return tasks, picked


def moi(tasks, who):
    return [t for t in tasks if (t.get("assignee") or "") == who and not t.get("someday")]


def den_na(tasks, picked, who):
    mine = moi(tasks, who)
    otvoreni = [t for t in mine if t.get("status") != "done"]
    dnes = [t for t in otvoreni if t["id"] in picked]
    prosro = [t for t in otvoreni if t.get("due") and t["due"] < today()]
    chaka = [t for t in otvoreni if (t.get("waitingOn") or "").strip()]
    return dnes, prosro, chaka, otvoreni


def red(t):
    """Един ред за задача: заглавие, а отдолу първата стъпка, ако я има."""
    s = "<b>%s</b>" % t.get("title", "")
    if t.get("client"):
        s += "  <i>%s</i>" % t["client"]
    first = (t.get("firstStep") or "").strip()
    if first:
        s += "\n   ↳ %s" % first
    return s


def kopcheta(t):
    return [[{"text": "Готова", "callback_data": "done:" + t["id"]},
             {"text": "За утре", "callback_data": "utre:" + t["id"]}]]


# ---------- сутрин ----------

def sutrin():
    chats = meta("bot-chats", {})
    if not chats:
        print("никой не е свързан, кажи им да пишат /start на бота"); return
    tasks, picked = load()
    for who, chat in chats.items():
        dnes, prosro, chaka, otvoreni = den_na(tasks, picked, who)
        b = ["Добро утро, %s." % who, ""]
        if dnes:
            b.append("<b>За днес си взел %d:</b>" % len(dnes))
        elif otvoreni:
            b.append("<b>Днес нямаш избрани неща.</b> Отвори борда и вземи три.")
        else:
            b.append("<b>Нямаш нищо отворено.</b> Спокоен ден.")
        send(chat, "\n".join(b))
        for t in dnes:
            send(chat, red(t), kopcheta(t))
        opashka = []
        if prosro:
            opashka.append("Просрочени: <b>%d</b>" % len(prosro))
            for t in prosro[:3]:
                opashka.append("· %s (%s)" % (t.get("title", ""), human(t.get("due"))))
        if chaka:
            opashka.append("")
            opashka.append("Чакаш: <b>%d</b>" % len(chaka))
            for t in chaka[:3]:
                opashka.append("· %s ← %s" % (t.get("title", ""), t.get("waitingOn")))
        if opashka:
            send(chat, "\n".join(opashka))
        print("пратено на", who)


# ---------- вечер ----------

def vecher():
    chats = meta("bot-chats", {})
    tasks, picked = load()
    day = today()
    for who, chat in chats.items():
        mine = moi(tasks, who)
        gotovi = [t for t in mine if t.get("status") == "done" and (t.get("doneAt") or "")[:10] == day]
        dnes, prosro, chaka, otvoreni = den_na(tasks, picked, who)
        b = []
        if gotovi:
            b.append("Днес приключи <b>%d</b>:" % len(gotovi))
            for t in gotovi:
                b.append("· %s" % t.get("title", ""))
        else:
            b.append("Днес нищо не е чекнато от твое име.")
        if dnes:
            b.append("")
            b.append("Останаха от избраните: <b>%d</b>" % len(dnes))
            for t in dnes:
                b.append("· %s" % t.get("title", ""))
        b.append("")
        b.append("Напиши в едно изречение какво стана днес. Каквото напишеш сега влиза в дневника.")
        send(chat, "\n".join(b))
        set_meta("bot-awaiting-" + who, {"day": day, "kind": "dokladna"})
        print("попитан", who)


# ---------- четене на отговорите ----------

def chetene():
    offset = (meta("bot-offset", {}) or {}).get("value", 0)
    r = tg("getUpdates", offset=offset + 1, timeout=0, allowed_updates=["message", "callback_query"])
    ups = r.get("result") or []
    if not ups:
        print("нищо ново"); return
    chats = meta("bot-chats", {})
    tasks = {t["id"]: t for t in rows("tasks")}
    last = offset
    for u in ups:
        last = max(last, u["update_id"])
        if "callback_query" in u:
            cb = u["callback_query"]
            act, _, tid = (cb.get("data") or "").partition(":")
            if act == "az":
                # човекът си избра името, оттук нататък чатът е негов
                chat = (cb.get("message") or {}).get("chat", {}).get("id")
                if tid in HORA and chat:
                    chats[tid] = chat
                    set_meta("bot-chats", chats)
                    tg("answerCallbackQuery", callback_query_id=cb["id"], text="Вързан си като " + tid)
                    send(chat, "Здрасти, %s.\n\nОттук нататък:\n"
                               "· сутрин ти пращам какво си взел за днес\n"
                               "· вечер те питам какво стана\n"
                               "· каквото ми напишеш през деня влиза във входящите на борда\n"
                               "· /dnes показва днешните неща по всяко време" % tid)
                continue
            t = tasks.get(tid)
            if t:
                if act == "done":
                    t["status"] = "done"
                    t["doneAt"] = datetime.datetime.now().isoformat(timespec="seconds")
                    put("tasks", t)
                    tg("answerCallbackQuery", callback_query_id=cb["id"], text="Готова.")
                elif act == "utre":
                    t["due"] = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
                    put("tasks", t)
                    tg("answerCallbackQuery", callback_query_id=cb["id"], text="За утре.")
            continue

        m = u.get("message") or {}
        chat = (m.get("chat") or {}).get("id")
        text = (m.get("text") or "").strip()
        if not chat or not text:
            continue
        who = None
        for k, v in chats.items():
            if str(v) == str(chat):
                who = k; break

        if text.startswith("/start") or who is None:
            send(chat, "Кой си?", [[{"text": h, "callback_data": "az:" + h} for h in HORA]])
            # изборът идва като callback, затова го хващаме и тук
            continue

        if text.startswith("/dnes"):
            all_tasks, picked = load()
            dnes, prosro, chaka, otvoreni = den_na(all_tasks, picked, who)
            if dnes:
                for t in dnes:
                    send(chat, red(t), kopcheta(t))
            else:
                send(chat, "Днес нямаш избрани неща.")
            continue

        awaiting = meta("bot-awaiting-" + who, {})
        if awaiting.get("kind") == "dokladna" and awaiting.get("day") == today():
            put("reviews", {"id": "dok-%s-%s" % (today(), who), "day": today(), "who": who,
                            "text": text, "source": "telegram",
                            "at": datetime.datetime.now().isoformat(timespec="seconds")})
            set_meta("bot-awaiting-" + who, {})
            send(chat, "Записах го в дневника.")
            continue

        # всичко останало е прихващане: влиза във входящите на борда
        put("intake", {"id": "in-" + str(m["message_id"]) + "-" + str(chat), "text": text,
                       "by": who, "source": "telegram", "status": "new",
                       "at": datetime.datetime.now().isoformat(timespec="seconds")})
        send(chat, "Прибрах го във входящите.")
    set_meta("bot-offset", {"value": last})
    print("обработени:", len(ups))


def kuki():
    print(json.dumps(meta("bot-chats", {}), ensure_ascii=False, indent=1))


def main(argv):
    if "--sutrin" in argv:
        sutrin()
    elif "--vecher" in argv:
        vecher()
    elif "--chetene" in argv:
        chetene()
    elif "--kuki" in argv:
        kuki()
    else:
        print(__doc__)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main(sys.argv[1:])
