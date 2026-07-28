// ============================================================================
// routes/requirements.js — JSON API for Requirements
//
// Covers:
//   • CRUD for requirements
//   • Role-based visibility (super_admin/admin see everything, emp sees only
//     what they created — see the comment above each route for the exact rule)
//   • Requirement status: 'Open' / 'Hold' are real stored states; 'Closed' is
//     NOT stored — asking to close a requirement deletes it everywhere
//     (see POST /:id/status)
//   • Mapping resources to a requirement (Case A: pick existing resource,
//     Case B: create a brand-new resource inline) with a duplicate-UID guard
//   • The resource pipeline: every resource sent against a requirement has
//     its own stage (L1 → L2 → L3 → Select, with Reject as a branch). The
//     stage lives in crm_requirement_resources and is read by BOTH the
//     requirement page and the resource page, so moving a resource's stage
//     from either screen shows up identically on the other one.
// ============================================================================

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const pool = require('../db');

// For inline new-resource form (Fix 11 Case B)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads', 'cvs')),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// Valid stored requirement statuses. 'Closed' is intentionally absent —
// see POST /:id/status for why.
const REQ_STATUSES = ['Open', 'Hold'];

// Valid resource-pipeline stages, in their natural left-to-right order.
// Kept as a const here (instead of trusting the DB enum alone) so the API
// can validate input and give a clean 400 instead of a raw SQL error.
const PIPELINE_STAGES = ['L1', 'L2', 'L3', 'Reject', 'Select'];

