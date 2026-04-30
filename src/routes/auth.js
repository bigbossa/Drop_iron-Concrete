const path = require('path');
const bcrypt = require('bcryptjs');
const express = require('express');
const { sendServerError } = require('../utils/responses');

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const employeeId = (req.body.employeeId || '').trim();
    const password = (req.body.password || '').trim();

    if (!employeeId || !password) {
      return res.status(400).json({ error: 'กรุณาระบุรหัสพนักงานและรหัสผ่าน' });
    }

    const { pool } = req.app.locals;
    const result = await pool.query(
      'SELECT * FROM users WHERE employee_id=$1 AND is_active=TRUE',
      [employeeId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง' });
    }

    const user = result.rows[0];
    const matched = await bcrypt.compare(password, user.password_hash);
    if (!matched) {
      return res.status(401).json({ error: 'รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง' });
    }

    req.session.user = {
      id: user.id,
      employeeId: user.employee_id,
      fullName: user.full_name,
      role: user.role,
      branch: user.branch || '',
      department: user.department || '',
      position: user.position || '',
    };

    const redirectMap = {
      submitter: '/',
      approver: '/approve.html',
      superadmin: '/admin.html',
      managerial: '/managerial.html',
    };

    return res.json({
      success: true,
      role: user.role,
      fullName: user.full_name,
      redirect: redirectMap[user.role] || '/',
    });
  } catch (err) {
    return sendServerError(res, err);
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

router.get('/me', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'ไม่ได้เข้าสู่ระบบ' });
  }
  return res.json(req.session.user);
});

module.exports = router;
