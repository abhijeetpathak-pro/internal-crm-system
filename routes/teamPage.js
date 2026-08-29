// Import Express framework
const express = require('express');
// Create Express router instance
const router = express.Router();
// Import bcrypt for password hashing
const bcrypt = require('bcryptjs');
// Import database connection pool
const pool = require('../db');
// Import authentication and role-based authorization middlewares
const { requireLogin, requireRole } = require('../middleware/auth');

// ─── GET team page ──────────────────────────────────────────────────────
// Team members ki list dikhane wala page
// Admin: Sirf Employees dekhta hai (Fix 9, 10)
// Super Admin: Admin aur Employees dekhta hai; Super Admin accounts hidden rehte hain
router.get('/team', requireLogin, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    let query;
    
    // Super Admin has the highest permissions but remains hidden from all user lists.
    if (req.session.user.role === 'super_admin') {
      query = `SELECT u.id, u.name, u.email, u.role, u.status, u.created_at,
                      c.name AS created_by_name
               FROM crm_users u
               LEFT JOIN crm_users c ON c.id = u.created_by
               WHERE u.role != 'super_admin'
               ORDER BY FIELD(u.role,'admin','emp'), u.name`;
    } else {
      // Admin: sees only Emp — NOT Super Admin, NOT other Admins
      // Admin ko sirf Employees dikhenge (Super Admin aur other Admins nahi)
      query = `SELECT u.id, u.name, u.email, u.role, u.status, u.created_at,
                      c.name AS created_by_name
               FROM crm_users u
               LEFT JOIN crm_users c ON c.id = u.created_by
               WHERE u.role = 'emp'
               ORDER BY u.name`;
    }
    const [members] = await pool.query(query);

    // Count summary for Super Admin only
    // Sirf Super Admin ko role-wise count summary dikhega
    let counts = null;
    if (req.session.user.role === 'super_admin') {
      const [c] = await pool.query(
        `SELECT
          SUM(role='super_admin') AS super_admins,
          SUM(role='admin')       AS admins,
          SUM(role='emp')         AS emps
         FROM crm_users`
      );
      counts = c[0];
    }

    // Team page render karna with data
    res.render('team', { 
      members,              // Users ki list
      counts,               // Role-wise count (only for Super Admin)
      user: req.session.user, 
      active: 'team' 
    });
  } catch (err) {
    console.error('Team page error:', err);
    res.status(500).send('Internal server error.');
  }
});

// ─── POST reset user password ──────────────────────────────────────────
// Kisi user ka password reset karne ka API endpoint (Fix 2)
// Admin: Sirf Employee ka password reset kar sakta hai
// Super Admin: Kisi bhi user ka password reset kar sakta hai
router.post('/api/team/:id/reset-password', requireLogin, requireRole('admin', 'super_admin'), async (req, res) => {
  // Request body se new_password extract karna
  const { new_password } = req.body;
  
  // Validate: password minimum 6 characters
  if (!new_password || new_password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  // Check karna ki user exist karta hai ya nahi
  const [rows] = await pool.query('SELECT role FROM crm_users WHERE id=?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'User not found.' });

  // Admin sirf Employee ka password reset kar sakta hai
  if (req.session.user.role === 'admin' && rows[0].role !== 'emp')
    return res.status(403).json({ error: 'Admins can only reset Employee passwords.' });

  try {
    // New password ko hash karna aur database mein update karna
    const hash = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE crm_users SET password_hash=? WHERE id=?', [hash, req.params.id]);
    // Success response
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset password.' });
  }
});

// ─── POST update user status ────────────────────────────────────────────
// User ko enable/disable karne ka API endpoint
// Sirf Super Admin hi user status change kar sakta hai
router.post('/api/team/:id/status', requireLogin, requireRole('super_admin'), async (req, res) => {
  // Request body se status extract karna
  const { status } = req.body;
  
  // Validate: status sirf 'active' ya 'disabled' hona chahiye
  if (!['active', 'disabled'].includes(status))
    return res.status(400).json({ error: 'Invalid status.' });
  
  try {
    // Database mein user status update karna
    // AND role!='super_admin' - Super Admin ki status change nahi kar sakte
    await pool.query(
      "UPDATE crm_users SET status=? WHERE id=? AND role!='super_admin'", 
      [status, req.params.id]
    );
    // Success response
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update status.' });
  }
});

// ─── POST update user role ──────────────────────────────────────────────
// User ka role change karne ka API endpoint
// Sirf Super Admin hi user role change kar sakta hai
router.post('/api/team/:id/role', requireLogin, requireRole('super_admin'), async (req, res) => {
  // Request body se role extract karna
  const { role } = req.body;
  
  // Validate: role sirf 'admin' ya 'emp' hona chahiye
  if (!['admin', 'emp'].includes(role))
    return res.status(400).json({ error: 'Role must be admin or emp.' });
  
  try {
    // Database mein user role update karna
    // AND role!='super_admin' - Super Admin ki role change nahi kar sakte
    await pool.query(
      "UPDATE crm_users SET role=? WHERE id=? AND role!='super_admin'", 
      [role, req.params.id]
    );
    // Success response
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update role.' });
  }
});

// ─── DELETE user ─────────────────────────────────────────────────────────
// User ko delete karne ka API endpoint (Fix 8)
// Was Super Admin-only. Now Admin can delete the Employee accounts they
// manage too — same permission pattern already used above for
// reset-password and role-change: Admin is limited to role='emp', Super
// Admin can delete anyone except other super admins or themselves.
// Admin: Sirf Employee delete kar sakta hai
// Super Admin: Kisi ko bhi delete kar sakta hai (except other Super Admins aur khud ko)
router.delete('/api/team/:id', requireLogin, requireRole('admin', 'super_admin'), async (req, res) => {
  // Check: User apna khud ka account delete nahi kar sakta
  if (parseInt(req.params.id) === req.session.user.id)
    return res.status(400).json({ error: 'You cannot delete your own account.' });

  // Check karna ki user exist karta hai aur uska role kya hai
  const [rows] = await pool.query('SELECT role FROM crm_users WHERE id=?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'User not found.' });
  
  // Super Admin accounts cannot be deleted
  if (rows[0].role === 'super_admin')
    return res.status(403).json({ error: 'Super Admin accounts cannot be deleted.' });

  // Admin sirf Employee delete kar sakta hai
  if (req.session.user.role === 'admin' && rows[0].role !== 'emp')
    return res.status(403).json({ error: 'Admins can only delete Employee accounts.' });

  try {
    // User ko database se delete karna
    await pool.query('DELETE FROM crm_users WHERE id=?', [req.params.id]);
    // Success response
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete member.' });
  }
});

// Export router for use in main application
// Router ko export karna taaki main app mein use kar sakein
module.exports = router;