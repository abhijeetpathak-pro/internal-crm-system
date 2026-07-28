/**
 * scripts/createSuperAdmin.js
 * Run once after npm install + schema import:
 *   node scripts/createSuperAdmin.js "Your Name" email@co.com "Password123!"
 */
const bcrypt = require('bcryptjs');
const pool   = require('../db');

async function main() {
  const [name, email, password] = process.argv.slice(2);
  if (!name || !email || !password) {
    console.error('Usage: node scripts/createSuperAdmin.js "Full Name" email@co.com "Password123!"');
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 10);
  const [existing] = await pool.query('SELECT id FROM crm_users WHERE email=?', [email]);
  if (existing.length > 0) {
    await pool.query(
      'UPDATE crm_users SET name=?, password_hash=?, role="super_admin", status="active" WHERE email=?',
      [name, hash, email]
    );
    console.log(`✅  Updated "${email}" to Super Admin with new password.`);
  } else {
    await pool.query(
      'INSERT INTO crm_users (name,email,password_hash,role,status,created_by) VALUES (?,?,?,"super_admin","active",NULL)',
      [name, email, hash]
    );
    console.log(`✅  Super Admin "${email}" created successfully.`);
  }
  process.exit(0);
}

main().catch(err => { console.error('❌  Error:', err.message); process.exit(1); });
