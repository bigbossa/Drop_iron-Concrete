const path = require('path');
const bcrypt = require('bcryptjs');
const express = require('express');
const { sendServerError } = require('../utils/responses');

const router = express.Router();

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || null;
}

router.post('/login', async (req, res) => {
  try {
    const employeeId = (req.body.employeeId || '').trim();
    const password = (req.body.password || '').trim();
    const { pool } = req.app.locals;
    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] || null;

    if (!employeeId || !password) {
      return res.status(400).json({ error: 'กรุณาระบุรหัสพนักงานและรหัสผ่าน' });
    }

    const result = await pool.query(
      'SELECT * FROM users WHERE employee_id=$1 AND is_active=TRUE',
      [employeeId]
    );

    if (result.rows.length === 0) {
      await pool.query(
        `INSERT INTO login_audit_logs (employee_id, user_id, success, failure_reason, ip_address, user_agent)
         VALUES ($1, NULL, FALSE, $2, $3, $4)`,
        [employeeId || null, 'user_not_found_or_inactive', ipAddress, userAgent]
      );
      return res.status(401).json({ error: 'รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง' });
    }

    const user = result.rows[0];
    const matched = await bcrypt.compare(password, user.password_hash);
    if (!matched) {
      await pool.query(
        `INSERT INTO login_audit_logs (employee_id, user_id, success, failure_reason, ip_address, user_agent)
         VALUES ($1, $2, FALSE, $3, $4, $5)`,
        [employeeId, user.id, 'invalid_password', ipAddress, userAgent]
      );
      return res.status(401).json({ error: 'รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง' });
    }

    await new Promise((resolve, reject) => {
      req.session.regenerate((err) => {
        if (err) return reject(err);
        return resolve();
      });
    });

    req.session.user = {
      id: user.id,
      employeeId: user.employee_id,
      fullName: user.full_name,
      role: user.role,
      branch: user.branch || '',
      department: user.department || '',
      position: user.position || '',
    };

    await pool.query(
      `UPDATE users SET last_login_at = NOW(), last_login_ip = $2 WHERE id = $1`,
      [user.id, ipAddress]
    );
    await pool.query(
      `INSERT INTO login_audit_logs (employee_id, user_id, success, failure_reason, ip_address, user_agent)
       VALUES ($1, $2, TRUE, NULL, $3, $4)`,
      [employeeId, user.id, ipAddress, userAgent]
    );

    const redirectMap = {
      submitter: '/form.html',
      approver: '/approve.html',
      ex: '/approve.html',
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
  req.session.destroy((err) => {
    res.clearCookie('connect.sid');
    if (err) return res.status(500).json({ success: false, error: 'ออกจากระบบไม่สำเร็จ' });
    return res.json({ success: true });
  });
});

router.get('/me', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'ไม่ได้เข้าสู่ระบบ' });
  }
  return res.json(req.session.user);
});

module.exports = router;
