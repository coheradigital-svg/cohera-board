/* Quick-add parser: one sentence in Bulgarian or English -> task fields. Pure ES5, no DOM. */
function parseQuickAdd(text, ctx) {
  var result = { title: "", assignee: "", client: "", due: null, estimate: null, priority: 0, matched: [] };
  try {
    if (typeof text !== "string") { text = (text == null) ? "" : String(text); }
    result.title = text;
    if (text.replace(/^\s+|\s+$/g, "") === "") { return result; }

    ctx = ctx || {};
    var people = ctx.people || [];
    var clients = ctx.clients || [];
    var todayISO = ctx.today;
    var hasToday = typeof todayISO === "string" && /^\d{4}-\d{2}-\d{2}$/.test(todayISO);
    var lower = text.toLowerCase();

    function isWordChar(ch) { return /[0-9A-Za-zА-яЁё]/.test(ch); }
    function findWord(hay, word, from) {
      var idx = from || 0, wlen = word.length;
      while (true) {
        var pos = hay.indexOf(word, idx);
        if (pos === -1) { return -1; }
        var b = (pos === 0) || !isWordChar(hay.charAt(pos - 1));
        var a = (pos + wlen >= hay.length) || !isWordChar(hay.charAt(pos + wlen));
        if (b && a) { return pos; }
        idx = pos + 1;
      }
    }
    function eachBoundary(re, str, fn) {   /* calls fn(m) for every boundary-clean match; fn returns true to stop */
      re.lastIndex = 0; var m;
      while ((m = re.exec(str)) !== null) {
        var s = m.index, e = s + m[0].length;
        var b = (s === 0) || !isWordChar(str.charAt(s - 1));
        var a = (e >= str.length) || !isWordChar(str.charAt(e));
        if (b && a && fn(m)) { return; }
        if (re.lastIndex === m.index) { re.lastIndex++; }
      }
    }
    function execBoundary(re, str) { var out = null; eachBoundary(re, str, function (m) { out = m; return true; }); return out; }
    function pad2(n) { n = "" + n; return n.length < 2 ? "0" + n : n; }
    function dim(y, m) { return new Date(y, m, 0).getDate(); }
    function toISO(y, m, d) { d = Math.min(d, dim(y, m)); return y + "-" + pad2(m) + "-" + pad2(d); }
    function parseISO(s) { var p = s.split("-"); return { y: +p[0], m: +p[1], d: +p[2] }; }
    function dateToISO(dt) { return toISO(dt.getFullYear(), dt.getMonth() + 1, dt.getDate()); }
    function addDays(iso, n) { var p = parseISO(iso); var dt = new Date(p.y, p.m - 1, p.d); dt.setDate(dt.getDate() + n); return dateToISO(dt); }
    function dow(iso) { var p = parseISO(iso); return new Date(p.y, p.m - 1, p.d).getDay(); }
    function nextWeekday(iso, target, strictNext) { var diff = (target - dow(iso) + 7) % 7; if (strictNext && diff === 0) { diff = 7; } return addDays(iso, diff); }
    function ensureFuture(y, m, d, iso, unit) {
      var c = toISO(y, m, d);
      if (c < iso) { if (unit === "month") { m += 1; if (m > 12) { m = 1; y += 1; } } else { y += 1; } c = toISO(y, m, d); }
      return c;
    }
    var TR = { "а":"a","б":"b","в":"v","г":"g","д":"d","е":"e","ж":"zh","з":"z","и":"i","й":"y","к":"k","л":"l","м":"m","н":"n","о":"o","п":"p","р":"r","с":"s","т":"t","у":"u","ф":"f","х":"h","ц":"ts","ч":"ch","ш":"sh","щ":"sht","ъ":"a","ь":"y","ю":"yu","я":"ya" };
    function translit(s) { var o = ""; for (var i = 0; i < s.length; i++) { var c = s.charAt(i); o += (TR[c] !== undefined) ? TR[c] : c; } return o; }

    var mask = []; for (var mi = 0; mi < text.length; mi++) { mask[mi] = false; }
    function mark(s, e) { for (var i = s; i < e && i < mask.length; i++) { mask[i] = true; } }
    function free(s, e) { for (var i = s; i < e && i < mask.length; i++) { if (mask[i]) { return false; } } return true; }

    /* ---- priority ---- */
    var i2 = text.indexOf("!!"), sp = findWord(lower, "спешно"), ur = findWord(lower, "urgent");
    if (i2 !== -1 || sp !== -1 || ur !== -1) {
      result.priority = 2; result.matched.push("priority");
      if (i2 !== -1) { mark(i2, i2 + 2); } if (sp !== -1) { mark(sp, sp + 6); } if (ur !== -1) { mark(ur, ur + 6); }
    } else {
      var vz = findWord(lower, "важно"), im = findWord(lower, "important"), i1 = text.indexOf("!");
      if (vz !== -1 || im !== -1 || i1 !== -1) {
        result.priority = 1; result.matched.push("priority");
        if (vz !== -1) { mark(vz, vz + 5); } if (im !== -1) { mark(im, im + 9); } if (i1 !== -1) { mark(i1, i1 + 1); }
      }
    }

    /* ---- assignee (with Latin synonyms) ---- */
    var SYN = { "яни": ["yani", "jani"], "кънчо": ["kancho", "kuncho"], "еви": ["evi", "evy"] };
    for (var pi = 0; pi < people.length && !result.assignee; pi++) {
      var person = people[pi]; if (!person) { continue; }
      var pl = String(person).toLowerCase(), forms = [pl].concat(SYN[pl] || []);
      for (var fi = 0; fi < forms.length; fi++) {
        var pp = findWord(lower, forms[fi]);
        if (pp !== -1) {
          var ps = pp; if (pp > 0 && text.charAt(pp - 1) === "@") { ps = pp - 1; }
          result.assignee = person; result.matched.push("assignee"); mark(ps, pp + forms[fi].length); break;
        }
      }
    }

    /* ---- client: multi-word aliases first, then single tokens ---- */
    (function () {
      var best = null;
      for (var ci = 0; ci < clients.length; ci++) {
        var cl = clients[ci]; if (!cl || !cl.name) { continue; }
        var names = [String(cl.name).toLowerCase()].concat((cl.aliases || []).map(function (a) { return String(a).toLowerCase(); }));
        for (var ni = 0; ni < names.length; ni++) {
          var nm = names[ni]; if (nm.length < 3) { continue; }
          var at = findWord(lower, nm), atHash = -1;
          if (at === -1) { atHash = lower.indexOf("#" + nm); if (atHash !== -1) { at = atHash + 1; } }
          if (at !== -1 && free(at, at + nm.length) && (best === null || nm.length > best.len)) { best = { id: cl.id || "", at: atHash !== -1 ? atHash : at, end: at + nm.length, len: nm.length }; }
        }
      }
      if (!best) {
        var tokRe = /#?[0-9A-Za-zА-яЁё]+/g, tm;
        while ((tm = tokRe.exec(text)) !== null && !best) {
          var raw = tm[0], hash = raw.charAt(0) === "#", w = (hash ? raw.substring(1) : raw).toLowerCase();
          if (w.length < 4 || /^[0-9]+$/.test(w) || !free(tm.index, tm.index + raw.length)) { continue; }
          var wt = translit(w);
          for (var cj = 0; cj < clients.length; cj++) {
            var c2 = clients[cj]; if (!c2 || !c2.name) { continue; }
            var cn = String(c2.name).toLowerCase(), ct = translit(cn), ok = false;
            if (cn.indexOf(w) === 0 || ct.indexOf(wt) === 0) { ok = true; }
            else if (w.length >= 5 && ct.length >= 5 && wt.substring(0, 5) === ct.substring(0, 5)) { ok = true; }
            if (!ok) { var als = c2.aliases || []; for (var ak = 0; ak < als.length; ak++) { if (String(als[ak]).toLowerCase().indexOf(w) === 0) { ok = true; break; } } }
            if (ok) { best = { id: c2.id || "", at: tm.index, end: tm.index + raw.length }; break; }
          }
        }
      }
      if (best) { result.client = best.id; result.matched.push("client"); mark(best.at, best.end); }
    })();

    /* ---- estimate ---- */
    var est = null;
    var tries = [
      [/час\s+и\s+половина/gi, 90], [/половин\s+час/gi, 30], [/half\s+an\s+hour/gi, 30], [/an\s+hour/gi, 60],
      [/(\d+(?:[.,]\d+)?)\s*ч(?:аса|ас)?/gi, "h"], [/(\d+(?:[.,]\d+)?)\s*h(?:ours?|rs?)?/gi, "h"],
      [/(\d+)\s*(минути|мин|м)/gi, "m"], [/(\d+)\s*(minutes|mins|min|m)/gi, "m"]
    ];
    for (var ti = 0; ti < tries.length && est === null; ti++) {
      var em = null;
      eachBoundary(tries[ti][0], text, function (m) { if (free(m.index, m.index + m[0].length)) { em = m; return true; } return false; });
      if (em) { var v = tries[ti][1]; est = (v === "h") ? Math.round(parseFloat(em[1].replace(",", ".")) * 60) : (v === "m" ? parseInt(em[1], 10) : v); mark(em.index, em.index + em[0].length); }
    }
    if (est !== null) { result.estimate = est; result.matched.push("estimate"); }

    /* ---- due: every candidate must sit on unmarked text ---- */
    if (hasToday) {
      var cands = [];
      function add(idx, end, iso) { if (idx !== -1 && idx != null && free(idx, end)) { cands.push({ index: idx, end: end, iso: iso }); } }
      var WORDS = [["днес", 0], ["today", 0], ["утре", 1], ["tomorrow", 1], ["вдругиден", 2]];
      for (var wi = 0; wi < WORDS.length; wi++) { var wp = findWord(lower, WORDS[wi][0]); if (wp !== -1) { add(wp, wp + WORDS[wi][0].length, addDays(todayISO, WORDS[wi][1])); } }
      var dat = execBoundary(/day\s+after\s+tomorrow/gi, text); if (dat) { add(dat.index, dat.index + dat[0].length, addDays(todayISO, 2)); }
      var nw = execBoundary(/(следващ[а-я]*\s+седмиц[а-я]*|next\s+week)/gi, text); if (nw) { add(nw.index, nw.index + nw[0].length, addDays(todayISO, 7)); }
      var WD = { "неделя":0,"sunday":0,"sun":0, "понеделник":1,"monday":1,"mon":1, "вторник":2,"tuesday":2,"tue":2,"tues":2,
                 "сряда":3,"wednesday":3,"wed":3, "четвъртък":4,"thursday":4,"thu":4,"thur":4,"thurs":4,
                 "петък":5,"friday":5,"fri":5, "събота":6,"saturday":6,"sat":6 };
      for (var k in WD) {
        if (!WD.hasOwnProperty(k)) { continue; }
        var kp = findWord(lower, k);
        if (kp === -1) { continue; }
        var pre = lower.slice(Math.max(0, kp - 10), kp), strict = /(следващ[а-я]*|next)\s+$/.test(pre);
        var start = strict ? kp - pre.match(/(следващ[а-я]*|next)\s+$/)[0].length : kp;
        if (/^(в|във|on|this)\s+$/.test(lower.slice(Math.max(0, start - 5), start))) { start -= lower.slice(Math.max(0, start - 5), start).match(/(в|във|on|this)\s+$/)[0].length; }
        add(start, kp + k.length, nextWeekday(todayISO, WD[k], strict));
      }
      var ad = execBoundary(/(?:след|in)\s+(\d+)\s+(дни|дена|ден|days?)/gi, text); if (ad) { add(ad.index, ad.index + ad[0].length, addDays(todayISO, parseInt(ad[1], 10))); }
      var aw = execBoundary(/(?:след|in)\s+(\d+)\s+(седмиц[а-я]*|weeks?)/gi, text); if (aw) { add(aw.index, aw.index + aw[0].length, addDays(todayISO, 7 * parseInt(aw[1], 10))); }
      var a1 = execBoundary(/(след\s+седмица|in\s+a\s+week)/gi, text); if (a1) { add(a1.index, a1.index + a1[0].length, addDays(todayISO, 7)); }
      var od = execBoundary(/(до|на|by\s+the|on\s+the|by|on)\s+(\d{1,2})(?:-?[а-я]{1,3}|st|nd|rd|th)/gi, text);
      if (od) { var oday = parseInt(od[2], 10); if (oday >= 1 && oday <= 31) { var tp = parseISO(todayISO); add(od.index, od.index + od[0].length, ensureFuture(tp.y, tp.m, oday, todayISO, "month")); } }
      eachBoundary(/(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{4}))?/g, text, function (ed) {
        if (!free(ed.index, ed.index + ed[0].length)) { return false; }
        var eD = parseInt(ed[1], 10), eM = parseInt(ed[2], 10);
        if (eD >= 1 && eD <= 31 && eM >= 1 && eM <= 12) { add(ed.index, ed.index + ed[0].length, ed[3] ? toISO(parseInt(ed[3], 10), eM, eD) : ensureFuture(parseISO(todayISO).y, eM, eD, todayISO, "year")); return true; }
        return false;
      });
      var MONTHS = [["януари","ян","january","jan"],["февруари","фев","february","feb"],["март","мар","march","mar"],["април","апр","april","apr"],
        ["май","may"],["юни","june","jun"],["юли","july","jul"],["август","авг","august","aug"],["септември","сеп","септ","september","sep","sept"],
        ["октомври","окт","october","oct"],["ноември","ное","ноем","november","nov"],["декември","дек","december","dec"]];
      function monthOf(w) { var wl = w.toLowerCase(); for (var m = 0; m < 12; m++) { for (var n = 0; n < MONTHS[m].length; n++) { if (wl === MONTHS[m][n]) { return m + 1; } } } return null; }
      eachBoundary(/(\d{1,2})\s+([A-Za-zА-яЁё]+)\.?/g, text, function (dm) {
        var mn = monthOf(dm[2]), dD = parseInt(dm[1], 10);
        if (mn && dD >= 1 && dD <= 31 && free(dm.index, dm.index + dm[0].length)) { add(dm.index, dm.index + dm[0].length, ensureFuture(parseISO(todayISO).y, mn, dD, todayISO, "year")); return true; }
        return false;
      });
      eachBoundary(/([A-Za-zА-яЁё]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?/g, text, function (md) {
        var mn2 = monthOf(md[1]), dD2 = parseInt(md[2], 10);
        if (mn2 && dD2 >= 1 && dD2 <= 31 && free(md.index, md.index + md[0].length)) { add(md.index, md.index + md[0].length, ensureFuture(parseISO(todayISO).y, mn2, dD2, todayISO, "year")); return true; }
        return false;
      });
      if (cands.length) {
        cands.sort(function (a, b) { return a.index - b.index; });
        result.due = cands[0].iso; result.matched.push("due");
        for (var c2i = 0; c2i < cands.length; c2i++) { mark(cands[c2i].index, cands[c2i].end); }
      }
    }

    /* ---- title ---- */
    var out = "";
    for (var t2 = 0; t2 < text.length; t2++) { if (!mask[t2]) { out += text.charAt(t2); } }
    out = out.replace(/\s+/g, " ").replace(/^[\s,.:;\-–]+|[\s,.:;\-–]+$/g, "");
    var PREP = /^(в|във|на|за|до|с|със|при|и|in|on|for|to|at|by|with|and|the)\s+/i, PREP_END = /\s+(в|във|на|за|до|с|със|при|и|in|on|for|to|at|by|with|and|the)$/i;
    for (var g = 0; g < 3; g++) { out = out.replace(PREP, "").replace(PREP_END, ""); }
    out = out.replace(/\s+([,.:;])/g, "$1").replace(/^[\s,.:;\-–]+|[\s,.:;\-–]+$/g, "");
    result.title = out.length ? out : text.replace(/^\s+|\s+$/g, "");
    return result;
  } catch (e) {
    return { title: (typeof text === "string") ? text : "", assignee: "", client: "", due: null, estimate: null, priority: 0, matched: [] };
  }
}

