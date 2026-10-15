// Mijn Eten – eten, calorieën, macro's, water en gewicht bijhouden.
// Vanilla JS PWA. Data staat lokaal (localStorage) en wordt via sync.js met Supabase gesynchroniseerd.
(function () {
  'use strict';
  var VERSION = 'v5';
  var DATA_KEY = 'mijnEten.data', PENDING_KEY = 'mijnEten.pending', THEME_KEY = 'mijnEten.theme', UI_KEY = 'mijnEten.ui';
  var TABLES = { eten_profiles: 'profiles', eten_diary: 'entries', eten_foods: 'foods', eten_water: 'water', eten_weights: 'weights' };
  var MEALS = [
    { id: 'breakfast', name: 'Ontbijt', ico: '🍳' },
    { id: 'lunch', name: 'Lunch', ico: '🥪' },
    { id: 'dinner', name: 'Diner', ico: '🍝' },
    { id: 'snack', name: 'Tussendoortjes', ico: '🍎' }
  ];
  var ACTIVITY = [
    { id: 'sedentary', f: 1.2, name: 'Zittend', desc: 'Zittend werk, weinig beweging' },
    { id: 'light', f: 1.375, name: 'Licht actief', desc: 'Veel staan/lopen of 1–3× per week sporten' },
    { id: 'moderate', f: 1.55, name: 'Gemiddeld actief', desc: 'Fysiek werk of 3–5× per week sporten' },
    { id: 'active', f: 1.725, name: 'Zeer actief', desc: 'Zwaar fysiek werk of dagelijks sporten' },
    { id: 'extreme', f: 1.9, name: 'Extreem actief', desc: 'Zwaar werk én intensief sporten' }
  ];
  var GOALS = [{ id: 'lose', name: 'Afvallen' }, { id: 'keep', name: 'Op gewicht blijven' }, { id: 'gain', name: 'Aankomen' }];
  var PACES = { lose: [0.25, 0.5, 0.75, 1], gain: [0.25, 0.5] };
  var KCAL_PER_KG = 7700;

  // ---------- Hulpjes ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { if (v == null || v === '') return NaN; var n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : NaN; }
  function fmt(n, dec) { if (!isFinite(n)) return '–'; return Number(n).toLocaleString('nl-NL', { maximumFractionDigits: dec || 0, minimumFractionDigits: 0 }); }
  function r1(n) { return Math.round(n * 10) / 10; }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function pad(n) { return ('0' + n).slice(-2); }
  function keyOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayKey() { return keyOf(new Date()); }
  function parseKey(k) { var p = String(k).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(k, n) { var d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); }
  function daysBetween(a, b) { return Math.round((parseKey(b) - parseKey(a)) / 86400000); }
  var DAYNAMES = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
  var MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  var MON = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  function longDate(k) { var d = parseKey(k); return DAYNAMES[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()]; }
  function shortDate(k) { var d = parseKey(k); return d.getDate() + ' ' + MON[d.getMonth()]; }
  function relLabel(k) {
    var diff = daysBetween(todayKey(), k);
    if (diff === 0) return 'Vandaag'; if (diff === -1) return 'Gisteren'; if (diff === 1) return 'Morgen';
    var s = longDate(k); return s.charAt(0).toUpperCase() + s.slice(1);
  }
  var toastTimer;
  function toast(msg) {
    var t = $('toast'); if (!t) return; t.textContent = msg; t.classList.add('open');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('open'); }, 2200);
  }
  window.showToast = toast;

  // ---------- Opslag ----------
  function emptyState() { return { profiles: {}, entries: {}, foods: {}, water: {}, weights: {} }; }
  function loadState() {
    var s = null; try { s = JSON.parse(localStorage.getItem(DATA_KEY)); } catch (e) {}
    var e = emptyState();
    if (s && typeof s === 'object') Object.keys(e).forEach(function (k) { if (s[k] && typeof s[k] === 'object') e[k] = s[k]; });
    return e;
  }
  var state = loadState();
  var pending = (function () { try { return JSON.parse(localStorage.getItem(PENDING_KEY)) || {}; } catch (e) { return {}; } })();
  var ui = (function () { try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch (e) { return {}; } })();
  function saveUi() { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) {} }
  function persist() {
    try { localStorage.setItem(DATA_KEY, JSON.stringify(state)); localStorage.setItem(PENDING_KEY, JSON.stringify(pending)); }
    catch (e) { toast('Opslaan mislukt (geheugen vol?)'); }
  }
  var stampCounter = 0;
  function markPending(table, id) {
    (pending[table] = pending[table] || {})[id] = Date.now() + '.' + (++stampCounter);
  }
  function put(table, id, data) {
    var col = TABLES[table]; data = Object.assign({}, data); delete data._del; delete data.id;
    data.t = new Date().toISOString();
    state[col][id] = data; markPending(table, id); persist();
    if (window.meSync && window.meSync.changed) window.meSync.changed();
    return data;
  }
  function remove(table, id) {
    var col = TABLES[table]; if (!state[col][id]) return;
    state[col][id] = { _del: true, t: new Date().toISOString() }; markPending(table, id); persist();
    if (window.meSync && window.meSync.changed) window.meSync.changed();
  }
  function liveVals(col) { var o = state[col], out = []; for (var k in o) if (o[k] && !o[k]._del) out.push(Object.assign({}, o[k], { id: k })); return out; }
  function getLive(col, id) { var r = state[col][id]; return r && !r._del ? r : null; }
  function profile() { return getLive('profiles', 'me'); }

  // API voor sync.js
  window.ME = {
    tables: TABLES,
    version: VERSION,
    record: function (table, id) { var r = state[TABLES[table]][id]; return r ? { data: r._del ? {} : r, deleted: !!r._del } : null; },
    pending: function () { return pending; },
    clearPending: function (table, id, stamp) { if (pending[table] && pending[table][id] === stamp) { delete pending[table][id]; persist(); } },
    dropPending: function (table, id) { if (pending[table]) { delete pending[table][id]; persist(); } },
    pendingCount: function () { var n = 0; for (var t in pending) n += Object.keys(pending[t]).length; return n; },
    isPending: function (table, id) { return !!(pending[table] && pending[table][id]); },
    applyRemote: function (table, id, data, deleted) {
      var col = TABLES[table]; if (!col) return false;
      var cur = state[col][id];
      var next = deleted ? { _del: true, t: (data && data.t) || '' } : data;
      if (deleted && (!cur || cur._del)) return false;
      if (JSON.stringify(cur) === JSON.stringify(next)) return false;
      state[col][id] = next; return true;
    },
    commitRemote: function () { persist(); rerender(); },
    hasLocalData: function () { return Object.keys(TABLES).some(function (t) { return liveVals(TABLES[t]).length > 0; }); },
    wipe: function () { state = emptyState(); pending = {}; persist(); ui.localChosen = false; saveUi(); curView = null; },
    route: function () { route(); },
    rerender: function () { rerender(); },
    state: function () { return state; }
  };

  // ---------- Berekeningen ----------
  function activityOf(id) { return ACTIVITY.filter(function (a) { return a.id === id; })[0] || ACTIVITY[1]; }
  function latestWeight() {
    var w = liveVals('weights').filter(function (x) { return x.kg > 0; }).sort(function (a, b) { return a.id < b.id ? 1 : -1; })[0];
    return w ? w.kg : NaN;
  }
  function currentWeight(p) { var lw = latestWeight(); return isFinite(lw) ? lw : (p && +p.weight); }
  function calc(p, useOwnWeight) {
    p = p || {};
    var w = useOwnWeight ? +p.weight : currentWeight(p), h = +p.height, a = +p.age, male = p.sex !== 'f';
    if (!(w > 0 && h > 0 && a > 0)) return null;
    var bmr = 10 * w + 6.25 * h - 5 * a + (male ? 5 : -161);
    var tdee = bmr * activityOf(p.activity).f;
    var goal = p.goal || 'lose';
    var pace = goal === 'keep' ? 0 : (+p.pace || (goal === 'lose' ? 0.5 : 0.25));
    var delta = goal === 'lose' ? -pace * KCAL_PER_KG / 7 : goal === 'gain' ? pace * KCAL_PER_KG / 7 : 0;
    var kcal = Math.round((tdee + delta) / 10) * 10;
    var floor = male ? 1500 : 1200, floored = false;
    if (kcal < floor) { kcal = floor; floored = true; }
    var bmi = w / Math.pow(h / 100, 2);
    var refW = bmi > 30 ? 27 * Math.pow(h / 100, 2) : w; // bij overgewicht eiwit op een realistischer referentiegewicht
    var protein = Math.round(refW * (goal === 'lose' ? 1.8 : 1.6));
    var fat = Math.round(kcal * 0.3 / 9);
    var carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
    var water = clamp(Math.round(w * 30 / 250) * 250, 1500, 3000);
    return { bmr: Math.round(bmr), tdee: Math.round(tdee), kcal: kcal, protein: protein, carbs: carbs, fat: fat, water: water, floored: floored, floor: floor, bmi: bmi, delta: Math.round(delta), weight: w };
  }
  function targets() {
    var p = profile() || {}, c = calc(p) || { kcal: 2000, protein: 100, carbs: 225, fat: 67, water: 2000 };
    var m = p.manual || {}, t = { kcal: c.kcal, protein: c.protein, carbs: c.carbs, fat: c.fat, water: c.water, auto: c };
    if (m.protein > 0) t.protein = m.protein;
    if (m.kcal > 0) t.kcal = m.kcal;
    if (m.kcal > 0 || m.protein > 0) { // macro's meeschalen met handmatig kcal/eiwit-doel
      t.fat = Math.round(t.kcal * 0.3 / 9);
      t.carbs = Math.max(0, Math.round((t.kcal - t.protein * 4 - t.fat * 9) / 4));
    }
    if (m.fat > 0) t.fat = m.fat;
    if (m.carbs > 0) t.carbs = m.carbs;
    else if (m.fat > 0) t.carbs = Math.max(0, Math.round((t.kcal - t.protein * 4 - t.fat * 9) / 4));
    if (m.water > 0) t.water = m.water;
    return t;
  }
  function nutr(per100, grams) {
    var f = (+grams || 0) / 100; per100 = per100 || {};
    return { kcal: (+per100.kcal || 0) * f, protein: (+per100.protein || 0) * f, carbs: (+per100.carbs || 0) * f, fat: (+per100.fat || 0) * f };
  }
  function dayEntries(date) { return liveVals('entries').filter(function (e) { return e.date === date; }).sort(function (a, b) { return (a.created || '') < (b.created || '') ? -1 : 1; }); }
  function sumOf(list) {
    return list.reduce(function (s, e) { s.kcal += +e.kcal || 0; s.protein += +e.protein || 0; s.carbs += +e.carbs || 0; s.fat += +e.fat || 0; return s; }, { kcal: 0, protein: 0, carbs: 0, fat: 0 });
  }
  function waterOf(date) { var w = getLive('water', date); return w ? (+w.ml || 0) : 0; }
  function glassSize() { var p = profile() || {}; return +p.glass || 250; }

  // ---------- Thema ----------
  function themePref() { try { var t = localStorage.getItem(THEME_KEY); return t === 'light' || t === 'dark' ? t : 'auto'; } catch (e) { return 'auto'; } }
  function applyTheme(animate) {
    var pref = themePref();
    var dark = pref === 'dark' || (pref === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    var root = document.documentElement;
    if (animate) { root.classList.add('theme-anim'); setTimeout(function () { root.classList.remove('theme-anim'); }, 400); }
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    var m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', dark ? '#0d1110' : '#f2f4f1');
    document.querySelectorAll('[data-theme-opt]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-theme-opt') === pref ? 'true' : 'false'); });
  }
  function setTheme(pref) { try { if (pref === 'auto') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, pref); } catch (e) {} applyTheme(true); }
  window.setTheme = setTheme;
  if (window.matchMedia) { var mq = matchMedia('(prefers-color-scheme: dark)'); var onMq = function () { if (themePref() === 'auto') applyTheme(true); }; if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq); }

  // ---------- Routing / views ----------
  var curDate = todayKey();
  var curView = null;
  function loggedIn() { return !!(window.meSync && window.meSync.user && window.meSync.user()); }
  function showView(name) {
    ['welcome', 'onboarding', 'diary', 'progress', 'profile'].forEach(function (v) { $('view-' + v).classList.toggle('hidden', v !== name); });
    var tabs = name === 'diary' || name === 'progress' || name === 'profile';
    $('tabbar').classList.toggle('hidden', !tabs);
    document.querySelectorAll('[data-tab]').forEach(function (b) { if (b.getAttribute('data-tab') === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    if (curView !== name) { try { window.scrollTo(0, 0); } catch (e) {} }
    curView = name;
    if (tabs) { ui.tab = name; saveUi(); }
    renderView(name);
  }
  function renderView(name) {
    if (name === 'diary') renderDiary();
    else if (name === 'progress') renderProgress();
    else if (name === 'profile') renderProfile();
    else if (name === 'onboarding') renderOnboarding();
  }
  function route() {
    var p = profile();
    if (p && p.onboarded) { if (redoing && curView === 'onboarding') return; if (!curView || curView === 'welcome' || curView === 'onboarding') showView(ui.tab || 'diary'); else renderView(curView); return; }
    if (loggedIn() || ui.localChosen) { if (curView !== 'onboarding') { ob = null; showView('onboarding'); } return; }
    showView('welcome');
  }
  function rerender() {
    if (!curView) return route();
    var p = profile();
    if ((curView === 'welcome' || curView === 'onboarding') && p && p.onboarded && !redoing) return route();
    if (curView === 'welcome' && loggedIn()) return route();
    if (curView !== 'onboarding') renderView(curView);
    if (sheetCtx && sheetCtx.type === 'add') renderAddList();
  }
  var redoing = false;

  // ---------- Onboarding ----------
  var ob = null;
  function renderOnboarding() {
    if (!ob) { var p = profile() || {}; ob = { step: 0, sex: p.sex || 'm', age: p.age || '', height: p.height || '', weight: isFinite(currentWeight(p)) && currentWeight(p) > 0 ? currentWeight(p) : '', activity: p.activity || 'light', goal: p.goal || 'lose', pace: p.pace || 0.5, goalWeight: p.goalWeight || '' }; }
    var el = $('view-onboarding'), s = ob.step, html = '';
    html += '<div class="page-head"><h1>' + (s === 3 ? 'Jouw dagdoel' : 'Over jou') + '</h1>' + (s > 0 ? '<button class="link" data-action="ob-back">‹ Terug</button>' : (redoing ? '<button class="link" data-action="ob-cancel">Annuleer</button>' : '')) + '</div>';
    html += '<div class="steps">' + [0, 1, 2, 3].map(function (i) { return '<i class="' + (i <= s ? 'on' : '') + '"></i>'; }).join('') + '</div>';
    if (s === 0) {
      html += '<div class="card"><label class="field"><span>Geslacht</span><div class="seg">' +
        '<button data-action="ob-set" data-k="sex" data-v="m" aria-pressed="' + (ob.sex === 'm') + '">Man</button>' +
        '<button data-action="ob-set" data-k="sex" data-v="f" aria-pressed="' + (ob.sex === 'f') + '">Vrouw</button></div></label>' +
        '<div class="grid3">' +
        '<label class="field"><span>Leeftijd</span><div class="unit-input"><input id="ob-age" inputmode="numeric" value="' + esc(ob.age) + '" placeholder="30"><em>jr</em></div></label>' +
        '<label class="field"><span>Lengte</span><div class="unit-input"><input id="ob-height" inputmode="numeric" value="' + esc(ob.height) + '" placeholder="180"><em>cm</em></div></label>' +
        '<label class="field"><span>Gewicht</span><div class="unit-input"><input id="ob-weight" inputmode="decimal" value="' + esc(ob.weight === '' ? '' : String(ob.weight).replace('.', ',')) + '" placeholder="85"><em>kg</em></div></label>' +
        '</div><p class="tiny muted">Nodig om je verbranding (BMR) en je dagelijkse behoefte te berekenen.</p></div>' +
        '<button class="btn primary block" data-action="ob-next">Volgende</button>';
    } else if (s === 1) {
      html += '<p class="muted small">Hoe actief ben je gemiddeld op een dag (werk + sport)?</p>' + ACTIVITY.map(function (a) {
        return '<button class="choice" data-action="ob-set" data-k="activity" data-v="' + a.id + '" aria-pressed="' + (ob.activity === a.id) + '"><b>' + a.name + '</b><small>' + a.desc + '</small></button>';
      }).join('') + '<button class="btn primary block" data-action="ob-next">Volgende</button>';
    } else if (s === 2) {
      html += '<div class="card"><label class="field"><span>Wat is je doel?</span><div class="seg">' + GOALS.map(function (g) {
        return '<button data-action="ob-set" data-k="goal" data-v="' + g.id + '" aria-pressed="' + (ob.goal === g.id) + '">' + g.name + '</button>';
      }).join('') + '</div></label>';
      if (ob.goal !== 'keep') {
        var paces = PACES[ob.goal]; if (paces.indexOf(+ob.pace) < 0) ob.pace = paces[ob.goal === 'lose' ? 1 : 0];
        html += '<label class="field"><span>Tempo</span><div class="seg">' + paces.map(function (p) {
          return '<button data-action="ob-set" data-k="pace" data-v="' + p + '" aria-pressed="' + (+ob.pace === p) + '">' + fmt(p, 2) + ' kg/wk</button>';
        }).join('') + '</div></label>';
        html += '<label class="field"><span>Streefgewicht (optioneel)</span><div class="unit-input"><input id="ob-goalw" inputmode="decimal" value="' + esc(ob.goalWeight === '' || ob.goalWeight == null ? '' : String(ob.goalWeight).replace('.', ',')) + '" placeholder="bijv. 78"><em>kg</em></div></label>';
        html += '<p class="tiny muted">' + (ob.goal === 'lose' ? '0,5 kg per week is een gezond en vol te houden tempo.' : 'Langzaam aankomen (0,25 kg/week) beperkt vetopslag.') + '</p>';
      }
      html += '</div><button class="btn primary block" data-action="ob-next">Bereken mijn doel</button>';
    } else {
      var c = calc(ob, true);
      html += '<div class="card center"><div class="muted small">Dagelijks doel</div><div class="result-big">' + fmt(c.kcal) + ' kcal</div>' +
        '<div class="macros" style="text-align:left">' + macroMini('Eiwit', c.protein, 'protein') + macroMini('Koolhydraten', c.carbs, 'carbs') + macroMini('Vet', c.fat, 'fat') + '</div></div>' +
        '<div class="card"><div class="kv"><span>Verbranding in rust (BMR)</span><b>' + fmt(c.bmr) + ' kcal</b></div>' +
        '<div class="kv"><span>Totale behoefte (TDEE)</span><b>' + fmt(c.tdee) + ' kcal</b></div>' +
        '<div class="kv"><span>' + (c.delta < 0 ? 'Tekort voor afvallen' : c.delta > 0 ? 'Overschot voor aankomen' : 'Aanpassing') + '</span><b>' + (c.delta > 0 ? '+' : '') + fmt(c.delta) + ' kcal</b></div>' +
        '<div class="kv"><span>Water</span><b>' + fmt(c.water / 1000, 2) + ' L</b></div></div>' +
        (c.floored ? '<div class="note warn">Je berekende doel kwam onder de ' + c.floor + ' kcal. Voor je gezondheid houden we minimaal ' + c.floor + ' kcal aan; overweeg een rustiger tempo.</div>' : '') +
        '<div class="note">Alles kun je later aanpassen onder Profiel, ook de doelen zelf.</div>' +
        '<button class="btn primary block" data-action="ob-finish">' + (redoing ? 'Opslaan' : 'Aan de slag') + '</button>';
    }
    el.innerHTML = html;
  }
  function macroMini(name, g, cls) { return '<div class="macro"><div class="m-name"><span class="dot" style="background:var(--' + cls + ')"></span>' + name + '</div><div class="m-val" style="font-size:16px;color:var(--text);font-weight:700">' + fmt(g) + ' g</div></div>'; }
  function obReadInputs() {
    if (!ob) return;
    if ($('ob-age')) ob.age = num($('ob-age').value) || '';
    if ($('ob-height')) ob.height = num($('ob-height').value) || '';
    if ($('ob-weight')) ob.weight = num($('ob-weight').value) || '';
    if ($('ob-goalw')) ob.goalWeight = num($('ob-goalw').value) || '';
  }

  // ---------- Dagboek ----------
  function ringSvg(frac, size, stroke) {
    var r = (size - stroke) / 2, c = 2 * Math.PI * r, f = clamp(frac, 0, 1);
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '"><circle class="ring-track" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke-width="' + stroke + '"/>' +
      '<circle class="ring-val" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke-width="' + stroke + '" stroke-linecap="round" stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + (c * (1 - f)).toFixed(2) + '"/></svg>';
  }
  function macroBar(name, cls, val, goal) {
    var over = val > goal * 1.05;
    return '<div class="macro"><div class="m-name">' + name + '</div><div class="bar ' + cls + (over ? ' over' : '') + '"><i style="width:' + clamp(goal ? val / goal * 100 : 0, 0, 100).toFixed(1) + '%"></i></div>' +
      '<div class="m-val">' + fmt(val) + ' / ' + fmt(goal) + ' g</div></div>';
  }
  function renderDiary() {
    var t = targets(), list = dayEntries(curDate), sum = sumOf(list), left = t.kcal - sum.kcal, over = left < 0;
    var diff = daysBetween(todayKey(), curDate);
    var html = '<div class="page-head"><h1>Dagboek</h1><span class="sync-pill"></span></div>';
    html += '<div class="datebar"><button class="icon-btn" data-action="date-prev" aria-label="Vorige dag">‹</button>' +
      '<div class="date-label"><span id="date-title">' + esc(relLabel(curDate)) + '</span><small>' + (Math.abs(diff) <= 1 ? esc(longDate(curDate)) : 'tik om een datum te kiezen') + '</small>' +
      '<input type="date" id="date-pick" value="' + curDate + '" aria-label="Kies datum"></div>' +
      '<button class="icon-btn" data-action="date-next" aria-label="Volgende dag">›</button></div>';
    if (diff !== 0) html += '<div class="center" style="margin:-8px 0 10px"><button class="link small" data-action="date-today">↩ Naar vandaag</button></div>';
    html += '<div class="card" id="summary-card"><div class="summary"><div class="ring' + (over ? ' over' : '') + '">' + ringSvg(t.kcal ? sum.kcal / t.kcal : 0, 132, 12) +
      '<div class="ring-center"><b>' + fmt(Math.abs(left)) + '</b><span>' + (over ? 'kcal te veel' : 'kcal over') + '</span></div></div>' +
      '<div class="sum-stats"><div class="sum-stat"><span class="muted">Doel</span><b>' + fmt(t.kcal) + '</b></div>' +
      '<div class="sum-stat"><span class="muted">Gegeten</span><b id="eaten-kcal">' + fmt(sum.kcal) + '</b></div>' +
      '<div class="sum-stat"><span class="muted">' + (over ? 'Te veel' : 'Over') + '</span><b style="color:' + (over ? 'var(--danger)' : 'var(--brand)') + '">' + fmt(Math.abs(left)) + '</b></div></div></div>' +
      '<div class="macros">' + macroBar('Eiwit', 'protein', sum.protein, t.protein) + macroBar('Koolhydraten', 'carbs', sum.carbs, t.carbs) + macroBar('Vet', 'fat', sum.fat, t.fat) + '</div></div>';
    // Water
    var ml = waterOf(curDate), gs = glassSize(), goalGl = Math.max(1, Math.round(t.water / gs)), full = Math.floor(ml / gs + 1e-6), shown = Math.max(goalGl, full);
    html += '<div class="card" id="water-card"><div class="card-title"><h3>💧 Water</h3><span class="muted small"><b style="color:var(--text)" id="water-l">' + fmt(ml / 1000, 2) + '</b> / ' + fmt(t.water / 1000, 2) + ' L</span></div>' +
      '<div class="glasses">' + Array.from({ length: Math.min(shown, 16) }, function (_, i) { return '<button class="glass' + (i < full ? ' full' : '') + '" data-action="water-glass" data-i="' + i + '" aria-label="Glas ' + (i + 1) + '"></button>'; }).join('') + '</div>' +
      '<div class="bar water"><i style="width:' + clamp(ml / t.water * 100, 0, 100) + '%"></i></div>' +
      '<div class="row mt"><button class="btn sm" data-action="water-add" data-ml="-' + gs + '">− ' + gs + ' ml</button><button class="btn sm primary grow" data-action="water-add" data-ml="' + gs + '">+ glas (' + gs + ' ml)</button></div></div>';
    // Maaltijden
    MEALS.forEach(function (m) {
      var items = list.filter(function (e) { return e.meal === m.id; }), s = sumOf(items);
      html += '<div class="card meal" data-meal="' + m.id + '"><div class="meal-head"><h3><span>' + m.ico + '</span>' + m.name + '</h3><span class="meal-kcal">' + fmt(s.kcal) + ' kcal</span></div>';
      if (items.length) html += '<div class="tiny muted" style="margin-top:2px">E ' + fmt(s.protein) + ' g · K ' + fmt(s.carbs) + ' g · V ' + fmt(s.fat) + ' g</div>';
      items.forEach(function (e) {
        html += '<div class="entry" data-action="edit-entry" data-id="' + esc(e.id) + '"><div class="grow"><div class="e-name ellipsis">' + esc(e.name) + '</div><div class="e-sub ellipsis">' + esc(amountLabel(e)) + (e.brand ? ' · ' + esc(e.brand) : '') + '</div></div><div class="e-kcal">' + fmt(e.kcal) + ' kcal</div></div>';
      });
      html += '<button class="add-row" data-action="open-add" data-meal="' + m.id + '"><span class="plus">+</span>Toevoegen</button></div>';
    });
    $('view-diary').innerHTML = html;
    if (window.meSync && window.meSync.paintStatus) window.meSync.paintStatus();
  }
  function amountLabel(e) {
    if (e.quick) return 'Snel toegevoegd';
    if (e.unit === 'serving' && e.servingG) return fmt(e.qty, 2) + ' × ' + (e.servingLabel || 'portie') + ' (' + fmt(e.grams) + ' g)';
    return fmt(e.grams) + ' g';
  }
  function setWater(ml) {
    ml = Math.max(0, Math.round(ml));
    put('eten_water', curDate, { ml: ml });
    renderDiary();
  }

  // ---------- Voortgang ----------
  function weightsSorted() { return liveVals('weights').filter(function (w) { return w.kg > 0; }).sort(function (a, b) { return a.id < b.id ? -1 : 1; }); }
  function regression(pts) { // pts: [{x: dagen, y: kg}]
    var n = pts.length; if (n < 2) return null;
    var sx = 0, sy = 0, sxy = 0, sxx = 0; pts.forEach(function (p) { sx += p.x; sy += p.y; sxy += p.x * p.y; sxx += p.x * p.x; });
    var d = n * sxx - sx * sx; if (!d) return null;
    var b = (n * sxy - sx * sy) / d; return { slope: b, icept: (sy - b * sx) / n };
  }
  function weightTrend() {
    var ws = weightsSorted(); if (ws.length < 2) return null;
    var last = ws[ws.length - 1].id, from = addDays(last, -28);
    var pts = ws.filter(function (w) { return w.id >= from; }).map(function (w) { return { x: daysBetween(from, w.id), y: w.kg }; });
    if (pts.length < 2 || pts[pts.length - 1].x - pts[0].x < 6) return null;
    var r = regression(pts); if (!r) return null;
    return { perWeek: r.slope * 7 };
  }
  function weightChart(range) {
    var ws = weightsSorted(), p = profile() || {};
    if (!ws.length) return '<div class="empty">Nog geen gewicht ingevoerd.<br>Voeg hierboven je eerste meting toe.</div>';
    var end = todayKey(); if (ws[ws.length - 1].id > end) end = ws[ws.length - 1].id;
    var start = range === 'all' ? ws[0].id : addDays(end, -({ '1m': 30, '3m': 91, '1y': 365 })[range]);
    var pts = ws.filter(function (w) { return w.id >= start && w.id <= end; });
    if (!pts.length) return '<div class="empty">Geen metingen in deze periode.</div>';
    if (range === 'all' && daysBetween(start, end) < 7) start = addDays(end, -7);
    var W = 340, H = 190, L = 34, R = 10, T = 12, B = 24, span = Math.max(1, daysBetween(start, end));
    var ys = pts.map(function (w) { return w.kg; }); var gw = +p.goalWeight; if (gw > 0) ys.push(gw);
    var lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys); if (hi - lo < 2) { var mid = (hi + lo) / 2; lo = mid - 1; hi = mid + 1; }
    var padY = (hi - lo) * 0.12; lo -= padY; hi += padY;
    var X = function (k) { return L + (W - L - R) * daysBetween(start, k) / span; };
    var Y = function (v) { return T + (H - T - B) * (1 - (v - lo) / (hi - lo)); };
    var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Gewichtsgrafiek">';
    for (var i = 0; i <= 3; i++) { var v = lo + (hi - lo) * i / 3, y = Y(v); s += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/><text x="' + (L - 5) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end">' + fmt(v, 1) + '</text>'; }
    if (gw > 0) s += '<line class="goal" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(gw).toFixed(1) + '" y2="' + Y(gw).toFixed(1) + '"/><text x="' + (W - R) + '" y="' + (Y(gw) - 4).toFixed(1) + '" text-anchor="end" style="fill:var(--brand)">doel ' + fmt(gw, 1) + '</text>';
    var avg = pts.map(function (w) { var f = addDays(w.id, -6); var win = ws.filter(function (x) { return x.id >= f && x.id <= w.id; }); return { id: w.id, kg: win.reduce(function (a, x) { return a + x.kg; }, 0) / win.length }; });
    if (pts.length > 2) s += '<polyline class="trend" points="' + avg.map(function (a) { return X(a.id).toFixed(1) + ',' + Y(a.kg).toFixed(1); }).join(' ') + '"/>';
    s += '<polyline class="wline" points="' + pts.map(function (w) { return X(w.id).toFixed(1) + ',' + Y(w.kg).toFixed(1); }).join(' ') + '"/>';
    if (pts.length <= 60) pts.forEach(function (w) { s += '<circle class="pt" cx="' + X(w.id).toFixed(1) + '" cy="' + Y(w.kg).toFixed(1) + '" r="3.2"/>'; });
    s += '<text x="' + L + '" y="' + (H - 6) + '">' + shortDate(start) + '</text><text x="' + (W - R) + '" y="' + (H - 6) + '" text-anchor="end">' + shortDate(end) + '</text></svg>';
    s += '<div class="legend"><span><i style="background:var(--fat)"></i>Gewicht</span>' + (pts.length > 2 ? '<span><i style="background:var(--protein)"></i>7-daags gemiddelde</span>' : '') + (gw > 0 ? '<span><i style="background:var(--brand)"></i>Streefgewicht</span>' : '') + '</div>';
    return s;
  }
  function kcalWeekChart() {
    var t = targets(), days = [], end = todayKey();
    for (var i = 6; i >= 0; i--) { var k = addDays(end, -i); days.push({ k: k, kcal: sumOf(dayEntries(k)).kcal }); }
    var W = 340, H = 150, L = 8, R = 8, T = 14, B = 22, max = Math.max(t.kcal * 1.25, Math.max.apply(null, days.map(function (d) { return d.kcal; })) * 1.05);
    var bw = (W - L - R) / 7, s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Calorieën deze week">';
    var ty = T + (H - T - B) * (1 - t.kcal / max);
    days.forEach(function (d, i) {
      var h = (H - T - B) * d.kcal / max, x = L + i * bw + bw * 0.18;
      s += '<rect class="bar-k' + (d.kcal > t.kcal * 1.05 ? ' over' : '') + '" x="' + x.toFixed(1) + '" y="' + (H - B - h).toFixed(1) + '" width="' + (bw * 0.64).toFixed(1) + '" height="' + Math.max(0, h).toFixed(1) + '" rx="5"/>';
      s += '<text x="' + (x + bw * 0.32).toFixed(1) + '" y="' + (H - 7) + '" text-anchor="middle">' + DAYNAMES[parseKey(d.k).getDay()].slice(0, 2) + '</text>';
    });
    s += '<line class="target" x1="' + L + '" x2="' + (W - R) + '" y1="' + ty.toFixed(1) + '" y2="' + ty.toFixed(1) + '"/></svg>';
    var logged = days.filter(function (d) { return d.kcal > 0; }), avg = logged.length ? logged.reduce(function (a, d) { return a + d.kcal; }, 0) / logged.length : 0;
    return s + '<div class="legend"><span>Gemiddeld <b style="color:var(--text)">' + fmt(avg) + '</b> kcal per dag (' + logged.length + ' van 7 dagen ingevuld) · doel ' + fmt(t.kcal) + '</span></div>';
  }
  function renderProgress() {
    var p = profile() || {}, ws = weightsSorted(), range = ui.range || '3m';
    var first = ws[0], last = ws[ws.length - 1], gw = +p.goalWeight;
    var html = '<div class="page-head"><h1>Voortgang</h1></div>';
    html += '<div class="card"><div class="card-title"><h3>⚖️ Gewicht</h3></div>';
    html += '<div class="stats3"><div><b>' + (first ? fmt(first.kg, 1) : '–') + '</b><span>Start</span></div><div><b>' + (last ? fmt(last.kg, 1) : '–') + '</b><span>Nu</span></div><div><b>' + (gw > 0 ? fmt(gw, 1) : '–') + '</b><span>Doel</span></div></div>';
    if (first && last && ws.length > 1) {
      var diff = last.kg - first.kg;
      html += '<p class="small center" style="margin:10px 0 0">' + (diff <= 0 ? '📉 ' + fmt(-diff, 1) + ' kg kwijt' : '📈 ' + fmt(diff, 1) + ' kg aangekomen') + ' sinds ' + shortDate(first.id) + (gw > 0 ? ' · nog ' + fmt(Math.abs(last.kg - gw), 1) + ' kg te gaan' : '') + '</p>';
    }
    html += '<div class="row mt"><div class="unit-input grow"><input id="w-kg" inputmode="decimal" placeholder="Gewicht" value=""><em>kg</em></div>' +
      '<input id="w-date" type="date" value="' + todayKey() + '" style="width:46%"></div><button class="btn primary block" data-action="weight-add">Gewicht opslaan</button></div>';
    html += '<div class="card"><div class="card-title"><h3>Verloop</h3></div><div class="seg mb">' + [['1m', '1 mnd'], ['3m', '3 mnd'], ['1y', '1 jaar'], ['all', 'Alles']].map(function (r) {
      return '<button data-action="range" data-v="' + r[0] + '" aria-pressed="' + (range === r[0]) + '">' + r[1] + '</button>';
    }).join('') + '</div><div id="weight-chart">' + weightChart(range) + '</div>' + trendText() + '</div>';
    html += '<div class="card"><div class="card-title"><h3>🔥 Calorieën afgelopen 7 dagen</h3></div>' + kcalWeekChart() + '</div>';
    if (ws.length) {
      html += '<div class="card"><div class="card-title"><h3>Metingen</h3></div>' + ws.slice().reverse().slice(0, 30).map(function (w, i, arr) {
        var prev = arr[i + 1], d = prev ? w.kg - prev.kg : null;
        return '<div class="list-item" style="cursor:default"><div class="grow"><div class="li-name">' + fmt(w.kg, 1) + ' kg</div><div class="li-sub">' + esc(relLabel(w.id)) + '</div></div>' +
          (d != null ? '<span class="small" style="color:' + (d <= 0 ? 'var(--brand)' : 'var(--danger)') + '">' + (d > 0 ? '+' : '') + fmt(d, 1) + '</span>' : '') +
          '<button class="icon-btn" style="width:32px;height:32px;font-size:15px" data-action="weight-del" data-id="' + w.id + '" aria-label="Verwijder meting">✕</button></div>';
      }).join('') + '</div>';
    }
    $('view-progress').innerHTML = html;
  }
  function trendText() {
    var p = profile() || {}, ws = weightsSorted(), last = ws[ws.length - 1], gw = +p.goalWeight, tr = weightTrend();
    if (!last) return '';
    var parts = [];
    if (tr) parts.push('Trend laatste 4 weken: <b>' + (tr.perWeek > 0 ? '+' : '') + fmt(tr.perWeek, 2) + ' kg per week</b>.');
    if (gw > 0 && Math.abs(last.kg - gw) >= 0.1) {
      var need = gw - last.kg, rate = tr ? tr.perWeek : null, planned = p.goal === 'lose' ? -(+p.pace || 0.5) : p.goal === 'gain' ? (+p.pace || 0.25) : 0;
      if (rate && Math.sign(rate) === Math.sign(need) && Math.abs(rate) > 0.02) parts.push('Bij dit tempo bereik je ' + fmt(gw, 1) + ' kg rond <b>' + longDate(addDays(todayKey(), Math.round(need / rate * 7))) + '</b>.');
      else if (planned && Math.sign(planned) === Math.sign(need)) parts.push('Volgens je plan (' + fmt(Math.abs(planned), 2) + ' kg/week) bereik je ' + fmt(gw, 1) + ' kg rond <b>' + longDate(addDays(todayKey(), Math.round(need / planned * 7))) + '</b>.');
      if (!tr) parts.push('Weeg je een paar keer per week om je echte trend te zien.');
    } else if (gw > 0) parts.push('🎉 Je hebt je streefgewicht bereikt!');
    return parts.length ? '<div class="note" id="trend-note">' + parts.join(' ') + '</div>' : '';
  }
  function saveWeight(date, kg) {
    put('eten_weights', date, { kg: r1(kg) });
    var p = profile();
    if (p) { var ws = weightsSorted(), latest = ws[ws.length - 1]; if (latest && latest.id === date && p.weight !== r1(kg)) put('eten_profiles', 'me', Object.assign({}, p, { weight: r1(kg) })); }
  }

  // ---------- Profiel ----------
  function renderProfile() {
    var p = profile() || {}, c = calc(p), t = targets(), m = p.manual || {}, pref = themePref();
    var html = '<div class="page-head"><h1>Profiel</h1></div>';
    html += '<div class="card" id="account-card">' + accountHtml() + '</div>';
    html += '<div class="card"><div class="card-title"><h3>Mijn gegevens</h3></div>' +
      '<label class="field"><span>Geslacht</span><div class="seg"><button data-action="p-set" data-k="sex" data-v="m" aria-pressed="' + (p.sex !== 'f') + '">Man</button><button data-action="p-set" data-k="sex" data-v="f" aria-pressed="' + (p.sex === 'f') + '">Vrouw</button></div></label>' +
      '<div class="grid3"><label class="field"><span>Leeftijd</span><div class="unit-input"><input data-p="age" inputmode="numeric" value="' + esc(p.age || '') + '"><em>jr</em></div></label>' +
      '<label class="field"><span>Lengte</span><div class="unit-input"><input data-p="height" inputmode="numeric" value="' + esc(p.height || '') + '"><em>cm</em></div></label>' +
      '<label class="field"><span>Gewicht</span><div class="unit-input"><input data-p="weight" inputmode="decimal" value="' + esc(currentWeight(p) > 0 ? fmt(currentWeight(p), 1) : '') + '"><em>kg</em></div></label></div>' +
      '<label class="field"><span>Activiteit</span><select data-p="activity">' + ACTIVITY.map(function (a) { return '<option value="' + a.id + '"' + ((p.activity || 'light') === a.id ? ' selected' : '') + '>' + a.name + ' – ' + a.desc + '</option>'; }).join('') + '</select></label>' +
      '<label class="field"><span>Doel</span><div class="seg">' + GOALS.map(function (g) { return '<button data-action="p-set" data-k="goal" data-v="' + g.id + '" aria-pressed="' + ((p.goal || 'lose') === g.id) + '">' + g.name + '</button>'; }).join('') + '</div></label>';
    if ((p.goal || 'lose') !== 'keep') {
      var paces = PACES[p.goal || 'lose'];
      html += '<label class="field"><span>Tempo</span><div class="seg">' + paces.map(function (x) { return '<button data-action="p-set" data-k="pace" data-v="' + x + '" aria-pressed="' + (+p.pace === x) + '">' + fmt(x, 2) + ' kg/wk</button>'; }).join('') + '</div></label>';
    }
    html += '<label class="field"><span>Streefgewicht</span><div class="unit-input"><input data-p="goalWeight" inputmode="decimal" value="' + esc(p.goalWeight ? fmt(p.goalWeight, 1) : '') + '" placeholder="optioneel"><em>kg</em></div></label>';
    if (c) html += '<div class="card2" style="margin-top:4px"><div class="kv"><span>BMR (rust)</span><b id="calc-bmr">' + fmt(c.bmr) + ' kcal</b></div><div class="kv"><span>TDEE (totaal)</span><b id="calc-tdee">' + fmt(c.tdee) + ' kcal</b></div><div class="kv"><span>BMI</span><b>' + fmt(c.bmi, 1) + '</b></div><div class="kv"><span>Berekend doel</span><b id="calc-kcal">' + fmt(c.kcal) + ' kcal</b></div></div>' +
      (c.floored ? '<div class="note warn">Berekend doel kwam onder de ' + c.floor + ' kcal; we houden ' + c.floor + ' kcal aan.</div>' : '');
    html += '</div>';
    var mp = t.kcal ? Math.round(t.protein * 4 / t.kcal * 100) : 0, mc = t.kcal ? Math.round(t.carbs * 4 / t.kcal * 100) : 0, mf = t.kcal ? Math.round(t.fat * 9 / t.kcal * 100) : 0;
    var anyManual = Object.keys(m).some(function (k) { return m[k] > 0; });
    html += '<div class="card"><div class="card-title"><h3>Dagdoelen</h3>' + (anyManual ? '<button class="link" data-action="targets-auto">Terug naar automatisch</button>' : '<span class="tiny muted">automatisch</span>') + '</div>' +
      '<p class="tiny muted" style="margin-top:-4px">Leeg = automatisch berekend (grijze waarde). Vul een getal in om het zelf te bepalen.</p>' +
      '<div class="grid2">' +
      targetInput('kcal', 'Calorieën', 'kcal', t, m) + targetInput('protein', 'Eiwit', 'g', t, m) + targetInput('carbs', 'Koolhydraten', 'g', t, m) + targetInput('fat', 'Vet', 'g', t, m) +
      '</div><div class="tiny muted">Verdeling: eiwit ' + mp + '% · koolhydraten ' + mc + '% · vet ' + mf + '%</div>' +
      '<div class="grid2 mt">' + targetInput('water', 'Water', 'ml', t, m) +
      '<label class="field"><span>Glas</span><select data-p="glass">' + [150, 200, 250, 300, 330, 500].map(function (g) { return '<option value="' + g + '"' + (glassSize() === g ? ' selected' : '') + '>' + g + ' ml</option>'; }).join('') + '</select></label></div></div>';
    html += '<div class="card"><div class="card-title"><h3>Weergave</h3></div><div class="seg">' +
      '<button data-theme-opt="auto" data-action="theme" data-v="auto" aria-pressed="' + (pref === 'auto') + '">Automatisch</button>' +
      '<button data-theme-opt="light" data-action="theme" data-v="light" aria-pressed="' + (pref === 'light') + '">Licht</button>' +
      '<button data-theme-opt="dark" data-action="theme" data-v="dark" aria-pressed="' + (pref === 'dark') + '">Donker</button></div>' +
      '<p class="tiny muted">Automatisch volgt de instelling van je iPhone.</p></div>';
    html += '<div class="card"><div class="card-title"><h3>📷 Foto herkennen</h3><span class="flag">binnenkort</span></div><p class="small muted" style="margin:0">Een foto van je bord maken en de app laten herkennen wat erop ligt, komt later. Daarvoor is een AI-dienst nodig die een paar cent per foto kost.</p></div>';
    html += '<div class="card"><div class="card-title"><h3>Gegevens</h3></div><button class="btn block" data-action="redo-onboarding">Doel opnieuw berekenen (stappen)</button><button class="btn block" data-action="export">Exporteer mijn gegevens (JSON)</button></div>';
    if (loggedIn() && window.meSync && window.meSync.backupsHtml) html += '<div class="card" id="backups-card">' + window.meSync.backupsHtml() + '</div>';
    html += '<div class="card" id="sources-card"><div class="card-title"><h3>Bronnen</h3></div><p class="small muted" style="margin:0 0 6px">Basisproducten (NEVO): <b>Bron: NEVO-online versie 2025/9.0, RIVM, Bilthoven</b>. De voedingswaarden zijn ongewijzigd overgenomen; portiegroottes bij basisproducten (zoals 1 stuk of 1 snee) zijn schattingen van Mijn Eten en geen NEVO-gegevens. Meest recente versie: <a href="https://www.rivm.nl/nevo" target="_blank" rel="noopener">rivm.nl/nevo</a>.</p><p class="small muted" style="margin:0">Merkproducten: © Open Food Facts-bijdragers (ODbL).</p></div>';
    html += '<div class="version">Mijn Eten ' + VERSION + ' · voedingsdata: NEVO-online 2025/9.0 (RIVM) en Open Food Facts (ODbL)</div>';
    $('view-profile').innerHTML = html;
    if (window.meSync && window.meSync.paintStatus) window.meSync.paintStatus();
    if (window.meSync && window.meSync.refreshBackups && loggedIn()) window.meSync.refreshBackups();
  }
  function targetInput(k, label, unit, t, m) {
    return '<label class="field"><span>' + label + '</span><div class="unit-input"><input data-target="' + k + '" inputmode="numeric" value="' + (m[k] > 0 ? m[k] : '') + '" placeholder="' + fmt(t[k]) + '"><em>' + unit + '</em></div></label>';
  }
  function accountHtml() {
    var s = window.meSync, u = s && s.user && s.user();
    if (u) return '<div class="card-title"><h3>Account</h3><span class="sync-pill"></span></div><div class="small">Ingelogd als <b id="account-email">' + esc(u.email || '') + '</b></div>' +
      '<div class="row mt"><button class="btn sm grow" data-action="sync-now">Nu synchroniseren</button><button class="btn sm danger grow" data-action="logout">Uitloggen</button></div>';
    return '<div class="card-title"><h3>Account</h3></div><p class="small muted" style="margin:0 0 4px">Je gegevens staan nu alleen op dit toestel. Log in om ze veilig te bewaren en op meerdere toestellen te gebruiken.</p>' +
      '<button class="btn primary block" data-action="open-auth">Inloggen of account maken</button>';
  }
  function updateProfile(patch) {
    var p = Object.assign({}, profile() || {}, patch);
    put('eten_profiles', 'me', p);
  }

  // ---------- Sheet ----------
  var sheetCtx = null;
  function openSheet(html, opts) {
    opts = opts || {};
    $('sheet-inner').innerHTML = '<div class="sheet-grab"></div>' + html;
    $('sheet').classList.toggle('full', !!opts.full);
    $('sheet').classList.add('open'); $('backdrop').classList.add('open');
    $('sheet-inner').scrollTop = 0;
    if (opts.focus) setTimeout(function () { var f = $(opts.focus); if (f) f.focus(); }, 350);
  }
  function closeSheet() {
    if (sheetCtx && sheetCtx.onClose) { try { sheetCtx.onClose(); } catch (e) {} }
    stopScan(); abortSearch();
    sheetCtx = null;
    $('sheet').classList.remove('open'); $('backdrop').classList.remove('open');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }
  window.closeSheet = closeSheet;
  function sheetHead(title, back) {
    return '<div class="sheet-head">' + (back ? '<button class="link" data-action="' + back + '">‹ Terug</button>' : '<span style="width:40px"></span>') + '<h2 class="grow center ellipsis">' + esc(title) + '</h2><button class="icon-btn" data-action="close-sheet" aria-label="Sluiten">✕</button></div>';
  }
  function mealName(id) { return (MEALS.filter(function (m) { return m.id === id; })[0] || MEALS[3]).name; }
  function defaultMeal() {
    var h = new Date().getHours();
    return h < 10 ? 'breakfast' : h < 14 ? 'lunch' : h >= 17 && h < 21 ? 'dinner' : 'snack';
  }

  // ---------- Producten ----------
  function foodKcal(f) { return f.per100 ? +f.per100.kcal || 0 : 0; }
  function savedFoods() { return liveVals('foods'); }
  function barcodeVariants(code) {
    code = String(code).replace(/\D/g, ''); var v = [code];
    if (code.length === 12) v.push('0' + code);
    if (code.length === 13 && code.charAt(0) === '0') v.push(code.slice(1));
    return v;
  }
  function findFoodByBarcode(code) {
    var alts = barcodeVariants(code);
    return savedFoods().filter(function (f) { return f.barcode && alts.indexOf(String(f.barcode)) >= 0; })[0] || null;
  }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  function localMatches(q) {
    var words = norm(q).split(/\s+/).filter(Boolean); if (!words.length) return [];
    return savedFoods().filter(function (f) { var hay = norm(f.name + ' ' + (f.brand || '') + ' ' + (f.syn || '')); return words.every(function (w) { return hay.indexOf(w) >= 0; }); })
      .sort(function (a, b) { return (b.useCount || 0) - (a.useCount || 0); }).slice(0, 15);
  }
  function foodIdOf(f) { return f.id && !/^tmp:/.test(f.id) ? f.id : (f.code ? 'off-' + f.code : null); }
  function rememberFood(f, used) {
    var id = foodIdOf(f) || ('own-' + uid());
    var cur = getLive('foods', id) || {};
    var data = {
      name: f.name, brand: f.brand || '', barcode: f.barcode || f.code || '', source: f.source || cur.source || 'off', image: f.image || cur.image || '',
      per100: f.per100, serving: f.serving || null, favorite: f.favorite != null ? !!f.favorite : !!cur.favorite,
      useCount: (cur.useCount || 0) + (used ? 1 : 0), lastUsed: used ? new Date().toISOString() : (cur.lastUsed || '')
    };
    if (data.source === 'nevo') { data.syn = f.syn != null ? f.syn : (cur.syn || ''); data.group = f.group || cur.group || ''; data.ml = f.ml != null ? !!f.ml : !!cur.ml; data.servingEst = !!(f.serving && (f.servingEst != null ? f.servingEst : cur.servingEst)); }
    put('eten_foods', id, data);
    return Object.assign({ id: id }, data);
  }


  // ---------- NEVO (RIVM) basisproducten: lokaal, offline, direct ----------
  // Bron: NEVO-online versie 2025/9.0, RIVM, Bilthoven. Waarden ongewijzigd overgenomen (selectie van kolommen).
  // Portiegroottes ("p" in het bestand) zijn een aanvulling/schatting van Mijn Eten, geen NEVO-gegevens.
  var NEVO_URL = 'data/nevo.json', NEVO_SRC = 'NEVO-online versie 2025/9.0, RIVM, Bilthoven';
  var nevo = { status: 'idle', data: null, idx: null, promise: null };
  var NEVO_ABBR = { z: 'zonder', m: 'met', gem: 'gemiddeld', v: 'van', ed: 'en dergelijke', p: 'per', verz: 'verzadigd', onb: 'onbereid', obv: 'op basis van', vetz: 'vetzuren' };
  var NEVO_NICHE = ['glutenvrij', 'bakmix', 'baby', 'dreumes', 'peuter', 'zuigeling', 'opvolg', 'moedermelk', 'borstvoeding', 'sondevoeding', 'flesvoeding'];
  function nvNorm(x) { return norm(x).replace(/[^a-z0-9%]+/g, ' ').trim(); }
  function nvWords(x) { var out = []; nvNorm(x).split(' ').forEach(function (w) { if (!w) return; var a = NEVO_ABBR[w]; if (a) a.split(' ').forEach(function (y) { out.push(y); }); else out.push(w); }); return out; }
  function nvStem(t) { var x = t; if (x.length > 4) x = x.replace(/(en|s|e)$/, ''); return x.replace(/([bdfgklmnprst])\1$/, '$1'); }
  function ensureNevo() {
    if (nevo.promise) return nevo.promise;
    nevo.status = 'loading';
    nevo.promise = fetch(NEVO_URL).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (d) {
      nevo.data = d; if (d.bron) NEVO_SRC = d.bron;
      nevo.idx = d.f.map(function (r) { var nw = nvWords(r[1]), sw = nvWords(r[2]); return { r: r, nw: nw, sw: sw, gw: nvWords(d.groups[r[3]] || ''), all: nw.join(' ') + ' ' + sw.join(' ') }; });
      nevo.status = 'ready'; if (sheetCtx && sheetCtx.type === 'add') renderAddList();
      return nevo;
    }).catch(function (e) { nevo.status = 'error'; nevo.promise = null; if (sheetCtx && sheetCtx.type === 'add') renderAddList(); throw e; });
    return nevo.promise;
  }
  function nvTok(t, nw, sw) {
    var best = 0, i, w;
    function up(v) { if (v > best) best = v; }
    for (i = 0; i < nw.length; i++) { w = nw[i];
      if (w === t) up(10 + (i === 0 ? 3 : 0));
      else if (w.indexOf(t) === 0) up((/^(t?jes?|s)$/.test(w.slice(t.length)) ? 6 : 7) + (i === 0 ? 2 : 0) - Math.min(2, (w.length - t.length) / 4));
      else if (t.length >= 3 && w.length > t.length && w.slice(-t.length) === t) up(i === 0 ? 8 : 5);
      else if (t.length >= 3 && w.indexOf(t) > 0) up(2); }
    for (i = 0; i < sw.length; i++) { w = sw[i];
      if (w === t) up(8);
      else if (w.indexOf(t) === 0) up(6 - Math.min(2, (w.length - t.length) / 4));
      else if (t.length >= 3 && w.length > t.length && w.slice(-t.length) === t) up(4);
      else if (t.length >= 3 && w.indexOf(t) > 0) up(1.5); }
    return best;
  }
  function nevoSearch(q, max) {
    if (nevo.status !== 'ready') return [];
    var toks = nvWords(q); if (!toks.length || nvNorm(q).length < 2) return [];
    var qs = toks.join(' '), res = [];
    nevo.idx.forEach(function (e) {
      var total = 0, inName = 0;
      for (var k = 0; k < toks.length; k++) {
        var t = toks[k], sc = nvTok(t, e.nw, e.sw), st = nvStem(t);
        if (st !== t && st.length >= 3) sc = Math.max(sc, nvTok(st, e.nw, e.sw) - 1);
        if (t.length < 3 && sc < 7) sc = 0;
        if (!sc) return;
        total += sc; if (nvTok(t, e.nw, []) >= 5) inName++;
      }
      if (inName === toks.length) total += 3;
      if (toks.some(function (t) { return e.gw.indexOf(t) >= 0 || e.gw.indexOf(nvStem(t)) >= 0; })) total += 2;
      total -= e.nw.length * 0.35;
      if (e.nw.indexOf('gemiddeld') >= 0) total += 0.8;
      if (e.nw.indexOf('gekookt') >= 0 || e.nw.indexOf('bereid') >= 0) total += 0.6;
      for (var n = 0; n < NEVO_NICHE.length; n++) if (e.all.indexOf(NEVO_NICHE[n]) >= 0 && qs.indexOf(NEVO_NICHE[n]) < 0) { total -= 5; break; }
      res.push({ e: e, s: total });
    });
    res.sort(function (a, b) { return b.s - a.s || a.e.r[1].length - b.e.r[1].length; });
    return res.slice(0, max || 25).map(function (x) { return nevoToFood(x.e.r); });
  }
  function nevoToFood(r) {
    var d = nevo.data, p = d.p && d.p[String(r[0])];
    var saved = getLive('foods', 'nevo-' + r[0]);
    return {
      id: 'nevo-' + r[0], code: '', barcode: '', name: r[1], brand: '', syn: r[2] || '', group: d.groups[r[3]] || '', source: 'nevo', image: '',
      per100: { kcal: r[4], protein: r[5] || 0, carbs: r[6] || 0, fat: r[7] || 0 }, fiber: r[8], ml: !!r[9],
      serving: p ? { grams: p[1], label: p[0] } : null, servingEst: !!p, favorite: saved ? !!saved.favorite : false
    };
  }
  window.__meNevo = { ensure: ensureNevo, search: nevoSearch, state: function () { return nevo; }, src: function () { return NEVO_SRC; } };

  // ---------- Open Food Facts ----------
  var OFF_FIELDS = 'code,product_name,product_name_nl,generic_name_nl,brands,nutriments,serving_size,serving_quantity,image_front_small_url,image_small_url,countries_tags,quantity';
  // Fout met soort: 'timeout' | 'http' (status) | 'network' (o.a. CORS bij een 503 van OFF) | 'abort' | 'noproxy' | 'proxy' | 'ratelimit'
  function offErr(kind, status, msg) { var e = new Error(msg || (status ? 'HTTP ' + status : kind)); e.kind = kind; e.status = status || 0; return e; }
  // Voert fn(signal) uit met een eigen time-out; een extern signaal (nieuwe zoekopdracht / sheet dicht) breekt ook af.
  function withTimeout(fn, ms, outer) {
    var ctl = window.AbortController ? new AbortController() : null, timedOut = false;
    if (outer && outer.aborted) return Promise.reject(offErr('abort'));
    function onOuter() { if (ctl) ctl.abort(); }
    if (outer) outer.addEventListener('abort', onOuter);
    var to = setTimeout(function () { timedOut = true; if (ctl) ctl.abort(); }, ms || 12000);
    function done() { clearTimeout(to); if (outer) outer.removeEventListener('abort', onOuter); }
    return Promise.resolve().then(function () { return fn(ctl ? ctl.signal : undefined); }).then(function (v) { done(); return v; }, function (e) {
      done();
      if (outer && outer.aborted) throw offErr('abort');
      if (timedOut) throw offErr('timeout');
      if (e && e.kind) throw e;
      throw offErr('network', 0, e && e.message);
    });
  }
  function fetchJson(url, ms, outer) {
    return withTimeout(function (signal) {
      return fetch(url, signal ? { signal: signal } : {}).then(function (r) {
        if (!r.ok) throw offErr('http', r.status);
        return r.json().catch(function () { throw offErr('http', r.status, 'Geen JSON'); });
      });
    }, ms, outer);
  }
  function sleep(ms, outer) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { if (outer) outer.removeEventListener('abort', ab); res(); }, ms);
      function ab() { clearTimeout(t); rej(offErr('abort')); }
      if (outer) { if (outer.aborted) return ab(); outer.addEventListener('abort', ab); }
    });
  }
  function offToFood(p) {
    if (!p) return null;
    var n = p.nutriments || {};
    var kcal = n['energy-kcal_100g'];
    if (kcal == null || kcal === '') { var kj = n['energy-kj_100g'] != null ? n['energy-kj_100g'] : n['energy_100g']; if (kj != null && kj !== '') kcal = num(kj) / 4.184; }
    kcal = num(kcal);
    var brand = Array.isArray(p.brands) ? p.brands[0] : String(p.brands || '').split(',')[0];
    var name = String(p.product_name_nl || p.product_name || p.generic_name_nl || '').trim();
    if (!name || !isFinite(kcal)) return null;
    var sq = num(p.serving_quantity);
    var countries = p.countries_tags || [];
    return {
      id: 'tmp:' + p.code, code: String(p.code || ''), barcode: String(p.code || ''), name: name, brand: String(brand || '').trim(), source: 'off',
      image: p.image_front_small_url || p.image_small_url || '',
      per100: { kcal: r1(kcal), protein: r1(num(n.proteins_100g) || 0), carbs: r1(num(n.carbohydrates_100g) || 0), fat: r1(num(n.fat_100g) || 0) },
      serving: sq > 0 && sq < 2000 ? { grams: sq, label: String(p.serving_size || '').trim() || 'portie' } : null,
      local: countries.indexOf('en:netherlands') >= 0,                                   // in Nederland verkocht
      be: countries.indexOf('en:belgium') >= 0 && countries.indexOf('en:netherlands') < 0  // alleen België (kan via barcode)
    };
  }
  // nlOnly: zoekresultaten alleen Nederlandse producten (countries_tags bevat en:netherlands). Barcode blijft onbeperkt.
  function rankOff(list, nlOnly) {
    var seen = {}, out = [];
    list.forEach(function (p, i) { var f = offToFood(p); if (f && !seen[f.code] && (!nlOnly || f.local)) { seen[f.code] = 1; f._i = i; out.push(f); } });
    out.sort(function (a, b) { return (b.local ? 1 : 0) - (a.local ? 1 : 0) || a._i - b._i; });
    return out;
  }
  // --- Zoeken: cache, rate-limit, Supabase-proxy (search-a-licious) en cgi/search.pl met één herkansing ---
  var OFF_CFG = { cgiTimeout: 15000, proxyTimeout: 12000, retryDelay: 2500, cacheTtl: 12 * 3600 * 1000, cacheMax: 25, rateMax: 8, rateWindow: 60000, proxyMissingMs: 30 * 60 * 1000, probeTimeout: 5000 };
  var OFF_CACHE_KEY = 'mijnEten.offCacheNL', OFF_RATE_KEY = 'mijnEten.offRate', OFF_PROXY_KEY = 'mijnEten.offProxyMissing';
  var offMem = {};
  try { localStorage.removeItem('mijnEten.offCache'); } catch (e) {}   // oude cache (v3) bevatte ook niet-NL-producten
  var OFF_NL_QUERY = 'countries_tags:"en:netherlands" ';   // search-a-licious-filter, vóór de zoekterm (server kapt na 80 tekens af)
  function offKey(q) { return String(q || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function lsGet(k, def) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? def : v; } catch (e) { return def; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function offCacheGet(q) {
    var k = offKey(q), e = offMem[k];
    if (!e) e = lsGet(OFF_CACHE_KEY, {})[k];
    if (e && Date.now() - e.t < OFF_CFG.cacheTtl && Array.isArray(e.r)) { offMem[k] = e; return e.r.map(function (f) { return Object.assign({}, f); }); }
    return null;
  }
  function offCachePut(q, r) {
    var k = offKey(q), e = { t: Date.now(), r: r }; offMem[k] = e;
    var all = lsGet(OFF_CACHE_KEY, {}); all[k] = e;
    var keys = Object.keys(all).filter(function (x) { return all[x] && Date.now() - all[x].t < OFF_CFG.cacheTtl; }).sort(function (a, b) { return all[b].t - all[a].t; }).slice(0, OFF_CFG.cacheMax);
    var keep = {}; keys.forEach(function (x) { keep[x] = all[x]; }); lsSet(OFF_CACHE_KEY, keep);
  }
  // OFF staat ±10 zoekopdrachten per minuut per IP toe; wij blijven daar ruim onder.
  function cgiRecent() { var now = Date.now(); return lsGet(OFF_RATE_KEY, []).filter(function (t) { return now - t < OFF_CFG.rateWindow; }); }
  function cgiWaitMs() { var r = cgiRecent(); return r.length < OFF_CFG.rateMax ? 0 : Math.max(1000, OFF_CFG.rateWindow - (Date.now() - Math.min.apply(null, r))); }
  function cgiNote() { var r = cgiRecent(); r.push(Date.now()); lsSet(OFF_RATE_KEY, r); }
  function proxyUsable() {
    var s = window.meSync;
    if (!s || typeof s.offSearch !== 'function' || !s.user || !s.user()) return false;
    return Date.now() - (+lsGet(OFF_PROXY_KEY, 0) || 0) > OFF_CFG.proxyMissingMs;
  }
  function viaProxy(q, outer) {
    return withTimeout(function (signal) { return window.meSync.offSearch(OFF_NL_QUERY + q, signal); }, OFF_CFG.proxyTimeout, outer)
      .then(function (d) { if (!d || !Array.isArray(d.hits)) throw offErr('proxy', 0, 'Leeg antwoord'); return d.hits; });
  }
  function viaCgi(q, outer) {
    var url = 'https://world.openfoodfacts.org/cgi/search.pl?search_terms=' + encodeURIComponent(q) + '&search_simple=1&action=process&json=1&page_size=30&lc=nl&tagtype_0=countries&tag_contains_0=contains&tag_0=en%3Anetherlands&fields=' + OFF_FIELDS;
    cgiNote();
    return fetchJson(url, OFF_CFG.cgiTimeout, outer).then(function (d) { return d.products || []; });
  }
  // Bereikbaarheidstest: no-cors lukt bij elke HTTP-status (ook 503), faalt alleen zonder verbinding.
  function offProbe() {
    if (navigator.onLine === false) return Promise.resolve(false);
    return withTimeout(function (signal) { return fetch('https://world.openfoodfacts.org/favicon.ico?p=' + Date.now(), { mode: 'no-cors', cache: 'no-store', signal: signal }); }, OFF_CFG.probeTimeout)
      .then(function () { return true; }, function () { return false; });
  }
  function offSearch(q, outer, onStep) {
    var cached = offCacheGet(q);
    if (cached) return Promise.resolve(cached);
    var plan = proxyUsable() ? ['proxy', 'cgi'] : ['cgi', 'cgi'];   // max. 2 echte pogingen
    var errors = [], tries = 0;
    function finish() {
      var e;
      if (navigator.onLine === false) return Promise.reject(offErr('offline'));
      var rl = errors.filter(function (x) { return x.kind === 'ratelimit'; })[0];
      if (rl && errors.every(function (x) { return x.kind === 'ratelimit' || x.kind === 'noproxy'; })) return Promise.reject(rl);
      var allNet = errors.length && errors.every(function (x) { return x.kind === 'network' || x.kind === 'noproxy' || x.kind === 'ratelimit'; });
      return (allNet ? offProbe() : Promise.resolve(true)).then(function (online) {
        e = offErr(online ? (errors.some(function (x) { return x.status === 429; }) ? 'ratelimit' : 'busy') : 'offline');
        if (e.kind === 'ratelimit') e.wait = cgiWaitMs() || 30000;
        e.errors = errors; throw e;
      });
    }
    function step(i) {
      if (i >= plan.length) return finish();
      var src = plan[i], p;
      if (src === 'proxy') p = viaProxy(q, outer);
      else {
        var wait = cgiWaitMs();
        if (wait > 0) { var rl = offErr('ratelimit'); rl.wait = wait; errors.push(rl); return step(i + 1); }
        p = (i > 0 && plan[i - 1] === 'cgi' ? sleep(OFF_CFG.retryDelay, outer) : Promise.resolve()).then(function () { return viaCgi(q, outer); });
      }
      if (tries > 0 && onStep) onStep(tries, src);
      tries++;
      return p.then(function (list) { var r = rankOff(list, true); offCachePut(q, r); return r; }, function (e) {
        if (e.kind === 'abort' || (outer && outer.aborted)) throw offErr('abort');
        errors.push(e);
        if (e.kind === 'noproxy') { lsSet(OFF_PROXY_KEY, Date.now()); tries--; if (plan.length < 3) plan.push('cgi'); }
        return step(i + 1);
      });
    }
    return step(0);
  }
  function offMessage(e) {
    if (e.kind === 'offline') return 'Geen internetverbinding. Je eigen en recente producten werken wel, en je kunt een product zelf aanmaken.';
    if (e.kind === 'ratelimit') { var s = Math.max(5, Math.ceil((e.wait || 30000) / 1000)); return 'Je hebt net vaak achter elkaar gezocht. Open Food Facts staat maar een paar zoekopdrachten per minuut toe. Probeer het over ' + s + ' seconden opnieuw.'; }
    return 'Open Food Facts is nu erg druk en gaf geen antwoord (dat ligt niet aan jou of de app). Probeer het over een halve minuut opnieuw, of maak het product zelf aan.';
  }
  function offBarcode(code) {
    var variants = barcodeVariants(code), i = 0;
    function next() {
      if (i >= variants.length) return Promise.resolve(null);
      var c = variants[i++];
      return fetchJson('https://world.openfoodfacts.org/api/v2/product/' + encodeURIComponent(c) + '.json?fields=' + OFF_FIELDS, 12000)
        .then(function (d) { if (d && d.status === 1 && d.product) { d.product.code = d.product.code || c; var f = offToFood(d.product); if (f) return f; } return next(); })
        .catch(function (e) { if (/HTTP 404/.test(e && e.message)) return next(); throw e; });
    }
    return next();
  }
  window.__meOff = { offToFood: offToFood, rankOff: rankOff, offSearch: offSearch, offMessage: offMessage, cfg: OFF_CFG, cacheGet: offCacheGet, cgiWaitMs: cgiWaitMs };

  // ---------- Toevoegen ----------
  function openAdd(meal) {
    sheetCtx = { type: 'add', meal: meal || defaultMeal(), date: curDate, q: '', results: null, loading: false, error: '', tab: ui.addTab || 'recent', list: [] };
    renderAdd();
  }
  function renderAdd() {
    var c = sheetCtx;
    var html = sheetHead('Toevoegen') +
      '<div class="seg mb">' + MEALS.map(function (m) { return '<button data-action="add-meal" data-v="' + m.id + '" aria-pressed="' + (c.meal === m.id) + '">' + m.name.replace('Tussendoortjes', 'Snack') + '</button>'; }).join('') + '</div>' +
      '<form class="searchbar" data-form="search" autocomplete="off"><input id="add-q" type="search" enterkeyhint="search" placeholder="Zoek product, bijv. yoghurt" value="' + esc(c.q) + '"><button class="btn primary" type="submit">Zoek</button></form>' +
      '<div class="quick-actions">' +
      '<button class="qa" data-action="scan"><span>▥</span><span>Barcode</span></button>' +
      '<button class="qa" data-action="manual"><span>✏️</span><span>Zelf aanmaken</span></button>' +
      '<button class="qa" data-action="quick"><span>⚡</span><span>Snel kcal</span></button>' +
      '<button class="qa" data-action="photo"><span>📷</span><span>Foto</span></button></div>' +
      '<div id="add-list"></div>';
    openSheet(html, { full: true });
    renderAddList();
  }
  function foodRow(f, i) {
    var thumb = f.image ? '<img class="thumb" loading="lazy" src="' + esc(f.image) + '" alt="" onerror="this.style.visibility=\'hidden\'">' : '<span class="thumb">' + (f.source === 'custom' ? '✏️' : f.source === 'nevo' ? '🥕' : '🍽️') + '</span>';
    var sub = f.source === 'nevo' ? (f.syn || f.group || 'Basisproduct') : (f.brand || (f.source === 'custom' ? 'Eigen product' : ''));
    return '<div class="list-item" data-action="pick" data-i="' + i + '">' + thumb + '<div class="grow"><div class="li-name ellipsis">' + esc(f.name) + (f.favorite ? ' <span style="color:#f59e0b">★</span>' : '') + (f.be ? '<span class="flag">BE</span>' : '') + '</div><div class="li-sub ellipsis">' + (f.source === 'nevo' ? '<span class="flag nevo flag-lead">NEVO</span>' : '') + esc(sub) + '</div></div>' +
      '<div class="li-kcal">' + fmt(foodKcal(f)) + ' kcal<small>per 100 ' + (f.ml ? 'ml' : 'g') + '</small></div></div>';
  }
  function renderAddList() {
    var c = sheetCtx, el = $('add-list'); if (!c || c.type !== 'add' || !el) return;
    var html = '', list = [];
    var q = ($('add-q') ? $('add-q').value : c.q || '').trim();
    if (q) {
      var loc = localMatches(q);
      if (loc.length) { html += '<h3 class="mt">Mijn producten & recent</h3>'; loc.forEach(function (f) { html += foodRow(f, list.length); list.push(f); }); }
      var nv = [];
      if (q.length >= 2) {
        if (nevo.status === 'idle') ensureNevo().catch(function () {});
        var haveIds = {}; loc.forEach(function (f) { haveIds[f.id] = 1; });
        nv = nevoSearch(q, 40).filter(function (f) { return !haveIds[f.id]; });
        var nvShow = c.nevoAll ? nv : nv.slice(0, 8);
        if (nevo.status === 'loading') html += '<div class="tiny muted mt" id="nevo-loading">Basisproducten laden…</div>';
        else if (nv.length) {
          html += '<h3 class="mt" id="nevo-head">Basisproducten <span class="tiny muted">(NEVO)</span></h3><div id="nevo-list">';
          nvShow.forEach(function (f) { html += foodRow(f, list.length); list.push(f); });
          html += '</div>';
          if (nv.length > nvShow.length) html += '<div class="center"><button class="btn sm ghost" data-action="nevo-more">Meer basisproducten (' + (nv.length - nvShow.length) + ')</button></div>';
        }
      }
      if (c.loading) html += '<div class="spinner"></div><div class="center tiny muted" id="search-step">' + esc(c.step || 'Zoeken in Open Food Facts…') + '</div>';
      else if (c.error && c.errorKind === 'short') html += '<div class="empty" id="search-error" data-kind="short">' + esc(c.error) + '</div>';
      else if (c.error) html += '<div class="empty" id="search-error" data-kind="' + esc(c.errorKind || 'busy') + '">' + (c.errorKind === 'offline' ? '📡 ' : '⏳ ') + esc(c.error) + '<br>' + (c.errorKind === 'offline' ? '' : '<button class="btn sm mt" data-action="search-go">Opnieuw proberen</button> ') + '<button class="btn sm mt" data-action="manual">Zelf aanmaken</button></div>';
      else if (c.results && c.resultsFor === q) {
        var have = {}; list.forEach(function (f) { if (f.barcode) have[f.barcode] = 1; });
        var offl = c.results.filter(function (f) { return !have[f.code]; });
        html += '<h3 class="mt">Open Food Facts</h3>';
        if (!offl.length) html += '<div class="empty">Niets (nieuws) gevonden voor "' + esc(q) + '".<br><button class="btn sm mt" data-action="manual">Zelf aanmaken</button></div>';
        offl.forEach(function (f) { var saved = getLive('foods', 'off-' + f.code); f.favorite = saved ? !!saved.favorite : false; html += foodRow(f, list.length); list.push(f); });
      } else if (!loc.length && !nv.length) html += '<div class="empty">Tik op <b>Zoek</b> om ook in Open Food Facts (merkproducten) te zoeken.</div>';
      else html += '<div class="center mt"><button class="btn sm" data-action="search-go">Zoek ook merkproducten in Open Food Facts</button></div>';
    } else {
      var tab = c.tab;
      html += '<div class="seg mt mb">' + [['recent', 'Recent'], ['fav', 'Favorieten'], ['mine', 'Mijn producten']].map(function (t) { return '<button data-action="add-tab" data-v="' + t[0] + '" aria-pressed="' + (tab === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</div>';
      var foods = savedFoods();
      if (tab === 'fav') foods = foods.filter(function (f) { return f.favorite; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'nl'); });
      else if (tab === 'mine') foods = foods.filter(function (f) { return f.source === 'custom'; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'nl'); });
      else foods = foods.filter(function (f) { return f.lastUsed; }).sort(function (a, b) { return a.lastUsed < b.lastUsed ? 1 : -1; }).slice(0, 30);
      if (!foods.length) html += '<div class="empty">' + ({ recent: 'Nog niets gegeten met de app. Zoek een product of scan een barcode.', fav: 'Nog geen favorieten. Tik op ☆ bij een product.', mine: 'Nog geen eigen producten. Kies "Zelf aanmaken".' })[tab === 'fav' || tab === 'mine' ? tab : 'recent'] + '</div>';
      foods.forEach(function (f) { html += foodRow(f, list.length); list.push(f); });
    }
    c.list = list; el.innerHTML = html;
  }
  var searchCtl = null;
  function abortSearch() { if (searchCtl) { try { searchCtl.abort(); } catch (e) {} searchCtl = null; } }
  function doSearch() {
    var c = sheetCtx; if (!c || c.type !== 'add') return;
    var q = ($('add-q').value || '').trim(); c.q = q; if (!q) { renderAddList(); return; }
    if (nevo.status === 'idle') ensureNevo().catch(function () {});
    if (c.loading && c.loadingFor === q) return;                       // dubbel tikken: lopende zoekopdracht houden
    if (c.results && c.resultsFor === q && !c.error) { renderAddList(); return; }
    abortSearch();
    c.error = ''; c.errorKind = ''; c.step = '';
    if (q.length < 2) { c.loading = false; c.error = 'Typ minstens 2 letters om te zoeken.'; c.errorKind = 'short'; renderAddList(); return; }
    var cached = offCacheGet(q);
    if (cached) { c.loading = false; c.results = cached; c.resultsFor = q; renderAddList(); return; }
    if (navigator.onLine === false) { c.loading = false; c.error = offMessage({ kind: 'offline' }); c.errorKind = 'offline'; renderAddList(); return; }
    var ctl = searchCtl = window.AbortController ? new AbortController() : null;
    c.loading = true; c.loadingFor = q; renderAddList();
    var token = c.token = {};
    function stale() { return sheetCtx !== c || c.token !== token; }
    offSearch(q, ctl ? ctl.signal : undefined, function () {
      if (stale()) return; c.step = 'Open Food Facts reageert traag, ik probeer het nog een keer…'; renderAddList();
    }).then(function (res) {
      if (searchCtl === ctl) searchCtl = null;
      if (stale()) return;
      c.loading = false; c.step = ''; c.results = res; c.resultsFor = q; renderAddList();
    }).catch(function (e) {
      if (searchCtl === ctl) searchCtl = null;
      if (stale() || (e && e.kind === 'abort')) return;
      c.loading = false; c.step = ''; c.error = offMessage(e || {}); c.errorKind = (e && e.kind) || 'busy'; renderAddList();
    });
  }

  // ---------- Portie ----------
  function openPortion(food, opts) {
    opts = opts || {};
    var prev = sheetCtx && sheetCtx.type === 'add' ? sheetCtx : null;
    var e = opts.entry;
    var unit = e ? (e.unit === 'serving' && food.serving ? 'serving' : 'g') : (food.serving ? 'serving' : 'g');
    var qty = e ? (unit === 'serving' ? e.qty : e.grams) : (food.serving ? 1 : 100);
    sheetCtx = { type: 'portion', food: food, entry: e || null, meal: e ? e.meal : (opts.meal || (prev && prev.meal) || defaultMeal()), date: e ? e.date : curDate, unit: unit, qty: qty, back: prev };
    renderPortion();
  }
  function portionGrams() { var c = sheetCtx, q = num($('p-qty') ? $('p-qty').value : c.qty); if (!isFinite(q)) q = 0; return c.unit === 'serving' && c.food.serving ? q * c.food.serving.grams : q; }
  function renderPortion() {
    var c = sheetCtx, f = c.food, fid = foodIdOf(f), saved = fid ? getLive('foods', fid) : null;
    var fav = saved ? !!saved.favorite : !!f.favorite;
    var html = sheetHead(c.entry ? 'Aanpassen' : 'Hoeveelheid', c.back ? 'portion-back' : null);
    html += '<div class="row">' + (f.image ? '<img class="thumb" src="' + esc(f.image) + '" alt="" onerror="this.style.visibility=\'hidden\'">' : '<span class="thumb">' + (f.source === 'custom' ? '✏️' : f.source === 'nevo' ? '🥕' : '🍽️') + '</span>') +
      '<div class="grow"><div class="li-name" id="p-name">' + esc(f.name) + (f.source === 'nevo' ? '<span class="flag nevo">NEVO</span>' : '') + '</div><div class="li-sub">' + esc(f.source === 'nevo' ? (f.syn || f.group || 'Basisproduct') : (f.brand || (f.source === 'custom' ? 'Eigen product' : ''))) + (f.barcode ? ' · ' + esc(f.barcode) : '') + '</div></div>' +
      '<button class="star" data-action="fav" aria-pressed="' + fav + '" aria-label="Favoriet">' + (fav ? '★' : '☆') + '</button></div>';
    html += '<div class="nutri-grid" id="p-nutri"></div>';
    html += '<div class="grid2"><label class="field"><span>Hoeveelheid</span><input id="p-qty" inputmode="decimal" value="' + esc(String(r1(c.qty)).replace('.', ',')) + '"></label>' +
      '<label class="field"><span>Eenheid</span><select id="p-unit"><option value="g"' + (c.unit === 'g' ? ' selected' : '') + '>' + (f.ml ? 'ml' : 'gram') + '</option>' +
      (f.serving ? '<option value="serving"' + (c.unit === 'serving' ? ' selected' : '') + '>' + esc(f.serving.label || 'portie') + ' (' + fmt(f.serving.grams) + (f.ml ? ' ml' : ' g') + ')</option>' : '') + '</select></label></div>';
    html += '<div class="row wrap" style="gap:6px;margin:-4px 0 12px">' + (c.unit === 'g' ? [50, 100, 150, 200, 250] : [0.5, 1, 1.5, 2, 3]).map(function (v) { return '<button class="btn sm" data-action="p-quick" data-v="' + v + '">' + fmt(v, 1) + (c.unit === 'g' ? ' g' : '×') + '</button>'; }).join('') + '</div>';
    html += '<label class="field"><span>Maaltijd</span><select id="p-meal">' + MEALS.map(function (m) { return '<option value="' + m.id + '"' + (c.meal === m.id ? ' selected' : '') + '>' + m.name + '</option>'; }).join('') + '</select></label>';
    html += '<div class="tiny muted">Per 100 ' + (f.ml ? 'ml' : 'g') + ': ' + fmt(f.per100.kcal) + ' kcal · eiwit ' + fmt(f.per100.protein, 1) + ' g · koolh. ' + fmt(f.per100.carbs, 1) + ' g · vet ' + fmt(f.per100.fat, 1) + ' g</div>';
    if (f.source === 'nevo') html += '<div class="tiny muted" id="nevo-src" style="margin-top:4px">Bron: ' + esc(NEVO_SRC) + (f.servingEst ? '. Portiegrootte is een schatting van Mijn Eten (geen NEVO-gegeven).' : '.') + '</div>';
    html += '<button class="btn primary block" data-action="p-save">' + (c.entry ? 'Opslaan' : 'Toevoegen aan ' + esc(mealName(c.meal).toLowerCase())) + '</button>';
    if (c.entry) html += '<button class="btn danger block" data-action="p-delete">Verwijderen</button>';
    if (f.source === 'custom' && saved) html += '<button class="btn ghost block" data-action="edit-food">Product bewerken</button>';
    openSheet(html, { full: false });
    updatePortion();
  }
  function updatePortion() {
    var c = sheetCtx; if (!c || c.type !== 'portion') return;
    var n = nutr(c.food.per100, portionGrams());
    $('p-nutri').innerHTML = '<div><b id="p-kcal">' + fmt(n.kcal) + '</b><span>kcal</span></div><div><b>' + fmt(n.protein, 1) + '</b><span><i class="dot" style="background:var(--protein)"></i>eiwit</span></div>' +
      '<div><b>' + fmt(n.carbs, 1) + '</b><span><i class="dot" style="background:var(--carbs)"></i>koolh.</span></div><div><b>' + fmt(n.fat, 1) + '</b><span><i class="dot" style="background:var(--fat)"></i>vet</span></div>';
  }
  function savePortion() {
    var c = sheetCtx, f = c.food, grams = portionGrams();
    if (!(grams > 0)) { toast('Vul een hoeveelheid in'); return; }
    c.meal = $('p-meal').value;
    var saved = f.source === 'photo' ? { id: null } : rememberFood(f, !c.entry);
    var n = nutr(f.per100, grams), q = num($('p-qty').value);
    var id = c.entry ? c.entry.id : uid();
    put('eten_diary', id, {
      date: c.date, meal: c.meal, name: f.name, brand: f.brand || '', foodId: saved.id, barcode: f.barcode || '',
      grams: r1(grams), qty: r1(q), unit: c.unit, servingG: f.serving ? f.serving.grams : null, servingLabel: f.serving ? f.serving.label : '',
      per100: f.per100, kcal: r1(n.kcal), protein: r1(n.protein), carbs: r1(n.carbs), fat: r1(n.fat), created: c.entry ? (c.entry.created || '') : new Date().toISOString()
    });
    var wasNew = !c.entry, meal = c.meal;
    closeSheet(); if (curView === 'diary') renderDiary();
    toast(wasNew ? 'Toegevoegd aan ' + mealName(meal).toLowerCase() + ' ✓' : 'Opgeslagen ✓');
  }

  // ---------- Zelf aanmaken ----------
  function backOf() { return sheetCtx && sheetCtx.type === 'add' ? sheetCtx : (sheetCtx && sheetCtx.back) || null; }
  function openManual(prefill) {
    prefill = prefill || {};
    var back = backOf();
    var f = prefill.food || null;
    sheetCtx = { type: 'manual', back: back, food: f, basis: '100', meal: back ? back.meal : defaultMeal() };
    var p = f ? f.per100 : {};
    var v = function (x) { return x != null && x !== '' && isFinite(x) ? String(x).replace('.', ',') : ''; };
    var html = sheetHead(f ? 'Product bewerken' : 'Zelf aanmaken', back ? 'manual-back' : null) +
      (prefill.notFound ? '<div class="note" id="notfound-note" style="margin-top:0;margin-bottom:12px">Barcode <b>' + esc(prefill.barcode) + '</b> staat niet in Open Food Facts. Vul de waarden van het etiket in; daarna herkent de app hem voortaan.</div>' : '') +
      '<label class="field"><span>Naam</span><input id="m-name" value="' + esc(f ? f.name : (prefill.name || '')) + '" placeholder="bijv. Boterham met kaas"></label>' +
      '<div class="grid2"><label class="field"><span>Merk (optioneel)</span><input id="m-brand" value="' + esc(f ? f.brand : '') + '"></label>' +
      '<label class="field"><span>Barcode (optioneel)</span><input id="m-barcode" inputmode="numeric" value="' + esc(f ? f.barcode : (prefill.barcode || '')) + '"></label></div>' +
      '<label class="field"><span>Voedingswaarden op het etiket staan per</span><div class="seg"><button type="button" data-action="m-basis" data-v="100" aria-pressed="true">100 g / ml</button><button type="button" data-action="m-basis" data-v="serving" aria-pressed="false">portie</button></div></label>' +
      '<div class="grid2"><label class="field"><span>Portiegrootte</span><div class="unit-input"><input id="m-sg" inputmode="decimal" value="' + v(f && f.serving ? f.serving.grams : '') + '" placeholder="optioneel"><em>g</em></div></label>' +
      '<label class="field"><span>Naam portie</span><input id="m-sl" value="' + esc(f && f.serving ? f.serving.label : '') + '" placeholder="bijv. 1 snee"></label></div>' +
      '<div class="grid2"><label class="field"><span>Calorieën</span><div class="unit-input"><input id="m-kcal" inputmode="decimal" value="' + v(p.kcal) + '"><em>kcal</em></div></label>' +
      '<label class="field"><span>Eiwit</span><div class="unit-input"><input id="m-protein" inputmode="decimal" value="' + v(p.protein) + '"><em>g</em></div></label>' +
      '<label class="field"><span>Koolhydraten</span><div class="unit-input"><input id="m-carbs" inputmode="decimal" value="' + v(p.carbs) + '"><em>g</em></div></label>' +
      '<label class="field"><span>Vet</span><div class="unit-input"><input id="m-fat" inputmode="decimal" value="' + v(p.fat) + '"><em>g</em></div></label></div>' +
      '<p class="tiny muted" style="margin-top:-4px">Geen calorieën bekend? Laat leeg, dan rekenen we ze uit met eiwit × 4 + koolhydraten × 4 + vet × 9.</p>' +
      '<button class="btn primary block" data-action="m-save">' + (f ? 'Opslaan' : 'Opslaan en hoeveelheid kiezen') + '</button>' +
      (f ? '<button class="btn danger block" data-action="m-delete">Product verwijderen</button>' : '');
    openSheet(html, { full: true, focus: f || prefill.name ? null : 'm-name' });
  }
  function saveManual() {
    var c = sheetCtx, name = ($('m-name').value || '').trim();
    if (!name) { toast('Vul een naam in'); $('m-name').focus(); return; }
    var vals = {}; ['kcal', 'protein', 'carbs', 'fat'].forEach(function (k) { var x = num($('m-' + k).value); vals[k] = isFinite(x) && x >= 0 ? x : null; });
    var sg = num($('m-sg').value), sl = ($('m-sl').value || '').trim();
    if (vals.kcal == null) {
      if (vals.protein == null && vals.carbs == null && vals.fat == null) { toast('Vul minimaal de calorieën in'); return; }
      vals.kcal = (vals.protein || 0) * 4 + (vals.carbs || 0) * 4 + (vals.fat || 0) * 9;
    }
    if (c.basis === 'serving') {
      if (!(sg > 0)) { toast('Vul de portiegrootte in grammen in'); $('m-sg').focus(); return; }
      ['kcal', 'protein', 'carbs', 'fat'].forEach(function (k) { if (vals[k] != null) vals[k] = vals[k] / sg * 100; });
    }
    var per100 = { kcal: r1(vals.kcal), protein: r1(vals.protein || 0), carbs: r1(vals.carbs || 0), fat: r1(vals.fat || 0) };
    var id = c.food && c.food.id ? c.food.id : 'own-' + uid();
    var cur = getLive('foods', id) || {};
    var data = Object.assign({}, cur, { name: name, brand: ($('m-brand').value || '').trim(), barcode: ($('m-barcode').value || '').replace(/\D/g, ''), source: 'custom', per100: per100, serving: sg > 0 ? { grams: r1(sg), label: sl || 'portie' } : null, favorite: !!cur.favorite });
    put('eten_foods', id, data);
    var food = Object.assign({}, data, { id: id });
    if (c.food) { toast('Product opgeslagen ✓'); if (c.back) { sheetCtx = c.back; renderAdd(); } else closeSheet(); return; }
    var back = c.back; sheetCtx = back; openPortion(food, { meal: back ? back.meal : c.meal });
  }

  // ---------- Snel kcal ----------
  function openQuick(entry) {
    var back = sheetCtx && sheetCtx.type === 'add' ? sheetCtx : null;
    sheetCtx = { type: 'quick', back: back, entry: entry || null, meal: entry ? entry.meal : (back ? back.meal : defaultMeal()), date: entry ? entry.date : curDate };
    var e = entry || {}, v = function (x) { return x ? String(x).replace('.', ',') : ''; };
    var html = sheetHead(entry ? 'Snel toegevoegd' : 'Snel calorieën toevoegen', back ? 'quick-back' : null) +
      '<label class="field"><span>Omschrijving (optioneel)</span><input id="q-name" value="' + esc(e.name && e.name !== 'Snel toegevoegd' ? e.name : '') + '" placeholder="bijv. Stukje taart op het werk"></label>' +
      '<div class="grid2"><label class="field"><span>Calorieën</span><div class="unit-input"><input id="q-kcal" inputmode="decimal" value="' + v(e.kcal) + '"><em>kcal</em></div></label>' +
      '<label class="field"><span>Eiwit</span><div class="unit-input"><input id="q-protein" inputmode="decimal" value="' + v(e.protein) + '"><em>g</em></div></label>' +
      '<label class="field"><span>Koolhydraten</span><div class="unit-input"><input id="q-carbs" inputmode="decimal" value="' + v(e.carbs) + '"><em>g</em></div></label>' +
      '<label class="field"><span>Vet</span><div class="unit-input"><input id="q-fat" inputmode="decimal" value="' + v(e.fat) + '"><em>g</em></div></label></div>' +
      '<label class="field"><span>Maaltijd</span><select id="q-meal">' + MEALS.map(function (m) { return '<option value="' + m.id + '"' + (sheetCtx.meal === m.id ? ' selected' : '') + '>' + m.name + '</option>'; }).join('') + '</select></label>' +
      '<button class="btn primary block" data-action="q-save">' + (entry ? 'Opslaan' : 'Toevoegen') + '</button>' + (entry ? '<button class="btn danger block" data-action="q-delete">Verwijderen</button>' : '');
    openSheet(html, { focus: entry ? null : 'q-kcal' });
  }
  function saveQuick() {
    var c = sheetCtx, kcal = num($('q-kcal').value);
    var p = num($('q-protein').value), cb = num($('q-carbs').value), f = num($('q-fat').value);
    if (!(kcal > 0)) { if (p > 0 || cb > 0 || f > 0) kcal = (p || 0) * 4 + (cb || 0) * 4 + (f || 0) * 9; else { toast('Vul calorieën in'); return; } }
    var id = c.entry ? c.entry.id : uid();
    put('eten_diary', id, { date: c.date, meal: $('q-meal').value, quick: true, name: ($('q-name').value || '').trim() || 'Snel toegevoegd', kcal: r1(kcal), protein: r1(p || 0), carbs: r1(cb || 0), fat: r1(f || 0), grams: 0, created: c.entry ? c.entry.created : new Date().toISOString() });
    closeSheet(); if (curView === 'diary') renderDiary(); toast('Opgeslagen ✓');
  }

  // ---------- Foto-herkenning (voorbereid, NIET gebouwd) ----------
  // Uitbreidingspunt: window.MijnEtenPhotoRecognizer = async function (file) {
  //   return [{ name: 'Spaghetti bolognese', grams: 350, per100: { kcal, protein, carbs, fat } }, ...];
  // };  bijv. via een Supabase Edge Function die een AI-beeldherkenningsdienst aanroept (kost geld per foto).
  function openPhoto() {
    if (typeof window.MijnEtenPhotoRecognizer === 'function') { $('photo-input').value = ''; $('photo-input').click(); return; }
    var back = sheetCtx && sheetCtx.type === 'add' ? sheetCtx : null;
    sheetCtx = { type: 'info', back: back };
    openSheet(sheetHead('Foto herkennen', back ? 'info-back' : null) +
      '<div class="center" style="font-size:56px">📷</div><p id="photo-info">Binnenkort: maak een foto van je maaltijd en de app herkent wat erop ligt en schat de hoeveelheden.</p>' +
      '<div class="note">Hiervoor is een AI-dienst nodig die een paar cent per foto kost. De app is er al op voorbereid; het wordt pas aangezet als je dat wilt.</div>' +
      '<p class="small muted">Tot die tijd: gebruik <b>Barcode</b> voor verpakte producten of <b>Zoek</b>.</p>' +
      '<button class="btn primary block" data-action="' + (back ? 'info-back' : 'close-sheet') + '">Oké</button>');
  }
  function onPhotoPicked(file) {
    if (!file || typeof window.MijnEtenPhotoRecognizer !== 'function') return;
    var c = sheetCtx && sheetCtx.type === 'add' ? sheetCtx : null; if (!c) return;
    toast('Foto analyseren…');
    Promise.resolve(window.MijnEtenPhotoRecognizer(file)).then(function (items) {
      items = (items || []).filter(function (x) { return x && x.name && x.per100; });
      if (!items.length) { toast('Niets herkend'); return; }
      if (sheetCtx !== c) return;
      var list = items.map(function (x) { return { id: 'tmp:photo-' + uid(), name: x.name, brand: 'Herkend op foto', per100: x.per100, serving: x.grams ? { grams: x.grams, label: 'geschat' } : null, source: 'photo' }; });
      c.list = list; $('add-list').innerHTML = '<h3 class="mt">Herkend op je foto</h3>' + list.map(foodRow).join('');
    }).catch(function (e) { toast('Herkennen mislukt: ' + (e && e.message || e)); });
  }

  // ---------- Barcode scannen ----------
  var scan = null;
  function loadZxing() {
    if (window.ZXing) return Promise.resolve(window.ZXing);
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = 'vendor/zxing.min.js';
      s.onload = function () { window.ZXing ? res(window.ZXing) : rej(new Error('ZXing niet geladen')); };
      s.onerror = function () { rej(new Error('Scanner kon niet laden')); };
      document.head.appendChild(s);
    });
  }
  var zxReader = null;
  function zxingReader(Z) {
    if (zxReader) return zxReader;
    var hints = new Map();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E, Z.BarcodeFormat.CODE_128]);
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    zxReader = new Z.MultiFormatReader(); zxReader.setHints(hints);
    return zxReader;
  }
  function decodeCanvas(Z, canvas) {
    var reader = zxingReader(Z);
    var src = new Z.HTMLCanvasElementLuminanceSource(canvas);
    var tries = [function () { return new Z.BinaryBitmap(new Z.HybridBinarizer(src)); }, function () { return new Z.BinaryBitmap(new Z.GlobalHistogramBinarizer(src)); }];
    for (var i = 0; i < tries.length; i++) {
      try { var r = reader.decodeWithState(tries[i]()); if (r) return r.getText(); } catch (e) { /* niet gevonden */ }
    }
    return null;
  }
  function nativeDetector() {
    if (!('BarcodeDetector' in window)) return Promise.resolve(null);
    return Promise.resolve(window.BarcodeDetector.getSupportedFormats ? window.BarcodeDetector.getSupportedFormats() : ['ean_13'])
      .then(function (fm) { var want = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'].filter(function (x) { return fm.indexOf(x) >= 0; }); return want.length ? new window.BarcodeDetector({ formats: want }) : null; })
      .catch(function () { return null; });
  }
  function openScanner() {
    var back = sheetCtx && sheetCtx.type === 'add' ? sheetCtx : null;
    stopScan();
    sheetCtx = { type: 'scan', back: back };
    var html = sheetHead('Barcode scannen', back ? 'scan-back' : null) +
      '<div class="scanner"><video id="scan-video" playsinline muted autoplay></video><div class="frame"></div><div class="laser"></div></div>' +
      '<div class="scan-msg" id="scan-msg">Camera starten…</div>' +
      '<form class="searchbar" data-form="barcode" autocomplete="off"><input id="scan-code" inputmode="numeric" placeholder="Of typ de cijfers onder de streepjes"><button class="btn" type="submit">Zoek</button></form>' +
      '<button class="btn block" data-action="scan-photo">📷 Maak een foto van de barcode</button>';
    openSheet(html, { full: true });
    startScan();
  }
  function scanMsg(t) { var el = $('scan-msg'); if (el) el.textContent = t; }
  function startScan() {
    var my = scan = { stop: false, stream: null, timer: null };
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { scanMsg('Camera niet beschikbaar. Typ de code of maak een foto.'); return; }
    Promise.all([nativeDetector(), navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } })])
      .then(function (r) {
        var det = r[0], stream = r[1];
        if (my.stop) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
        my.stream = stream;
        var v = $('scan-video'); v.srcObject = stream; var pl = v.play(); if (pl && pl.catch) pl.catch(function () {});
        scanMsg('Richt de camera op de barcode');
        return (det ? Promise.resolve(null) : loadZxing()).then(function (Z) { if (!my.stop) loop(my, v, det, Z); });
      })
      .catch(function (e) {
        if (my.stop) return;
        var n = e && e.name;
        scanMsg(n === 'NotAllowedError' ? 'Geen toegang tot de camera. Sta camera toe (iPhone: Instellingen › Safari › Camera) of typ de code.' : n === 'NotFoundError' ? 'Geen camera gevonden. Typ de code of maak een foto.' : 'Camera starten lukt niet. Typ de code of maak een foto.');
      });
  }
  function loop(my, video, det, Z) {
    var canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true }), busy = false;
    function tick() {
      if (my.stop) return;
      if (busy || video.readyState < 2 || !video.videoWidth) { my.timer = setTimeout(tick, 150); return; }
      busy = true;
      var p;
      if (det) p = det.detect(video).then(function (codes) { return codes && codes[0] ? codes[0].rawValue : null; });
      else {
        var vw = video.videoWidth, vh = video.videoHeight, cw = Math.round(vw * 0.86), ch = Math.round(vh * 0.5), sx = Math.round((vw - cw) / 2), sy = Math.round((vh - ch) / 2);
        var scale = Math.min(1, 800 / cw); canvas.width = Math.round(cw * scale); canvas.height = Math.round(ch * scale);
        ctx.drawImage(video, sx, sy, cw, ch, 0, 0, canvas.width, canvas.height);
        p = Promise.resolve(decodeCanvas(Z, canvas));
      }
      p.then(function (code) {
        busy = false; if (my.stop) return;
        if (code && /^\d{6,14}$/.test(code)) { if (navigator.vibrate) navigator.vibrate(60); stopScan(); handleBarcode(code); }
        else my.timer = setTimeout(tick, 120);
      }, function () { busy = false; my.timer = setTimeout(tick, 250); });
    }
    tick();
  }
  function stopScan() {
    if (!scan) return; scan.stop = true; clearTimeout(scan.timer);
    if (scan.stream) scan.stream.getTracks().forEach(function (t) { t.stop(); });
    var v = $('scan-video'); if (v) { try { v.pause(); v.srcObject = null; } catch (e) {} }
    scan = null;
  }
  function decodeImageFile(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        nativeDetector().then(function (det) {
          return det ? det.detect(img).then(function (c) { return c && c[0] ? c[0].rawValue : null; }).catch(function () { return null; }) : null;
        }).then(function (code) {
          if (code) return res(code);
          return loadZxing().then(function (Z) {
            var sizes = [1400, 1000, 700], canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
            for (var i = 0; i < sizes.length; i++) {
              for (var rot = 0; rot < 2; rot++) {
                var s = Math.min(1, sizes[i] / Math.max(img.width, img.height)), w = Math.round(img.width * s), h = Math.round(img.height * s);
                canvas.width = rot ? h : w; canvas.height = rot ? w : h;
                ctx.save(); if (rot) { ctx.translate(h, 0); ctx.rotate(Math.PI / 2); } ctx.drawImage(img, 0, 0, w, h); ctx.restore();
                var c = decodeCanvas(Z, canvas); if (c) return res(c);
              }
            }
            res(null);
          });
        }).catch(rej);
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('Afbeelding kon niet worden geladen')); };
      img.src = url;
    });
  }
  function handleBarcode(code) {
    code = String(code).replace(/\D/g, '');
    if (code.length < 6) { toast('Ongeldige barcode'); return; }
    var back = sheetCtx && sheetCtx.type === 'add' ? sheetCtx : (sheetCtx && sheetCtx.back) || null;
    var local = findFoodByBarcode(code);
    if (local) { sheetCtx = back; openPortion(local, { meal: back && back.meal }); return; }
    sheetCtx = { type: 'lookup', back: back };
    openSheet(sheetHead('Barcode ' + code, back ? 'scan-back' : null) + '<div class="spinner"></div><p class="center muted small">Zoeken in Open Food Facts…</p>');
    var ctx = sheetCtx;
    offBarcode(code).then(function (f) {
      if (sheetCtx !== ctx) return;
      sheetCtx = back;
      if (f) openPortion(f, { meal: back && back.meal });
      else openManual({ barcode: code, notFound: true });
    }).catch(function () {
      if (sheetCtx !== ctx) return;
      sheetCtx = back;
      toast('Open Food Facts is niet bereikbaar; vul het product zelf in');
      openManual({ barcode: code });
    });
  }
  window.__meScan = { handleBarcode: handleBarcode, decodeImageFile: decodeImageFile };

  // ---------- Export ----------
  function exportData() {
    var blob = new Blob([JSON.stringify({ app: 'Mijn Eten', version: VERSION, exported: new Date().toISOString(), data: state }, null, 2)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mijn-eten-' + todayKey() + '.json';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---------- Acties ----------
  function goBack() { var b = sheetCtx && sheetCtx.back; stopScan(); sheetCtx = b; if (b && b.type === 'add') renderAdd(); else closeSheet(); }
  var actions = {
    'close-sheet': function () { closeSheet(); },
    'open-auth': function () { if (window.meSync && window.meSync.openAuth) window.meSync.openAuth(); else toast('Inloggen is nu niet beschikbaar (offline?)'); },
    'start-local': function () { ui.localChosen = true; saveUi(); ob = null; showView('onboarding'); },
    'ob-set': function (el) { obReadInputs(); var k = el.getAttribute('data-k'), v = el.getAttribute('data-v'); ob[k] = k === 'pace' ? +v : v; renderOnboarding(); },
    'ob-back': function () { obReadInputs(); ob.step = Math.max(0, ob.step - 1); renderOnboarding(); window.scrollTo(0, 0); },
    'ob-cancel': function () { redoing = false; ob = null; showView('profile'); },
    'ob-next': function () {
      obReadInputs();
      if (ob.step === 0) {
        if (!(ob.age >= 12 && ob.age <= 100)) return toast('Vul je leeftijd in (12–100)');
        if (!(ob.height >= 120 && ob.height <= 230)) return toast('Vul je lengte in cm in');
        if (!(ob.weight >= 30 && ob.weight <= 300)) return toast('Vul je gewicht in kg in');
      }
      if (ob.step === 2 && ob.goalWeight && !(ob.goalWeight >= 30 && ob.goalWeight <= 300)) return toast('Streefgewicht klopt niet');
      ob.step++; renderOnboarding(); window.scrollTo(0, 0);
    },
    'ob-finish': function () {
      var p = Object.assign({}, profile() || {}, { sex: ob.sex, age: Math.round(+ob.age), height: Math.round(+ob.height), weight: r1(+ob.weight), activity: ob.activity, goal: ob.goal, pace: ob.goal === 'keep' ? 0 : +ob.pace, goalWeight: ob.goalWeight ? r1(+ob.goalWeight) : null, onboarded: true });
      if (!p.glass) p.glass = 250;
      put('eten_profiles', 'me', p);
      var t = todayKey(), tw = getLive('weights', t);
      if (!tw || tw.kg !== p.weight) { if (!redoing || !isFinite(latestWeight()) || latestWeight() !== p.weight) put('eten_weights', t, { kg: p.weight }); }
      var was = redoing; redoing = false; ob = null; showView(was ? 'profile' : 'diary'); toast(was ? 'Doel bijgewerkt ✓' : 'Klaar! Veel succes 💪');
    },
    'date-prev': function () { curDate = addDays(curDate, -1); renderDiary(); },
    'date-next': function () { curDate = addDays(curDate, 1); renderDiary(); },
    'date-today': function () { curDate = todayKey(); renderDiary(); },
    'water-add': function (el) { setWater(waterOf(curDate) + num(el.getAttribute('data-ml'))); },
    'water-glass': function (el) { var i = +el.getAttribute('data-i'), gs = glassSize(), full = Math.floor(waterOf(curDate) / gs + 1e-6); setWater(i + 1 === full ? i * gs : (i + 1) * gs); },
    'open-add': function (el) { openAdd(el.getAttribute('data-meal')); },
    'add-meal': function (el) { sheetCtx.meal = el.getAttribute('data-v'); document.querySelectorAll('[data-action=add-meal]').forEach(function (b) { b.setAttribute('aria-pressed', b === el ? 'true' : 'false'); }); },
    'add-tab': function (el) { sheetCtx.tab = ui.addTab = el.getAttribute('data-v'); saveUi(); renderAddList(); },
    'search-go': function () { doSearch(); },
    'nevo-more': function () { if (sheetCtx) { sheetCtx.nevoAll = true; renderAddList(); } },
    'pick': function (el) { var f = sheetCtx.list[+el.getAttribute('data-i')]; if (f) openPortion(f); },
    'portion-back': goBack,
    'p-quick': function (el) { $('p-qty').value = String(el.getAttribute('data-v')).replace('.', ','); updatePortion(); },
    'fav': function (el) {
      var c = sheetCtx, f = c.food, on = el.getAttribute('aria-pressed') !== 'true';
      var saved = rememberFood(Object.assign({}, f, { favorite: on }), false); c.food = Object.assign({}, f, { id: saved.id, favorite: on });
      el.setAttribute('aria-pressed', on ? 'true' : 'false'); el.textContent = on ? '★' : '☆'; toast(on ? 'Toegevoegd aan favorieten ★' : 'Uit favorieten gehaald');
    },
    'p-save': function () { savePortion(); },
    'p-delete': function () { if (!confirm('Dit item verwijderen?')) return; remove('eten_diary', sheetCtx.entry.id); closeSheet(); renderDiary(); toast('Verwijderd'); },
    'edit-food': function () { var f = sheetCtx.food, fid = foodIdOf(f), saved = fid && getLive('foods', fid); if (saved) openManual({ food: Object.assign({}, saved, { id: fid }) }); },
    'edit-entry': function (el) {
      var id = el.getAttribute('data-id'), e = getLive('entries', id); if (!e) return; e = Object.assign({}, e, { id: id });
      sheetCtx = null;
      if (e.quick || !e.per100) return openQuick(e);
      var saved = e.foodId ? getLive('foods', e.foodId) : null;
      var food = { id: e.foodId || ('tmp:' + e.id), name: e.name, brand: e.brand, barcode: e.barcode, per100: e.per100, serving: e.servingG ? { grams: e.servingG, label: e.servingLabel || 'portie' } : null, source: saved ? saved.source : 'off', image: saved ? saved.image : '', favorite: saved ? saved.favorite : false };
      openPortion(food, { entry: e });
    },
    'manual': function () { openManual({ name: sheetCtx && sheetCtx.type === 'add' && $('add-q') ? $('add-q').value.trim() : '' }); },
    'manual-back': goBack,
    'm-basis': function (el) { sheetCtx.basis = el.getAttribute('data-v'); document.querySelectorAll('[data-action=m-basis]').forEach(function (b) { b.setAttribute('aria-pressed', b === el ? 'true' : 'false'); }); },
    'm-save': function () { saveManual(); },
    'm-delete': function () { if (!confirm('Dit eigen product verwijderen? Eerder gegeten items blijven in je dagboek staan.')) return; remove('eten_foods', sheetCtx.food.id); toast('Product verwijderd'); goBack(); },
    'quick': function () { openQuick(); },
    'quick-back': goBack,
    'q-save': function () { saveQuick(); },
    'q-delete': function () { if (!confirm('Dit item verwijderen?')) return; remove('eten_diary', sheetCtx.entry.id); closeSheet(); renderDiary(); toast('Verwijderd'); },
    'photo': function () { openPhoto(); },
    'info-back': goBack,
    'scan': function () { openScanner(); },
    'scan-back': goBack,
    'scan-photo': function () { $('barcode-photo-input').value = ''; $('barcode-photo-input').click(); },
    'range': function (el) { ui.range = el.getAttribute('data-v'); saveUi(); renderProgress(); },
    'weight-add': function () {
      var kg = num($('w-kg').value), d = $('w-date').value || todayKey();
      if (!(kg >= 30 && kg <= 300)) { toast('Vul een geldig gewicht in'); return; }
      saveWeight(d, kg); renderProgress(); toast('Gewicht opgeslagen ✓');
    },
    'weight-del': function (el) { if (!confirm('Deze meting verwijderen?')) return; remove('eten_weights', el.getAttribute('data-id')); var p = profile(), lw = latestWeight(); if (p && isFinite(lw) && p.weight !== lw) updateProfile({ weight: lw }); renderProgress(); },
    'p-set': function (el) { var k = el.getAttribute('data-k'), v = el.getAttribute('data-v'), patch = {}; patch[k] = k === 'pace' ? +v : v; if (k === 'goal') patch.pace = v === 'keep' ? 0 : (v === 'lose' ? 0.5 : 0.25); updateProfile(patch); renderProfile(); },
    'targets-auto': function () { updateProfile({ manual: {} }); renderProfile(); toast('Doelen weer automatisch'); },
    'theme': function (el) { setTheme(el.getAttribute('data-v')); },
    'export': function () { exportData(); },
    'redo-onboarding': function () { redoing = true; ob = null; showView('onboarding'); },
    'sync-now': function () { if (window.meSync) window.meSync.syncNow(true); },
    'logout': function () { if (window.meSync) window.meSync.logout(); }
  };
  document.addEventListener('click', function (ev) {
    var tab = ev.target.closest('[data-tab]');
    if (tab) { showView(tab.getAttribute('data-tab')); return; }
    var el = ev.target.closest('[data-action]'); if (!el) return;
    var name = el.getAttribute('data-action');
    var a = actions[name] || (window.meSync && window.meSync.actions && window.meSync.actions[name]);
    if (a) { ev.preventDefault(); a(el, ev); }
  });
  document.addEventListener('submit', function (ev) {
    var f = ev.target.getAttribute('data-form'); if (!f) return; ev.preventDefault();
    if (f === 'search') { if (document.activeElement) document.activeElement.blur(); doSearch(); }
    else if (f === 'barcode') { var code = ($('scan-code').value || '').replace(/\D/g, ''); if (code.length < 6) { toast('Vul de cijfers van de barcode in'); return; } stopScan(); handleBarcode(code); }
    else if (window.meSync && window.meSync.forms && window.meSync.forms[f]) window.meSync.forms[f](ev.target);
  });
  document.addEventListener('input', function (ev) {
    var t = ev.target;
    if (t.id === 'add-q') { if (sheetCtx) { sheetCtx.q = t.value; sheetCtx.nevoAll = false; if (!t.value.trim()) sheetCtx.results = null; if (!sheetCtx.loading) { sheetCtx.error = ''; sheetCtx.errorKind = ''; } } renderAddList(); }
    else if (t.id === 'p-qty') updatePortion();
  });
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.id === 'date-pick') { if (t.value) { curDate = t.value; renderDiary(); } }
    else if (t.id === 'p-unit') {
      var c = sheetCtx, g = portionGrams(); c.unit = t.value;
      c.qty = c.unit === 'serving' && c.food.serving ? (r1(g / c.food.serving.grams) || 1) : (Math.round(g) || 100);
      c.meal = $('p-meal').value; renderPortion();
    }
    else if (t.id === 'p-meal') { sheetCtx.meal = t.value; var btn = document.querySelector('[data-action=p-save]'); if (btn && !sheetCtx.entry) btn.textContent = 'Toevoegen aan ' + mealName(t.value).toLowerCase(); }
    else if (t.hasAttribute && t.hasAttribute('data-p')) {
      var k = t.getAttribute('data-p'), v = t.value;
      if (k === 'activity') updateProfile({ activity: v });
      else if (k === 'glass') updateProfile({ glass: +v });
      else if (k === 'weight') { var kg = num(v); if (kg >= 30 && kg <= 300) { saveWeight(todayKey(), kg); updateProfile({ weight: r1(kg) }); } else toast('Ongeldig gewicht'); }
      else if (k === 'goalWeight') { var g = num(v); updateProfile({ goalWeight: g >= 30 && g <= 300 ? r1(g) : null }); }
      else { var n = num(v), lim = { age: [12, 100], height: [120, 230] }[k]; if (lim && n >= lim[0] && n <= lim[1]) { var pt = {}; pt[k] = Math.round(n); updateProfile(pt); } else toast('Ongeldige waarde'); }
      renderProfile();
    }
    else if (t.hasAttribute && t.hasAttribute('data-target')) {
      var p = profile() || {}, m = Object.assign({}, p.manual || {}), key = t.getAttribute('data-target'), val = num(t.value);
      if (val > 0) m[key] = Math.round(val); else delete m[key];
      updateProfile({ manual: m }); renderProfile();
    }
    else if (t.id === 'barcode-photo-input' && t.files && t.files[0]) {
      scanMsg('Foto lezen…');
      decodeImageFile(t.files[0]).then(function (code) { if (code) { stopScan(); handleBarcode(code); } else scanMsg('Geen barcode gevonden op de foto. Probeer dichterbij en scherp, of typ de code.'); })
        .catch(function () { scanMsg('Foto lezen mislukt. Typ de code.'); });
    }
    else if (t.id === 'photo-input' && t.files && t.files[0]) onPhotoPicked(t.files[0]);
  });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && $('sheet').classList.contains('open')) closeSheet(); });
  // Dag wisselt na middernacht terwijl de app open staat
  var lastToday = todayKey();
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    var t = todayKey(); if (t !== lastToday) { if (curDate === lastToday) curDate = t; lastToday = t; rerender(); }
  });

  // ---------- Service worker ----------
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    var hadController = !!navigator.serviceWorker.controller, reloading = false;
    var reloadForUpdate = function () {
      if (reloading) return;
      var last = parseInt(sessionStorage.getItem('meSwReloadAt') || '0', 10); if (Date.now() - last < 30000) return;
      if ($('sheet').classList.contains('open')) { setTimeout(reloadForUpdate, 1000); return; }
      reloading = true; sessionStorage.setItem('meSwReloadAt', String(Date.now())); location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', function () { if (hadController) reloadForUpdate(); });
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (reg) {
        var check = function () { reg.update().catch(function () {}); };
        check(); document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
      }).catch(function (e) { console.warn('SW registratie mislukt', e); });
    });
  }

  // Sheet-functies voor sync.js (inloggen)
  window.ME.openSheet = function (html, opts) { stopScan(); sheetCtx = { type: 'auth' }; openSheet(html, opts); };
  window.ME.closeSheet = closeSheet;
  window.ME.sheetHead = sheetHead;
  window.ME.sheetType = function () { return sheetCtx && sheetCtx.type; };
  window.ME.toast = toast;

  // Haakjes voor tests
  window.__me = { calc: calc, targets: targets, state: function () { return state; }, showView: showView, openAdd: openAdd, openPortion: openPortion, openManual: openManual, openScanner: openScanner, closeSheet: closeSheet, setDate: function (d) { curDate = d; rerender(); }, sheet: function () { return sheetCtx; }, put: put, remove: remove, pending: function () { return pending; }, view: function () { return curView; } };

  applyTheme(false);
  route();
})();
