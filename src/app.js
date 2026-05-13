const path = require('path');
const express = require('express');
const session = require('express-session');
const { v4: uuidv4 } = require('uuid');

const { pool } = require('./config/db');
const { sessionSecret } = require('./config/env');

const rootRoutes = require('./routes/root');
const authRoutes = require('./routes/auth');
const submissionRoutes = require('./routes/submissions');
const reportRoutes = require('./routes/reports');
const userRoutes = require('./routes/users');
const adminSubmissionRoutes = require('./routes/adminSubmissions');
const salesRoutes = require('./routes/sales');
const ocrRoutes = require('./routes/ocr');

const app = express();
const isProd = process.env.NODE_ENV === 'production';

if (isProd) {
  app.set('trust proxy', 1);
}

app.locals.pool = pool;

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: sessionSecret || uuidv4(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: 8 * 60 * 60 * 1000,
    },
  })
);

app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
app.use(express.static(path.join(process.cwd(), 'public')));

app.use('/', rootRoutes);
app.use('/api/auth', authRoutes);
app.use('/api', submissionRoutes);
app.use('/api', reportRoutes);
app.use('/api', userRoutes);
app.use('/api', adminSubmissionRoutes);
app.use('/api', salesRoutes);
app.use('/api', ocrRoutes);

app.use((err, req, res, next) => {
  if (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
  return next();
});

module.exports = app;
