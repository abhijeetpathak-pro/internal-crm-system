const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

// ─── GET all leads ────────────────────────────────────────────────────────
router.get('/leads', async (req, res) => {
  try {
    const [leads] = await pool.query(
      `SELECT l.*, u.name AS created_by_name 
       FROM crm_leads l
       LEFT JOIN crm_users u ON u.id = l.created_by
       ORDER BY l.created_at DESC`
    );

    res.render('leads/list', {
      leads: leads,
      user: req.session.user,
      active: 'leads'
    });
  } catch (err) {
    console.error('GET leads error:', err);
    res.status(500).render('error', {
      message: 'Database error: ' + err.message,
      user: req.session.user
    });
  }
});

// ─── GET add lead form ──────────────────────────────────────────────────
router.get('/leads/add', (req, res) => {
  res.render('leads/add', {
    user: req.session.user,
    active: 'leads',
    isEdit: false,
    lead: null
  });
});

// ─── GET edit lead form ──────────────────────────────────────────────────
router.get('/leads/edit/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM crm_leads WHERE id = ?', [req.params.id]);

    if (!rows.length) {
      return res.status(404).render('404', { user: req.session.user });
    }

    res.render('leads/add', {
      user: req.session.user,
      active: 'leads',
      lead: rows[0],
      isEdit: true
    });
  } catch (err) {
    console.error('GET edit lead error:', err);
    res.status(500).render('error', {
      message: 'Database error: ' + err.message,
      user: req.session.user
    });
  }
});

// ─── GET single lead detail ─────────────────────────────────────────────
router.get('/leads/:id', async (req, res) => {
  try {
    const [leadRows] = await pool.query(
      `SELECT l.*, u.name AS created_by_name 
       FROM crm_leads l
       LEFT JOIN crm_users u ON u.id = l.created_by
       WHERE l.id = ?`,
      [req.params.id]
    );

    if (!leadRows.length) {
      return res.status(404).render('404', { user: req.session.user });
    }

    const [activity] = await pool.query(
      `SELECT a.*, u.name AS created_by_name 
       FROM crm_activity_logs a
       LEFT JOIN crm_users u ON u.id = a.created_by
       WHERE a.entity_type = 'lead' AND a.entity_id = ?
       ORDER BY a.created_at DESC`,
      [req.params.id]
    );

    res.render('leads/detail', {
      lead: leadRows[0],
      activity: activity,
      user: req.session.user,
      active: 'leads'
    });
  } catch (err) {
    console.error('GET lead detail error:', err);
    res.status(500).render('error', {
      message: 'Database error: ' + err.message,
      user: req.session.user
    });
  }
});

module.exports = router;