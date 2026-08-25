// LEADS API ROUTES
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);
const LEAD_SOURCES = ['Email', 'LinkedIn', 'Website'];

// ─── POST create lead ─────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { name, email, phone, source } = req.body;
  const cleanName = typeof name === 'string' ? name.trim() : '';
  const cleanSource = source || 'Email';

  if (!cleanName || cleanName.length > 255 || !LEAD_SOURCES.includes(cleanSource)) {
    return res.status(400).json({ error: 'Valid name and source are required.' });
  }

  try {
    const [result] = await pool.query(
      'INSERT INTO crm_leads (name, email, phone, source, created_by) VALUES (?, ?, ?, ?, ?)',
      [cleanName, email || null, phone || null, cleanSource, req.session.user.id]
    );
    res.status(201).json({ id: result.insertId, name: cleanName });
  } catch (err) {
    console.error('POST lead error:', err);
    res.status(500).json({ error: 'Failed to create lead.' });
  }
});

// ─── GET all leads ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const [leads] = await pool.query(
      `SELECT l.*, u.name AS created_by_name
       FROM crm_leads l
       LEFT JOIN crm_users u ON u.id = l.created_by
       ORDER BY l.created_at DESC`
    );
    res.json({ success: true, leads });
  } catch (err) {
    console.error('GET leads error:', err);
    res.status(500).json({ error: 'Failed to fetch leads.' });
  }
});

// ─── GET single lead ──────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT l.*, u.name AS created_by_name
       FROM crm_leads l
       LEFT JOIN crm_users u ON u.id = l.created_by
       WHERE l.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Lead not found.' });
    res.json({ success: true, lead: rows[0] });
  } catch (err) {
    console.error('GET lead error:', err);
    res.status(500).json({ error: 'Failed to fetch lead.' });
  }
});

// ─── PUT update lead ──────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const { name, email, phone, source } = req.body;
  const cleanName = typeof name === 'string' ? name.trim() : '';
  const cleanSource = source || 'Email';

  if (!cleanName || cleanName.length > 255 || !LEAD_SOURCES.includes(cleanSource)) {
    return res.status(400).json({ error: 'Valid name and source are required.' });
  }

  try {
    const [existing] = await pool.query('SELECT id FROM crm_leads WHERE id = ?', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Lead not found.' });

    await pool.query(
      'UPDATE crm_leads SET name = ?, email = ?, phone = ?, source = ? WHERE id = ?',
      [cleanName, email || null, phone || null, cleanSource, req.params.id]
    );
    res.json({ success: true, message: 'Lead updated successfully!' });
  } catch (err) {
    console.error('PUT lead error:', err);
    res.status(500).json({ error: 'Failed to update lead.' });
  }
});

// ─── DELETE lead ──────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const [existing] = await pool.query('SELECT id FROM crm_leads WHERE id = ?', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Lead not found.' });

    await pool.query('DELETE FROM crm_leads WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Lead deleted successfully!' });
  } catch (err) {
    console.error('DELETE lead error:', err);
    res.status(500).json({ error: 'Failed to delete lead.' });
  }
});

module.exports = router;
