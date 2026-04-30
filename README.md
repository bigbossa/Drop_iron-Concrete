# Iron Drop

ระบบบันทึกและอนุมัติการเก็บเศษเหล็ก พัฒนาด้วย **Node.js + Express + PostgreSQL** รองรับการทำงาน 2 บทบาทคือ **ผู้ส่งเรื่อง (submitter)** และ **ผู้อนุมัติ (approver)** ตั้งแต่การกรอกฟอร์ม ชั่งน้ำหนัก แนบรูป อนุมัติ/ปฏิเสธ ไปจนถึงบันทึกสถานที่ทิ้งรอขายและล็อกรายการ

## ความสามารถหลัก

- ล็อกอินด้วยรหัสพนักงานและแยกสิทธิ์ตาม role
- ผู้ส่งเรื่องกรอกฟอร์มได้หลายรายการใน 1 submission
- แนบรูปถ่ายตอนชั่งน้ำหนักและรูปสถานที่ทิ้งได้
- ผู้อนุมัติเห็นรายการทั้งหมด พร้อมสรุปน้ำหนักแยกตามประเภท
- อนุมัติหรือปฏิเสธรายการได้จากหน้าอนุมัติ
- ผู้ส่งเรื่องติดตามสถานะด้วยรหัสอ้างอิง และบันทึกสถานที่ทิ้งหลังอนุมัติ
- เมื่อบันทึกสถานที่ทิ้งแล้ว รายการจะถูกเปลี่ยนเป็น `completed` และแก้ไขต่อไม่ได้

## เทคโนโลยีที่ใช้

- **Backend:** Express 5, express-session, multer, pg, bcryptjs, uuid
- **Frontend:** HTML + Bootstrap 5 + JavaScript แบบไม่ใช้ framework
- **Database:** PostgreSQL
- **Storage:** รูปภาพเก็บในโฟลเดอร์ `uploads/`

## โครงสร้างหน้าจอ

- `/login.html` หน้าเข้าสู่ระบบ
- `/` หน้าแบบฟอร์มสำหรับ submitter
- `/status.html` หน้าติดตามสถานะและบันทึกสถานที่ทิ้ง
- `/approve.html` หน้าจอของ approver สำหรับอนุมัติ/ปฏิเสธ

## โครงสร้างข้อมูลโดยสรุป

แอปจะสร้างตารางให้อัตโนมัติเมื่อเริ่มระบบ:

- `users`
- `submissions`
- `submission_items`

ถ้าตาราง `users` ยังว่าง ระบบจะ seed บัญชีเริ่มต้นให้อัตโนมัติ

## การติดตั้ง

1. ติดตั้ง **Node.js** และ **PostgreSQL**
2. สร้างฐานข้อมูล PostgreSQL สำหรับโปรเจกต์นี้
3. ติดตั้ง dependency

```bash
npm install
```

4. สร้างไฟล์ `.env` ที่ root ของโปรเจกต์

```env
PORT=3565
SESSION_SECRET=change-this-secret

USER_DB_HOST=localhost
USER_DB_PORT=5432
USER_DB_NAME=iron_drop
USER_DB_USER=postgres
USER_DB_PASSWORD=your_password
```

5. รันระบบ

```bash
npm start
```

หรือถ้าต้องการรันเวอร์ชันโครงสร้างใหม่แบบแยกโมดูล (`src/`)

```bash
npm run start:v2
```

เมื่อเริ่มสำเร็จ ระบบจะเปิดใช้งานที่ `http://localhost:3565`

## โครงสร้างใหม่ (Refactor)

มีการเพิ่มโครงสร้าง backend แบบแยกโมดูลไว้ในโฟลเดอร์ `src/` เพื่อให้ง่ายต่อการดูแล:

- `src/server.js` จุดเริ่มรันเซิร์ฟเวอร์
- `src/app.js` รวม middleware + route
- `src/config/` config env และ db pool
- `src/routes/` แยก API ตามโดเมน (auth, submissions, reports, users, sales)
- `src/services/initDb.js` จัดการสร้างตารางและ seed เริ่มต้น
- `src/middleware/` auth และ upload
- `src/utils/` helper ที่ใช้ร่วมกัน

