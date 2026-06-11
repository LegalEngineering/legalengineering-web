// app.js — UI controller pre kalkulačku trov
// Plán: ../kalk-trovy-m1-plan.md v2 (sekcia 6 + 8) + redizajn sekcie Úkony 2026-05-21
//       + náhrada za PHM (ceny ŠÚ SR) 2026-05-21 + zapracovanie pripomienok review 2026-05-21.

import { TARIFF } from './tariff.js';
import {
  vypocitajTrovy, sadzbaCestovneEurPerKm, vzPreUkon, vzNahradova,
  sadzbaHodnotova, sadzbaNehodnotova, sadzbaTrestna
} from './engine.js';
import { cenaPhm } from './phm.js';

// ---------- State ----------

const state = {
  caseLabel: '',
  konanieType: 'civil-nonvalue',
  hodnotaSporu: null,
  trestnaSadzbaId: '12-3-a',  // §12 — základná sadzba v trestnom konaní (default: TČ do 5 rokov)
  ukony: [],
  vozidlo: { spotreba: null, druh: 'benzin' },
  vydavky: [],          // [{ _uid, datum, popis, suma }]
  platcaDph: true,      // §18 ods. 3 — je advokát platiteľom DPH?
  exportOdovodnenie: false,  // opt-in: priložiť odôvodnenie do kópie/PDF
  // §13 multipliery (po novele 391/2023):
  pocetOsob: 1,           // §13 ods. 2 — počet spoločne zastupovaných osôb
  upravaSadzbyPct: 0,     // §13 ods. 1/5 — diskrečná úprava sadzby (-50 … +50 %)
  spojeneVeci: [],        // §13 ods. 3 — ďalšie spojené veci [{ _uid, hodnota }] (len civil-value)
  // §12 ods. 7 / §14 ods. 7 — osobitné trestné odmeny:
  opatrovnikNedotiahol: false,  // §12 ods. 7 — opatrovník nezastupoval do právoplatného skončenia (→ 50 %)
  dohodaVT: false,        // §14 ods. 7 — schválená dohoda o vine a treste pred podaním obžaloby (+4×)
  dohodaVTDatum: null     // dátum schválenia dohody (pre rok výpočtového základu)
};

// Rodina konania (civil/criminal) určuje, ktorý zoznam úkonov sa ponúka (§13a vs §14).
function konanieFamily(typ) { return (TARIFF.konania[typ] || {}).family || 'civil'; }
function ukonyPre(typ) {
  return konanieFamily(typ) === 'criminal' ? TARIFF.ukony_trestne : TARIFF.ukony;
}
function defaultUkonId(typ) { return ukonyPre(typ)[0].id; }
function trestnaSadzbaDef() {
  return TARIFF.trestne_sadzby.find(s => s.id === state.trestnaSadzbaId) || TARIFF.trestne_sadzby[0];
}

// §12 ods. 7 — je zvolený režim opatrovníka poškodeného (odmena je paušál za celé konanie)?
function jeOpatrovnik() {
  const s = trestnaSadzbaDef();
  return state.konanieType === 'criminal' && s && s.pausal_eur != null;
}

// §13 multipliery — rovnaké vzorce ako engine (pre per-úkon náhľad v UI).
function multOsob() {
  if (jeOpatrovnik()) return 1;
  const n = Math.max(1, Math.floor(state.pocetOsob || 1));
  return 1 + TARIFF.parameters.spolu_osoba_znizenie * (n - 1);  // §13 ods. 2
}
function multUprava() {
  if (jeOpatrovnik()) return 1;
  const m = TARIFF.parameters.uprava_sadzby_max_pct;
  const p = Math.max(-m, Math.min(m, state.upravaSadzbyPct || 0));
  return 1 + p / 100;  // §13 ods. 1/5
}
function prirastokSpojenie() {
  if (state.konanieType !== 'civil-value' || !Array.isArray(state.spojeneVeci)) return 0;
  let s = 0;
  for (const v of state.spojeneVeci) {
    if (v.hodnota != null && v.hodnota > 0) s += sadzbaHodnotova(v.hodnota) * TARIFF.parameters.spojenie_veci_zlomok;
  }
  return round2(s);  // §13 ods. 3
}
// Je nastavený niektorý §13 multiplier (na zobrazenie odôvodnenia)?
function maMultipliery() {
  return multOsob() !== 1 || multUprava() !== 1 || prirastokSpojenie() > 0;
}

let ukonSeq = 0;
let vydavokSeq = 0;
let spojSeq = 0;
let introDone = false;
let refreshTimer = null;
let odovOpen = false;     // zapamätaný stav rozbalenia sekcie Odôvodnenie

// Úkon objekt:
//   { _uid, id, datum, miesto: 'v-sidle'|'mimo-sidla',
//     cestaMin, cestaKm, obojsmerna, cenaPhmManual }
// cestaMin/cestaKm sú JEDNOSMERNÉ; obojsmerná cesta sa zdvojnásobí v toEngineState().
// cenaPhmManual = null → použije sa cena z databázy ŠÚ SR podľa dátumu úkonu.

// ---------- Util ----------

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtEur(x) {
  if (x == null || isNaN(x)) return '—';
  return new Intl.NumberFormat('sk-SK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(x) + ' €';
}

function fmtL(x) {
  return x.toFixed(2).replace('.', ',') + ' l';
}

function fmtDate(iso) {
  if (!iso || iso.length < 10) return iso || '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function round2(x) { return Math.round(x * 100) / 100; }

function fmtFraction(f) {
  if (f === 1) return '1';
  if (Math.abs(f - 2/3) < 1e-9) return '⅔';
  if (Math.abs(f - 0.5) < 1e-9) return '½';
  if (Math.abs(f - 1/3) < 1e-9) return '⅓';
  if (Math.abs(f - 0.25) < 1e-9) return '¼';
  // Jednotkové zlomky (1/n) — napr. trestné sadzby §12 1/12, 1/8, 1/6, 1/24.
  const inv = 1 / f;
  const n = Math.round(inv);
  if (n > 0 && Math.abs(inv - n) < 1e-9) return '1/' + n;
  return String(f);
}

function pluralPolhodina(n) {
  if (n === 1) return 'polhodina';
  if (n >= 2 && n <= 4) return 'polhodiny';
  return 'polhodín';
}

// Číselný vstup akceptuje bodku aj čiarku ako desatinný oddeľovač.
function parseDecimal(s) {
  if (s == null) return null;
  const t = String(s).trim().replace(/\s/g, '').replace(',', '.');
  if (t === '') return null;
  const v = parseFloat(t);
  return isNaN(v) ? null : v;
}

function parseIntInput(s) {
  if (s == null) return null;
  const t = String(s).trim().replace(/\s/g, '').replace(',', '.');
  if (t === '') return null;
  const v = parseInt(t, 10);
  return isNaN(v) ? null : v;
}

// Zobrazenie čísla v poli — desatinné s čiarkou (slovenský zvyk).
function displayDecimal(n) {
  return n == null ? '' : String(n).replace('.', ',');
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v === false || v == null) { /* skip */ }
    else e.setAttribute(k, v);
  }
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c == null) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

// Informatívna bublina (ⓘ) — po prejdení myšou zobrazí vysvetlenie.
function buildInfoIcon(text) {
  return el('span', { class: 'info', tabindex: '0', 'aria-label': text }, [
    'i',
    el('span', { class: 'info-tip' }, text)
  ]);
}

// Textové číselné pole, ktoré akceptuje bodku aj čiarku. Hodnota sa normalizuje pri opustení
// poľa. `commit(parsed)` uloží hodnotu do stavu a vráti uloženú hodnotu na zobrazenie.
function makeNumInput({ value, decimal = true, placeholder = '', cls = 'inp', commit }) {
  const inp = el('input', {
    type: 'text',
    inputmode: decimal ? 'decimal' : 'numeric',
    class: cls,
    placeholder
  });
  inp.value = value == null ? '' : (decimal ? displayDecimal(value) : String(value));
  inp.addEventListener('change', () => {
    const parsed = decimal ? parseDecimal(inp.value) : parseIntInput(inp.value);
    const stored = commit(parsed);
    inp.value = stored == null ? '' : (decimal ? displayDecimal(stored) : String(stored));
  });
  return inp;
}

// Formát peňažnej sumy pre pole — tisíce oddelené bodkou, „,-" pre celé sumy (30.000,- €).
function fmtSpor(n) {
  if (n == null || isNaN(n)) return '';
  const neg = n < 0;
  const abs = Math.abs(n);
  const whole = Math.floor(abs);
  const cents = Math.round((abs - whole) * 100);
  const wholeStr = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const decStr = cents === 0 ? '-' : String(cents).padStart(2, '0');
  return (neg ? '-' : '') + wholeStr + ',' + decStr + ' €';
}

// Rozparsuje peňažnú sumu — rozozná tisícový aj desatinný oddeľovač (bodka aj čiarka).
function parseCurrency(s) {
  if (s == null) return null;
  let t = String(s).toLowerCase().replace(/eur|€/g, '').replace(/\s/g, '').replace(/,-$/, '');
  if (t === '' || t === '-') return null;
  const hasDot = t.includes('.');
  const hasComma = t.includes(',');
  if (hasDot && hasComma) {
    // posledný oddeľovač je desatinný, druhý je tisícový
    if (t.lastIndexOf(',') > t.lastIndexOf('.')) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
  } else if (hasComma) {
    t = (t.split(',').length - 1) > 1 ? t.replace(/,/g, '') : t.replace(',', '.');
  } else if (hasDot) {
    const parts = t.split('.');
    // viac bodiek → tisícové; jedna bodka s 3 číslicami za ňou → tiež tisícová
    if (parts.length > 2) t = t.replace(/\./g, '');
    else if (parts[1] && parts[1].length === 3) t = t.replace('.', '');
  }
  const v = parseFloat(t);
  return isNaN(v) ? null : v;
}

// Pole pre peňažnú sumu — pri opustení sa zobrazí vo formáte ceny (30.000,- €),
// pri zameraní sa prepne na čistú editovateľnú hodnotu.
function makeMoneyInput({ value, placeholder = '', commit }) {
  const inp = el('input', { type: 'text', inputmode: 'decimal', class: 'inp', placeholder });
  inp.value = value == null ? '' : fmtSpor(value);
  inp.addEventListener('focus', () => {
    inp.value = value == null ? '' : displayDecimal(value);
    inp.select();
  });
  inp.addEventListener('blur', () => { commit(parseCurrency(inp.value)); });
  return inp;
}

// ---------- Engine adaptér ----------
// Prepočíta UI-stav na vstup pre engine: jednosmerné cesta/km × (obojsmerná ? 2 : 1),
// minúty cesty → začaté polhodiny (§17 ods. 1), náhrada za PHM (spotreba × km × cena),
// hotové výdavky → súčet položiek, príznak platiteľa DPH.

