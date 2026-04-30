require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3565;

// ─── PostgreSQL pool ──────────────────────────────────────────────────────────
const pool = new Pool({
  host:     process.env.USER_DB_HOST,
  port:     parseInt(process.env.USER_DB_PORT, 10),
  database: process.env.USER_DB_NAME,
  user:     process.env.USER_DB_USER,
  password: process.env.USER_DB_PASSWORD,
});

// ─── Type definitions ────────────────────────────────────────────────────────
const TYPE_GROUPS = {
  thin:    ['thin_1','thin_2','thin_3','thin_4'],
  thick:   ['thick_1','thick_2'],
  special: ['special_1'],
};
const TYPE_LABELS = {
  thin_1:    'เศษลวดหัวแบ่ง',
  thin_2:    'สายแพ็คเหล็ก',
  thin_3:    'เศษลวดปลอก',
  thin_4:    'ลวดผูกเหล็กรัดลวดปลอก',
  thick_1:   'เศษเหล็กโดเวล',
  thick_2:   'เหล็กรูปพรรณเศษชิ้นส่วนเครื่องจักร/เศษเหล็กเพลท',
  special_1: 'เศษเหล็กแผ่นจากการตัดเพลทเครื่องตัดพลาสม่า',
};
const GROUP_LABELS = { thin: 'เหล็กบาง', thick: 'เหล็กหนา', special: 'เหล็กหนาพิเศษ' };

function buildTypeBreakdown(items) {
  const bd = {};
  for (const [group, types] of Object.entries(TYPE_GROUPS)) {
    bd[group] = { label: GROUP_LABELS[group], totalWeight: 0, subtypes: {} };
  }
  for (const it of items) {
    const st = it.scrap_type || it.scrapType || '';
    const w  = parseFloat(it.weight) || 0;
    for (const [group, types] of Object.entries(TYPE_GROUPS)) {
      if (types.includes(st)) {
        bd[group].totalWeight += w;
        if (!bd[group].subtypes[st]) bd[group].subtypes[st] = { label: TYPE_LABELS[st] || st, weight: 0 };
        bd[group].subtypes[st].weight += w;
      }
    }
  }
  return bd;
}

// ─── initDB ─────────────────────────────────────────────────────────────────
async function initDB() {
  // Users table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      employee_id   VARCHAR(50)  UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      full_name     VARCHAR(100) NOT NULL,
      role          VARCHAR(20)  NOT NULL CHECK (role IN ('submitter','approver','superadmin')),
      branch        VARCHAR(100),
      department    VARCHAR(100),
      position      VARCHAR(100),
      is_active     BOOLEAN NOT NULL DEFAULT TRUE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // Migration: add columns if upgrading from older schema
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS branch     VARCHAR(100);`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(100);`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS position   VARCHAR(100);`);
  // Migrate role constraint to include superadmin
  await pool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;`);
  await pool.query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('submitter','approver','superadmin','managerial'));`);

  // Seed default accounts (only if table is empty)
  const { rows } = await pool.query('SELECT COUNT(*) FROM users');
  if (parseInt(rows[0].count, 10) === 0) {
    const submitterHash   = await bcrypt.hash('1234',  12);
    const approverHash    = await bcrypt.hash('admin', 12);
    const superadminHash  = await bcrypt.hash('super', 12);
    await pool.query(
      `INSERT INTO users (employee_id, password_hash, full_name, role) VALUES
         ($1,$2,$3,'submitter'),
         ($4,$5,$6,'approver'),
         ($7,$8,$9,'superadmin')`,
      ['EMP001', submitterHash, 'พนักงานทดสอบ',
       'APPR01', approverHash,  'ผู้อนุมัติหลัก',
       'SADM01', superadminHash,'Super Admin']
    );
    console.log('✅  สร้างบัญชีเริ่มต้น: EMP001/1234 (submitter), APPR01/admin (approver), SADM01/super (superadmin)');
  }

  // Create tables if they don't exist
  await pool.query(`
    CREATE TABLE IF NOT EXISTS submissions (
      id                    UUID PRIMARY KEY,
      branch                VARCHAR(100)  NOT NULL,
      collector_name        VARCHAR(100)  NOT NULL,
      collector_employee_id VARCHAR(50),
      department            VARCHAR(100),
      position              VARCHAR(100),
      status                VARCHAR(20)   NOT NULL DEFAULT 'pending',
      submitted_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      approved_by           VARCHAR(100),
      approved_at           TIMESTAMPTZ,
      rejection_reason      TEXT,
      disposal_location     TEXT,
      disposal_photo        VARCHAR(255),
      disposal_submitted_at TIMESTAMPTZ
    );
  `);
  // Migration: add column if upgrading from older schema
  await pool.query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS disposal_submitted_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS collector_employee_id VARCHAR(50);`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS submission_items (
      id             SERIAL PRIMARY KEY,
      submission_id  UUID REFERENCES submissions(id) ON DELETE CASCADE,
      item_order     INTEGER NOT NULL,
      date           DATE,
      scrap_area     VARCHAR(200),
      scrap_type     VARCHAR(100),
      weight         NUMERIC(10,2),
      bringer        VARCHAR(100),
      weighing_photo VARCHAR(255),
      ocr_photo      VARCHAR(255)
    );
  `);
  // Migration: add ocr_photo if upgrading from older schema
  await pool.query(`ALTER TABLE submission_items ADD COLUMN IF NOT EXISTS ocr_photo VARCHAR(255);`);

  // Scrap sales table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scrap_sales (
      id            UUID PRIMARY KEY,
      branch        VARCHAR(100) NOT NULL,
      sale_date     DATE         NOT NULL,
      scrap_type    VARCHAR(100) NOT NULL,
      weight_kg     NUMERIC(10,2) NOT NULL,
      price_per_kg  NUMERIC(10,2),
      total_price   NUMERIC(12,2),
      buyer         VARCHAR(200),
      notes         TEXT,
      recorded_by   VARCHAR(100) NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Sale activity log table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sale_logs (
      id             SERIAL PRIMARY KEY,
      action         VARCHAR(20) NOT NULL,
      branch         VARCHAR(100) NOT NULL,
      sale_date      DATE,
      scrap_type     VARCHAR(100),
      weight_kg      NUMERIC(10,2),
      notes          TEXT,
      cancel_reason  TEXT,
      sale_id        UUID,
      actor          VARCHAR(100) NOT NULL,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE sale_logs ADD COLUMN IF NOT EXISTS cancel_reason TEXT;`);
  console.log('✅  ตาราง PostgreSQL พร้อมใช้งาน');
}

