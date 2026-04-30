require('dotenv').config();
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

const pool = new Pool({
  host:     process.env.USER_DB_HOST,
  port:     parseInt(process.env.USER_DB_PORT, 10),
  database: process.env.USER_DB_NAME,
  user:     process.env.USER_DB_USER,
  password: process.env.USER_DB_PASSWORD,
});

const BRANCHES    = ['Y5', 'Y8', 'Y11'];
const COLLECTORS  = ['สมชาย มีสุข', 'วิชัย ดีงาม', 'ประทีป แสงทอง', 'นิรันดร์ ใจดี', 'สุรชัย บุญมา'];
const APPROVERS   = ['Auser', 'ผู้อนุมัติหลัก'];
const LOCATIONS   = ['จุดทิ้งที่ 1 ท้ายโรงงาน C', 'จุดทิ้งที่ 2 ข้างโกดัง A', 'จุดรวมเหล็ก B', 'โกดังหลัง', 'หน้าโรงงาน'];
const SCRAP_ITEMS = [
  { type: 'thin_1', label: 'เศษลวดหัวแบ่ง',    area: 'แผนกตัด' },
  { type: 'thin_2', label: 'สายแพ็คเหล็ก',      area: 'แผนกบรรจุ' },
  { type: 'thin_3', label: 'เศษลวดปลอก',        area: 'แผนกเชื่อม' },
  { type: 'thin_4', label: 'ลวดผูกเหล็กรัด',    area: 'คลังสินค้า' },
  { type: 'thin_5', label: 'เศษเหล็กโควล',      area: 'แผนกรีด' },
  { type: 'thick_1', label: 'เหล็กรูปพรรณ',     area: 'แผนกก่อสร้าง' },
  { type: 'thick_2', label: 'เศษเหล็กแผ่น',     area: 'แผนกตัดพลาสม่า' },
  { type: 'special_1', label: 'เหล็กหนาพิเศษ',  area: 'แผนกหนัก' },
];
const SALE_TYPES  = ['thin', 'thick', 'special'];
const SALE_ACTORS = ['Muser', 'ผู้จัดการ Y5', 'ผู้จัดการ Y8'];

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randFloat(min, max, dec = 1) { return parseFloat((Math.random() * (max - min) + min).toFixed(dec)); }
function randItem(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d; }

