const { TYPE_GROUPS, TYPE_LABELS, GROUP_LABELS } = require('../constants/scrap');

function buildTypeBreakdown(items) {
  const bd = {};
  for (const [group, types] of Object.entries(TYPE_GROUPS)) {
    bd[group] = { label: GROUP_LABELS[group], totalWeight: 0, subtypes: {} };
    for (const t of types) {
      bd[group].subtypes[t] = { label: TYPE_LABELS[t] || t, weight: 0 };
    }
  }

  for (const it of items) {
    const st = it.scrap_type || it.scrapType || '';
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
  let i = 0;
  while (body[`date_${i}`] !== undefined) {
    items.push({
      date: (body[`date_${i}`] || '').trim() || null,
      scrapArea: (body[`scrapArea_${i}`] || '').trim(),
      scrapType: (body[`scrapType_${i}`] || '').trim(),
      weight: parseFloat(body[`weight_${i}`]) || 0,
      bringer: (body[`bringer_${i}`] || '').trim(),
      weighingPhoto: fileMap[`weighingPhoto_${i}`] || null,
      ocrPhoto: fileMap[`ocrPhoto_${i}`] || null,
    });
    i += 1;
  }
  return items;
}

module.exports = {
  buildTypeBreakdown,
  rowToSub,
  parseItems,
};
