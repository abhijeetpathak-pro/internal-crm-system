// Import Express framework
const express = require('express');
// Create Express router instance
const router = express.Router();
// Import authentication middleware to protect routes
const { requireLogin } = require('../middleware/auth');

// GET route for dashboard page
// Dashboard page render karne ke liye GET endpoint
// requireLogin middleware ensure karta hai ki sirf logged-in users hi access kar sakein
router.get('/dashboard', requireLogin, (req, res) => {
  // Dashboard view render karna with user session data
  // user: req.session.user se current logged-in user ki info pass kar rahe hain
  // active: 'dashboard' se navigation menu mein dashboard tab highlight hoga
  res.render('dashboard', { 
    user: req.session.user,  // Current logged in user ki information
    active: 'dashboard'      // Active menu item highlight karne ke liye
  });
});

// Export router for use in main application
// Router ko export karna taaki main app mein use kar sakein
module.exports = router;