const { v4: uuidv4 } = require('uuid');
const express = require('express');
const { requireLogin, requireRole } = require('../middleware/auth');
const { sendServerError } = require('../utils/responses');

const router = express.Router();

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

router.get('/sales', requireLogin, requireRole('managerial', 'superadmin', 'approver'), async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const user = req.session.user;
    const { branch, dateFrom, dateTo, status } = req.query;

    const params = [];
    const conditions = [];

    if ((user.role === 'managerial' || user.role === 'approver') && user.branch) {
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

router.post('/sales', requireLogin, requireRole('managerial', 'superadmin'), async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const user = req.session.user;

    const { saleDate, scrapType, weightKg, pricePerKg, buyer, notes } = req.body;

    const branch = user.role === 'managerial' && user.branch ? user.branch : (req.body.branch || '').trim();
    if (!branch) return res.status(400).json({ error: 'กรุณาระบุสาขา' });
    if (!saleDate) return res.status(400).json({ error: 'กรุณาระบุวันที่ขาย' });
    if (!scrapType) return res.status(400).json({ error: 'กรุณาระบุประเภทเหล็ก' });

    const w = parseFloat(weightKg);
    if (!w || w <= 0) return res.status(400).json({ error: 'น้ำหนักต้องมากกว่า 0' });

    const ppk = pricePerKg ? parseFloat(pricePerKg) : null;
    const total = ppk && w ? Math.round(ppk * w * 100) / 100 : null;
    const id = uuidv4();

    await pool.query(
      `INSERT INTO scrap_sales
       (id, branch, sale_date, scrap_type, weight_kg, price_per_kg, total_price, buyer, notes, recorded_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending_approval')`,
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

router.post('/sales/:id/approve', requireLogin, requireRole('approver'), async (req, res) => {
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

router.post('/sales/:id/reject', requireLogin, requireRole('approver'), async (req, res) => {
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

router.get('/sale-logs', requireLogin, requireRole('managerial', 'superadmin', 'approver'), async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const user = req.session.user;
    const { dateFrom, dateTo } = req.query;
    let { branch } = req.query;

    if ((user.role === 'managerial' || user.role === 'approver') && user.branch) branch = user.branch;

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
