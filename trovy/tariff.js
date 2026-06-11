// tariff.js — Tarifné dáta pre kalkulačku trov právneho zastúpenia
// Vyhláška MS SR č. 655/2004 Z.z. v znení neskorších predpisov
// Verzia: 2026.06.01b (M1.5 + M2 dokončené — § 13 multipliery, § 12 ods. 7 opatrovník,
//          § 14 ods. 7 dohoda o vine a treste, § 11 ods. 3/4 Ústavný/správne/sociálne,
//          § 10 ods. 8/9 osobitné tarifné hodnoty)
//
// Audit trail: ../00_AI-LOG/2026-05-13_tarifa-verification.md
//              + ../00_AI-LOG/2026-06-01_trestna-cast-verification.md
//              + ../00_AI-LOG/2026-06-01_m15-m2-rozsirenie-verification.md
// Plán: ../kalk-trovy-m1-plan.md (v2, sekcia 4)
//
// Ročná aktualizácia:
//   1. Pridať nový rok do `vypoctovy_zaklad_eur` (zdroj: ŠÚ SR PMZ 1H roku N-1, resp. najpravo.sk tabuľka)
//   2. Ak vyšlo nové opatrenie MPSVaR o sumách základnej náhrady za km → pridať do `cestovne_opatrenia`
//      a uzavrieť predošlé opatrenie nastavením `do` dátumu (deň pred účinnosťou nového)
//   3. Aktualizovať `meta.version` a `meta.last_verified`

