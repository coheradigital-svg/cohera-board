function monthLabel(year, monthIndex) {
  var MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var y = parseInt(year, 10);
  var m = parseInt(monthIndex, 10);
  if (isNaN(y)) { y = 1970; }
  if (isNaN(m) || m < 0 || m > 11) { m = 0; }
  return MONTH_NAMES[m] + " " + y;
}

function renderMonth(year, monthIndex, tasks, opts) {
  var DOW_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  function escapeHtml(str) {
    if (str === null || typeof str === "undefined") { return ""; }
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function pad2(n) { n = String(n); return n.length < 2 ? "0" + n : n; }
  function isValidDateStr(s) {
    if (typeof s !== "string") { return false; }
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) { return false; }
    var y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
    if (mo < 1 || mo > 12) { return false; }
    var dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  }
  function dateStr(y, m, d) {
    var dt = new Date(Date.UTC(y, m, d));
    return dt.getUTCFullYear() + "-" + pad2(dt.getUTCMonth() + 1) + "-" + pad2(dt.getUTCDate());
  }
  function truncate(str, maxLen) {
    str = String(str);
    return str.length <= maxLen ? str : str.slice(0, maxLen) + "…";
  }

  var y = parseInt(year, 10); if (isNaN(y)) { y = 1970; }
  var mIdx = parseInt(monthIndex, 10); if (isNaN(mIdx) || mIdx < 0 || mIdx > 11) { mIdx = 0; }
  if (Object.prototype.toString.call(tasks) !== "[object Array]") { tasks = []; }
  if (!opts || typeof opts !== "object") { opts = {}; }
  var today = isValidDateStr(opts.today) ? opts.today : null;
  var selected = isValidDateStr(opts.selected) ? opts.selected : null;
  var maxPills = parseInt(opts.maxPills, 10); if (isNaN(maxPills) || maxPills < 0) { maxPills = 3; }

  var tasksByDate = {}, i;
  for (i = 0; i < tasks.length; i++) {
    var t = tasks[i];
    if (!t || typeof t !== "object" || !isValidDateStr(t.due)) { continue; }
    (tasksByDate[t.due] = tasksByDate[t.due] || []).push(t);
  }
  function sortTasks(list) {
    var arr = list.slice();
    arr.sort(function (a, b) {
      var pa = (typeof a.priority === "number") ? a.priority : 0;
      var pb = (typeof b.priority === "number") ? b.priority : 0;
      if (pa !== pb) { return pb - pa; }
      var ta = (typeof a.title === "string") ? a.title : "", tb = (typeof b.title === "string") ? b.title : "";
      return ta < tb ? -1 : (ta > tb ? 1 : 0);
    });
    return arr;
  }

  var firstWeekday = new Date(Date.UTC(y, mIdx, 1)).getUTCDay();
  var offset = (firstWeekday === 0) ? 6 : (firstWeekday - 1);
  var startDate = new Date(Date.UTC(y, mIdx, 1 - offset));

  var html = '<div class="cal"><div class="cal-toolbar">' +
    '<button type="button" class="cal-nav" data-act="cal-prev" aria-label="Previous month">‹</button>' +
    '<div class="cal-title">' + escapeHtml(monthLabel(y, mIdx)) + '</div>' +
    '<button type="button" class="cal-nav" data-act="cal-next" aria-label="Next month">›</button>' +
    '<button type="button" class="cal-nav cal-today" data-act="cal-today">Today</button></div>' +
    '<div class="cal-dow">';
  for (i = 0; i < 7; i++) { html += '<span>' + DOW_NAMES[i] + '</span>'; }
  html += '</div><div class="cal-grid">';

  for (i = 0; i < 42; i++) {
    var cellDate = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate() + i));
    var cy = cellDate.getUTCFullYear(), cm = cellDate.getUTCMonth(), cd = cellDate.getUTCDate(), cDow = cellDate.getUTCDay();
    var cDateStr = dateStr(cy, cm, cd);
    var classes = ["cal-day"];
    if (cm !== mIdx || cy !== y) { classes.push("out"); }
    if (today !== null && cDateStr === today) { classes.push("today"); }
    if (cDow === 0 || cDow === 6) { classes.push("weekend"); }
    if (selected !== null && cDateStr === selected) { classes.push("selected"); }
    html += '<div class="' + classes.join(" ") + '" data-date="' + escapeHtml(cDateStr) + '">' +
      '<div class="cal-date">' + cd + '</div><div class="cal-pills">';
    var dayTasks = tasksByDate[cDateStr] ? sortTasks(tasksByDate[cDateStr]) : [];
    var shown = dayTasks.slice(0, maxPills), remaining = dayTasks.length - shown.length, j;
    for (j = 0; j < shown.length; j++) {
      var pt = shown[j], pillClasses = ["cal-pill"];
      var priority = (typeof pt.priority === "number") ? pt.priority : 0;
      if (priority === 1) { pillClasses.push("p1"); }
      if (priority === 2) { pillClasses.push("p2"); }
      if (pt.status === "done") { pillClasses.push("done"); }
      if (pt.status === "doing") { pillClasses.push("doing"); }
      if (pt.status !== "done" && today !== null && pt.due < today) { pillClasses.push("late"); }
      var titleStr = (typeof pt.title === "string") ? pt.title : "";
      var idStr = (pt.id !== undefined && pt.id !== null) ? String(pt.id) : "";
      html += '<button type="button" class="' + pillClasses.join(" ") + '" data-act="open" data-id="' +
        escapeHtml(idStr) + '" title="' + escapeHtml(titleStr) + '">' + escapeHtml(truncate(titleStr, 28)) + '</button>';
    }
    if (remaining > 0) { html += '<div class="cal-more">+' + remaining + ' more</div>'; }
    html += '</div></div>';
  }
  return html + '</div></div>';
}