function testParseQuickAdd() {
  var ctx = { people: ["Яни", "Кънчо", "Еви"], clients: [{ id: "patricia", name: "Патриция", aliases: ["patricia"] }, { id: "bioshop", name: "Биошоп", aliases: ["bioshop"] }, { id: "marche", name: "Марше", aliases: ["marche"] }, { id: "mitevi", name: "Митеви Минералс", aliases: ["mitevi"] }, { id: "horizont", name: "Horizont", aliases: [] }], today: "2026-09-13" };
  var cases = ["утре Кънчо Патриция отчет 30м", "до 5-о разходния лист !", "в петък @Еви карусел за Марше 2ч", "спешно провери румъния",
    "след 2 седмици нови креативи за биошоп", "tomorrow Kancho Patricia report 30m", "by the 5th expense sheet !", "fri @Evi carousel for Marche 2h",
    "urgent check romania", "in 2 weeks new creatives for bioshop", "oct 15 launch email", "15/10 brief", "next week budget review 1.5h", "important call Yani today",
    "next mon Evi Mitevi 3 reels 2h", "Патриция имейл до 1-ви !!", "call the client about the invoice", "Kancho check Slovenia budget tomorrow 15m", "Horizont menus by the 3rd",
    "budget review 1.5 h", "пет реела за Биошоп", "3 reels 2 oct", "до 31-ви отчет", "Митеви Минералс нов клип"];
  var lines = [];
  for (var i = 0; i < cases.length; i++) { lines.push(JSON.stringify(cases[i]) + " => " + JSON.stringify(parseQuickAdd(cases[i], ctx))); }
  return lines;
}
