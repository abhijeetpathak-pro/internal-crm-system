// Import Express framework
const express = require('express');
// Create Express router instance
const router = express.Router();
// Import authentication and role-based authorization middlewares
// requireLogin - ensure user is logged in
// requireRole - ensure user has specific role(s)
const { requireLogin, requireRole } = require('../middleware/auth');

// ─── GET add member form ──────────────────────────────────────────────────
// Naya member (user) add karne ka form page
// Sirf Admin aur Super Admin ko hi access hai
// requireLogin - user logged in hona chahiye
// requireRole('admin','super_admin') - user ka role admin ya super_admin hona chahiye
router.get('/members/add', requireLogin, requireRole('admin','super_admin'), (req, res) => {
  // Add member form render karna
  // user: req.session.user se current logged-in user ki info pass kar rahe hain
  // active: 'members' se navigation menu mein members tab highlight hoga
  res.render('members-add', { 
    user: req.session.user, 
    active: 'members' 
  });
});

// Export router for use in main application
// Router ko export karna taaki main app mein use kar sakein
module.exports = router;