function toEngineState(s) {
  return {
    konanieType: s.konanieType,
    hodnotaSporu: s.hodnotaSporu,
    trestnaSadzbaId: s.trestnaSadzbaId,
    hotoveVydavky: s.vydavky.reduce((acc, v) => acc + (v.suma || 0), 0),
    platcaDph: s.platcaDph,
    caseLabel: s.caseLabel,
    // §13 multipliery
    pocetOsob: s.pocetOsob,
    upravaSadzbyPct: s.upravaSadzbyPct,
    spojeneVeci: (s.konanieType === 'civil-value')
      ? s.spojeneVeci.filter(v => v.hodnota != null && v.hodnota > 0).map(v => ({ hodnota: v.hodnota }))
      : [],
    // §12 ods. 7 / §14 ods. 7
    opatrovnikNedotiahol: s.opatrovnikNedotiahol,
    dohodaVT: s.dohodaVT,
    dohodaVTDatum: s.dohodaVTDatum,
    ukony: s.ukony.map(u => {
      const mimo = u.miesto === 'mimo-sidla';
      const mult = u.obojsmerna ? 2 : 1;
      const totalMin = mimo ? (u.cestaMin || 0) * mult : 0;
      const totalKm = mimo ? (u.cestaKm || 0) * mult : 0;

      let phmEur = 0;
      if (mimo && s.vozidlo.spotreba != null && s.vozidlo.spotreba > 0 && totalKm > 0) {
        const cena = (u.cenaPhmManual != null)
          ? u.cenaPhmManual
          : cenaPhm(u.datum, s.vozidlo.druh);
        if (cena != null && cena > 0) {
          phmEur = round2(s.vozidlo.spotreba / 100 * totalKm * cena);
        }
      }

      return {
        id: u.id,
        datum: u.datum,
        lossOfTimeHalfHours: totalMin > 0 ? Math.ceil(totalMin / 30) : 0,
        travelKm: totalKm,
        phmEur: phmEur
      };
    })
  };
}

// Per-úkon náhľadové hodnoty pre sekciu „Úkony právnej služby".
function ukonDerived(u) {
  // vz     — výpočtový základ pre TARIFNÚ ODMENU (trestné §1 ods. 4; civilné §1 ods. 3)
  // vzNahr — výpočtový základ pre paušál (§16 ods. 3) a stratu času (§17), vždy §1 ods. 3
  let vz = null, vzNahr = null, rok = null;
  if (u.datum && u.datum.length >= 4) {
    const r = parseInt(u.datum.slice(0, 4), 10);
    if (!isNaN(r)) {
      rok = r;
      try { vz = vzPreUkon(r, state.konanieType); } catch (e) { vz = null; }
      try { vzNahr = vzNahradova(r); } catch (e) { vzNahr = null; }
    }
  }
  const ukonDef = ukonyPre(state.konanieType).find(x => x.id === u.id);
  const fraction = ukonDef ? ukonDef.fraction : 1;
  const konanieDef = TARIFF.konania[state.konanieType] || {};

  // Základná sadzba úkonu + tarifná odmena (rovnaký výpočet ako engine).
  let sadzbaZakladna = null;
  try {
    if (jeOpatrovnik()) {
      sadzbaZakladna = 0;  // §12 ods. 7 — odmena je paušál za celé konanie (nie per úkon)
    } else if (state.konanieType === 'civil-value') {
      if (state.hodnotaSporu != null && state.hodnotaSporu > 0) {
        sadzbaZakladna = round2(sadzbaHodnotova(state.hodnotaSporu));
      }
    } else if (konanieDef.tarifna_zlomok != null) {
      // §11 ods. 1/3/4 — nehodnotové (1/13, 1/4 Ústavný, 1/6 správne).
      if (vz != null) sadzbaZakladna = round2(sadzbaNehodnotova(vz, konanieDef.tarifna_zlomok));
    } else if (state.konanieType === 'criminal') {
      if (vz != null) sadzbaZakladna = round2(sadzbaTrestna(vz, trestnaSadzbaDef().zlomok));
    }
  } catch (e) { sadzbaZakladna = null; }

  // §13 — efektívna základná sadzba (spojenie vecí) × osoby × diskrečná úprava × fraction.
  const mO = multOsob(), mU = multUprava(), prir = prirastokSpojenie();
  const tarifna = (sadzbaZakladna != null)
    ? round2((sadzbaZakladna + prir) * mO * mU * fraction) : null;

  const mimo = u.miesto === 'mimo-sidla';
  const mult = u.obojsmerna ? 2 : 1;
  const totalMin = mimo ? (u.cestaMin || 0) * mult : 0;
  const totalKm = mimo ? (u.cestaKm || 0) * mult : 0;
  const polhodiny = totalMin > 0 ? Math.ceil(totalMin / 30) : 0;
  // §16 ods. 3 — pri režime opatrovníka (§12 ods. 7) sa réžia za úkon neúčtuje.
  const pausal = jeOpatrovnik() ? 0
    : (vzNahr != null ? round2(vzNahr * TARIFF.parameters.rezijny_pausal_zlomok) : null);
  const strataSuma = (vzNahr != null && polhodiny > 0)
    ? round2(polhodiny * vzNahr * TARIFF.parameters.strata_casu_zlomok) : 0;
  const cSadzba = (mimo && totalKm > 0) ? sadzbaCestovneEurPerKm(u.datum) : null;
  const cestovneSuma = (cSadzba != null) ? round2(totalKm * cSadzba) : 0;

  // PHM
  const spotreba = state.vozidlo.spotreba;
  const cenaAuto = mimo ? cenaPhm(u.datum, state.vozidlo.druh) : null;
  const phmJeAuto = (u.cenaPhmManual == null);
  const cenaUcinna = phmJeAuto ? cenaAuto : u.cenaPhmManual;
  let palivoL = 0, phmSuma = 0;
  if (mimo && spotreba != null && spotreba > 0 && totalKm > 0) {
    const raw = spotreba / 100 * totalKm;
    palivoL = round2(raw);
    if (cenaUcinna != null && cenaUcinna > 0) phmSuma = round2(raw * cenaUcinna);
  }

  const ukonTotal = (tarifna != null)
    ? round2(tarifna + (pausal || 0) + strataSuma + cestovneSuma + phmSuma)
    : null;

  return {
    vz, vzNahr, rok, fraction, mimo, totalKm, polhodiny, pausal, strataSuma,
    cSadzba, cestovneSuma, sadzbaZakladna, tarifna, ukonTotal,
    spotreba, cenaAuto, cenaUcinna, phmJeAuto, palivoL, phmSuma,
    multOsob: mO, multUprava: mU, prirastok: prir
  };
}

function ukonWarnings(u) {
  const w = [];
  if (u.datum && u.datum < '2009-01-01') {
    w.push({ level: 'error', text: 'Kalkulačka pokrýva úkony od 1. 1. 2009 — pre skoršie nie je výpočtový základ zahrnutý.' });
  } else if (u.datum && u.datum < '2024-01-01') {
    w.push({ level: 'warn', text: 'Pred 1. 1. 2024 platilo iné znenie vyhlášky — výpočet môže byť nepresný.' });
  }
  if (u.miesto === 'mimo-sidla' && u.cestaKm > 0 && u.datum && u.datum < '2019-06-01') {
    w.push({ level: 'warn', text: 'Sadzba cestovných náhrad pred 1. 6. 2019 nie je v kalkulačke — zadajte ju ručne.' });
  }
  return w;
}

// Odvodenie ceny úkonu — pri hodnotovom spore z hodnoty sporu, pri neoceniteľnej veci z VZ.
// Označenie riadku tarifnej odmeny vo výsledku/exporte podľa typu konania.
function tarifnaLabelText() {
  if (state.konanieType === 'civil-value') return 'Tarifná odmena (§ 10)';
  if (state.konanieType === 'criminal') {
    return jeOpatrovnik() ? 'Odmena opatrovníka (§ 12 ods. 7)' : 'Tarifná odmena (§ 12, § 14)';
  }
  if (state.konanieType === 'ustavny') return 'Tarifná odmena (§ 11 ods. 3)';
  if (state.konanieType === 'spravne' || state.konanieType === 'socialne') return 'Tarifná odmena (§ 11 ods. 4)';
  return 'Tarifná odmena (§ 11 ods. 1)';
}

// Formát multipliera (1.5 → „1,5").
function fmtMult(m) {
  return (Math.round(m * 1000) / 1000).toString().replace('.', ',');
}

function tarifnaNote(d) {
  if (jeOpatrovnik()) return 'odmena je paušál za celé konanie (uvedený vo výsledku nižšie)';
  const konanieDef = TARIFF.konania[state.konanieType] || {};
  let base;
  if (state.konanieType === 'civil-value') {
    if (d.sadzbaZakladna == null) return 'zadajte hodnotu sporu';
    base = `základná sadzba ${fmtEur(d.sadzbaZakladna)} podľa hodnoty sporu ${fmtEur(state.hodnotaSporu)}`;
  } else if (state.konanieType === 'criminal') {
    if (d.vz == null) return 'zadajte dátum úkonu';
    const s = trestnaSadzbaDef();
    base = `${fmtFraction(s.zlomok)} z trestného výpočtového základu ${fmtEur(d.vz)} (§ 1 ods. 4 · mzda za 1. polrok ${d.rok - 4}) podľa ${s.ref}`;
  } else if (konanieDef.tarifna_zlomok != null) {
    if (d.vz == null) return 'zadajte dátum úkonu';
    base = `${fmtFraction(konanieDef.tarifna_zlomok)} z výpočtového základu ${fmtEur(d.vz)} · rok ${d.rok}`;
  } else {
    if (d.vz == null) return 'zadajte dátum úkonu';
    base = `1/13 z výpočtového základu ${fmtEur(d.vz)} · rok ${d.rok}`;
  }
  // §13 ods. 3 — spojenie vecí (príplatok k základnej sadzbe)
  if (d.prirastok > 0) base = `(${base} + ${fmtEur(d.prirastok)} § 13 ods. 3 spojenie vecí)`;
  // sadzba úkonu (fraction)
  let s = d.fraction !== 1 ? `${fmtFraction(d.fraction)} × ${base}` : base;
  // §13 ods. 2 / ods. 1/5 — multipliery
  if (d.multOsob !== 1) {
    s += ` · × ${fmtMult(d.multOsob)} (§ 13 ods. 2 — ${state.pocetOsob} spoločne zastupovaných osôb)`;
  }
  if (d.multUprava !== 1) {
    const znak = state.upravaSadzbyPct > 0 ? '+' : '';
    const ref = state.upravaSadzbyPct > 0 ? 'ods. 5' : 'ods. 1';
    s += ` · × ${fmtMult(d.multUprava)} (§ 13 ${ref} ${znak}${state.upravaSadzbyPct} %)`;
  }
  return s;
}

// ---------- Render ----------

function render() {
  const root = document.getElementById('app');
  root.innerHTML = '';
  root.appendChild(renderHeader());
  root.appendChild(renderCaseLabel());
  root.appendChild(renderKonanieType());
  if (state.konanieType === 'civil-value') {
    root.appendChild(renderHodnotaSporu());
  }
  if (state.konanieType === 'criminal') {
    root.appendChild(renderTrestnaSadzba());
  }
  root.appendChild(renderUkony());
  const uprava = renderUprava13();
  if (uprava) root.appendChild(uprava);
  if (state.ukony.some(u => u.miesto === 'mimo-sidla')) {
    root.appendChild(renderVozidlo());
  }
  root.appendChild(renderVydavky());
  root.appendChild(renderResult());
  const pril = renderPrilohy();
  if (pril) root.appendChild(pril);
  root.appendChild(renderFooter());

  if (!introDone) {
    introDone = true;
    root.classList.add('intro');
    setTimeout(() => root.classList.remove('intro'), 1600);
  }
}

// Hlavička sekcie — bloky nie sú číslované (zbytočný vizuálny šum).
function sectionHead(title) {
  return el('div', { class: 'block-head' }, [ el('h2', {}, title) ]);
}

