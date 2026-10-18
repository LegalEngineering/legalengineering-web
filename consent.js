/* Súhlas s analytickými cookies (GA4, Consent Mode v2, prísny režim) – legalengineering.sk.
 * Konfigurácia: window.CONSENT_CFG = {key: 'le_consent_v1', ga: 'G-XXXX'} sa nastaví v <head>
 * spolu s gtag('consent','default', ... všetko denied ...). Lišta: <div id="consentBar" class="cb" hidden> v HTML.
 * Vzhľad: CSS premenné --cb-bg, --cb-fg, --cb-accent, --cb-font na :root; predvolené hodnoty = paleta LE
 * (tmavá lesná zelená, papier, zlato/mosadz, písmo Fraunces).
 * gtag.js sa načíta až po kliknutí na „Prijať“ (alebo pri návrate, ak bol súhlas uložený).
 * Ľubovoľný prvok s atribútom data-consent-open lištu znovu otvorí (zmena alebo odvolanie súhlasu). */
(function () {
  var C = window.CONSENT_CFG || {}, K = C.key, ID = C.ga, loaded = false;
  var bar = document.getElementById('consentBar');
  var css = '.cb{position:fixed;left:12px;right:12px;bottom:12px;z-index:200;max-width:760px;margin:0 auto;' +
    'background:var(--cb-bg,#1F3328);color:var(--cb-fg,#F6F1E7);border:1px solid rgba(246,241,231,.18);border-radius:16px;' +
    'padding:14px 16px;display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;box-shadow:0 18px 40px -16px rgba(31,51,40,.7);' +
    'font:14.5px/1.45 var(--cb-font,"Fraunces","Hoefler Text",Georgia,serif);text-align:left;letter-spacing:0}' +
    '.cb[hidden]{display:none}.cb p{margin:0;flex:1 1 320px;opacity:1}.cb a{color:var(--cb-accent,#C28A2B);text-decoration:underline;text-underline-offset:2px}' +
    '.cb .cb-btns{display:flex;gap:8px;margin-left:auto}' +
    '.cb button{min-width:110px;border:2px solid var(--cb-accent,#C28A2B);border-radius:999px;padding:8px 16px;' +
    'font:600 15px var(--cb-font,"Fraunces","Hoefler Text",Georgia,serif);cursor:pointer;background:transparent;color:var(--cb-fg,#F6F1E7);transition:background .15s,color .15s}' +
    '.cb button:hover,.cb button:focus-visible{background:var(--cb-accent,#C28A2B);color:var(--cb-bg,#1F3328)}' +
    '@media print{.cb{display:none!important}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  function g() { if (typeof window.gtag === 'function') window.gtag.apply(null, arguments); }
  function get() { try { return localStorage.getItem(K); } catch (e) { return null; } }
  function put(v) { try { localStorage.setItem(K, v); } catch (e) {} }
  function load() {
    if (loaded || !ID || /^G-X+$/.test(ID)) return; loaded = true;
    var s = document.createElement('script'); s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ID; document.head.appendChild(s);
  }
  function wipe() {
    /* Vymaž _ga* cookies pre hostname aj apex doménu (GA ich ukladá na apex, napr. .legalengineering.sk). */
    var h = location.hostname, apex = h.split('.').slice(-2).join('.');
    var d = ['', h, '.' + h, apex, '.' + apex];
    document.cookie.split(';').forEach(function (c) {
      var n = c.split('=')[0].trim();
      if (/^_ga/.test(n)) d.forEach(function (x) { document.cookie = n + '=; Max-Age=0; path=/' + (x ? '; domain=' + x : ''); });
    });
  }
  var bound = false;
  function off() {
    /* Stav „denied“: najprv Consent Mode update + oficiálny opt-out prepínač (už načítaný gtag prestane posielať
     * aj záverečný ping pri pagehide), potom uprac cookies – a upratuj ich aj pri opustení stránky. */
    if (ID) window['ga-disable-' + ID] = true;
    g('consent', 'update', { analytics_storage: 'denied' });
    wipe();
    if (!bound) {
      bound = true;
      window.addEventListener('pagehide', wipe);
      window.addEventListener('beforeunload', wipe);
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') wipe(); });
    }
  }
  function on() {
    if (ID) window['ga-disable-' + ID] = false;
    g('consent', 'update', { analytics_storage: 'granted' });
    load();
  }
  function apply(v) { if (v === 'granted') on(); else off(); }
  var v = get();
  if (v === 'granted') load(); else if (v === 'denied') off(); else if (bar) bar.hidden = false;
  if (bar) bar.addEventListener('click', function (e) {
    var b = e.target.closest('[data-c]'); if (!b) return;
    put(b.dataset.c); apply(b.dataset.c); bar.hidden = true;
  });
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href^="mailto:"],a[href^="tel:"]');
    if (a) g('event', 'contact_click', { contact_type: /^tel:/.test(a.getAttribute('href')) ? 'phone' : 'email', link_url: a.href });
    var o = e.target.closest('[data-consent-open]');
    if (o && bar) { e.preventDefault(); bar.hidden = false; var f = bar.querySelector('button'); if (f) f.focus(); }
  });
})();
