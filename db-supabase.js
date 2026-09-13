/* Data layer for the hosted board. Same API the app already uses:
   db.doc("tasks/id").set(obj) / .update(patch) / .delete()
   db.collection("tasks").onSnapshot(fn)  ->  fn({docs:[{id, data:()=>obj}]})
   Backed by Supabase (one table per collection, one jsonb document per row) with realtime.
   Sign-in is a magic link by email; only addresses in allowed_emails get through (see schema.sql). */
(function () {
  "use strict";
  var cfg = window.BOARD_CONFIG || {};
  var caches = {}, listeners = {}, client = null;

  function need() {
    if (!window.supabase || !cfg.url || !cfg.anonKey) return null;
    if (!client) client = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
    return client;
  }
  function snapshot(table) {
    var rows = caches[table] || {};
    var docs = Object.keys(rows).map(function (id) { var d = rows[id]; return { id: id, data: function () { return d; } }; });
    (listeners[table] || []).forEach(function (fn) { try { fn({ docs: docs }); } catch (e) { console.error(e); } });
  }
  function load(table) {
    return need().from(table).select("id,data").then(function (r) {
      if (r.error) throw r.error;
      caches[table] = {}; r.data.forEach(function (row) { caches[table][row.id] = row.data; });
      snapshot(table);
    });
  }
  function subscribe(table) {
    need().channel("rt:" + table).on("postgres_changes", { event: "*", schema: "public", table: table }, function (p) {
      caches[table] = caches[table] || {};
      if (p.eventType === "DELETE") delete caches[table][p.old.id];
      else caches[table][p.new.id] = p.new.data;
      snapshot(table);
    }).subscribe();
  }

  var api = {
    doc: function (path) {
      var i = path.indexOf("/"), table = path.slice(0, i), id = path.slice(i + 1);
      return {
        set: function (obj) { caches[table] = caches[table] || {}; caches[table][id] = obj; return need().from(table).upsert({ id: id, data: obj }).then(function (r) { if (r.error) throw r.error; }); },
        update: function (patch) {
          var cur = (caches[table] && caches[table][id]) || {}, merged = Object.assign({}, cur, patch);
          caches[table] = caches[table] || {}; caches[table][id] = merged;
          return need().from(table).upsert({ id: id, data: merged }).then(function (r) { if (r.error) throw r.error; });
        },
        delete: function () { if (caches[table]) delete caches[table][id]; return need().from(table).delete().eq("id", id).then(function (r) { if (r.error) throw r.error; }); }
      };
    },
    collection: function (table) {
      return {
        onSnapshot: function (fn) {
          (listeners[table] = listeners[table] || []).push(fn);
          if (!caches[table]) { load(table).then(function () { subscribe(table); }).catch(function (e) { console.error(e); fn({ docs: [] }); }); }
          else snapshot(table);
          return function () { listeners[table] = (listeners[table] || []).filter(function (x) { return x !== fn; }); };
        }
      };
    }
  };

  /* ---------- sign-in ---------- */
  function loginUI(resolve) {
    var el = document.getElementById("login");
    if (!el) { resolve(null); return; }
    el.hidden = false;
    var form = el.querySelector("form"), input = el.querySelector("input[type=email]"), msg = el.querySelector(".msg");
    try { var last = localStorage.getItem("cohera.email"); if (last && !input.value) input.value = last; } catch (e) { }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = input.value.trim(); if (!email) return;
      msg.textContent = "Sending the link…";
      need().auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.origin + location.pathname } }).then(function (r) {
        if (r.error) { msg.textContent = r.error.message; return; }
        try { localStorage.setItem("cohera.email", email); } catch (e2) { }
        msg.textContent = "Check " + email + ". The link signs you in on this device.";
      });
    });
    need().auth.onAuthStateChange(function (ev, session) { if (session) { el.hidden = true; resolve(api); } });
  }

  window.getBoardDb = function () {
    return new Promise(function (resolve) {
      var c = need();
      if (!c) { resolve(null); return; }
      c.auth.getSession().then(function (r) {
        if (r.data && r.data.session) { resolve(api); }
        else loginUI(resolve);
      }).catch(function () { loginUI(resolve); });
    });
  };
  window.boardSignOut = function () { if (client) client.auth.signOut().then(function () { location.reload(); }); };
})();
