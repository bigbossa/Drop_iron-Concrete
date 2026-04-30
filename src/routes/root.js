const path = require('path');
const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.redirect('/login.html');
  }

  if (req.session.user.role === 'approver') return res.redirect('/approve.html');
  if (req.session.user.role === 'superadmin') return res.redirect('/admin.html');
  if (req.session.user.role === 'managerial') return res.redirect('/managerial.html');

  return res.sendFile(path.join(process.cwd(), 'public', 'form.html'));
});

module.exports = router;
