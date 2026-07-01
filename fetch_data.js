const fs = require('fs');

const PROXY   = 'https://super-mud-7afc.m-sander.workers.dev';
const PROFILE = 'vdhh';
const API     = `${PROXY}/api/query/V1/${PROFILE}`;

async function query(pipeline) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'Accept': '*/*' },
    body: pipeline,
  });
  return res.json();
}

async function main() {
  console.log('Starte Datenabruf via Query-API...');

  // ── Gesamtanzahl ──────────────────────────────────────────────────────────
  const [totalResult] = await query(`aggregate([{ $count: "total" }])`);
  const total = totalResult?.total || 0;
  console.log(`Gesamt: ${total}`);

  // ── Nach Bundesland ───────────────────────────────────────────────────────
  const byBundesland = await query(`aggregate([
    { $group: { _id: "$bundesland", anzahl: { $sum: 1 } } },
    { $sort: { anzahl: -1 } }
  ])`);

  // ── Nach Doctype ──────────────────────────────────────────────────────────
  const byDoctype = await query(`aggregate([
    { $unwind: "$doctype" },
    { $group: { _id: "$doctype", anzahl: { $sum: 1 } } },
    { $sort: { anzahl: -1 } }
  ])`);

  // ── Phibox ────────────────────────────────────────────────────────────────
  const phiboxResult = await query(`aggregate([
    { $group: { _id: "$phibox-upload", anzahl: { $sum: 1 } } }
  ])`);

  // ── Summary3 leer oder nicht (nach Bundesland) ────────────────────────────
  const summary3Result = await query(`aggregate([
    { $group: {
        _id: "$bundesland",
        mitSummary3:   { $sum: { $cond: [{ $gt: [{ $strLenBytes: { $ifNull: ["$summary_3", ""] } }, 0] }, 1, 0] } },
        ohneSummary3:  { $sum: { $cond: [{ $eq: [{ $strLenBytes: { $ifNull: ["$summary_3", ""] } }, 0] }, 1, 0] } }
    }},
    { $sort: { _id: 1 } }
  ])`);

  // ── PRE / POST proceedings nach Bundesland ────────────────────────────────
  const proceedingsResult = await query(`aggregate([
    { $unwind: { path: "$proceedings-sequence", preserveNullAndEmptyArrays: true } },
    { $group: {
        _id: "$bundesland",
        pre:  { $sum: { $cond: [{ $eq: ["$proceedings-sequence.order", "PRE"]  }, 1, 0] } },
        post: { $sum: { $cond: [{ $eq: ["$proceedings-sequence.order", "POST"] }, 1, 0] } }
    }},
    { $sort: { _id: 1 } }
  ])`);

  // ── Letzte 4 Wochen nach Bundesland (crawl_date) ──────────────────────────
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 28);
  const cutoffStr = cutoff.toISOString();

  const lastFourWeeksBL = await query(`aggregate([
    { $match: { crawl_date_isodate: { $gte: { $date: "${cutoffStr}" } } } },
    { $group: { _id: "$bundesland", anzahl: { $sum: 1 } } },
    { $sort: { anzahl: -1 } }
  ])`);

  const lastFourWeeksDoctype = await query(`aggregate([
    { $match: { crawl_date_isodate: { $gte: { $date: "${cutoffStr}" } } } },
    { $unwind: "$doctype" },
    { $group: { _id: "$doctype", anzahl: { $sum: 1 } } },
    { $sort: { anzahl: -1 } }
  ])`);

  const lastFourWeeksTotal = await query(`aggregate([
    { $match: { crawl_date_isodate: { $gte: { $date: "${cutoffStr}" } } } },
    { $count: "total" }
  ])`);

  // ── Gerichte nach Bundesland ──────────────────────────────────────────────
  const gerichteResult = await query(`aggregate([
    { $group: {
        _id: { bundesland: "$bundesland", gericht: "$gericht" },
        gesamt:     { $sum: 1 },
        urteile:    { $sum: { $cond: [{ $in: ["urteil",    { $ifNull: ["$doctype", []] }] }, 1, 0] } },
        beschluesse:{ $sum: { $cond: [{ $in: ["beschluss", { $ifNull: ["$doctype", []] }] }, 1, 0] } }
    }},
    { $sort: { "_id.bundesland": 1, gesamt: -1 } }
  ])`);

  // ── Zusammenführen ────────────────────────────────────────────────────────
  const blMap = {};
  for (const r of byBundesland)      blMap[r._id] = { name: r._id || 'Unbekannt', anzahl: r.anzahl };
  
  const summary3Map = {};
  for (const r of summary3Result)    summary3Map[r._id || 'Unbekannt'] = { mitSummary3: r.mitSummary3, ohneSummary3: r.ohneSummary3 };

  const procMap = {};
  for (const r of proceedingsResult) procMap[r._id || 'Unbekannt'] = { pre: r.pre, post: r.post };

  const gerichteMap = {};
  for (const r of gerichteResult) {
    const bl = r._id.bundesland || 'Unbekannt';
    const g  = r._id.gericht    || 'Unbekannt';
    if (!gerichteMap[bl]) gerichteMap[bl] = [];
    gerichteMap[bl].push({ name: g, gesamt: r.gesamt, urteile: r.urteile, beschluesse: r.beschluesse });
  }

  const byBundeslandDetail = Object.keys(blMap).map(bl => ({
    bundesland:   bl,
    anzahl:       blMap[bl]?.anzahl       || 0,
    mitSummary3:  summary3Map[bl]?.mitSummary3  || 0,
    ohneSummary3: summary3Map[bl]?.ohneSummary3 || 0,
    pre:          procMap[bl]?.pre         || 0,
    post:         procMap[bl]?.post        || 0,
  }));

  const stats = {
    gesamt: {
      total,
      byBundesland:       byBundesland.map(r => ({ name: r._id || 'Unbekannt', anzahl: r.anzahl })),
      byDoctype:          byDoctype.map(r => ({ name: r._id || 'Unbekannt', anzahl: r.anzahl })),
      byPhibox:           phiboxResult.map(r => ({ name: r._id === true ? 'In Phibox' : r._id === false ? 'Nicht in Phibox' : 'Unbekannt', anzahl: r.anzahl })),
      byBundeslandDetail,
      byBundeslandAndGericht: Object.entries(gerichteMap).map(([bundesland, gerichte]) => ({ bundesland, gerichte })),
    },
    lastFourWeeks: {
      total:       lastFourWeeksTotal[0]?.total || 0,
      byBundesland: lastFourWeeksBL.map(r => ({ name: r._id || 'Unbekannt', anzahl: r.anzahl })),
      byDoctype:    lastFourWeeksDoctype.map(r => ({ name: r._id || 'Unbekannt', anzahl: r.anzahl })),
    },
    updatedAt: new Date().toISOString(),
  };

  if (!fs.existsSync('data')) fs.mkdirSync('data');
  fs.writeFileSync('data/stats.json', JSON.stringify(stats, null, 2));
  console.log('Fertig!');
}

main().catch(console.error);
