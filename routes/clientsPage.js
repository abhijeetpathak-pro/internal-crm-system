// Import Express framework
const express = require('express');
// Create Express router instance
const router = express.Router();
// Import database connection pool
const pool = require('../db');
// Import authentication middleware to protect routes
const { requireLogin } = require('../middleware/auth');

// ── Sabhi ko access ──
// Har route ke liye login mandatory hai
// Middleware ensure karta hai ki user logged in ho
router.use(requireLogin);

// ─── Clients List ───
// Saare clients ki list dikhane wala page
// Database se saare clients fetch karta hai aur list view render karta hai
router.get('/clients', async (req, res) => {
  try {
    // Database se saare clients fetch karna (latest first)
    // created_at ke hisaab se descending order mein
    const [clients] = await pool.query(
      'SELECT * FROM crm_clients ORDER BY created_at DESC'
    );
    // clients/list view render karna with data
    res.render('clients/list', { 
      clients,           // Saare clients ki list
      user: req.session.user,  // Current logged in user info
      active: 'clients'  // Navigation menu mein active tab highlight karne ke liye
    });
  } catch (err) {
    // Agar database error aata hai toh log karna
    console.error('Clients page error:', err);
    // Error page render karna with message
    res.status(500).render('error', { 
      message: 'Database error: ' + err.message, 
      user: req.session.user 
    });
  }
});

// ─── Add Client ───
// Naya client add karne ka form page
// Sirf form render karta hai, actual insertion nahi karta
router.get('/clients/add', (req, res) => {
  // Add client form render karna
  res.render('clients/add', { 
    user: req.session.user, 
    active: 'clients' 
  });
});

// ─── Client Detail ───
// Kisi specific client ki detail page
// Client info aur uske saare POCs dikhata hai
router.get('/clients/:id', async (req, res) => {
  try {
    // Specific client ko ID ke through fetch karna
    const [clientRows] = await pool.query(
      'SELECT * FROM crm_clients WHERE id = ?', 
      [req.params.id]
    );
    
    // Agar client nahi mila toh 404 page dikhana
    if (!clientRows.length) {
      return res.status(404).render('404', { user: req.session.user });
    }
    
    // Client ke saare POCs fetch karna (alphabetical order mein)
    const [pocs] = await pool.query(
      'SELECT * FROM crm_pocs WHERE client_id = ? ORDER BY poc_name', 
      [req.params.id]
    );
    
    // Client detail page render karna with all data
    res.render('clients/detail', { 
      client: clientRows[0],  // Client ki details
      pocs,                   // Client ke saare POCs
      user: req.session.user, 
      active: 'clients' 
    });
  } catch (err) {
    // Agar database error aata hai toh log karna
    console.error('Client detail error:', err);
    // Error page render karna with message
    res.status(500).render('error', { 
      message: 'Database error: ' + err.message, 
      user: req.session.user 
    });
  }
});

// Export router for use in main application
// Router ko export karna taaki main app mein use kar sakein
module.exports = router;