// ─── Session middleware ───────────────────────────────────────────────────────
const SESSION_SECRET = process.env.SESSION_SECRET || uuidv4();


app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 }, // 8 hours
}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// Static files served AFTER session so login.html is public
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth helpers ─────────────────────────────────────────────────────────────
const requireLogin = (req, res, next) => {
  if (req.session && req.session.user) return next();
  if (req.headers['content-type'] && req.headers['content-type'].includes('json'))
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
  // For multipart/form-data (file upload)
  if (req.path.startsWith('/api/'))
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
  res.redirect('/login.html');
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.session || !req.session.user)
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
  if (!roles.includes(req.session.user.role))
    return res.status(403).json({ error: 'ไม่มีสิทธิ์ดำเนินการนี้' });
  next();
};

// ─── Auth routes ──────────────────────────────────────────────────────────────
// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const employeeId = (req.body.employeeId || '').trim();
    const password   = (req.body.password   || '').trim();
    if (!employeeId || !password)
      return res.status(400).json({ error: 'กรุณาระบุรหัสพนักงานและรหัสผ่าน' });

    const { rows } = await pool.query(
      'SELECT * FROM users WHERE employee_id=$1 AND is_active=TRUE', [employeeId]
    );
    if (rows.length === 0)
      return res.status(401).json({ error: 'รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง' });

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match)
      return res.status(401).json({ error: 'รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง' });

    req.session.user = {
      id:         user.id,
      employeeId: user.employee_id,
      fullName:   user.full_name,
      role:       user.role,
      branch:     user.branch     || '',
      department: user.department || '',
      position:   user.position   || '',
    };
    const redirectMap = { submitter: '/', approver: '/approve.html', superadmin: '/admin.html', managerial: '/managerial.html' };
    res.json({ success: true, role: user.role, fullName: user.full_name, redirect: redirectMap[user.role] || '/' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// GET /api/auth/me
app.get('/api/auth/me', (req, res) => {
  if (!req.session || !req.session.user) return res.status(401).json({ error: 'ไม่ได้เข้าสู่ระบบ' });
  res.json(req.session.user);
});

// Root → redirect based on role (or login)
app.get('/', (req, res) => {
  if (!req.session || !req.session.user) return res.redirect('/login.html');
  if (req.session.user.role === 'approver')    return res.redirect('/approve.html');
  if (req.session.user.role === 'superadmin')  return res.redirect('/admin.html');
  if (req.session.user.role === 'managerial')  return res.redirect('/managerial.html');
  res.sendFile(path.join(__dirname, 'public', 'form.html'));
});

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Multer – secure image-only uploads
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '');
    cb(null, `${Date.now()}-${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error('อนุญาตเฉพาะไฟล์รูปภาพ (jpg, png, gif, webp) เท่านั้น'));
  },
  limits: { fileSize: 10 * 1024 * 1024, files: 30 }
});

// ─── Helper: map DB row → API shape ──────────────────────────────────────────
function rowToSub(row, items = []) {
  const mappedItems = items.map(it => ({
    date:          it.date ? it.date.toISOString().split('T')[0] : null,
    scrapArea:     it.scrap_area,
    scrapType:     it.scrap_type,
    weight:        parseFloat(it.weight) || 0,
    bringer:       it.bringer,
    weighingPhoto: it.weighing_photo,
    ocrPhoto:      it.ocr_photo,
  }));
  return {
    id:                   row.id,
    branch:               row.branch,
    collectorName:        row.collector_name,
    department:           row.department,
    position:             row.position,
    status:               row.status,
    submittedAt:          row.submitted_at,
    approvedBy:           row.approved_by,
    approvedAt:           row.approved_at,
    rejectionReason:      row.rejection_reason,
    disposalLocation:     row.disposal_location,
    disposalPhoto:        row.disposal_photo,
    disposalSubmittedAt:  row.disposal_submitted_at,
    items:                mappedItems,
    typeBreakdown:        buildTypeBreakdown(items),
  };
}

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

// Parse flat indexed FormData fields into items array
const parseItems = (body, fileMap) => {
  const items = [];
  let i = 0;
  while (body[`date_${i}`] !== undefined) {
    items.push({
      date:          (body[`date_${i}`] || '').trim() || null,
      scrapArea:     (body[`scrapArea_${i}`] || '').trim(),
      scrapType:     (body[`scrapType_${i}`] || '').trim(),
      weight:        parseFloat(body[`weight_${i}`]) || 0,
      bringer:       (body[`bringer_${i}`] || '').trim(),
      weighingPhoto: fileMap[`weighingPhoto_${i}`] || null,
      ocrPhoto:      fileMap[`ocrPhoto_${i}`]      || null,
    });
    i++;
  }
  return items;
};

// ─── Protected Routes ────────────────────────────────────────────────────────

// Submit new form (submitter only)
app.post('/api/submit', requireLogin, requireRole('submitter'), upload.any(), async (req, res) => {
  const client = await pool.connect();
  try {
    const body = req.body;
    const fileMap = {};
    (req.files || []).forEach(f => { fileMap[f.fieldname] = f.filename; });

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
        VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, branch, collectorName,
        (req.session.user?.employeeId || '').trim() || null,
         (body.department || '').trim() || null,
         (body.position || '').trim() || null]
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
    res.json({ success: true, ids, count: ids.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  } finally {
    client.release();
  }
});

// Get all submissions
app.get('/api/submissions', requireLogin, async (req, res) => {
  try {
    const { status } = req.query;
    const user = req.session.user;
    const params = [];
    const conditions = [];

    // Scope by role
    if (user.role === 'submitter') {
      conditions.push(buildSubmitterOwnershipCondition(user, params));
    } else if (user.role === 'approver') {
      if (!user.branch) return res.json([]); // approver without branch sees nothing
      params.push(user.branch);
      conditions.push(`s.branch = $${params.length}`);
    } else if (user.role === 'managerial') {
      // managerial sees only completed submissions across all branches
      if (!status) {
        params.push('completed');
        conditions.push(`s.status = $${params.length}`);
      }
    }
    // superadmin sees all — no extra condition

    if (status) {
      params.push(status);
      conditions.push(`s.status = $${params.length}`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const subRes = await pool.query(
      `SELECT * FROM submissions s ${where} ORDER BY submitted_at DESC`, params
    );
    const ids = subRes.rows.map(r => r.id);
    if (ids.length === 0) return res.json([]);

    const itemRes = await pool.query(
      `SELECT * FROM submission_items WHERE submission_id = ANY($1::uuid[]) ORDER BY item_order`,
      [ids]
    );

    const itemMap = {};
    itemRes.rows.forEach(it => {
      if (!itemMap[it.submission_id]) itemMap[it.submission_id] = [];
      itemMap[it.submission_id].push(it);
    });

    res.json(subRes.rows.map(r => rowToSub(r, itemMap[r.id] || [])));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  }
});

// Get one submission
app.get('/api/submissions/:id', requireLogin, async (req, res) => {
  try {
    const user = req.session.user;
    const { rows } = await pool.query('SELECT * FROM submissions WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
    const sub = rows[0];
    // Access control
    if (user.role === 'submitter' && !isSubmissionOwner(sub, user))
      return res.status(403).json({ error: 'ไม่มีสิทธิ์ดูรายการนี้' });
    if (user.role === 'approver' && sub.branch !== user.branch)
      return res.status(403).json({ error: 'ไม่มีสิทธิ์ดูรายการนี้ (ต่างสาขา)' });
    if (user.role === 'managerial' && sub.status !== 'completed')
      return res.status(403).json({ error: 'ดูได้เฉพาะรายการที่เสร็จสิ้นแล้ว' });
    const items = await pool.query(
      'SELECT * FROM submission_items WHERE submission_id = $1 ORDER BY item_order',
      [req.params.id]
    );
    res.json(rowToSub(sub, items.rows));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  }
});

// Approve (approver only)
app.post('/api/submissions/:id/approve', requireLogin, requireRole('approver'), async (req, res) => {
  req.body = req.body || {};
  if (!req.body.approvedBy) req.body.approvedBy = req.session.user.fullName;
  try {
    const approvedBy = (req.body.approvedBy || '').trim();
    if (!approvedBy) return res.status(400).json({ error: 'กรุณาระบุชื่อผู้อนุมัติ' });

    const check = await pool.query('SELECT status, branch FROM submissions WHERE id=$1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
    if (check.rows[0].branch !== req.session.user.branch)
      return res.status(403).json({ error: 'ไม่มีสิทธิ์อนุมัติรายการนี้ (ต่างสาขา)' });
    if (check.rows[0].status !== 'pending') return res.status(400).json({ error: 'สามารถอนุมัติได้เฉพาะรายการที่รออนุมัติเท่านั้น' });

    await pool.query(
      `UPDATE submissions SET status='approved', approved_by=$1, approved_at=NOW() WHERE id=$2`,
      [approvedBy, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  }
});

// Reject (approver only)
app.post('/api/submissions/:id/reject', requireLogin, requireRole('approver'), async (req, res) => {
  try {
    const reason = (req.body.reason || '').trim() || null;

    const check = await pool.query('SELECT status, branch FROM submissions WHERE id=$1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
    if (check.rows[0].branch !== req.session.user.branch)
      return res.status(403).json({ error: 'ไม่มีสิทธิ์ปฏิเสธรายการนี้ (ต่างสาขา)' });
    if (check.rows[0].status !== 'pending') return res.status(400).json({ error: 'สามารถปฏิเสธได้เฉพาะรายการที่รออนุมัติเท่านั้น' });

    await pool.query(
      `UPDATE submissions SET status='rejected', rejection_reason=$1, approved_at=NOW() WHERE id=$2`,
      [reason, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  }
});

// Complete — submitter records disposal (submitter only)
app.post('/api/submissions/:id/complete', requireLogin, requireRole('submitter'), upload.single('disposalPhoto'), async (req, res) => {
  try {
    const check = await pool.query('SELECT status, collector_name, collector_employee_id FROM submissions WHERE id=$1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'ไม่พบข้อมูล' });

    if (!isSubmissionOwner(check.rows[0], req.session.user)) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์บันทึกรายการนี้' });
    }

    const { status } = check.rows[0];
    if (status === 'completed') return res.status(400).json({ error: 'รายการนี้เสร็จสิ้นแล้ว ไม่สามารถแก้ไขได้' });
    if (status !== 'approved')  return res.status(400).json({ error: 'ต้องได้รับการอนุมัติก่อนบันทึกสถานที่ทิ้ง' });

    const location = (req.body.disposalLocation || '').trim();
    if (!location) return res.status(400).json({ error: 'กรุณาระบุสถานที่ทิ้ง' });

    const photo = req.file ? req.file.filename : null;
    await pool.query(
      `UPDATE submissions
         SET status='completed', disposal_location=$1, disposal_photo=$2, disposal_submitted_at=NOW()
       WHERE id=$3`,
      [location, photo, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  }
});
// ─── Managerial Report API ───────────────────────────────────────────────────
// GET /api/managerial/report
app.get('/api/managerial/report', requireLogin, requireRole('managerial', 'superadmin'), async (req, res) => {
  try {
    const { branch, dateFrom, dateTo } = req.query;
    const params = [];
    const conditions = [`s.status = 'completed'`];

    if (branch) {
      params.push(branch);
      conditions.push(`s.branch = $${params.length}`);
    }
    if (dateFrom) {
      params.push(dateFrom);
      conditions.push(`s.disposal_submitted_at >= $${params.length}::date`);
    }
    if (dateTo) {
      params.push(dateTo);
      conditions.push(`s.disposal_submitted_at < ($${params.length}::date + INTERVAL '1 day')`);
    }
    const where = 'WHERE ' + conditions.join(' AND ');

    // Total submissions + weight
    const totalRes = await pool.query(
      `SELECT COUNT(DISTINCT s.id) AS cnt, COALESCE(SUM(si.weight),0) AS w
         FROM submissions s
         LEFT JOIN submission_items si ON si.submission_id = s.id
         ${where}`, params
    );

    // Weight by scrap type
    const typeRes = await pool.query(
      `SELECT si.scrap_type, SUM(si.weight) AS w
         FROM submission_items si
         JOIN submissions s ON s.id = si.submission_id
         ${where}
         GROUP BY si.scrap_type ORDER BY w DESC`, params
    );

    // Weight by disposal location
    const locationRes = await pool.query(
      `SELECT s.disposal_location, COALESCE(SUM(si.weight),0) AS w
         FROM submissions s
         LEFT JOIN submission_items si ON si.submission_id = s.id
         ${where}
         GROUP BY s.disposal_location ORDER BY w DESC`, params
    );

    // Weight by branch
    const branchRes = await pool.query(
      `SELECT s.branch, COALESCE(SUM(si.weight),0) AS w
         FROM submissions s
         LEFT JOIN submission_items si ON si.submission_id = s.id
         ${where}
         GROUP BY s.branch ORDER BY w DESC`, params
    );

    // Recent completed submissions (up to 50)
    const recentRes = await pool.query(
      `SELECT s.id, s.branch, s.collector_name, s.disposal_location, s.disposal_submitted_at,
              s.approved_by, COALESCE(SUM(si.weight),0) AS total_weight
         FROM submissions s
         LEFT JOIN submission_items si ON si.submission_id = s.id
         ${where}
         GROUP BY s.id ORDER BY s.disposal_submitted_at DESC LIMIT 50`, params
    );

    // Build type breakdown (group totals)
    const weightByGroup = { thin: 0, thick: 0, special: 0 };
    const byType = typeRes.rows.map(r => {
      const w = parseFloat(r.w) || 0;
      for (const [group, types] of Object.entries(TYPE_GROUPS)) {
        if (types.includes(r.scrap_type)) weightByGroup[group] += w;
      }
      return { type: r.scrap_type, label: TYPE_LABELS[r.scrap_type] || r.scrap_type, weight: Math.round(w * 100) / 100 };
    });

    res.json({
      total: {
        submissions: parseInt(totalRes.rows[0]?.cnt || 0, 10),
        weight: Math.round((parseFloat(totalRes.rows[0]?.w) || 0) * 100) / 100,
      },
      weightByGroup: {
        thin:    Math.round(weightByGroup.thin    * 100) / 100,
        thick:   Math.round(weightByGroup.thick   * 100) / 100,
        special: Math.round(weightByGroup.special * 100) / 100,
      },
      byType,
      byLocation: locationRes.rows.map(r => ({
        location: r.disposal_location || '(ไม่ระบุ)',
        weight:   Math.round((parseFloat(r.w) || 0) * 100) / 100,
      })),
      byBranch: branchRes.rows.map(r => ({
        branch: r.branch || '(ไม่ระบุ)',
        weight: Math.round((parseFloat(r.w) || 0) * 100) / 100,
      })),
      recent: recentRes.rows.map(r => ({
        id:                  r.id,
        branch:              r.branch,
        collectorName:       r.collector_name,
        disposalLocation:    r.disposal_location || '–',
        disposalSubmittedAt: r.disposal_submitted_at,
        approvedBy:          r.approved_by,
        totalWeight:         Math.round((parseFloat(r.total_weight) || 0) * 100) / 100,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  }
});

// ─── Dashboard API ────────────────────────────────────────────────────────────
// GET /api/dashboard
app.get('/api/dashboard', requireLogin, requireRole('approver', 'superadmin', 'managerial'), async (req, res) => {
  try {
    const role = req.session.user.role;
    const isSuperAdmin = role === 'superadmin';
    // approver and superadmin both see all data
    const scopeWhere  = '';
    const scopeParams = [];

    // ── 1. Status counts ──────────────────────────────────────────────────────
    const statusRes = await pool.query(
      `SELECT status, COUNT(*) AS cnt FROM submissions s GROUP BY status`,
      []
    );
    const counts = { total: 0, pending: 0, approved: 0, rejected: 0, completed: 0 };
    for (const row of statusRes.rows) {
      const n = parseInt(row.cnt, 10);
      counts[row.status] = n;
      counts.total += n;
    }

    // ── 2. Total weight & weight by type group ────────────────────────────────
    const weightRes = await pool.query(
      `SELECT si.scrap_type, SUM(si.weight) AS w FROM submission_items si
         JOIN submissions s ON s.id = si.submission_id GROUP BY si.scrap_type`,
      []
    );
    const weightByGroup = { thin: 0, thick: 0, special: 0 };
    const weightByType = {};
    let totalWeight = 0;
    for (const row of weightRes.rows) {
      const w = parseFloat(row.w) || 0;
      totalWeight += w;
      weightByType[row.scrap_type] = Math.round(w * 100) / 100;
      for (const [group, types] of Object.entries(TYPE_GROUPS)) {
        if (types.includes(row.scrap_type)) weightByGroup[group] += w;
      }
    }

    // ── 3. Weight by day (last 14 days) ──────────────────────────────────────
    const dayRes = await pool.query(
      `SELECT si.date::date AS d, SUM(si.weight) AS w
         FROM submission_items si
         JOIN submissions s ON s.id = si.submission_id
         WHERE si.date >= CURRENT_DATE - INTERVAL '13 days'
         GROUP BY d ORDER BY d`,
      []
    );
    const weightByDay = dayRes.rows.map(r => ({
      date: r.d instanceof Date ? r.d.toISOString().split('T')[0] : String(r.d).split('T')[0],
      weight: parseFloat(r.w) || 0,
    }));

    // ── 4. Weight by scrapArea (top 8) ────────────────────────────────────────
    const areaRes = await pool.query(
      `SELECT si.scrap_area, SUM(si.weight) AS w FROM submission_items si
         JOIN submissions s ON s.id = si.submission_id
         GROUP BY si.scrap_area ORDER BY w DESC LIMIT 8`,
      []
    );
    const weightByArea = areaRes.rows.map(r => ({
      area: r.scrap_area || '(ไม่ระบุ)',
      weight: parseFloat(r.w) || 0,
    }));

    // ── 5. Weight by branch (superadmin only) ─────────────────────────────────
    let weightByBranch = [];
    {
      const branchRes = await pool.query(
        `SELECT s.branch, SUM(si.weight) AS w FROM submission_items si
           JOIN submissions s ON s.id = si.submission_id
           GROUP BY s.branch ORDER BY w DESC`
      );
      weightByBranch = branchRes.rows.map(r => ({
        branch: r.branch || '(ไม่ระบุ)',
        weight: parseFloat(r.w) || 0,
      }));
    }

    // ── 6. Recent 8 submissions ───────────────────────────────────────────────
    const recentRes = await pool.query(
      `SELECT id, branch, collector_name, status, submitted_at FROM submissions
         ORDER BY submitted_at DESC LIMIT 8`,
      []
    );

    // ── 7. User count (superadmin only) ──────────────────────────────────────
    let userStats = null;
    if (isSuperAdmin) {
      const uRes = await pool.query(
        `SELECT role, COUNT(*) AS cnt FROM users WHERE is_active=TRUE GROUP BY role`
      );
      userStats = { submitter: 0, approver: 0, superadmin: 0 };
      for (const r of uRes.rows) userStats[r.role] = parseInt(r.cnt, 10);
    }

    res.json({
      counts,
      totalWeight: Math.round(totalWeight * 100) / 100,
      weightByGroup: {
        thin:    Math.round(weightByGroup.thin    * 100) / 100,
        thick:   Math.round(weightByGroup.thick   * 100) / 100,
        special: Math.round(weightByGroup.special * 100) / 100,
      },
      weightByType,
      weightByDay,
      weightByArea,
      weightByBranch,
      recentSubmissions: recentRes.rows.map(r => ({
        id:            r.id,
        branch:        r.branch,
        collectorName: r.collector_name,
        status:        r.status,
        submittedAt:   r.submitted_at,
      })),
      userStats,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  }
});
// ─── User Management (superadmin only) ──────────────────────────────────────

// GET /api/users — list all users
app.get('/api/users', requireLogin, requireRole('superadmin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, employee_id, full_name, role, branch, department, position, is_active, created_at
         FROM users ORDER BY id`
    );
    res.json(rows.map(u => ({
      id:         u.id,
      employeeId: u.employee_id,
      fullName:   u.full_name,
      role:       u.role,
      branch:     u.branch     || '',
      department: u.department || '',
      position:   u.position   || '',
      isActive:   u.is_active,
      createdAt:  u.created_at,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  }
});

// POST /api/users — create user
app.post('/api/users', requireLogin, requireRole('superadmin'), async (req, res) => {
  try {
    const { employeeId, password, fullName, role, branch, department, position } = req.body;
    if (!employeeId || !password || !fullName || !role)
      return res.status(400).json({ error: 'กรุณากรอกข้อมูลที่จำเป็นให้ครบ' });
    if (!['submitter','approver','superadmin','managerial'].includes(role))
      return res.status(400).json({ error: 'role ไม่ถูกต้อง' });
    if (password.length < 4)
      return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร' });
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO users (employee_id, password_hash, full_name, role, branch, department, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [employeeId.trim(), hash, fullName.trim(),
       role, (branch||'').trim()||null, (department||'').trim()||null, (position||'').trim()||null]
    );
    res.json({ success: true, id: rows[0].id });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'รหัสพนักงานนี้มีในระบบแล้ว' });
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  }
});

