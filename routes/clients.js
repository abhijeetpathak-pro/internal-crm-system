// Import Express framework
const express = require('express');
// Create Express router instance
const router = express.Router();
// Import database connection pool
const pool = require('../db');
// Import authentication middleware to protect routes
const { requireLogin } = require('../middleware/auth');

// ── APPLY MIDDLEWARE ──
// Employee, Admin, Superadmin sabko full access
// Ye middleware ensure karta hai ki user logged in ho
router.use(requireLogin);

// ─── GET all clients ────────────────────────────────────────────────────────
// Endpoint to fetch all clients sorted alphabetically by company name
// Saare clients ko company name ke hisaab se laata hai
router.get('/', async (req, res) => {
  try {
    // Query database for all clients ordered by company name
    const [rows] = await pool.query(
      'SELECT * FROM crm_clients ORDER BY company_name ASC'
    );
    // Return clients as JSON response
    res.json(rows);
  } catch (err) {
    // Log error for debugging
    console.error('GET clients error:', err);
    // Return 500 error to client
    res.status(500).json({ error: 'Failed to fetch clients.' });
  }
});

// ─── GET single client ─────────────────────────────────────────────────────
// Endpoint to fetch a specific client by ID
// Kisi specific client ko ID ke through fetch karta hai
router.get('/:id', async (req, res) => {
  try {
    // Query database for client with matching ID
    const [rows] = await pool.query(
      'SELECT * FROM crm_clients WHERE id = ?',
      [req.params.id]
    );
    // If no client found, return 404
    // Agar client nahi milta toh 404 error return karta hai
    if (!rows.length) return res.status(404).json({ error: 'Client not found.' });
    // Return the client data
    res.json(rows[0]);
  } catch (err) {
    console.error('GET client error:', err);
    res.status(500).json({ error: 'Failed to fetch client.' });
  }
});