function renderHeader() {
  return el('header', { class: 'masthead' }, [
    el('p', { class: 'kicker' }, 'Legal Engineering · Advokátska tarifa'),
    el('h1', {}, 'Kalkulačka trov právneho zastúpenia'),
    el('p', { class: 'subtitle' },
      `Vyhláška MS SR č. 655/2004 Z. z. v znení neskorších predpisov · DPH ${(TARIFF.parameters.vat_rate * 100).toFixed(0)} % · v${TARIFF.meta.version}`)
  ]);
}

function renderCaseLabel() {
  return el('section', { class: 'block' }, [
    sectionHead('Prípad'),
    el('label', { class: 'field' }, [
      el('span', { class: 'field-label' }, 'Označenie veci (voliteľné)'),
      el('input', {
        type: 'text', class: 'inp', value: state.caseLabel,
        placeholder: 'napr. Novák ./. Nováková — rozvod',
        oninput: (e) => { state.caseLabel = e.target.value; }
      })
    ])
  ]);
}

function renderKonanieType() {
  const wrap = el('section', { class: 'block' }, [ sectionHead('Typ konania') ]);
  const group = el('div', { class: 'radio-group' });
  for (const [id, def] of Object.entries(TARIFF.konania)) {
    const inputAttrs = {
      type: 'radio',
      name: 'konanieType',
      value: id,
      onchange: () => {
        const staraRodina = konanieFamily(state.konanieType);
        state.konanieType = id;
        if (id !== 'civil-value') state.hodnotaSporu = null;
        // Pri zmene rodiny (civilné ↔ trestné) sa mení zoznam úkonov (§13a vs §14);
        // existujúce úkony premapujeme na prvý úkon novej rodiny (zachová dátumy a cesty).
        if (konanieFamily(id) !== staraRodina) {
          const def = defaultUkonId(id);
          state.ukony.forEach(u => { u.id = def; });
        }
        render();
      }
    };
    if (state.konanieType === id) inputAttrs.checked = true;
    if (!def.enabled) inputAttrs.disabled = true;
    group.appendChild(el('label', { class: 'radio' + (def.enabled ? '' : ' disabled') }, [
      el('input', inputAttrs),
      el('span', {}, def.label)
    ]));
  }
  wrap.appendChild(group);
  return wrap;
}

function renderHodnotaSporu() {
  const sec = el('section', { class: 'block' }, [ sectionHead('Hodnota sporu') ]);

  // §10 ods. 8/9 — predvoľby osobitných pevných tarifných hodnôt.
  sec.appendChild(el('label', { class: 'field' }, [
    el('span', { class: 'field-label' }, 'Predmet sporu (predvoľba tarifnej hodnoty)'),
    el('select', {
      class: 'inp',
      onchange: (e) => {
        const opt = TARIFF.tarifne_hodnoty_osobitne.find(o => o.id === e.target.value);
        if (opt) state.hodnotaSporu = opt.hodnota;
        render();
      }
    }, [
      el('option', { value: '', selected: true }, 'Vlastná tarifná hodnota'),
      ...TARIFF.tarifne_hodnoty_osobitne.map(o => el('option', { value: o.id }, o.label))
    ])
  ]));

  sec.appendChild(el('label', { class: 'field' }, [
    el('span', { class: 'field-label' }, 'Tarifná hodnota sporu (€)'),
    makeMoneyInput({
      value: state.hodnotaSporu, placeholder: 'napr. 30 000',
      commit: (p) => {
        state.hodnotaSporu = (p == null || p < 0) ? null : p;
        render();
      }
    })
  ]));

  sec.appendChild(el('p', { class: 'hint' },
    'Osobitné tarifné hodnoty podľa § 10 ods. 8 (ochrana osobnosti 3 000 € / 5 000 €) a ods. 9 ' +
    '(osobné údaje, nekalá súťaž, obchodné tajomstvo, duševné vlastníctvo — 5 000 €) vyberte z predvoľby; ' +
    'inak zadajte tarifnú hodnotu priamo.'));
  return sec;
}

// Sekcia „Úprava odmeny (§ 13)" — multipliery. Pri režime opatrovníka (§ 12 ods. 7) sa
// § 13 neuplatňuje (odmena je paušál) → vráti null.
function renderUprava13() {
  if (jeOpatrovnik()) return null;
  const sec = el('section', { class: 'block' }, [ sectionHead('Úprava odmeny (§ 13)') ]);

  // §13 ods. 2 — počet spoločne zastupovaných osôb
  sec.appendChild(el('label', { class: 'field' }, [
    el('span', { class: 'field-label' }, ['Počet spoločne zastupovaných osôb ', el('span', { class: 'ref' }, '§ 13 ods. 2')]),
    makeNumInput({
      value: state.pocetOsob, decimal: false, placeholder: '1',
      commit: (p) => { state.pocetOsob = (p == null || p < 1) ? 1 : p; render(); return state.pocetOsob; }
    })
  ]));
  sec.appendChild(el('p', { class: 'hint' }, state.pocetOsob > 1
    ? `Za spoločné úkony patrí za prvú osobu plná sadzba a za druhú a každú ďalšiu 50 % — efektívny násobok ${fmtMult(multOsob())}× základnej sadzby tarifnej odmeny.`
    : 'Ak advokát spoločnými úkonmi zastupuje viac osôb, za druhú a každú ďalšiu osobu patrí 50 % sadzby (§ 13 ods. 2).'));

  // §13 ods. 1/5 — diskrečná úprava sadzby (−50 … +50 %)
  sec.appendChild(el('label', { class: 'field' }, [
    el('span', { class: 'field-label' }, ['Úprava základnej sadzby ', el('span', { class: 'ref' }, '§ 13 ods. 1/5')]),
    el('div', { class: 'sub-input-row' }, [
      makeNumInput({
        value: state.upravaSadzbyPct, decimal: false, cls: 'inp inp-sm',
        commit: (p) => {
          let v = (p == null) ? 0 : Math.max(-50, Math.min(50, p));
          state.upravaSadzbyPct = v; render(); return v;
        }
      }),
      el('span', { class: 'unit' }, '%')
    ])
  ]));
  sec.appendChild(el('p', { class: 'hint' },
    'Zvýšenie najviac o +50 % pri úkonoch mimoriadne obťažných, časovo náročných alebo vyžadujúcich ' +
    'znalosť cudzieho práva či jazyka (§ 13 ods. 5); zníženie podľa § 13 ods. 1. Rozsah −50 až +50 %.'));

  // §13 ods. 3 — spojenie vecí (len pri hodnotovom spore)
  if (state.konanieType === 'civil-value') sec.appendChild(renderSpojenieVeci());

  return sec;
}

// §13 ods. 3 — spojenie vecí: zoznam ďalších spojených vecí s ich tarifnou hodnotou.
function renderSpojenieVeci() {
  const grp = el('div', { class: 'ukon-subgroup' });
  grp.appendChild(el('div', { class: 'subs-heading' }, ['Spojenie vecí ', el('span', { class: 'ref' }, '§ 13 ods. 3')]));
  grp.appendChild(el('p', { class: 'hint' },
    'Ak sú na spoločné prejednanie spojené ďalšie veci, k základnej sadzbe sa pripočíta 1/3 zo ' +
    'základnej sadzby každej ďalšej veci. Zadajte tarifné hodnoty ďalších spojených vecí (hlavná vec ' +
    'je hodnota sporu vyššie). Nepoužije sa, ak spojenie vyplýva zo zákona (§ 13 ods. 4).'));

  if (state.spojeneVeci.length) {
    grp.appendChild(el('div', { class: 'vydavky-list' }, state.spojeneVeci.map(v =>
      el('div', { class: 'vydavok-row', 'data-uid': v._uid }, [
        el('label', { class: 'field vydavok-suma' }, [
          el('span', { class: 'field-label' }, 'Tarifná hodnota ďalšej veci (€)'),
          makeMoneyInput({
            value: v.hodnota, placeholder: 'napr. 3 000',
            commit: (p) => { v.hodnota = (p == null || p < 0) ? null : p; render(); }
          })
        ]),
        el('button', {
          class: 'vydavok-del', type: 'button', title: 'Odstrániť spojenú vec', 'aria-label': 'Odstrániť spojenú vec',
          onclick: () => { state.spojeneVeci = state.spojeneVeci.filter(x => x._uid !== v._uid); render(); }
        }, '✕')
      ])
    )));
  }
  grp.appendChild(el('button', {
    class: 'btn-add', type: 'button',
    onclick: () => { spojSeq += 1; state.spojeneVeci.push({ _uid: 'sv' + spojSeq, hodnota: null }); render(); }
  }, '+ Pridať spojenú vec'));
  return grp;
}

// Výber základnej sadzby tarifnej odmeny v trestnom konaní (§ 12) — len pri trestnom konaní.
function renderTrestnaSadzba() {
  const sec = el('section', { class: 'block' }, [
    sectionHead('Základná sadzba (§ 12)'),
    el('label', { class: 'field' }, [
      el('span', { class: 'field-label' }, 'Sadzba tarifnej odmeny podľa povahy veci'),
      el('select', {
        class: 'inp',
        onchange: (e) => { state.trestnaSadzbaId = e.target.value; render(); }
      }, TARIFF.trestne_sadzby.map(s =>
        el('option', { value: s.id, selected: s.id === state.trestnaSadzbaId }, s.label)
      ))
    ]),
    el('p', { class: 'hint' },
      'Sadzba sa odvíja od hornej hranice trestnej sadzby odňatia slobody za daný trestný čin ' +
      '(§ 12 ods. 3), prípadne ide o vec rozhodovanú na neverejnom zasadnutí (§ 12 ods. 1) alebo ' +
      'o konanie o priestupkoch (§ 12 ods. 2). Tarifná odmena sa počíta z výpočtového základu pre ' +
      'trestné konanie podľa § 1 ods. 4 vyhlášky.')
  ]);

  if (jeOpatrovnik()) {
    // §12 ods. 7 — opatrovník: voľba zníženia na 50 %.
    sec.appendChild(el('label', { class: 'sub-check' }, [
      el('input', {
        type: 'checkbox', checked: !!state.opatrovnikNedotiahol,
        onchange: (e) => { state.opatrovnikNedotiahol = e.target.checked; updateResultOnly(); }
      }),
      el('span', {}, 'Opatrovník nezastupoval poškodeného do právoplatného skončenia veci (odmena 50 % = 100 €)')
    ]));
  } else {
    // §14 ods. 7 — dohoda o vine a treste pred podaním obžaloby (+4×).
    sec.appendChild(el('label', { class: 'sub-check' }, [
      el('input', {
        type: 'checkbox', checked: !!state.dohodaVT,
        onchange: (e) => { state.dohodaVT = e.target.checked; render(); }
      }),
      el('span', {}, 'Súdom schválená dohoda o vine a treste pred podaním obžaloby — obhajcovi navyše 4× základná sadzba (§ 14 ods. 7)')
    ]));
    if (state.dohodaVT) {
      sec.appendChild(el('label', { class: 'field' }, [
        el('span', { class: 'field-label' }, 'Dátum schválenia dohody (pre výpočtový základ; voliteľné)'),
        el('input', {
          type: 'date', class: 'inp', value: state.dohodaVTDatum || '',
          onchange: (e) => { state.dohodaVTDatum = e.target.value || null; updateResultOnly(); }
        })
      ]));
    }
  }
  return sec;
}

