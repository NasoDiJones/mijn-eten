// Mijn Eten – login + synchronisatie met Supabase (zelfde project als Mijn Geld, eigen eten_-tabellen).
// Ieder account heeft eigen gegevens (RLS op auth.uid()). Record-niveau sync: lokale wijzigingen gaan
// via een wachtrij naar de server; nieuwere server-records worden opgehaald op basis van updated_at.
(function () {
  'use strict';
  var SUPABASE_URL = 'https://zsqxzyqpyvnnwigwrsoa.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_WocraeDzyG44zL01tOU02A_DyT1P9n3'; // publieke client-sleutel (anon), geen geheim
  var META_KEY = 'mijnEten.sync';
  var APP_URL = 'https://nasodijones.github.io/mijn-eten/';
  var EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  var PAGE = 1000, OVERLAP_MS = 120000;

  var ME = window.ME;
  var client = null, user = null, status = '', busy = false, again = false, timer = null, recovering = false, warnedMissing = false, recShown = false;
  var meta = readMeta();

  function $(id) { return document.getElementById(id); }
  function readMeta() { try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch (e) { return {}; } }
  function writeMeta() { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) {} }
  function online() { return navigator.onLine !== false; }
  function toast(m) { if (ME && ME.toast) ME.toast(m); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function isoMs(iso) { return Date.parse(String(iso).replace(/(\.\d{3})\d+/, '$1')); }

  function setStatus(s) { status = s; paintStatus(); }
  function paintStatus() {
    var els = document.querySelectorAll('.sync-pill'); if (!els.length) return;
    var n = ME.pendingCount();
    var text = !user ? '' : ({ ok: '✓ gesynchroniseerd', offline: 'offline' + (n ? ' · ' + n + ' wacht' : ''), busy: 'synchroniseren…', error: '⚠︎ sync-fout' })[status] || '';
    for (var i = 0; i < els.length; i++) els[i].textContent = text;
  }
  function isMissing(e) { var m = ((e && e.code) || '') + ' ' + ((e && e.message) || ''); return /PGRST20[25]|42P01|42883|could not find|does not exist|schema cache/i.test(m); }
  function fail(e) {
    console.warn('Sync', e);
    setStatus(online() ? 'error' : 'offline');
    if (isMissing(e) && !warnedMissing) { warnedMissing = true; toast('Synchronisatie is nog niet ingesteld in Supabase (SQL-script).'); }
  }

  // ---- Synchroniseren ----
  async function push() {
    var pending = ME.pending();
    var tables = Object.keys(pending);
    for (var t = 0; t < tables.length; t++) {
      var table = tables[t]; if (!ME.tables[table]) continue;
      var ids = Object.keys(pending[table] || {});
      for (var i = 0; i < ids.length; i += 200) {
        var rows = [], stamps = {};
        ids.slice(i, i + 200).forEach(function (id) {
          var rec = ME.record(table, id);
          if (!rec) { ME.dropPending(table, id); return; }
          stamps[id] = pending[table][id];
          rows.push({ user_id: user.id, id: id, data: rec.deleted ? {} : rec.data, deleted: rec.deleted });
        });
        if (!rows.length) continue;
        var r = await client.from(table).upsert(rows, { onConflict: 'user_id,id' });
        if (r.error) throw r.error;
        rows.forEach(function (row) { ME.clearPending(table, row.id, stamps[row.id]); });
      }
    }
  }
  // full = alles opnieuw ophalen (na terugzetten van een back-up); lokale records die niet
  // (meer) op de server staan, worden dan ook lokaal verwijderd.
  async function pull(full) {
    var changed = false;
    meta.since = meta.since || {};
    var tables = Object.keys(ME.tables);
    for (var t = 0; t < tables.length; t++) {
      var table = tables[t], since = full ? null : meta.since[table], max = since || '', from = 0, seen = {};
      for (;;) {
        var q = client.from(table).select('id,data,deleted,updated_at').eq('user_id', user.id).order('updated_at', { ascending: true }).order('id', { ascending: true }).range(from, from + PAGE - 1);
        if (since) q = q.gt('updated_at', new Date(isoMs(since) - OVERLAP_MS).toISOString());
        var r = await q;
        if (r.error) throw r.error;
        var rows = r.data || [];
        rows.forEach(function (row) {
          seen[row.id] = true;
          if (!max || isoMs(row.updated_at) > isoMs(max)) max = row.updated_at;
          if (ME.isPending(table, row.id)) return; // lokale wijziging gaat voor en wordt zo geüpload
          if (ME.applyRemote(table, row.id, row.data || {}, !!row.deleted)) changed = true;
        });
        if (rows.length < PAGE) break;
        from += PAGE;
      }
      if (max) meta.since[table] = max;
      if (full) {
        var local = (ME.state() || {})[ME.tables[table]] || {};
        Object.keys(local).forEach(function (id) {
          if (!seen[id] && !ME.isPending(table, id) && ME.applyRemote(table, id, {}, true)) changed = true;
        });
      }
    }
    writeMeta();
    if (changed) ME.commitRemote();
    return changed;
  }
  async function syncNow(manual) {
    if (!client || !user) return;
    if (busy) { again = true; return; }
    if (!online()) { setStatus('offline'); if (manual) toast('Je bent offline; wijzigingen worden later gesynchroniseerd'); return; }
    busy = true; setStatus('busy');
    try { await push(); await pull(!!meta.needFull); if (meta.needFull) { delete meta.needFull; writeMeta(); } setStatus('ok'); if (manual) toast('Gesynchroniseerd ✓'); }
    catch (e) { fail(e); if (manual) toast('Synchroniseren mislukt'); }
    finally { busy = false; if (again) { again = false; setTimeout(syncNow, 50); } }
  }
  function changed() {
    paintStatus();
    if (!user) return;
    clearTimeout(timer);
    timer = setTimeout(function () { syncNow(); }, 1200);
  }

  // ---- Cloud back-ups (elke nacht door Supabase gemaakt; zie mijn-eten-backups.sql) ----
  var DAYS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
  var MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  var BK_SHOW = 5, BK_TTL = 30000;
  var bk = { uid: null, list: null, error: null, at: 0, loading: null, all: false, restoring: false };
  function fmtBackup(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    var p = {};
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
    } catch (e) { p = { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes() }; }
    var wd = new Date(Date.UTC(+p.year, +p.month - 1, +p.day)).getUTCDay();
    return DAYS[wd] + ' ' + (+p.day) + ' ' + MONTHS[+p.month - 1] + ' ' + ('0' + (+p.hour % 24)).slice(-2) + ':' + ('0' + (+p.minute)).slice(-2);
  }
  function fmtSize(b) { b = +b || 0; return b < 1024 ? b + ' B' : (b / 1024).toFixed(b < 10240 ? 1 : 0).replace('.', ',') + ' KB'; }
  function bkFor() { if (!user || bk.uid !== user.id) bk = { uid: user ? user.id : null, list: null, error: null, at: 0, loading: null, all: false, restoring: false }; return bk; }
  function backupsHtml() {
    var b = bkFor(), body;
    var head = '<div class="card-title"><h3>Back-ups</h3>' + (b.list && b.list.length ? '<span class="tiny muted">' + b.list.length + ' bewaard</span>' : '') + '</div>';
    if (b.error === 'missing') {
      return head + '<p class="small muted" id="backup-last" style="margin:0">Back-ups zijn nog niet ingesteld.</p>' +
        '<div class="note" id="backup-note">Voer eerst het SQL-script <b>mijn-eten-backups.sql</b> uit in Supabase; daarna wordt er elke nacht automatisch een kopie gemaakt.</div>';
    }
    var last = b.list ? (b.list.length ? 'Laatste back-up: ' + fmtBackup(b.list[0].created_at) : 'Laatste back-up: nog geen')
      : b.error ? (online() ? 'Laatste back-up: onbekend' : 'Laatste back-up: onbekend (offline)') : 'Laatste back-up: laden…';
    body = '<div class="small" id="backup-last"><b>' + esc(last) + '</b></div>' +
      '<p class="tiny muted" style="margin:4px 0 0">Elke nacht rond 03:00 wordt automatisch een kopie van je gegevens gemaakt (alleen als er iets veranderd is). Kopieën blijven 30 dagen bewaard.</p>';
    if (b.list && b.list.length) {
      var shown = b.all ? b.list : b.list.slice(0, BK_SHOW);
      body += '<div id="backups-list" class="mt">' + shown.map(function (x) {
        return '<div class="list-item bk-item" style="cursor:default" data-backup-id="' + esc(x.id) + '"><div class="grow"><div class="li-name">' + esc(fmtBackup(x.created_at)) + '</div>' +
          '<div class="li-sub tiny muted">' + (x.items != null ? esc(x.items) + ' items · ' : '') + esc(fmtSize(x.size)) + '</div></div>' +
          '<button class="btn sm" data-action="backup-restore" data-id="' + esc(x.id) + '"' + (b.restoring ? ' disabled' : '') + '>Terugzetten</button></div>';
      }).join('') + '</div>';
      if (b.list.length > BK_SHOW) body += '<button class="link small" data-action="backups-toggle">' + (b.all ? 'Minder tonen' : 'Alle ' + b.list.length + ' back-ups tonen') + '</button>';
    } else if (b.list) {
      body += '<p class="tiny muted" id="backups-empty" style="margin:8px 0 0">Nog geen back-ups. De eerste wordt vannacht gemaakt.</p>';
    }
    return head + body;
  }
  function paintBackups() { var el = $('backups-card'); if (el) el.innerHTML = backupsHtml(); }
  function bkError(e) { return isMissing(e) || /eten_list_backups|eten_restore_backup/i.test((e && e.message) || '') && /function|not find/i.test((e && e.message) || '') ? 'missing' : 'error'; }
  async function loadBackups(force) {
    if (!client || !user) return null;
    var b = bkFor();
    if (!force && b.list && Date.now() - b.at < BK_TTL) return b.list;
    if (b.loading) return b.loading;
    if (!online()) { if (!b.list) b.error = 'offline'; paintBackups(); return b.list; }
    b.loading = (async function () {
      try {
        var r = await client.rpc('eten_list_backups');
        if (r.error) throw r.error;
        if (bk !== b) return null;
        b.list = r.data || []; b.error = null; b.at = Date.now();
      } catch (e) {
        if (bk !== b) return null;
        console.warn('Back-ups', e); b.error = bkError(e); if (b.error === 'missing') b.list = null;
      } finally { b.loading = null; }
      paintBackups();
      return b.list;
    })();
    return b.loading;
  }
  function refreshBackups(force) { loadBackups(force); }
  async function restoreBackup(id) {
    if (!client || !user) return;
    var b = bkFor(); if (b.restoring) return;
    var x = (b.list || []).filter(function (y) { return String(y.id) === String(id); })[0]; if (!x) return;
    if (!confirm('Back-up van ' + fmtBackup(x.created_at) + ' terugzetten?\n\nAl je huidige Mijn Eten-gegevens (dagboek, producten, water, gewicht en profiel) worden vervangen door deze back-up. Er wordt eerst een kopie van de huidige stand gemaakt.')) return;
    if (!online()) { alert('Je bent offline. Terugzetten kan alleen met internet.'); return; }
    // Wacht tot een lopende synchronisatie klaar is
    for (var i = 0; busy && i < 100; i++) await new Promise(function (r) { setTimeout(r, 100); });
    if (busy) { alert('Even geduld, er wordt nog gesynchroniseerd. Probeer het zo opnieuw.'); return; }
    busy = true; clearTimeout(timer); b.restoring = true; paintBackups(); setStatus('busy');
    var step = 'push';
    try {
      // 1. Eerst openstaande wijzigingen uploaden, zodat de veiligheidskopie alles bevat
      await push();
      if (ME.pendingCount()) throw new Error('Niet alle wijzigingen konden worden geüpload');
      // 2. Terugzetten op de server (één transactie, met veiligheidskopie)
      step = 'restore';
      var r = await client.rpc('eten_restore_backup', { backup_id: Number(id) });
      if (r.error) throw r.error;
      // 3. Alles opnieuw ophalen
      step = 'pull';
      await pull(true);
      ME.commitRemote();
      setStatus('ok');
      toast('Back-up teruggezet ✓');
    } catch (e) {
      console.warn('Terugzetten', e);
      setStatus(online() ? 'error' : 'offline');
      if (step === 'push') alert('Terugzetten is niet gestart: je laatste wijzigingen konden niet eerst worden opgeslagen. Controleer je internet en probeer het opnieuw.');
      else if (step === 'restore') alert(bkError(e) === 'missing' ? 'Back-ups zijn nog niet ingesteld in Supabase.' : 'Terugzetten mislukt: ' + nlError(e) + '\n\nEr is niets veranderd.');
      else alert('De back-up is teruggezet, maar ophalen lukte nog niet. De app probeert het automatisch opnieuw.');
      if (step === 'pull') { meta.needFull = true; writeMeta(); }
    } finally {
      busy = false; b.restoring = false;
      if (again) { again = false; setTimeout(syncNow, 50); }
      loadBackups(true); paintBackups();
    }
  }

  var loginBusy = false;
  async function afterLogin(u) {
    if (loginBusy) return; loginBusy = true;
    try {
      if (meta.userId && meta.userId !== u.id) {
        // Ander account dan de vorige keer op dit toestel: lokale gegevens horen niet bij dit account.
        ME.wipe(); meta = { userId: u.id, since: {} }; writeMeta();
      } else if (!meta.userId) {
        // Gegevens die zonder account zijn ingevoerd, gaan mee naar dit account.
        meta = { userId: u.id, since: {} }; writeMeta();
        if (ME.isPending('eten_profiles', 'me') && online()) {
          try {
            var r = await client.from('eten_profiles').select('id,deleted').eq('user_id', u.id).eq('id', 'me').maybeSingle();
            if (!r.error && r.data && !r.data.deleted) ME.dropPending('eten_profiles', 'me'); // bestaand profiel in de cloud gaat voor
          } catch (e) {}
        }
      }
      await syncNow();
    } finally { loginBusy = false; ME.route(); paintStatus(); }
  }

  // ---- Inloggen (sheet) ----
  function redirectUrl() { return /nasodijones\.github\.io/.test(location.host) ? APP_URL : location.origin + location.pathname; }
  function nlError(e) {
    var m = ((e && (e.code || '')) + ' ' + (e && e.message || '')).toLowerCase(), st = e && e.status;
    if (/email.?not.?confirmed/.test(m)) return 'Je e-mail is nog niet bevestigd. Klik eerst op de link in de bevestigingsmail.';
    if (/invalid.?(login.?)?credentials|invalid_grant/.test(m)) return 'E-mailadres of wachtwoord klopt niet.';
    if (st === 429 || /rate.?limit|too many|over_email_send|security purposes/.test(m)) return 'Te veel pogingen. Wacht een paar minuten en probeer het opnieuw.';
    if (/already.?registered|user_already_exists|already exists/.test(m)) return 'Er bestaat al een account met dit e-mailadres. Log in of kies "Wachtwoord vergeten".';
    if (/weak|password should|at least/.test(m)) return 'Wachtwoord is te zwak. Gebruik minimaal 8 tekens.';
    if (/same.?password|different from the old/.test(m)) return 'Kies een ander wachtwoord dan je oude.';
    if (/fetch|network/.test(m)) return 'Geen verbinding. Controleer je internet.';
    return 'Er ging iets mis: ' + (e && e.message || 'onbekende fout');
  }
  function msg(text, kind) {
    var el = $('auth-msg'); if (!el) { if (text) alert(text); return; }
    el.textContent = text || ''; el.className = 'small ' + (kind === 'ok' ? '' : 'auth-err'); el.style.color = kind === 'ok' ? 'var(--brand)' : 'var(--danger)';
    el.classList.toggle('hidden', !text);
  }
  function openAuth() {
    if (!client) { toast('Inloggen is nu niet beschikbaar (offline?)'); return; }
    ME.openSheet(ME.sheetHead('Inloggen') +
      '<p class="small muted" style="margin-top:0">Log in met je e-mailadres. Nog geen account? Vul je e-mail en een wachtwoord in en kies <b>Account maken</b>. Werkt ook met hetzelfde account als Mijn Geld.</p>' +
      '<form data-form="auth" autocomplete="on">' +
      '<label class="field"><span>E-mailadres</span><input id="auth-email" type="email" autocomplete="username" inputmode="email" autocapitalize="off" placeholder="naam@voorbeeld.nl"></label>' +
      '<label class="field"><span>Wachtwoord</span><div class="row"><input id="auth-password" type="password" autocomplete="current-password" placeholder="minimaal 8 tekens"><button type="button" class="icon-btn" data-action="auth-eye" aria-label="Toon wachtwoord">👁️</button></div></label>' +
      '<p id="auth-msg" class="small hidden"></p>' +
      '<button class="btn primary block" type="submit">Inloggen</button></form>' +
      '<button class="btn block" data-action="auth-signup">Account maken</button>' +
      '<button class="btn ghost block" data-action="auth-forgot">Wachtwoord vergeten</button>', { focus: 'auth-email' });
  }
  function openRecovery() {
    ME.openSheet(ME.sheetHead('Nieuw wachtwoord') + '<form data-form="newpw"><label class="field"><span>Nieuw wachtwoord</span><input id="auth-newpw" type="password" autocomplete="new-password" placeholder="minimaal 8 tekens"></label>' +
      '<p id="auth-msg" class="small hidden"></p><button class="btn primary block" type="submit">Opslaan</button></form>', { focus: 'auth-newpw' });
  }
  function creds(needPw) {
    var email = ($('auth-email').value || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) { msg('Vul een geldig e-mailadres in.'); return null; }
    var pw = $('auth-password').value || '';
    if (needPw && pw.length < 8) { msg('Wachtwoord moet minimaal 8 tekens zijn.'); return null; }
    return { email: email, password: pw };
  }
  async function login() {
    var c = creds(true); if (!c) return; msg('');
    var r = await client.auth.signInWithPassword({ email: c.email, password: c.password });
    if (r.error) { msg(nlError(r.error)); return; }
    ME.closeSheet(); toast('Ingelogd ✓');
  }
  async function signup() {
    var c = creds(true); if (!c) return; msg('');
    var r = await client.auth.signUp({ email: c.email, password: c.password, options: { emailRedirectTo: redirectUrl() } });
    if (r.error) { msg(nlError(r.error)); return; }
    var d = r.data || {};
    if (d.user && Array.isArray(d.user.identities) && d.user.identities.length === 0) { msg('Er bestaat al een account met dit e-mailadres. Log in of kies "Wachtwoord vergeten".'); return; }
    if (d.session) { ME.closeSheet(); toast('Account aangemaakt ✓'); return; }
    msg('Bevestig je e-mail via de link in je mail en log daarna hier in met je wachtwoord.', 'ok');
  }
  async function forgot() {
    var c = creds(false); if (!c) return; msg('');
    var r = await client.auth.resetPasswordForEmail(c.email, { redirectTo: redirectUrl() });
    if (r.error) { msg(nlError(r.error)); return; }
    msg('Als dit e-mailadres een account heeft, staat er een link in je mail. Open die en kies een nieuw wachtwoord.', 'ok');
  }
  async function setNewPassword() {
    var pw = $('auth-newpw').value || '';
    if (pw.length < 8) { msg('Wachtwoord moet minimaal 8 tekens zijn.'); return; }
    var r = await client.auth.updateUser({ password: pw });
    if (r.error) { msg(nlError(r.error)); return; }
    recovering = false; ME.closeSheet(); toast('Nieuw wachtwoord opgeslagen ✓');
  }
  async function logout() {
    if (!client || !user) return;
    if (!confirm('Uitloggen? Je gegevens worden van dit toestel gehaald; ze staan veilig in je account.')) return;
    if (ME.pendingCount()) await syncNow();
    var n = ME.pendingCount();
    if (n && !confirm('Er zijn nog ' + n + ' wijziging(en) niet gesynchroniseerd (offline?). Toch uitloggen? Die wijzigingen gaan dan verloren.')) return;
    try { await client.auth.signOut(); } catch (e) {}
    user = null; meta = {}; writeMeta(); ME.wipe(); ME.route(); toast('Uitgelogd');
  }

  window.meSync = {
    user: function () { return user; },
    status: function () { return status; },
    meta: function () { return meta; },
    syncNow: syncNow,
    changed: changed,
    paintStatus: paintStatus,
    backupsHtml: backupsHtml,
    refreshBackups: refreshBackups,
    restoreBackup: restoreBackup,
    openAuth: openAuth,
    logout: logout,
    actions: {
      'backup-restore': function (btn) { restoreBackup(btn.getAttribute('data-id')); },
      'backups-toggle': function () { var b = bkFor(); b.all = !b.all; paintBackups(); },
      'auth-signup': function () { signup(); },
      'auth-forgot': function () { forgot(); },
      'auth-eye': function (btn) { var i = $('auth-password'); var show = i.type === 'password'; i.type = show ? 'text' : 'password'; btn.textContent = show ? '🙈' : '👁️'; }
    },
    forms: { auth: function () { login(); }, newpw: function () { setNewPassword(); } }
  };

  function init() {
    var lib = window.supabase;
    if (!lib || typeof lib.createClient !== 'function') return;
    client = lib.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'mijnEten.auth' }
    });
    if (/type=recovery/.test(location.hash || '') || /type=recovery/.test(location.search || '')) recovering = true;
    client.auth.onAuthStateChange(function (event, session) {
      var was = user;
      user = session ? session.user : null;
      if ((event === 'PASSWORD_RECOVERY' || recovering) && user && !recShown) { recShown = true; setTimeout(openRecovery, 0); }
      if (user && (!was || was.id !== user.id)) setTimeout(function () { afterLogin(user); }, 0);
      if (!user && was) { ME.route(); }
      paintStatus();
      if (window.ME && ME.rerender && (!was) !== (!user)) ME.rerender();
    });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') syncNow(); });
    window.addEventListener('focus', function () { syncNow(); });
    setInterval(function () { if (document.visibilityState === 'visible') syncNow(); }, 60000);
    window.addEventListener('online', function () { syncNow(); });
    window.addEventListener('offline', function () { if (user) setStatus('offline'); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