async function seed() {
  console.log('🌱 กำลังใส่ข้อมูลทดสอบ...');

  // ── Submissions ──────────────────────────────────────────────────────────────
  // 30 completed, 5 approved (not completed), 5 pending, 3 rejected
  const submissionsData = [];

  for (let i = 0; i < 30; i++) {
    const id       = uuidv4();
    const branch   = randItem(BRANCHES);
    const daysBack = randInt(1, 90);
    const submitted = daysAgo(daysBack + 2);
    const approved  = new Date(submitted.getTime() + randInt(1,8)*3600000);
    const disposed  = new Date(approved.getTime()  + randInt(1,12)*3600000);
    submissionsData.push({
      id, branch,
      collector_name: randItem(COLLECTORS),
      status: 'completed',
      submitted_at: submitted,
      approved_by: randItem(APPROVERS),
      approved_at: approved,
      disposal_location: randItem(LOCATIONS),
      disposal_submitted_at: disposed,
    });
  }
  for (let i = 0; i < 5; i++) {
    const id = uuidv4();
    const submitted = daysAgo(randInt(1, 10));
    const approved  = new Date(submitted.getTime() + randInt(1,6)*3600000);
    submissionsData.push({
      id, branch: randItem(BRANCHES),
      collector_name: randItem(COLLECTORS),
      status: 'approved',
      submitted_at: submitted,
      approved_by: randItem(APPROVERS),
      approved_at: approved,
      disposal_location: null,
      disposal_submitted_at: null,
    });
  }
  for (let i = 0; i < 5; i++) {
    submissionsData.push({
      id: uuidv4(), branch: randItem(BRANCHES),
      collector_name: randItem(COLLECTORS),
      status: 'pending',
      submitted_at: daysAgo(randInt(0, 3)),
      approved_by: null, approved_at: null,
      disposal_location: null, disposal_submitted_at: null,
    });
  }
  for (let i = 0; i < 3; i++) {
    submissionsData.push({
      id: uuidv4(), branch: randItem(BRANCHES),
      collector_name: randItem(COLLECTORS),
      status: 'rejected',
      submitted_at: daysAgo(randInt(5, 30)),
      approved_by: randItem(APPROVERS), approved_at: daysAgo(randInt(1,5)),
      disposal_location: null, disposal_submitted_at: null,
    });
  }

  for (const s of submissionsData) {
    await pool.query(
      `INSERT INTO submissions (id,branch,collector_name,status,submitted_at,approved_by,approved_at,disposal_location,disposal_submitted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO NOTHING`,
      [s.id, s.branch, s.collector_name, s.status, s.submitted_at,
       s.approved_by || null, s.approved_at || null,
       s.disposal_location || null, s.disposal_submitted_at || null]
    );
    // Add 1–4 items per submission
    const numItems = randInt(1, 4);
    for (let k = 0; k < numItems; k++) {
      const item = randItem(SCRAP_ITEMS);
      await pool.query(
        `INSERT INTO submission_items (submission_id,item_order,date,scrap_area,scrap_type,weight,bringer)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [s.id, k+1, s.submitted_at, item.area, item.type,
         randFloat(50, 800, 1), randItem(COLLECTORS)]
      );
    }
  }
  console.log(`✅  Submissions: ${submissionsData.length} รายการ`);

  // ── Scrap Sales ──────────────────────────────────────────────────────────────
  const salesData = [];
  for (let i = 0; i < 20; i++) {
    const id       = uuidv4();
    const branch   = randItem(BRANCHES);
    const saleDate = daysAgo(randInt(0, 60));
    const scrapType= randItem(SALE_TYPES);
    const weightKg = randFloat(100, 1500, 1);
    const actor    = randItem(SALE_ACTORS);
    salesData.push({ id, branch, saleDate, scrapType, weightKg, actor });
    await pool.query(
      `INSERT INTO scrap_sales (id,branch,sale_date,scrap_type,weight_kg,recorded_by,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO NOTHING`,
      [id, branch, saleDate, scrapType, weightKg, actor, saleDate]
    );
    // Log the create action
    await pool.query(
      `INSERT INTO sale_logs (action,branch,sale_date,scrap_type,weight_kg,sale_id,actor,created_at)
       VALUES ('create',$1,$2,$3,$4,$5,$6,$7)`,
      [branch, saleDate, scrapType, weightKg, id, actor, new Date(saleDate.getTime() + randInt(1,60)*60000)]
    );
  }
  console.log(`✅  Scrap Sales: ${salesData.length} รายการ`);

  // ── Sale Logs: add some cancel logs ─────────────────────────────────────────
  for (let i = 0; i < 5; i++) {
    const branch   = randItem(BRANCHES);
    const saleDate = daysAgo(randInt(10, 80));
    const scrapType= randItem(SALE_TYPES);
    const weightKg = randFloat(50, 400, 1);
    const actor    = randItem(SALE_ACTORS);
    await pool.query(
      `INSERT INTO sale_logs (action,branch,sale_date,scrap_type,weight_kg,sale_id,actor,created_at)
       VALUES ('cancel',$1,$2,$3,$4,$5,$6,$7)`,
      [branch, saleDate, scrapType, weightKg, uuidv4(), actor,
       new Date(saleDate.getTime() + randInt(120,600)*60000)]
    );
  }
  console.log(`✅  Sale Logs (cancel): 5 รายการ`);

  console.log('\n🎉 ใส่ข้อมูลทดสอบเสร็จแล้ว!');
  await pool.end();
}

seed().catch(err => { console.error('❌ Error:', err.message); pool.end(); });