// PUT /api/users/:id — update user info / reset password
app.put('/api/users/:id', requireLogin, requireRole('superadmin'), async (req, res) => {
  try {
    const { fullName, role, branch, department, position, password, isActive } = req.body;
    const uid = parseInt(req.params.id, 10);
    if (isNaN(uid)) return res.status(400).json({ error: 'id ไม่ถูกต้อง' });
    if (role && !['submitter','approver','superadmin','managerial'].includes(role))
      return res.status(400).json({ error: 'role ไม่ถูกต้อง' });

    // Build dynamic SET clause
    const fields = [];
    const vals   = [];
    if (fullName  !== undefined) { fields.push(`full_name=$${vals.length+1}`);   vals.push(fullName.trim()); }
    if (role      !== undefined) { fields.push(`role=$${vals.length+1}`);         vals.push(role); }
    if (branch    !== undefined) { fields.push(`branch=$${vals.length+1}`);       vals.push(branch.trim()||null); }
    if (department!== undefined) { fields.push(`department=$${vals.length+1}`);   vals.push(department.trim()||null); }
    if (position  !== undefined) { fields.push(`position=$${vals.length+1}`);     vals.push(position.trim()||null); }
    if (isActive  !== undefined) { fields.push(`is_active=$${vals.length+1}`);    vals.push(isActive); }
    if (password) {
      if (password.length < 4) return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร' });
      const hash = await bcrypt.hash(password, 12);
      fields.push(`password_hash=$${vals.length+1}`); vals.push(hash);
    }
    if (fields.length === 0) return res.status(400).json({ error: 'ไม่มีข้อมูลที่จะอัปเดต' });
    vals.push(uid);
    const result = await pool.query(
      `UPDATE users SET ${fields.join(',')} WHERE id=$${vals.length} RETURNING id`,
      vals
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  }
});

// DELETE /api/users/:id — delete user (cannot delete yourself)
app.delete('/api/users/:id', requireLogin, requireRole('superadmin'), async (req, res) => {
  try {
    const uid = parseInt(req.params.id, 10);
    if (isNaN(uid)) return res.status(400).json({ error: 'id ไม่ถูกต้อง' });
    if (uid === req.session.user.id) return res.status(400).json({ error: 'ไม่สามารถลบบัญชีของตัวเองได้' });
    const result = await pool.query('DELETE FROM users WHERE id=$1 RETURNING id', [uid]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  }
});

// ─── OCR Weight (Gemini) ──────────────────────────────────────────────────────
// POST /api/ocr-weight  { imageBase64: "<base64 jpeg>" }
app.post('/api/ocr-weight', requireLogin, async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'ไม่มีรูปภาพ' });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ไม่ได้ตั้งค่า GEMINI_API_KEY' });

    const prompt = `Look at this weighing scale display image. Read the numeric weight value shown on the screen.
Reply with ONLY the number, for example: 12.5 or 150 or 3.20
Do NOT add units, text, or explanation. If you cannot read the number clearly, reply: null`;

    const body = {
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } }
        ]
      }],
      generationConfig: { temperature: 0, maxOutputTokens: 32 }
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`;
    const gRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!gRes.ok) {
      const errText = await gRes.text();
      console.error('Gemini error:', errText);
      return res.status(502).json({ error: 'Gemini API error', detail: errText });
    }

    const gData = await gRes.json();
    const rawText = gData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'null';
    const match = rawText.match(/\d+\.?\d*/);
    const weight = match ? parseFloat(match[0]) : null;

    res.json({ weight, raw: rawText });
  } catch (err) {
    console.error('OCR error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  }
});

// ─── Admin Submission Management (superadmin only) ──────────────────────────

// GET /api/admin/submissions — list all submissions with optional filters
app.get('/api/admin/submissions', requireLogin, requireRole('superadmin'), async (req, res) => {
  try {
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

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const subRes = await pool.query(
      `SELECT * FROM submissions s ${where} ORDER BY submitted_at DESC`, params
    );
    const ids = subRes.rows.map(r => r.id);
    if (ids.length === 0) return res.json([]);

    const itemRes = await pool.query(
      `SELECT * FROM submission_items WHERE submission_id = ANY($1::uuid[]) ORDER BY item_order`,
      [ids]
    );
    const itemMap = {};
    itemRes.rows.forEach(it => {
      if (!itemMap[it.submission_id]) itemMap[it.submission_id] = [];
      itemMap[it.submission_id].push(it);
    });

    res.json(subRes.rows.map(r => rowToSub(r, itemMap[r.id] || [])));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  }
});

// POST /api/admin/submissions/:id/approve — superadmin force-approve
app.post('/api/admin/submissions/:id/approve', requireLogin, requireRole('superadmin'), async (req, res) => {
  try {
    const approvedBy = req.session.user.fullName;
    const check = await pool.query('SELECT status FROM submissions WHERE id=$1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
    if (check.rows[0].status !== 'pending')
      return res.status(400).json({ error: 'สามารถอนุมัติได้เฉพาะรายการที่รออนุมัติเท่านั้น' });

    await pool.query(
      `UPDATE submissions SET status='approved', approved_by=$1, approved_at=NOW() WHERE id=$2`,
      [approvedBy, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  }
});

// POST /api/admin/submissions/:id/reject — superadmin force-reject
app.post('/api/admin/submissions/:id/reject', requireLogin, requireRole('superadmin'), async (req, res) => {
  try {
    const reason = (req.body.reason || '').trim() || null;
    const check = await pool.query('SELECT status FROM submissions WHERE id=$1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
    if (check.rows[0].status !== 'pending')
      return res.status(400).json({ error: 'สามารถปฏิเสธได้เฉพาะรายการที่รออนุมัติเท่านั้น' });

    await pool.query(
      `UPDATE submissions SET status='rejected', rejection_reason=$1, approved_at=NOW() WHERE id=$2`,
      [reason, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  }
});

// DELETE /api/admin/submissions/:id — superadmin delete any submission
app.delete('/api/admin/submissions/:id', requireLogin, requireRole('superadmin'), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM submissions WHERE id=$1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  }
});

// ─── Scrap Sales API ──────────────────────────────────────────────────────────

// GET /api/sales
app.get('/api/sales', requireLogin, requireRole('managerial', 'superadmin'), async (req, res) => {
  try {
    const user = req.session.user;
    const { branch, dateFrom, dateTo } = req.query;
    const params = [];
    const conditions = [];

    // managerial locked to own branch
    if (user.role === 'managerial' && user.branch) {
      params.push(user.branch);
      conditions.push(`branch = $${params.length}`);
    } else if (branch) {
      params.push(branch);
      conditions.push(`branch = $${params.length}`);
    }
    if (dateFrom) { params.push(dateFrom); conditions.push(`sale_date >= $${params.length}::date`); }
    if (dateTo)   { params.push(dateTo);   conditions.push(`sale_date <= $${params.length}::date`); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const { rows } = await pool.query(
      `SELECT * FROM scrap_sales ${where} ORDER BY sale_date DESC, created_at DESC`, params
    );
    res.json(rows.map(r => ({
      id:          r.id,
      branch:      r.branch,
      saleDate:    formatDateOnly(r.sale_date),
      scrapType:   r.scrap_type,
      weightKg:    parseFloat(r.weight_kg) || 0,
      pricePerKg:  r.price_per_kg ? parseFloat(r.price_per_kg) : null,
      totalPrice:  r.total_price  ? parseFloat(r.total_price)  : null,
      buyer:       r.buyer || '',
      notes:       r.notes || '',
      recordedBy:  r.recorded_by,
      createdAt:   r.created_at,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  }
});

// POST /api/sales
app.post('/api/sales', requireLogin, requireRole('managerial', 'superadmin'), async (req, res) => {
  try {
    const user = req.session.user;
    const { saleDate, scrapType, weightKg, pricePerKg, buyer, notes } = req.body;

    // Branch: managerial uses own branch; superadmin may pass branch in body
    const branch = (user.role === 'managerial' && user.branch)
      ? user.branch
      : ((req.body.branch || '').trim());

    if (!branch)     return res.status(400).json({ error: 'กรุณาระบุสาขา' });
    if (!saleDate)   return res.status(400).json({ error: 'กรุณาระบุวันที่ขาย' });
    if (!scrapType)  return res.status(400).json({ error: 'กรุณาระบุประเภทเหล็ก' });
    const w = parseFloat(weightKg);
    if (!w || w <= 0) return res.status(400).json({ error: 'น้ำหนักต้องมากกว่า 0' });

    const ppk = pricePerKg ? parseFloat(pricePerKg) : null;
    const total = (ppk && w) ? Math.round(ppk * w * 100) / 100 : null;
    const id = uuidv4();

    await pool.query(
      `INSERT INTO scrap_sales (id, branch, sale_date, scrap_type, weight_kg, price_per_kg, total_price, buyer, notes, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, branch, saleDate, scrapType, w, ppk, total,
       (buyer||'').trim()||null, (notes||'').trim()||null, user.fullName]
    );
    // Log the sale action
    await pool.query(
      `INSERT INTO sale_logs (action, branch, sale_date, scrap_type, weight_kg, notes, sale_id, actor)
         VALUES ('create', $1, $2, $3, $4, $5, $6, $7)`,
      [branch, saleDate, scrapType, w, (notes||'').trim()||null, id, user.fullName]
    );
    res.json({ success: true, id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  }
});

