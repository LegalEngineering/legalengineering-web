# legalengineering.sk

Showcase hub for **Legal Engineering** — *hard work worth your soft costs.*

A single-page site linking to our tools, products and experiments. Showcase
pages are bundled as sub-paths: `/vygumovanie`, `/pi-poem`, `/hypo`, `/trovy`, `/konverzia`.
Fonts are self-hosted in `/assets/fonts/` (SIL OFL 1.1, licences alongside).

Live via Cloudflare Workers (static assets + `worker.js`, Workers Builds from `main`) → https://legalengineering.sk
`worker.js` runs only on the paths in `assets.run_worker_first` and on paths without a file. It returns the assets
response unchanged and adds daily source counts through the `MERANIE` service binding (described in the privacy policy).
Redirects for retired sub-paths live in `_redirects`.
