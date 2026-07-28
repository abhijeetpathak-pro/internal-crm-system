// Import Express framework
const express = require('express');
// Create Express router instance
const router = express.Router();
// Import database connection pool
const pool = require('../db');
// Import authentication middleware to protect routes
const { requireLogin } = require('../middleware/auth');

// ── APPLY MIDDLEWARE ──
// Saare routes ke liye login mandatory hai
// Middleware ensure karta hai ki sirf logged-in users hi access kar sakein
router.use(requireLogin);

// ─── GET all resources ────────────────────────────────────────────────────
// Saare resources ki list dikhane wala page
// Database se saare resources fetch karta hai with vendor and submitter info
router.get('/resources', async (req, res) => {
  // Submit EmpName (who added this resource) is only shown to admin/super_admin
  // — see views/resources/list.ejs, which hides the column entirely for emp.
  // Database se resources fetch karna with LEFT JOINs for vendor and user names
  const [resources] = await pool.query(
    `SELECT r.*, v.vendor_name, u.name AS submitted_by_name
     FROM crm_resources r
     LEFT JOIN crm_vendors v ON v.id=r.vendor_id
     LEFT JOIN crm_users u ON u.id=r.created_by
     ORDER BY r.created_at DESC`
  );
  // resources/list view render karna with data
  res.render('resources/list', { 
    resources,                // Saare resources ki list
    user: req.session.user,   // Current logged in user info
    active: 'resources',      // Navigation menu mein resources tab highlight karne ke liye
    heading: 'Resources',     // Page heading
    showAddLink: true         // Add link dikhana hai (resources ke liye)
  });
});

// ─── GET add resource form ──────────────────────────────────────────────
// Naya resource add karne ka form page
// Sirf form render karta hai, actual insertion nahi karta
router.get('/resources/add', (req, res) => {
  // Add resource form render karna
  res.render('resources/add', { 
    user: req.session.user, 
    active: 'resources' 
  });
});

// ─── GET single resource detail ──────────────────────────────────────────
// Kisi specific resource ki detail page
// Resource info, activity logs, aur mapped requirements dikhata hai
router.get('/resources/:id', async (req, res) => {
  // Specific resource ko ID ke through fetch karna with vendor and POC info
  const [rows] = await pool.query(
    `SELECT r.*, v.vendor_name, p.poc_name FROM crm_resources r
     LEFT JOIN crm_vendors v ON v.id=r.vendor_id
     LEFT JOIN crm_pocs p ON p.id=r.poc_id WHERE r.id=?`, 
    [req.params.id]
  );
  
  // Agar resource nahi mila toh 404 page dikhana
  if (!rows.length) return res.status(404).render('404');

  // Activity log for this resource. LEFT JOIN crm_requirements so entries
  // that were auto-created by "map to requirement" (ref_requirement_id set)
  // carry the requirement's title/id and the frontend can render them as a
  // clickable link straight to that requirement (Point 1 fix).
  // Resource ki saari activity logs fetch karna with user, client, and requirement info
  const [activity] = await pool.query(
    `SELECT a.*, u.name AS created_by_name, c.company_name, rq.id AS req_link_id, rq.title AS req_link_title
     FROM crm_activity_logs a
     LEFT JOIN crm_users u ON u.id=a.created_by
     LEFT JOIN crm_clients c ON c.id=a.ref_client_id
     LEFT JOIN crm_requirements rq ON rq.id=a.ref_requirement_id
     WHERE a.entity_type='resource' AND a.entity_id=? ORDER BY a.created_at DESC`, 
    [req.params.id]
  );

  // Every requirement this resource has been sent against, with its live
  // pipeline stage — read from the SAME crm_requirement_resources table the
  // requirement detail page reads, so the stage buttons here always agree
  // with the requirement page's "Profiles Sent" panel (Point 2B).
  // Resource ke saare mapped requirements fetch karna with their pipeline stage
  const [mappedRequirements] = await pool.query(
    `SELECT req.id, req.title, req.status, rr.stage
     FROM crm_requirement_resources rr
     JOIN crm_requirements req ON req.id = rr.requirement_id
     WHERE rr.resource_id = ?
     ORDER BY rr.created_at DESC`, 
    [req.params.id]
  );

  // Saare clients fetch karna for dropdown/reference
  const [clients] = await pool.query('SELECT id,company_name FROM crm_clients ORDER BY company_name');
  
  // Resource detail page render karna with all data
  res.render('resources/detail', { 
    resource: rows[0],        // Resource ki details
    activity,                 // Resource ki saari activity logs
    mappedRequirements,       // Resource ke mapped requirements
    clients,                  // Saare clients (for dropdown)
    user: req.session.user, 
    active: 'resources' 
  });
});

// ─── GET in-house resources ─────────────────────────────────────────────
// Sirf In-House type ke resources ki list
// Filtered view for In-House resources only
router.get('/in-house', async (req, res) => {
  // Sirf type='In-House' wale resources fetch karna
  const [resources] = await pool.query(
    `SELECT r.*, v.vendor_name, u.name AS submitted_by_name
     FROM crm_resources r
     LEFT JOIN crm_vendors v ON v.id=r.vendor_id
     LEFT JOIN crm_users u ON u.id=r.created_by
     WHERE r.type='In-House' ORDER BY r.created_at DESC`
  );
  // resources/list view render karna (same view but with different data)
  // showAddLink: false kyunki in-house resources add nahi kar sakte is page se
  res.render('resources/list', { 
    resources,                // Sirf In-House resources ki list
    user: req.session.user, 
    active: 'inhouse',        // Navigation menu mein inhouse tab highlight
    heading: 'In-House Resources', 
    showAddLink: false        // Add link nahi dikhana (in-house ke liye)
  });
});

// Export router for use in main application
// Router ko export karna taaki main app mein use kar sakein
module.exports = router;