function renderUkony() {
  const sec = el('section', { class: 'block' }, [ sectionHead('Úkony právnej služby') ]);

  if (state.ukony.length === 0) {
    sec.appendChild(el('p', { class: 'hint' }, 'Zatiaľ žiadne úkony. Pridajte aspoň jeden.'));
  } else {
    sec.appendChild(el('div', { class: 'ukon-list' },
      state.ukony.map((u, i) => renderUkon(u, i))));
  }

  const actions = el('div', { class: 'ukon-actions' }, [
    el('button', { class: 'btn-add', type: 'button', onclick: addUkon }, '+ Pridať úkon')
  ]);
  // Úkony sa dajú zadať v ľubovoľnom poradí — jedným tlačidlom ich zoradíme podľa dátumu.
  if (state.ukony.length >= 2) {
    actions.appendChild(el('button', {
      class: 'btn-sort', type: 'button', onclick: sortUkony,
      title: 'Zoradí úkony od najstaršieho po najnovší'
    }, '↑↓ Zoradiť podľa dátumu'));
  }
  sec.appendChild(actions);

  return sec;
}

// Zoradí úkony chronologicky podľa dátumu (úkony bez dátumu idú na koniec).
function sortUkony() {
  state.ukony.sort((a, b) => {
    const da = a.datum || '9999-99-99';
    const db = b.datum || '9999-99-99';
    return da < db ? -1 : (da > db ? 1 : 0);
  });
  render();
}

function renderUkon(u, idx) {
  const panel = el('div', { class: 'ukon', 'data-uid': u._uid });
  panel.appendChild(buildUkonHead(u, idx));
  panel.appendChild(buildUkonSubs(u));
  for (const w of ukonWarnings(u)) {
    panel.appendChild(el('div', { class: 'ukon-warn warn-' + w.level }, w.text));
  }
  return panel;
}

// Hlavička úkonu — NIKDY sa neprekresľuje pri písaní do polí (chráni dátumové pole).
function buildUkonHead(u, idx) {
  const select = el('select', {
    class: 'inp',
    onchange: (e) => { u.id = e.target.value; refreshUkon(u); }
  }, ukonyPre(state.konanieType).map(ud =>
    el('option', { value: ud.id, selected: ud.id === u.id }, ud.label)
  ));

  const datumField = el('label', { class: 'field' }, [
    el('span', { class: 'field-label' }, 'Dátum úkonu'),
    el('input', {
      type: 'date', class: 'inp', value: u.datum,
      // Debounced refresh — pole sa pri písaní NEPREKRESĽUJE, takže rok sa dá v pokoji dopísať.
      onchange: (e) => { u.datum = e.target.value; scheduleUkonRefresh(u); }
    })
  ]);

  const miestoField = el('label', { class: 'field' }, [
    el('span', { class: 'field-label' }, 'Miesto výkonu'),
    el('select', {
      class: 'inp',
      // render() — zmena miesta môže pridať/odobrať sekciu „Vozidlo advokáta".
      onchange: (e) => { u.miesto = e.target.value; render(); }
    }, [
      el('option', { value: 'v-sidle', selected: u.miesto !== 'mimo-sidla' }, 'V sídle advokáta'),
      el('option', { value: 'mimo-sidla', selected: u.miesto === 'mimo-sidla' }, 'Mimo sídla advokáta')
    ])
  ]);

  return el('div', { class: 'ukon-head' }, [
    el('span', { class: 'ukon-index' }, String(idx + 1)),
    el('div', { class: 'ukon-body' }, [
      el('label', { class: 'field' }, [
        el('span', { class: 'field-label' }, 'Úkon právnej služby'),
        select
      ]),
      el('div', { class: 'ukon-meta' }, [datumField, miestoField])
    ]),
    el('button', {
      class: 'ukon-del', type: 'button', title: 'Odstrániť úkon', 'aria-label': 'Odstrániť úkon',
      onclick: () => removeUkon(u._uid)
    }, '✕')
  ]);
}

// Položka úkonu, ktorá iba zobrazuje hodnotu (tarifná odmena, režijný paušál) —
// s odvodením, z čoho suma pochádza.
function displaySub({ name, ref, note, value }) {
  return el('div', { class: 'sub' }, [
    el('div', { class: 'sub-main' }, [
      el('span', { class: 'sub-name' }, [name + ' ', el('span', { class: 'ref' }, ref)]),
      el('span', { class: 'sub-note' }, note)
    ]),
    el('span', { class: 'sub-val' }, value != null ? fmtEur(value) : '—')
  ]);
}

// Pod-položky úkonu — tarifná odmena + paušál (vždy) + náhrady za cestu (len mimo sídla).
function buildUkonSubs(u) {
  const d = ukonDerived(u);
  const subs = el('div', { class: 'ukon-subs' });

  // Tarifná odmena — základná položka úkonu, s odvodením ceny.
  const opatrovnik = jeOpatrovnik();
  let tarifnaRef;
  if (state.konanieType === 'civil-value') tarifnaRef = '§ 10';
  else if (state.konanieType === 'criminal') tarifnaRef = opatrovnik ? '§ 12 ods. 7' : '§ 12 · § 14';
  else if (state.konanieType === 'ustavny') tarifnaRef = '§ 11 ods. 3';
  else if (state.konanieType === 'spravne' || state.konanieType === 'socialne') tarifnaRef = '§ 11 ods. 4';
  else tarifnaRef = '§ 11 ods. 1';
  subs.appendChild(displaySub({
    name: opatrovnik ? 'Odmena opatrovníka' : 'Tarifná odmena',
    ref: tarifnaRef,
    note: tarifnaNote(d),
    // Pri opatrovníkovi je odmena paušál za celé konanie (nie per úkon) → zobrazí sa „—".
    value: opatrovnik ? null : d.tarifna
  }));

  // Režijný paušál — z civilného výpočtového základu (§ 1 ods. 3) aj v trestnej veci.
  // Pri opatrovníkovi (§12 ods.7) sa réžia za úkon neúčtuje → položka sa nezobrazí.
  if (!opatrovnik) {
    const pausalNote = (d.vzNahr != null && d.rok != null)
      ? `1/100 z výpočtového základu ${fmtEur(d.vzNahr)} · rok ${d.rok}`
      : 'zadajte dátum úkonu';
    subs.appendChild(displaySub({
      name: 'Režijný paušál', ref: '§ 16 ods. 3', note: pausalNote, value: d.pausal
    }));
  }

  // Náhrady spojené s cestou — vnorená podskupina, len pri úkone mimo sídla.
  if (d.mimo) {
    const grp = el('div', { class: 'ukon-subgroup' });
    grp.appendChild(el('div', { class: 'subs-heading' },
      'Náhrady spojené s cestou do miesta úkonu'));

    grp.appendChild(el('label', { class: 'sub-check' }, [
      el('input', {
        type: 'checkbox', checked: !!u.obojsmerna,
        onchange: (e) => { u.obojsmerna = e.target.checked; refreshUkon(u); }
      }),
      el('span', {}, 'Obojsmerná cesta — čas aj vzdialenosť sa počítajú ×2')
    ]));

    grp.appendChild(buildStrataField(u, d));
    grp.appendChild(buildVozidloField(u, d));
    grp.appendChild(buildPhmField(u, d));
    subs.appendChild(grp);
  }

  // Medzisúčet za úkon.
  subs.appendChild(el('div', { class: 'sub sub-total' }, [
    el('span', { class: 'sub-name' }, 'Spolu za úkon'),
    el('span', { class: 'sub-val' }, d.ukonTotal != null ? fmtEur(d.ukonTotal) : '—')
  ]));

  return subs;
}

// náhrada za stratu času §17 ods. 1
function buildStrataField(u, d) {
  return el('div', { class: 'sub sub-field' }, [
    el('div', { class: 'sub-line' }, [
      el('span', { class: 'sub-name' }, [
        'Náhrada za stratu času ', el('span', { class: 'ref' }, '§ 17 ods. 1')
      ]),
      el('span', { class: 'sub-val' }, d.strataSuma > 0 ? fmtEur(d.strataSuma) : '—')
    ]),
    el('div', { class: 'sub-input-row' }, [
      el('label', {}, [
        el('span', {}, 'Trvanie jednosmernej cesty v minútach'),
        makeNumInput({
          value: u.cestaMin || 0, decimal: false, cls: 'inp inp-sm',
          commit: (p) => {
            u.cestaMin = (p == null || p < 0) ? 0 : p;
            refreshUkon(u);
            return u.cestaMin;
          }
        }),
        el('span', { class: 'unit' }, 'min')
      ]),
      el('span', { class: 'derived' }, `${d.polhodiny} ${pluralPolhodina(d.polhodiny)}`)
    ])
  ]);
}

// náhrada za použitie vlastného vozidla §16 ods. 4 — základná náhrada za km
function buildVozidloField(u, d) {
  return el('div', { class: 'sub sub-field' }, [
    el('div', { class: 'sub-line' }, [
      el('span', { class: 'sub-name' }, [
        'Náhrada za použitie vlastného vozidla ', el('span', { class: 'ref' }, '§ 16 ods. 4')
      ]),
      el('span', { class: 'sub-val' }, d.cestovneSuma > 0 ? fmtEur(d.cestovneSuma) : '—')
    ]),
    el('div', { class: 'sub-input-row' }, [
      el('label', {}, [
        el('span', {}, 'Dĺžka jednosmernej cesty v kilometroch'),
        makeNumInput({
          value: u.cestaKm || 0, decimal: false, cls: 'inp inp-sm',
          commit: (p) => {
            u.cestaKm = (p == null || p < 0) ? 0 : p;
            refreshUkon(u);
            return u.cestaKm;
          }
        }),
        el('span', { class: 'unit' }, 'km')
      ]),
      el('span', { class: 'derived' },
        d.cSadzba != null ? `${d.cSadzba.toFixed(3).replace('.', ',')} €/km`
          : (d.totalKm > 0 ? 'sadzba mimo rozsahu' : ''))
    ])
  ]);
}

// náhrada za pohonné hmoty — cena z databázy ŠÚ SR, prepísateľná
function buildPhmField(u, d) {
  let phmDerived;
  if (d.spotreba == null || d.spotreba <= 0) {
    phmDerived = 'Spotrebu Vášho auta doplňte nižšie, v sekcii „Vozidlo advokáta"';
  } else {
    const zdroj = d.phmJeAuto ? 'cena z databázy ŠÚ SR' : 'vlastná cena';
    phmDerived = `spotrebované palivo ${fmtL(d.palivoL)} · ${zdroj}`;
  }
  return el('div', { class: 'sub sub-field' }, [
    el('div', { class: 'sub-line' }, [
      el('span', { class: 'sub-name' }, [
        'Náhrada za pohonné hmoty ', el('span', { class: 'ref' }, '§ 16 ods. 4')
      ]),
      el('span', { class: 'sub-val' }, d.phmSuma > 0 ? fmtEur(d.phmSuma) : '—')
    ]),
    el('div', { class: 'sub-input-row' }, [
      el('label', {}, [
        el('span', {}, 'Cena paliva za liter'),
        makeNumInput({
          value: d.cenaUcinna, decimal: true, cls: 'inp inp-cena', placeholder: '—',
          commit: (p) => {
            u.cenaPhmManual = (p == null) ? null : Math.max(0, p);
            refreshUkon(u);
            return u.cenaPhmManual;
          }
        }),
        el('span', { class: 'unit' }, '€/l'),
        buildInfoIcon('Predvyplnená cena je priemerná cena pohonných hmôt podľa Štatistického úradu SR za týždeň, v ktorom bol úkon vykonaný. Ak ste tankovali za inú cenu, prepíšte údaj podľa reálnej ceny z bločku.')
      ]),
      el('span', { class: 'derived' }, phmDerived)
    ])
  ]);
}

