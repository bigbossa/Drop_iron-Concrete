require('dotenv').config();

module.exports = {
  port: Number(process.env.PORT || 3565),
  sessionSecret: process.env.SESSION_SECRET,
  db: {
    host: process.env.USER_DB_HOST,
    port: Number(process.env.USER_DB_PORT || 5432),
    database: process.env.USER_DB_NAME,
    user: process.env.USER_DB_USER,
    password: process.env.USER_DB_PASSWORD,
  },
  geminiApiKey: process.env.GEMINI_API_KEY || '',
};