// ─── POST create client ────────────────────────────────────────────────────
// Endpoint to create a new client
// Naya client create karne ke liye endpoint
router.post('/', async (req, res) => {
  // Extract client details from request body
  // Request body se client ki details extract karna
  const { company_name, website, address, email, phone } = req.body;
  
  // Validate company_name is provided
  // company_name mandatory hai, check karna
  if (!company_name) {
    return res.status(400).json({ error: 'company_name is required.' });
  }
  
  try {
    // Insert new client record into database
    // Database mein naya client insert karna
    const [r] = await pool.query(
      `INSERT INTO crm_clients 
       (company_name, website, address, email, phone, created_by) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [company_name, website || null, address || null, email || null, phone || null, req.session.user.id]
    );
    // Return success response with new client ID
    // Success response bhejna with naya client ID
    res.status(201).json({ 
      id: r.insertId, 
      company_name,
      message: 'Client added successfully!' 
    });
  } catch (err) {
    console.error('POST client error:', err);
    res.status(500).json({ error: 'Failed to create client. ' + err.message });
  }
});

// ─── PUT update client ─────────────────────────────────────────────────────
// Endpoint to update an existing client
// Existing client ko update karne ke liye endpoint
router.put('/:id', async (req, res) => {
  // Extract updated client details from request body
  // Request body se updated client details extract karna
  const { company_name, website, address, email, phone } = req.body;
  
  // Validate company_name is provided
  // company_name mandatory hai, check karna
  if (!company_name) {
    return res.status(400).json({ error: 'company_name is required.' });
  }
  
  try {
    // Update client record in database
    // Database mein client record update karna
    const [result] = await pool.query(
      `UPDATE crm_clients 
       SET company_name = ?, website = ?, address = ?, email = ?, phone = ? 
       WHERE id = ?`,
      [company_name, website || null, address || null, email || null, phone || null, req.params.id]
    );
    
    // If no rows affected, client wasn't found
    // Agar koi row affect nahi hui, matlab client nahi mila
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Client not found.' });
    }
    
    // Return success response
    res.json({ 
      ok: true,
      message: 'Client updated successfully!' 
    });
  } catch (err) {
    console.error('PUT client error:', err);
    res.status(500).json({ error: 'Failed to update client. ' + err.message });
  }
});

// ─── DELETE client ─────────────────────────────────────────────────────────
// Endpoint to delete a client (with dependency check)
// Client ko delete karne ka endpoint (pehle dependency check karega)
router.delete('/:id', async (req, res) => {
  try {
    // Check if client has any associated requirements (foreign key constraint)
    // Check karna ki client se koi requirement associated toh nahi hai
    const [requirements] = await pool.query(
      'SELECT id FROM crm_requirements WHERE client_id = ? LIMIT 1',
      [req.params.id]
    );
    
    // If requirements exist, prevent deletion to maintain data integrity
    // Agar requirements exist karti hain toh deletion prevent karna
    if (requirements.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete client. This client has associated requirements.' 
      });
    }
    
    // Delete the client from database
    // Client ko database se delete karna
    const [result] = await pool.query(
      'DELETE FROM crm_clients WHERE id = ?',
      [req.params.id]
    );
    
    // If no rows affected, client wasn't found
    // Agar koi row affect nahi hui, matlab client nahi mila
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Client not found.' });
    }
    
    // Return success response
    res.json({ 
      ok: true,
      message: 'Client deleted successfully!' 
    });
  } catch (err) {
    console.error('DELETE client error:', err);
    res.status(500).json({ error: 'Failed to delete client. ' + err.message });
  }
});

// ─── POC ROUTES ─────────────────────────────────────────────────────────────
// Nested routes for managing Points of Contact (POCs) for a client
// Client ke POCs (Points of Contact) manage karne ke liye nested routes

// ─── GET POCs for a client ────────────────────────────────────────────────
// Endpoint to fetch all POCs for a specific client
// Kisi specific client ke saare POCs fetch karne ka endpoint
router.get('/:id/pocs', async (req, res) => {
  try {
    // Query database for POCs belonging to the client
    const [rows] = await pool.query(
      'SELECT * FROM crm_pocs WHERE client_id = ? ORDER BY poc_name ASC',
      [req.params.id]
    );
    // Return POCs as JSON
    res.json(rows);
  } catch (err) {
    console.error('GET POCs error:', err);
    res.status(500).json({ error: 'Failed to fetch POCs.' });
  }
});

// ─── POST create POC ──────────────────────────────────────────────────────
// Endpoint to add a new POC for a client
// Client ke liye naya POC add karne ka endpoint
router.post('/:id/pocs', async (req, res) => {
  // Extract POC details from request body
  // Request body se POC ki details extract karna
  const { poc_name, poc_email, poc_phone } = req.body;
  
  // Validate poc_name is provided
  // poc_name mandatory hai, check karna
  if (!poc_name) {
    return res.status(400).json({ error: 'poc_name is required.' });
  }
  
  try {
    // Insert new POC record linked to client
    // Client se linked naya POC record insert karna
    const [r] = await pool.query(
      `INSERT INTO crm_pocs (client_id, poc_name, poc_email, poc_phone) 
       VALUES (?, ?, ?, ?)`,
      [req.params.id, poc_name, poc_email || null, poc_phone || null]
    );
    // Return success response with POC details
    res.status(201).json({ 
      id: r.insertId, 
      poc_name, 
      poc_email, 
      poc_phone,
      message: 'POC added successfully!' 
    });
  } catch (err) {
    console.error('POST POC error:', err);
    res.status(500).json({ error: 'Failed to add POC. ' + err.message });
  }
});

// ─── PUT update POC ────────────────────────────────────────────────────────
// Endpoint to update an existing POC
// Existing POC ko update karne ka endpoint
router.put('/:id/pocs/:pocId', async (req, res) => {
  // Extract updated POC details from request body
  // Request body se updated POC details extract karna
  const { poc_name, poc_email, poc_phone } = req.body;
  
  try {
    // Update POC record ensuring it belongs to the correct client
    // POC ko update karna, ensure karna ki yeh sahi client ka hai
    const [result] = await pool.query(
      `UPDATE crm_pocs 
       SET poc_name = ?, poc_email = ?, poc_phone = ? 
       WHERE id = ? AND client_id = ?`,
      [poc_name, poc_email || null, poc_phone || null, req.params.pocId, req.params.id]
    );
    
    // If no rows affected, POC wasn't found
    // Agar koi row affect nahi hui, matlab POC nahi mila
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'POC not found.' });
    }
    
    // Return success response
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
// Endpoint to delete a POC
// POC ko delete karne ka endpoint
router.delete('/:id/pocs/:pocId', async (req, res) => {
  try {
    // Delete POC ensuring it belongs to the correct client
    // POC ko delete karna, ensure karna ki yeh sahi client ka hai
    const [result] = await pool.query(
      'DELETE FROM crm_pocs WHERE id = ? AND client_id = ?',
      [req.params.pocId, req.params.id]
    );
    
    // If no rows affected, POC wasn't found
    // Agar koi row affect nahi hui, matlab POC nahi mila
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'POC not found.' });
    }
    
    // Return success response
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
// Router ko export karna taaki main application mein use kar sakein
module.exports = router;