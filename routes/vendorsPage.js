// Import Express framework
const express = require('express');
// Create Express router instance
const router = express.Router();
// Import database connection pool
const pool = require('../db');
// Import authentication middleware to protect routes
const { requireLogin, requireRole } = require('../middleware/auth');
const requireAdmin = requireRole('admin', 'super_admin');

// ── APPLY MIDDLEWARE ──
// Sabhi routes ke liye login mandatory hai
// Middleware ensure karta hai ki sirf logged-in users hi access kar sakein
router.use(requireLogin);

// ─── GET vendors list page ──────────────────────────────────────────────
// Saare vendors ki list dikhane wala page
// Database se saare vendors fetch karta hai (latest first)
router.get('/vendors', async (req, res) => {
  try {
    // Database se saare vendors fetch karna (created_at ke hisaab se descending)
    const [vendors] = await pool.query(
      'SELECT * FROM crm_vendors ORDER BY created_at DESC'
    );
    // vendors/list view render karna with data
    res.render('vendors/list', { 
      vendors,                  // Saare vendors ki list
      user: req.session.user,   // Current logged in user info
      active: 'vendors'         // Navigation menu mein vendors tab highlight karne ke liye
    });
  } catch (err) {
    // Agar database error aata hai toh log karna aur error page dikhana
    console.error('Vendors page error:', err);
    res.status(500).render('error', { 
      message: 'Unable to load vendor data right now.',
      user: req.session.user 
    });
  }
});

// ─── GET add vendor form ──────────────────────────────────────────────────
// Naya vendor add karne ka form page
// Sirf form render karta hai, actual insertion nahi karta
router.get('/vendors/add', requireAdmin, (req, res) => {
  // Add vendor form render karna
  res.render('vendors/add', { 
    user: req.session.user, 
    active: 'vendors' 
  });
});

// ─── GET single vendor detail page ──────────────────────────────────────
// Kisi specific vendor ki detail page
// Vendor info aur uske saare POCs dikhata hai
router.get('/vendors/:id', async (req, res) => {
  try {
    // Specific vendor ko ID ke through fetch karna
    const [vendorRows] = await pool.query(
      'SELECT * FROM crm_vendors WHERE id = ?', 
      [req.params.id]
    );
    
    // Agar vendor nahi mila toh 404 page dikhana
    if (!vendorRows.length) {
      return res.status(404).render('404', { user: req.session.user });
    }
    
    // Vendor ke saare POCs fetch karna (alphabetical order mein)
    const [pocs] = await pool.query(
      'SELECT * FROM crm_pocs WHERE vendor_id = ? ORDER BY poc_name', 
      [req.params.id]
    );
    
    // Vendor detail page render karna with all data
    res.render('vendors/detail', { 
      vendor: vendorRows[0],    // Vendor ki details
      pocs,                     // Vendor ke saare POCs
      user: req.session.user, 
      active: 'vendors' 
    });
  } catch (err) {
    // Agar database error aata hai toh log karna aur error page dikhana
    console.error('Vendor detail error:', err);
    res.status(500).render('error', { 
      message: 'Unable to load vendor data right now.',
      user: req.session.user 
    });
  }
});

// Export router for use in main application
// Router ko export karna taaki main app mein use kar sakein
module.exports = router;