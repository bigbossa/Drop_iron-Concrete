require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  host:     process.env.USER_DB_HOST,
  port:     parseInt(process.env.USER_DB_PORT, 10),
  database: process.env.USER_DB_NAME,
  user:     process.env.USER_DB_USER,
  password: process.env.USER_DB_PASSWORD,
});

(async () => {
  const hash = await bcrypt.hash('super', 12);
  const r = await pool.query(
    "UPDATE users SET password_hash=$1 WHERE role='superadmin' RETURNING employee_id",
    [hash]
  );
  console.log('✅ reset password ok:', r.rows);
  await pool.end();
})().catch(e => { console.error(e.message); pool.end(); });
