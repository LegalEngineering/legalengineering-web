/*
 * HYPOTEKÁRNA KALKULAČKA — Legal Engineering, s. r. o.
 * Vanilla JS prepis z React verzie (hypoteka_kalkulacka.jsx).
 *
 * VÝPOČTOVÁ LOGIKA JE BYTE-IDENTICKÁ s React verziou — žiadne zmeny konštánt,
 * NBS pravidiel ani daňových pásiem. Životné minimum je nastavené na hodnoty
 * platné od 1.7.2026 do 30.6.2027 (295,22 / 205,96 / 134,80 €).
 *
 * Zdroje:
 *  - Životné minimum od 1.7.2026 do 30.6.2027: 295,22 / 205,96 / 134,80 €
 *    (nové ŽM platí od 1.7.2027, zverejnenie v máji 2027)
 *  - NBS opatrenie o hypotékach: DTI max 8× čistý ročný príjem (−0,25/rok nad 40 pri úvere do dôchodku),
 *    DSTI max 60 % disponibilného príjmu (70 % výnimka pre 5 % objemu),
 *    stres test +2 pp (resp. +1 pp pre fixáciu nad 10 rokov), úrok capped na 6 %,
 *    splatnosť pre výpočet DSTI ≥ 30 rokov.
 *  - Mzdové odvody 2026: sociálne 9,4 %, zdravotné 5 %,
 *    max VZ sociálneho poistenia 16 764 €/mes
 *  - Daň z príjmu 2026 (mesačný základ dane):
 *    19 % do 3 665,28 €; 25 % do 5 029,10 €; 30 % do 6 250,86 €; 35 % nad
 *  - NČZD 2026: 497,23 €/mes; kráti sa pri ročnom ZD > 26 367,26 €;
 *    NČZD = 12 558,55 − ZD_ročný/4, zrušená pri ZD_ročný ≥ 50 234,18 €
 *  - Daňový bonus: 100 €/mes pre dieťa < 15 r., 50 €/mes pre 15–18 r.
 */
'use strict';

// ————— KONŠTANTY ————————————————————————————————————————————————————
// Životné minimum platné od 1.7.2026 do 30.6.2027 (nové ŽM platí od 1.7.2027, zverejnenie v máji 2027).
const ZM = { dosp1: 295.22, dosp2: 205.96, dieta: 134.80 };

const SOC = 0.094, ZDR = 0.05;
const SOC_MAX_VZ_MES = 16764;
const NCZD_MES = 497.23;
const NCZD_HRANICA_ROK = 26367.26;
const NCZD_NULA_ROK = 50234.18;
const NCZD_KONSTANTA = 12558.55;
const PASMA = [
  { hr: 3665.28, s: 0.19 },
  { hr: 5029.10, s: 0.25 },
  { hr: 6250.86, s: 0.30 },
  { hr: Infinity, s: 0.35 },
];
const BONUS_LIMIT_ZD_MES = 2640;

// ————— VÝPOČTY ————————————————————————————————————————————————————
function hrubaNaCistu(hruba, { uplNCZD = true, detiDo15 = 0, deti15_18 = 0 } = {}) {
  if (hruba <= 0) return { cista: 0, soc: 0, zdr: 0, dan: 0, bonus: 0, zd: 0, ncdz: 0, zd_zdan: 0, cenaPrace: 0 };
  const soc = Math.min(hruba, SOC_MAX_VZ_MES) * SOC;
  const zdr = hruba * ZDR;
  const zd = hruba - soc - zdr;

  const zdRok = zd * 12;
  let ncdz = 0;
  if (uplNCZD) {
    if (zdRok <= NCZD_HRANICA_ROK) ncdz = NCZD_MES;
    else if (zdRok < NCZD_NULA_ROK) ncdz = Math.max(0, (NCZD_KONSTANTA - zdRok / 4) / 12);
  }
  const zd_zdan = Math.max(0, zd - ncdz);

  let dan = 0, zvysok = zd_zdan, prev = 0;
  for (const p of PASMA) {
    if (zvysok <= 0) break;
    const sirka = Math.max(0, Math.min(zvysok, p.hr - prev));
    dan += sirka * p.s;
    zvysok -= sirka;
    prev = p.hr;
  }

  // Daňový bonus (približný; kráti sa pri ZD_mes > 2640 o 1/10 rozdielu)
  let bonus = detiDo15 * 100 + deti15_18 * 50;
  if (zd > BONUS_LIMIT_ZD_MES && bonus > 0) {
    const redukcia = (zd - BONUS_LIMIT_ZD_MES) / 10;
    bonus = Math.max(0, bonus - redukcia);
  }

  // Cena práce (odvody zamestnávateľa ~ 35,2 %: soc 25,2 + zdr 10 (ZP 2026))
  const cenaPrace = hruba + Math.min(hruba, SOC_MAX_VZ_MES) * 0.252 + hruba * 0.10;

  const cista = hruba - soc - zdr - dan + bonus;
  return { cista, soc, zdr, dan, bonus, zd, ncdz, zd_zdan, cenaPrace };
}

