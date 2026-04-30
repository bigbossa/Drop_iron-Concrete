const { Pool } = require('pg');
const { db } = require('./env');

const pool = new Pool(db);

module.exports = { pool };
