// Import Express framework
const express = require('express');
// Create Express router instance
const router = express.Router();
// Import bcrypt for password hashing
const bcrypt = require('bcryptjs');
// Import database connection pool
const pool = require('../db');
// Import role-based authorization middleware
const { requireRole } = require('../middleware/auth');

// ─── POST create new user ──────────────────────────────────────────────────
// Naya user (member) create karne ka API endpoint
// Admin: Sirf Employee (emp) create kar sakta hai
// Super Admin: Admin aur Employee dono create kar sakta hai
router.post('/', requireRole('admin','super_admin'), async (req, res) => {
  // Request body se user details extract karna
  const { name, email, password, role } = req.body;
  
  // Validate: Saare fields mandatory hain
  if (!name || !email || !password || !role)
    return res.status(400).json({ error: 'name, email, password, and role are required.' });
  
  // Role-based permission check:
  // Super Admin: 'admin' aur 'emp' dono bana sakta hai
  // Admin: Sirf 'emp' bana sakta hai
  const allowed = req.session.user.role === 'super_admin' ? ['admin','emp'] : ['emp'];
  if (!allowed.includes(role))
    return res.status(403).json({ error: `Your role cannot create a '${role}' account.` });
  
  try {
    // Password ko hash karna (bcrypt with salt rounds 10)
    const hash = await bcrypt.hash(password, 10);
    
    // Database mein naya user insert karna
    // status: default 'active' set karna
    // created_by: current logged-in user ka ID (who created this user)
    const [r] = await pool.query(
      'INSERT INTO crm_users (name,email,password_hash,role,status,created_by) VALUES (?,?,?,?,"active",?)',
      [name, email, hash, role, req.session.user.id]
    );
    
    // Success response - naye user ka ID, name, email, role return karna
    res.status(201).json({ 
      id: r.insertId, 
      name, 
      email, 
      role 
    });
  } catch (err) {
    // Agar email already exist karta hai toh duplicate entry error
    if (err.code === 'ER_DUP_ENTRY') 
      return res.status(409).json({ error: 'Email already exists.' });
    
    // Any other database error
    res.status(500).json({ error: 'Failed to create user.' });
  }
});

// Export router for use in main application
// Router ko export karna taaki main app mein use kar sakein
module.exports = router;