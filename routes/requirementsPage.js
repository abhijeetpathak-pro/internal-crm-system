/**
 * ─────────────────────────────────────────────────────────────────────────────
 * REQUIREMENT MANAGEMENT ROUTER
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles all Requirement-related Page Views and API endpoints.
 * Includes Role-Based Access Controls (RBAC), Cascading Deletes, and
 * Safe Database Updates matching exact table schema.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const express = require('express');
const router = express.Router();
const pool = require('../db'); // MySQL Database Pool Connection
const { requireLogin } = require('../middleware/auth'); // Authentication Guard Middleware

// ── Global Security: Ensure User is Logged In for all routes in this file ──
router.use(requireLogin);

/**
 * ─── 1. GET /requirements ────────────────────────────────────────────────────
 * View: Requirements Main List Page
 * Description: Fetches requirements grouped by creation date (YYYY-MM-DD).
 */
router.get('/requirements', async (req, res) => {
  try {
    const user = req.session.user; // Get logged-in user context from session

    let sql = `SELECT r.*, c.company_name, u.name AS submitted_by_name 
               FROM crm_requirements r
               LEFT JOIN crm_clients c ON c.id = r.client_id
               LEFT JOIN crm_users u ON u.id = r.created_by`;

    const params = [];

    // Role Filter: Limit standard employees to their own created records
    if (user.role === 'emp') {
      sql += ' WHERE r.created_by = ?';
      params.push(user.id);
    }

    // Always sort by latest creation date first
    sql += ' ORDER BY r.created_at DESC';

    const [requirements] = await pool.query(sql, params);

    // Grouping Logic: Map requirements under formatted date headers
    const groups = [];
    const groupByKey = new Map();

    for (const r of requirements) {
      const d = new Date(r.created_at);
      const key = d.toISOString().slice(0, 10); // Standard YYYY-MM-DD key

      if (!groupByKey.has(key)) {
        const label = d.toLocaleDateString('en-IN', { 
          day: '2-digit', 
          month: 'long', 
          year: 'numeric' 
        });
        const group = { key, label, requirements: [] };
        groupByKey.set(key, group);
        groups.push(group);
      }
      groupByKey.get(key).requirements.push(r);
    }

    res.render('requirements/list', { 
      groups, 
      user, 
      active: 'requirements' 
    });
  } catch (err) {
    console.error('Fetch requirements error:', err);
    res.status(500).render('error', {
      message: 'Database error: ' + err.message,
      user: req.session.user
    });
  }
});

/**
 * ─── 1b. GET /results & /requirements/results ────────────────────────────────
 * View: Shared Requirements Pipeline & Candidate Level Mapping Results Page
 * Description: Fetches ONLY shared requirements (is_shared = 1) along with their mapped candidates & interview stages.
 */
router.get(['/results', '/requirements/results', '/view-result', '/view-results'], async (req, res) => {
  try {
    const user = req.session.user;

    let sql = `SELECT r.id, r.title, r.status, r.budget, r.location, r.created_at, r.is_shared,
                      c.company_name, u.name AS submitted_by_name
               FROM crm_requirements r
               LEFT JOIN crm_clients c ON c.id = r.client_id
               LEFT JOIN crm_users u ON u.id = r.created_by
               WHERE r.is_shared = 1`;

    const params = [];

    // Role Filter: Limit standard employees to their own created records
    if (user.role === 'emp') {
      sql += ' AND r.created_by = ?';
      params.push(user.id);
    }

    // Sort latest first
    sql += ' ORDER BY r.created_at DESC';

    const [requirements] = await pool.query(sql, params);

    // Fetch mapped resources for all shared requirements
    if (requirements.length > 0) {
      const reqIds = requirements.map(r => r.id);
      const [resRows] = await pool.query(
        `SELECT rr.requirement_id, rr.stage, res.id AS resource_id, res.resource_name, res.unique_uid, res.skills
         FROM crm_requirement_resources rr
         JOIN crm_resources res ON res.id = rr.resource_id
         WHERE rr.requirement_id IN (?)
         ORDER BY rr.created_at ASC`,
        [reqIds]
      );

      const resMap = new Map();
      for (const row of resRows) {
        if (!resMap.has(row.requirement_id)) {
          resMap.set(row.requirement_id, []);
        }
        resMap.get(row.requirement_id).push(row);
      }

      for (const r of requirements) {
        r.mappedResources = resMap.get(r.id) || [];
      }
    }

    res.render('requirements/results', {
      requirements,
      user,
      active: 'results'
    });
  } catch (err) {
    console.error('Fetch results error:', err);
    res.status(500).render('error', {
      message: 'Unable to load results data right now: ' + err.message,
      user: req.session.user
    });
  }
});

