function sendServerError(res, err) {
  console.error(err);
  return res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
}

module.exports = { sendServerError };
