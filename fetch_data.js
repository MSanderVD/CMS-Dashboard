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
  return isNaN(d) ? 'Unbekannt' : d.toISOString().slice(0, 7);
}

function getPhiboxConnection(phibox_upload_status) {
  if (!Array.isArray(phibox_upload_status) || phibox_upload_status.length === 0) return 'Kein Status';
  return phibox_upload_status.map(s => s.connection || 'Unbekannt').join(', ');
}

function emptyBLDetail() {
  return {
    gesamt: 0,
    urteile: 0,
    beschluesse: 0,
    inPhibox: 0,
    mitSummary3: 0,
    ohneSummary3: 0,
    pre: 0,
    post: 0,
  };
}

function emptySection() {
  return {
    total: 0,
    byBundesland: {},
    byBundeslandAndGericht: {},
    byBundeslandDetail: {},
    byDoctype: {},
    byMonat: {},
    byPhiboxConnection: {},
    beschluesse: 0,
    urteile: 0,
    inPhibox: 0,
    nichtInPhibox: 0,
  };
}

function finalizeSection(raw) {
  return {
    total: raw.total,
    beschluesse: raw.beschluesse,
    urteile: raw.urteile,
    inPhibox: raw.inPhibox,
    nichtInPhibox: raw.nichtInPhibox,
    byBundesland: Object.entries(raw.byBundesland).map(([name, anzahl]) => ({ name, anzahl })),
    byDoctype: Object.entries(raw.byDoctype).map(([name, anzahl]) => ({ name, anzahl })),
    byMonat: Object.entries(raw.byMonat).map(([name, anzahl]) => ({ name, anzahl })),
    byPhiboxConnection: Object.entries(raw.byPhiboxConnection).map(([name, anzahl]) => ({ name, anzahl })),
    byBundeslandDetail: Object.entries(raw.byBundeslandDetail).map(([bundesland, d]) => ({ bundesland, ...d })),
    byBundeslandAndGericht: Object.entries(raw.byBundeslandAndGericht).map(([bundesland, gerichte]) => ({
      bundesland,
      gerichte: Object.entries(gerichte).map(([name, counts]) => ({ name, ...counts }))
    })),
  };
}

