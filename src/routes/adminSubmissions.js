const express = require('express');
const { requireLogin, requireRole } = require('../middleware/auth');
const { rowToSub } = require('../utils/submission');
const { sendServerError } = require('../utils/responses');

const router = express.Router();

router.get('/admin/submissions', requireLogin, requireRole('superadmin'), async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const { status, branch, search } = req.query;

    const params = [];
    const conditions = [];

    if (status) {
      params.push(status);
      conditions.push(`s.status = $${params.length}`);
    }
    if (branch) {
      params.push(branch);
      conditions.push(`s.branch = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(s.collector_name ILIKE $${params.length} OR s.department ILIKE $${params.length} OR s.branch ILIKE $${params.length})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const subRes = await pool.query(`SELECT * FROM submissions s ${where} ORDER BY submitted_at DESC`, params);

    const ids = subRes.rows.map((r) => r.id);
    if (ids.length === 0) return res.json([]);

    const itemRes = await pool.query(
      `SELECT * FROM submission_items WHERE submission_id = ANY($1::uuid[]) ORDER BY item_order`,
      [ids]
    );

    const itemMap = {};
    itemRes.rows.forEach((it) => {
      if (!itemMap[it.submission_id]) itemMap[it.submission_id] = [];
      itemMap[it.submission_id].push(it);
    });

    return res.json(subRes.rows.map((r) => rowToSub(r, itemMap[r.id] || [])));
  } catch (err) {
    return sendServerError(res, err);
  }
});

router.post('/admin/submissions/:id/approve', requireLogin, requireRole('superadmin'), async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const check = await pool.query('SELECT status FROM submissions WHERE id=$1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
    if (check.rows[0].status !== 'pending') {
      return res.status(400).json({ error: 'สามารถอนุมัติได้เฉพาะรายการที่รออนุมัติเท่านั้น' });
    }

    await pool.query(
      `UPDATE submissions SET status='approved', approved_by=$1, approved_at=NOW() WHERE id=$2`,
      [req.session.user.fullName, req.params.id]
    );

    return res.json({ success: true });
  } catch (err) {
    return sendServerError(res, err);
  }
});

router.post('/admin/submissions/:id/reject', requireLogin, requireRole('superadmin'), async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const reason = (req.body?.reason || '').trim() || null;
    const check = await pool.query('SELECT status FROM submissions WHERE id=$1', [req.params.id]);

    if (check.rows.length === 0) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
    if (check.rows[0].status !== 'pending') {
      return res.status(400).json({ error: 'สามารถปฏิเสธได้เฉพาะรายการที่รออนุมัติเท่านั้น' });
    }

    await pool.query(
      `UPDATE submissions SET status='rejected', rejection_reason=$1, approved_at=NOW() WHERE id=$2`,
      [reason, req.params.id]
    );

    return res.json({ success: true });
  } catch (err) {
    return sendServerError(res, err);
  }
});

router.delete('/admin/submissions/:id', requireLogin, requireRole('superadmin'), async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const result = await pool.query('DELETE FROM submissions WHERE id=$1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'ไม่พบข้อมูล' });

    return res.json({ success: true });
  } catch (err) {
    return sendServerError(res, err);
  }
});

module.exports = router;