// Sekcia Vozidlo advokáta — zobrazí sa len keď je aspoň jeden úkon mimo sídla.
function renderVozidlo() {
  return el('section', { class: 'block' }, [
    sectionHead('Vozidlo advokáta'),
    el('div', { class: 'vozidlo-row' }, [
      el('label', { class: 'field' }, [
        el('span', { class: 'field-label' }, 'Spotreba vozidla (l / 100 km)'),
        makeNumInput({
          value: state.vozidlo.spotreba, decimal: true, placeholder: 'napr. 5,4',
          commit: (p) => {
            state.vozidlo.spotreba = (p == null || p < 0) ? null : p;
            render();
            return state.vozidlo.spotreba;
          }
        })
      ]),
      el('label', { class: 'field' }, [
        el('span', { class: 'field-label' }, 'Druh paliva'),
        el('select', {
          class: 'inp',
          onchange: (e) => { state.vozidlo.druh = e.target.value; render(); }
        }, [
          el('option', { value: 'benzin', selected: state.vozidlo.druh !== 'diesel' }, 'Benzín'),
          el('option', { value: 'diesel', selected: state.vozidlo.druh === 'diesel' }, 'Diesel (motorová nafta)')
        ])
      ])
    ]),
    el('p', { class: 'hint' },
      'Spotreba je uvedená v technickom preukaze vozidla. Slúži na výpočet náhrady za pohonné hmoty pri úkonoch mimo sídla.')
  ]);
}

// Sekcia Iné hotové výdavky — zoznam položiek (dátum + označenie + suma).
function renderVydavky() {
  const sec = el('section', { class: 'block' }, [ sectionHead('Iné hotové výdavky') ]);

  if (state.vydavky.length === 0) {
    sec.appendChild(el('p', { class: 'hint' },
      'Zatiaľ žiadne výdavky. Napríklad súdny poplatok, znalecký posudok, preklad či poštovné.'));
  } else {
    sec.appendChild(el('div', { class: 'vydavky-list' },
      state.vydavky.map(v => renderVydavok(v))));
  }

  sec.appendChild(el('button', {
    class: 'btn-add', type: 'button', onclick: addVydavok
  }, '+ Pridať výdavok'));

  return sec;
}

function renderVydavok(v) {
  return el('div', { class: 'vydavok-row', 'data-uid': v._uid }, [
    el('label', { class: 'field vydavok-datum' }, [
      el('span', { class: 'field-label' }, 'Dátum'),
      el('input', {
        type: 'date', class: 'inp', value: v.datum,
        onchange: (e) => { v.datum = e.target.value; updateResultOnly(); }
      })
    ]),
    el('label', { class: 'field vydavok-popis' }, [
      el('span', { class: 'field-label' }, 'Označenie výdavku'),
      el('input', {
        type: 'text', class: 'inp', value: v.popis, placeholder: 'napr. súdny poplatok',
        onchange: (e) => { v.popis = e.target.value; updateResultOnly(); }
      })
    ]),
    el('label', { class: 'field vydavok-suma' }, [
      el('span', { class: 'field-label' }, 'Suma (€)'),
      makeNumInput({
        value: v.suma || null, decimal: true, placeholder: '0,00',
        commit: (p) => {
          v.suma = (p == null || p < 0) ? 0 : p;
          updateResultOnly();
          return v.suma || null;
        }
      })
    ]),
    el('button', {
      class: 'vydavok-del', type: 'button', title: 'Odstrániť výdavok', 'aria-label': 'Odstrániť výdavok',
      onclick: () => removeVydavok(v._uid)
    }, '✕')
  ]);
}

// Naplánuje prekreslenie pod-položiek úkonu (debounce — pri písaní dátumu).
function scheduleUkonRefresh(u) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refreshUkon(u), 300);
}

// Prekreslí LEN pod-položky + warningy úkonu. Hlavičku (a dátumové pole)
// nechá nedotknutú — preto sa rok dá bez problémov dopísať.
function refreshUkon(u) {
  clearTimeout(refreshTimer);
  const card = document.querySelector('.ukon[data-uid="' + u._uid + '"]');
  if (!card) { render(); return; }

  const oldSubs = card.querySelector('.ukon-subs');
  if (oldSubs) oldSubs.replaceWith(buildUkonSubs(u));

  card.querySelectorAll('.ukon-warn').forEach(w => w.remove());
  for (const w of ukonWarnings(u)) {
    card.appendChild(el('div', { class: 'ukon-warn warn-' + w.level }, w.text));
  }

  updateResultOnly();
}

function renderResult() {
  const wrap = el('section', { id: 'result', class: 'block result' }, [
    el('div', { class: 'block-head' }, [ el('h2', {}, 'Výsledok') ])
  ]);

  // §18 ods. 3 — voľba platiteľa DPH (nad číslami výsledku).
  wrap.appendChild(el('label', { class: 'dph-toggle' }, [
    el('input', {
      type: 'checkbox', checked: state.platcaDph,
      onchange: (e) => { state.platcaDph = e.target.checked; updateResultOnly(); }
    }),
    el('span', {}, 'Advokát je platiteľ DPH')
  ]));

  if (state.konanieType === 'civil-value' && (state.hodnotaSporu == null || state.hodnotaSporu <= 0)) {
    wrap.appendChild(el('p', { class: 'notice' }, 'Zadajte tarifnú hodnotu sporu.'));
    return wrap;
  }
  if (state.ukony.length === 0) {
    wrap.appendChild(el('p', { class: 'notice' }, 'Pridajte aspoň jeden úkon.'));
    return wrap;
  }

  let result;
  try {
    result = vypocitajTrovy(toEngineState(state));
  } catch (err) {
    wrap.appendChild(el('p', { class: 'notice' }, 'Chyba výpočtu: ' + err.message));
    return wrap;
  }

  // Prehľad úkonov — bez mätúceho vzorca VZ (odvodenie ceny je pri samotnom úkone vyššie).
  wrap.appendChild(el('ul', { class: 'polozky' },
    result.polozky.map(p => el('li', {}, [
      el('span', { class: 'p-ukon' }, p.ukon),
      el('span', { class: 'p-meta' }, fmtDate(p.datum)),
      el('span', { class: 'p-amount' }, fmtEur(p.sadzba_ukonu))
    ]))
  ));

  const b = result.breakdown;
  const tarifnaLabel = tarifnaLabelText();

  const rows = [];
  if (b.dohodaVT > 0) {
    // §14 ods. 7 — príplatok zobrazíme samostatne (tarifná za úkony bez príplatku + dohoda).
    rows.push(breakdownRow('Tarifná odmena za úkony (§ 12, § 14)', round2(b.tarifna - b.dohodaVT)));
    rows.push(breakdownRow('Dohoda o vine a treste (§ 14 ods. 7 — 4×)', b.dohodaVT));
  } else {
    rows.push(breakdownRow(tarifnaLabel, b.tarifna));
  }
  // Režijný paušál — pri opatrovníkovi (§12 ods.7) je 0 a nezobrazuje sa.
  if (b.pausal > 0) rows.push(breakdownRow('Režijný paušál (§ 16 ods. 3)', b.pausal));
  if (b.strata > 0) rows.push(breakdownRow('Náhrada za stratu času (§ 17 ods. 1)', b.strata));
  if (b.cestovne > 0) rows.push(breakdownRow('Náhrada za použitie vozidla (§ 16 ods. 4)', b.cestovne));
  if (b.phm > 0) rows.push(breakdownRow('Náhrada za pohonné hmoty (§ 16 ods. 4)', b.phm));
  if (b.hotove > 0) rows.push(breakdownRow('Iné hotové výdavky (§ 15 písm. a)', b.hotove));
  rows.push(breakdownRow('Položky spolu bez DPH', b.polozkySpolu, 'subtotal'));
  if (b.platcaDph) {
    rows.push(breakdownRow(`DPH ${(TARIFF.parameters.vat_rate * 100).toFixed(0)} % (§ 18 ods. 3)`, b.dph));
  }
  rows.push(breakdownRow('Spolu trovy', result.total, 'total'));

  wrap.appendChild(el('table', { class: 'breakdown' }, [ el('tbody', {}, rows) ]));

  for (const w of result.warnings) {
    wrap.appendChild(el('p', { class: 'engine-warn' }, w));
  }

  wrap.appendChild(el('div', { class: 'akcie' }, [
    el('button', {
      type: 'button', class: 'btn-primary',
      onclick: () => copyExport(result)
    }, 'Kopírovať tabuľku'),
    el('button', {
      type: 'button', class: 'btn-primary',
      onclick: () => printExport(result)
    }, 'Stiahnuť PDF'),
    el('button', {
      type: 'button', class: 'btn-secondary', title: 'Reset všetkých vstupov',
      onclick: resetAll
    }, 'Reset')
  ]));

  wrap.appendChild(el('label', { class: 'export-opt' }, [
    el('input', {
      type: 'checkbox', checked: state.exportOdovodnenie,
      onchange: (e) => { state.exportOdovodnenie = e.target.checked; }
    }),
    el('span', {}, 'Zahrnúť do kópie aj PDF aj odôvodnenie')
  ]));

  wrap.appendChild(el('span', { id: 'copy-status', class: 'copy-status' }, ''));

  wrap.appendChild(renderOdovodnenie(result));

  return wrap;
}

function breakdownRow(label, value, cls = '') {
  return el('tr', { class: cls }, [
    el('td', {}, label),
    el('td', { class: 'num' }, fmtEur(value))
  ]);
}

// Rozbaliteľné odôvodnenie — použité právne normy pre dané vyčíslenie.
function renderOdovodnenie(result) {
  const det = el('details', {
    class: 'odovodnenie',
    open: odovOpen,
    ontoggle: (e) => { odovOpen = e.target.open; }
  });
  det.appendChild(el('summary', {}, 'Odôvodnenie — použité právne normy'));
  const body = el('div', { class: 'odov-body' });
  for (const s of buildOdovodnenie(result)) {
    if (s.h) body.appendChild(el('h4', {}, s.h));
    for (const p of s.p) body.appendChild(el('p', {}, p));
  }
  det.appendChild(body);
  return det;
}

// Zoznam dôkazov, ktoré treba priložiť k podaniu — odvodený z vyplnených vstupov.
function buildPrilohy(result) {
  const items = [];

  // Doklady o tankovaní — pri úkonoch s ručne zadanou cenou pohonných hmôt.
  state.ukony.forEach((u, i) => {
    const p = result.polozky[i];
    if (u.cenaPhmManual != null && p && p.phm > 0) {
      items.push(`doklad o tankovaní pohonných hmôt v súvislosti s úkonom zo dňa ${fmtDate(u.datum)}`);
    }
  });

  // Technický preukaz — ak sa uplatňuje náhrada za vozidlo alebo pohonné hmoty.
  if (result.polozky.some(p => p.cestovne > 0 || p.phm > 0)) {
    items.push('kópiu technického preukazu vozidla použitého na cesty do miesta úkonov');
  }

  // Osvedčenie o registrácii pre DPH — ak je advokát platiteľom DPH.
  if (state.platcaDph) {
    items.push('osvedčenie o registrácii pre daň z pridanej hodnoty');
  }

  // Doklady k iným hotovým výdavkom.
  for (const v of state.vydavky) {
    if ((v.suma || 0) <= 0) continue;
    const popis = (v.popis && v.popis.trim()) ? `„${v.popis.trim()}"` : 'iného hotového výdavku';
    const datum = v.datum ? ` zo dňa ${fmtDate(v.datum)}` : '';
    items.push(`doklad preukazujúci vynaloženie výdavku ${popis}${datum}`);
  }

  return items;
}

