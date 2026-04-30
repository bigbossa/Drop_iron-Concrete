const app = require('./app');
const { pool } = require('./config/db');
const { port } = require('./config/env');
const { initDb } = require('./services/initDb');

async function start() {
  try {
    await initDb(pool);
    app.listen(port, () => {
      console.log(`✅ เซิร์ฟเวอร์ทำงานที่ http://localhost:${port}`);
      console.log(`   ฟอร์มกรอกข้อมูล : http://localhost:${port}/`);
      console.log(`   ติดตามสถานะ      : http://localhost:${port}/status.html`);
      console.log(`   หน้าอนุมัติ      : http://localhost:${port}/approve.html`);
      console.log(`   โครงสร้างใหม่     : src/`);
    });
  } catch (err) {
    console.error('❌ เชื่อมต่อ PostgreSQL ไม่ได้:', err.message);
    process.exit(1);
  }
}

start();
