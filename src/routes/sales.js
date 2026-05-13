const { v4: uuidv4 } = require('uuid');
const express = require('express');
const { requireLogin, requireRole } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const { TYPE_GROUPS, GROUP_LABELS } = require('../constants/scrap');
const { sendServerError } = require('../utils/responses');

const router = express.Router();

function resolveTypeGroup(scrapType) {
  if (!scrapType) return null;
  if (TYPE_GROUPS[scrapType]) return scrapType;
  for (const [group, types] of Object.entries(TYPE_GROUPS)) {
    if (types.includes(scrapType)) return group;
  }
  return null;
}

function emptyWeightByGroup() {
  const out = {};
  Object.keys(TYPE_GROUPS).forEach((k) => { out[k] = 0; });
  return out;
}

function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

async function loadSaleAvailabilityByGroup(pool, branch) {
  const inRes = await pool.query(
    `SELECT si.scrap_type, COALESCE(SUM(si.weight),0) AS w
     FROM submission_items si
     JOIN submissions s ON s.id = si.submission_id
     WHERE s.status='completed' AND s.branch=$1
     GROUP BY si.scrap_type`,
    [branch]
  );

  const outRes = await pool.query(
    `SELECT scrap_type, COALESCE(SUM(weight_kg),0) AS w
     FROM scrap_sales
     WHERE status='confirmed_by_managerial' AND branch=$1
     GROUP BY scrap_type`,
    [branch]
  );

  const incomingByGroup = emptyWeightByGroup();
  for (const row of inRes.rows) {
    const grp = resolveTypeGroup(row.scrap_type);
    if (!grp) continue;
    incomingByGroup[grp] += parseFloat(row.w) || 0;
  }

  const soldByGroup = emptyWeightByGroup();
  for (const row of outRes.rows) {
    const grp = resolveTypeGroup(row.scrap_type);
    if (!grp) continue;
    soldByGroup[grp] += parseFloat(row.w) || 0;
  }

  const availableByGroup = emptyWeightByGroup();
  Object.keys(availableByGroup).forEach((grp) => {
    availableByGroup[grp] = round2((incomingByGroup[grp] || 0) - (soldByGroup[grp] || 0));
  });

  return {
    incomingByGroup: Object.fromEntries(Object.entries(incomingByGroup).map(([k, v]) => [k, round2(v)])),
    soldByGroup: Object.fromEntries(Object.entries(soldByGroup).map(([k, v]) => [k, round2(v)])),
    availableByGroup,
  };
}

function formatDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value).split('T')[0].split(' ')[0];
}

function mapSaleRow(row) {
  return {
    id: row.id,
    branch: row.branch,
    saleDate: formatDateOnly(row.sale_date),
    scrapType: row.scrap_type,
    weightKg: parseFloat(row.weight_kg) || 0,
    pricePerKg: row.price_per_kg ? parseFloat(row.price_per_kg) : null,
    totalPrice: row.total_price ? parseFloat(row.total_price) : null,
    buyer: row.buyer || '',
    notes: row.notes || '',
    salePhoto: row.sale_photo || '',
    recordedBy: row.recorded_by,
    status: row.status || 'pending_approval',
    approvedBy: row.approved_by || '',
    approvedAt: row.approved_at,
    rejectedBy: row.rejected_by || '',
    rejectedAt: row.rejected_at,
    rejectionReason: row.rejection_reason || '',
    confirmedBy: row.confirmed_by || '',
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
  };
}

