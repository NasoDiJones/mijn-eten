// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: green; icon-glyph: utensils;

// Mijn Eten – widget voor Scriptable (iPhone)
// Toont de calorieën van vandaag, je dagdoel en hoeveel je nog over hebt (of te veel, in rood).
// Inloggen gaat één keer met je Mijn Eten-e-mail en wachtwoord. Het wachtwoord wordt NIET bewaard;
// alleen de inlogsessie (verversingstoken) staat in de iPhone-sleutelhanger van Scriptable.
// Iedereen ziet alleen zijn/haar eigen gegevens (Row Level Security in Supabase).
//
// Gebruik:  klein of middel widget (geen widget-parameter nodig).
// Tikken op de widget opent NOOIT Safari of een website: het opent Scriptable even, ververst de cijfers
// stil (zonder menu) en is klaar. "⚡ Snel kcal" (middel) voegt calorieën toe binnen Scriptable.
// Draai het script zelf in Scriptable voor het menu (inloggen, uitloggen/ander account, snel kcal, voorbeeld).

const VERSIE = 'widget v2';
const SUPABASE_URL = 'https://zsqxzyqpyvnnwigwrsoa.supabase.co';
const SUPABASE_KEY = 'sb_publishable_WocraeDzyG44zL01tOU02A_DyT1P9n3'; // publieke client-sleutel (anon), geen geheim
const KC_KEY = 'mijnEten.widget.sessie';
const CACHE_FILE = 'mijn-eten-widget-cache.json';
const REFRESH_MIN = 15;

const MEALS = [
  { id: 'breakfast', name: 'Ontbijt' }, { id: 'lunch', name: 'Lunch' },
  { id: 'dinner', name: 'Diner' }, { id: 'snack', name: 'Tussendoortjes' }
];
const ACTIVITY = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, extreme: 1.9 };
const KCAL_PER_KG = 7700;

