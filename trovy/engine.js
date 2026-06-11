// engine.js — výpočtový engine kalkulačky trov
// Špecifikácia: ../kalk-trovy-m1-plan.md v2, sekcia 7
// Implementácia M1: civil-value (§10) a civil-nonvalue (§11 ods. 1), bez §13 multiplierov.

import { TARIFF } from './tariff.js';

const P = TARIFF.parameters;

// ---------- Pomocné funkcie ----------

function rokZDatumu(iso) {
  if (!iso || typeof iso !== 'string' || iso.length < 4) {
    throw new Error('Neplatný dátum: ' + iso);
  }
  return parseInt(iso.slice(0, 4), 10);
}

// Výpočtový základ pre TARIFNÚ ODMENU úkonu. Civilné konania: vz_posun 0 → tabuľka[rok].
// Trestné konanie: vz_posun -3 (§1 ods. 4 → mzda za 1. polrok roku N-4 = kľúč N-3 v tabuľke).
export function vzPreUkon(rokUkonu, konanieType) {
  const konanie = TARIFF.konania[konanieType];
  if (!konanie) throw new Error('Neznámy typ konania: ' + konanieType);
  const rokVZ = rokUkonu + konanie.vz_posun;
  const vz = TARIFF.vypoctovy_zaklad_eur[String(rokVZ)];
  if (vz == null) return null;
  return vz;
}

// Výpočtový základ pre NÁHRADY — režijný paušál (§16 ods. 3) a stratu času (§17 ods. 1).
// Vždy civilný/všeobecný VZ podľa §1 ods. 3 (tabuľka[rok použitia]), aj v trestnej veci:
// §1 ods. 4 (trestný VZ) sa vzťahuje výslovne len na tarifnú odmenu, nie na náhrady.
export function vzNahradova(rokUkonu) {
  const vz = TARIFF.vypoctovy_zaklad_eur[String(rokUkonu)];
  return vz == null ? null : vz;
}

// §12 — základná sadzba tarifnej odmeny v trestnom konaní / konaní o priestupkoch.
// Zlomok (1/12, 1/8, 1/6, 1/24) sa aplikuje na trestný výpočtový základ.
export function sadzbaTrestna(vzTarifna, zlomok) {
  if (vzTarifna == null) throw new Error('Chýba trestný výpočtový základ');
  if (!zlomok || zlomok <= 0) throw new Error('Neplatná trestná sadzba (§ 12): ' + zlomok);
  return round(vzTarifna * zlomok);
}

// Nájde definíciu úkonu naprieč civilným (§13a) aj trestným (§14) zoznamom.
export function najdiUkon(id) {
  return TARIFF.ukony.find(x => x.id === id)
    || (TARIFF.ukony_trestne || []).find(x => x.id === id)
    || null;
}

// Rozlíši zlomok §12 podľa zvoleného id sadzby (caseState.trestnaSadzbaId).
function trestnyZlomok(trestnaSadzbaId) {
  const s = (TARIFF.trestne_sadzby || []).find(x => x.id === trestnaSadzbaId);
  return s ? s.zlomok : null;
}

// ---------- §10 hodnotová tarifa ----------

export function sadzbaHodnotova(hodnotaSporu) {
  if (hodnotaSporu == null || hodnotaSporu < 0) {
    throw new Error('Neplatná hodnota sporu: ' + hodnotaSporu);
  }
  for (const p of TARIFF.hodnotova_tabulka) {
    // Hraničná hodnota patrí do vyššieho pásma. Špeciálne: 0 do pásma a.
    // Pre korektnosť b/c hranice: 663,88 € patrí ešte do pásma b (test tc-edge-pasma-bc),
    // takže používame `hodnotaSporu <= p.to` pre horný okraj okrem Infinity.
    const inBand = (hodnotaSporu >= p.from) &&
      (p.to === Infinity ? true : hodnotaSporu <= p.to);
    if (inBand) {
      if (p.flat != null) return p.flat;
      const krokov = Math.ceil((hodnotaSporu - p.over) / p.step_size);
      const surovaSadzba = p.base + krokov * p.step_eur;
      return round(surovaSadzba);
    }
  }
  throw new Error('Hodnota mimo §10 tabuľky: ' + hodnotaSporu);
}