router.get('/sales', requireLogin, requireRole('managerial', 'superadmin', 'approver', 'ex'), async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const user = req.session.user;
    const { branch, dateFrom, dateTo, status } = req.query;

    const params = [];
    const conditions = [];

    if ((user.role === 'managerial' || user.role === 'approver' || user.role === 'ex') && user.branch) {
      params.push(user.branch);
      conditions.push(`branch = $${params.length}`);
    } else if (branch) {
      params.push(branch);
      conditions.push(`branch = $${params.length}`);
    }

    if (dateFrom) {
      params.push(dateFrom);
      conditions.push(`sale_date >= $${params.length}::date`);
    }

    if (dateTo) {
      params.push(dateTo);
      conditions.push(`sale_date <= $${params.length}::date`);
    }

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT * FROM scrap_sales ${where} ORDER BY sale_date DESC, created_at DESC`,
      params
    );

    return res.json(result.rows.map(mapSaleRow));
  } catch (err) {
    return sendServerError(res, err);
  }
});

router.get('/sales/availability', requireLogin, requireRole('managerial', 'superadmin', 'approver', 'ex'), async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const user = req.session.user;
    const { scrapType } = req.query;

    const branch = (user.role === 'managerial' || user.role === 'approver' || user.role === 'ex') && user.branch
      ? user.branch
      : (req.query.branch || '').trim();

    if (!branch) return res.status(400).json({ error: 'กรุณาระบุสาขา' });

    const stock = await loadSaleAvailabilityByGroup(pool, branch);
    const group = resolveTypeGroup(scrapType);
    const availableKg = group ? (stock.availableByGroup[group] || 0) : null;

    return res.json({
      branch,
      group: group || null,
      groupLabel: group ? (GROUP_LABELS[group] || group) : null,
      availableKg,
      availableByGroup: stock.availableByGroup,
    });
  } catch (err) {
    return sendServerError(res, err);
  }
});

router.post('/sales', requireLogin, requireRole('managerial', 'superadmin'), upload.single('salePhoto'), async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const user = req.session.user;

    const { saleDate, scrapType, weightKg, pricePerKg, buyer, notes } = req.body;

    const branch = user.role === 'managerial' && user.branch ? user.branch : (req.body.branch || '').trim();
    if (!branch) return res.status(400).json({ error: 'กรุณาระบุสาขา' });
    if (!saleDate) return res.status(400).json({ error: 'กรุณาระบุวันที่ขาย' });
    if (!scrapType) return res.status(400).json({ error: 'กรุณาระบุประเภทวัสดุ' });
    if (!req.file) return res.status(400).json({ error: 'กรุณาแนบรูปภาพการขาย' });
    const group = resolveTypeGroup(scrapType);
    if (!group) return res.status(400).json({ error: 'ประเภทวัสดุไม่ถูกต้อง' });

    const w = parseFloat(weightKg);
    if (!w || w <= 0) return res.status(400).json({ error: 'น้ำหนักต้องมากกว่า 0' });

    const stock = await loadSaleAvailabilityByGroup(pool, branch);
    const availableKg = stock.availableByGroup[group] || 0;
    if ((w - availableKg) > 0.000001) {
      return res.status(400).json({
        error: `น้ำหนักเกินคงเหลือของ${GROUP_LABELS[group] || group} (คงเหลือ ${round2(availableKg)} กก.)`,
        group,
        groupLabel: GROUP_LABELS[group] || group,
        availableKg: round2(availableKg),
      });
    }

    const ppk = pricePerKg ? parseFloat(pricePerKg) : null;
    const total = ppk && w ? Math.round(ppk * w * 100) / 100 : null;
    const salePhoto = req.file ? req.file.filename : null;
    const id = uuidv4();

    await pool.query(
      `INSERT INTO scrap_sales
       (id, branch, sale_date, scrap_type, weight_kg, price_per_kg, total_price, buyer, notes, sale_photo, recorded_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending_approval')`,
      [
        id,
        branch,
        saleDate,
        scrapType,
        w,
        ppk,
        total,
        (buyer || '').trim() || null,
        (notes || '').trim() || null,
        salePhoto,
        user.fullName,
      ]
    );

    await pool.query(
      `INSERT INTO sale_logs (action, branch, sale_date, scrap_type, weight_kg, notes, sale_id, actor)
       VALUES ('create', $1, $2, $3, $4, $5, $6, $7)`,
      [branch, saleDate, scrapType, w, (notes || '').trim() || null, id, user.fullName]
    );

    return res.json({ success: true, id });
  } catch (err) {
    return sendServerError(res, err);
  }
});

router.delete('/sales/:id', requireLogin, requireRole('managerial', 'superadmin'), async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const user = req.session.user;

    const result = await pool.query('SELECT * FROM scrap_sales WHERE id=$1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'ไม่พบข้อมูล' });

    const sale = result.rows[0];
    if (user.role === 'managerial' && sale.branch !== user.branch) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์ลบรายการนี้' });
    }

    const cancelReason = (req.body?.cancelReason || '').trim() || null;

    await pool.query('DELETE FROM scrap_sales WHERE id=$1', [req.params.id]);
    await pool.query(
      `INSERT INTO sale_logs (action, branch, sale_date, scrap_type, weight_kg, notes, cancel_reason, sale_id, actor)
       VALUES ('cancel', $1, $2, $3, $4, $5, $6, $7, $8)`,
      [sale.branch, sale.sale_date, sale.scrap_type, parseFloat(sale.weight_kg), sale.notes || null, cancelReason, sale.id, user.fullName]
    );

    return res.json({ success: true });
  } catch (err) {
    return sendServerError(res, err);
  }
});

router.post('/sales/:id/approve', requireLogin, requireRole('ex'), async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const user = req.session.user;
    const approvedBy = (req.body?.approvedBy || user.fullName || '').trim();

    if (!approvedBy) return res.status(400).json({ error: 'กรุณาระบุชื่อผู้อนุมัติ' });

    const result = await pool.query('SELECT * FROM scrap_sales WHERE id=$1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'ไม่พบข้อมูล' });

    const sale = result.rows[0];
    if (user.branch && sale.branch !== user.branch) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์อนุมัติรายการขายต่างสาขา' });
    }
    if ((sale.status || 'pending_approval') !== 'pending_approval') {
      return res.status(400).json({ error: 'อนุมัติได้เฉพาะรายการที่รอ Approver เท่านั้น' });
    }

    await pool.query(
      `UPDATE scrap_sales
       SET status='approved_by_approver',
           approved_by=$1,
           approved_at=NOW(),
           rejected_by=NULL,
           rejected_at=NULL,
           rejection_reason=NULL
       WHERE id=$2`,
      [approvedBy, req.params.id]
    );

    await pool.query(
      `INSERT INTO sale_logs (action, branch, sale_date, scrap_type, weight_kg, notes, sale_id, actor)
       VALUES ('approve', $1, $2, $3, $4, $5, $6, $7)`,
      [sale.branch, sale.sale_date, sale.scrap_type, parseFloat(sale.weight_kg), sale.notes || null, sale.id, approvedBy]
    );

    return res.json({ success: true });
  } catch (err) {
    return sendServerError(res, err);
  }
});