// DELETE /api/sales/:id
app.delete('/api/sales/:id', requireLogin, requireRole('managerial', 'superadmin'), async (req, res) => {
  try {
    const user = req.session.user;
    const { rows } = await pool.query('SELECT * FROM scrap_sales WHERE id=$1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
    // managerial can only delete own branch records
    if (user.role === 'managerial' && rows[0].branch !== user.branch)
      return res.status(403).json({ error: 'ไม่มีสิทธิ์ลบรายการนี้' });
    const sale = rows[0];
    const cancelReason = (req.body?.cancelReason || '').trim() || null;
    await pool.query('DELETE FROM scrap_sales WHERE id=$1', [req.params.id]);
    // Log the cancel action
    await pool.query(
      `INSERT INTO sale_logs (action, branch, sale_date, scrap_type, weight_kg, notes, cancel_reason, sale_id, actor)
         VALUES ('cancel', $1, $2, $3, $4, $5, $6, $7, $8)`,
      [sale.branch, sale.sale_date, sale.scrap_type, parseFloat(sale.weight_kg),
       sale.notes || null, cancelReason, sale.id, user.fullName]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  }
});

// GET /api/sale-logs
app.get('/api/sale-logs', requireLogin, requireRole('managerial', 'superadmin', 'approver'), async (req, res) => {
  try {
    const user = req.session.user;
    const { dateFrom, dateTo } = req.query;
    let { branch } = req.query;
    if (user.role === 'managerial' && user.branch) branch = user.branch;

    const params = [];
    const conds  = [];
    if (branch)   { params.push(branch);   conds.push(`branch = $${params.length}`); }
    if (dateFrom) { params.push(dateFrom); conds.push(`created_at >= $${params.length}::date`); }
    if (dateTo)   { params.push(dateTo);   conds.push(`created_at < ($${params.length}::date + INTERVAL '1 day')`); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

    const { rows } = await pool.query(
      `SELECT * FROM sale_logs ${where} ORDER BY created_at DESC LIMIT 200`, params
    );
    res.json(rows.map(r => ({
      id:           r.id,
      action:       r.action,
      branch:       r.branch,
      saleDate:     formatDateOnly(r.sale_date),
      scrapType:    r.scrap_type,
      weightKg:     parseFloat(r.weight_kg) || 0,
      notes:        r.notes || '',
      cancelReason: r.cancel_reason || '',
      saleId:       r.sale_id,
      actor:        r.actor,
      createdAt:    r.created_at,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  }
});

// GET /api/stock-history  — combined IN (completed submissions) + OUT (sales) timeline
app.get('/api/stock-history', requireLogin, requireRole('approver', 'managerial', 'superadmin'), async (req, res) => {
  try {
    const user = req.session.user;
    const { dateFrom, dateTo, direction } = req.query;
    let { branch } = req.query;

    // managerial locked to own branch
    if (user.role === 'managerial' && user.branch) branch = user.branch;

    const inParams = [];
    const inConds  = [`s.status = 'completed'`];
    if (branch)   { inParams.push(branch);   inConds.push(`s.branch = $${inParams.length}`); }
    if (dateFrom) { inParams.push(dateFrom); inConds.push(`s.disposal_submitted_at >= $${inParams.length}::date`); }
    if (dateTo)   { inParams.push(dateTo);   inConds.push(`s.disposal_submitted_at < ($${inParams.length}::date + INTERVAL '1 day')`); }
    const inWhere = 'WHERE ' + inConds.join(' AND ');

    const outParams = [];
    const outConds  = [];
    if (branch)   { outParams.push(branch);   outConds.push(`branch = $${outParams.length}`); }
    if (dateFrom) { outParams.push(dateFrom); outConds.push(`sale_date >= $${outParams.length}::date`); }
    if (dateTo)   { outParams.push(dateTo);   outConds.push(`sale_date <= $${outParams.length}::date`); }
    const outWhere = outConds.length ? 'WHERE ' + outConds.join(' AND ') : '';

    const events = [];

    if (!direction || direction === 'in' || direction === 'all') {
      const subRes = await pool.query(
        `SELECT s.id, s.branch, s.collector_name, s.disposal_location,
                s.disposal_submitted_at, s.approved_by,
                COALESCE(SUM(si.weight),0) AS total_weight
           FROM submissions s
           LEFT JOIN submission_items si ON si.submission_id = s.id
           ${inWhere}
           GROUP BY s.id ORDER BY s.disposal_submitted_at DESC LIMIT 200`, inParams
      );
      // Get type breakdown per submission
      const ids = subRes.rows.map(r => r.id);
      let itemMap = {};
      if (ids.length > 0) {
        const itRes = await pool.query(
          `SELECT submission_id, scrap_type, SUM(weight) AS w
             FROM submission_items WHERE submission_id = ANY($1::uuid[])
             GROUP BY submission_id, scrap_type`, [ids]
        );
        for (const r of itRes.rows) {
          if (!itemMap[r.submission_id]) itemMap[r.submission_id] = {};
          const grp = TYPE_GROUPS.thin.includes(r.scrap_type) ? 'thin'
                    : TYPE_GROUPS.thick.includes(r.scrap_type) ? 'thick'
                    : TYPE_GROUPS.special.includes(r.scrap_type) ? 'special' : null;
          if (grp) itemMap[r.submission_id][grp] = (itemMap[r.submission_id][grp] || 0) + (parseFloat(r.w) || 0);
        }
      }
      for (const r of subRes.rows) {
        const wbg = itemMap[r.id] || {};
        events.push({
          direction:     'in',
          date:          r.disposal_submitted_at instanceof Date
                           ? r.disposal_submitted_at.toISOString().split('T')[0]
                           : String(r.disposal_submitted_at).split('T')[0],
          branch:        r.branch,
          totalWeight:   Math.round((parseFloat(r.total_weight) || 0) * 100) / 100,
          weightByGroup: {
            thin:    Math.round((wbg.thin    || 0) * 100) / 100,
            thick:   Math.round((wbg.thick   || 0) * 100) / 100,
            special: Math.round((wbg.special || 0) * 100) / 100,
          },
          ref:           r.id,
          collectorName: r.collector_name || '',
          approvedBy:    r.approved_by    || '',
          location:      r.disposal_location || '',
          createdAt:     r.disposal_submitted_at,
        });
      }
    }

    if (!direction || direction === 'out' || direction === 'all') {
      const saleRes = await pool.query(
        `SELECT * FROM scrap_sales ${outWhere} ORDER BY sale_date DESC, created_at DESC LIMIT 200`, outParams
      );
      const resolveSaleGroup = (scrapType) => {
        if (scrapType === 'thin' || scrapType === 'thick' || scrapType === 'special') return scrapType;
        if (TYPE_GROUPS.thin.includes(scrapType)) return 'thin';
        if (TYPE_GROUPS.thick.includes(scrapType)) return 'thick';
        if (TYPE_GROUPS.special.includes(scrapType)) return 'special';
        return 'special';
      };
      for (const r of saleRes.rows) {
        const grp = resolveSaleGroup(r.scrap_type);
        const w   = parseFloat(r.weight_kg) || 0;
        events.push({
          direction:     'out',
          date:          formatDateOnly(r.sale_date),
          branch:        r.branch,
          totalWeight:   Math.round(w * 100) / 100,
          weightByGroup: {
            thin:    grp === 'thin'    ? Math.round(w * 100) / 100 : 0,
            thick:   grp === 'thick'   ? Math.round(w * 100) / 100 : 0,
            special: grp === 'special' ? Math.round(w * 100) / 100 : 0,
          },
          ref:        r.id,
          scrapType:  grp,
          scrapTypeRaw: r.scrap_type,
          notes:      r.notes || '',
          recordedBy: r.recorded_by || '',
          createdAt:  r.created_at,
        });
      }
    }

    // Sort by date DESC then createdAt DESC
    events.sort((a, b) => {
      const dd = b.date.localeCompare(a.date);
      if (dd !== 0) return dd;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    res.json(events);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  }
});

// Error handler
app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ success: false, error: err.message });
  next();
});

// ─── Start ────────────────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`✅  เซิร์ฟเวอร์ทำงานที่ http://localhost:${PORT}`);
    console.log(`   ฟอร์มกรอกข้อมูล : http://localhost:${PORT}/`);
    console.log(`   ติดตามสถานะ      : http://localhost:${PORT}/status.html`);
    console.log(`   หน้าอนุมัติ      : http://localhost:${PORT}/approve.html`);
  });
}).catch(err => {
  console.error('❌  เชื่อมต่อ PostgreSQL ไม่ได้:', err.message);
  process.exit(1);
});
