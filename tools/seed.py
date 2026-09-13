# -*- coding: utf-8 -*-
"""Fills the Supabase board with Cohera's real brands, monthly duties and the open work
that came out of the 11-13 Sep 2026 sessions. Safe to run again: every row has a fixed id.

    python tools/seed.py
"""
import io, json, os, sys, urllib.error, urllib.request

ENV = r"C:\Claude Code projects\COHERA DIGITAL\.env"
NOW = "2026-09-13T05:00:00.000Z"


def env(key):
    for line in io.open(ENV, encoding="utf-8"):
        if line.startswith(key + "="):
            return line.split("=", 1)[1].strip()
    sys.exit(key + " липсва в .env")


URL, KEY = env("SUPABASE_URL").rstrip("/"), env("SUPABASE_SERVICE_KEY")


def upsert(table, rows):
    body = [{"id": r["id"], "data": r} for r in rows]
    req = urllib.request.Request(URL + "/rest/v1/" + table, method="POST", data=json.dumps(body).encode("utf-8"))
    for h, v in (("apikey", KEY), ("Authorization", "Bearer " + KEY), ("Content-Type", "application/json"),
                 ("Prefer", "resolution=merge-duplicates,return=minimal")):
        req.add_header(h, v)
    try:
        urllib.request.urlopen(req, timeout=120).read()
        print("%-12s %d" % (table, len(rows)))
    except urllib.error.HTTPError as e:
        sys.exit("%s: %s %s" % (table, e.code, e.read().decode("utf-8", "replace")[:400]))


CLIENTS = [
    ("patricia", "Патриция", ["patricia", "patriciya", "патриция"]),
    ("bioshop", "Биошоп", ["bioshop", "bio", "биошоп"]),
    ("mma", "MMA shop", ["mma", "mmashop"]),
    ("horizont", "Horizont", ["horizont", "хоризонт"]),
    ("marche", "Марше", ["marche", "marshe", "марше"]),
    ("veranda", "Веранда", ["veranda", "веранда"]),
    ("forrest", "Forrest Varna", ["forrest", "forest", "форест"]),
    ("melnicharyat", "Мелничарят", ["melnicharyat", "melnichar", "мелничар"]),
    ("sbc", "Simply Business Class", ["sbc", "simply"]),
    ("mitevi", "Митеви Минералс", ["mitevi", "митеви"]),
    ("fantastic", "Fantastic Services", ["fantastic", "фантастик"]),
    ("buzzover", "Buzzover", ["buzzover", "buzz", "бъзовър"]),
    ("meatbox", "The MeatBox", ["meatbox", "мийтбокс"]),
    ("hit", "Hit-Electronics", ["hit", "хит"]),
    ("skyoffice", "Sky Office", ["skyoffice", "sky", "скай"]),
    ("zavaryavane", "Заваряване", ["zavaryavane", "welding", "заваряване"]),
    ("ayastyle", "Ая Стайл", ["ayastyle", "aya", "ая"]),
]