router.post('/sales/:id/reject', requireLogin, requireRole('ex'), async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const user = req.session.user;
    const reason = (req.body?.reason || '').trim() || null;

    const result = await pool.query('SELECT * FROM scrap_sales WHERE id=$1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'ไม่พบข้อมูล' });

    const sale = result.rows[0];
    if (user.branch && sale.branch !== user.branch) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์ปฏิเสธรายการขายต่างสาขา' });
    }
    if ((sale.status || 'pending_approval') !== 'pending_approval') {
      return res.status(400).json({ error: 'ปฏิเสธได้เฉพาะรายการที่รอ Approver เท่านั้น' });
    }

    await pool.query(
      `UPDATE scrap_sales
       SET status='rejected_by_approver',
           rejected_by=$1,
           rejected_at=NOW(),
           rejection_reason=$2
       WHERE id=$3`,
      [user.fullName, reason, req.params.id]
    );

    await pool.query(
      `INSERT INTO sale_logs (action, branch, sale_date, scrap_type, weight_kg, notes, cancel_reason, sale_id, actor)
       VALUES ('reject', $1, $2, $3, $4, $5, $6, $7, $8)`,
      [sale.branch, sale.sale_date, sale.scrap_type, parseFloat(sale.weight_kg), sale.notes || null, reason, sale.id, user.fullName]
    );

    return res.json({ success: true });
  } catch (err) {
    return sendServerError(res, err);
  }
});

router.post('/sales/:id/confirm', requireLogin, requireRole('managerial', 'superadmin'), async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const user = req.session.user;

    const result = await pool.query('SELECT * FROM scrap_sales WHERE id=$1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'ไม่พบข้อมูล' });

    const sale = result.rows[0];
    if (user.role === 'managerial' && user.branch && sale.branch !== user.branch) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์ยืนยันรายการขายต่างสาขา' });
    }
    if (sale.status !== 'approved_by_approver') {
      return res.status(400).json({ error: 'ต้องผ่านการอนุมัติจาก Approver ก่อนจึงจะยืนยันได้' });
    }

    await pool.query(
      `UPDATE scrap_sales
       SET status='confirmed_by_managerial',
           confirmed_by=$1,
           confirmed_at=NOW()
       WHERE id=$2`,
      [user.fullName, req.params.id]
    );

    await pool.query(
      `INSERT INTO sale_logs (action, branch, sale_date, scrap_type, weight_kg, notes, sale_id, actor)
       VALUES ('confirm', $1, $2, $3, $4, $5, $6, $7)`,
      [sale.branch, sale.sale_date, sale.scrap_type, parseFloat(sale.weight_kg), sale.notes || null, sale.id, user.fullName]
    );

    return res.json({ success: true });
  } catch (err) {
    return sendServerError(res, err);
  }
});

router.get('/sale-logs', requireLogin, requireRole('managerial', 'superadmin', 'approver', 'ex'), async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const user = req.session.user;
    const { dateFrom, dateTo } = req.query;
    let { branch } = req.query;

    if ((user.role === 'managerial' || user.role === 'approver' || user.role === 'ex') && user.branch) branch = user.branch;

    const params = [];
    const conds = [];

    if (branch) {
      params.push(branch);
      conds.push(`branch = $${params.length}`);
    }
    if (dateFrom) {
      params.push(dateFrom);
      conds.push(`created_at >= $${params.length}::date`);
    }
    if (dateTo) {
      params.push(dateTo);
      conds.push(`created_at < ($${params.length}::date + INTERVAL '1 day')`);
    }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const result = await pool.query(`SELECT * FROM sale_logs ${where} ORDER BY created_at DESC LIMIT 200`, params);

    return res.json(result.rows.map((r) => ({
      id: r.id,
      action: r.action,
      branch: r.branch,
      saleDate: formatDateOnly(r.sale_date),
      scrapType: r.scrap_type,
      weightKg: parseFloat(r.weight_kg) || 0,
      notes: r.notes || '',
      cancelReason: r.cancel_reason || '',
      saleId: r.sale_id,
      actor: r.actor,
      createdAt: r.created_at,
    })));
  } catch (err) {
    return sendServerError(res, err);
  }
});

module.exports = router;
