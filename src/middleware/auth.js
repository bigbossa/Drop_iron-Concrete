function requireLogin(req, res, next) {
  if (req.session && req.session.user) return next();

  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('json')) {
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
  }
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
  }

  return res.redirect('/login.html');
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์ดำเนินการนี้' });
    }
    return next();
  };
}

module.exports = {
  requireLogin,
  requireRole,
};
