// Телеграм звъни тук в мига, в който някой напише или натисне копче.
//
// Преди това ботът питаше Телеграм веднъж на час от GitHub Actions. Работеше,
// но копчетата въртяха и се отказваха, защото Телеграм чака отговор за секунди,
// а не за час. Затова обръщаме посоката: не ние питаме, а той звъни.
//
// Функцията прави същото като tools/bot.py --chetene, само че веднага.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT = Deno.env.get("BOARD_BOT_TOKEN")!;
const SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") || "";
const API = `https://api.telegram.org/bot${BOT}/`;
const HORA = ["Яни", "Кънчо", "Еви"];

async function db(method: string, path: string, body?: unknown, prefer?: string) {
  const h: Record<string, string> = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
  if (prefer) h.Prefer = prefer;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

async function getDoc(table: string, id: string) {
  const r = await db("GET", `${table}?select=data&id=eq.${encodeURIComponent(id)}`);
  return r && r.length ? r[0].data : null;
}

async function putDoc(table: string, id: string, data: unknown) {
  await db("POST", table, [{ id, data }], "resolution=merge-duplicates");
}

async function tg(method: string, params: Record<string, unknown>) {
  await fetch(API + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

function send(chat: number | string, text: string, buttons?: unknown) {
  return tg("sendMessage", {
    chat_id: chat,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

function today() {
  // Всичко в борда се води по софийско време, иначе денят се сменя по обед.
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function red(t: Record<string, string>) {
  let s = `<b>${t.title ?? ""}</b>`;
  if (t.client) s += `  <i>${t.client}</i>`;
  if (t.firstStep) s += `\n   ↳ ${t.firstStep}`;
  return s;
}

const kopcheta = (id: string) => [[
  { text: "Готова", callback_data: `done:${id}` },
  { text: "За утре", callback_data: `utre:${id}` },
]];

async function kojSi(chat: number) {
  await send(chat, "Кой си?", [HORA.map((h) => ({ text: h, callback_data: `az:${h}` }))]);
}

async function dneshni(chat: number, who: string) {
  const [tasks, picks] = await Promise.all([db("GET", "tasks?select=id,data"), db("GET", "picks?select=id,data")]);
  const day = today();
  const ids = new Set<string>();
  for (const p of picks ?? []) {
    if (p.data?.date === day || p.data?.day === day) for (const i of p.data.ids ?? []) ids.add(i);
  }
  const mine = (tasks ?? [])
    .map((r: { id: string; data: Record<string, string> }) => ({ ...r.data, id: r.id }))
    .filter((t: Record<string, string>) => ids.has(t.id) && t.status !== "done" && t.assignee === who);
  if (!mine.length) return send(chat, "Днес нямаш избрани неща.");
  for (const t of mine) await send(chat, red(t), kopcheta(t.id));
}

Deno.serve(async (req) => {
  if (SECRET && req.headers.get("x-telegram-bot-api-secret-token") !== SECRET) {
    return new Response("не", { status: 401 });
  }
  let u: Record<string, any>;
  try {
    u = await req.json();
  } catch {
    return new Response("ok");
  }

  const chats: Record<string, number> = (await getDoc("meta", "bot-chats")) ?? {};
  const whoOf = (chat: number) => Object.keys(chats).find((k) => String(chats[k]) === String(chat));

  try {
    if (u.callback_query) {
      const cb = u.callback_query;
      const [act, id] = String(cb.data ?? "").split(":");
      const chat = cb.message?.chat?.id;

      if (act === "az" && HORA.includes(id) && chat) {
        chats[id] = chat;
        await putDoc("meta", "bot-chats", chats);
        await tg("answerCallbackQuery", { callback_query_id: cb.id, text: `Вързан си като ${id}` });
        await send(
          chat,
          `Здрасти, ${id}.\n\nОттук нататък:\n` +
            "· сутрин ти пращам какво си взел за днес\n" +
            "· вечер те питам какво стана\n" +
            "· каквото ми напишеш през деня влиза във входящите на борда\n" +
            "· /dnes показва днешните неща по всяко време",
        );
        return new Response("ok");
      }

      const t = await getDoc("tasks", id);
      if (!t) {
        await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Не я намирам." });
        return new Response("ok");
      }
      if (act === "done") {
        t.status = "done";
        t.doneAt = new Date().toISOString().slice(0, 19);
        t.doneBy = whoOf(chat) ?? t.assignee ?? "";
        await putDoc("tasks", id, t);
        await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Готова." });
      } else if (act === "utre") {
        const d = new Date(Date.now() + 27 * 3600 * 1000);
        t.due = d.toISOString().slice(0, 10);
        await putDoc("tasks", id, t);
        await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "За утре." });
      }
      return new Response("ok");
    }

    const m = u.message;
    const chat = m?.chat?.id;
    const text = String(m?.text ?? "").trim();
    if (!chat || !text) return new Response("ok");
    const who = whoOf(chat);

    if (text.startsWith("/start") || !who) {
      await kojSi(chat);
      return new Response("ok");
    }
    if (text.startsWith("/dnes")) {
      await dneshni(chat, who);
      return new Response("ok");
    }

    // Чака ли се докладна за днес
    const awaiting = (await getDoc("meta", `bot-awaiting-${who}`)) ?? {};
    if (awaiting.kind === "dokladna" && awaiting.day === today()) {
      await putDoc("reviews", `dok-${today()}-${who}`, {
        day: today(), who, text, source: "telegram",
        at: new Date().toISOString().slice(0, 19),
      });
      await putDoc("meta", `bot-awaiting-${who}`, {});
      await send(chat, "Записах го в дневника.");
      return new Response("ok");
    }

    // Всичко останало е прихващане: влиза във входящите на борда
    await putDoc("intake", `in-${m.message_id}-${chat}`, {
      title: text, by: who, source: "telegram", status: "new",
      arrivedAt: new Date().toISOString().slice(0, 19),
      dispositionedAt: null, to: "",
    });
    await send(chat, "Прибрах го във входящите.");
  } catch (e) {
    console.error("гръмна:", e);
  }
  return new Response("ok");
});
