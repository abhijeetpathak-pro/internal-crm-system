require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'crm_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true
});

async function testConnection() {
  try {
    const conn = await pool.getConnection();
    console.log('✅  MySQL connected (crm_db)');
    conn.release();
  } catch (err) {
    console.error('❌  MySQL connection failed:', err.message);
  }
}

module.exports = pool;
module.exports.testConnection = testConnection;