// ---------- Rekenwerk (zelfde logica als app.js: calc/targets/sumOf/defaultMeal) ----------
function pad(n) { return ('0' + n).slice(-2); }
function todayKey(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function r1(n) { return Math.round(n * 10) / 10; }
function defaultMeal(d) {
  const h = (d || new Date()).getHours();
  return h < 10 ? 'breakfast' : h < 14 ? 'lunch' : h >= 17 && h < 21 ? 'dinner' : 'snack';
}
// weights: [{ id: 'YYYY-MM-DD', data: { kg } }]  (laatste meting met kg > 0, op datum)
function latestWeight(weights) {
  const w = (weights || []).filter(x => x && x.data && +x.data.kg > 0).sort((a, b) => (a.id < b.id ? 1 : -1))[0];
  return w ? +w.data.kg : NaN;
}
function calc(p, weightKg) {
  p = p || {};
  const w = isFinite(weightKg) ? weightKg : +p.weight, h = +p.height, a = +p.age, male = p.sex !== 'f';
  if (!(w > 0 && h > 0 && a > 0)) return null;
  const bmr = 10 * w + 6.25 * h - 5 * a + (male ? 5 : -161);
  const tdee = bmr * (ACTIVITY[p.activity] || ACTIVITY.light);
  const goal = p.goal || 'lose';
  const pace = goal === 'keep' ? 0 : (+p.pace || (goal === 'lose' ? 0.5 : 0.25));
  const delta = goal === 'lose' ? -pace * KCAL_PER_KG / 7 : goal === 'gain' ? pace * KCAL_PER_KG / 7 : 0;
  let kcal = Math.round((tdee + delta) / 10) * 10;
  const floor = male ? 1500 : 1200;
  if (kcal < floor) kcal = floor;
  const bmi = w / Math.pow(h / 100, 2);
  const refW = bmi > 30 ? 27 * Math.pow(h / 100, 2) : w;
  const protein = Math.round(refW * (goal === 'lose' ? 1.8 : 1.6));
  const fat = Math.round(kcal * 0.3 / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { kcal, protein, carbs, fat };
}
function targets(profile, weights) {
  const p = profile || {};
  const c = calc(p, latestWeight(weights)) || { kcal: 2000, protein: 100, carbs: 225, fat: 67 };
  const m = p.manual || {}, t = { kcal: c.kcal, protein: c.protein, carbs: c.carbs, fat: c.fat };
  if (m.protein > 0) t.protein = m.protein;
  if (m.kcal > 0) t.kcal = m.kcal;
  if (m.kcal > 0 || m.protein > 0) {
    t.fat = Math.round(t.kcal * 0.3 / 9);
    t.carbs = Math.max(0, Math.round((t.kcal - t.protein * 4 - t.fat * 9) / 4));
  }
  if (m.fat > 0) t.fat = m.fat;
  if (m.carbs > 0) t.carbs = m.carbs;
  else if (m.fat > 0) t.carbs = Math.max(0, Math.round((t.kcal - t.protein * 4 - t.fat * 9) / 4));
  return t;
}
function sumOf(entries) {
  return (entries || []).reduce((s, e) => { s.kcal += +e.kcal || 0; s.protein += +e.protein || 0; s.carbs += +e.carbs || 0; s.fat += +e.fat || 0; return s; }, { kcal: 0, protein: 0, carbs: 0, fat: 0 });
}
// rows = ruwe rijen uit Supabase ({ data, deleted })
function summarize(profileRow, weightRows, diaryRows, day) {
  const profile = profileRow && !profileRow.deleted ? profileRow.data : null;
  const weights = (weightRows || []).filter(r => !r.deleted);
  const entries = (diaryRows || []).filter(r => !r.deleted && r.data && r.data.date === day).map(r => r.data);
  const t = targets(profile, weights), s = sumOf(entries), left = t.kcal - s.kcal; // zoals de app: afronden pas bij tonen
  return {
    day, goal: t.kcal, eaten: Math.round(s.kcal), left, over: left < 0, frac: t.kcal ? s.kcal / t.kcal : 0,
    protein: s.protein, carbs: s.carbs, fat: s.fat, tProtein: t.protein, tCarbs: t.carbs, tFat: t.fat,
    count: entries.length, hasProfile: !!(profile && profile.onboarded)
  };
}
function fmt(n) {
  if (!isFinite(n)) return '–';
  const neg = n < 0, s = String(Math.round(Math.abs(n)));
  return (neg ? '-' : '') + s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
function numNl(v) { if (v == null || v === '') return NaN; const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : NaN; }

// ---------- Supabase ----------
function http(url, opts) {
  const r = new Request(url);
  r.method = (opts && opts.method) || 'GET';
  r.headers = Object.assign({ apikey: SUPABASE_KEY, 'Content-Type': 'application/json', Accept: 'application/json' }, (opts && opts.headers) || {});
  if (opts && opts.body !== undefined) r.body = JSON.stringify(opts.body);
  r.timeoutInterval = 15;
  return r.loadString().then(txt => {
    const status = (r.response && r.response.statusCode) || 0;
    let json = null; try { json = txt ? JSON.parse(txt) : null; } catch (e) {}
    return { status, json };
  }, e => { const err = new Error('netwerk'); err.kind = 'offline'; err.cause = e; throw err; });
}
function authErr(res) {
  const j = res.json || {}, m = ((j.error_code || j.code || j.error || '') + ' ' + (j.msg || j.message || j.error_description || '')).toLowerCase();
  const e = new Error(m || ('HTTP ' + res.status));
  e.status = res.status;
  if (/email.?not.?confirmed/.test(m)) { e.kind = 'login'; e.nl = 'Je e-mail is nog niet bevestigd. Klik eerst op de link in de bevestigingsmail.'; }
  else if (/invalid.?(login.?)?credentials|invalid_grant.*credentials/.test(m)) { e.kind = 'login'; e.nl = 'E-mailadres of wachtwoord klopt niet.'; }
  else if (res.status === 429 || /rate.?limit|too many/.test(m)) { e.kind = 'busy'; e.nl = 'Te veel pogingen. Wacht een paar minuten en probeer het opnieuw.'; }
  else if (res.status === 400 || res.status === 401 || res.status === 403) { e.kind = 'auth'; e.nl = 'Je bent uitgelogd. Open het script in Scriptable om opnieuw in te loggen.'; }
  else { e.kind = 'server'; e.nl = 'Supabase reageert niet goed (' + res.status + '). Probeer het later opnieuw.'; }
  return e;
}
function readSession() {
  try { return Keychain.contains(KC_KEY) ? JSON.parse(Keychain.get(KC_KEY)) : null; } catch (e) { return null; }
}
function saveSession(s) {
  // Alleen sessie-gegevens, nooit het wachtwoord
  const keep = { refresh_token: s.refresh_token, access_token: s.access_token, expires_at: s.expires_at || (Math.floor(Date.now() / 1000) + (+s.expires_in || 3600)), user: { id: s.user && s.user.id, email: s.user && s.user.email } };
  Keychain.set(KC_KEY, JSON.stringify(keep));
  return keep;
}
function clearSession() { try { if (Keychain.contains(KC_KEY)) Keychain.remove(KC_KEY); } catch (e) {} }
async function signIn(email, password) {
  const res = await http(SUPABASE_URL + '/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  if (res.status !== 200 || !res.json || !res.json.refresh_token) throw authErr(res);
  return saveSession(res.json);
}
async function refresh(sess) {
  const res = await http(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: sess.refresh_token } });
  if (res.status === 200 && res.json && res.json.refresh_token) return saveSession(res.json);
  // Mogelijk heeft een andere widget het token net ververst: dan staat er een nieuw token in de sleutelhanger.
  const now = readSession();
  if (now && now.refresh_token && now.refresh_token !== sess.refresh_token) return now;
  throw authErr(res);
}
// Geldige sessie (vervangt het token alleen als het binnen 5 minuten verloopt)
async function session() {
  let s = readSession();
  if (!s || !s.refresh_token) { const e = new Error('geen sessie'); e.kind = 'nologin'; throw e; }
  if (!s.access_token || !s.expires_at || s.expires_at * 1000 - Date.now() < 5 * 60 * 1000) s = await refresh(s);
  return s;
}
async function rest(s, path, opts) {
  const res = await http(SUPABASE_URL + '/rest/v1/' + path, Object.assign({}, opts, { headers: Object.assign({ Authorization: 'Bearer ' + s.access_token }, (opts && opts.headers) || {}) }));
  if (res.status === 401) { const e = new Error('jwt'); e.kind = 'jwt'; throw e; }
  if (res.status < 200 || res.status >= 300) { const e = new Error('HTTP ' + res.status + ' ' + JSON.stringify(res.json)); e.kind = /PGRST20[25]|42P01|does not exist|schema cache/i.test(JSON.stringify(res.json || '')) ? 'missing' : 'server'; e.status = res.status; throw e; }
  return res.json;
}
function enc(v) { return encodeURIComponent(v); }
async function fetchToday(s, day) {
  const uid = enc(s.user.id);
  const [prof, weights, diary] = await Promise.all([
    rest(s, 'eten_profiles?select=data,deleted&user_id=eq.' + uid + '&id=eq.me'),
    rest(s, 'eten_weights?select=id,data,deleted&user_id=eq.' + uid + '&deleted=is.false&order=id.desc&limit=60'),
    rest(s, 'eten_diary?select=data,deleted&user_id=eq.' + uid + '&deleted=is.false&' + enc('data->>date') + '=eq.' + enc(day) + '&limit=1000')
  ]);
  return summarize((prof || [])[0] || null, weights || [], diary || [], day);
}
async function loadData() {
  let s = await session();
  const day = todayKey();
  try { return await fetchToday(s, day); }
  catch (e) {
    if (e.kind !== 'jwt') throw e;
    s = await refresh(s); // token verlopen of ingetrokken: één keer verversen
    return await fetchToday(s, day);
  }
}
async function addQuick(s, entry) {
  const id = (typeof UUID !== 'undefined' ? UUID.string() : String(Date.now()) + Math.random().toString(36).slice(2)).toLowerCase();
  const now = new Date().toISOString();
  const data = { date: entry.date, meal: entry.meal, quick: true, name: entry.name || 'Snel toegevoegd', kcal: r1(entry.kcal), protein: 0, carbs: 0, fat: 0, grams: 0, created: now, t: now };
  await rest(s, 'eten_diary', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: [{ user_id: s.user.id, id, data, deleted: false }] });
  return { id, data };
}

// ---------- Cache (laatste stand, voor offline) ----------
function fm() { try { return FileManager.local(); } catch (e) { return null; } }
function cachePath(f) { return f.joinPath(f.documentsDirectory(), CACHE_FILE); }
function readCache() { const f = fm(); if (!f) return null; try { const p = cachePath(f); return f.fileExists(p) ? JSON.parse(f.readString(p)) : null; } catch (e) { return null; } }
function writeCache(d, email) { const f = fm(); if (!f) return; try { f.writeString(cachePath(f), JSON.stringify({ at: Date.now(), email, d })); } catch (e) {} }
function clearCache() { const f = fm(); if (!f) return; try { const p = cachePath(f); if (f.fileExists(p)) f.remove(p); } catch (e) {} }

// ---------- Weergave ----------
const C = {
  bg: () => Color.dynamic(new Color('#ffffff'), new Color('#161a18')),
  text: () => Color.dynamic(new Color('#111827'), new Color('#f3f4f6')),
  muted: () => Color.dynamic(new Color('#6b7280'), new Color('#9ca3af')),
  brand: () => Color.dynamic(new Color('#16a34a'), new Color('#22c55e')),
  danger: () => Color.dynamic(new Color('#dc2626'), new Color('#f87171')),
  btn: () => Color.dynamic(new Color('#dcfce7'), new Color('#143222')),
  protein: () => Color.dynamic(new Color('#e85d75'), new Color('#f47c91')),
  carbs: () => Color.dynamic(new Color('#f59e0b'), new Color('#fbbf24')),
  fat: () => Color.dynamic(new Color('#3b82f6'), new Color('#60a5fa'))
};
// Ring als plaatje (DrawContext kent geen dynamische kleuren: neutrale baan + groen/rood die in licht én donker werken)
function ringImage(frac, size, over) {
  const ctx = new DrawContext();
  ctx.size = new Size(size, size); ctx.opaque = false; ctx.respectScreenScale = true;
  const lw = Math.round(size * 0.1), r = (size - lw) / 2, cx = size / 2, cy = size / 2;
  ctx.setStrokeColor(new Color('#8a8f8c', 0.28)); ctx.setLineWidth(lw);
  ctx.strokeEllipse(new Rect(lw / 2, lw / 2, size - lw, size - lw));
  const f = clamp(frac, 0, 1);
  if (f > 0) {
    const n = Math.max(2, Math.ceil(120 * f)), pts = [];
    for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + 2 * Math.PI * f * i / n; pts.push(new Point(cx + r * Math.cos(a), cy + r * Math.sin(a))); }
    const path = new Path(); path.addLines(pts);
    ctx.addPath(path); ctx.setStrokeColor(new Color(over ? '#ef4444' : '#22c55e')); ctx.setLineWidth(lw); ctx.strokePath();
    // ronde uiteinden
    ctx.setFillColor(new Color(over ? '#ef4444' : '#22c55e'));
    [pts[0], pts[pts.length - 1]].forEach(p => ctx.fillEllipse(new Rect(p.x - lw / 2, p.y - lw / 2, lw, lw)));
  }
  return ctx.getImage();
}
function txt(stack, s, size, color, weight) {
  const t = stack.addText(String(s));
  t.font = weight === 'bold' ? Font.boldRoundedSystemFont(size) : weight === 'semibold' ? Font.semiboldRoundedSystemFont(size) : Font.regularRoundedSystemFont(size);
  t.textColor = color; t.lineLimit = 1; t.minimumScaleFactor = 0.6;
  return t;
}
function ringStack(parent, d, size) {
  const st = parent.addStack();
  st.size = new Size(size, size);
  st.backgroundImage = ringImage(d.frac, size, d.over);
  st.layoutVertically();
  st.addSpacer();
  const inner = st.addStack(); inner.layoutVertically();
  const r1s = inner.addStack(); r1s.addSpacer(); txt(r1s, fmt(Math.abs(d.left)), Math.round(size * 0.22), d.over ? C.danger() : C.text(), 'bold'); r1s.addSpacer();
  const r2s = inner.addStack(); r2s.addSpacer(); txt(r2s, d.over ? 'te veel' : 'over', Math.round(size * 0.11), d.over ? C.danger() : C.muted()); r2s.addSpacer();
  st.addSpacer();
  return st;
}
function macroLine(parent, label, val, goal, color) {
  const row = parent.addStack(); row.centerAlignContent();
  const dot = row.addText('●'); dot.font = Font.systemFont(8); dot.textColor = color;
  row.addSpacer(4);
  txt(row, label, 11, C.muted());
  row.addSpacer();
  txt(row, fmt(val) + '/' + fmt(goal) + ' g', 11, val > goal * 1.05 ? C.danger() : C.text(), 'semibold');
}
// Alle tikken blijven binnen Scriptable (scriptable:///run/<naam>?actie=…); nooit een https- of webapp-link.
function scriptUrl(action) {
  const name = typeof Script !== 'undefined' && Script.name ? Script.name() : 'Mijn Eten';
  return 'scriptable:///run/' + encodeURIComponent(name) + '?actie=' + action;
}
function header(w, stale) {
  const h = w.addStack(); h.centerAlignContent();
  txt(h, 'Mijn Eten', 12, C.brand(), 'bold');
  h.addSpacer();
  if (stale) txt(h, stale, 10, C.danger());
}
function buildWidget(d, family, info) {
  const w = new ListWidget();
  w.backgroundColor = C.bg();
  w.url = scriptUrl('ververs'); // tik: Scriptable ververst stil, geen menu, geen Safari
  w.refreshAfterDate = new Date(Date.now() + REFRESH_MIN * 60 * 1000);
  const stale = info && info.stale ? info.stale : '';
  if (family === 'accessoryInline') { txt(w, d.over ? fmt(-d.left) + ' kcal te veel' : 'Nog ' + fmt(d.left) + ' kcal', 12, C.text()); return w; }
  if (family === 'accessoryCircular') { const a = w.addStack(); a.layoutVertically(); txt(a, fmt(Math.abs(d.left)), 14, C.text(), 'bold'); txt(a, d.over ? 'te veel' : 'over', 9, C.text()); return w; }
  if (family === 'accessoryRectangular') {
    txt(w, 'Mijn Eten', 11, C.text(), 'bold');
    txt(w, fmt(d.eaten) + ' / ' + fmt(d.goal) + ' kcal', 12, C.text());
    txt(w, d.over ? fmt(-d.left) + ' te veel' : 'nog ' + fmt(d.left) + ' over', 12, C.text(), 'semibold');
    return w;
  }
  if (family === 'small') {
    w.setPadding(12, 12, 12, 12);
    header(w, stale);
    w.addSpacer(4);
    const row = w.addStack(); row.addSpacer(); ringStack(row, d, 84); row.addSpacer();
    w.addSpacer(4);
    const b = w.addStack(); b.addSpacer(); txt(b, fmt(d.eaten) + ' / ' + fmt(d.goal) + ' kcal', 11, C.muted(), 'semibold'); b.addSpacer();
    return w;
  }
  // middel (en groter)
  w.setPadding(12, 14, 12, 14);
  header(w, stale);
  w.addSpacer(6);
  const main = w.addStack(); main.centerAlignContent();
  ringStack(main, d, 92);
  main.addSpacer(14);
  const col = main.addStack(); col.layoutVertically();
  const l1 = col.addStack(); txt(l1, 'Gegeten', 12, C.muted()); l1.addSpacer(); txt(l1, fmt(d.eaten) + ' kcal', 12, C.text(), 'semibold');
  const l2 = col.addStack(); txt(l2, 'Doel', 12, C.muted()); l2.addSpacer(); txt(l2, fmt(d.goal) + ' kcal', 12, C.text(), 'semibold');
  const l3 = col.addStack(); txt(l3, d.over ? 'Te veel' : 'Over', 12, d.over ? C.danger() : C.muted()); l3.addSpacer(); txt(l3, fmt(Math.abs(d.left)) + ' kcal', 12, d.over ? C.danger() : C.brand(), 'bold');
  col.addSpacer(4);
  macroLine(col, 'Eiwit', d.protein, d.tProtein, C.protein());
  macroLine(col, 'Koolh.', d.carbs, d.tCarbs, C.carbs());
  macroLine(col, 'Vet', d.fat, d.tFat, C.fat());
  w.addSpacer(6);
  const btns = w.addStack();
  const q = btns.addStack(); q.backgroundColor = C.btn(); q.cornerRadius = 9; q.setPadding(4, 10, 4, 10); q.url = scriptUrl('snel');
  q.addSpacer(); txt(q, '⚡ Snel kcal toevoegen', 12, C.brand(), 'bold'); q.addSpacer();
  return w;
}
function messageWidget(title, body, url) {
  const w = new ListWidget();
  w.backgroundColor = C.bg(); w.setPadding(12, 12, 12, 12);
  w.url = url || scriptUrl('ververs');
  w.refreshAfterDate = new Date(Date.now() + REFRESH_MIN * 60 * 1000);
  txt(w, 'Mijn Eten', 12, C.brand(), 'bold');
  w.addSpacer(6);
  const t = w.addText(title); t.font = Font.boldRoundedSystemFont(14); t.textColor = C.text();
  w.addSpacer(3);
  const b = w.addText(body); b.font = Font.regularRoundedSystemFont(11); b.textColor = C.muted();
  w.addSpacer();
  return w;
}
function hhmm(ms) { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
// Bepaalt wat de widget toont: data, of een duidelijke melding (offline / niet ingelogd)
async function widgetFor(family) {
  try {
    const d = await loadData();
    const s = readSession();
    writeCache(d, s && s.user && s.user.email);
    return { kind: 'data', widget: buildWidget(d, family), data: d };
  } catch (e) {
    const kind = e.kind || 'server';
    if (kind === 'nologin') return { kind, widget: messageWidget('Niet ingelogd', 'Open Scriptable en tik op dit script om in te loggen met je Mijn Eten-account.', scriptUrl('inloggen')) };
    if (kind === 'auth' || kind === 'login') return { kind: 'auth', widget: messageWidget('Opnieuw inloggen', 'Je sessie is verlopen. Open Scriptable en tik op dit script om opnieuw in te loggen.', scriptUrl('inloggen')) };
    const cache = readCache();
    if (cache && cache.d && cache.d.day === todayKey()) return { kind: kind === 'offline' ? 'offline-cache' : 'error-cache', widget: buildWidget(cache.d, family, { stale: (kind === 'offline' ? 'offline · ' : '⚠︎ ') + hhmm(cache.at) }), data: cache.d };
    if (kind === 'offline') return { kind, widget: messageWidget('Geen verbinding', 'Je bent offline. De widget werkt zichzelf bij zodra je weer internet hebt.') };
    if (kind === 'missing') return { kind, widget: messageWidget('Nog niet ingesteld', 'De Mijn Eten-tabellen zijn niet gevonden in Supabase.') };
    return { kind, widget: messageWidget('Even niet bereikbaar', 'Gegevens ophalen lukte niet. De widget probeert het over een kwartier opnieuw.') };
  }
}

// ---------- In de Scriptable-app: inloggen, menu, snel kcal ----------
async function askLogin(message) {
  const a = new Alert();
  a.title = 'Inloggen bij Mijn Eten';
  a.message = (message ? message + '\n\n' : '') + 'Gebruik hetzelfde e-mailadres en wachtwoord als in de Mijn Eten-app. Je wachtwoord wordt niet bewaard.';
  const em = a.addTextField('E-mailadres'); try { em.setEmailAddressKeyboard(); } catch (e) {}
  a.addSecureTextField('Wachtwoord');
  a.addAction('Inloggen'); a.addCancelAction('Annuleren');
  const i = await a.presentAlert();
  if (i === -1) return null;
  const email = (a.textFieldValue(0) || '').trim().toLowerCase(), pw = a.textFieldValue(1) || '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !pw) return askLogin('Vul je e-mailadres en wachtwoord in.');
  try { const s = await signIn(email, pw); clearCache(); return s; }
  catch (e) { return askLogin(e.kind === 'offline' ? 'Geen verbinding. Controleer je internet.' : (e.nl || 'Inloggen mislukt.')); }
}
async function info(title, message) { const a = new Alert(); a.title = title; a.message = message || ''; a.addAction('OK'); await a.presentAlert(); }
async function quickAdd() {
  let s;
  try { s = await session(); } catch (e) {
    if (e.kind === 'offline') { await info('Geen verbinding', 'Snel kcal toevoegen kan alleen met internet.'); return false; }
    s = await askLogin(e.kind === 'nologin' ? '' : 'Je sessie is verlopen.'); if (!s) return false;
  }
  const a = new Alert();
  a.title = 'Snel calorieën toevoegen';
  a.message = 'Wordt toegevoegd aan vandaag in Mijn Eten.';
  a.addTextField('Omschrijving (optioneel)');
  const k = a.addTextField('Calorieën (kcal)'); try { k.setDecimalPadKeyboard(); } catch (e) {}
  const def = defaultMeal();
  MEALS.forEach(m => a.addAction(m.name + (m.id === def ? ' ✓' : '')));
  a.addCancelAction('Annuleren');
  const i = await a.presentAlert();
  if (i === -1) return false;
  const kcal = numNl(a.textFieldValue(1));
  if (!(kcal > 0 && kcal < 10000)) { await info('Geen calorieën', 'Vul een aantal kcal in (bijv. 250).'); return quickAdd(); }
  try {
    await addQuick(s, { date: todayKey(), meal: MEALS[i].id, name: (a.textFieldValue(0) || '').trim(), kcal });
  } catch (e) {
    if (e.kind === 'jwt') { try { s = await refresh(s); await addQuick(s, { date: todayKey(), meal: MEALS[i].id, name: (a.textFieldValue(0) || '').trim(), kcal }); } catch (e2) { await info('Toevoegen mislukt', 'Probeer het opnieuw of voeg het toe in de app.'); return false; } }
    else { await info('Toevoegen mislukt', e.kind === 'offline' ? 'Geen verbinding.' : 'Probeer het opnieuw of voeg het toe in de app.'); return false; }
  }
  clearCache();
  await info('Toegevoegd ✓', fmt(kcal) + ' kcal bij ' + MEALS[i].name.toLowerCase() + '. De widget werkt zichzelf binnen enkele minuten bij; in de app staat het er direct na synchroniseren.');
  return true;
}
async function logoutLocal() {
  const s = readSession();
  if (s && s.access_token) { try { await http(SUPABASE_URL + '/auth/v1/logout?scope=local', { method: 'POST', headers: { Authorization: 'Bearer ' + s.access_token } }); } catch (e) {} }
  clearSession(); clearCache();
}
async function menu() {
  const s = readSession();
  const a = new Alert();
  a.title = 'Mijn Eten-widget';
  a.message = (s && s.user ? 'Ingelogd als ' + s.user.email : 'Niet ingelogd') + '\n' + VERSIE;
  const opts = [];
  if (s) {
    opts.push(['Voorbeeld klein', 'small'], ['Voorbeeld middel', 'medium'], ['⚡ Snel kcal toevoegen', 'snel'], ['Uitloggen / ander account', 'logout']);
  } else opts.push(['Inloggen', 'login']);
  opts.forEach(o => a.addAction(o[0]));
  a.addCancelAction('Sluiten');
  const i = await a.presentSheet();
  if (i === -1) return;
  const act = opts[i][1];
  if (act === 'login') { if (await askLogin()) await preview('medium'); }
  else if (act === 'small' || act === 'medium') await preview(act);
  else if (act === 'snel') await quickAdd();
  else if (act === 'logout') {
    const c = new Alert(); c.title = 'Uitloggen?'; c.message = 'De widget toont daarna niets meer tot je opnieuw inlogt. Je gegevens blijven gewoon in je account.';
    c.addDestructiveAction('Uitloggen'); c.addAction('Uitloggen en ander account'); c.addCancelAction('Annuleren');
    const j = await c.presentAlert();
    if (j === -1) return;
    await logoutLocal();
    if (j === 1) { if (await askLogin()) await preview('medium'); }
    else await info('Uitgelogd', 'Tik weer op dit script om in te loggen.');
  }
}
async function preview(family) {
  const r = await widgetFor(family);
  if (family === 'small') await r.widget.presentSmall(); else await r.widget.presentMedium();
}

async function main() {
  if (typeof config !== 'undefined' && (config.runsInWidget || config.runsInAccessoryWidget)) {
    const r = await widgetFor(config.widgetFamily || 'small');
    Script.setWidget(r.widget);
    Script.complete();
    return r;
  }
  let action = (typeof args !== 'undefined' && args.queryParameters && args.queryParameters.actie) || '';
  // Widget ingesteld op "Bij interactie: Voer script uit" (zonder URL): ook stil verversen
  if (!action && typeof config !== 'undefined' && config.runsFromHomeScreen) action = 'ververs';
  if (action === 'ververs') {
    // Tik op de widget: alleen de cijfers ophalen (cache bijwerken, token verversen), geen menu, geen Safari.
    // Niet ingelogd/verlopen: dan wél het inlogvenster, anders gebeurt er niets zichtbaars.
    const r = await widgetFor('medium');
    if (r.kind === 'nologin' || r.kind === 'auth') { clearSession(); await askLogin(r.kind === 'auth' ? 'Je sessie is verlopen.' : ''); }
    Script.complete();
    return r;
  }
  if (!readSession()) {
    const s = await askLogin();
    if (s && action === 'snel') await quickAdd();
    else if (s) await preview('medium');
  } else if (action === 'snel') await quickAdd();
  else if (action === 'inloggen') { clearSession(); if (await askLogin()) await preview('medium'); }
  else await menu();
  Script.complete();
}

// Voor tests in Node (Scriptable zelf gebruikt dit niet)
if (typeof module !== 'undefined' && module && typeof globalThis.__ME_WIDGET_TEST__ !== 'undefined') {
  module.exports = { calc, targets, sumOf, summarize, latestWeight, defaultMeal, todayKey, fmt, numNl, signIn, refresh, session, loadData, fetchToday, addQuick, widgetFor, buildWidget, logoutLocal, readSession, scriptUrl, main, quickAdd, menu, KC_KEY };
} else {
  await main();
}