/**
 * ─── 2. GET /requirements/add ────────────────────────────────────────────────
 * View: Add New Requirement Page
 */
router.get('/requirements/add', async (req, res) => {
  try {
    const [clients] = await pool.query(
      'SELECT id, company_name FROM crm_clients ORDER BY company_name'
    );
    
    res.render('requirements/add', { 
      user: req.session.user, 
      active: 'requirements',
      clients: clients,
      isEdit: false
    });
  } catch (err) {
    console.error('Add requirement page error:', err);
    res.status(500).render('error', {
      message: 'Database error: ' + err.message,
      user: req.session.user
    });
  }
});

/**
 * ─── 3. GET /requirements/edit/:id ───────────────────────────────────────────
 * View: Full Standalone Page Requirement Editor
 */
router.get('/requirements/edit/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.*, c.id AS client_id, p.id AS poc_id 
       FROM crm_requirements r
       LEFT JOIN crm_clients c ON c.id = r.client_id
       LEFT JOIN crm_pocs p ON p.id = r.poc_id
       WHERE r.id = ?`,
      [req.params.id]
    );

    if (!rows.length) {
      return res.status(404).render('404', { user: req.session.user });
    }

    const isAdmin = req.session.user.role === 'admin' || req.session.user.role === 'super_admin';
    if (!isAdmin && rows[0].created_by !== req.session.user.id) {
      return res.status(403).render('error', {
        message: 'You do not have permission to edit this requirement.',
        user: req.session.user
      });
    }

    const [clients] = await pool.query(
      'SELECT id, company_name FROM crm_clients ORDER BY company_name'
    );

    const [pocs] = await pool.query(
      'SELECT id, poc_name FROM crm_pocs WHERE client_id = ? ORDER BY poc_name',
      [rows[0].client_id]
    );

    res.render('requirements/add', {
      user: req.session.user,
      active: 'requirements',
      requirement: rows[0],
      clients: clients,
      pocs: pocs,
      isEdit: true
    });

  } catch (err) {
    console.error('Edit requirement error:', err);
    res.status(500).render('error', {
      message: 'Database error: ' + err.message,
      user: req.session.user
    });
  }
});

/**
 * ─── 4. API: GET /api/requirements/:id ───────────────────────────────────────
 * API: Fetch single requirement details for AJAX Edit Modal
 */
router.get('/api/requirements/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM crm_requirements WHERE id = ?', [req.params.id]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Requirement not found' });
    }

    const [clients] = await pool.query('SELECT id, company_name FROM crm_clients ORDER BY company_name');
    
    let pocs = [];
    if (rows[0].client_id) {
      const [pocRows] = await pool.query('SELECT id, poc_name FROM crm_pocs WHERE client_id = ? ORDER BY poc_name', [rows[0].client_id]);
      pocs = pocRows;
    }

    res.json({
      success: true,
      requirement: rows[0],
      clients,
      pocs
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * ─── 5. API: GET /api/pocs-by-client/:clientId ──────────────────────────────
 * API: Cascading Dropdown Handler for POCs
 */
router.get('/api/pocs-by-client/:clientId', async (req, res) => {
  try {
    const [pocs] = await pool.query('SELECT id, poc_name FROM crm_pocs WHERE client_id = ? ORDER BY poc_name', [req.params.clientId]);
    res.json(pocs);
  } catch (err) {
    res.status(500).json([]);
  }
});

/**
 * ─── 6. API: PUT /api/requirements/:id ──────────────────────────────────────
 * API: UPDATE REQUIREMENT (EXACT MATCH FOR YOUR TABLE SCHEMA)
 */
router.put('/api/requirements/:id', async (req, res) => {
  try {
    const reqId = req.params.id;
    const { title, status, budget, client_id, poc_id, jd } = req.body;

    // Foreign Keys protection: empty strings to NULL
    const safeClientId = client_id && client_id !== '' ? parseInt(client_id) : null;
    const safePocId = poc_id && poc_id !== '' ? parseInt(poc_id) : null;
    const safeJd = jd || '';
    const safeBudget = budget || '';

    // Exact columns: title, status, budget, client_id, poc_id, jd
    await pool.query(
      `UPDATE crm_requirements 
       SET title = ?, status = ?, budget = ?, client_id = ?, poc_id = ?, jd = ? 
       WHERE id = ?`,
      [title, status, safeBudget, safeClientId, safePocId, safeJd, reqId]
    );

    res.json({ success: true, message: 'Requirement updated successfully' });
  } catch (err) {
    console.error('Update requirement API error:', err.message);
    res.status(500).json({ success: false, message: 'Database error: ' + err.message });
  }
});

/**
 * ─── 7. API: DELETE /api/requirements/:id ───────────────────────────────────
 * API: Safe Cascade Requirement Deletion
 */
router.delete('/api/requirements/:id', async (req, res) => {
  try {
    const reqId = req.params.id;
    const user = req.session.user;

    const [existing] = await pool.query('SELECT created_by FROM crm_requirements WHERE id = ?', [reqId]);
    if (!existing.length) {
      return res.status(404).json({ success: false, message: 'Requirement not found' });
    }

    const isAdmin = user.role === 'admin' || user.role === 'super_admin';
    if (!isAdmin && existing[0].created_by !== user.id) {
      return res.status(403).json({ success: false, message: 'Unauthorized delete action' });
    }

    // ── ✅ FIXED: Table name sahi karo (singular) ──
    try {
      await pool.query('DELETE FROM crm_requirement_resources WHERE requirement_id = ?', [reqId]);
    } catch(e) { console.log('Mapping table cleanup skipped:', e.message); }

    try {
      await pool.query('DELETE FROM crm_activity_logs WHERE entity_type = "requirement" AND entity_id = ?', [reqId]);
    } catch(e) { console.log('Logs table cleanup skipped:', e.message); }
    
    await pool.query('DELETE FROM crm_requirements WHERE id = ?', [reqId]);

    res.json({ success: true, message: 'Deleted successfully' });

  } catch (err) {
    console.error('Delete requirement API error:', err);
    res.status(500).json({ success: false, message: 'Database error: ' + err.message });
  }
});

/**
 * ─── 8. GET /requirements/:id ────────────────────────────────────────────────
 * View: Detailed Requirement Workspace Page
 */
router.get('/requirements/:id', async (req, res) => {
  try {
    const [reqRows] = await pool.query(
      `SELECT r.*, c.company_name, p.poc_name,
              res.resource_name AS mapped_resource_name, 
              res.unique_uid AS mapped_uid, 
              res.status AS mapped_status,
              cl.company_name AS client_name
       FROM crm_requirements r
       LEFT JOIN crm_clients c ON c.id = r.client_id
       LEFT JOIN crm_pocs p ON p.id = r.poc_id
       LEFT JOIN crm_resources res ON res.id = r.resource_id
       LEFT JOIN crm_clients cl ON cl.id = r.client_id
       WHERE r.id = ?`, 
      [req.params.id]
    );

    if (!reqRows.length) {
      return res.status(404).render('404', { user: req.session.user });
    }

    const isAdmin = req.session.user.role === 'admin' || req.session.user.role === 'super_admin';
    if (!isAdmin && reqRows[0].created_by !== req.session.user.id) {
      return res.status(403).render('error', { 
        message: 'You do not have permission to view this requirement.', 
        user: req.session.user 
      });
    }

    // ── ACTIVITY LOG ──
    let activity = [];
    try {
      const [actRows] = await pool.query(
        `SELECT a.*, u.name AS created_by_name 
         FROM crm_activity_logs a
         LEFT JOIN crm_users u ON u.id = a.created_by
         WHERE a.entity_type = 'requirement' AND a.entity_id = ?
         ORDER BY a.created_at DESC`, 
        [req.params.id]
      );
      activity = actRows;
    } catch(e) { 
      console.log('Activity log fetch fallback:', e.message); 
    }

    // ── ✅ FIXED: RESOURCES SENT ──
    // Table name: crm_requirement_resources (singular)
    let resourcesSent = [];
    try {
      const [resSentRows] = await pool.query(
        `SELECT res.id, res.resource_name, res.unique_uid, res.skills, 
                res.status, rr.stage
         FROM crm_requirement_resources rr   -- ✅ FIXED: singular
         JOIN crm_resources res ON res.id = rr.resource_id
         WHERE rr.requirement_id = ?
         ORDER BY rr.created_at DESC`, 
        [req.params.id]
      );
      resourcesSent = resSentRows;
    } catch(e) { 
      console.log('Resources sent table query error:', e.message); 
    }

    const [vendors] = await pool.query('SELECT * FROM crm_vendors ORDER BY vendor_name');
    const [clients] = await pool.query('SELECT * FROM crm_clients ORDER BY company_name');

    res.render('requirements/detail', {
      requirement: reqRows[0],
      activity,
      resourcesSent,
      vendors,
      clients,
      user: req.session.user,
      active: 'requirements'
    });

  } catch (error) {
    console.error('Error in requirement detail:', error);
    res.status(500).render('error', {
      message: 'Internal Server Error: ' + error.message,
      user: req.session.user
    });
  }
});

// ALWAYS AT THE VERY BOTTOM OF ROUTER FILE
module.exports = router;