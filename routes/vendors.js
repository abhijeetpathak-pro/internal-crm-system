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
// Employee, Admin, Superadmin sabko full access
// Middleware ensure karta hai ki sirf logged-in users hi access kar sakein
router.use(requireLogin);

// ─── GET all vendors ───────────────────────────────────────────────────────
// Saare vendors ki list fetch karne ka API endpoint
// Vendor name ke hisaab se alphabetical order mein
router.get('/', async (req, res) => {
  try {
    // Database se saare vendors fetch karna (alphabetical order)
    const [rows] = await pool.query(
      'SELECT * FROM crm_vendors ORDER BY vendor_name ASC'
    );
    // Vendors ki list JSON format mein return karna
    res.json(rows);
  } catch (err) {
    // Log error for debugging
    console.error('GET vendors error:', err);
    // Return 500 error to client
    res.status(500).json({ error: 'Failed to fetch vendors.' });
  }
});

// ─── GET single vendor ────────────────────────────────────────────────────
// Kisi specific vendor ko ID ke through fetch karne ka API endpoint
router.get('/:id', async (req, res) => {
  try {
    // Database se vendor ko ID ke through fetch karna
    const [rows] = await pool.query(
      'SELECT * FROM crm_vendors WHERE id = ?',
      [req.params.id]
    );
    // Agar vendor nahi mila toh 404 error
    if (!rows.length) return res.status(404).json({ error: 'Vendor not found.' });
    // Vendor data return karna
    res.json(rows[0]);
  } catch (err) {
    console.error('GET vendor error:', err);
    res.status(500).json({ error: 'Failed to fetch vendor.' });
  }
});