// Výrazná sekcia „Nezabudnite priložiť k podaniu" — len ak je čo pripomenúť.
function renderPrilohy() {
  if (state.ukony.length === 0) return null;
  if (state.konanieType === 'civil-value' && (state.hodnotaSporu == null || state.hodnotaSporu <= 0)) {
    return null;
  }
  let result;
  try { result = vypocitajTrovy(toEngineState(state)); } catch (e) { return null; }

  const items = buildPrilohy(result);
  if (items.length === 0) return null;

  return el('section', { id: 'prilohy', class: 'block prilohy' }, [
    el('div', { class: 'prilohy-head' }, [
      el('span', { class: 'prilohy-badge' }, '!'),
      el('h2', {}, 'Nezabudnite priložiť k podaniu')
    ]),
    el('p', { class: 'prilohy-intro' },
      'V prípade, že dôkazy nie sú už súčasťou súdneho spisu, nezabudnite k podaniu priložiť:'),
    el('ul', { class: 'prilohy-list' }, items.map(it => el('li', {}, it)))
  ]);
}

function renderFooter() {
  return el('footer', { class: 'app-footer' }, [
    el('p', {}, [ el('strong', {}, 'Upozornenie: '), TARIFF.disclaimer ])
  ]);
}

// ---------- Akcie ----------

function addUkon() {
  ukonSeq += 1;
  state.ukony.push({
    _uid: 'u' + ukonSeq,
    id: defaultUkonId(state.konanieType),
    datum: todayIso(),
    miesto: 'v-sidle',
    cestaMin: 0,
    cestaKm: 0,
    obojsmerna: true,
    cenaPhmManual: null
  });
  render();
}

function removeUkon(uid) {
  state.ukony = state.ukony.filter(u => u._uid !== uid);
  render();
}

function addVydavok() {
  vydavokSeq += 1;
  state.vydavky.push({
    _uid: 'v' + vydavokSeq,
    datum: todayIso(),
    popis: '',
    suma: 0
  });
  render();
}

function removeVydavok(uid) {
  state.vydavky = state.vydavky.filter(v => v._uid !== uid);
  render();
}

function resetAll() {
  if (!confirm('Naozaj vymazať všetky úkony a vstupy?')) return;
  state.caseLabel = '';
  state.konanieType = 'civil-nonvalue';
  state.hodnotaSporu = null;
  state.trestnaSadzbaId = '12-3-a';
  state.ukony = [];
  state.vozidlo = { spotreba: null, druh: 'benzin' };
  state.vydavky = [];
  state.platcaDph = true;
  state.exportOdovodnenie = false;
  state.pocetOsob = 1;
  state.upravaSadzbyPct = 0;
  state.spojeneVeci = [];
  state.opatrovnikNedotiahol = false;
  state.dohodaVT = false;
  state.dohodaVTDatum = null;
  ukonSeq = 0;
  vydavokSeq = 0;
  spojSeq = 0;
  render();
}

function updateResultOnly() {
  const old = document.getElementById('result');
  if (!old) return;
  old.replaceWith(renderResult());

  // Sekcia príloh závisí od rovnakých vstupov — udržíme ju v synchróne.
  const oldPril = document.getElementById('prilohy');
  const newPril = renderPrilohy();
  if (oldPril && newPril) oldPril.replaceWith(newPril);
  else if (oldPril) oldPril.remove();
  else if (newPril) document.getElementById('result').after(newPril);
}

// ---------- Odôvodnenie ----------

// Opatrenia MPSVaR, ktoré sa reálne použili pri cestovných náhradách (podľa dátumov úkonov).
function usedOpatrenia(result) {
  const seen = new Set();
  const list = [];
  for (const p of result.polozky) {
    if (p.cestovne_eur_per_km == null) continue;
    const o = TARIFF.cestovne_opatrenia.find(x => x.eur_per_km === p.cestovne_eur_per_km);
    if (o && !seen.has(o.opatrenie)) { seen.add(o.opatrenie); list.push(o); }
  }
  list.sort((a, b) => (a.od < b.od ? -1 : 1));
  return list;
}

function opatrVeta(o) {
  return `opatrenie č. ${o.opatrenie} (účinné od ${fmtDate(o.od)}) — ${displayDecimal(o.eur_per_km)} €/km`;
}