// ---------- §11 nehodnotová ----------
// zlomok = zlomok výpočtového základu podľa typu konania:
//   §11 ods. 1 (1/13), §11 ods. 3 Ústavný (1/4), §11 ods. 4 správne (1/6) / sociálne (1/13).
// Ak zlomok nie je zadaný, použije sa default §11 ods. 1 (1/13).
export function sadzbaNehodnotova(vz, zlomok) {
  const z = (zlomok != null) ? zlomok : P.nehodnotova_zlomok;
  return round(vz * z);
}

// Nájde definíciu trestnej sadzby (§12) podľa id.
export function najdiTrestnuSadzbu(id) {
  return (TARIFF.trestne_sadzby || []).find(x => x.id === id) || null;
}

// ---------- Cestovné lookup ----------

export function sadzbaCestovneEurPerKm(datumIso) {
  for (const o of TARIFF.cestovne_opatrenia) {
    const okOd = datumIso >= o.od;
    const okDo = (o.do == null) || (datumIso <= o.do);
    if (okOd && okDo) return o.eur_per_km;
  }
  return null;
}

// ---------- Hlavný výpočet ----------

export function vypocitajTrovy(caseState) {
  let tarifna = 0, pausal = 0, strata = 0, cestovne = 0, phm = 0;
  const polozky = [];
  const warnings = [];

  if (!caseState || !Array.isArray(caseState.ukony)) {
    throw new Error('caseState.ukony chýba alebo nie je pole');
  }

  const konanie = TARIFF.konania[caseState.konanieType];
  if (!konanie) throw new Error('Neznámy typ konania: ' + caseState.konanieType);

  // §12 ods. 7 — opatrovník na ochranu práv poškodeného: osobitný režim (odmena je paušál za
  // celé konanie; per-úkon tarifná odmena ani režijný paušál sa neúčtujú, náhrady áno).
  const trestnaSadzba = (caseState.konanieType === 'criminal')
    ? najdiTrestnuSadzbu(caseState.trestnaSadzbaId) : null;
  const jeOpatrovnik = !!(trestnaSadzba && trestnaSadzba.pausal_eur != null);

  // §13 ods. 2 — zníženie o 50 % za druhú a každú ďalšiu spoločne zastupovanú osobu.
  const pocetOsob = Math.max(1, Math.floor(caseState.pocetOsob || 1));
  const multOsob = jeOpatrovnik ? 1 : (1 + P.spolu_osoba_znizenie * (pocetOsob - 1));

  // §13 ods. 1/5 — diskrečné zníženie/zvýšenie základnej sadzby (najviac ±50 %).
  let upravaPct = caseState.upravaSadzbyPct || 0;
  if (upravaPct > P.uprava_sadzby_max_pct) upravaPct = P.uprava_sadzby_max_pct;
  if (upravaPct < -P.uprava_sadzby_max_pct) upravaPct = -P.uprava_sadzby_max_pct;
  const multUprava = jeOpatrovnik ? 1 : (1 + upravaPct / 100);

  // §13 ods. 3 — spojenie vecí: k základnej sadzbe sa pripočíta 1/3 základnej sadzby každej
  // ďalšej spojenej veci. Podporované pre hodnotové spory (§10); pri inom type sa ignoruje.
  let prirastokSpojenie = 0;
  if (caseState.konanieType === 'civil-value' && Array.isArray(caseState.spojeneVeci)) {
    for (const v of caseState.spojeneVeci) {
      const h = (v && v.hodnota != null) ? v.hodnota : null;
      if (h != null && h > 0) prirastokSpojenie += sadzbaHodnotova(h) * P.spojenie_veci_zlomok;
    }
  }
  prirastokSpojenie = round(prirastokSpojenie);

  let poslednyRok = null;

  for (const u of caseState.ukony) {
    const ukonDef = najdiUkon(u.id);
    if (!ukonDef) {
      warnings.push('Neznámy úkon: ' + u.id);
      continue;
    }
    const rok = rokZDatumu(u.datum);
    poslednyRok = rok;

    // Dva výpočtové základy:
    //   vzTarifna — pre tarifnú odmenu (trestné §1 ods. 4 → rok N-4; civilné §1 ods. 3 → rok N-1)
    //   vzNahr    — pre režijný paušál (§16 ods. 3) a stratu času (§17), vždy §1 ods. 3 (rok N-1)
    const vzTarifna = vzPreUkon(rok, caseState.konanieType);
    if (vzTarifna == null) {
      throw new Error('Výpočtový základ pre tarifnú odmenu neexistuje pre rok ' + rok
        + ' (konanie ' + caseState.konanieType + ')');
    }
    const vzNahr = vzNahradova(rok);
    if (vzNahr == null) {
      throw new Error('Výpočtový základ pre náhrady neexistuje pre rok ' + rok);
    }

    // Základná sadzba tarifnej odmeny za úkon podľa typu konania.
    let zakladnaSadzba;
    if (jeOpatrovnik) {
      zakladnaSadzba = 0;   // §12 ods. 7 — odmena je paušál za celé konanie (pripočíta sa po cykle)
    } else if (caseState.konanieType === 'civil-value') {
      zakladnaSadzba = sadzbaHodnotova(caseState.hodnotaSporu);
    } else if (konanie.tarifna_zlomok != null) {
      // §11 ods. 1/3/4 — nehodnotové konania (1/13 ods.1 a sociálne, 1/4 Ústavný, 1/6 správne).
      zakladnaSadzba = sadzbaNehodnotova(vzTarifna, konanie.tarifna_zlomok);
    } else if (caseState.konanieType === 'criminal') {
      if (!trestnaSadzba || trestnaSadzba.zlomok == null) {
        throw new Error('Nezvolená sadzba § 12 (trestnaSadzbaId): ' + caseState.trestnaSadzbaId);
      }
      zakladnaSadzba = sadzbaTrestna(vzTarifna, trestnaSadzba.zlomok);
    } else {
      throw new Error('Typ konania nie je implementovaný: ' + caseState.konanieType);
    }

    // §13 — efektívna základná sadzba: (základ + spojenie vecí) × osoby × diskrečná úprava.
    const efektivnaZaklad = (zakladnaSadzba + prirastokSpojenie) * multOsob * multUprava;
    const sadzbaUkonu = round(efektivnaZaklad * ukonDef.fraction);
    tarifna += sadzbaUkonu;

    // §16 ods. 3 — režijný paušál: 1/100 VZ (§1 ods. 3) za každý úkon.
    // Pri režime opatrovníka (§12 ods. 7) sa réžia za úkon neúčtuje.
    const ukonPausal = jeOpatrovnik ? 0 : round(vzNahr * P.rezijny_pausal_zlomok);
    pausal += ukonPausal;

    // §17 ods. 1 — strata času: 1/60 VZ (§1 ods. 3) za začatú polhodinu (úkony mimo sídla advokáta)
    let ukonStrata = 0;
    if (u.lossOfTimeHalfHours && u.lossOfTimeHalfHours > 0) {
      ukonStrata = round(u.lossOfTimeHalfHours * vzNahr * P.strata_casu_zlomok);
      strata += ukonStrata;
    }

    // §16 ods. 4 — cestovné
    let ukonCestovne = 0;
    let cestovneSadzba = null;
    if (u.travelKm && u.travelKm > 0) {
      cestovneSadzba = sadzbaCestovneEurPerKm(u.datum);
      if (cestovneSadzba == null) {
        warnings.push(
          'Cestovné pre úkon ' + u.datum + ': dátum mimo známeho rozsahu opatrení MPSVaR '
          + '(od 2019-06-01). Cestovné nezahrnuté do výpočtu.'
        );
      } else {
        ukonCestovne = round(u.travelKm * cestovneSadzba);
        cestovne += ukonCestovne;
      }
    }

    // §16 ods. 4 / zákon 283/2002 — náhrada za spotrebované PHM.
    // Sumu predpočítava UI (spotreba l/100 km × km × cena €/l) a posiela ako u.phmEur.
    const ukonPhm = round(u.phmEur || 0);
    phm += ukonPhm;

    polozky.push({
      ukon: ukonDef.label,
      ukon_id: ukonDef.id,
      ukon_ref: ukonDef.ref || null,
      datum: u.datum,
      fraction: ukonDef.fraction,
      vz_rok: rok + konanie.vz_posun,
      vz_eur: vzTarifna,
      vz_nahr_rok: rok,
      vz_nahr_eur: vzNahr,
      sadzba_zakladna: round(zakladnaSadzba),
      sadzba_ukonu: sadzbaUkonu,
      pausal: ukonPausal,
      strata: ukonStrata,
      lossOfTimeHalfHours: u.lossOfTimeHalfHours || 0,
      travelKm: u.travelKm || 0,
      cestovne: ukonCestovne,
      cestovne_eur_per_km: cestovneSadzba,
      phm: ukonPhm
    });
  }

  // §12 ods. 7 — paušál opatrovníka za celé konanie (200 €; 50 % = 100 €, ak nezastupoval
  // ako opatrovník do právoplatného skončenia veci).
  let opatrovnik = 0;
  if (jeOpatrovnik) {
    opatrovnik = round(trestnaSadzba.pausal_eur * (caseState.opatrovnikNedotiahol ? 0.5 : 1));
    tarifna += opatrovnik;
  }

  // §14 ods. 7 — schválená dohoda o vine a treste pred podaním obžaloby: obhajcovi navyše
  // odmena vo výške štvornásobku základnej sadzby tarifnej odmeny (§ 12 sadzba × 4).
  let dohodaVT = 0;
  if (caseState.konanieType === 'criminal' && caseState.dohodaVT
      && trestnaSadzba && trestnaSadzba.zlomok != null) {
    const rokD = caseState.dohodaVTDatum ? rokZDatumu(caseState.dohodaVTDatum) : poslednyRok;
    const vzD = (rokD != null) ? vzPreUkon(rokD, 'criminal') : null;
    if (vzD != null) {
      dohodaVT = round(sadzbaTrestna(vzD, trestnaSadzba.zlomok) * P.dohoda_vt_nasobok);
      tarifna += dohodaVT;
    } else {
      warnings.push('Dohoda o vine a treste (§ 14 ods. 7): chýba rok na určenie výpočtového '
        + 'základu (pridajte aspoň jeden úkon alebo dátum dohody) — príplatok nezahrnutý.');
    }
  }

  // §15 písm. a) — iné preukázané hotové výdavky. Vstupujú do základu DPH: DPH advokáta
  // (ak je platiteľom) sa pripočítava k celej fakturovanej sume vrátane týchto výdavkov,
  // aj keď samy už DPH obsahovali (napr. cena PHM, súdny poplatok).
  const hotove = round(caseState.hotoveVydavky || 0);

  // „Položky spolu bez DPH" — základ pre výpočet DPH (vrátane hotových výdavkov).
  const polozkySpolu = round(tarifna + pausal + strata + cestovne + phm + hotove);

  // §18 ods. 3 — DPH sa pripočíta len ak je advokát platiteľom DPH (default: áno).
  const platcaDph = caseState.platcaDph !== false;
  const dph = platcaDph ? round(polozkySpolu * P.vat_rate) : 0;
  const total = round(polozkySpolu + dph);

  return {
    polozky,
    warnings,
    breakdown: {
      tarifna: round(tarifna),
      pausal: round(pausal),
      strata: round(strata),
      cestovne: round(cestovne),
      phm: round(phm),
      hotove,
      polozkySpolu,
      dph,
      platcaDph,
      // §13 + osobitné odmeny — metadáta pre UI / odôvodnenie:
      pocetOsob,
      multOsob: round(multOsob),
      upravaPct,
      prirastokSpojenie,
      opatrovnik: round(opatrovnik),
      dohodaVT: round(dohodaVT)
    },
    total
  };
}

// ---------- Internal ----------

function round(x) {
  return Math.round(x * 100) / 100;
}
