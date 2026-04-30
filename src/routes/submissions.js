const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { requireLogin, requireRole } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const { rowToSub, parseItems } = require('../utils/submission');
const { sendServerError } = require('../utils/responses');

const router = express.Router();

function buildSubmitterOwnershipCondition(user, params) {
  const employeeId = (user.employeeId || '').trim();
  const fullName = (user.fullName || '').trim();

  if (!employeeId) {
    params.push(fullName);
    return `s.collector_name = $${params.length}`;
  }

  params.push(employeeId);
  const employeeParam = params.length;
  params.push(fullName);
  const nameParam = params.length;
  return `((s.collector_employee_id IS NOT NULL AND s.collector_employee_id = $${employeeParam}) OR (s.collector_employee_id IS NULL AND s.collector_name = $${nameParam}))`;
}

function isSubmissionOwner(submission, user) {
  const employeeId = (user.employeeId || '').trim();
  const fullName = (user.fullName || '').trim();
  const ownerEmployeeId = (submission.collector_employee_id || '').trim();
  const ownerName = (submission.collector_name || '').trim();

  if (employeeId && ownerEmployeeId) {
    return ownerEmployeeId === employeeId;
  }
  return ownerName !== '' && ownerName === fullName;
}

router.post('/submit', requireLogin, requireRole('submitter'), upload.any(), async (req, res) => {
  const { pool } = req.app.locals;
  const client = await pool.connect();

  try {
    const body = req.body || {};
    const fileMap = {};
    (req.files || []).forEach((f) => {
      fileMap[f.fieldname] = f.filename;
    });

    const branch = (body.branch || '').trim();
    const collectorName = (body.collectorName || '').trim();

    if (!branch || !collectorName) {
      return res.status(400).json({ success: false, error: 'กรุณาระบุสาขาและชื่อผู้เข้าเก็บ' });
    }

    const items = parseItems(body, fileMap);
    if (items.length === 0) {
      return res.status(400).json({ success: false, error: 'ต้องมีรายการเศษเหล็กอย่างน้อย 1 รายการ' });
    }

    await client.query('BEGIN');

    const ids = [];
    for (const it of items) {
      const id = uuidv4();

      await client.query(
        `INSERT INTO submissions (id, branch, collector_name, collector_employee_id, department, position)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          id,
          branch,
          collectorName,
          (req.session.user?.employeeId || '').trim() || null,
          (body.department || '').trim() || null,
          (body.position || '').trim() || null,
        ]
      );

      await client.query(
        `INSERT INTO submission_items
           (submission_id, item_order, date, scrap_area, scrap_type, weight, bringer, weighing_photo, ocr_photo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, 0, it.date, it.scrapArea, it.scrapType, it.weight, it.bringer || null, it.weighingPhoto, it.ocrPhoto]
      );

      ids.push(id);
    }

    await client.query('COMMIT');
    return res.json({ success: true, ids, count: ids.length });
  } catch (err) {
    await client.query('ROLLBACK');
    return sendServerError(res, err);
  } finally {
    client.release();
  }
});

router.get('/submissions', requireLogin, async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const { status } = req.query;
    const user = req.session.user;

    const params = [];
    const conditions = [];

    if (user.role === 'submitter') {
      conditions.push(buildSubmitterOwnershipCondition(user, params));
    } else if (user.role === 'approver') {
      if (!user.branch) return res.json([]);
      params.push(user.branch);
      conditions.push(`s.branch = $${params.length}`);
    } else if (user.role === 'managerial') {
      if (!status) {
        params.push('completed');
        conditions.push(`s.status = $${params.length}`);
      }
    }

    if (status) {
      params.push(status);
      conditions.push(`s.status = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const subRes = await pool.query(
      `SELECT * FROM submissions s ${where} ORDER BY submitted_at DESC`,
      params
    );

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

router.get('/submissions/:id', requireLogin, async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const user = req.session.user;

    const subRes = await pool.query('SELECT * FROM submissions WHERE id = $1', [req.params.id]);
    if (subRes.rows.length === 0) {
      return res.status(404).json({ error: 'ไม่พบข้อมูล' });
    }

    const sub = subRes.rows[0];

    if (user.role === 'submitter' && !isSubmissionOwner(sub, user)) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์ดูรายการนี้' });
    }
    if (user.role === 'approver' && sub.branch !== user.branch) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์ดูรายการนี้ (ต่างสาขา)' });
    }
    if (user.role === 'managerial' && sub.status !== 'completed') {
      return res.status(403).json({ error: 'ดูได้เฉพาะรายการที่เสร็จสิ้นแล้ว' });
    }

    const itemsRes = await pool.query(
      'SELECT * FROM submission_items WHERE submission_id = $1 ORDER BY item_order',
      [req.params.id]
    );

    return res.json(rowToSub(sub, itemsRes.rows));
  } catch (err) {
    return sendServerError(res, err);
  }
});

router.post('/submissions/:id/approve', requireLogin, requireRole('approver'), async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const approvedBy = (req.body?.approvedBy || req.session.user.fullName || '').trim();

    if (!approvedBy) {
      return res.status(400).json({ error: 'กรุณาระบุชื่อผู้อนุมัติ' });
    }

    const check = await pool.query('SELECT status, branch FROM submissions WHERE id=$1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
    if (check.rows[0].branch !== req.session.user.branch) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์อนุมัติรายการนี้ (ต่างสาขา)' });
    }
    if (check.rows[0].status !== 'pending') {
      return res.status(400).json({ error: 'สามารถอนุมัติได้เฉพาะรายการที่รออนุมัติเท่านั้น' });
    }

    await pool.query(
      `UPDATE submissions SET status='approved', approved_by=$1, approved_at=NOW() WHERE id=$2`,
      [approvedBy, req.params.id]
    );

    return res.json({ success: true });
  } catch (err) {
    return sendServerError(res, err);
  }
});

router.post('/submissions/:id/reject', requireLogin, requireRole('approver'), async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const reason = (req.body?.reason || '').trim() || null;

    const check = await pool.query('SELECT status, branch FROM submissions WHERE id=$1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
    if (check.rows[0].branch !== req.session.user.branch) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์ปฏิเสธรายการนี้ (ต่างสาขา)' });
    }
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

router.post('/submissions/:id/complete', requireLogin, requireRole('submitter'), upload.single('disposalPhoto'), async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const user = req.session.user;

    const check = await pool.query('SELECT status, collector_name, collector_employee_id FROM submissions WHERE id=$1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'ไม่พบข้อมูล' });

    if (!isSubmissionOwner(check.rows[0], user)) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์บันทึกรายการนี้' });
    }

    const status = check.rows[0].status;
    if (status === 'completed') {
      return res.status(400).json({ error: 'รายการนี้เสร็จสิ้นแล้ว ไม่สามารถแก้ไขได้' });
    }
    if (status !== 'approved') {
      return res.status(400).json({ error: 'ต้องได้รับการอนุมัติก่อนบันทึกสถานที่ทิ้ง' });
    }

    const location = (req.body?.disposalLocation || '').trim();
    if (!location) {
      return res.status(400).json({ error: 'กรุณาระบุสถานที่ทิ้ง' });
    }

    await pool.query(
      `UPDATE submissions
         SET status='completed', disposal_location=$1, disposal_photo=$2, disposal_submitted_at=NOW()
       WHERE id=$3`,
      [location, req.file ? req.file.filename : null, req.params.id]
    );

    return res.json({ success: true });
  } catch (err) {
    return sendServerError(res, err);
  }
});

module.exports = router;