// Zostaví odôvodnenie ako pole sekcií { h, p[] } — citujú sa len normy reálne použité.
function buildOdovodnenie(result) {
  const b = result.breakdown;
  const sections = [];

  sections.push({ h: null, p: [
    'Výška trov právneho zastúpenia bola určená podľa Vyhlášky Ministerstva spravodlivosti ' +
    'Slovenskej republiky č. 655/2004 Z. z. o odmenách a náhradách advokátov za poskytovanie ' +
    'právnych služieb v znení neskorších predpisov (ďalej len „Vyhláška").'
  ]});

  // Tarifná odmena
  const tarifP = [];
  if (state.konanieType === 'civil-value') {
    tarifP.push(
      'Predmet konania je oceniteľný v peniazoch, preto sa základná sadzba tarifnej odmeny ' +
      'za jeden úkon právnej služby určuje podľa § 10 Vyhlášky z tarifnej hodnoty veci. ' +
      `Tarifná hodnota v tejto veci je ${fmtEur(state.hodnotaSporu)}. Základná sadzba je ` +
      'v § 10 odstupňovaná do pásiem podľa výšky tarifnej hodnoty.'
    );
    if (result.polozky.some(p => p.fraction !== 1)) {
      tarifP.push(
        'Za niektoré úkony právnej služby patrí odmena v zníženej — polovičnej alebo ' +
        'štvrtinovej — sadzbe základnej tarifnej odmeny podľa § 13a Vyhlášky.'
      );
    }
  } else if (state.konanieType === 'criminal') {
    const s = trestnaSadzbaDef();
    if (s.pausal_eur != null) {
      // §12 ods. 7 — opatrovník na ochranu práv poškodeného (paušál za celé konanie).
      tarifP.push(
        'Advokát bol v trestnom konaní ustanovený za opatrovníka na ochranu práv poškodeného ' +
        'v prípade, v ktorom zákonný zástupca poškodeného nemôže vykonávať svoje práva. Podľa ' +
        '§ 12 ods. 7 Vyhlášky mu za celé konanie patrí odmena vo výške 200 eur. ' +
        (state.opatrovnikNedotiahol
          ? `Keďže nezastupoval poškodeného ako opatrovník do právoplatného skončenia veci, patrí mu 50 % tejto sumy, t. j. ${fmtEur(b.opatrovnik)}.`
          : `Odmena sa uplatňuje v plnej výške ${fmtEur(b.opatrovnik)}.`)
      );
    } else {
      tarifP.push(
        'Ide o ' + (s.id === '12-2' ? 'zastupovanie v konaní o priestupkoch' : 'obhajobu v trestnom konaní') +
        `. Základná sadzba tarifnej odmeny za jeden úkon právnej služby je podľa ${s.ref} Vyhlášky ` +
        `${fmtFraction(s.zlomok)} výpočtového základu.`
      );
      const roky = [...new Set(result.polozky.map(p => p.vz_rok))].sort();
      const vzVety = roky.map(r => `${fmtEur(TARIFF.vypoctovy_zaklad_eur[String(r)])} (mzda za 1. polrok roku ${r - 1})`);
      tarifP.push(
        'Výpočtovým základom na účely tarifnej odmeny v trestnom konaní a v konaní o priestupkoch ' +
        'je podľa § 1 ods. 4 Vyhlášky priemerná mesačná mzda zamestnanca hospodárstva Slovenskej ' +
        'republiky za prvý polrok kalendárneho roka, ktorý o tri roky predchádza roku určujúcemu ' +
        'výpočtový základ podľa § 1 ods. 3. Pre úkony v tomto vyčíslení tak výpočtový základ ' +
        `tarifnej odmeny predstavuje: ${vzVety.join('; ')}.`
      );
      if (result.polozky.some(p => p.fraction !== 1)) {
        tarifP.push(
          'Za niektoré úkony právnej služby patrí podľa § 14 Vyhlášky odmena v zníženej sadzbe ' +
          'základnej tarifnej odmeny — dve tretiny (ods. 2), polovica (ods. 3), tretina (ods. 4) ' +
          'alebo štvrtina (ods. 5). Najmä za ďalšiu poradu s klientom kratšiu ako jedna hodina ' +
          'patrí podľa § 14 ods. 4 Vyhlášky tretina odmeny a za obhajobu na pojednávaní, na ktorom ' +
          'došlo iba k vyhláseniu rozhodnutia alebo ktoré bolo odročené bez prejednania veci, ' +
          'patrí podľa § 14 ods. 5 Vyhlášky štvrtina odmeny.'
        );
      }
    }
  } else {
    // §11 — nehodnotové konania; rozlíšenie podľa typu (ods. 1, ods. 3, ods. 4).
    if (state.konanieType === 'ustavny') {
      tarifP.push(
        'Ide o zastupovanie pred Ústavným súdom Slovenskej republiky, v ktorom predmet sporu nemožno ' +
        'oceniť peniazmi, preto je základná sadzba tarifnej odmeny za jeden úkon právnej služby podľa ' +
        '§ 11 ods. 3 Vyhlášky jedna štvrtina výpočtového základu.'
      );
    } else if (state.konanieType === 'spravne') {
      tarifP.push(
        'Ide o zastupovanie v konaní podľa Správneho súdneho poriadku, preto je základná sadzba ' +
        'tarifnej odmeny za jeden úkon právnej služby podľa § 11 ods. 4 Vyhlášky jedna šestina ' +
        'výpočtového základu.'
      );
    } else if (state.konanieType === 'socialne') {
      tarifP.push(
        'Ide o dávkovú vec sociálneho poistenia, resp. vec sociálnych služieb, preto je základná ' +
        'sadzba tarifnej odmeny za jeden úkon právnej služby podľa § 11 ods. 4 Vyhlášky jedna ' +
        'trinástina výpočtového základu.'
      );
    } else {
      tarifP.push(
        'Hodnotu veci nemožno vyjadriť v peniazoch, prípadne ju možno zistiť len s nepomernými ' +
        'ťažkosťami, preto je základná sadzba tarifnej odmeny za jeden úkon právnej služby ' +
        'podľa § 11 ods. 1 Vyhlášky jedna trinástina výpočtového základu.'
      );
    }
    const roky = [...new Set(result.polozky.map(p => p.vz_rok))].sort();
    const vzVety = roky.map(r => `rok ${r} = ${fmtEur(TARIFF.vypoctovy_zaklad_eur[String(r)])}`);
    tarifP.push(
      'Výpočtovým základom je priemerná mesačná mzda zamestnanca hospodárstva Slovenskej ' +
      'republiky za prvý polrok predchádzajúceho kalendárneho roka (§ 1 ods. 3 Vyhlášky). ' +
      `Pre úkony v tomto vyčíslení sa použil výpočtový základ: ${vzVety.join('; ')}.`
    );
    if (result.polozky.some(p => p.fraction !== 1)) {
      tarifP.push(
        'Za niektoré úkony právnej služby patrí odmena v zníženej — polovičnej alebo ' +
        'štvrtinovej — sadzbe základnej tarifnej odmeny podľa § 13a Vyhlášky.'
      );
    }
  }
  sections.push({ h: 'Tarifná odmena', p: tarifP });

  // §13 — úprava tarifnej odmeny (multipliery).
  if (b.multOsob > 1 || b.upravaPct !== 0 || b.prirastokSpojenie > 0) {
    const u13 = [];
    if (b.multOsob > 1) {
      u13.push(
        `Advokát spoločnými úkonmi zastupoval ${b.pocetOsob} osoby. Podľa § 13 ods. 2 Vyhlášky sa ` +
        'základná sadzba tarifnej odmeny za druhú a každú ďalšiu spoločne zastupovanú osobu znižuje ' +
        `o 50 %, čo pri ${b.pocetOsob} osobách zodpovedá ${fmtMult(b.multOsob)}-násobku základnej sadzby.`
      );
    }
    if (b.upravaPct > 0) {
      u13.push(
        'Vzhľadom na to, že išlo o úkony mimoriadne obťažné, časovo náročné alebo vyžadujúce znalosť ' +
        `cudzieho práva či cudzieho jazyka, bola základná sadzba tarifnej odmeny podľa § 13 ods. 5 ` +
        `Vyhlášky zvýšená o ${b.upravaPct} %.`
      );
    }
    if (b.upravaPct < 0) {
      u13.push(`Základná sadzba tarifnej odmeny bola podľa § 13 ods. 1 Vyhlášky znížená o ${Math.abs(b.upravaPct)} %.`);
    }
    if (b.prirastokSpojenie > 0) {
      u13.push(
        'Vo veci došlo k spojeniu vecí na spoločné prejednanie. Podľa § 13 ods. 3 Vyhlášky sa základná ' +
        'sadzba tarifnej odmeny určená z veci s najvyššou tarifnou hodnotou zvyšuje o tretinu základnej ' +
        `sadzby, ktorá by advokátovi patrila v každej ďalšej spojenej veci (spolu ${fmtEur(b.prirastokSpojenie)}).`
      );
    }
    sections.push({ h: 'Úprava tarifnej odmeny (§ 13)', p: u13 });
  }

  // §14 ods. 7 — dohoda o vine a treste.
  if (b.dohodaVT > 0) {
    sections.push({ h: 'Dohoda o vine a treste', p: [
      'Súd schválil dohodu o vine a treste pred podaním obžaloby. Podľa § 14 ods. 7 Vyhlášky patrí ' +
      'obhajcovi okrem odmeny za jednotlivé úkony právnej služby aj odmena vo výške štvornásobku ' +
      `základnej sadzby tarifnej odmeny za jeden úkon právnej služby, t. j. ${fmtEur(b.dohodaVT)}.`
    ]});
  }

  // Režijný paušál — pri režime opatrovníka (§12 ods.7) sa neúčtuje (b.pausal = 0).
  if (b.pausal > 0) {
    const pausalP = [
      'Podľa § 16 ods. 3 Vyhlášky možno od klienta požadovať za každý úkon právnej služby ' +
      'na náhradu výdavkov na miestne telekomunikačné výdavky a miestne prepravné paušálnu ' +
      'sumu vo výške jednej stotiny výpočtového základu, a to aj vtedy, ak sa na jej náhrade ' +
      'osobitne nedohodli.'
    ];
    if (state.konanieType === 'criminal') {
      pausalP.push(
        'Režijný paušál sa aj v trestnom konaní určuje z výpočtového základu podľa § 1 ods. 3 ' +
        'Vyhlášky (nie z výpočtového základu pre trestné konanie podľa § 1 ods. 4), keďže § 1 ' +
        'ods. 4 sa vzťahuje výlučne na tarifnú odmenu.'
      );
    }
    sections.push({ h: 'Režijný paušál', p: pausalP });
  }

  // Náhrada za stratu času
  if (b.strata > 0) {
    const strataP = [
      'Niektoré úkony právnej služby boli vykonané v mieste, ktoré nie je sídlom advokáta. ' +
      'Za čas strávený cestou do tohto miesta a späť patrí advokátovi podľa § 17 ods. 1 ' +
      'Vyhlášky náhrada za stratu času vo výške jednej šesťdesiatiny výpočtového základu ' +
      'za každú aj začatú polhodinu.'
    ];
    if (state.konanieType === 'criminal') {
      strataP.push(
        'Aj náhrada za stratu času sa určuje z výpočtového základu podľa § 1 ods. 3 Vyhlášky.'
      );
    }
    sections.push({ h: 'Náhrada za stratu času', p: strataP });
  }

  // Náhrada za cestovné výdavky
  if (b.cestovne > 0) {
    const opatr = usedOpatrenia(result);
    const cestP = [
      'Na výšku náhrady preukázaných cestovných výdavkov sa podľa § 16 ods. 4 Vyhlášky ' +
      'vzťahujú osobitné predpisy, konkrétne zákon č. 283/2002 Z. z. o cestovných náhradách ' +
      'v znení neskorších predpisov. Pri použití cestného motorového vozidla patrí advokátovi ' +
      'základná náhrada za každý jeden kilometer jazdy.'
    ];
    if (opatr.length === 1) {
      cestP.push(
        'Sumu základnej náhrady ustanovuje opatrenie Ministerstva práce, sociálnych vecí ' +
        `a rodiny Slovenskej republiky; na úkony v tomto vyčíslení sa vzťahuje ${opatrVeta(opatr[0])}.`
      );
    } else if (opatr.length > 1) {
      cestP.push(
        'Sumu základnej náhrady ustanovuje opatrenie Ministerstva práce, sociálnych vecí ' +
        'a rodiny Slovenskej republiky. Keďže úkony boli vykonané v rôznom čase, použili sa ' +
        `opatrenia podľa ich účinnosti: ${opatr.map(opatrVeta).join('; ')}.`
      );
    }
    sections.push({ h: 'Náhrada za cestovné výdavky', p: cestP });
  }

  // Náhrada za pohonné látky
  if (b.phm > 0) {
    sections.push({ h: 'Náhrada za pohonné látky', p: [
      'Popri základnej náhrade za kilometer jazdy patrí advokátovi aj náhrada za spotrebované ' +
      'pohonné látky (§ 16 ods. 4 Vyhlášky v spojení so zákonom č. 283/2002 Z. z.). Náhrada ' +
      'sa vypočítala zo spotreby vozidla podľa technického preukazu a z priemernej ceny ' +
      'pohonných látok podľa Štatistického úradu Slovenskej republiky za týždeň, v ktorom ' +
      'bol úkon vykonaný, prípadne z ceny preukázanej dokladom o tankovaní.'
    ]});
  }

  // Iné hotové výdavky
  if (b.hotove > 0) {
    sections.push({ h: 'Iné hotové výdavky', p: [
      'Advokát má podľa § 15 písm. a) Vyhlášky popri nároku na odmenu aj nárok na náhradu ' +
      'hotových výdavkov účelne a preukázateľne vynaložených v súvislosti s poskytovaním ' +
      'právnych služieb, najmä na súdne a iné poplatky a na výdavky za znalecké posudky, ' +
      'preklady a odpisy.'
    ]});
  }

  // DPH
  if (b.platcaDph) {
    sections.push({ h: 'Daň z pridanej hodnoty', p: [
      'Advokát je platiteľom dane z pridanej hodnoty. Podľa § 18 ods. 3 Vyhlášky sa odmena ' +
      'a náhrady advokáta, ktorý je platiteľom dane z pridanej hodnoty, zvyšujú o túto daň. ' +
      `Sadzba dane z pridanej hodnoty je ${(TARIFF.parameters.vat_rate * 100).toFixed(0)} %.`
    ]});
  }

  return sections;
}

// ---------- Export (tabuľka do schránky + PDF) ----------

// Zostaví štruktúrované dáta exportu z výsledku a aktuálneho stavu.
function buildExportData(result) {
  const tarifnaLabel = tarifnaLabelText();

  const ukony = result.polozky.map((p, i) => {
    const u = state.ukony[i] || {};
    const items = [];
    // Pri opatrovníkovi (§12 ods.7) je per-úkon tarifná aj paušál 0 — vynechajú sa.
    if (p.sadzba_ukonu > 0) items.push({ label: tarifnaLabel, suma: p.sadzba_ukonu });
    if (p.pausal > 0) items.push({ label: 'Režijný paušál (§ 16 ods. 3)', suma: p.pausal });
    if (p.strata > 0) items.push({ label: 'Náhrada za stratu času (§ 17 ods. 1)', suma: p.strata });
    if (p.cestovne > 0) items.push({ label: 'Náhrada za použitie vozidla (§ 16 ods. 4)', suma: p.cestovne });
    if (p.phm > 0) items.push({ label: 'Náhrada za pohonné hmoty (§ 16 ods. 4)', suma: p.phm });
    return {
      idx: i + 1,
      nazov: p.ukon,
      datum: fmtDate(p.datum),
      mimo: u.miesto === 'mimo-sidla',
      items
    };
  });

  const vydavky = state.vydavky
    .filter(v => (v.suma || 0) > 0)
    .map(v => ({ datum: fmtDate(v.datum), popis: v.popis || '—', suma: v.suma }));

  const b = result.breakdown;
  const summary = [];
  // §12 ods.7 opatrovník a §14 ods.7 dohoda o vine a treste — samostatné riadky pred medzisúčtom.
  if (b.opatrovnik > 0) summary.push({ label: 'Odmena opatrovníka (§ 12 ods. 7)', suma: b.opatrovnik });
  if (b.dohodaVT > 0) summary.push({ label: 'Dohoda o vine a treste (§ 14 ods. 7 — 4×)', suma: b.dohodaVT });
  summary.push({ label: 'Položky spolu bez DPH', suma: b.polozkySpolu, kind: 'subtotal' });
  if (b.platcaDph) {
    summary.push({
      label: `DPH ${(TARIFF.parameters.vat_rate * 100).toFixed(0)} % (§ 18 ods. 3)`,
      suma: b.dph, kind: ''
    });
  }
  summary.push({ label: 'Spolu trovy', suma: result.total, kind: 'total' });

  return {
    caseLabel: state.caseLabel.trim(),
    konanieLabel: TARIFF.konania[state.konanieType].label,
    hodnotaSporu: state.konanieType === 'civil-value' ? state.hodnotaSporu : null,
    ukony, vydavky, summary
  };
}

// HTML tabuľka s inline štýlmi — pri vložení do Wordu/Excelu sa stane skutočnou tabuľkou.
function exportTableHTML(data) {
  const cell = 'border:1px solid #b8ad93;padding:5px 9px;';
  const num = cell + 'text-align:right;white-space:nowrap;';
  const head = cell + 'background:#efe6d2;text-align:left;font-weight:bold;';
  let h = '<table style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#1d2733;">';
  h += `<tr><th style="${head}">Dátum</th><th style="${head}">Položka</th>`
     + `<th style="${head}text-align:right;">Suma</th></tr>`;
  for (const u of data.ukony) {
    h += `<tr><td style="${cell}">${esc(u.datum)}</td>`
       + `<td style="${cell}font-weight:bold;">Úkon ${u.idx}: ${esc(u.nazov)}`
       + `${u.mimo ? ' — mimo sídla advokáta' : ''}</td><td style="${cell}"></td></tr>`;
    for (const it of u.items) {
      h += `<tr><td style="${cell}"></td><td style="${cell}">${esc(it.label)}</td>`
         + `<td style="${num}">${esc(fmtEur(it.suma))}</td></tr>`;
    }
  }
  if (data.vydavky.length) {
    h += `<tr><td style="${cell}"></td><td style="${cell}font-weight:bold;">Iné hotové výdavky</td>`
       + `<td style="${cell}"></td></tr>`;
    for (const v of data.vydavky) {
      h += `<tr><td style="${cell}">${esc(v.datum)}</td><td style="${cell}">${esc(v.popis)}</td>`
         + `<td style="${num}">${esc(fmtEur(v.suma))}</td></tr>`;
    }
  }
  for (const s of data.summary) {
    const w = s.kind ? 'font-weight:bold;' : '';
    h += `<tr><td style="${cell}"></td><td style="${cell}${w}">${esc(s.label)}</td>`
       + `<td style="${num}${w}">${esc(fmtEur(s.suma))}</td></tr>`;
  }
  h += '</table>';
  return h;
}

