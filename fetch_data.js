const fs = require('fs');

const BASE_URL = 'https://super-mud-7afc.m-sander.workers.dev';
const PROFILE  = 'vdhh';
const LIMIT    = 1000;

async function fetchPage(start) {
  const res = await fetch(`${BASE_URL}/api/content/V1/content/${PROFILE}?limit=${LIMIT}&start=${start}`);
  return res.json();
}

async function fetchRaw(id) {
  const encoded = encodeURIComponent(id);
  const res = await fetch(`${BASE_URL}/api/content/V1/contentRaw/${encoded}/${PROFILE}`);
  return res.json();
}

function isLastFourWeeks(dateStr) {
  if (!dateStr) return false;
  const date  = new Date(dateStr);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 28);
  return date >= cutoff;
}

function extractCourt(verfahrensgang) {
  if (!verfahrensgang) return 'Unbekannt';
  const match = verfahrensgang.match(/(?:vorgehend|ArbG|LAG|LG|OLG|BGH|BAG|BVerwG|BSG|BFH|VG|OVG)\s+([A-ZÄÖÜa-zäöü\s\-]+),/);
  return match ? match[0].replace(/,.*/, '').trim() : 'Unbekannt';
}

async function main() {
  console.log('Starte Datenabruf...');

  // Gesamtbestand-Zähler
  const stats = {
    lastFourWeeks: {
      total: 0,
      byBundesland: {},
      beschluesse: 0,
      inPhibox: 0,
    },
    gesamt: {
      total: 0,
      byBundesland: {},
      beschluesse: 0,
      inPhibox: 0,
    },
    updatedAt: new Date().toISOString(),
  };

  // Erste Seite abrufen um total zu ermitteln
  const first = await fetchPage(0);
  const total = first.total;
  console.log(`Gesamt: ${total} Einträge`);

  // Alle IDs sammeln
  const allIds = [];
  allIds.push(...first.results.map(r => r.id));

  for (let start = LIMIT; start < total; start += LIMIT) {
    console.log(`Lade ${start}/${total}...`);
    const page = await fetchPage(start);
    allIds.push(...page.results.map(r => r.id));
  }

  stats.gesamt.total = total;

  // Für jeden Eintrag contentRaw abrufen
  console.log('Lade Detaildaten...');
  const batchSize = 10;
  for (let i = 0; i < allIds.length; i += batchSize) {
    const batch = allIds.slice(i, i + batchSize);
    const details = await Promise.all(batch.map(id => fetchRaw(id).catch(() => null)));

    for (const doc of details) {
      if (!doc) continue;

      const bl       = doc.bundesland || 'Unbekannt';
      const isBeschl = Array.isArray(doc.doctype) && doc.doctype.includes('beschluss');
      const inPhibox = doc['phibox-upload'] === true;

      // Gesamtbestand
      stats.gesamt.byBundesland[bl] = (stats.gesamt.byBundesland[bl] || 0) + 1;
      if (isBeschl) stats.gesamt.beschluesse++;
      if (inPhibox) stats.gesamt.inPhibox++;

      // Letzte 4 Wochen
      if (isLastFourWeeks(doc.entscheidungsdatum_isodate)) {
        stats.lastFourWeeks.total++;
        stats.lastFourWeeks.byBundesland[bl] = (stats.lastFourWeeks.byBundesland[bl] || 0) + 1;
        if (isBeschl) stats.lastFourWeeks.beschluesse++;
        if (inPhibox) stats.lastFourWeeks.inPhibox++;
      }
    }

    if (i % 1000 === 0) console.log(`Verarbeitet: ${i}/${allIds.length}`);
  }

  // Speichern
  if (!fs.existsSync('data')) fs.mkdirSync('data');
  fs.writeFileSync('data/stats.json', JSON.stringify(stats, null, 2));
  console.log('Fertig! data/stats.json gespeichert.');
}

main().catch(console.error);
