const bcrypt = require('bcryptjs');

async function initDb(pool) {
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

  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS branch VARCHAR(100);`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(100);`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS position VARCHAR(100);`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_ip VARCHAR(64);`);
  await pool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;`);
  await pool.query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('submitter','approver','superadmin','managerial','ex'));`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_employee_active ON users(employee_id, is_active);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS login_audit_logs (
      id             SERIAL PRIMARY KEY,
      employee_id    VARCHAR(50),
      user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
      success        BOOLEAN NOT NULL,
      failure_reason TEXT,
      ip_address     VARCHAR(64),
      user_agent     TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_login_audit_employee_id ON login_audit_logs(employee_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_login_audit_created_at ON login_audit_logs(created_at DESC);`);

  const userCount = await pool.query('SELECT COUNT(*) FROM users');
  if (parseInt(userCount.rows[0].count, 10) === 0) {
    const submitterHash = await bcrypt.hash('1234', 12);
    const approverHash = await bcrypt.hash('admin', 12);
    const superadminHash = await bcrypt.hash('super', 12);
    const managerialHash = await bcrypt.hash('manager', 12);

    await pool.query(
      `INSERT INTO users (employee_id, password_hash, full_name, role, branch)
       VALUES
         ($1,$2,$3,'submitter',$4),
         ($5,$6,$7,'approver',$8),
         ($9,$10,$11,'superadmin',$12),
         ($13,$14,$15,'managerial',$16)`,
      [
        'EMP001', submitterHash, 'พนักงานทดสอบ', 'Y5',
        'APPR01', approverHash, 'ผู้อนุมัติหลัก', 'Y5',
        'SADM01', superadminHash, 'Super Admin', 'Y5',
        'MGR01', managerialHash, 'ผู้จัดการทดสอบ', 'Y5',
      ]
    );

    console.log('✅ สร้างบัญชีเริ่มต้นเรียบร้อย');
  }

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

  await pool.query(`ALTER TABLE submission_items ADD COLUMN IF NOT EXISTS ocr_photo VARCHAR(255);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS scrap_sales (
      id            UUID PRIMARY KEY,
      branch        VARCHAR(100) NOT NULL,
      sale_date     DATE NOT NULL,
      scrap_type    VARCHAR(100) NOT NULL,
      weight_kg     NUMERIC(10,2) NOT NULL,
      price_per_kg  NUMERIC(10,2),
      total_price   NUMERIC(12,2),
      buyer         VARCHAR(200),
      notes         TEXT,
      sale_photo    VARCHAR(255),
      recorded_by   VARCHAR(100) NOT NULL,
      status        VARCHAR(30) NOT NULL DEFAULT 'confirmed_by_managerial',
      approved_by   VARCHAR(100),
      approved_at   TIMESTAMPTZ,
      rejected_by   VARCHAR(100),
      rejected_at   TIMESTAMPTZ,
      rejection_reason TEXT,
      confirmed_by  VARCHAR(100),
      confirmed_at  TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE scrap_sales ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'confirmed_by_managerial';`);
  await pool.query(`ALTER TABLE scrap_sales ADD COLUMN IF NOT EXISTS approved_by VARCHAR(100);`);
  await pool.query(`ALTER TABLE scrap_sales ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE scrap_sales ADD COLUMN IF NOT EXISTS rejected_by VARCHAR(100);`);
  await pool.query(`ALTER TABLE scrap_sales ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE scrap_sales ADD COLUMN IF NOT EXISTS rejection_reason TEXT;`);
  await pool.query(`ALTER TABLE scrap_sales ADD COLUMN IF NOT EXISTS confirmed_by VARCHAR(100);`);
  await pool.query(`ALTER TABLE scrap_sales ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE scrap_sales ADD COLUMN IF NOT EXISTS sale_photo VARCHAR(255);`);

  await pool.query(`
    UPDATE scrap_sales
    SET status = 'confirmed_by_managerial',
        confirmed_by = COALESCE(confirmed_by, recorded_by),
        confirmed_at = COALESCE(confirmed_at, created_at)
    WHERE status IS NULL OR status = '';
  `);

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

  console.log('✅ ตาราง PostgreSQL พร้อมใช้งาน');
}

module.exports = { initDb };
