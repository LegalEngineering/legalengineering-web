/**
 * legalengineering.sk: statický web s meraním zdrojov (Worker web-meranie).
 * Worker beží len na cestách z assets.run_worker_first a na cestách bez súboru;
 * vždy vráti odpoveď env.ASSETS.fetch bez úprav (PWA, presmerovania, 404 ostávajú ako predtým).
 * Popis merania: /ochrana-osobnych-udajov/#cookies.
 */

const SITE = "legalengineering.sk";

// Meranie zdrojov (Worker web-meranie). Nesmie ovplyvniť stránku, preto všetko v try/catch.
function zmeraj(request, env, ctx, site, cesta) {
  try {
    if (!env.MERANIE || !ctx) return;
    const h = request.headers, url = new URL(request.url);
    ctx.waitUntil(env.MERANIE.fetch("https://meranie/zapis", {
      method: "POST",
      body: JSON.stringify({
        site, cesta: cesta || url.pathname, ua: h.get("User-Agent"), accept: h.get("Accept"),
        referer: h.get("Referer"), dest: h.get("Sec-Fetch-Dest"), mode: h.get("Sec-Fetch-Mode"),
        fetchSite: h.get("Sec-Fetch-Site"), purpose: h.get("Sec-Purpose"), overeny: request.cf && request.cf.verifiedBotCategory,
        utm: url.searchParams.get("utm_source"),
      }),
    }).catch(() => {}));
  } catch {}
}

export default {
  async fetch(request, env, ctx) {
    const resp = await env.ASSETS.fetch(request);
    if (request.method === "GET" && (resp.status === 200 || resp.status === 304)) {
      zmeraj(request, env, ctx, SITE);
    }
    return resp;
  },
};