function cistaNaHrubu(cielCista, opts = {}) {
  if (cielCista <= 0) return 0;
  let lo = 0, hi = Math.max(20000, cielCista * 2);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const { cista } = hrubaNaCistu(mid, opts);
    if (cista < cielCista) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Anuitná splátka
function pmt(istina, urokPA, roky) {
  const i = urokPA / 12, n = roky * 12;
  if (i === 0) return istina / n;
  return istina * (i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1);
}
// Max istina pri danej splátke
function istinaZoSplatky(splatka, urokPA, roky) {
  const i = urokPA / 12, n = roky * 12;
  if (i === 0) return splatka * n;
  return splatka * (Math.pow(1 + i, n) - 1) / (i * Math.pow(1 + i, n));
}

// Stresový úrok podľa NBS
function stresUrok(urokPA, fixRoky) {
  const buffer = fixRoky > 10 ? 0.01 : 0.02;
  return Math.min(urokPA + buffer, 0.06);
}

// DTI koeficient s vekovou úpravou (NBS od 1.1.2023)
function dtiKoef(vek, splatnostRoky) {
  const koniecVek = vek + splatnostRoky;
  if (vek <= 40 || koniecVek <= 65) return 8;
  // Nad 40 a úver presahuje 65 r.: −0,25 za každý rok nad 40
  return Math.max(3, 8 - 0.25 * (vek - 40));
}

// ————— UI HELPERY ————————————————————————————————————————————————————
const eur = (n, dec = 0) => {
  if (!isFinite(n) || isNaN(n)) return '—';
  return new Intl.NumberFormat('sk-SK', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(Math.round(n * (dec ? Math.pow(10, dec) : 1)) / (dec ? Math.pow(10, dec) : 1)) + ' €';
};
const pct = (n, dec = 2) => `${n.toFixed(dec).replace('.', ',')} %`;

const DEFAULT_STATE = {
  ziadatelov: 1, deti: 0, detiDo15: 0, deti15_18: 0,
  vek1: 35, vek2: 35,
  vstupnyMod: 'hruba',
  hruba1: 2000, hruba2: 0, cista1: 0, cista2: 0,
  urok: 3.7, splatnost: 30, fixacia: 3, ltv: 80,
  existSplatky: 0,
};

// ————— APP STATE ————————————————————————————————————————————————————
let mode = 'prijem';        // 'prijem' | 'ciel'
let state = { ...DEFAULT_STATE };
let targetType = 'cena';    // 'cena' | 'uver'
let targetSuma = 250000;

function up(k, v) { state = { ...state, [k]: v }; render(); }
function setState(s) { state = { ...s }; render(); }

// ————— DOM HELPER ————————————————————————————————————————————————————
/**
 * Mini hyperscript helper.
 *   el(tag, classOrProps, ...children)
 * - 2. argument môže byť string (className) alebo objekt props.
 * - props: { class, onclick, style, html, ...atribúty }
 * - deti: string | Node | pole (vnorené polia povolené, falsy ignorované)
 */
function el(tag, classOrProps, ...children) {
  const node = document.createElement(tag);
  let props = null;
  if (typeof classOrProps === 'string') {
    node.className = classOrProps;
  } else if (classOrProps && typeof classOrProps === 'object' && !(classOrProps instanceof Node) && !Array.isArray(classOrProps)) {
    props = classOrProps;
  } else if (classOrProps !== null && classOrProps !== undefined) {
    // classOrProps je v skutočnosti dieťa (Node, pole alebo iné)
    children.unshift(classOrProps);
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') {
        node.className = v;
      } else if (k === 'style' && typeof v === 'object') {
        Object.assign(node.style, v);
      } else if (k.startsWith('on') && typeof v === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === 'html') {
        node.innerHTML = v;
      } else if (v === true) {
        node.setAttribute(k, '');
      } else {
        node.setAttribute(k, v);
      }
    }
  }
  const append = (c) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(append); return; }
    node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(append);
  return node;
}