> โค้ดเดิม (`index.js`) ยังอยู่ครบเพื่อรองรับการใช้งานเดิม

## บัญชีเริ่มต้น

ระบบจะสร้างบัญชีต่อไปนี้อัตโนมัติเมื่อ `users` ยังไม่มีข้อมูล:

| Role | Employee ID | Password |
| --- | --- | --- |
| submitter | `EMP001` | `1234` |
| approver | `APPR01` | `admin` |

## ลำดับการทำงานของระบบ

1. ผู้ส่งเรื่องล็อกอินและกรอกข้อมูลการเก็บเศษเหล็ก
2. ระบบสร้าง `submission id` แบบ UUID
3. ผู้อนุมัติเข้าหน้าอนุมัติ เพื่อตรวจสอบรายละเอียดและกดอนุมัติ/ปฏิเสธ
4. หากอนุมัติ ผู้ส่งเรื่องใช้รหัสอ้างอิงเพื่อติดตามสถานะที่หน้า `status.html`
5. ผู้ส่งเรื่องบันทึกสถานที่ทิ้งรอขายและแนบรูป (ถ้ามี)
6. ระบบล็อกรายการและเปลี่ยนสถานะเป็น `completed`

## สถานะของรายการ

- `pending` รออนุมัติ
- `approved` อนุมัติแล้ว รอผู้ส่งเรื่องบันทึกสถานที่ทิ้ง
- `rejected` ปฏิเสธ
- `completed` เสร็จสิ้นและล็อกรายการแล้ว

## การอัปโหลดรูปภาพ

- ใช้ `multer` สำหรับอัปโหลดไฟล์
- อนุญาตเฉพาะ `jpg`, `png`, `gif`, `webp`
- จำกัดขนาดไฟล์ไม่เกิน **10 MB** ต่อไฟล์
- จำกัดจำนวนไฟล์รวมต่อ request ไม่เกิน **30 ไฟล์**

## โครงสร้างไฟล์สำคัญ

```text
index.js                 เซิร์ฟเวอร์หลักและ API ทั้งหมด
package.json             รายการ dependency และ script
public/login.html        หน้าเข้าสู่ระบบ
public/form.html         ฟอร์มบันทึกการเก็บเศษเหล็ก
public/status.html       ติดตามสถานะ / บันทึกสถานที่ทิ้ง
public/approve.html      หน้าอนุมัติสำหรับ approver
uploads/                 เก็บรูปภาพที่อัปโหลด
```

## API หลัก

| Method | Path | คำอธิบาย |
| --- | --- | --- |
| POST | `/api/auth/login` | ล็อกอิน |
| POST | `/api/auth/logout` | ออกจากระบบ |
| GET | `/api/auth/me` | ดูข้อมูลผู้ใช้ที่ล็อกอินอยู่ |
| POST | `/api/submit` | ส่งฟอร์มใหม่ |
| GET | `/api/submissions` | ดึงรายการทั้งหมด |
| GET | `/api/submissions/:id` | ดูรายละเอียดรายการเดียว |
| POST | `/api/submissions/:id/approve` | อนุมัติรายการ |
| POST | `/api/submissions/:id/reject` | ปฏิเสธรายการ |
| POST | `/api/submissions/:id/complete` | บันทึกสถานที่ทิ้งและปิดงาน |

## หมายเหตุการใช้งาน

- session ถูกเก็บด้วย `express-session` แบบ in-memory จึงเหมาะกับการใช้งานภายในหรือการทดลองมากกว่าระบบ production ขนาดใหญ่
- ถ้าไม่กำหนด `SESSION_SECRET` ระบบจะสุ่มค่าใหม่ทุกครั้งที่ start เซิร์ฟเวอร์
- โฟลเดอร์ `uploads/` จะถูกสร้างอัตโนมัติถ้ายังไม่มี
- ไฟล์ `data/db.json` มีลักษณะเป็นข้อมูลเก่า/ตัวอย่าง แต่ระบบปัจจุบันอ่านข้อมูลจาก PostgreSQL

## How to run in Project 
- npm run index.js
- npm run start
- npm run start:v2