export const TARIFF = {
  meta: {
    version: "2026.06.01b",
    legal_basis: "Vyhláška MS SR č. 655/2004 Z.z. v znení neskorších predpisov, účinné znenie po novele 391/2023 Z.z. od 2024-01-01",
    effective_from: "2024-01-01",
    last_verified: "2026-06-01",
    verification_source: "zakonypreludi.sk konsolidované znenie (§10-§17, doslovný prepis) + najpravo.sk VZ scrape. POZOR: slov-lex MCP vracia pri novelizovaných paragrafoch vyhlásené (2005) znenie — nepoužívať (viď 2026-06-01_m15-m2-rozsirenie-verification.md)."
  },

  // Výpočtové základy podľa roku — §1 ods. 3 vyhlášky (CIVILNÝ / všeobecný VZ).
  // Kľúč = ROK POUŽITIA (rok vykonania úkonu). Hodnota je výpočtový základ platný pre úkony
  // v tom roku; posun podľa §1 ods. 3 (priemerná mzda za 1. polrok predchádzajúceho roka)
  // je už zarátaný v zverejnenej hodnote (zdroj: najpravo.sk tabuľka VZ 2002–2026,
  // overené 2026-05-21 proti PDF). Engine preto pre civilné konania robí priamy lookup
  // `vz_posun: 0` — žiadny ďalší posun.
  // Príklad: úkon 2026-03-01, konanie civil-nonvalue → vz = vypoctovy_zaklad_eur["2026"] = 1586 €
  //
  // TRESTNÝ VZ (§1 ods. 4): pre TARIFNÚ ODMENU v trestnom konaní a v konaní o priestupkoch
  // je výpočtovým základom priemerná mzda za 1. polrok roku, ktorý o tri roky predchádza roku
  // určujúcemu VZ podľa ods. 3 — t. j. mzda za 1. polrok roku (N-4) oproti roku úkonu N.
  // V tejto tabuľke (indexovanej rokom použitia, kde je civilný posun rok-1 už zabudovaný)
  // to zodpovedá kľúču (N-3): konanie "criminal" má preto `vz_posun: -3`.
  // Príklad: trestný úkon 2026 → vypoctovy_zaklad_eur["2023"] = 1252 € (mzda 1. polrok 2022).
  // POZOR: §1 ods. 4 sa vzťahuje VÝSLOVNE len na tarifnú odmenu. Režijný paušál (§16 ods. 3)
  // a náhrada za stratu času (§17) sa aj v trestnej veci počítajú z CIVILNÉHO VZ podľa ods. 3
  // (rok použitia N) — engine na to používa vzNahradova().
  vypoctovy_zaklad_eur: {
    "2009": 695.41, "2010": 721.40, "2011": 741, "2012": 763, "2013": 781,
    "2014": 804, "2015": 839, "2016": 858, "2017": 884, "2018": 921,
    "2019": 980, "2020": 1062, "2021": 1087, "2022": 1163, "2023": 1252,
    "2024": 1373, "2025": 1484, "2026": 1586
  },

  parameters: {
    vat_rate: 0.23,                  // §18 ods. 3, od 2025-01-01
    rezijny_pausal_zlomok: 1/100,    // §16 ods. 3
    strata_casu_zlomok: 1/60,        // §17 ods. 1, za začatú polhodinu
    nehodnotova_zlomok: 1/13,        // §11 ods. 1 (default; per-konanie viď konania[].tarifna_zlomok)
    // §13 multipliery (po novele 391/2023 — overené zakonypreludi.sk 2026-06-01):
    spolu_osoba_znizenie: 0.5,       // §13 ods. 2 — zníženie o 50 % za druhú a každú ďalšiu spoločne zastupovanú osobu
    spojenie_veci_zlomok: 1/3,       // §13 ods. 3 — +1/3 základnej sadzby každej ďalšej spojenej veci
    uprava_sadzby_max_pct: 50,       // §13 ods. 5 — zvýšenie najviac o 50 % (symetricky §13 ods. 1 zníženie)
    // §12 ods. 7 / §14 ods. 7 — osobitné trestné odmeny:
    opatrovnik_pausal_eur: 200,      // §12 ods. 7 — opatrovník na ochranu práv poškodeného, paušál za celé konanie
    dohoda_vt_nasobok: 4             // §14 ods. 7 — dohoda o vine a treste pred obžalobou: +4× základná sadzba
  },

  // §10 ods. 1 hodnotová tarifa — verifikované 2026-05-13 zo sk-slov-lex MCP
  hodnotova_tabulka: [
    { from: 0,        to: 165.97,    flat: 16.60 },
    { from: 165.97,   to: 663.88,    base: 16.60,  over: 165.97,   step_size: 33.19,   step_eur: 1.66 },
    { from: 663.88,   to: 6638.78,   base: 41.49,  over: 663.88,   step_size: 331.94,  step_eur: 9.96 },
    { from: 6638.78,  to: 33193.92,  base: 220.74, over: 6638.78,  step_size: 1659.70, step_eur: 16.60 },
    { from: 33193.92, to: Infinity,  base: 486.29, over: 33193.92, step_size: 3319.39, step_eur: 6.64 }
  ],

  // Typy konaní.
  //   vz_posun = posun pre TARIFNÚ ODMENU oproti roku úkonu, v kľúčoch tabuľky vypoctovy_zaklad_eur.
  //   family  = rodina konania; pri prechode medzi rodinami sa menia dostupné úkony (§13a vs §14).
  // Typy konaní. `tarifna_zlomok` = zlomok výpočtového základu pre nehodnotovú tarifnú odmenu
  // (§11). civil-value nemá zlomok — používa §10 pásmovú tarifu z tarifnej hodnoty.
  konania: {
    "civil-value":    { label: "Civilné — predmet konania oceniteľný peniazmi (§ 10)", enabled: true, vz_posun: 0,  family: "civil" },
    "civil-nonvalue": { label: "Civilné — neoceniteľná vec (§ 11 ods. 1)",   enabled: true,  vz_posun: 0,  family: "civil", tarifna_zlomok: 1/13 },
    // §11 ods. 3 — zastupovanie pred Ústavným súdom SR (neoceniteľná vec) = 1/4 VZ.
    "ustavny":        { label: "Ústavný súd — neoceniteľná vec (§ 11 ods. 3)", enabled: true, vz_posun: 0, family: "civil", tarifna_zlomok: 1/4 },
    // §11 ods. 4 — konania podľa Správneho súdneho poriadku = 1/6 VZ.
    "spravne":        { label: "Správne súdnictvo (§ 11 ods. 4)",            enabled: true,  vz_posun: 0,  family: "civil", tarifna_zlomok: 1/6 },
    // §11 ods. 4 — dávkové veci sociálneho poistenia a veci sociálnych služieb = 1/13 VZ.
    "socialne":       { label: "Dávkové sociálne / sociálne služby (§ 11 ods. 4)", enabled: true, vz_posun: 0, family: "civil", tarifna_zlomok: 1/13 },
    // Trestné konanie / konanie o priestupkoch — §12 (sadzba) + §14 (úkony). VZ pre tarifnú odmenu
    // podľa §1 ods. 4 → kľúč N-3 (vz_posun: -3). Paušál/strata času používajú civilný VZ (vzNahradova).
    "criminal":       { label: "Trestné konanie / priestupky (§ 12, § 14)", enabled: true,  vz_posun: -3, family: "criminal" }
  },

  // §10 ods. 8 a ods. 9 — osobitné pevné tarifné hodnoty (predvoľby pre §10 hodnotovú tarifu).
  // Pri výbere predvyplnia hodnotaSporu; výpočet ide štandardnou §10 pásmovou tarifou.
  tarifne_hodnoty_osobitne: [
    { id: "osobnost-bez", hodnota: 3000, ref: "§ 10 ods. 8", label: "Ochrana osobnosti — bez náhrady nemajetkovej ujmy v peniazoch (§ 10 ods. 8)" },
    { id: "osobnost-s",   hodnota: 5000, ref: "§ 10 ods. 8", label: "Ochrana osobnosti — s náhradou nemajetkovej ujmy v peniazoch (§ 10 ods. 8)" },
    { id: "ooou-ds",      hodnota: 5000, ref: "§ 10 ods. 9", label: "Osobné údaje / nekalá súťaž / obchodné tajomstvo / duševné vlastníctvo (§ 10 ods. 9)" }
  ],

  // §12 — základné sadzby tarifnej odmeny v trestnom konaní a v konaní o priestupkoch.
  // Zlomok sa aplikuje na TRESTNÝ výpočtový základ (§1 ods. 4). Overené sk-slov-lex MCP 2026-06-01.
  trestne_sadzby: [
    { id: "12-3-a", zlomok: 1/12, ref: "§ 12 ods. 3 písm. a)", label: "Obhajoba — horná hranica trestu odňatia slobody do 5 rokov (1/12)" },
    { id: "12-3-b", zlomok: 1/8,  ref: "§ 12 ods. 3 písm. b)", label: "Obhajoba — horná hranica trestu nad 5 do 10 rokov (1/8)" },
    { id: "12-3-c", zlomok: 1/6,  ref: "§ 12 ods. 3 písm. c)", label: "Obhajoba — horná hranica trestu nad 10 rokov alebo výnimočný trest (1/6)" },
    { id: "12-1",   zlomok: 1/24, ref: "§ 12 ods. 1",          label: "Obhajoba — vec, v ktorej súd 1. stupňa rozhoduje na neverejnom zasadnutí (1/24)" },
    { id: "12-2",   zlomok: 1/24, ref: "§ 12 ods. 2",          label: "Zastupovanie v konaní o priestupkoch (1/24)" },
    // §12 ods. 7 — osobitný režim: paušál za CELÉ konanie, per-úkon sadzby sa neuplatňujú.
    { id: "12-7",   pausal_eur: 200, ref: "§ 12 ods. 7",       label: "Opatrovník na ochranu práv poškodeného — paušál 200 € za celé konanie (§ 12 ods. 7)" }
  ],

  // §13a — občianske úkony (M1 scope; trestné §14 je M2)
  ukony: [
    // Plná sadzba (1×)
    { id: "prevzatie",                  label: "Prevzatie a príprava zastúpenia (vrátane 1. porady)",            fraction: 1   },
    { id: "podanie-vec-sama",           label: "Písomné podanie vo veci samej",                                  fraction: 1   },
    { id: "pojednavanie",               label: "Účasť na pojednávaní (za každé začaté 2 h)",                     fraction: 1,   allows_loss_of_time: true, allows_travel: true },
    { id: "pravny-rozbor",              label: "Právny rozbor veci",                                             fraction: 1   },
    { id: "vyzva-predzalobna",          label: "Predžalobná výzva",                                              fraction: 1   },
    { id: "vypracovanie-listin",        label: "Vypracovanie listiny o právnom úkone",                           fraction: 1   },
    { id: "porada-dalsia",              label: "Ďalšia porada s klientom za skončenú hodinu",                    fraction: 1,   allows_loss_of_time: true },
    { id: "rokovanie-protistr",         label: "Rokovanie s protistranou za skončenú hodinu",                    fraction: 1,   allows_loss_of_time: true },
    { id: "predbezne-pred-konanim",     label: "Návrh na predbežné opatrenie pred konaním",                      fraction: 1   },
    { id: "odvolanie",                  label: "Odvolanie (vo veci samej)",                                      fraction: 1   },
    { id: "dovolanie",                  label: "Dovolanie",                                                      fraction: 1   },
    { id: "navrh-obnova",               label: "Návrh na obnovu konania",                                        fraction: 1   },
    // Polovičná sadzba (1/2×)
    { id: "predbezne-po-konani",        label: "Návrh na predbežné opatrenie po začatí konania",                 fraction: 0.5 },
    { id: "zabezpecenie-dokazu",        label: "Návrh na zabezpečenie dôkazu / dedičstva",                       fraction: 0.5 },
    { id: "odvolanie-procesne",         label: "Odvolanie nie vo veci samej",                                    fraction: 0.5 },
    { id: "porada-kratka",              label: "Ďalšia porada s klientom kratšia ako 1 h",                       fraction: 0.5, allows_loss_of_time: true },
    { id: "rokovanie-protistr-kratke",  label: "Rokovanie s protistranou kratšie ako 1 h",                       fraction: 0.5, allows_loss_of_time: true },
    { id: "navrh-procesny",             label: "Návrh procesnej povahy (oprava, zmeškanie, splátky)",            fraction: 0.5 },
    { id: "pojednavanie-vyhlasenie",    label: "Pojednávanie len pre vyhlásenie rozhodnutia",                    fraction: 0.5, allows_loss_of_time: true, allows_travel: true },
    // Štvrtinová sadzba (1/4×)
    { id: "pojednavanie-odrocene",      label: "Pojednávanie odročené bez prejednania veci",                     fraction: 0.25, allows_loss_of_time: true, allows_travel: true }
  ],

  // §14 — úkony právnej služby v trestnom konaní a v konaní o priestupkoch.
  // Sadzba (fraction) sa aplikuje na základnú sadzbu podľa §12 (trestne_sadzby).
  // AKTUÁLNE ZNENIE po novele 391/2023 — overené 2026-06-01 (konsolidované znenie
  // zakonypreludi.sk + verifikačný doc 2026-05-13). POZOR: slov-lex MCP get_law_range/section
  // vrátili POVODNÉ (2004) znenie §14 — to je nesprávne, nepoužívať.
  // Štruktúra: ods.1 = 1×, ods.2 = 2/3, ods.3 = 1/2, ods.4 = 1/3, ods.5 = 1/4, ods.7 = +4× (dohoda o V&T).
  ukony_trestne: [
    // §14 ods. 1 — plná sadzba (1×)
    { id: "tr-prevzatie",            label: "Prevzatie a príprava obhajoby (vrátane prvej porady s klientom)",         fraction: 1,    ref: "§ 14 ods. 1 písm. a)" },
    { id: "tr-podanie-vec-sama",     label: "Písomné podanie súdu alebo inému orgánu vo veci samej",                   fraction: 1,    ref: "§ 14 ods. 1 písm. b)" },
    { id: "tr-ucast-konanie",        label: "Účasť pri vyšetrovacom úkone / oboznámenie s výsledkami vyšetrovania / účasť na konaní pred súdom (za každé začaté 2 h)", fraction: 1, ref: "§ 14 ods. 1 písm. c)", allows_loss_of_time: true, allows_travel: true },
    { id: "tr-obnova-odv-dov",       label: "Návrh na obnovu konania / odvolanie / dovolanie",                         fraction: 1,    ref: "§ 14 ods. 1 písm. d)" },
    { id: "tr-vypracovanie-listin",  label: "Vypracovanie listiny o právnom úkone alebo jej podstatné prepracovanie",  fraction: 1,    ref: "§ 14 ods. 1 písm. e)" },
    // §14 ods. 2 — dve tretiny (2/3)
    { id: "tr-porada-hodina",        label: "Ďalšia porada s klientom za každú skončenú hodinu",                       fraction: 2/3,  ref: "§ 14 ods. 2", allows_loss_of_time: true },
    { id: "tr-rokovanie-protistr",   label: "Rokovanie s protistranou za každú skončenú hodinu",                       fraction: 2/3,  ref: "§ 14 ods. 2", allows_loss_of_time: true },
    // §14 ods. 3 — polovica (1/2)
    { id: "tr-zabezpecenie-dokazu",  label: "Návrh na zabezpečenie dôkazu",                                            fraction: 0.5,  ref: "§ 14 ods. 3" },
    { id: "tr-odvolanie-procesne",   label: "Odvolanie nie vo veci samej a vyjadrenie k nemu",                         fraction: 0.5,  ref: "§ 14 ods. 3" },
    { id: "tr-navrh-verejne",        label: "Návrhy a sťažnosti vo veciach rozhodovaných na verejnom zasadnutí",       fraction: 0.5,  ref: "§ 14 ods. 3" },
    { id: "tr-ucast-verejne",        label: "Účasť na verejnom zasadnutí (ak nejde o odvolanie alebo obnovu)",         fraction: 0.5,  ref: "§ 14 ods. 3", allows_loss_of_time: true, allows_travel: true },
    // §14 ods. 4 — tretina (1/3)
    { id: "tr-porada-kratka",        label: "Ďalšia porada s klientom kratšia ako jedna hodina",                       fraction: 1/3,  ref: "§ 14 ods. 4", allows_loss_of_time: true },
    { id: "tr-porada-protistr-kratka", label: "Ďalšia porada s protistranou kratšia ako jedna hodina",                 fraction: 1/3,  ref: "§ 14 ods. 4", allows_loss_of_time: true },
    // §14 ods. 5 — štvrtina (1/4)
    { id: "tr-navrh-oprava",         label: "Návrh na opravu odôvodnenia / na odstránenie následkov zmeškania lehoty", fraction: 0.25, ref: "§ 14 ods. 5" },
    { id: "tr-pojednavanie-vyhl-odr", label: "Obhajoba na pojednávaní len pre vyhlásenie rozhodnutia alebo odročenom bez prejednania veci", fraction: 0.25, ref: "§ 14 ods. 5", allows_loss_of_time: true, allows_travel: true }
  ],

  // Cestovné — §16 ods. 4 → zákon 283/2002 → opatrenia MPSVaR (osobné motorové vozidlá)
  cestovne_opatrenia: [
    { opatrenie: "143/2019 Z.z.", od: "2019-06-01", do: "2022-04-30", eur_per_km: 0.193 },
    { opatrenie: "117/2022 Z.z.", od: "2022-05-01", do: "2022-08-31", eur_per_km: 0.213 },
    { opatrenie: "282/2022 Z.z.", od: "2022-09-01", do: "2023-03-31", eur_per_km: 0.227 },
    { opatrenie: "88/2023 Z.z.",  od: "2023-04-01", do: "2023-06-30", eur_per_km: 0.239 },
    { opatrenie: "247/2023 Z.z.", od: "2023-07-01", do: "2024-04-30", eur_per_km: 0.252 },
    { opatrenie: "73/2024 Z.z.",  od: "2024-05-01", do: null,         eur_per_km: 0.265 }
  ],

  disclaimer: "Kalkulačka aplikuje vyhlášku 655/2004 Z.z. v aktuálnom účinnom znení (po novele 391/2023, účinné od 2024-01-01). Pre úkony vykonané pred týmto dátumom môže byť výpočet nepresný — staršie znenia vyhlášky obsahovali odlišné pravidlá (najmä § 13 multipliery a posun výpočtového základu). Pre úkony pred 2024-01-01 si výsledok overte manuálne podľa znenia účinného v čase úkonu. Pri trestnom konaní sa tarifná odmena počíta z výpočtového základu podľa § 1 ods. 4 (rok N-4), zatiaľ čo režijný paušál a náhrada za stratu času z výpočtového základu podľa § 1 ods. 3. Úpravu odmeny podľa § 13 (zvýšenie najviac o 50 %, zníženie za spoločné zastupovanie druhej a každej ďalšej osoby, spojenie vecí) kalkulačka aplikuje len na základe údajov, ktoré zadáte; posúdenie splnenia podmienok je na advokátovi. Osobitné tarifné hodnoty podľa § 10 ods. 2 až 7 (opakujúce sa plnenie, vyporiadanie BSM a podielového spoluvlastníctva, správa majetku) zadajte ako hodnotu sporu manuálne. Slúži ako pomôcka, nie ako právne stanovisko."
};