O = [  # id, client, kind, title, owner, dueDay, warnDay
    ("patricia-posts", "patricia", "Posts scheduled", "Posts scheduled 2 weeks ahead in Metricool", "Яни", 25, 20),
    ("patricia-ads", "patricia", "Ads reviewed", "Facebook ads reviewed and budgets checked", "Яни", 28, 21),
    ("patricia-google", "patricia", "Google Ads", "Google Ads reviewed", "Кънчо", 28, 21),
    ("patricia-report", "patricia", "Report sent", "Monthly report sent to the client", "Кънчо", 8, 6),
    ("bioshop-ads", "bioshop", "Ads reviewed", "All Bioshop ad accounts reviewed: BG, RO, GR, SI", "Кънчо", 28, 21),
    ("bioshop-report", "bioshop", "Report sent", "Monthly spend and ROAS report sent", "Кънчо", 8, 6),
    ("mma-ads", "mma", "Ads reviewed", "MMA shop ads reviewed", "Кънчо", 28, 21),
    ("mma-report", "mma", "Report sent", "Monthly report sent", "Кънчо", 8, 6),
    ("horizont-posts", "horizont", "Posts scheduled", "Posts scheduled 2 weeks ahead", "Яни", 25, 20),
    ("horizont-ads", "horizont", "Ads reviewed", "Horizont ads reviewed", "Яни", 28, 21),
    ("horizont-menus", "horizont", "Menus", "New menus for Marche and Veranda", "Еви", 3, 1),
    ("marche-posts", "marche", "Posts scheduled", "Posts scheduled 2 weeks ahead", "Яни", 25, 20),
    ("veranda-posts", "veranda", "Posts scheduled", "Posts scheduled 2 weeks ahead", "Яни", 25, 20),
    ("forrest-posts", "forrest", "Posts scheduled", "Posts scheduled 2 weeks ahead (ends 30 Sep)", "Еви", 25, 20),
    ("melnicharyat-posts", "melnicharyat", "Posts scheduled", "Wednesday recipe posts scheduled", "Еви", 25, 20),
    ("melnicharyat-ads", "melnicharyat", "Ads reviewed", "Ads reviewed", "Кънчо", 28, 21),
    ("sbc-ads", "sbc", "Ads reviewed", "SBC ads reviewed", "Кънчо", 28, 21),
    ("sbc-posts", "sbc", "Posts scheduled", "Posts scheduled 2 weeks ahead", "Яни", 25, 20),
    ("mitevi-posts", "mitevi", "Posts scheduled", "Posts scheduled 2 weeks ahead", "Еви", 25, 20),
    ("mitevi-ugc", "mitevi", "UGC video", "UGC video delivered", "Еви", 20, 15),
    ("mitevi-ads", "mitevi", "Ads reviewed", "Ads reviewed", "Яни", 28, 21),
    ("fantastic-ads", "fantastic", "Ads reviewed", "Fantastic Services ads reviewed", "Яни", 28, 21),
    ("zavaryavane-ads", "zavaryavane", "Ads reviewed", "Facebook ads reviewed", "Кънчо", 28, 21),
    ("zavaryavane-google", "zavaryavane", "Google Ads", "Google Ads reviewed", "Кънчо", 28, 21),
    ("ayastyle-ads", "ayastyle", "Ads reviewed", "Ads reviewed", "Кънчо", 28, 21),
    ("buzzover-ads", "buzzover", "Ads reviewed", "Ads reviewed", "Кънчо", 28, 21),
    ("internal-expenses", "", "Expense sheet", "Expense sheet entered for last month", "Яни", 5, 3),
    ("internal-invoices", "", "Invoices", "Client invoices sent", "Яни", 5, 3),
]

T = [  # id, title, client, assignee, due, size, priority, firstStep
    ("t-evi-access", "Добави Еви към организацията в claude.ai и към Google Workspace", "", "Яни", "2026-09-15", 15, 2, "Отвори настройките за екипа и добави адреса ѝ"),
    ("t-profile", "Обезопаси профила с флага compromised user в Rebel+ и го свали от админ навсякъде", "", "Яни", "2026-09-15", 240, 2, "Влез в Business Manager, People, и виж чий е профилът"),
    ("t-unsettled", "Плати трите неплатени сметки: blazz.sport, Meatbox ads 1, Mushproof BG", "", "Яни", "2026-09-15", 60, 2, "Отвори Billing в първия акаунт и виж сумата"),
    ("t-mma-30aug", "Провери 30 август в MMA: ROAS 27,29 при 14 покупки, тоест 262 € на поръчка", "mma", "Кънчо", "2026-09-15", 60, 1, "Отвори Ads Manager за 30.08 и виж коя кампания носи стойността"),
    ("t-mma-7sep", "Провери защо MMA е паднал на 7 септември, разходът е наполовина", "mma", "Кънчо", "2026-09-15", 15, 1, "Виж Account Quality и Billing за 7 септември"),
    ("t-access", "Дай достъп до Румъния и Словения на профила зад Meta конектора", "bioshop", "Яни", "2026-09-16", 15, 1, "Отвори Business Manager, Ad accounts, Add people"),
    ("t-fees", "Изпиши месечния фий на всеки клиент, по един ред на клиент", "", "Яни", "2026-09-16", 60, 2, "Отвори нов лист и напиши първите три клиента по памет"),
    ("t-patricia-email", "Одобри имейла от брошурата и го насрочи в Mailchimp", "patricia", "Яни", "2026-09-16", 60, 1, "Отвори черновата e4f3b3308a и прочети първия екран"),
    ("t-ro-value", "Провери стойността в Румъния, беше грешна пет пъти до април", "bioshop", "Кънчо", "2026-09-17", 60, 2, "Отвори Events Manager и сравни една поръчка с магазина"),
    ("t-billing", "Извади извлеченията с тегленията на Meta по двете карти за 60 дни", "bioshop", "Кънчо", "2026-09-18", 60, 1, "Ads Manager, Billing, Transactions, Export"),
    ("t-fake-order", "Филтър в магазина срещу Purchase над определена стойност, заради фалшивата поръчка за 72 000 € на 20 август", "bioshop", "Яни", "2026-09-19", 60, 1, "Пиши на разработчика с примера от 20 август"),
    ("t-feed", "Изчисти продуктите за сексуална функция от каталожния фийд, влизат в рекламния текст сами", "bioshop", "Яни", "2026-09-19", 240, 2, "Отвори каталога и филтрирай по име на продукт"),
    ("t-gr-audience", "Гърция: нова аудитория и нови креативи преди ноември, честотата и CPC вървят заедно", "bioshop", "Кънчо", "2026-09-26", 240, 1, "Виж кои аудитории са на честота над 6"),
    ("t-mma-nov", "Писмено решение по промоционалната политика в MMA за ноември до януари", "mma", "Яни", "2026-10-03", 60, 1, "Извади числата за миналия ноември и декември"),
    ("t-season-creative", "Креативи за сезона ноември до януари, правят се сега", "bioshop", "Кънчо", "2026-10-10", 240, 1, "Направи списък какво е работило миналия сезон"),
    ("t-telegram", "Реши в колко часа и към кого да тръгне сутрешното съобщение за парите по картите", "bioshop", "Яни", "2026-09-16", 15, 1, "Отвори групата Bioshop payments и виж пробното съобщение"),
]

