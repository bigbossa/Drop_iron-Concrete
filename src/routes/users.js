const bcrypt = require('bcryptjs');
const express = require('express');
const { requireLogin, requireRole } = require('../middleware/auth');
const { sendServerError } = require('../utils/responses');

const router = express.Router();

router.get('/users', requireLogin, requireRole('superadmin'), async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const { rows } = await pool.query(
      `SELECT id, employee_id, full_name, role, branch, department, position, is_active, created_at
       FROM users ORDER BY id`
    );

    return res.json(rows.map((u) => ({
      id: u.id,
      employeeId: u.employee_id,
      fullName: u.full_name,
      role: u.role,
      branch: u.branch || '',
      department: u.department || '',
      position: u.position || '',
      isActive: u.is_active,
      createdAt: u.created_at,
    })));
  } catch (err) {
    return sendServerError(res, err);
  }
});

router.post('/users', requireLogin, requireRole('superadmin'), async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const { employeeId, password, fullName, role, branch, department, position } = req.body;
    const normalizedRole = String(role || '').trim().toLowerCase();
    const resolvedRole = (
      normalizedRole === 'executive'
      || normalizedRole.startsWith('executive ')
      || normalizedRole.includes('อนุมัติขายออก')
      || normalizedRole === 'ex'
    ) ? 'ex' : normalizedRole;

    if (!employeeId || !password || !fullName || !role) {
      return res.status(400).json({ error: 'กรุณากรอกข้อมูลที่จำเป็นให้ครบ' });
    }

    if (!['submitter', 'approver', 'superadmin', 'managerial', 'ex'].includes(resolvedRole)) {
      return res.status(400).json({ error: 'role ไม่ถูกต้อง' });
    }

    if (password.length < 4) {
      return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร' });
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (employee_id, password_hash, full_name, role, branch, department, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        employeeId.trim(),
        hash,
        fullName.trim(),
        resolvedRole,
        (branch || '').trim() || null,
        (department || '').trim() || null,
        (position || '').trim() || null,
      ]
    );

    return res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'รหัสพนักงานนี้มีในระบบแล้ว' });
    }
    return sendServerError(res, err);
  }
});

router.put('/users/:id', requireLogin, requireRole('superadmin'), async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const { fullName, role, branch, department, position, password, isActive } = req.body;
    const normalizedRole = role === undefined ? undefined : String(role).trim().toLowerCase();
    const resolvedRole = normalizedRole === undefined
      ? undefined
      : (
        normalizedRole === 'executive'
        || normalizedRole.startsWith('executive ')
        || normalizedRole.includes('อนุมัติขายออก')
        || normalizedRole === 'ex'
      ) ? 'ex' : normalizedRole;

    const uid = parseInt(req.params.id, 10);
    if (Number.isNaN(uid)) return res.status(400).json({ error: 'id ไม่ถูกต้อง' });

    if (resolvedRole && !['submitter', 'approver', 'superadmin', 'managerial', 'ex'].includes(resolvedRole)) {
      return res.status(400).json({ error: 'role ไม่ถูกต้อง' });
    }

    const fields = [];
    const values = [];

    if (fullName !== undefined) { fields.push(`full_name=$${values.length + 1}`); values.push(fullName.trim()); }
    if (resolvedRole !== undefined) { fields.push(`role=$${values.length + 1}`); values.push(resolvedRole); }
    if (branch !== undefined) { fields.push(`branch=$${values.length + 1}`); values.push(branch.trim() || null); }
    if (department !== undefined) { fields.push(`department=$${values.length + 1}`); values.push(department.trim() || null); }
    if (position !== undefined) { fields.push(`position=$${values.length + 1}`); values.push(position.trim() || null); }
    if (isActive !== undefined) { fields.push(`is_active=$${values.length + 1}`); values.push(isActive); }

    if (password) {
      if (password.length < 4) {
        return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร' });
      }
      const hash = await bcrypt.hash(password, 12);
      fields.push(`password_hash=$${values.length + 1}`);
      values.push(hash);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'ไม่มีข้อมูลที่จะอัปเดต' });
    }

    values.push(uid);
    const result = await pool.query(
      `UPDATE users SET ${fields.join(',')} WHERE id=$${values.length} RETURNING id`,
      values
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    return res.json({ success: true });
  } catch (err) {
    return sendServerError(res, err);
  }
});

router.delete('/users/:id', requireLogin, requireRole('superadmin'), async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const uid = parseInt(req.params.id, 10);
    if (Number.isNaN(uid)) return res.status(400).json({ error: 'id ไม่ถูกต้อง' });

    if (uid === req.session.user.id) {
      return res.status(400).json({ error: 'ไม่สามารถลบบัญชีของตัวเองได้' });
    }

    const result = await pool.query('DELETE FROM users WHERE id=$1 RETURNING id', [uid]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });

    return res.json({ success: true });
  } catch (err) {
    return sendServerError(res, err);
  }
});

module.exports = router;
