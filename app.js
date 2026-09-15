/* Cohera Board — app core. Shared realtime store via claude.use("db"). */
(function () {
  "use strict";

  var PEOPLE = ["Яни", "Кънчо", "Еви"];
  var PEOPLE_EN = { "Яни": "Яни", "Кънчо": "Кънчо", "Еви": "Еви" };
  var PEOPLE_KEY = { "Яни": "yani", "Кънчо": "kancho", "Еви": "evi" };
  var SIZES = { 15: "15 min", 60: "1 h", 240: "Половин ден" };
    /* Видовете задължения стоят в базата на английски, защото така са засети.
     Превеждат се само при показване, за да не се счупи съвпадението. */
  var KIND_ORDER = ["Posts scheduled", "Ads reviewed", "Google Ads", "Report sent", "Menus", "UGC video", "Expense sheet", "Invoices"];
  var KIND_BG = {
    "Posts scheduled": "Постове насрочени", "Ads reviewed": "Реклами прегледани",
    "Google Ads": "Google Ads", "Report sent": "Отчет пратен", "Menus": "Менюта",
    "UGC video": "UGC видео", "Expense sheet": "Таблица с разходи", "Invoices": "Фактури"
  };
  function kindBG(k) { return KIND_BG[k] || k; }
  var CAPACITY_MIN = 240;
  var STALE_DAYS = 30;

  var db = null;
  var S = {
    tasks: [], clients: [], obligations: [], checkins: {}, months: {}, picks: {}, intake: [], funding: [], reviews: {},
    view: "today", who: "", me: "", taskView: "week", showDone: false, showSomeday: false, fClient: "",
    cal: null, covMonth: null, selected: null, drawerId: null, gate: null, review: null, fundEdit: null, addForm: null,
    loaded: {}, pendingRender: false, highlight: null
  };

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var viewEl = $("#view");

  /* ===================== dates ===================== */
  function isoOf(d) { return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  function todayISO() { return isoOf(new Date()); }
  function monthKey(iso) { return (iso || todayISO()).slice(0, 7); }
  function addDays(iso, n) { var d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return isoOf(d); }
  function dayDiff(iso) { if (!iso) return null; return Math.round((new Date(iso + "T00:00:00") - new Date(todayISO() + "T00:00:00")) / 86400000); }
  function daysSince(ts) { if (!ts) return null; return -dayDiff(String(ts).slice(0, 10)); }
  function daysInMonth(mk) { return new Date(+mk.slice(0, 4), +mk.slice(5, 7), 0).getDate(); }
  function ordinal(n) { var s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  var MON = ["яну", "фев", "мар", "апр", "май", "юни", "юли", "авг", "сеп", "окт", "ное", "дек"];
  var DOW = ["неделя", "понеделник", "вторник", "сряда", "четвъртък", "петък", "събота"];
  function dueLabel(iso) {
    if (!iso) return "";
    var d = dayDiff(iso);
    if (d === 0) return "днес"; if (d === 1) return "утре"; if (d === -1) return "вчера";
    if (d < -1) return "закъсняла с " + Math.abs(d) + " дни";
    var dt = new Date(iso + "T00:00:00");
    if (d > 1 && d < 7) return DOW[dt.getDay()];
    return MON[dt.getMonth()] + " " + dt.getDate();
  }
  function urgency(t) {
    if (t.status === "done") return "";
    var d = dayDiff(t.due);
    if (d !== null && d < 0) return "late";
    if (isWaiting(t)) return "waiting";
    if (d !== null && d <= 1) return "soon";
    return "";
  }
  function weekKey() {
    var d = new Date(); var t = new Date(d.valueOf()); t.setDate(t.getDate() + 4 - (t.getDay() || 7));
    var y0 = new Date(t.getFullYear(), 0, 1);
    return t.getFullYear() + "-w" + Math.ceil((((t - y0) / 86400000) + 1) / 7);
  }

  /* ===================== helpers ===================== */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function now() { return new Date().toISOString(); }
  function clientById(id) { for (var i = 0; i < S.clients.length; i++) if (S.clients[i].id === id) return S.clients[i]; return null; }
  function clientName(id) { if (!id) return "Cohera"; var c = clientById(id); return (c && c.name) || id; }
  function taskById(id) { for (var i = 0; i < S.tasks.length; i++) if (S.tasks[i].id === id) return S.tasks[i]; return null; }
  function oblById(id) { for (var i = 0; i < S.obligations.length; i++) if (S.obligations[i].id === id) return S.obligations[i]; return null; }
  function whoLabel(p) { return PEOPLE_EN[p] || p || ""; }
  function avatar(p) { if (!p) return ""; var k = p === "Кънчо" ? " k" : (p === "Еви" ? " e" : ""); return '<span class="avatar' + k + '" title="' + esc(whoLabel(p)) + '">' + esc(whoLabel(p).charAt(0)) + "</span>"; }
  function sizeLabel(m) { return SIZES[m] || (m ? m + " min" : ""); }
  function snapSize(min) { if (!min) return null; if (min <= 30) return 15; if (min <= 90) return 60; return 240; }
  function fmtMin(m) { if (!m) return "0"; if (m < 60) return m + " min"; var h = Math.floor(m / 60), r = m % 60; return h + " h" + (r ? " " + r : ""); }
  function isWaiting(t) {
    if (t.waitingOn) return true;
    var deps = t.blockedBy || [];
    for (var i = 0; i < deps.length; i++) { var d = taskById(deps[i]); if (d && d.status !== "done") return true; }
    return false;
  }
  function linkKind(url) {
    var u = String(url).toLowerCase();
    if (u.indexOf("docs.google.com/spreadsheets") >= 0) return "Таблица";
    if (u.indexOf("docs.google.com/document") >= 0) return "Документ";
    if (u.indexOf("docs.google.com/presentation") >= 0) return "Презентация";
    if (u.indexOf("drive.google.com") >= 0) return "Drive";
    if (u.indexOf("metricool") >= 0) return "Metricool";
    if (u.indexOf("business.facebook") >= 0 || u.indexOf("adsmanager") >= 0 || u.indexOf("facebook.com/ads") >= 0) return "Ads Manager";
    if (u.indexOf("mailchimp") >= 0) return "Mailchimp";
    if (u.indexOf("canva.com") >= 0) return "Canva";
    if (u.indexOf("clickup") >= 0) return "ClickUp";
    if (u.indexOf("instagram.com") >= 0) return "Instagram";
    if (u.indexOf("facebook.com") >= 0) return "Facebook";
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return "Линк"; }
  }
  function ageChip(t) {
    if (t.status === "done") return "";
    var a = daysSince(t.touchedAt || t.updatedAt || t.createdAt); if (a === null || a < 7) return "";
    return '<span class="chip age' + (a >= 21 ? " crit" : (a >= 14 ? " warn" : "")) + '">untouched ' + a + " d</span>";
  }
  function chips(t, opts) {
    opts = opts || {};
    var b = "";
    if (t.priority) b += '<span class="pri p' + t.priority + '" title="' + (t.priority === 2 ? "спешна" : "важна") + '"></span>';
    if (t.client) b += '<span class="chip client">' + esc(clientName(t.client)) + "</span>";
    if (t.assignee && !opts.noWho) b += avatar(t.assignee);
    if (t.size) b += '<span class="chip est">' + esc(sizeLabel(t.size)) + "</span>";
    if (opts.due && t.due) b += '<span class="chip' + (dayDiff(t.due) < 0 && t.status !== "done" ? " late" : "") + '">' + esc(dueLabel(t.due)) + "</span>";
    if (t.waitingOn) b += '<span class="chip wait">waiting: ' + esc(t.waitingOn) + "</span>";
    else if (isWaiting(t)) b += '<span class="chip wait">blocked</span>';
    if (t.recurring) b += '<span class="chip rec">recurring</span>';
    if (t.source === "claude") b += '<span class="chip rec" title="Written by Claude from chat">C</span>';
    b += ageChip(t);
    b += (t.links || []).map(function (l) { return '<a class="chip link" href="' + esc(l.url) + '" target="_blank" rel="noopener" data-act="link">' + esc(l.label || linkKind(l.url)) + "</a>"; }).join("");
    return b;
  }

  /* ===================== store ===================== */
  var syncEl = $("#sync");
  function failed(e) { console.warn(e); syncEl.textContent = "not saved"; syncEl.style.color = "var(--crit)"; toast("Не се записа. Виж връзката и пробвай пак."); }
  function synced() { syncEl.textContent = "synced " + new Date().toTimeString().slice(0, 5); syncEl.style.color = ""; }
  function put(col, doc) { if (db) db.doc(col + "/" + doc.id).set(doc).then(synced, failed); }
  function patch(col, id, data) { if (db) db.doc(col + "/" + id).update(data).then(synced, failed); }
  function drop(col, id) { if (db) db.doc(col + "/" + id).delete().then(synced, failed); }

  function saveTask(t, silent) {
    t.updatedAt = now(); t.touchedAt = now(); t.updatedBy = S.who || "";
    S.tasks = S.tasks.filter(function (x) { return x.id !== t.id; }).concat([t]);
    if (t.client) touchClient(t.client);
    if (!silent) render();
    put("tasks", t);
  }
  function touchClient(id) { var c = clientById(id); if (c) { c.lastTouchAt = now(); c.lastTouchBy = S.who || ""; patch("clients", id, { lastTouchAt: c.lastTouchAt, lastTouchBy: c.lastTouchBy }); } }
  function markDone(t, undoable) {
    var prev = { status: t.status, doneAt: t.doneAt, doneBy: t.doneBy };
    t.status = "done"; t.doneAt = now(); t.doneBy = S.who || "";
    saveTask(t);
    if (undoable !== false) toast("Готово: " + t.title, "Undo", function () { var f = taskById(t.id) || t; f.status = prev.status; f.doneAt = prev.doneAt; f.doneBy = prev.doneBy; saveTask(f); });
  }
  function deleteTask(t) {
    var copy = JSON.parse(JSON.stringify(t));
    S.tasks = S.tasks.filter(function (x) { return x.id !== t.id; });
    drop("tasks", t.id); if (S.drawerId === t.id) closeDrawer(); render();
    toast("Изтрито „" + t.title + "”", "Undo", function () { put("tasks", copy); S.tasks.push(copy); render(); });
  }
  function cycle(t) {
    if (t.status === "doing") return markDone(t);
    var prev = t.status;
    t.status = t.status === "todo" ? "doing" : "todo";
    if (t.status === "doing" && !t.startedAt) t.startedAt = now();
    if (prev === "done") { t.doneAt = null; t.doneBy = ""; }
    saveTask(t);
  }

  /* ===================== month roll, stale ===================== */
  function rollMonth() {
    if (!db || !S.loaded.months) return;
    var k = monthKey();
    if (!S.months[k]) { S.months[k] = { id: k, createdAt: now(), by: S.who || "" }; put("months", S.months[k]); }
  }
  function staleToSomeday() {
    if (!db || !S.loaded.tasks) return;
    S.tasks.forEach(function (t) {
      if (t.status === "done" || t.someday || t.recurring || t.due) return;   // only undated work parks itself; late work stays red until someone decides
      var ref = t.touchedAt || t.updatedAt || t.createdAt;
      if (ref && daysSince(ref) >= STALE_DAYS) { t.someday = true; t.somedayAt = now(); patch("tasks", t.id, { someday: true, somedayAt: t.somedayAt }); }
    });
  }

  /* ===================== coverage ===================== */
  function cellState(o, mk) {
    if (o.createdMonth && mk < o.createdMonth) return "na";
    var ci = S.checkins[o.id + "_" + mk];
    if (ci) return ci.skipped ? "skipped" : "done";
    if (mk !== monthKey()) return mk < monthKey() ? "late" : "open";
    var day = new Date().getDate(), due = o.dueDay ? Math.min(o.dueDay, daysInMonth(mk)) : null;
    if (due && day > due) return "late";
    if (o.warnDay && day >= o.warnDay) return "warn";
    return "open";
  }
  function checkin(o, mk, skipped) {
    var id = o.id + "_" + mk;
    var doc = { id: id, obligation: o.id, month: mk, by: S.who || "", at: now(), skipped: !!skipped };
    S.checkins[id] = doc; put("checkins", doc); if (o.client) touchClient(o.client); render();
    toast((skipped ? "Пропуснато" : "Чекнато") + ": " + o.title, "Undo", function () { delete S.checkins[id]; drop("checkins", id); render(); });
  }
  function uncheck(o, mk) {
    var id = o.id + "_" + mk, old = S.checkins[id]; if (!old) return;
    delete S.checkins[id]; drop("checkins", id); render();
    toast("Unchecked: " + o.title, "Undo", function () { S.checkins[id] = old; put("checkins", old); render(); });
  }
  function missedMonths(clientId) {
    var n = 0, cur = monthKey();
    Object.keys(S.months).forEach(function (mk) {
      if (mk >= cur) return;
      S.obligations.forEach(function (o) { if (o.client === clientId && o.active !== false && (o.createdMonth || "0000-00") <= mk && !S.checkins[o.id + "_" + mk]) n++; });
    });
    return n;
  }
  function redCells() {
    var mk = monthKey();
    return S.obligations.filter(function (o) { return (!S.me || o.owner === S.me) && o.active !== false; })
      .map(function (o) { return { o: o, state: cellState(o, mk) }; })
      .filter(function (x) { return x.state === "late" || x.state === "warn"; })
      .sort(function (a, b) { return (a.state === "late" ? 0 : 1) - (b.state === "late" ? 0 : 1); });
  }
  function kindsSorted() {
    var kinds = []; S.obligations.forEach(function (o) { if (o.active !== false && kinds.indexOf(o.kind) < 0) kinds.push(o.kind); });
    return kinds.sort(function (a, b) { var ia = KIND_ORDER.indexOf(a), ib = KIND_ORDER.indexOf(b); if (ia < 0) ia = 99; if (ib < 0) ib = 99; return ia - ib || a.localeCompare(b); });
  }

  /* ===================== picks ===================== */
  function pickKey(p, iso) { return (iso || todayISO()) + "_" + (PEOPLE_KEY[p] || "x"); }
  function picksFor(p, iso) { var d = S.picks[pickKey(p, iso)]; return d ? (d.ids || []) : []; }
  function setPicks(p, ids) { var k = pickKey(p); S.picks[k] = { id: k, date: todayISO(), person: p, ids: ids, by: S.who || "" }; put("picks", S.picks[k]); }
  function openPicks(p) { return picksFor(p).filter(function (id) { var t = taskById(id); return t && t.status !== "done"; }); }
  function plannedMin(p) { return openPicks(p).reduce(function (s, id) { var t = taskById(id); return s + (t ? (t.size || 60) : 0); }, 0); }
  function pickedByAnyone(id) { for (var p in S.picks) if (S.picks[p].date === todayISO() && (S.picks[p].ids || []).indexOf(id) >= 0) return S.picks[p].person; return null; }
  function candidatesFor(p) {
    var mine = S.tasks.filter(function (t) { return t.status !== "done" && !t.someday && (t.assignee === p || !t.assignee) && !isWaiting(t) && !pickedByAnyone(t.id); });
    function score(t) { var d = dayDiff(t.due); var s = (t.priority || 0) * 30; if (d !== null) s += d < 0 ? 40 + Math.min(20, -d) : (d === 0 ? 30 : Math.max(0, 20 - d)); if (t.size === 15) s += 5; if (t.assignee === p) s += 8; return s; }
    return mine.sort(function (a, b) { return score(b) - score(a); }).slice(0, 12).map(function (t) {
      var d = dayDiff(t.due), why = d === null ? "" : (d < 0 ? "закъсняла с " + Math.abs(d) + " дни" : (d === 0 ? "за днес" : "за " + dueLabel(t.due)));
      if (t.priority === 2) why = "спешна" + (why ? " · " + why : "");
      return { t: t, why: why };
    });
  }
  function addPick(p, t) {
    if (!t.firstStep || !t.size) { S.gate = { person: p, taskId: t.id, first: t.firstStep || "", size: t.size || null }; render(); return; }
    if (openPicks(p).length >= 3) { toast("Три неща са планът. Първо довърши или размени едно."); return; }
    var ids = picksFor(p); if (ids.indexOf(t.id) < 0) ids.push(t.id);
    setPicks(p, ids); S.gate = null; if (t.client) touchClient(t.client); render();
  }
  /* Едно копче вместо решение. При ADHD най-скъпата стъпка е изборът кое
     точно да хванеш, затова тук няма избор: взима се или вече започнатото,
     или най-горното от избраните за днес, или най-силният кандидат. */
  function grabNow(p) {
    var doing = openPicks(p).map(taskById).filter(Boolean);
    var started = doing.filter(function (x) { return x.status === "doing"; })[0];
    if (started) { startFocus(started); return; }
    if (doing.length) { startFocus(doing[0]); return; }
    var c = candidatesFor(p)[0];
    if (!c) { toast("Няма какво да хванеш. Отвори Задачи и вземи нещо."); return; }
    if (!c.t.firstStep || !c.t.size) { S.gate = { person: p, taskId: c.t.id, first: c.t.firstStep || "", size: c.t.size || null }; render(); toast("Кажи първата стъпка и колко време, и тръгваме."); return; }
    addPick(p, c.t);
    var live = taskById(c.t.id);
    if (live) startFocus(live);
  }

  function removePick(p, id) { setPicks(p, picksFor(p).filter(function (x) { return x !== id; })); render(); }
  function carryOver(p) {
    var y = addDays(todayISO(), -1), left = picksFor(p, y).filter(function (id) { var t = taskById(id); return t && t.status !== "done" && picksFor(p).indexOf(id) < 0; });
    return left.map(taskById).filter(Boolean);
  }

  /* ===================== intake ===================== */
  function addIntake(title, client) {
    var d = { id: uid(), title: title, client: client || "", arrivedAt: now(), dispositionedAt: null, to: "", by: S.who || "" };
    S.intake.push(d); put("intake", d); render();
  }
  function disposeIntake(it, to, makeTask) {
    var live = S.intake.filter(function (x) { return x.id === it.id; })[0] || it;
    live.dispositionedAt = now(); live.to = to || ""; live.dispositionedBy = S.who || "";
    patch("intake", live.id, { dispositionedAt: live.dispositionedAt, to: live.to, dispositionedBy: live.dispositionedBy });
    if (makeTask) { var t = { id: uid(), title: live.title, client: live.client || "", assignee: to === "drop" ? "" : (to || S.who || ""), due: todayISO(), size: 60, priority: 1, status: "todo", createdAt: now(), createdBy: S.who || "", source: "intake" }; saveTask(t, true); if (to !== "drop") openDrawer(t.id); }
    render();
  }

  /* ===================== streak ===================== */
  function streakFor(p) {
    var days = {};
    S.tasks.forEach(function (t) { if (t.status === "done" && t.doneAt && (!p || t.doneBy === p || (!t.doneBy && t.assignee === p))) days[t.doneAt.slice(0, 10)] = 1; });
    Object.keys(S.checkins).forEach(function (k) { var c = S.checkins[k]; if (c.at && (!p || c.by === p)) days[c.at.slice(0, 10)] = 1; });
    var n = 0, d = todayISO(); if (!days[d]) d = addDays(d, -1);
    while (days[d]) { n++; d = addDays(d, -1); }
    return n;
  }

  /* ===================== rows ===================== */
  function rowHTML(t, opts) {
    opts = opts || {};
    var u = urgency(t), cls = "row" + (u ? " " + u : "") + (t.status === "done" ? " done" : "") + (S.selected === t.id ? " selected" : "");
    var late = dayDiff(t.due) !== null && dayDiff(t.due) < 0 && t.status !== "done";
    return '<div class="' + cls + '" data-id="' + esc(t.id) + '" data-act="open">' +
      '<button type="button" class="tick" data-s="' + esc(t.status) + '" data-act="cycle" aria-label="Смени статуса"><svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M1.5 6.3l3 3L10.5 2.7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
      '<div class="mid"><div class="title">' + esc(t.title) + "</div>" +
      '<div class="meta">' + chips(t, opts) + (opts.plan && t.status !== "done" ? '<button type="button" class="btn sm ghost" data-act="plan" data-id="' + esc(t.id) + '">Планирай я</button>' : "") + "</div></div>" +
      '<div class="rightcol due ' + (late ? "late" : (u === "soon" ? "soon" : "")) + '">' + esc(dueLabel(t.due)) + "</div></div>";
  }
  function sortTasks(a, b) {
    var da = a.status === "done" ? 1 : 0, dbb = b.status === "done" ? 1 : 0; if (da !== dbb) return da - dbb;
    if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
    if (!a.due && b.due) return 1; if (a.due && !b.due) return -1; if (a.due !== b.due) return a.due < b.due ? -1 : 1;
    return (a.title || "").localeCompare(b.title || "");
  }
  function section(label, items, opts) {
    if (!items.length) return "";
    return '<section class="section"><div class="section-h">' + esc(label) + " <em class=tnum>" + items.length + "</em>" + (opts && opts.right ? '<span class="right">' + opts.right + "</span>" : "") + "</div>" +
      '<div class="rows">' + items.slice().sort(sortTasks).map(function (t) { return rowHTML(t, opts); }).join("") + "</div></section>";
  }
  function mineOrFree(t) { return !S.me || t.assignee === S.me || !t.assignee; }

  /* ===================== views ===================== */
  function renderToday() {
    var html = "", people = S.me ? [S.me] : PEOPLE, wk = weekKey();
    var az = S.me || S.who;
    if (az) {
      var v = openPicks(az).map(taskById).filter(Boolean);
      var zapochnal = v.filter(function (x) { return x.status === "doing"; })[0];
      html += '<button type="button" class="grab" data-act="grab" data-p="' + esc(az) + '">' +
        '<span class="grab-k">' + (zapochnal ? "Върни се към" : "Хващай нещо сега") + "</span>" +
        '<span class="grab-t">' + esc(zapochnal ? (zapochnal.firstStep || zapochnal.title) : (v.length ? (v[0].firstStep || v[0].title) : "Ще избера вместо теб и пускам 15 минути")) + "</span></button>";
    }
    if (new Date().getDay() === 1 && !S.reviews[wk]) html += '<div class="banner"><b>Понеделник е.</b><span>Мини през всичко закъсняло, изпуснато и застояло. Под 20 минути.</span><span class="spacer"></span><button type="button" class="btn primary sm" data-act="review">Почвай прегледа</button></div>';

    people.forEach(function (p) {
      var ids = picksFor(p), planned = plannedMin(p), over = planned > CAPACITY_MIN, carry = carryOver(p);
      html += '<div class="person-block"><h3>' + avatar(p) + esc(whoLabel(p)) + '<span class="cap' + (over ? " over" : "") + '"><b>' + esc(fmtMin(planned)) + "</b> от " + esc(fmtMin(CAPACITY_MIN)) + " планирани</span></h3>";
      if (carry.length) html += '<div class="carry"><div class="h">Недовършено от вчера</div>' + carry.map(function (t) { return '<div class="item"><span class="t">' + esc(t.firstStep || t.title) + '</span><button type="button" class="btn sm" data-act="carry" data-p="' + esc(p) + '" data-id="' + esc(t.id) + '">Прехвърли за днес</button><button type="button" class="btn sm ghost" data-act="open-id" data-id="' + esc(t.id) + '">Отвори</button></div>'; }).join("") + "</div>";
      html += '<div class="picks">';
      ids.forEach(function (id) {
        var t = taskById(id); if (!t) return;
        html += '<div class="pick' + (t.status === "done" ? " done" : "") + '" data-id="' + esc(t.id) + '">' +
          '<div><div class="step">' + esc(t.firstStep || t.title) + "</div>" + (t.firstStep ? '<div class="of">' + esc(t.title) + "</div>" : "") +
          '<div class="meta">' + chips(t, { noWho: true, due: true }) + "</div></div>" +
          '<div class="acts">' + (t.status === "done" ? '<span class="chip">готова</span>' :
            '<button type="button" class="btn primary sm" data-act="start" data-id="' + esc(t.id) + '">Старт</button>' +
            '<button type="button" class="btn sm" data-act="done-id" data-id="' + esc(t.id) + '">Готова</button>') +
          '<button type="button" class="btn sm ghost" data-act="open-id" data-id="' + esc(t.id) + '">Отвори</button>' +
          '<button type="button" class="btn sm ghost" data-act="unpick" data-p="' + esc(p) + '" data-id="' + esc(t.id) + '" aria-label="Махни я от днес">×</button></div></div>';
      });
      var open = openPicks(p).length;
      html += '<button type="button" class="pick-add' + (open >= 3 ? " full" : "") + '" data-act="gate" data-p="' + esc(p) + '">' + (open >= 3 ? "Три неща. Това е планът за днес." : (ids.length ? "+ Вземи още едно за днес" : "+ Вземи първото нещо за днес")) + "</button>";
      if (S.gate && S.gate.person === p) html += gateHTML(p);
      html += "</div></div>";
    });

    var items = [];
    redCells().slice(0, 6).forEach(function (x) { items.push({ k: x.state === "late" ? "изпуснато" : "наближава", cls: x.state === "late" ? "crit" : "warn", txt: clientName(x.o.client) + " · " + x.o.title, act: "go-cov", id: x.o.id }); });
    S.intake.filter(function (i) { return !i.dispositionedAt && daysSince(i.arrivedAt) >= 3; }).slice(0, 4).forEach(function (i) { items.push({ k: "от " + daysSince(i.arrivedAt) + " дни", cls: "crit", txt: i.title, act: "view", id: "inbox" }); });
    S.tasks.filter(function (t) { return t.status !== "done" && !t.someday && dayDiff(t.due) !== null && dayDiff(t.due) < 0 && mineOrFree(t); }).sort(sortTasks).slice(0, 6).forEach(function (t) { items.push({ k: "закъсняла с " + Math.abs(dayDiff(t.due)) + " д", cls: "crit", txt: t.title, act: "open-id", id: t.id }); });
    S.tasks.filter(function (t) { return t.status !== "done" && isWaiting(t) && daysSince(t.touchedAt || t.updatedAt) >= 5; }).slice(0, 3).forEach(function (t) { items.push({ k: "чака от " + daysSince(t.touchedAt || t.updatedAt) + " дни", cls: "wait", txt: t.title + (t.waitingOn ? " · " + t.waitingOn : ""), act: "open-id", id: t.id }); });
    S.funding.forEach(function (f) { var rw = runwayDays(f); if (rw !== null && rw < 7) items.push({ k: "стигат за " + rw + " дни", cls: "crit", txt: "картата " + f.name, act: "view", id: "clients" }); });
    html += '<div class="breaks"><h3><span class="dot' + (items.length ? "" : " ok") + '"></span>Какво се чупи, ако никой не гледа</h3>';
    html += items.length ? "<ul>" + items.map(function (i) { return '<li><span class="k ' + i.cls + '">' + esc(i.k) + '</span><button type="button" data-act="' + i.act + '" data-id="' + esc(i.id) + '">' + esc(i.txt) + "</button></li>"; }).join("") + "</ul>" : '<div class="fine">В момента нищо не се проваля тихомълком.</div>';
    html += "</div>";

    var unplanned = S.tasks.filter(function (t) { return t.status !== "done" && !t.someday && dayDiff(t.due) === 0 && mineOrFree(t) && !isWaiting(t) && !pickedByAnyone(t.id); });
    html += section("За днес, още непланирана", unplanned, { plan: true, right: "задача влиза в Днес само с първа стъпка и размер" });
    if (!(new Date().getDay() === 1 && !S.reviews[wk])) html += '<div class="section"><button type="button" class="btn" data-act="review">Мини през всичко закъсняло</button></div>';
    return html;
  }
  function gateHTML(p) {
    var g = S.gate, t = g.taskId ? taskById(g.taskId) : null, html = '<div class="gate">';
    if (t) {
      html += '<div class="h">Before this goes on today’s list</div><div class="of">' + esc(t.title) + "</div>" +
        '<div class="f"><label for="gFirst">First step · a verb, one line</label><input type="text" class="ctl" id="gFirst" maxlength="60" value="' + esc(g.first || "") + '" placeholder="Open the Metricool queue for Horizont" data-p="' + esc(p) + '" data-id="' + esc(t.id) + '"></div>' +
        '<div class="f"><label>Колко време</label><div class="seg" id="gSize">' + [15, 60, 240].map(function (s) { return '<button type="button" data-act="gate-size" data-size="' + s + '" aria-pressed="' + (g.size === s ? "true" : "false") + '">' + SIZES[s] + "</button>"; }).join("") + "</div></div>" +
        '<div class="acts" style="display:flex;gap:8px"><button type="button" class="btn primary sm" data-act="gate-ok" data-id="' + esc(t.id) + '" data-p="' + esc(p) + '">Вземи я за днес</button><button type="button" class="btn sm ghost" data-act="gate-cancel">Откажи</button></div>';
    } else {
      var c = candidatesFor(p);
      html += '<div class="h">Pick one for ' + esc(whoLabel(p)) + '</div><div class="cands">' + (c.length ? c.map(function (x) {
        return '<button type="button" class="cand" data-act="gate-pick" data-id="' + esc(x.t.id) + '" data-p="' + esc(p) + '">' + (x.t.priority ? '<span class="pri p' + x.t.priority + '"></span>' : "") + esc(x.t.title) + (x.t.client ? ' <span class="chip client">' + esc(clientName(x.t.client)) + "</span>" : "") + '<span class="why">' + esc(x.why) + "</span></button>";
      }).join("") : '<div class="empty">No open tasks for this person. Add one above.</div>') + "</div>" +
        '<div><button type="button" class="btn sm ghost" data-act="gate-cancel">Откажи</button></div>';
    }
    return html + "</div>";
  }

  function renderCoverage() {
    var mk = S.covMonth || monthKey(), cur = mk === monthKey(), kinds = kindsSorted();
    var rows = S.clients.filter(function (c) { return c.active !== false; }).concat([{ id: "", name: "Cohera (вътрешно)" }]);
    var total = 0, done = 0, late = 0, skipped = 0;
    rows.forEach(function (c) { S.obligations.forEach(function (o) { if (o.client !== c.id || o.active === false || (S.me && o.owner !== S.me)) return; var st = cellState(o, mk); if (st === "na") return; total++; if (st === "done") done++; if (st === "skipped") skipped++; if (st === "late") late++; }); });
    var html = '<div class="cov-sum"><b class=tnum>' + done + " / " + total + "</b><span>closed in " + esc(monthLabel(+mk.slice(0, 4), +mk.slice(5, 7) - 1)) + (skipped ? " · " + skipped + " skipped" : "") + (late ? ' · <b style="font-size:16px;color:var(--crit)">' + late + " missed</b>" : "") + "</span>";
    html += '<div class="seg" style="margin-left:8px"><button type="button" data-act="cov-prev">‹</button><button type="button" data-act="cov-now" aria-pressed="' + (cur ? "true" : "false") + '">Този месец</button><button type="button" data-act="cov-next">›</button></div>';
    html += '<button type="button" class="btn sm ghost" data-act="add-form" data-kind="obligation">+ Obligation</button>';
    html += '<div class="legend"><span><i class="o"></i>open</span><span><i class="w"></i>due soon</span><span><i class="r"></i>missed</span><span><i class="g"></i>done</span></div></div>';
    if (S.addForm === "obligation") html += addFormHTML("obligation");
    html += '<div class="cov-wrap"><table class="cov"><thead><tr><th>Бранд</th>' + kinds.map(function (k) { return "<th>" + esc(kindBG(k)) + "</th>"; }).join("") + "</tr></thead><tbody>";
    rows.forEach(function (c) {
      var mine = S.obligations.filter(function (o) { return o.client === c.id && o.active !== false; });
      if (!mine.length) return;
      if (S.me && !mine.some(function (o) { return o.owner === S.me; })) return;
      var fade = c.id && c.lastTouchAt && daysSince(c.lastTouchAt) >= 14, miss = c.id ? missedMonths(c.id) : 0;
      html += "<tr><th" + (fade ? ' class="faded"' : "") + ">" + esc(c.name || "Cohera") + (miss ? '<span class="miss" title="Изпуснати задължения от предишни месеци">' + miss + " missed</span>" : "") + (c.lastTouchAt ? '<span class="sub">touched ' + daysSince(c.lastTouchAt) + " d ago" + (c.lastTouchBy ? " by " + esc(whoLabel(c.lastTouchBy)) : "") + "</span>" : "") + "</th>";
      kinds.forEach(function (k) {
        var o = null; for (var i = 0; i < mine.length; i++) if (mine[i].kind === k) { o = mine[i]; break; }
        var st = o ? cellState(o, mk) : "na";
        if (!o || st === "na" || (S.me && o.owner !== S.me)) { html += '<td><div class="cell na"><span class="box"></span></div></td>'; return; }
        var ci = S.checkins[o.id + "_" + mk], when = ci && ci.at ? ci.at.slice(8, 10) + " " + MON[+ci.at.slice(5, 7) - 1] : "";
        var label = st === "done" ? (whoLabel(ci.by) || "готово") + (when ? " · " + when : "") : (st === "skipped" ? "пропуснато" : (st === "late" ? "изпуснато" : (o.dueDay ? "до " + Math.min(o.dueDay, daysInMonth(mk)) + "-то" : "отворено")));
        var sub = o.title && o.title !== k ? "<small>" + esc(o.title) + "</small>" : "";
        html += '<td><button type="button" class="cell ' + st + (S.highlight === o.id ? " hl" : "") + '" data-act="cov-cell" data-o="' + esc(o.id) + '" data-mk="' + esc(mk) + '" title="' + esc(o.title + (o.owner ? " · " + whoLabel(o.owner) : "")) + '"><span class="box">' + (st === "done" ? '<svg viewBox="0 0 12 12" width="9" height="9" fill="none"><path d="M1.5 6.3l3 3L10.5 2.7" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>' : "") + '</span><span class="lines"><span>' + label + "</span>" + sub + "</span>" + (o.owner ? avatar(o.owner) : "") + "</button></td>";
      });
      html += "</tr>";
    });
    html += "</tbody></table></div>";
    html += '<p class="empty">Tap a cell when the thing is done. A cell nobody taps turns amber on the warning day and red after the due day, by itself. Past months never clear on their own.</p>';
    S.highlight = null;
    return html;
  }
  function addFormHTML(kind) {
    if (kind === "obligation") return '<form class="inline-form" id="addObl">' +
      '<div class="f"><label>Бранд</label><select class="ctl" name="client"><option value="">Cohera (internal)</option>' + S.clients.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + "</option>"; }).join("") + "</select></div>" +
      '<div class="f"><label>Вид</label><input class="ctl" name="kind" list="kinds" placeholder="Posts scheduled" required><datalist id="kinds">' + KIND_ORDER.map(function (k) { return "<option>" + esc(k) + "</option>"; }).join("") + "</datalist></div>" +
      '<div class="f"><label>Какво точно</label><input class="ctl" name="title" placeholder="Постовете са насрочени 2 седмици напред" required style="min-width:220px"></div>' +
      '<div class="f"><label>Чия е</label><select class="ctl" name="owner">' + PEOPLE.map(function (p) { return '<option value="' + esc(p) + '">' + esc(whoLabel(p)) + "</option>"; }).join("") + "</select></div>" +
      '<div class="f"><label>Ден от месеца</label><input class="ctl n" name="dueDay" type="number" min="1" max="31" value="25"></div>' +
      '<div class="f"><label>Ден за предупреждение</label><input class="ctl n" name="warnDay" type="number" min="1" max="31" value="20"></div>' +
      '<button type="submit" class="btn primary sm">Добави</button><button type="button" class="btn sm ghost" data-act="add-form" data-kind="">Откажи</button></form>';
    if (kind === "client") return '<form class="inline-form" id="addClient"><div class="f"><label>Име на бранда</label><input class="ctl" name="name" required placeholder="Нов клиент" style="min-width:220px"></div><div class="f"><label>Short names for quick add, comma separated</label><input class="ctl" name="aliases" placeholder="acme, акме"></div><button type="submit" class="btn primary sm">Добави</button><button type="button" class="btn sm ghost" data-act="add-form" data-kind="">Откажи</button></form>';
    if (kind === "funding") return '<form class="inline-form" id="addFund"><div class="f"><label>Рекламен акаунт</label><input class="ctl" name="name" required placeholder="RO SHOP ads 1"></div><div class="f"><label>Бранд</label><select class="ctl" name="client">' + S.clients.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + "</option>"; }).join("") + '</select></div><div class="f"><label>€ per day</label><input class="ctl n" name="dailyBurn" type="number" step="1" min="0"></div><div class="f"><label>€ on card</label><input class="ctl n" name="balance" type="number" step="1" min="0"></div><div class="f"><label>Картата изтича</label><input class="ctl" name="cardExpiry" type="date"></div><button type="submit" class="btn primary sm">Добави</button><button type="button" class="btn sm ghost" data-act="add-form" data-kind="">Откажи</button></form>';
    return "";
  }

  function renderTasks() {
    var list = S.tasks.filter(function (t) {
      if (t.someday && !S.showSomeday) return false;
      if (!S.showDone && t.status === "done") return false;
      if (S.fClient && t.client !== S.fClient) return false;
      return mineOrFree(t);
    });
    var html = '<div class="controls" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:4px">' +
      '<div class="seg" id="tv">' + [["week", "Тази седмица"], ["who", "По човек"], ["client", "По клиент"], ["all", "Всички"]].map(function (v) { return '<button type="button" data-tv="' + v[0] + '" aria-pressed="' + (S.taskView === v[0] ? "true" : "false") + '">' + v[1] + "</button>"; }).join("") + "</div>" +
      '<select class="ctl" id="fClient"><option value="">Всички клиенти</option>' + S.clients.map(function (c) { return '<option value="' + esc(c.id) + '"' + (S.fClient === c.id ? " selected" : "") + ">" + esc(c.name) + "</option>"; }).join("") + "</select>" +
      '<button type="button" class="btn sm ghost" data-act="toggle-done" aria-pressed="' + S.showDone + '">' + (S.showDone ? "Скрий готовите" : "Покажи готовите") + "</button>" +
      '<button type="button" class="btn sm ghost" data-act="toggle-someday" aria-pressed="' + S.showSomeday + '">' + (S.showSomeday ? "Скрий „някой ден“" : "Someday (" + S.tasks.filter(function (t) { return t.someday && t.status !== "done"; }).length + ")") + "</button></div>";
    var waiting = list.filter(function (t) { return t.status !== "done" && isWaiting(t) && !t.someday; });
    var active = list.filter(function (t) { return !(t.status !== "done" && isWaiting(t)) && !t.someday; });
    var someday = list.filter(function (t) { return t.someday; });
    if (S.taskView === "week") {
      var g = { late: [], today: [], soon: [], later: [], nodate: [] };
      active.forEach(function (t) { var d = dayDiff(t.due); if (t.status === "done") return g.later.push(t); if (d === null) g.nodate.push(t); else if (d < 0) g.late.push(t); else if (d === 0) g.today.push(t); else if (d <= 7) g.soon.push(t); else g.later.push(t); });
      html += section("Просрочени", g.late) + section("Днес", g.today) + section("Следващите 7 дни", g.soon) + section("По-нататък", g.later) + section("Без дата", g.nodate);
    } else if (S.taskView === "who") {
      PEOPLE.concat([""]).forEach(function (p) { html += section(p ? whoLabel(p) : "Unassigned", active.filter(function (t) { return (t.assignee || "") === p; }), { noWho: true }); });
    } else if (S.taskView === "client") {
      S.clients.map(function (c) { return c.id; }).concat([""]).forEach(function (id) { html += section(id ? clientName(id) : "Вътрешно", active.filter(function (t) { return (t.client || "") === id; })); });
    } else html += section("Всички задачи", active);
    html += section("Waiting on someone else", waiting);
    if (S.showSomeday) html += section("„Някой ден“ · недокоснати над 30 дни", someday);
    if (!active.length && !waiting.length) html += '<div class="empty">Nothing here. Add something in the bar above.</div>';
    return html;
  }

  function renderCalendar() {
    var c = S.cal || (S.cal = { y: +todayISO().slice(0, 4), m: +todayISO().slice(5, 7) - 1 });
    var items = S.tasks.filter(function (t) { return !t.someday && mineOrFree(t); }).map(function (t) { return { id: t.id, title: t.title, due: t.due, status: t.status, priority: t.priority || 0, assignee: t.assignee }; });
    var mk = c.y + "-" + String(c.m + 1).padStart(2, "0");
    S.obligations.forEach(function (o) { if (o.active === false || !o.dueDay || (S.me && o.owner !== S.me)) return; var st = cellState(o, mk); if (st === "na") return; items.push({ id: "ob:" + o.id, title: clientName(o.client) + ": " + o.title, due: mk + "-" + String(Math.min(o.dueDay, daysInMonth(mk))).padStart(2, "0"), status: st === "done" || st === "skipped" ? "done" : "todo", priority: 0 }); });
    return renderMonth(c.y, c.m, items, { today: todayISO(), maxPills: 3 });
  }

  function runwayDays(f) {
    var days = null;
    if (f.dailyBurn && f.balance != null) { var since = Math.max(0, daysSince(f.lastCheckedAt) || 0); days = Math.floor((f.balance - f.dailyBurn * since) / f.dailyBurn); if (days < 0) days = 0; }
    if (f.cardExpiry) { var e = dayDiff(f.cardExpiry); if (e !== null && (days === null || e < days)) days = Math.max(0, e); }
    return days;
  }
  function renderClients() {
    var html = '<div class="section-h" style="margin-top:4px">Ad account runway <span class="right">days until a card runs dry · tap a card to update it</span><button type="button" class="btn sm ghost" data-act="add-form" data-kind="funding" style="margin-left:8px">+ Card</button></div>';
    if (S.addForm === "funding") html += addFormHTML("funding");
    html += '<div class="runway">';
    S.funding.slice().sort(function (a, b) { var ra = runwayDays(a), rb = runwayDays(b); return (ra == null ? 999 : ra) - (rb == null ? 999 : rb); }).forEach(function (f) {
      var rw = runwayDays(f), stale = daysSince(f.lastCheckedAt) === null || daysSince(f.lastCheckedAt) > 10;
      html += '<div class="rw' + (stale ? " stale" : "") + '" data-act="fund" data-id="' + esc(f.id) + '" role="button" tabindex="0"><div class="n">' + esc(f.name) + '</div><b class="' + (rw !== null && rw < 7 ? "crit" : (rw !== null && rw < 14 ? "warn" : "")) + '">' + (rw === null ? "—" : rw + " дни") + '</b><div class="s">' + (f.dailyBurn ? "гори по " + Math.round(f.dailyBurn) + " €/ден" : "още няма дневен разход") + (f.balance != null ? " · " + Math.round(f.balance) + " € към " + (f.lastCheckedAt ? f.lastCheckedAt.slice(5, 10) : "?") : " · салдото не се знае") + "</div><div class=s>" + (f.lastCheckedAt ? "гледано преди " + daysSince(f.lastCheckedAt) + " дни" + (f.checkedBy ? " от " + esc(whoLabel(f.checkedBy)) : "") : "никога не е гледано") + "</div>";
      if (S.fundEdit === f.id) html += '<form class="edit" id="fundForm" data-id="' + esc(f.id) + '"><input class="ctl n" name="balance" type="number" step="1" min="0" placeholder="€ on card" value="' + (f.balance != null ? esc(f.balance) : "") + '"><input class="ctl n" name="dailyBurn" type="number" step="1" min="0" placeholder="€/day" value="' + (f.dailyBurn != null ? esc(Math.round(f.dailyBurn)) : "") + '"><input class="ctl" name="cardExpiry" type="date" value="' + esc(f.cardExpiry || "") + '"><button type="submit" class="btn sm primary">Запази</button><button type="button" class="btn sm ghost" data-act="fund-cancel">Откажи</button></form>';
      html += "</div>";
    });
    html += "</div>";
    html += '<div class="section-h" style="margin-top:22px">Брандове<button type="button" class="btn sm ghost" data-act="add-form" data-kind="client" style="margin-left:8px">+ Brand</button></div>';
    if (S.addForm === "client") html += addFormHTML("client");
    html += '<div class="cards">';
    S.clients.filter(function (c) { return c.active !== false; }).forEach(function (c) {
      var open = S.tasks.filter(function (t) { return t.client === c.id && t.status !== "done" && !t.someday; });
      var late = open.filter(function (t) { return dayDiff(t.due) !== null && dayDiff(t.due) < 0; }).length;
      var next = open.filter(function (t) { return dayDiff(t.due) !== null && dayDiff(t.due) >= 0; }).sort(sortTasks)[0];
      var red = S.obligations.filter(function (o) { return o.client === c.id && o.active !== false && cellState(o, monthKey()) === "late"; }).length;
      var touch = daysSince(c.lastTouchAt), pulse = red || late ? "crit" : (touch !== null && touch >= 14 ? "warn" : (touch === null ? "idle" : "ok"));
      html += '<div class="card" data-act="client" data-id="' + esc(c.id) + '" style="opacity:' + (touch !== null && touch >= 14 ? .65 : 1) + '"><h3><span class="pulse ' + pulse + '"></span>' + esc(c.name || c.id) + '<button type="button" class="btn sm ghost" data-act="touch" data-id="' + esc(c.id) + '" style="margin-left:auto" title="A call or a message counts">Пипната днес</button></h3><div class=kv>' +
        "<span>Отвори</span><b>" + open.length + "</b><span>Просрочени</span><b class=" + (late ? "crit" : "") + ">" + late + "</b>" +
        "<span>Изпуснато този месец</span><b class=" + (red ? "crit" : "ok") + ">" + red + "</b>" +
        "<span>Следващ срок</span><b>" + (next ? esc(dueLabel(next.due)) : "—") + "</b>" +
        "<span>Последно пипната</span><b class=" + (touch !== null && touch >= 14 ? "warn" : "") + ">" + (touch === null ? "never" : (touch === 0 ? "today" : touch + " d ago")) + (c.lastTouchBy ? " · " + esc(whoLabel(c.lastTouchBy)) : "") + "</b></div></div>";
    });
    return html + "</div>";
  }

  function renderInbox() {
    var open = S.intake.filter(function (i) { return !i.dispositionedAt; }).sort(function (a, b) { return a.arrivedAt < b.arrivedAt ? -1 : 1; });
    var html = '<div class="in-add"><input type="text" class="ctl" id="inAdd" placeholder="Something arrived: an invoice, a client request, a brief. One line."><button type="button" class="btn primary" data-act="in-add">Добави</button></div>';
    html += '<div class="intake">' + (open.length ? open.map(function (i) {
      var age = daysSince(i.arrivedAt), cls = age >= 5 ? "crit" : (age >= 2 ? "warn" : "");
      return '<div class="in-row" data-id="' + esc(i.id) + '"><div class="age ' + cls + '">' + age + "<small>d</small></div><div><div class=t>" + esc(i.title) + "</div>" + (i.client ? '<div class="meta"><span class="chip client">' + esc(clientName(i.client)) + "</span></div>" : "") + "</div>" +
        '<div class="acts"><button type="button" class="btn sm primary" data-act="in-now" data-id="' + esc(i.id) + '">Хващай сега</button>' +
        '<select class="ctl" data-act="in-give" data-id="' + esc(i.id) + '" style="padding:5px 8px;font-size:12.5px"><option value="">Give to…</option>' + PEOPLE.map(function (p) { return '<option value="' + esc(p) + '">' + esc(whoLabel(p)) + "</option>"; }).join("") + "</select>" +
        '<button type="button" class="btn sm ghost" data-act="in-drop" data-id="' + esc(i.id) + '">Изтрий</button></div></div>';
    }).join("") : '<div class="empty">Inbox is empty. Things Claude finds in Gmail can land here too.</div>') + "</div>";
    return html;
  }

  function renderReview() {
    var r = S.review; if (!r) return "";
    var it = r.items[r.i];
    if (!it) { var doc = { id: r.week, by: S.who || "", at: now(), count: r.items.length }; S.reviews[r.week] = doc; put("reviews", doc); S.review = null; toast("Прегледът приключи. " + r.items.length + " things decided."); return renderToday(); }
    var html = '<div class="review"><div class="prog">Review · ' + (r.i + 1) + " of " + r.items.length + "</div>";
    if (it.kind === "task") {
      var t = taskById(it.id); if (!t) { r.i++; return renderReview(); }
      html += "<h2>" + esc(t.title) + "</h2><div class=meta>" + chips(t, { due: true }) + "</div>" +
        '<div class="acts"><button type="button" class="btn primary" data-act="rv-done">Готова</button><button type="button" class="btn" data-act="rv-week">Премести с седмица</button><button type="button" class="btn" data-act="rv-today">Днес</button><button type="button" class="btn ghost" data-act="rv-someday">Някой ден</button><button type="button" class="btn ghost danger" data-act="rv-drop">Изтрий</button><button type="button" class="btn ghost" data-act="rv-skip">Пропусни</button></div>';
    } else if (it.kind === "cell") {
      var o = oblById(it.id); if (!o) { r.i++; return renderReview(); }
      html += "<h2>" + esc(clientName(o.client)) + " · " + esc(o.title) + '</h2><div class="of">' + (it.state === "late" ? "Изпуснато този месец" : "Наближава") + (o.owner ? " · " + esc(whoLabel(o.owner)) : "") + "</div>" +
        '<div class="acts"><button type="button" class="btn primary" data-act="rv-check">Готово е</button><button type="button" class="btn ghost" data-act="rv-skipcell">Пропусни този месец</button><button type="button" class="btn ghost" data-act="rv-skip">Остави я</button></div>';
    } else {
      var i = S.intake.filter(function (x) { return x.id === it.id; })[0]; if (!i || i.dispositionedAt) { r.i++; return renderReview(); }
      html += "<h2>" + esc(i.title) + '</h2><div class="of">In the inbox for ' + daysSince(i.arrivedAt) + " days</div>" +
        '<div class="acts"><button type="button" class="btn primary" data-act="rv-innow">Хващай сега</button>' + PEOPLE.map(function (p) { return '<button type="button" class="btn" data-act="rv-ingive" data-p="' + esc(p) + '">' + esc(whoLabel(p)) + "</button>"; }).join("") + '<button type="button" class="btn ghost danger" data-act="rv-indrop">Изтрий</button></div>';
    }
    return html + '<div style="margin-top:14px"><button type="button" class="btn sm ghost" data-act="rv-exit">Излез от прегледа</button></div></div>';
  }
  function startReview() {
    var items = [];
    redCells().forEach(function (x) { items.push({ kind: "cell", id: x.o.id, state: x.state }); });
    S.intake.filter(function (i) { return !i.dispositionedAt && daysSince(i.arrivedAt) >= 3; }).forEach(function (i) { items.push({ kind: "intake", id: i.id }); });
    S.tasks.filter(function (t) { return t.status !== "done" && !t.someday && dayDiff(t.due) !== null && dayDiff(t.due) < 0 && mineOrFree(t); }).sort(sortTasks).forEach(function (t) { items.push({ kind: "task", id: t.id }); });
    if (!items.length) { var doc = { id: weekKey(), by: S.who || "", at: now(), count: 0 }; S.reviews[doc.id] = doc; put("reviews", doc); toast("Нищо просрочено, нищо изпуснато, входящите са чисти. Кратка среща."); render(); return; }
    S.review = { items: items, i: 0, week: weekKey() }; render();
  }

  var TITLES = { today: "Днес", coverage: "Покритие", tasks: "Задачи", calendar: "Календар", clients: "Клиенти", inbox: "Входящи" };
  function typing() { var a = document.activeElement; return !!(a && viewEl.contains(a) && /^(input|textarea|select)$/i.test(a.tagName)); }
  function ready() { return S.loaded.tasks && S.loaded.obligations && S.loaded.checkins && S.loaded.picks && S.loaded.clients; }
  function render() {
    $("#viewTitle").textContent = TITLES[S.view] || "";
    $$("#nav button").forEach(function (b) { if (b.getAttribute("data-view") === S.view) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    $("#you").innerHTML = S.who ? "You are " + esc(whoLabel(S.who)) + ' · <button type="button" id="changeWho">change</button>' : "";
    if (!db || !ready()) return;
    if (typing()) { S.pendingRender = true; return; }
    S.pendingRender = false;
    var scrollX = $(".cov-wrap") ? $(".cov-wrap").scrollLeft : 0;
    viewEl.innerHTML = S.review ? renderReview() : ({ today: renderToday, coverage: renderCoverage, tasks: renderTasks, calendar: renderCalendar, clients: renderClients, inbox: renderInbox }[S.view] || renderToday)();
    if (scrollX && $(".cov-wrap")) $(".cov-wrap").scrollLeft = scrollX;
    var late = S.tasks.filter(function (t) { return t.status !== "done" && !t.someday && dayDiff(t.due) !== null && dayDiff(t.due) < 0 && mineOrFree(t); }).length;
    var red = redCells().filter(function (x) { return x.state === "late"; }).length;
    var inbox = S.intake.filter(function (i) { return !i.dispositionedAt; }).length;
    $("#b-today").textContent = late + red ? String(late + red) : ""; $("#b-cov").textContent = red ? String(red) : ""; $("#b-tasks").textContent = late ? String(late) : ""; $("#b-inbox").textContent = inbox ? String(inbox) : "";
    var st = streakFor(S.who); $("#streak").innerHTML = "<b class=tnum>" + st + "</b><span>" + (st === 1 ? "ден" : "дни") + " подред с приключено нещо</span>";
    if (S.drawerId && !taskById(S.drawerId)) closeDrawer(); else if (S.drawerId) fillDrawer(taskById(S.drawerId), true);
  }

  /* ===================== drawer ===================== */
  function openDrawer(id) { var t = taskById(id); if (!t) return; S.drawerId = id; S.selected = id; fillDrawer(t); $("#drawer").classList.add("open"); $("#scrim").classList.add("open"); $("#drawer").setAttribute("aria-hidden", "false"); render(); }
  function closeDrawer() { var was = S.drawerId; S.drawerId = null; S.selected = null; $("#drawer").classList.remove("open"); $("#scrim").classList.remove("open"); $("#drawer").setAttribute("aria-hidden", "true"); if (was) render(); }
  function fillDrawer(t, soft) {
    if (!t) return;
    var a = document.activeElement;
    function idle(el) { return !soft || a !== el; }
    if (idle($("#drTitle"))) { $("#drTitle").value = t.title || ""; autosize($("#drTitle")); }
    if (idle($("#drFirst"))) $("#drFirst").value = t.firstStep || "";
    if (idle($("#drNotes"))) $("#drNotes").value = t.notes || "";
    if (idle($("#drWait"))) $("#drWait").value = t.waitingOn || "";
    if (idle($("#drDue"))) $("#drDue").value = t.due || "";
    $("#drTick").setAttribute("data-s", t.status);
    $("#drStatusLabel").textContent = t.status === "todo" ? "За правене" : (t.status === "doing" ? "В ход" : "Готова");
    if (idle($("#drClient"))) $("#drClient").innerHTML = '<option value="">Вътрешно</option>' + S.clients.map(function (c) { return '<option value="' + esc(c.id) + '"' + (t.client === c.id ? " selected" : "") + ">" + esc(c.name) + "</option>"; }).join("");
    if (idle($("#drWho"))) $("#drWho").innerHTML = '<option value="">Още никой</option>' + PEOPLE.map(function (p) { return '<option value="' + esc(p) + '"' + (t.assignee === p ? " selected" : "") + ">" + esc(whoLabel(p)) + "</option>"; }).join("");
    $$("#drSize button").forEach(function (b) { b.setAttribute("aria-pressed", +b.getAttribute("data-size") === t.size ? "true" : "false"); });
    $$("#drPri button").forEach(function (b) { b.setAttribute("aria-pressed", +b.getAttribute("data-pri") === (t.priority || 0) ? "true" : "false"); });
    $("#drDeps").innerHTML = (t.blockedBy || []).map(function (id) { var d = taskById(id); return d ? '<div class="dep' + (d.status === "done" ? " done" : "") + '"><span class="pri' + (d.status === "done" ? "" : " p1") + '"></span>' + esc(d.title) + '<button type="button" class="x" data-act="dep-rm" data-id="' + esc(id) + '" aria-label="Махни">×</button></div>' : ""; }).join("");
    if (idle($("#drDepAdd"))) $("#drDepAdd").innerHTML = '<option value="">Add a task this one waits for…</option>' + S.tasks.filter(function (x) { return x.id !== t.id && x.status !== "done" && (t.blockedBy || []).indexOf(x.id) < 0; }).sort(sortTasks).slice(0, 60).map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.title) + "</option>"; }).join("");
    $("#drLinks").innerHTML = (t.links || []).map(function (l, i) { return '<a class="chip link" href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.label || linkKind(l.url)) + '<button type="button" class="x" data-act="link-rm" data-i="' + i + '" aria-label="Махни">×</button></a>'; }).join("");
    $("#drStamp").textContent = (t.createdAt ? "създадена " + t.createdAt.slice(0, 10) : "") + (t.doneAt ? " · готова " + t.doneAt.slice(0, 10) + (t.doneBy ? " от " + whoLabel(t.doneBy) : "") : "") + (t.updatedBy && !t.doneAt ? " · последно пипната от " + whoLabel(t.updatedBy) : "") + (t.source === "claude" ? " · от Клод" : "");
    $("#drSomeday").textContent = t.someday ? "Върни я" : "Някой ден";
  }
  function autosize(el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }
  function drawerTask() { return S.drawerId ? taskById(S.drawerId) : null; }
  function bindDrawer() {
    $("#drClose").addEventListener("click", closeDrawer); $("#scrim").addEventListener("click", closeDrawer);
    $("#drTitle").addEventListener("input", function () { autosize(this); });
    function commit(field, el, transform) { el.addEventListener("change", function () { var t = drawerTask(); if (!t) return; t[field] = transform ? transform(el.value) : el.value; saveTask(t); }); }
    commit("title", $("#drTitle"), function (v) { return v.trim() || "Untitled"; });
    commit("firstStep", $("#drFirst"), function (v) { return v.trim(); });
    commit("notes", $("#drNotes"));
    commit("waitingOn", $("#drWait"), function (v) { return v.trim(); });
    commit("client", $("#drClient")); commit("assignee", $("#drWho"));
    commit("due", $("#drDue"), function (v) { return v || null; });
    $("#drSize").addEventListener("click", function (e) { var b = e.target.closest("button[data-size]"); var t = drawerTask(); if (!b || !t) return; t.size = +b.getAttribute("data-size"); saveTask(t); });
    $("#drPri").addEventListener("click", function (e) { var b = e.target.closest("button[data-pri]"); var t = drawerTask(); if (!b || !t) return; t.priority = +b.getAttribute("data-pri"); saveTask(t); });
    $("#drTick").addEventListener("click", function () { var t = drawerTask(); if (t) cycle(t); });
    $("#drDepAdd").addEventListener("change", function () { var t = drawerTask(); if (!t || !this.value) return; t.blockedBy = (t.blockedBy || []).concat([this.value]); saveTask(t); });
    $("#drDeps").addEventListener("click", function (e) { var b = e.target.closest("[data-act=dep-rm]"); var t = drawerTask(); if (!b || !t) return; t.blockedBy = (t.blockedBy || []).filter(function (x) { return x !== b.getAttribute("data-id"); }); saveTask(t); });
    function addLink() { var t = drawerTask(), v = $("#drLinkIn").value.trim(); if (!t || !v) return; if (!/^https?:\/\//i.test(v)) v = "https://" + v; t.links = (t.links || []).concat([{ url: v, label: linkKind(v) }]); $("#drLinkIn").value = ""; saveTask(t); }
    $("#drLinkBtn").addEventListener("click", addLink);
    $("#drLinkIn").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addLink(); } });
    $("#drLinks").addEventListener("click", function (e) { var b = e.target.closest("[data-act=link-rm]"); var t = drawerTask(); if (!b || !t) return; e.preventDefault(); t.links.splice(+b.getAttribute("data-i"), 1); saveTask(t); });
    $("#drDelete").addEventListener("click", function () { var t = drawerTask(); if (t) deleteTask(t); });
    $("#drSomeday").addEventListener("click", function () { var t = drawerTask(); if (!t) return; t.someday = !t.someday; t.somedayAt = t.someday ? now() : null; saveTask(t); toast(t.someday ? "Отиде в „някой ден“" : "Пак е на борда"); });
    $("#drPick").addEventListener("click", function () { var t = drawerTask(); if (!t) return; var p = t.assignee || S.who || PEOPLE[0]; S.view = "today"; closeDrawer(); addPick(p, t); });
  }

  /* ===================== focus timer ===================== */
  var fo = { id: null, end: 0, tick: null, session: null, rang: false, title: document.title };
  function startFocus(t) {
    fo.id = t.id; fo.end = Date.now() + 15 * 60000; fo.rang = false;
    fo.session = { id: uid(), taskId: t.id, by: S.who || t.assignee || "", startedAt: now() }; put("sessions", fo.session);
    if (t.status === "todo") { t.status = "doing"; t.startedAt = now(); saveTask(t, true); }
    $("#foTitle").textContent = t.title; $("#foStep").textContent = t.firstStep || ""; $("#focusOverlay").hidden = false; tickFocus(); fo.tick = setInterval(tickFocus, 500);
    if (window.Notification && Notification.permission === "default") { try { Notification.requestPermission(); } catch (e) { } }
  }
  function tickFocus() {
    var ms = fo.end - Date.now(), el = $("#foTimer"), s = Math.abs(Math.round(ms / 1000)), txt = (ms < 0 ? "+" : "") + Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    el.textContent = txt; el.classList.toggle("over", ms < 0); document.title = (ms < 0 ? "⏰ " : "") + txt + " · " + fo.title;
    if (ms < 0 && !fo.rang) { fo.rang = true; beep(); try { if (window.Notification && Notification.permission === "granted") new Notification("Time is up", { body: $("#foTitle").textContent }); } catch (e) { } }
  }
  function beep() { try { var ac = new (window.AudioContext || window.webkitAudioContext)(), o = ac.createOscillator(), g = ac.createGain(); o.connect(g); g.connect(ac.destination); o.frequency.value = 880; g.gain.value = .15; o.start(); setTimeout(function () { o.frequency.value = 1175; }, 180); setTimeout(function () { o.stop(); ac.close(); }, 420); } catch (e) { } }
  function stopFocus(done) {
    clearInterval(fo.tick); $("#focusOverlay").hidden = true; document.title = fo.title;
    if (fo.session) { fo.session.endedAt = now(); fo.session.done = !!done; put("sessions", fo.session); }
    var t = taskById(fo.id); if (t && done) markDone(t); else render();
    fo.id = null; fo.session = null;
  }

  /* ===================== toast ===================== */
  var toastT = null;
  function toast(msg, act, fn) {
    var el = $("#toast"); el.innerHTML = esc(msg) + (act ? ' <button type="button">' + esc(act) + "</button>" : "");
    if (act) el.querySelector("button").addEventListener("click", function () { fn(); hide(); });
    el.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(hide, act ? 7000 : 3000);
    function hide() { el.classList.remove("show"); }
  }

  /* ===================== quick add ===================== */
  function parseCtx() { return { people: PEOPLE, clients: S.clients, today: todayISO() }; }
  function parse(v) { return (typeof parseQuickAdd === "function") ? parseQuickAdd(v, parseCtx()) : { title: v, matched: [] }; }
  function bindQuickAdd() {
    var qa = $("#qa"), pv = $("#qaPreview");
    qa.addEventListener("input", function () {
      var v = qa.value.trim(); if (!v) { pv.innerHTML = ""; return; }
      var r = parse(v), bits = [];
      if (r.client) bits.push('<span class="chip client">' + esc(clientName(r.client)) + "</span>");
      if (r.assignee) bits.push('<span class="chip who">' + esc(whoLabel(r.assignee)) + "</span>");
      if (r.due) bits.push('<span class="chip">' + esc(dueLabel(r.due)) + "</span>");
      if (r.estimate) bits.push('<span class="chip est">' + esc(sizeLabel(snapSize(r.estimate))) + "</span>");
      if (r.priority) bits.push('<span class="chip"><span class="pri p' + r.priority + '"></span>' + (r.priority === 2 ? "urgent" : "important") + "</span>");
      pv.innerHTML = '<span class="hint">' + esc(r.title) + "</span>" + bits.join("") + (bits.length ? "" : '<span class="hint">· try “fri Kancho Bioshop check Romania 1h !”</span>');
    });
    qa.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { qa.value = ""; pv.innerHTML = ""; qa.blur(); return; }
      if (e.key !== "Enter") return;
      e.preventDefault(); var v = qa.value.trim(); if (!v) return;
      var r = parse(v);
      if (S.view === "inbox") { addIntake(r.title || v, r.client || ""); qa.value = ""; pv.innerHTML = ""; return; }
      var t = { id: uid(), title: r.title || v, client: r.client || "", assignee: r.assignee || S.me || "", due: r.due || null, size: snapSize(r.estimate), priority: r.priority || 0, status: "todo", createdAt: now(), createdBy: S.who || "", source: "board" };
      saveTask(t); qa.value = ""; pv.innerHTML = "";
      toast("Добавено: " + t.title, "Отвори", function () { openDrawer(t.id); });
    });
  }

  /* ===================== events ===================== */
  function bind() {
    $("#nav").addEventListener("click", function (e) { var b = e.target.closest("button[data-view]"); if (!b) return; S.view = b.getAttribute("data-view"); S.review = null; S.gate = null; S.addForm = null; render(); });
    $("#me").addEventListener("change", function () { S.me = this.value; try { localStorage.setItem("cohera.me", S.me); } catch (e) { } render(); });
    $("#whoGate").addEventListener("click", function (e) { var b = e.target.closest("[data-who]"); if (!b) return; setWho(b.getAttribute("data-who")); });
    document.addEventListener("click", function (e) { if (e.target.id === "changeWho") { $("#whoGate").hidden = false; } });
    $("#foDone").addEventListener("click", function () { stopFocus(true); });
    $("#foStop").addEventListener("click", function () { stopFocus(false); });
    $("#foMore").addEventListener("click", function () { fo.end += 5 * 60000; fo.rang = false; tickFocus(); });

    viewEl.addEventListener("focusout", function () { setTimeout(function () { if (S.pendingRender && !typing()) render(); }, 0); });
    viewEl.addEventListener("input", function (e) { if (e.target.id === "gFirst" && S.gate) S.gate.first = e.target.value; });
    viewEl.addEventListener("submit", function (e) {
      var f = e.target; e.preventDefault();
      var d = {}; Array.prototype.forEach.call(f.elements, function (el) { if (el.name) d[el.name] = el.value; });
      if (f.id === "addObl") { var o = { id: uid(), client: d.client || "", kind: d.kind.trim(), title: d.title.trim(), owner: d.owner, dueDay: +d.dueDay || null, warnDay: +d.warnDay || null, createdMonth: monthKey(), active: true, by: S.who || "" }; if (!o.kind || !o.title) return; S.obligations.push(o); put("obligations", o); S.addForm = null; render(); toast("Добавено задължение"); }
      if (f.id === "addClient") { var name = d.name.trim(); if (!name) return; var id = name.toLowerCase().replace(/[^a-z0-9а-я]+/g, "-").replace(/^-|-$/g, "") || uid(); var c = { id: id, name: name, active: true, aliases: d.aliases.split(",").map(function (s) { return s.trim(); }).filter(Boolean), createdAt: now(), by: S.who || "" }; S.clients.push(c); put("clients", c); S.addForm = null; render(); toast("Добавен бранд: " + name); }
      if (f.id === "addFund") { var fd = { id: uid(), name: d.name.trim(), client: d.client || "", dailyBurn: d.dailyBurn ? +d.dailyBurn : null, balance: d.balance ? +d.balance : null, cardExpiry: d.cardExpiry || null, lastCheckedAt: now(), checkedBy: S.who || "" }; if (!fd.name) return; S.funding.push(fd); put("funding", fd); S.addForm = null; render(); }
      if (f.id === "fundForm") { var ff = S.funding.filter(function (x) { return x.id === f.getAttribute("data-id"); })[0]; if (!ff) return; ff.balance = d.balance === "" ? null : +d.balance; ff.dailyBurn = d.dailyBurn === "" ? null : +d.dailyBurn; ff.cardExpiry = d.cardExpiry || null; ff.lastCheckedAt = now(); ff.checkedBy = S.who || ""; put("funding", ff); S.fundEdit = null; render(); toast("Картата е обновена"); }
    });

    viewEl.addEventListener("click", function (e) {
      if (e.target.closest("a[data-act=link]")) { e.stopPropagation(); return; }
      var el = e.target.closest("[data-act]"); if (!el) return;
      var act = el.getAttribute("data-act"), id = el.getAttribute("data-id"), p = el.getAttribute("data-p"), t;
      if (act === "cycle") { e.stopPropagation(); t = taskById(el.closest(".row").getAttribute("data-id")); if (t) cycle(t); return; }
      if (act === "open") { openDrawer(el.getAttribute("data-id")); return; }
      if (act === "open-id") { openDrawer(id); return; }
      if (act === "done-id") { t = taskById(id); if (t) markDone(t); return; }
      if (act === "start") { t = taskById(id); if (t) startFocus(t); return; }
      if (act === "grab") { grabNow(e.target.closest("[data-p]").getAttribute("data-p")); return; }
      if (act === "unpick") { removePick(p, id); return; }
      if (act === "carry") { t = taskById(id); if (t) addPick(p, t); return; }
      if (act === "plan") { e.stopPropagation(); t = taskById(id); if (t) addPick(t.assignee || S.who || S.me || PEOPLE[0], t); return; }
      if (act === "gate") { if (el.classList.contains("full")) return; S.gate = { person: p, taskId: null }; render(); return; }
      if (act === "gate-cancel") { S.gate = null; render(); return; }
      if (act === "gate-pick") { t = taskById(id); if (t) addPick(p, t); return; }
      if (act === "gate-size") { if (S.gate) S.gate.size = +el.getAttribute("data-size"); $$("#gSize button").forEach(function (x) { x.setAttribute("aria-pressed", x === el ? "true" : "false"); }); return; }
      if (act === "gate-ok") { gateOk(id, p); return; }
      if (act === "view") { S.view = id; render(); return; }
      if (act === "go-cov") { S.view = "coverage"; S.covMonth = null; S.highlight = id; render(); var c = $(".cell.hl"); if (c) c.scrollIntoView({ block: "center", inline: "center" }); return; }
      if (act === "review") { startReview(); return; }
      if (act === "add-form") { S.addForm = el.getAttribute("data-kind") || null; render(); return; }
      if (act === "touch") { e.stopPropagation(); touchClient(id); render(); toast("Отбелязана като пипната днес"); return; }
      if (act === "cov-cell") { var o = oblById(el.getAttribute("data-o")), mk = el.getAttribute("data-mk"); if (!o) return; if (S.checkins[o.id + "_" + mk]) uncheck(o, mk); else checkin(o, mk); return; }
      if (act === "cov-prev" || act === "cov-next" || act === "cov-now") { var mk2 = S.covMonth || monthKey(), y = +mk2.slice(0, 4), m = +mk2.slice(5, 7) - 1; if (act === "cov-now") S.covMonth = null; else { m += act === "cov-next" ? 1 : -1; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } S.covMonth = y + "-" + String(m + 1).padStart(2, "0"); } render(); return; }
      if (act === "cal-prev" || act === "cal-next" || act === "cal-today") { var c2 = S.cal; if (act === "cal-today") S.cal = null; else { c2.m += act === "cal-next" ? 1 : -1; if (c2.m < 0) { c2.m = 11; c2.y--; } if (c2.m > 11) { c2.m = 0; c2.y++; } } render(); return; }
      if (act === "toggle-done") { S.showDone = !S.showDone; render(); return; }
      if (act === "toggle-someday") { S.showSomeday = !S.showSomeday; render(); return; }
      if (act === "client") { S.view = "tasks"; S.fClient = id; S.taskView = "week"; render(); return; }
      if (act === "fund") { if (e.target.closest("form")) return; S.fundEdit = S.fundEdit === id ? null : id; render(); return; }
      if (act === "fund-cancel") { S.fundEdit = null; render(); return; }
      if (act === "in-add") { var v = $("#inAdd").value.trim(); if (!v) return; var r = parse(v); addIntake(r.title || v, r.client || ""); return; }
      var it = S.intake.filter(function (x) { return x.id === id; })[0];
      if (act === "in-now" && it) { disposeIntake(it, S.who || "", true); return; }
      if (act === "in-drop" && it) { disposeIntake(it, "drop", false); toast("Изтрито: " + it.title); return; }
      var r0 = S.review, cur = r0 && r0.items[r0.i];
      if (act.indexOf("rv-") === 0 && r0) {
        if (act === "rv-exit") { S.review = null; render(); return; }
        if (cur && cur.kind === "task") { var tt = taskById(cur.id); if (tt) { if (act === "rv-done") markDone(tt, false); else if (act === "rv-week") { tt.due = addDays(todayISO(), 7); saveTask(tt, true); } else if (act === "rv-today") { tt.due = todayISO(); saveTask(tt, true); } else if (act === "rv-someday") { tt.someday = true; tt.somedayAt = now(); saveTask(tt, true); } else if (act === "rv-drop") { deleteTask(tt); } } }
        if (cur && cur.kind === "cell") { var oo = oblById(cur.id); if (oo) { if (act === "rv-check") checkin(oo, monthKey()); else if (act === "rv-skipcell") checkin(oo, monthKey(), true); } }
        if (cur && cur.kind === "intake") { var ii = S.intake.filter(function (x) { return x.id === cur.id; })[0]; if (ii) { if (act === "rv-innow") disposeIntake(ii, S.who || "", true); else if (act === "rv-ingive") disposeIntake(ii, p, true); else if (act === "rv-indrop") disposeIntake(ii, "drop", false); } }
        if (S.review) { S.review.i++; render(); }
        return;
      }
    });
    viewEl.addEventListener("change", function (e) {
      var el = e.target;
      if (el.id === "fClient") { S.fClient = el.value; render(); }
      if (el.getAttribute("data-act") === "in-give" && el.value) { var it = S.intake.filter(function (x) { return x.id === el.getAttribute("data-id"); })[0]; if (it) disposeIntake(it, el.value, true); }
    });
    viewEl.addEventListener("click", function (e) { var b = e.target.closest("#tv button[data-tv]"); if (b) { S.taskView = b.getAttribute("data-tv"); render(); } });
    viewEl.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      if (e.target.id === "inAdd") { e.preventDefault(); var v = e.target.value.trim(); if (v) { var r = parse(v); addIntake(r.title || v, r.client || ""); e.target.value = ""; } }
      if (e.target.id === "gFirst") { e.preventDefault(); gateOk(e.target.getAttribute("data-id"), e.target.getAttribute("data-p")); }
    });

    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.key === "Escape") { if (S.gate) { S.gate = null; render(); } else if (S.addForm || S.fundEdit) { S.addForm = null; S.fundEdit = null; render(); } else closeDrawer(); return; }
      if (e.key === "n" || e.key === "N") { e.preventDefault(); $("#qa").focus(); return; }
      var views = ["today", "coverage", "tasks", "calendar", "clients", "inbox"], k = parseInt(e.key, 10);
      if (k >= 1 && k <= 6) { S.view = views[k - 1]; S.review = null; render(); }
    });
    bindDrawer(); bindQuickAdd();
  }
  function gateOk(id, p) {
    var t = taskById(id); if (!t || !S.gate) return;
    var fs = ($("#gFirst") ? $("#gFirst").value : S.gate.first || "").trim(), sz = S.gate.size;
    if (!fs) { toast("Напиши първата стъпка. Един глагол."); if ($("#gFirst")) $("#gFirst").focus(); return; }
    if (!sz) { toast("Избери колко време ще отнеме."); return; }
    t.firstStep = fs; t.size = sz; saveTask(t, true); S.gate = null; addPick(p, t);
  }
  function setWho(w) {
    S.who = w; try { localStorage.setItem("cohera.who", w); } catch (e) { }
    if (!S.me) { S.me = w; $("#me").value = w; try { localStorage.setItem("cohera.me", w); } catch (e) { } }
    $("#whoGate").hidden = true; render();
  }

  /* ===================== boot ===================== */
  (function stamp() { var d = new Date(); $("#today").textContent = DOW[d.getDay()] + ", " + MON[d.getMonth()] + " " + d.getDate(); })();
  try { S.who = localStorage.getItem("cohera.who") || ""; S.me = localStorage.getItem("cohera.me") || ""; } catch (e) { }
  var q = new URLSearchParams(location.search).get("me"); if (q) { var map = { yani: "Яни", kancho: "Кънчо", evi: "Еви" }; if (map[q.toLowerCase()]) { S.me = map[q.toLowerCase()]; if (!S.who) S.who = S.me; } }
  $("#me").value = S.me; bind();
  if (!S.who) $("#whoGate").hidden = false;
  render();

  (window.getBoardDb ? window.getBoardDb() : (window.claude && window.claude.use ? window.claude.use("db") : Promise.resolve(null))).then(function (d) {
    db = d;
    if (!db) { viewEl.innerHTML = '<div class="state">The board cannot reach its data from this view. Open it from the artifact link.</div>'; return; }
    function docs(snap) { return snap.docs.map(function (x) { return Object.assign({ id: x.id }, x.data()); }); }
    db.collection("clients").onSnapshot(function (s) { S.clients = docs(s).filter(function (c) { return c.active !== false; }).sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); }); S.loaded.clients = 1; render(); synced(); });
    db.collection("obligations").onSnapshot(function (s) { S.obligations = docs(s); S.loaded.obligations = 1; render(); synced(); });
    db.collection("checkins").onSnapshot(function (s) { S.checkins = {}; docs(s).forEach(function (c) { S.checkins[c.id] = c; }); S.loaded.checkins = 1; render(); synced(); });
    db.collection("months").onSnapshot(function (s) { S.months = {}; docs(s).forEach(function (m) { S.months[m.id] = m; }); S.loaded.months = 1; rollMonth(); render(); });
    db.collection("picks").onSnapshot(function (s) { S.picks = {}; docs(s).forEach(function (p) { S.picks[p.id] = p; }); S.loaded.picks = 1; render(); });
    db.collection("intake").onSnapshot(function (s) { S.intake = docs(s); render(); synced(); });
    db.collection("funding").onSnapshot(function (s) { S.funding = docs(s); render(); });
    db.collection("reviews").onSnapshot(function (s) { S.reviews = {}; docs(s).forEach(function (r) { S.reviews[r.id] = r; }); render(); });
    db.collection("tasks").onSnapshot(function (s) { S.tasks = docs(s); if (!S.loaded.tasks) { S.loaded.tasks = 1; staleToSomeday(); } render(); synced(); });
  }).catch(function (e) { console.error(e); viewEl.innerHTML = '<div class="state">Data did not load. Reload the page.</div>'; });
})();