function sanitizeToken(str) {
  return (str || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

// ─── Duplicate-aware UID generator (kept in sync with routes/resources.js) ──
// UID shape: VENDORCODE-RESOURCENAME-TECH-COUNT  (e.g. INH-SHUBHAM-JAVA-1)
//   • Same vendor + same name + same skill  => duplicate, BLOCKED.
//   • Same vendor + same name, diff skill   => new profile, COUNT increments.
//   • Different vendor                      => always allowed, COUNT starts at 1.
async function generateUid(conn, { vendorCode, resourceName, technology }) {
  const nameToken = sanitizeToken(resourceName);
  const techToken = sanitizeToken(technology);
  const exactBase = `${vendorCode}-${nameToken}-${techToken}`;
  const namePrefix = `${vendorCode}-${nameToken}-`;

  const [rows] = await conn.query(
    'SELECT unique_uid FROM crm_resources WHERE unique_uid LIKE ? FOR UPDATE',
    [`${namePrefix}%`]
  );

  const existing = rows.find(row => row.unique_uid.startsWith(`${exactBase}-`));
  if (existing) {
    return { duplicate: true, existingUid: existing.unique_uid };
  }

  let max = 0;
  for (const row of rows) {
    const parts = row.unique_uid.split('-');
    const n = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return { duplicate: false, uid: `${exactBase}-${max + 1}` };
}

// Small helper: after a resource's pipeline stage changes for a requirement,
// or a mapping is removed, some resources may no longer be actively mapped
// to ANY requirement. Flip those back to 'Available' so the resource list
// doesn't show a stale "Mapped" badge forever. Resources still mapped
// elsewhere (or in a non-terminal stage) are left alone.
async function refreshResourceAvailability(conn, resourceId) {
  const [[{ activeCount }]] = await conn.query(
    `SELECT COUNT(*) AS activeCount FROM crm_requirement_resources
     WHERE resource_id = ? AND stage NOT IN ('Reject')`,
    [resourceId]
  );
  if (activeCount === 0) {
    await conn.query("UPDATE crm_resources SET status='Available' WHERE id=? AND status='Mapped'", [resourceId]);
  }
}

// GET recent (dashboard)
// Visibility rule: super_admin / admin see everything, emp sees only their own.
router.get('/recent', async (req, res) => {
  try {
    const user = req.session.user;
    let sql = `SELECT r.id,r.title,r.status,r.budget,r.created_at,c.company_name
       FROM crm_requirements r LEFT JOIN crm_clients c ON c.id=r.client_id`;
    const params = [];
    if (user && user.role === 'emp') {
      sql += ' WHERE r.created_by = ?';
      params.push(user.id);
    }
    sql += ' ORDER BY r.created_at DESC LIMIT 8';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch recent requirements.' });
  }
});

// GET single requirement
// Visibility rule: emp may only fetch requirements they created.
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.*, c.company_name, p.poc_name,
              res.resource_name AS mapped_resource_name, res.unique_uid AS mapped_uid
       FROM crm_requirements r
       LEFT JOIN crm_clients c ON c.id=r.client_id
       LEFT JOIN crm_pocs p ON p.id=r.poc_id
       LEFT JOIN crm_resources res ON res.id=r.resource_id
       WHERE r.id=?`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found.' });
    const user = req.session.user;
    if (user && user.role === 'emp' && rows[0].created_by !== user.id) {
      return res.status(403).json({ error: 'Permission denied.' });
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch requirement.' });
  }
});

// POST create requirement
// Status may only be 'Open' or 'Hold' at creation time — 'Closed' isn't a
// creatable state, it's a delete action performed later via POST /:id/status.
router.post('/', async (req, res) => {
  const { client_id, poc_id, title, jd, status, budget } = req.body;
  if (!client_id || !title) return res.status(400).json({ error: 'client_id and title are required.' });
  const finalStatus = status && REQ_STATUSES.includes(status) ? status : 'Open';
  try {
    const [r] = await pool.query(
      'INSERT INTO crm_requirements (client_id,poc_id,title,jd,status,budget,created_by) VALUES (?,?,?,?,?,?,?)',
      [client_id, poc_id || null, title, jd || null, finalStatus, budget || null, req.session.user.id]
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create requirement.' });
  }
});

// PUT update requirement
// Visibility rule: emp may only edit requirements they created.
router.put('/:id', async (req, res) => {
  const { client_id, poc_id, title, jd, status, budget } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required.' });
  const finalStatus = status && REQ_STATUSES.includes(status) ? status : 'Open';
  try {
    const user = req.session.user;
    if (user && user.role === 'emp') {
      const [owner] = await pool.query('SELECT created_by FROM crm_requirements WHERE id=?', [req.params.id]);
      if (!owner.length) return res.status(404).json({ error: 'Not found.' });
      if (owner[0].created_by !== user.id) return res.status(403).json({ error: 'Permission denied.' });
    }
    await pool.query(
      'UPDATE crm_requirements SET client_id=?,poc_id=?,title=?,jd=?,status=?,budget=? WHERE id=?',
      [client_id || null, poc_id || null, title, jd || null, finalStatus, budget || null, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update requirement.' });
  }
});

// DELETE requirement (manual delete, distinct from the "Closed" status action)
// Visibility rule: emp may only delete requirements they created.
router.delete('/:id', async (req, res) => {
  try {
    const user = req.session.user;
    if (user && user.role === 'emp') {
      const [owner] = await pool.query('SELECT created_by FROM crm_requirements WHERE id=?', [req.params.id]);
      if (!owner.length) return res.status(404).json({ error: 'Not found.' });
      if (owner[0].created_by !== user.id) return res.status(403).json({ error: 'Permission denied.' });
    }
    await pool.query('DELETE FROM crm_requirements WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete requirement.' });
  }
});

// ─── Status toggle: Open / Hold / Closed ────────────────────────────────────
// POST /api/requirements/:id/status   body: { status: 'Open'|'Hold'|'Closed' }
//
// 'Open' and 'Hold' are simple UPDATEs.
// 'Closed' is special: per the product rule "Closed ho jaye toh automatic
// delete ho jayega har jagah se" (once Closed, it should auto-delete
// everywhere), there is no persisted "Closed" row at all — asking to close
// a requirement DELETES it instead of updating its status. That cascades
// (via the FK on crm_requirement_resources) to remove its resource-pipeline
// rows too, and we also clean up its own activity-log entries and release
// any resources that are no longer actively mapped to anything else.
// The frontend must treat a 'Closed' response as "this requirement is gone,
// redirect to the list" rather than "reload this page".
router.post('/:id/status', async (req, res) => {
  const { status } = req.body;
  const reqId = req.params.id;

  if (!['Open', 'Hold', 'Closed'].includes(status))
    return res.status(400).json({ error: 'Invalid status.' });

  const user = req.session.user;
  if (user && user.role === 'emp') {
    const [owner] = await pool.query('SELECT created_by FROM crm_requirements WHERE id=?', [reqId]);
    if (!owner.length) return res.status(404).json({ error: 'Not found.' });
    if (owner[0].created_by !== user.id) return res.status(403).json({ error: 'Permission denied.' });
  }

  if (status !== 'Closed') {
    try {
      await pool.query('UPDATE crm_requirements SET status=? WHERE id=?', [status, reqId]);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to update status.' });
    }
  }

  // ── Closed => delete everywhere ──────────────────────────────────────────
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Every resource that was in the pipeline for this requirement — we'll
    // re-check their availability after the requirement (and its pipeline
    // rows, via FK cascade) is gone.
    const [mappedRows] = await conn.query(
      'SELECT resource_id FROM crm_requirement_resources WHERE requirement_id=?', [reqId]
    );

    // Requirement-side activity log isn't an FK-linked table (entity_id is
    // polymorphic), so it needs an explicit delete.
    await conn.query("DELETE FROM crm_activity_logs WHERE entity_type='requirement' AND entity_id=?", [reqId]);

    // Deleting the requirement cascades to crm_requirement_resources rows
    // (fk_rr_requirement ON DELETE CASCADE) and sets ref_requirement_id to
    // NULL on any resource-side log entries that mentioned it (ON DELETE
    // SET NULL), so resource history text survives but the link goes away.
    await conn.query('DELETE FROM crm_requirements WHERE id=?', [reqId]);

    for (const row of mappedRows) {
      await refreshResourceAvailability(conn, row.resource_id);
    }

    await conn.commit();
    res.json({ ok: true, deleted: true });
  } catch (err) {
    await conn.rollback();
    console.error('Close requirement error:', err);
    res.status(500).json({ error: 'Failed to close requirement.' });
  } finally {
    conn.release();
  }
});

// ─── FIX 11: Map Resource to Requirement ─────────────────────────────────────
// POST /api/requirements/:id/map-resource
// Case A: { resource_id } — select from database
// Case B: { new_resource: {...} } — create new resource inline
//
// After mapping:
//   1. crm_requirement_resources gets a row (requirement_id, resource_id,
//      stage='L1') — this is the pipeline entry both the requirement page
//      and resource page read.
//   2. requirements.resource_id = resource id (kept for backward
//      compatibility with the "last mapped resource" badge on the header)
//   3. resources.status = 'Mapped'
//   4. activity_log entry on the RESOURCE with ref_requirement_id set, so
//      the note is a clickable link back to this requirement.
//   5. activity_log entry on the REQUIREMENT with ref_resource_id set.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/map-resource', (req, res, next) => {
  upload.single('cv')(req, res, err => { if (err) return res.status(400).json({ error: err.message }); next(); });
}, async (req, res) => {
  const reqId = req.params.id;

  // Verify requirement exists
  const [reqRows] = await pool.query('SELECT id FROM crm_requirements WHERE id=?', [reqId]);
  if (!reqRows.length) return res.status(404).json({ error: 'Requirement not found.' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let resourceId;

    // ── CASE A: Select from database ──────────────────────────────────────────
    if (req.body.resource_id) {
      resourceId = parseInt(req.body.resource_id);
      const [rRows] = await conn.query('SELECT id FROM crm_resources WHERE id=?', [resourceId]);
      if (!rRows.length) { await conn.rollback(); return res.status(404).json({ error: 'Resource not found.' }); }

    // ── CASE B: Create new resource inline ────────────────────────────────────
    } else {
      const b = req.body;
      if (!b.resource_name || !b.skills || !b.type)
        { await conn.rollback(); return res.status(400).json({ error: 'resource_name, skills, type required for new resource.' }); }

      let vendorCode = 'INH';
      let resolvedVendorId = null;
      const type = b.type;

      if (type === 'Vendor') {
        if (!b.vendor_id) { await conn.rollback(); return res.status(400).json({ error: 'vendor_id required for Vendor type.' }); }
        const [vRows] = await conn.query('SELECT id,short_code FROM crm_vendors WHERE id=? FOR UPDATE', [b.vendor_id]);
        if (!vRows.length) { await conn.rollback(); return res.status(404).json({ error: 'Vendor not found.' }); }
        vendorCode = sanitizeToken(vRows[0].short_code);
        resolvedVendorId = vRows[0].id;
      }

      const technology = (b.skills || '').split(',')[0];
      const uidResult = await generateUid(conn, { vendorCode, resourceName: b.resource_name, technology });
      if (uidResult.duplicate) {
        await conn.rollback();
        return res.status(409).json({
          error: `⚠️ A duplicate was found and is not allowed. This resource already exists as ${uidResult.existingUid}.`,
          existing_uid: uidResult.existingUid
        });
      }
      const uniqueUid = uidResult.uid;
      const cvPath = req.file ? `/uploads/cvs/${req.file.filename}` : null;

      const [newRes] = await conn.query(
        `INSERT INTO crm_resources
         (unique_uid,resource_name,title,skills,cv_path,type,status,vendor_id,poc_id,
          managed_by,contact_number,email,linkedin,preferred_location,current_location,salary_LPM,created_by)
         VALUES (?,?,?,?,?,?,'Available',?,?,?,?,?,?,?,?,?,?)`,
        [uniqueUid, b.resource_name, b.title || null, b.skills, cvPath, type,
         type === 'Vendor' ? resolvedVendorId : null,
         type === 'Vendor' ? (b.poc_id || null) : null,
         type === 'In-House' ? (b.managed_by || null) : null,
         type === 'In-House' ? (b.contact_number || null) : null,
         type === 'In-House' ? (b.email || null) : null,
         type === 'In-House' ? (b.linkedin || null) : null,
         b.preferred_location || null, b.current_location || null,
         b.salary_LPM || null, req.session.user.id]
      );
      resourceId = newRes.insertId;
    }

    // ── Step 1: Link resource to requirement (legacy "primary mapped" pointer) ─
    await conn.query('UPDATE crm_requirements SET resource_id=? WHERE id=?', [resourceId, reqId]);

    // ── Step 2: Auto-update resource status to Mapped ─────────────────────────
    await conn.query("UPDATE crm_resources SET status='Mapped' WHERE id=?", [resourceId]);

    // ── Step 3: Create/keep the pipeline row for this (requirement, resource) ─
    // ON DUPLICATE KEY UPDATE requirement_id=requirement_id is a no-op update
    // that just avoids an error if this pair was already mapped before — it
    // deliberately does NOT reset an existing stage back to 'L1'.
    await conn.query(
      `INSERT INTO crm_requirement_resources (requirement_id, resource_id, stage, created_by)
       VALUES (?, ?, 'L1', ?)
       ON DUPLICATE KEY UPDATE requirement_id = requirement_id`,
      [reqId, resourceId, req.session.user.id]
    );

    // ── Step 4: Auto activity log on resource: "Mapped to Requirement ID: X" ──
    // FIX: reqId used to be embedded as a literal "<?>" placeholder text
    // instead of a real bound value, so the requirement ID never actually
    // showed up in the resource's activity log. It's now a proper bound
    // parameter, AND ref_requirement_id is set so the frontend can render
    // this note as a clickable link straight to the requirement (Point 1).
    const mapNote = `Mapped to Requirement ID: ${reqId}${req.body.req_title ? ' — ' + req.body.req_title : ''}`;
    await conn.query(
      `INSERT INTO crm_activity_logs (entity_type,entity_id,note,ref_requirement_id,created_by)
       VALUES ('resource',?,?,?,?)`,
      [resourceId, mapNote, reqId, req.session.user.id]
    );

    // ── Step 5: Activity log on requirement side too ──────────────────────────
    await conn.query(
      `INSERT INTO crm_activity_logs (entity_type,entity_id,note,ref_resource_id,created_by)
       VALUES ('requirement',?,?,?,?)`,
      [reqId, `Resource mapped to this requirement.`, resourceId, req.session.user.id]
    );

    await conn.commit();
    res.json({ ok: true, resource_id: resourceId });

  } catch (err) {
    await conn.rollback();
    console.error('Map resource error:', err);
    res.status(500).json({ error: 'Failed to map resource. ' + err.message });
  } finally {
    conn.release();
  }
});

// ─── Resource pipeline stage change ─────────────────────────────────────────
// PATCH /api/requirements/:id/resource/:resourceId/stage   body: { stage }
//
// Moves a specific (requirement, resource) pair to a new pipeline stage.
// Because crm_requirement_resources is the single shared source of truth,
// this ONE update is what both the requirement page's "Profiles Sent" panel
// and the resource page's "Mapped Requirements" panel read — so a change
// made from either screen is instantly visible on the other (Point 2B).
// An activity-log line is written on BOTH sides so each entity's own
// timeline shows the move too.
router.patch('/:id/resource/:resourceId/stage', async (req, res) => {
  const reqId = req.params.id;
  const resourceId = req.params.resourceId;
  const { stage } = req.body;

  if (!PIPELINE_STAGES.includes(stage))
    return res.status(400).json({ error: `Invalid stage. Must be one of: ${PIPELINE_STAGES.join(', ')}` });

  const user = req.session.user;
  if (user && user.role === 'emp') {
    const [owner] = await pool.query('SELECT created_by FROM crm_requirements WHERE id=?', [reqId]);
    if (!owner.length) return res.status(404).json({ error: 'Requirement not found.' });
    if (owner[0].created_by !== user.id) return res.status(403).json({ error: 'Permission denied.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [pairRows] = await conn.query(
      `SELECT rr.id, req.title AS req_title, res.resource_name, res.unique_uid
       FROM crm_requirement_resources rr
       JOIN crm_requirements req ON req.id = rr.requirement_id
       JOIN crm_resources res    ON res.id = rr.resource_id
       WHERE rr.requirement_id=? AND rr.resource_id=? FOR UPDATE`,
      [reqId, resourceId]
    );
    if (!pairRows.length) { await conn.rollback(); return res.status(404).json({ error: 'This resource is not mapped to this requirement.' }); }
    const pair = pairRows[0];

    await conn.query('UPDATE crm_requirement_resources SET stage=? WHERE id=?', [stage, pair.id]);

    // Log on the requirement's timeline: which resource moved, to what stage.
    await conn.query(
      `INSERT INTO crm_activity_logs (entity_type,entity_id,note,ref_resource_id,created_by)
       VALUES ('requirement',?,?,?,?)`,
      [reqId, `${pair.resource_name} (${pair.unique_uid}) moved to stage: ${stage}`, resourceId, user.id]
    );
    // Log on the resource's timeline: which requirement it moved for.
    await conn.query(
      `INSERT INTO crm_activity_logs (entity_type,entity_id,note,ref_requirement_id,created_by)
       VALUES ('resource',?,?,?,?)`,
      [resourceId, `Moved to stage: ${stage} for Requirement — ${pair.req_title}`, reqId, user.id]
    );

    // 'Reject' means this pairing is done — if the resource has no other
    // active pipeline entries, it's free to be sent elsewhere again.
    if (stage === 'Reject') {
      await refreshResourceAvailability(conn, resourceId);
    } else {
      await conn.query("UPDATE crm_resources SET status='Mapped' WHERE id=? AND status!='Mapped'", [resourceId]);
    }

    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error('Stage update error:', err);
    res.status(500).json({ error: 'Failed to update stage.' });
  } finally {
    conn.release();
  }
});

module.exports = router;
