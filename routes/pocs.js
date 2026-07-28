// Import Express framework
const express = require('express');
// Create Express router instance
const router = express.Router();
// Import database connection pool
const pool = require('../db');

// ─── GET POCs by vendor ID ────────────────────────────────────────────────
// Kisi specific vendor ke saare POCs (Points of Contact) fetch karne ka endpoint
// Vendor ID ke through uske associated POCs ki list laata hai
router.get('/vendor/:vendor_id', async (req, res) => {
  try {
    // Database se vendor_id ke hisaab se POCs fetch karna
    // Sirf id, poc_name, poc_email, poc_phone columns select kar rahe hain
    // ORDER BY poc_name se alphabetical order mein aayenge
    const [rows] = await pool.query(
      'SELECT id,poc_name,poc_email,poc_phone FROM crm_pocs WHERE vendor_id=? ORDER BY poc_name',
      [req.params.vendor_id]
    );
    // POCs ki list JSON format mein return karna
    res.json(rows);
  } catch (err) { 
    // Agar database error aata hai toh 500 error return karna
    res.status(500).json({ error: 'Failed to fetch vendor POCs.' }); 
  }
});

// ─── GET POCs by client ID ────────────────────────────────────────────────
// Kisi specific client ke saare POCs (Points of Contact) fetch karne ka endpoint
// Client ID ke through uske associated POCs ki list laata hai
router.get('/:client_id', async (req, res) => {
  try {
    // Database se client_id ke hisaab se POCs fetch karna
    // Sirf id, poc_name, poc_email, poc_phone columns select kar rahe hain
    // ORDER BY poc_name se alphabetical order mein aayenge
    const [rows] = await pool.query(
      'SELECT id,poc_name,poc_email,poc_phone FROM crm_pocs WHERE client_id=? ORDER BY poc_name',
      [req.params.client_id]
    );
    // POCs ki list JSON format mein return karna
    res.json(rows);
  } catch (err) { 
    // Agar database error aata hai toh 500 error return karna
    res.status(500).json({ error: 'Failed to fetch POCs.' }); 
  }
});

// Export router for use in main application
// Router ko export karna taaki main app mein use kar sakein
module.exports = router;