async function main() {
  console.log('Starte Datenabruf...');

  const raw = { lastFourWeeks: emptySection(), gesamt: emptySection() };

  const first = await fetchPage(0);
  const total = first.total;
  console.log(`Gesamt: ${total} Einträge`);

  const allIds = [...first.results.map(r => r.id)];
  for (let start = LIMIT; start < total; start += LIMIT) {
    console.log(`Lade IDs ${start}/${total}...`);
    const page = await fetchPage(start);
    allIds.push(...page.results.map(r => r.id));
  }

  raw.gesamt.total = total;

  console.log('Lade Detaildaten...');
  const batchSize = 10;

  for (let i = 0; i < allIds.length; i += batchSize) {
    const batch   = allIds.slice(i, i + batchSize);
    const details = await Promise.all(batch.map(id => fetchRaw(id).catch(() => null)));

    for (const doc of details) {
      if (!doc) continue;

      const bl         = doc.bundesland || 'Unbekannt';
      const gericht    = doc.gericht    || 'Unbekannt';
      const monat      = getMonth(doc.entscheidungsdatum_isodate);
      const doctypes   = Array.isArray(doc.doctype) ? doc.doctype : (doc.doctype ? [doc.doctype] : ['Unbekannt']);
      const inPhibox   = doc['phibox-upload'] === true;
      const phiboxConn = getPhiboxConnection(doc.phibox_upload_status);
      const isBeschl   = doctypes.includes('beschluss');
      const isUrteil   = doctypes.includes('urteil');
      const hasSummary = !!(doc.summary_3 && doc.summary_3.trim && doc.summary_3.trim().length > 0);

      // PRE/POST aus proceedings-sequence
      const proceedings = Array.isArray(doc['proceedings-sequence']) ? doc['proceedings-sequence'] : [];
      const preCount    = proceedings.filter(p => p.order === 'PRE').length;
      const postCount   = proceedings.filter(p => p.order === 'POST').length;

      // ── Gesamtbestand ──
      const g = raw.gesamt;
      incr(g.byBundesland, bl);
      incr(g.byMonat, monat);
      doctypes.forEach(dt => incr(g.byDoctype, dt));
      incr(g.byPhiboxConnection, phiboxConn);
      if (isBeschl) g.beschluesse++;
      if (isUrteil) g.urteile++;
      if (inPhibox) g.inPhibox++; else g.nichtInPhibox++;

      // byBundeslandDetail
      if (!g.byBundeslandDetail[bl]) g.byBundeslandDetail[bl] = emptyBLDetail();
      g.byBundeslandDetail[bl].gesamt++;
      if (isUrteil)   g.byBundeslandDetail[bl].urteile++;
      if (isBeschl)   g.byBundeslandDetail[bl].beschluesse++;
      if (inPhibox)   g.byBundeslandDetail[bl].inPhibox++;
      if (hasSummary) g.byBundeslandDetail[bl].mitSummary3++;
      else            g.byBundeslandDetail[bl].ohneSummary3++;
      g.byBundeslandDetail[bl].pre  += preCount;
      g.byBundeslandDetail[bl].post += postCount;

      // byBundeslandAndGericht
      if (!g.byBundeslandAndGericht[bl]) g.byBundeslandAndGericht[bl] = {};
      if (!g.byBundeslandAndGericht[bl][gericht]) g.byBundeslandAndGericht[bl][gericht] = { gesamt: 0, urteile: 0, beschluesse: 0 };
      g.byBundeslandAndGericht[bl][gericht].gesamt++;
      if (isUrteil) g.byBundeslandAndGericht[bl][gericht].urteile++;
      if (isBeschl) g.byBundeslandAndGericht[bl][gericht].beschluesse++;

      // ── Letzte 4 Wochen ──
      if (isLastFourWeeks(doc.crawl_date_isodate)) {
        const lfw = raw.lastFourWeeks;
        lfw.total++;
        incr(lfw.byBundesland, bl);
        incr(lfw.byMonat, monat);
        doctypes.forEach(dt => incr(lfw.byDoctype, dt));
        incr(lfw.byPhiboxConnection, phiboxConn);
        if (isBeschl) lfw.beschluesse++;
        if (isUrteil) lfw.urteile++;
        if (inPhibox) lfw.inPhibox++; else lfw.nichtInPhibox++;

        if (!lfw.byBundeslandDetail[bl]) lfw.byBundeslandDetail[bl] = emptyBLDetail();
        lfw.byBundeslandDetail[bl].gesamt++;
        if (isUrteil)   lfw.byBundeslandDetail[bl].urteile++;
        if (isBeschl)   lfw.byBundeslandDetail[bl].beschluesse++;
        if (inPhibox)   lfw.byBundeslandDetail[bl].inPhibox++;
        if (hasSummary) lfw.byBundeslandDetail[bl].mitSummary3++;
        else            lfw.byBundeslandDetail[bl].ohneSummary3++;
        lfw.byBundeslandDetail[bl].pre  += preCount;
        lfw.byBundeslandDetail[bl].post += postCount;

        if (!lfw.byBundeslandAndGericht[bl]) lfw.byBundeslandAndGericht[bl] = {};
        if (!lfw.byBundeslandAndGericht[bl][gericht]) lfw.byBundeslandAndGericht[bl][gericht] = { gesamt: 0, urteile: 0, beschluesse: 0 };
        lfw.byBundeslandAndGericht[bl][gericht].gesamt++;
        if (isUrteil) lfw.byBundeslandAndGericht[bl][gericht].urteile++;
        if (isBeschl) lfw.byBundeslandAndGericht[bl][gericht].beschluesse++;
      }
    }

    if (i % 1000 === 0) console.log(`Verarbeitet: ${i}/${allIds.length}`);
  }

  const stats = {
    lastFourWeeks: finalizeSection(raw.lastFourWeeks),
    gesamt: finalizeSection(raw.gesamt),
    updatedAt: new Date().toISOString(),
  };

  if (!fs.existsSync('data')) fs.mkdirSync('data');
  fs.writeFileSync('data/stats.json', JSON.stringify(stats, null, 2));
  console.log('Fertig!');
}

main().catch(console.error);