// HTML fragment pre schránku (nadpis + tabuľka + voliteľné odôvodnenie).
function exportFragmentHTML(result, includeOdov) {
  const data = buildExportData(result);
  const f = 'font-family:Calibri,Arial,sans-serif;color:#1d2733;';
  let h = `<p style="${f}font-size:13pt;font-weight:bold;margin:0 0 4pt;">Trovy právneho zastúpenia</p>`;
  if (data.caseLabel) {
    h += `<p style="${f}font-size:11pt;margin:0 0 2pt;">Vec: ${esc(data.caseLabel)}</p>`;
  }
  let typLine = 'Typ konania: ' + data.konanieLabel;
  if (data.hodnotaSporu != null) typLine += ' · hodnota sporu ' + fmtEur(data.hodnotaSporu);
  h += `<p style="${f}font-size:11pt;margin:0 0 8pt;">${esc(typLine)}</p>`;
  h += exportTableHTML(data);
  if (includeOdov) {
    h += `<p style="${f}font-size:12pt;font-weight:bold;margin:14pt 0 4pt;">Odôvodnenie</p>`;
    for (const s of buildOdovodnenie(result)) {
      if (s.h) h += `<p style="${f}font-size:11pt;font-weight:bold;margin:8pt 0 2pt;">${esc(s.h)}</p>`;
      for (const p of s.p) {
        h += `<p style="${f}font-size:11pt;margin:0 0 4pt;text-align:justify;">${esc(p)}</p>`;
      }
    }
  }
  return h;
}

// Zalomenie textu na šírku — pre čistý textový variant.
function wrapText(s, w) {
  const words = s.split(' ');
  const lines = [];
  let cur = '';
  for (const word of words) {
    if (cur === '') cur = word;
    else if ((cur + ' ' + word).length <= w) cur += ' ' + word;
    else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  return lines.join('\n');
}

// Čistý textový variant (fallback pre schránku, ak HTML nie je podporované).
function exportPlain(result, includeOdov) {
  const data = buildExportData(result);
  const W = 64;
  const lines = ['TROVY PRÁVNEHO ZASTÚPENIA'];
  if (data.caseLabel) lines.push('Vec: ' + data.caseLabel);
  let typLine = 'Typ konania: ' + data.konanieLabel;
  if (data.hodnotaSporu != null) typLine += ' · hodnota sporu ' + fmtEur(data.hodnotaSporu);
  lines.push(typLine);
  lines.push('');

  const row = (label, val, indent = 0) => {
    const l = ' '.repeat(indent) + label;
    const v = fmtEur(val);
    const pad = Math.max(2, W - l.length - v.length);
    return l + ' '.repeat(pad) + v;
  };

  for (const u of data.ukony) {
    lines.push(`Úkon ${u.idx}: ${u.nazov} · ${u.datum}${u.mimo ? ' · mimo sídla advokáta' : ''}`);
    for (const it of u.items) lines.push(row(it.label, it.suma, 3));
    lines.push('');
  }
  if (data.vydavky.length) {
    lines.push('Iné hotové výdavky');
    for (const v of data.vydavky) lines.push(row(`${v.datum} — ${v.popis}`, v.suma, 3));
    lines.push('');
  }
  lines.push('-'.repeat(W));
  for (const s of data.summary) lines.push(row(s.label, s.suma));

  if (includeOdov) {
    lines.push('');
    lines.push('='.repeat(W));
    lines.push('ODÔVODNENIE');
    lines.push('');
    for (const s of buildOdovodnenie(result)) {
      if (s.h) lines.push(s.h);
      for (const p of s.p) lines.push(wrapText(p, W));
      lines.push('');
    }
  }
  return lines.join('\n');
}

// Tabuľka pre tlačový dokument (triedy, nie inline štýly).
function printTableHTML(data) {
  let h = '<table><thead><tr><th>Dátum</th><th>Položka</th><th class="num">Suma</th></tr></thead><tbody>';
  for (const u of data.ukony) {
    h += `<tr class="ukon-head"><td>${esc(u.datum)}</td>`
       + `<td>Úkon ${u.idx}: ${esc(u.nazov)}${u.mimo ? ' — mimo sídla advokáta' : ''}</td>`
       + '<td class="num"></td></tr>';
    for (const it of u.items) {
      h += `<tr><td></td><td>${esc(it.label)}</td><td class="num">${esc(fmtEur(it.suma))}</td></tr>`;
    }
  }
  if (data.vydavky.length) {
    h += '<tr class="ukon-head"><td></td><td>Iné hotové výdavky</td><td class="num"></td></tr>';
    for (const v of data.vydavky) {
      h += `<tr><td>${esc(v.datum)}</td><td>${esc(v.popis)}</td><td class="num">${esc(fmtEur(v.suma))}</td></tr>`;
    }
  }
  for (const s of data.summary) {
    h += `<tr class="${s.kind}"><td></td><td>${esc(s.label)}</td>`
       + `<td class="num">${esc(fmtEur(s.suma))}</td></tr>`;
  }
  h += '</tbody></table>';
  return h;
}

const PRINT_CSS = `
  * { box-sizing: border-box; }
  body { font-family: 'Archivo','Segoe UI',system-ui,sans-serif; color: #1d2733;
         margin: 2cm 1.9cm; font-size: 11pt; line-height: 1.5; }
  h1 { font-family: 'Fraunces',Georgia,serif; font-size: 19pt; font-weight: 600;
       margin: 0 0 6pt; color: #1d2733; }
  h2 { font-family: 'Fraunces',Georgia,serif; font-size: 13.5pt; font-weight: 600;
       color: #7c5326; margin: 20pt 0 6pt; }
  h3 { font-size: 11pt; color: #7c5326; margin: 12pt 0 3pt; }
  .vec { margin: 0 0 3pt; font-weight: 600; }
  .meta { margin: 0 0 4pt; color: #5b6472; }
  table { border-collapse: collapse; width: 100%; margin-top: 12pt; }
  th, td { border: 1px solid #c9bfa6; padding: 5pt 8pt; text-align: left;
           vertical-align: top; }
  th { background: #efe6d2; font-size: 9pt; text-transform: uppercase;
       letter-spacing: 0.05em; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  tr.ukon-head td { background: #faf7ef; font-weight: 600; }
  tr.subtotal td { font-weight: 600; border-top: 1.5px solid #7c5326; }
  tr.total td { font-weight: 700; border-top: 2px solid #7c5326; font-size: 12pt; }
  p { margin: 0 0 6pt; text-align: justify; }
  @media print { body { margin: 1.5cm; } }
`;

// Celý tlačový dokument — otvorí sa v novom okne a spustí tlač (užívateľ uloží ako PDF).
function exportPrintDoc(result, includeOdov) {
  const data = buildExportData(result);
  const title = 'Trovy právneho zastúpenia' + (data.caseLabel ? ' — ' + data.caseLabel : '');
  let body = '<h1>Trovy právneho zastúpenia</h1>';
  if (data.caseLabel) body += `<p class="vec">Vec: ${esc(data.caseLabel)}</p>`;
  let typLine = 'Typ konania: ' + data.konanieLabel;
  if (data.hodnotaSporu != null) typLine += ' · hodnota sporu ' + fmtEur(data.hodnotaSporu);
  body += `<p class="meta">${esc(typLine)}</p>`;
  body += printTableHTML(data);
  if (includeOdov) {
    body += '<h2>Odôvodnenie</h2>';
    for (const s of buildOdovodnenie(result)) {
      if (s.h) body += `<h3>${esc(s.h)}</h3>`;
      for (const p of s.p) body += `<p>${esc(p)}</p>`;
    }
  }
  return '<!DOCTYPE html><html lang="sk"><head><meta charset="UTF-8">'
    + `<title>${esc(title)}</title>`
    + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
    + 'family=Archivo:wght@400;600&family=Fraunces:opsz,wght@9..144,500;9..144,600&display=swap">'
    + `<style>${PRINT_CSS}</style></head><body>${body}`
    + '<script>window.addEventListener("load",function(){setTimeout(function(){'
    + 'window.focus();window.print();},350);});<\/script></body></html>';
}

function setCopyStatus(text, ok) {
  const slot = document.getElementById('copy-status');
  if (!slot) return;
  slot.textContent = text;
  slot.className = 'copy-status ' + (ok ? 'ok' : 'err');
}

// Skopíruje HTML obsah cez staršie execCommand (fallback) — Word z neho spraví tabuľku.
function legacyCopyHtml(html) {
  const div = document.createElement('div');
  div.contentEditable = 'true';
  div.innerHTML = html;
  div.style.position = 'fixed';
  div.style.left = '-9999px';
  div.style.top = '0';
  document.body.appendChild(div);
  const range = document.createRange();
  range.selectNodeContents(div);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  sel.removeAllRanges();
  document.body.removeChild(div);
  return ok;
}

async function copyExport(result) {
  const html = exportFragmentHTML(result, state.exportOdovodnenie);
  const plain = exportPlain(result, state.exportOdovodnenie);
  let ok = false;
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' })
        })
      ]);
      ok = true;
    } else {
      ok = legacyCopyHtml(html);
    }
  } catch (err) {
    ok = legacyCopyHtml(html);
  }
  setCopyStatus(
    ok ? '✓ Tabuľka skopírovaná — vložte ju do Wordu alebo Excelu'
       : '✗ Kopírovanie zlyhalo',
    ok
  );
}

function printExport(result) {
  const html = exportPrintDoc(result, state.exportOdovodnenie);
  const w = window.open('', '_blank');
  if (!w) {
    setCopyStatus('✗ Povoľte vyskakovacie okná — PDF sa otvára v novom okne', false);
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  setCopyStatus('✓ Otvorené okno tlače — v dialógu zvoľte „Uložiť ako PDF"', true);
}

// ---------- PWA: service worker + update toast ----------

// Registruje service worker a pri detekcii novej verzie zobrazí nenásilný toast
// „Nová verzia dostupná → Obnoviť". Bez auto-update — používateľ môže byť v strede výpočtu.
function initPWA() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        // Nová verzia nainštalovaná a už beží starý controller → ponúkni obnovenie.
        if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateToast(nw);
      });
    });
  }).catch(() => { /* SW nepodporovaný / file:// — kalkulačka funguje aj bez neho */ });

  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    location.reload();
  });
}

function showUpdateToast(worker) {
  if (document.getElementById('update-toast')) return;
  const toast = el('div', { id: 'update-toast', class: 'update-toast' }, [
    el('span', { class: 'update-toast-text' }, 'Nová verzia kalkulačky je dostupná.'),
    el('button', {
      type: 'button', class: 'btn-primary',
      onclick: () => { toast.remove(); worker.postMessage('skipWaiting'); }
    }, 'Obnoviť'),
    el('button', {
      type: 'button', class: 'toast-dismiss', title: 'Zavrieť', 'aria-label': 'Zavrieť',
      onclick: () => toast.remove()
    }, '✕')
  ]);
  document.body.appendChild(toast);
}

// ---------- Init ----------

document.addEventListener('DOMContentLoaded', () => {
  render();
  initPWA();
});