// ————— IKONY (inline SVG, náhrada za lucide-react) ————————————————————
function icon(name, cls) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('xmlns', ns);
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (cls) svg.setAttribute('class', cls);
  const paths = {
    AlertTriangle: [
      ['path', { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z' }],
      ['path', { d: 'M12 9v4' }],
      ['path', { d: 'M12 17h.01' }],
    ],
    Info: [
      ['circle', { cx: '12', cy: '12', r: '10' }],
      ['path', { d: 'M12 16v-4' }],
      ['path', { d: 'M12 8h.01' }],
    ],
    Users: [
      ['path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }],
      ['circle', { cx: '9', cy: '7', r: '4' }],
      ['path', { d: 'M22 21v-2a4 4 0 0 0-3-3.87' }],
      ['path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' }],
    ],
    Home: [
      ['path', { d: 'm3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }],
      ['polyline', { points: '9 22 9 12 15 12 15 22' }],
    ],
    Wallet: [
      ['path', { d: 'M21 12V7H5a2 2 0 0 1 0-4h14v4' }],
      ['path', { d: 'M3 5v14a2 2 0 0 0 2 2h16v-5' }],
      ['path', { d: 'M18 12a2 2 0 0 0 0 4h4v-4Z' }],
    ],
    Target: [
      ['circle', { cx: '12', cy: '12', r: '10' }],
      ['circle', { cx: '12', cy: '12', r: '6' }],
      ['circle', { cx: '12', cy: '12', r: '2' }],
    ],
    RotateCcw: [
      ['path', { d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }],
      ['path', { d: 'M3 3v5h5' }],
    ],
  };
  for (const [t, attrs] of paths[name]) {
    const n = document.createElementNS(ns, t);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    svg.appendChild(n);
  }
  return svg;
}

// ————— UI KOMPONENTY ————————————————————————————————————————————————————
function Field(label, child, hint) {
  return el('label', 'block mb-3',
    el('div', 'flex items-center justify-between mb-1.5',
      el('span', 'text-xs uppercase tracking-wider text-[#a39b87] font-medium', label),
      hint ? el('span', 'text-[10px] text-[#70684f] font-mono', hint) : null,
    ),
    child,
  );
}

function NumInput({ value, onChange, step = 1, min = 0, max, suffix = '€', dataKey }) {
  const input = el('input', {
    class: 'w-full bg-[#1a1a1e] border border-[#3a362c] text-[#f0ead6] px-3 py-2 pr-10 rounded-sm font-mono text-sm focus:outline-none focus:border-[#d4873c] transition-colors',
    type: 'number',
    value: value === 0 ? '' : value,
    placeholder: '0',
    step,
    min,
    max,
    // Stabilný identifikátor poľa pre obnovu focusu po re-renderi (viď render()).
    'data-fk': dataKey || null,
  });
  input.addEventListener('input', e => onChange(parseFloat(e.target.value) || 0));
  return el('div', 'relative flex items-center',
    input,
    el('span', 'absolute right-3 text-[#70684f] text-xs font-mono pointer-events-none', suffix),
  );
}

function Slider({ value, onChange, min, max, step = 1, suffix = '' }) {
  const input = el('input', {
    class: 'flex-1 accent-[#d4873c]',
    type: 'range', value, min, max, step,
  });
  input.addEventListener('input', e => onChange(parseFloat(e.target.value)));
  return el('div', 'flex items-center gap-3',
    input,
    el('span', 'text-xs font-mono text-[#f0ead6] min-w-[3.5rem] text-right', `${value}${suffix}`),
  );
}

function Card({ title, children, right, accent = false }) {
  const cls = accent
    ? 'border border-[#d4873c]/40 bg-gradient-amber p-5 rounded-sm'
    : 'border border-[#2a2620] bg-[#14120e] p-5 rounded-sm';
  const kids = [];
  if (title || right) {
    kids.push(el('div', 'flex items-baseline justify-between mb-3 pb-2 border-b border-[#2a2620]',
      title ? el('h3', 'text-xs uppercase tracking-[0.15em] text-[#a39b87] font-medium', title) : null,
      right || null,
    ));
  }
  (Array.isArray(children) ? children : [children]).forEach(c => kids.push(c));
  return el('div', cls, ...kids);
}

function Metric({ label, value, sub, tone = 'normal', large = false }) {
  const tones = {
    normal: 'text-[#f0ead6]',
    good: 'text-[#8abf6f]',
    warn: 'text-[#e8a84c]',
    bad: 'text-[#d45a3c]',
    mute: 'text-[#a39b87]',
  };
  return el('div', null,
    el('div', 'text-[10px] uppercase tracking-wider text-[#70684f] mb-1 font-medium', label),
    el('div', `${large ? 'text-3xl' : 'text-xl'} font-mono font-light ${tones[tone]}`, value),
    sub ? el('div', 'text-xs text-[#70684f] font-mono mt-0.5', sub) : null,
  );
}

// Riadok "between"
function rowBetween(leftEl, rightEl) {
  return el('div', 'flex justify-between text-xs', leftEl, rightEl);
}

// ————— RENDER ————————————————————————————————————————————————————
function render() {
  const zm = ZM;

  // ——— Mzdy ———
  const vyp = (hruba, cista, detiDo15, deti15_18) => {
    if (state.vstupnyMod === 'hruba') {
      return Object.assign({}, hrubaNaCistu(hruba, { detiDo15, deti15_18 }), { hruba });
    }
    const hh = cistaNaHrubu(cista, { detiDo15, deti15_18 });
    return Object.assign({}, hrubaNaCistu(hh, { detiDo15, deti15_18 }), { hruba: hh });
  };
  const deti1Do15 = state.detiDo15;
  const deti1_15_18 = state.deti15_18;
  const m1 = vyp(state.hruba1, state.cista1, deti1Do15, deti1_15_18);
  const m2 = state.ziadatelov === 2 ? vyp(state.hruba2, state.cista2, 0, 0) : null;
  const mzdaVypocty = { m1, m2 };

  const cistyDomacnost = (mzdaVypocty.m1.cista || 0) + (mzdaVypocty.m2 ? mzdaVypocty.m2.cista : 0);

  // ——— Životné minimum domácnosti ———
  const detiCount = Math.max(state.deti, state.detiDo15 + state.deti15_18);
  const zivMin = state.ziadatelov === 1
    ? zm.dosp1 + detiCount * zm.dieta
    : zm.dosp1 + zm.dosp2 + detiCount * zm.dieta;

  // ——— Disponibilný príjem ———
  const dispPrijem = Math.max(0, cistyDomacnost - zivMin - state.existSplatky);

  // ——— DSTI limity ———
  const maxSplatka60 = dispPrijem * 0.6;
  const maxSplatka70 = dispPrijem * 0.7;

  // ——— Stres ———
  const urokDec = state.urok / 100;
  const stresDec = stresUrok(urokDec, state.fixacia);

  // ——— DSTI → max úver ———
  const maxUverDSTI60 = istinaZoSplatky(maxSplatka60, stresDec, Math.max(state.splatnost, 30));
  const maxUverDSTI70 = istinaZoSplatky(maxSplatka70, stresDec, Math.max(state.splatnost, 30));

  // ——— DTI ———
  const rocnyPrijem = cistyDomacnost * 12;
  const dti1 = dtiKoef(state.vek1, state.splatnost);
  const dti2 = state.ziadatelov === 2 ? dtiKoef(state.vek2, state.splatnost) : 0;
  const c1 = mzdaVypocty.m1.cista, c2 = mzdaVypocty.m2 ? mzdaVypocty.m2.cista : 0;
  const dtiLimit = state.ziadatelov === 2 && (c1 + c2) > 0
    ? (c1 * 12 * dti1 + c2 * 12 * dti2)
    : rocnyPrijem * dti1;

  // ——— Finálny max úver = min(DTI, DSTI) ———
  const maxUver = Math.min(dtiLimit, maxUverDSTI60);
  const bottleneck = dtiLimit < maxUverDSTI60 ? 'DTI' : 'DSTI';

  // ——— Splátky pri max úvere ———
  const splatkaReal = pmt(maxUver, urokDec, state.splatnost);
  const splatkaStres = pmt(maxUver, stresDec, state.splatnost);

  // ——— Cena nehnuteľnosti ———
  const cenaNehn = maxUver / (state.ltv / 100);
  const vlastnyKapital = cenaNehn - maxUver;

  // ——— REVERSE MODE ———
  let reverse = null;
  if (mode === 'ciel') {
    const cielUver = targetType === 'cena' ? targetSuma * (state.ltv / 100) : targetSuma;
    const cielCena = targetType === 'cena' ? targetSuma : targetSuma / (state.ltv / 100);
    const potrSplatka = pmt(cielUver, stresDec, Math.max(state.splatnost, 30));
    const potrDispPrijem = potrSplatka / 0.6;
    const potrCistyDSTI = potrDispPrijem + zivMin + state.existSplatky;
    const dtiPriem = state.ziadatelov === 2 ? (dti1 + dti2) / 2 : dti1;
    const potrCistyDTI = cielUver / dtiPriem / 12;
    const potrCisty = Math.max(potrCistyDSTI, potrCistyDTI);
    const potrHruba = cistaNaHrubu(potrCisty);
    const potrCistyPerOsoba = potrCisty / state.ziadatelov;
    const potrHrubaPerOsoba = cistaNaHrubu(potrCistyPerOsoba);
    reverse = {
      cielUver, cielCena, potrSplatka, potrCisty, potrHruba, potrCistyPerOsoba, potrHrubaPerOsoba,
      bindingBy: potrCistyDSTI > potrCistyDTI ? 'DSTI' : 'DTI',
    };
  }

  // ===================== STAVBA DOM =====================
  const root = document.getElementById('root');

  // ——— Zachytenie focusu PRED zmazaním DOM ———
  // Live prepočet (input event) volá render() po každej cifre, čo zmaže a znovu
  // postaví celý DOM. Bez tohto by editovaný <input> zanikol → strata focusu a
  // caretu → používateľa „vyhodí z poľa". Zachytíme aktívne number pole a po
  // prestavbe naň vrátime focus + caret. Mapovanie podľa data-fk (stabilný kľúč
  // poľa), s fallbackom na index medzi number inputmi.
  let focusRestore = null;
  const active = document.activeElement;
  if (active && active.tagName === 'INPUT' && active.type === 'number' && root.contains(active)) {
    const numbers = [...root.querySelectorAll('input[type=number]')];
    let caret = null;
    try { caret = active.selectionStart; } catch (e) { /* number input nemusí podporovať selectionStart */ }
    focusRestore = {
      fk: active.getAttribute('data-fk'),
      index: numbers.indexOf(active),
      caret,
    };
  }

  root.textContent = '';

  // ——— HEADER ———
  const header = el('header', 'flex items-start justify-between mb-10 pb-6 border-b border-[#2a2620]',
    el('div', null,
      el('div', 'flex items-baseline gap-3 mb-2',
        el('span', 'text-[10px] uppercase tracking-[0.3em] text-[#d4873c]', 'Legal Engineering'),
        el('span', 'text-[10px] text-[#70684f] mono', 'parametre platné 1. 7. 2026 – 30. 6. 2027'),
      ),
      el('h1', 'serif text-5xl italic font-light tracking-tight text-[#f0ead6]', 'Hypotekárna kalkulačka'),
      el('p', 'text-sm text-[#a39b87] mt-3 max-w-xl',
        'NBS DTI/DSTI · stres test · prepočet hrubá ↔ čistá · životné minimum',
      ),
    ),
    el('div', 'flex flex-col items-end gap-2',
      el('div', 'text-[10px] uppercase tracking-wider text-[#a39b87] text-right', 'Životné minimum'),
      el('div', 'text-[10px] text-[#f0ead6] mono text-right',
        `${zm.dosp1} / ${zm.dosp2} / ${zm.dieta} €`,
      ),
      el('div', 'text-[10px] text-[#70684f] mono text-right max-w-[14rem]',
        'platné 1. 7. 2026 – 30. 6. 2027 · nové ŽM platí od 1. 7. 2027 (zverejnenie v máji 2027)',
      ),
    ),
  );

  // ——— MODE SWITCHER ———
  const modeBtn = (m, label, ic) => {
    const base = 'px-4 py-2 text-xs uppercase tracking-wider rounded-sm transition-colors flex items-center gap-2';
    const cls = mode === m ? `${base} bg-[#d4873c] text-[#0d1017]` : `${base} text-[#a39b87]`;
    return el('button', { class: cls, onclick: () => { mode = m; render(); } },
      icon(ic, 'w-3 h-3'), label);
  };
  const modeSwitcher = el('div', 'flex items-center justify-end mb-6',
    el('div', 'flex gap-1 p-1 bg-[#14120e] border border-[#2a2620] rounded-sm',
      modeBtn('prijem', 'Mám príjem', 'Wallet'),
      modeBtn('ciel', 'Mám cieľ', 'Target'),
    ),
  );

  // ——— ĽAVÝ PANEL: VSTUPY ———
  const ziadateliaCard = Card({
    title: 'Žiadatelia a rodina',
    right: icon('Users', 'w-3 h-3 text-[#70684f]'),
    children: [
      Field('Počet žiadateľov',
        el('div', 'flex gap-2', [1, 2].map(n => {
          const base = 'flex-1 py-2 border rounded-sm text-sm mono transition-colors';
          const cls = state.ziadatelov === n
            ? `${base} border-[#d4873c] bg-[#d4873c]/10 text-[#f0ead6]`
            : `${base} border-[#3a362c] text-[#a39b87]`;
          return el('button', { class: cls, onclick: () => up('ziadatelov', n) }, String(n));
        })),
      ),
      Field('Nezaopatrené deti (pre ŽM)',
        Slider({ value: state.deti, onChange: v => up('deti', v), min: 0, max: 5 }),
        `${state.deti} × ${zm.dieta} €`,
      ),
      el('div', 'grid grid-cols-2 gap-3',
        Field('Deti < 15 r. (bonus)',
          Slider({ value: state.detiDo15, onChange: v => up('detiDo15', v), min: 0, max: 5, suffix: '' })),
        Field('Deti 15–18 r. (bonus)',
          Slider({ value: state.deti15_18, onChange: v => up('deti15_18', v), min: 0, max: 5, suffix: '' })),
      ),
      el('div', `grid gap-3 ${state.ziadatelov === 2 ? 'grid-cols-2' : 'grid-cols-1'}`,
        Field('Vek žiadateľ 1',
          NumInput({ value: state.vek1, onChange: v => up('vek1', v), min: 18, max: 70, suffix: 'r.', dataKey: 'vek1' })),
        state.ziadatelov === 2
          ? Field('Vek žiadateľ 2',
              NumInput({ value: state.vek2, onChange: v => up('vek2', v), min: 18, max: 70, suffix: 'r.', dataKey: 'vek2' }))
          : null,
      ),
    ],
  });

  const prijemModeToggle = el('div', 'flex gap-1', ['hruba', 'cista'].map(m => {
    const base = 'px-2 py-0.5 text-[10px] uppercase tracking-wider rounded-sm';
    const cls = state.vstupnyMod === m
      ? `${base} bg-[#d4873c] text-[#0d1017]`
      : `${base} text-[#a39b87]`;
    return el('button', { class: cls, onclick: () => up('vstupnyMod', m) }, m === 'hruba' ? 'hrubá' : 'čistá');
  }));

  const prijemCard = Card({
    title: 'Príjem',
    right: prijemModeToggle,
    children: [
      el('div', `grid gap-3 ${state.ziadatelov === 2 ? 'grid-cols-2' : 'grid-cols-1'}`,
        Field(`Žiadateľ 1 · ${state.vstupnyMod === 'hruba' ? 'hrubá' : 'čistá'} mzda`,
          el('div', null,
            NumInput({
              value: state.vstupnyMod === 'hruba' ? state.hruba1 : state.cista1,
              onChange: v => up(state.vstupnyMod === 'hruba' ? 'hruba1' : 'cista1', v),
              step: 50,
              dataKey: state.vstupnyMod === 'hruba' ? 'hruba1' : 'cista1',
            }),
            el('div', 'text-[10px] text-[#70684f] mono mt-1',
              state.vstupnyMod === 'hruba'
                ? `→ čistá ${eur(mzdaVypocty.m1.cista, 2)}`
                : `→ hrubá ${eur(mzdaVypocty.m1.hruba, 2)}`),
          ),
        ),
        state.ziadatelov === 2
          ? Field(`Žiadateľ 2 · ${state.vstupnyMod === 'hruba' ? 'hrubá' : 'čistá'} mzda`,
              el('div', null,
                NumInput({
                  value: state.vstupnyMod === 'hruba' ? state.hruba2 : state.cista2,
                  onChange: v => up(state.vstupnyMod === 'hruba' ? 'hruba2' : 'cista2', v),
                  step: 50,
                  dataKey: state.vstupnyMod === 'hruba' ? 'hruba2' : 'cista2',
                }),
                el('div', 'text-[10px] text-[#70684f] mono mt-1',
                  state.vstupnyMod === 'hruba'
                    ? `→ čistá ${eur(mzdaVypocty.m2 ? mzdaVypocty.m2.cista : 0, 2)}`
                    : `→ hrubá ${eur(mzdaVypocty.m2 ? mzdaVypocty.m2.hruba : 0, 2)}`),
              ))
          : null,
      ),
      Field('Existujúce splátky úverov',
        NumInput({ value: state.existSplatky, onChange: v => up('existSplatky', v), step: 10, dataKey: 'existSplatky' })),
    ],
  });

  const fixaciaButtons = el('div', 'grid grid-cols-5 gap-1', [1, 3, 5, 7, 10].map(f => {
    const base = 'py-1.5 text-xs mono rounded-sm transition-colors';
    const cls = state.fixacia === f
      ? `${base} bg-[#d4873c] text-[#0d1017]`
      : `${base} bg-[#1a1a1e] text-[#a39b87]`;
    return el('button', { class: cls, onclick: () => up('fixacia', f) }, `${f}r`);
  }));

  const hypotekaCard = Card({
    title: 'Parametre hypotéky',
    right: icon('Home', 'w-3 h-3 text-[#70684f]'),
    children: [
      Field('Úroková sadzba',
        Slider({ value: state.urok, onChange: v => up('urok', v), min: 1, max: 8, step: 0.05, suffix: ' %' }),
        pct(state.urok, 2)),
      Field('Splatnosť',
        Slider({ value: state.splatnost, onChange: v => up('splatnost', v), min: 5, max: 40, step: 1, suffix: ' r.' }),
        `${state.splatnost} rokov`),
      Field('Fixácia', fixaciaButtons,
        `${state.fixacia} rokov · stres ${pct(stresDec * 100, 2)}`),
      Field('LTV (pomer úver/hodnota)',
        Slider({ value: state.ltv, onChange: v => up('ltv', v), min: 50, max: 100, step: 5, suffix: ' %' }),
        `${state.ltv} %`),
    ],
  });

  const cielCard = mode === 'ciel' ? Card({
    title: 'Cieľová suma',
    accent: true,
    right: icon('Target', 'w-3 h-3 text-[#d4873c]'),
    children: [
      Field('Čo zadávam',
        el('div', 'grid grid-cols-2 gap-2', [['cena', 'Cenu nehnuteľnosti'], ['uver', 'Výšku úveru']].map(([k, l]) => {
          const base = 'py-2 text-xs rounded-sm transition-colors';
          const cls = targetType === k
            ? `${base} bg-[#d4873c] text-[#0d1017]`
            : `${base} bg-[#1a1a1e] text-[#a39b87]`;
          return el('button', { class: cls, onclick: () => { targetType = k; render(); } }, l);
        })),
      ),
      Field(targetType === 'cena' ? 'Cena nehnuteľnosti' : 'Výška úveru',
        NumInput({ value: targetSuma, onChange: v => { targetSuma = v; render(); }, step: 5000, dataKey: 'targetSuma' })),
    ],
  }) : null;

  const resetBtn = el('button', {
    class: 'w-full py-2 text-[10px] uppercase tracking-wider text-[#70684f] hover:text-[#a39b87] flex items-center justify-center gap-2',
    onclick: () => setState(DEFAULT_STATE),
  }, icon('RotateCcw', 'w-3 h-3'), 'Reset');

  const leftPanel = el('div', 'col-span-12 lg:col-span-4 space-y-5',
    ziadateliaCard, prijemCard, hypotekaCard, cielCard, resetBtn);

  // ——— PRAVÝ PANEL: VÝSTUPY ———
  let rightContent;
  if (mode === 'prijem') {
    // Hero
    const heroUver = Card({
      accent: true,
      children: [
        Metric({ label: 'Maximálny úver', value: eur(maxUver), sub: `limitované ukazovateľom ${bottleneck}`, large: true, tone: bottleneck === 'DTI' ? 'warn' : 'normal' }),
        el('div', 'mt-4 pt-4 border-t border-[#3a362c] space-y-2',
          rowBetween(
            el('span', 'text-[#a39b87]', `Reálna splátka pri ${pct(state.urok, 2)}`),
            el('span', 'mono text-[#f0ead6]', eur(splatkaReal, 2))),
          rowBetween(
            el('span', 'text-[#a39b87]', `Stresovaná pri ${pct(stresDec * 100, 2)}`),
            el('span', 'mono text-[#e8a84c]', eur(splatkaStres, 2))),
        ),
      ],
    });
    const heroCena = Card({
      children: [
        Metric({ label: `Max cena pri LTV ${state.ltv}%`, value: eur(cenaNehn), sub: `potreba cash: ${eur(vlastnyKapital)}`, large: true, tone: 'good' }),
        el('div', 'mt-4 pt-4 border-t border-[#2a2620] space-y-2',
          rowBetween(
            el('span', 'text-[#a39b87]', 'Pri 90 % LTV'),
            el('span', 'mono text-[#a39b87]', eur(maxUver / 0.9))),
          rowBetween(
            el('span', 'text-[#a39b87]', 'Pri 70 % LTV'),
            el('span', 'mono text-[#a39b87]', eur(maxUver / 0.7))),
        ),
      ],
    });
    const hero = el('div', 'grid grid-cols-2 gap-4', heroUver, heroCena);

    // NBS ukazovatele
    const dtiCol = el('div', 'border-r border-[#2a2620] pr-4',
      el('div', 'flex items-baseline gap-2 mb-2',
        el('span', 'serif text-2xl italic', 'DTI'),
        el('span', 'text-[10px] uppercase tracking-wider text-[#70684f]', 'Debt-to-Income'),
      ),
      Metric({ label: 'Max úver (8× ročný príjem)', value: eur(dtiLimit), tone: bottleneck === 'DTI' ? 'warn' : 'mute' }),
      el('div', 'text-[10px] text-[#70684f] mono mt-2',
        `Žiadateľ 1: ${dti1}× · ${state.ziadatelov === 2 ? `Žiadateľ 2: ${dti2}× · ` : ''}Ročný čistý: ${eur(rocnyPrijem)}`),
      (state.vek1 > 40 && state.vek1 + state.splatnost > 65)
        ? el('div', 'text-[10px] text-[#e8a84c] mono mt-1 flex items-center gap-1',
            icon('AlertTriangle', 'w-3 h-3'), ' Strieborná hypotéka · DTI znížené')
        : null,
    );
    const dstiCol = el('div', 'border-r border-[#2a2620] pr-4',
      el('div', 'flex items-baseline gap-2 mb-2',
        el('span', 'serif text-2xl italic', 'DSTI'),
        el('span', 'text-[10px] uppercase tracking-wider text-[#70684f]', 'Debt-Service'),
      ),
      Metric({ label: 'Max úver pri 60 % rezerve', value: eur(maxUverDSTI60), tone: bottleneck === 'DSTI' ? 'warn' : 'mute' }),
      el('div', 'text-[10px] text-[#70684f] mono mt-2', `Výnimka 70 %: ${eur(maxUverDSTI70)}`),
      el('div', 'text-[10px] text-[#70684f] mono', `Disp. príjem: ${eur(dispPrijem, 2)}`),
    );
    const ltvCol = el('div', null,
      el('div', 'flex items-baseline gap-2 mb-2',
        el('span', 'serif text-2xl italic', 'LTV'),
        el('span', 'text-[10px] uppercase tracking-wider text-[#70684f]', 'Loan-to-Value'),
      ),
      Metric({ label: 'Hodnota nehnuteľnosti', value: eur(cenaNehn) }),
      el('div', 'text-[10px] text-[#70684f] mono mt-2',
        `Pri LTV ${state.ltv} % · vlastný kapitál ${eur(vlastnyKapital)}`),
    );
    const nbsCard = Card({
      title: 'NBS ukazovatele · čo koľko povoľuje',
      children: el('div', 'grid grid-cols-3 gap-4', dtiCol, dstiCol, ltvCol),
    });

    // Životné minimum
    const zmVzorec = el('div', 'mt-4 pt-4 border-t border-[#2a2620] text-xs text-[#a39b87] leading-relaxed',
      el('span', 'text-[#70684f]', 'Vzorec DSTI:'),
      ' (Čistý príjem − životné minimum − existujúce splátky) × 60 % ≥ nová stresovaná splátka',
    );
    const zmCard = Card({
      title: 'Životné minimum a disponibilný príjem',
      children: [
        el('div', 'grid grid-cols-4 gap-4',
          Metric({ label: 'Čistý príjem domácnosti', value: eur(cistyDomacnost, 2), tone: 'good' }),
          Metric({ label: 'Životné minimum', value: eur(zivMin, 2), sub: state.ziadatelov === 2 ? '2 dospelí + ' + state.deti + ' deti' : '1 dospelý + ' + state.deti + ' deti', tone: 'mute' }),
          Metric({ label: '− existujúce splátky', value: eur(state.existSplatky, 2), tone: 'mute' }),
          Metric({ label: '= Disponibilný príjem', value: eur(dispPrijem, 2), tone: 'good' }),
        ),
        zmVzorec,
      ],
    });

    // Mzdový breakdown
    const breakdownCard = Card({
      title: 'Mzdový breakdown · 2026',
      children: el('div', `grid gap-4 ${state.ziadatelov === 2 ? 'grid-cols-2' : 'grid-cols-1'}`,
        MzdaBreakdown(mzdaVypocty.m1, 'Žiadateľ 1'),
        state.ziadatelov === 2 ? MzdaBreakdown(mzdaVypocty.m2, 'Žiadateľ 2') : null,
      ),
    });

    rightContent = [hero, nbsCard, zmCard, breakdownCard];
  } else {
    rightContent = ReverseView(reverse, stresDec, zivMin);
  }

  // Metodické poznámky
  const infoRow = (strong, rest) => el('div', 'flex items-start gap-2',
    icon('Info', 'w-3 h-3 mt-0.5 text-[#70684f] shrink-0'),
    el('div', null,
      el('span', 'text-[#d4873c]', strong),
      ' ', rest,
    ),
  );
  const poznamkyCard = Card({
    title: 'Metodické poznámky',
    children: el('div', 'text-xs text-[#a39b87] space-y-2 leading-relaxed',
      infoRow('DTI', '= max 8-násobok čistého ročného príjmu. Nad 40 r. a ak splatnosť presahuje 65. rok života, DTI sa znižuje o 0,25 za každý rok nad 40 (tzv. strieborná hypotéka · NBS od 1.1.2023).'),
      infoRow('DSTI', '= splátka ≤ 60 % (disponibilný príjem − životné minimum − existujúce splátky). Banky môžu dať výnimku 70 % pre max 5 % objemu nových úverov.'),
      infoRow('Stres test', '= aktuálny úrok + 2 pp (+1 pp pre fixáciu > 10 rokov), capped na 6 %. DSTI sa počíta z väčšej zo splátok (reálna vs. stresovaná) pri splatnosti minimálne 30 rokov.'),
      infoRow('Životné minimum', `platné 1.7.2026 – 30.6.2027: ${ZM.dosp1} / ${ZM.dosp2} / ${ZM.dieta} € (plnoletá FO / ďalšia spoločne posudzovaná plnoletá FO / nezaopatrené dieťa). Nové ŽM platí od 1. 7. 2027 (zverejnenie v máji 2027).`),
      infoRow('Mzdové odvody 2026', ': soc. 9,4 % · zdr. 5 % · daň progresívne 19 / 25 / 30 / 35 %. NČZD 497,23 €/mes kráti sa pri ročnom ZD nad 26 367,26 €.'),
    ),
  });

  const rightPanel = el('div', 'col-span-12 lg:col-span-8 space-y-5',
    ...(Array.isArray(rightContent) ? rightContent : [rightContent]),
    poznamkyCard,
  );

  const grid = el('div', 'grid grid-cols-12 gap-6', leftPanel, rightPanel);

  // ——— FOOTER ———
  const footer = el('footer', 'mt-10 pt-4 border-t border-[#2a2620] text-[10px] text-[#70684f] mono flex justify-between',
    el('span', null, 'Výsledky sú orientačné · jednotlivé banky si môžu pravidlá upraviť prísnejšie'),
    el('span', null, 'Legal Engineering · v2.0 / 2026-04-20'),
  );

  const inner = el('div', 'max-w-[1240px] mx-auto px-6 py-8',
    header, modeSwitcher, grid, footer);

  root.appendChild(inner);

  // ——— Obnova focusu PO prestavbe DOM ———
  // Prednostne podľa stabilného kľúča (data-fk); ak pole v novom DOM neexistuje
  // (napr. zmena módu/počtu žiadateľov zmenila skladbu polí), fallback na index.
  if (focusRestore) {
    const numbers = [...root.querySelectorAll('input[type=number]')];
    let target = null;
    if (focusRestore.fk) {
      target = numbers.find(i => i.getAttribute('data-fk') === focusRestore.fk) || null;
    }
    if (!target && focusRestore.index >= 0 && focusRestore.index < numbers.length) {
      target = numbers[focusRestore.index];
    }
    if (target) {
      target.focus();
      if (focusRestore.caret != null) {
        try { target.setSelectionRange(focusRestore.caret, focusRestore.caret); } catch (e) { /* number input v niektorých prehliadačoch hádže na setSelectionRange */ }
      }
    }
  }
}

// ————— MZDA BREAKDOWN ————————————————————————————————————————————————
function MzdaBreakdown(mzda, label) {
  if (!mzda) return null;
  const rows = [
    ['Hrubá mzda', mzda.hruba || 0, 'normal'],
    ['− Sociálne poistenie (9,4 %)', -mzda.soc, 'mute'],
    ['− Zdravotné poistenie (5 %)', -mzda.zdr, 'mute'],
    ['= Základ dane', mzda.zd, 'mute'],
    ['− Nezdaniteľná časť (NČZD)', -mzda.ncdz, 'mute'],
    ['= Zdaňovaný ZD', mzda.zd_zdan, 'mute'],
    ['− Daň z príjmu', -mzda.dan, 'mute'],
    ['+ Daňový bonus', mzda.bonus, 'good'],
    ['= Čistá mzda', mzda.cista, 'good'],
    ['Cena práce (zamestnávateľ)', mzda.cenaPrace, 'mute'],
  ];
  return el('div', null,
    el('div', 'text-[10px] uppercase tracking-wider text-[#70684f] mb-2', label),
    el('div', 'space-y-1', rows.map(([lab, val, tone]) => {
      const isSum = lab.charAt(0) === '=';
      const rowCls = 'flex justify-between items-center text-xs py-1' +
        (isSum ? ' border-t border-[#2a2620] pt-2' : '');
      const labCls = isSum ? 'text-[#f0ead6] font-medium' : 'text-[#a39b87]';
      const valCls = 'mono ' + (tone === 'good' ? 'text-[#8abf6f]' : isSum ? 'text-[#f0ead6]' : 'text-[#a39b87]');
      return el('div', rowCls,
        el('span', labCls, lab),
        el('span', valCls, (val < 0 ? '−' : '') + eur(Math.abs(val), 2)),
      );
    })),
  );
}

// ————— REVERSE VIEW ————————————————————————————————————————————————
function ReverseView(reverse, stresDec, zivMin) {
  if (!reverse) return [];

  const domacnostBlok = el('div', null,
    el('div', 'text-[10px] uppercase tracking-wider text-[#70684f] mb-2', 'Domácnosť spolu'),
    Metric({ label: 'Potrebná ČISTÁ mzda', value: eur(reverse.potrCisty, 0), sub: `mesačne · ročne ${eur(reverse.potrCisty * 12)}`, large: true, tone: 'good' }),
    Metric({ label: 'Potrebná HRUBÁ mzda', value: eur(reverse.potrHruba, 0), sub: `mesačne · ročne ${eur(reverse.potrHruba * 12)}`, large: true, tone: 'warn' }),
  );
  const perOsobaBlok = state.ziadatelov === 2 ? el('div', null,
    el('div', 'text-[10px] uppercase tracking-wider text-[#70684f] mb-2', 'Na jedného žiadateľa (rovnomerne)'),
    Metric({ label: 'ČISTÁ mzda · 1 osoba', value: eur(reverse.potrCistyPerOsoba, 0), large: true, tone: 'good' }),
    Metric({ label: 'HRUBÁ mzda · 1 osoba', value: eur(reverse.potrHrubaPerOsoba, 0), large: true, tone: 'warn' }),
  ) : null;

  const cielCardEl = Card({
    accent: true,
    children: [
      el('div', 'flex items-baseline justify-between mb-4',
        el('div', null,
          el('div', 'text-[10px] uppercase tracking-wider text-[#d4873c] mb-1', 'Cieľ'),
          el('div', 'serif text-3xl italic',
            (targetType === 'cena' ? 'Nehnuteľnosť za ' : 'Úver ') + eur(targetSuma)),
        ),
        el('div', 'text-xs text-[#a39b87] text-right',
          el('div', null, `Úver: ${eur(reverse.cielUver)}`),
          el('div', null, `Cena: ${eur(reverse.cielCena)}`),
          el('div', null, `Stresovaná splátka: ${eur(reverse.potrSplatka, 2)}`),
        ),
      ),
      el('div', 'grid grid-cols-2 gap-6 pt-4 border-t border-[#3a362c]',
        domacnostBlok, perOsobaBlok),
      el('div', 'mt-4 pt-4 border-t border-[#3a362c] text-xs text-[#a39b87]',
        el('span', 'text-[#70684f]', 'Binding:'),
        ' ' + (reverse.bindingBy === 'DSTI'
          ? 'DSTI · splátka je tesná, príjem treba zvýšiť aby prešla cez 60 % pravidlo'
          : 'DTI · úver narazí na 8× ročný príjem pred DSTI'),
      ),
    ],
  });

  // "Čo sa skrýva za tým" — grid 1fr auto
  const mut = (t) => el('span', 'text-[#a39b87]', t);
  const detailGrid = el('div', 'space-y-3 text-xs',
    el('div', 'grid grid-cols-[1fr_auto] gap-2 font-mono',
      mut(`Stresovaný úrok (pri fixácii ${state.fixacia} r.)`),
      el('span', 'text-[#e8a84c]', pct(stresDec * 100, 2)),

      mut(`Stresovaná splátka cieľového úveru (${state.splatnost} r.)`),
      el('span', null, eur(reverse.potrSplatka, 2)),

      mut('Požadovaný disponibilný príjem (splátka / 0,6)'),
      el('span', null, eur(reverse.potrSplatka / 0.6, 2)),

      mut(`+ životné minimum (${state.ziadatelov === 1 ? '1' : '2'} dosp. + ${state.deti} detí, 2026/27)`),
      el('span', null, `+ ${eur(zivMin, 2)}`),

      mut('+ existujúce splátky'),
      el('span', null, `+ ${eur(state.existSplatky, 2)}`),

      el('span', 'text-[#f0ead6] pt-2 border-t border-[#2a2620] font-medium', '= Minimálna ČISTÁ mzda domácnosti'),
      el('span', 'text-[#8abf6f] pt-2 border-t border-[#2a2620] font-medium', eur(reverse.potrCisty, 2)),
    ),
  );

  const detailCard = Card({
    title: 'Čo sa skrýva za tým',
    children: detailGrid,
  });

  return [cielCardEl, detailCard];
}

// ————— SERVICE WORKER REGISTRÁCIA ————————————————————————————————————
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('Service worker registrácia zlyhala:', err);
    });
  });
}

// ————— ŠTART ————————————————————————————————————————————————————
render();