FUND = [
    ("bioshop2", "BIoshop2", "bioshop", "475138412214378", 132.0),
    ("mma", "MMA shop ads 1", "mma", "1055226869265729", 114.5),
    ("vitahellas-gr2", "Vitahellas GR 2", "bioshop", "1486202193128554", 170.8),
]

upsert("clients", [{"id": i, "name": n, "active": True, "aliases": a} for i, n, a in CLIENTS])
upsert("obligations", [{"id": i, "client": c, "kind": k, "title": t, "owner": o, "dueDay": d, "warnDay": w,
                        "createdMonth": "2026-09", "active": True, "source": "claude"} for i, c, k, t, o, d, w in O])
upsert("tasks", [{"id": i, "title": t, "firstStep": f, "client": c, "assignee": a, "due": d, "size": s,
                  "priority": p, "status": "todo", "createdAt": NOW, "createdBy": "claude", "source": "claude"}
                 for i, t, c, a, d, s, p, f in T])
upsert("funding", [{"id": i, "name": n, "client": c, "accountId": acc, "dailyBurn": b, "balance": None,
                    "lastCheckedAt": None, "source": "claude",
                    "note": "dailyBurn = 7-day average from Meta, 5-11 Sep 2026"} for i, n, c, acc, b in FUND])
upsert("intake", [{"id": "in-bioshop-invoice-aug", "source": "claude", "client": "bioshop",
                   "title": "Фактура от Биошоп за август (Румъния и Словения) стои непрочетена в пощата от 2 септември",
                   "arrivedAt": "2026-09-02T08:00:00.000Z", "dispositionedAt": None, "to": ""}])
upsert("meta", [{"id": "schema", "about": "Cohera Board. Claude reads and writes these tables with the service key from the private .env. Everything Claude writes carries source:'claude'.",
                 "people": ["Яни", "Кънчо", "Еви"],
                 "tables": {
                     "tasks": "{title, firstStep, notes, client(id), assignee, due(YYYY-MM-DD), size(15|60|240), priority(0|1|2), status(todo|doing|done), blockedBy[], waitingOn, links[{url,label}], someday, touchedAt, createdAt/By, updatedAt/By, doneAt/By, source}",
                     "clients": "{name, active, aliases[] (quick-add parser), lastTouchAt, lastTouchBy}",
                     "obligations": "{client(id or '' internal), kind, title, owner, dueDay, warnDay, createdMonth, active} — the Coverage grid",
                     "checkins": "id = obligationId_YYYY-MM; {obligation, month, by, at, skipped}",
                     "months": "id = YYYY-MM, written on first open of a month",
                     "picks": "id = YYYY-MM-DD_yani|kancho|evi; {date, person, ids[], by}",
                     "intake": "{title, client, arrivedAt, dispositionedAt, to} — waiting for a human decision",
                     "funding": "{name, client, accountId, dailyBurn, balance, lastCheckedAt, checkedBy, cardExpiry} — ad card runway",
                     "reviews": "id = ISO week, e.g. 2026-w38; {by, at, count}",
                     "sessions": "{taskId, by, startedAt, endedAt, done} — focus timer"},
                 "rules": ["Задача с ясен отговорник и дата отива в tasks; нещо, което чака решение, отива в intake.",
                           "Obligations не се създават без да се пита, те са постоянните ангажименти на екипа.",
                           "Никога задача без title."]}])
print("готово")
