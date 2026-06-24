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
  const date   = new Date(dateStr);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 28);
  return date >= cutoff;
}

function incr(obj, key) {
  obj[key] = (obj[key] || 0) + 1;
}

function getMonth(dateStr) {
  if (!dateStr) return 'Unbekannt';
  const d = new Date(dateStr);
  return isNaN(d) ? 'Unbekannt' : d.toISOString().slice(0, 7); // z.B. "2026-04"
}

function getPhiboxConnection(phibox_upload_status) {
  if (!Array.isArray(phibox_upload_status) || phibox_upload_status.length === 0) return 'Kein Status';
  return phibox_upload_status.map(s => s.connection || 'Unbekannt').join(', ');
}

function emptySection() {
  return {
    total: 0,
    byBundesland: {},
    byBundeslandAndGericht: {},
    byDoctype: {},
    byMonat: {},
    byPhiboxConnection: {},
    beschluesse: 0,
    urteile: 0,
    inPhibox: 0,
    nichtInPhibox: 0,
  };
}

async function main() {
  console.log('Starte Datenabruf...');

  const stats = {
    lastFourWeeks: emptySection(),
    gesamt: emptySection(),
    updatedAt: new Date().toISOString(),
  };

  const first = await fetchPage(0);
  const total = first.total;
  console.log(`Gesamt: ${total} Einträge`);

  const allIds = [...first.results.map(r => r.id)];
  for (let start = LIMIT; start < total; start += LIMIT) {
    console.log(`Lade IDs ${start}/${total}...`);
    const page = await fetchPage(start);
    allIds.push(...page.results.map(r => r.id));
  }

  stats.gesamt.total = total;

  console.log('Lade Detaildaten...');
  const batchSize = 10;

  for (let i = 0; i < allIds.length; i += batchSize) {
    const batch   = allIds.slice(i, i + batchSize);
    const details = await Promise.all(batch.map(id => fetchRaw(id).catch(() => null)));

    for (const doc of details) {
      if (!doc) continue;

      const bl       = doc.bundesland || 'Unbekannt';
      const gericht  = doc.gericht    || 'Unbekannt';
      const monat    = getMonth(doc.entscheidungsdatum_isodate);
      const doctypes = Array.isArray(doc.doctype) ? doc.doctype : (doc.doctype ? [doc.doctype] : ['Unbekannt']);
      const inPhibox = doc['phibox-upload'] === true;
      const phiboxConn = getPhiboxConnection(doc.phibox_upload_status);
      const isBeschl = doctypes.includes('beschluss');
      const isUrteil = doctypes.includes('urteil');

      // Gesamtbestand
      const g = stats.gesamt;
      incr(g.byBundesland, bl);
      incr(g.byMonat, monat);
      if (!g.byBundeslandAndGericht[bl]) g.byBundeslandAndGericht[bl] = {};
      incr(g.byBundeslandAndGericht[bl], gericht);
      doctypes.forEach(dt => incr(g.byDoctype, dt));
      incr(g.byPhiboxConnection, phiboxConn);
      if (isBeschl) g.beschluesse++;
      if (isUrteil) g.urteile++;
      if (inPhibox) g.inPhibox++; else g.nichtInPhibox++;

      // Letzte 4 Wochen
      if (isLastFourWeeks(doc.entscheidungsdatum_isodate)) {
        const lfw = stats.lastFourWeeks;
        lfw.total++;
        incr(lfw.byBundesland, bl);
        incr(lfw.byMonat, monat);
        if (!lfw.byBundeslandAndGericht[bl]) lfw.byBundeslandAndGericht[bl] = {};
        incr(lfw.byBundeslandAndGericht[bl], gericht);
        doctypes.forEach(dt => incr(lfw.byDoctype, dt));
        incr(lfw.byPhiboxConnection, phiboxConn);
        if (isBeschl) lfw.beschluesse++;
        if (isUrteil) lfw.urteile++;
        if (inPhibox) lfw.inPhibox++; else lfw.nichtInPhibox++;
      }
    }

    if (i % 1000 === 0) console.log(`Verarbeitet: ${i}/${allIds.length}`);
  }

  if (!fs.existsSync('data')) fs.mkdirSync('data');
  fs.writeFileSync('data/stats.json', JSON.stringify(stats, null, 2));
  console.log('Fertig!');
}

main().catch(console.error);