// ─── POST create vendor ───────────────────────────────────────────────────
// Naya vendor create karne ka API endpoint
router.post('/', requireAdmin, async (req, res) => {
  // Request body se vendor details extract karna
  const { vendor_name, short_code, website, address, email, phone } = req.body;
  
  // Validate: vendor_name mandatory hai
  if (!vendor_name) {
    return res.status(400).json({ error: 'vendor_name is required.' });
  }
  
  // Validate: short_code mandatory hai
  if (!short_code) {
    return res.status(400).json({ error: 'short_code is required.' });
  }
  
  try {
    // Database mein naya vendor insert karna
    // Optional fields: website, address, email, phone (null set karna agar nahi hai)
    const [r] = await pool.query(
      `INSERT INTO crm_vendors 
       (vendor_name, short_code, website, address, email, phone, created_by) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [vendor_name, short_code, website || null, address || null, email || null, phone || null, req.session.user.id]
    );
    // Success response - naya vendor ID, name, short_code return karna
    res.status(201).json({ 
      id: r.insertId, 
      vendor_name,
      short_code,
      message: 'Vendor added successfully!' 
    });
  } catch (err) {
    console.error('POST vendor error:', err);
    res.status(500).json({ error: 'Failed to create vendor.' });
  }
});

// ─── PUT update vendor ────────────────────────────────────────────────────
// Existing vendor ko update karne ka API endpoint
router.put('/:id', requireAdmin, async (req, res) => {
  // Request body se updated vendor details extract karna
  const { vendor_name, short_code, website, address, email, phone } = req.body;
  
  // Validate: vendor_name mandatory hai update ke liye
  if (!vendor_name) {
    return res.status(400).json({ error: 'vendor_name is required.' });
  }
  
  try {
    // Database mein vendor update karna
    const [result] = await pool.query(
      `UPDATE crm_vendors 
       SET vendor_name = ?, short_code = ?, website = ?, address = ?, email = ?, phone = ? 
       WHERE id = ?`,
      [vendor_name, short_code, website || null, address || null, email || null, phone || null, req.params.id]
    );
    
    // Agar koi row affect nahi hui, matlab vendor nahi mila
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Vendor not found.' });
    }
    
    // Success response
    res.json({ 
      ok: true,
      message: 'Vendor updated successfully!' 
    });
  } catch (err) {
    console.error('PUT vendor error:', err);
    res.status(500).json({ error: 'Failed to update vendor.' });
  }
});

// ─── DELETE vendor ────────────────────────────────────────────────────────
// Vendor ko delete karne ka API endpoint (with dependency check)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    // Check: Vendor se associated resources toh nahi hain?
    const [resources] = await pool.query(
      'SELECT id FROM crm_resources WHERE vendor_id = ? LIMIT 1',
      [req.params.id]
    );
    
    // Agar resources exist karte hain toh deletion prevent karna
    if (resources.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete vendor. This vendor has associated resources.' 
      });
    }
    
    // Vendor ko database se delete karna
    const [result] = await pool.query(
      'DELETE FROM crm_vendors WHERE id = ?',
      [req.params.id]
    );
    
    // Agar koi row affect nahi hui, matlab vendor nahi mila
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Vendor not found.' });
    }
    
    // Success response
    res.json({ 
      ok: true,
      message: 'Vendor deleted successfully!' 
    });
  } catch (err) {
    console.error('DELETE vendor error:', err);
    res.status(500).json({ error: 'Failed to delete vendor.' });
  }
});

// ─── POC ROUTES ─────────────────────────────────────────────────────────────
// Vendor ke POCs (Points of Contact) manage karne ke liye nested routes

// ─── GET POCs for a vendor ────────────────────────────────────────────────
// Kisi specific vendor ke saare POCs fetch karne ka endpoint
router.get('/:id/pocs', async (req, res) => {
  try {
    // Database se vendor_id ke hisaab se POCs fetch karna (alphabetical)
    const [rows] = await pool.query(
      'SELECT * FROM crm_pocs WHERE vendor_id = ? ORDER BY poc_name ASC',
      [req.params.id]
    );
    // POCs ki list return karna
    res.json(rows);
  } catch (err) {
    console.error('GET POCs error:', err);
    res.status(500).json({ error: 'Failed to fetch POCs.' });
  }
});

// ─── POST create POC ──────────────────────────────────────────────────────
// Vendor ke liye naya POC add karne ka endpoint
router.post('/:id/pocs', requireAdmin, async (req, res) => {
  // Request body se POC details extract karna
  const { poc_name, poc_email, poc_phone } = req.body;
  
  // Validate: poc_name mandatory hai
  if (!poc_name) {
    return res.status(400).json({ error: 'poc_name is required.' });
  }
  
  try {
    // Database mein naya POC insert karna (vendor se linked)
    const [r] = await pool.query(
      `INSERT INTO crm_pocs (vendor_id, poc_name, poc_email, poc_phone) 
       VALUES (?, ?, ?, ?)`,
      [req.params.id, poc_name, poc_email || null, poc_phone || null]
    );
    // Success response
    res.status(201).json({ 
      id: r.insertId, 
      poc_name, 
      poc_email, 
      poc_phone,
      message: 'POC added successfully!' 
    });
  } catch (err) {
    console.error('POST POC error:', err);
    res.status(500).json({ error: 'Failed to add POC.' });
  }
});

// ─── PUT update POC ────────────────────────────────────────────────────────
// Existing POC ko update karne ka endpoint
router.put('/:id/pocs/:pocId', requireAdmin, async (req, res) => {
  // Request body se updated POC details extract karna
  const { poc_name, poc_email, poc_phone } = req.body;
  
  try {
    // POC update karna, ensure karna ki yeh sahi vendor ka hai
    const [result] = await pool.query(
      `UPDATE crm_pocs 
       SET poc_name = ?, poc_email = ?, poc_phone = ? 
       WHERE id = ? AND vendor_id = ?`,
      [poc_name, poc_email || null, poc_phone || null, req.params.pocId, req.params.id]
    );
    
    // Agar koi row affect nahi hui, matlab POC nahi mila
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'POC not found.' });
    }
    
    // Success response
    res.json({ 
      ok: true,
      message: 'POC updated successfully!' 
    });
  } catch (err) {
    console.error('PUT POC error:', err);
    res.status(500).json({ error: 'Failed to update POC.' });
  }
});

// ─── DELETE POC ────────────────────────────────────────────────────────────
// POC ko delete karne ka endpoint
router.delete('/:id/pocs/:pocId', requireAdmin, async (req, res) => {
  try {
    // POC delete karna, ensure karna ki yeh sahi vendor ka hai
    const [result] = await pool.query(
      'DELETE FROM crm_pocs WHERE id = ? AND vendor_id = ?',
      [req.params.pocId, req.params.id]
    );
    
    // Agar koi row affect nahi hui, matlab POC nahi mila
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'POC not found.' });
    }
    
    // Success response
    res.json({ 
      ok: true,
      message: 'POC deleted successfully!' 
    });
  } catch (err) {
    console.error('DELETE POC error:', err);
    res.status(500).json({ error: 'Failed to delete POC.' });
  }
});

// Export router for use in main application
// Router ko export karna taaki main app mein use kar sakein
module.exports = router;