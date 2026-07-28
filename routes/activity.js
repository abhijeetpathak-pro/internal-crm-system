// Import Express framework
const express = require('express');
// Create Express router instance
const router = express.Router();
// Import database connection pool
const pool = require('../db');

// POST endpoint to create a new activity log entry
router.post('/', async (req, res) => {
  // Extract fields from request body
  const { entity_type, entity_id, note, ref_resource_id, ref_client_id } = req.body;
  
  // Validate: entity_type must be valid, entity_id and note are required
  if (!['requirement','resource','lead'].includes(entity_type) || !entity_id || !note)
    // Return 400 error if validation fails
    return res.status(400).json({ error: 'entity_type, entity_id, and note are required.' });
  
  try {
    // Insert new activity log record into database
    const [r] = await pool.query(
      'INSERT INTO crm_activity_logs (entity_type,entity_id,note,ref_resource_id,ref_client_id,created_by) VALUES (?,?,?,?,?,?)',
      [entity_type, entity_id, note, ref_resource_id || null, ref_client_id || null, req.session.user.id]
    );
    // Return 201 with the ID of newly created record
    res.status(201).json({ id: r.insertId });
  } catch (err) { 
    // Return 500 if database operation fails
    res.status(500).json({ error: 'Failed to add update.' }); 
  }
});

// Export router for use in main application
module.exports = router;