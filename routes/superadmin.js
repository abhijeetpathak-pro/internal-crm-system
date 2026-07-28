// Import Express framework
const express = require('express');
// Create Express router instance
const router = express.Router();
// Import database connection pool
const pool = require('../db');
// Import authentication and role-based authorization middlewares
const { requireLogin, requireRole } = require('../middleware/auth');

// ── APPLY MIDDLEWARE ──
// Saare routes ke liye login mandatory hai
// Sirf Super Admin ko hi access hai (requireRole('super_admin'))
// Middleware ensure karta hai ki sirf Super Admin hi in routes ko access kar sake
router.use(requireLogin, requireRole('super_admin'));

// ─── GET license page ────────────────────────────────────────────────────
// License information page
// Current active license ko fetch karta hai (latest valid license)
router.get('/license', async (req, res) => {
  // Database se latest license fetch karna with activated_by user name
  // ORDER BY valid_until DESC LIMIT 1 - sabse latest valid license
  const [rows] = await pool.query(
    'SELECT l.*, u.name AS activated_by_name FROM crm_license l LEFT JOIN crm_users u ON u.id=l.activated_by ORDER BY l.valid_until DESC LIMIT 1'
  );
  // License page render karna with data
  res.render('license', { 
    current: rows[0] || null,  // Current license (agar nahi hai toh null)
    user: req.session.user, 
    active: 'license' 
  });
});

// ─── POST add/update license ────────────────────────────────────────────
// Naya license add karne ka endpoint
// Sirf Super Admin hi new license activate kar sakta hai
router.post('/license', async (req, res) => {
  // Request body se license_key aur valid_until extract karna
  const { license_key, valid_until } = req.body;
  
  // Validate: dono fields mandatory hain
  if (!license_key || !valid_until) return res.status(400).send('Both fields required.');
  
  // Database mein naya license insert karna
  // valid_from: CURDATE() - aaj ki date
  // activated_by: current logged-in user (Super Admin) ka ID
  await pool.query(
    'INSERT INTO crm_license (license_key,valid_from,valid_until,activated_by) VALUES (?,CURDATE(),?,?)',
    [license_key, valid_until, req.session.user.id]
  );
  
  // License page par redirect karna
  res.redirect('/super-admin/license');
});

// ─── GET manage users page ──────────────────────────────────────────────
// Saare users ki list (except Super Admin) manage karne ka page
// Sirf Super Admin hi users ko manage kar sakta hai
router.get('/users', async (req, res) => {
  // Database se saare users fetch karna except Super Admin
  // role!='super_admin' - Super Admin ko list mein nahi dikhana
  // ORDER BY role, name - role ke hisaab se pehle, phir name ke hisaab se
  const [users] = await pool.query(
    "SELECT id,name,email,role,status,created_at FROM crm_users WHERE role!='super_admin' ORDER BY role,name"
  );
  // Manage users page render karna with users list
  res.render('manage-users', { 
    users,                  // Saare users ki list (except Super Admin)
    user: req.session.user, 
    active: 'admin-powers' 
  });
});

// ─── POST update user status ────────────────────────────────────────────
// Kisi user ka status active/disabled toggle karne ka API endpoint
// Sirf Super Admin hi user status change kar sakta hai
router.post('/users/:id/status', async (req, res) => {
  // Request body se status extract karna
  const { status } = req.body;
  
  // Validate: status sirf 'active' ya 'disabled' hona chahiye
  if (!['active','disabled'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  
  // Database mein user status update karna
  // AND role!='super_admin' - Super Admin ki status change nahi kar sakte
  await pool.query(
    "UPDATE crm_users SET status=? WHERE id=? AND role!='super_admin'", 
    [status, req.params.id]
  );
  
  // Success response
  res.json({ ok: true });
});

// ─── POST update user role ──────────────────────────────────────────────
// Kisi user ka role admin/emp change karne ka API endpoint
// Sirf Super Admin hi user role change kar sakta hai
router.post('/users/:id/role', async (req, res) => {
  // Request body se role extract karna
  const { role } = req.body;
  
  // Validate: role sirf 'admin' ya 'emp' hona chahiye
  if (!['admin','emp'].includes(role)) return res.status(400).json({ error: 'Invalid role.' });
  
  // Database mein user role update karna
  // AND role!='super_admin' - Super Admin ki role change nahi kar sakte
  await pool.query(
    "UPDATE crm_users SET role=? WHERE id=? AND role!='super_admin'", 
    [role, req.params.id]
  );
  
  // Success response
  res.json({ ok: true });
});

// Export router for use in main application
// Router ko export karna taaki main app mein use kar sakein
module.exports = router;