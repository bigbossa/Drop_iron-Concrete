const { TYPE_GROUPS, TYPE_LABELS, GROUP_LABELS } = require('../constants/scrap');

const TYPE_KEY_BY_LABEL = Object.fromEntries(
  Object.entries(TYPE_LABELS).map(([k, v]) => [String(v || '').trim(), k])
);

function normalizeTypeKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (Object.prototype.hasOwnProperty.call(TYPE_LABELS, raw)) return raw;
  return TYPE_KEY_BY_LABEL[raw] || raw;
}

function buildTypeBreakdown(items) {
  const bd = {};
  for (const [group, types] of Object.entries(TYPE_GROUPS)) {
    bd[group] = { label: GROUP_LABELS[group], totalWeight: 0, subtypes: {} };
    for (const t of types) {
      bd[group].subtypes[t] = { label: TYPE_LABELS[t] || t, weight: 0 };
    }
  }

  for (const it of items) {
    const st = normalizeTypeKey(it.scrap_type || it.scrapType || '');
    const w = parseFloat(it.weight) || 0;
    for (const [group, types] of Object.entries(TYPE_GROUPS)) {
      if (types.includes(st)) {
        bd[group].totalWeight += w;
        bd[group].subtypes[st].weight += w;
      }
    }
  }

  return bd;
}

function rowToSub(row, items = []) {
  const mappedItems = items.map((it) => ({
    date: it.date ? it.date.toISOString().split('T')[0] : null,
    scrapArea: it.scrap_area,
    scrapType: it.scrap_type,
    weight: parseFloat(it.weight) || 0,
    bringer: it.bringer,
    weighingPhoto: it.weighing_photo,
    ocrPhoto: it.ocr_photo,
  }));

  return {
    id: row.id,
    branch: row.branch,
    collectorName: row.collector_name,
    department: row.department,
    position: row.position,
    status: row.status,
    submittedAt: row.submitted_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    rejectionReason: row.rejection_reason,
    disposalLocation: row.disposal_location,
    disposalPhoto: row.disposal_photo,
    disposalSubmittedAt: row.disposal_submitted_at,
    items: mappedItems,
    typeBreakdown: buildTypeBreakdown(items),
  };
}

function parseItems(body, fileMap) {
  const items = [];
  const indexSet = new Set();

  Object.keys(body || {}).forEach((k) => {
    const m = k.match(/^(date|scrapArea|scrapType|weight|bringer)_(\d+)$/);
    if (m) indexSet.add(Number(m[2]));
  });
  Object.keys(fileMap || {}).forEach((k) => {
    const m = k.match(/^(weighingPhoto|ocrPhoto)_(\d+)$/);
    if (m) indexSet.add(Number(m[2]));
  });

  const indices = Array.from(indexSet).sort((a, b) => a - b);
  for (const i of indices) {
    const date = (body[`date_${i}`] || '').trim() || null;
    const scrapArea = (body[`scrapArea_${i}`] || '').trim();
    const scrapType = normalizeTypeKey((body[`scrapType_${i}`] || '').trim());
    const weight = parseFloat(body[`weight_${i}`]) || 0;
    const bringer = (body[`bringer_${i}`] || '').trim();
    const weighingPhoto = fileMap[`weighingPhoto_${i}`] || null;
    const ocrPhoto = fileMap[`ocrPhoto_${i}`] || null;

    // Ignore placeholder rows that have no meaningful data.
    if (!date && !scrapArea && !scrapType && !weight && !bringer && !weighingPhoto && !ocrPhoto) {
      continue;
    }

    items.push({
      date,
      scrapArea,
      scrapType,
      weight,
      bringer,
      weighingPhoto,
      ocrPhoto,
    });
  }

  return items;
}

module.exports = {
  buildTypeBreakdown,
  rowToSub,
  parseItems,
};
