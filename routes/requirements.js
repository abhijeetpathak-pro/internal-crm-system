// ============================================================================
// routes/requirements.js — JSON API for Requirements
// ============================================================================

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { createDocumentUpload, hasExpectedSignature, removeUploadedFile } = require('../middleware/uploads');
const upload = createDocumentUpload();

// Inline resource CV uploads use the shared secure document uploader.

// Valid stored requirement statuses. 'Closed' is intentionally absent —
// see POST /:id/status for why.
const REQ_STATUSES = ['Open', 'Hold'];

// Valid resource-pipeline stages, in their natural left-to-right order.
const PIPELINE_STAGES = ['L1', 'L2', 'L3', 'Reject', 'Select'];

function sanitizeToken(str) {
  return (str || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

// ─── Duplicate-aware UID generator ────────────────────────────────────────────
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

// ─── Helper: Refresh resource availability ──────────────────────────────────
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

// ─── GET recent (dashboard) ──────────────────────────────────────────────────
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

// ─── GET single requirement ──────────────────────────────────────────────────
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

// ─── POST create requirement ──────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { client_id, poc_id, title, jd, status, budget, location, r_location } = req.body;
  if (!client_id || !title) return res.status(400).json({ error: 'client_id and title are required.' });
  const finalStatus = status && REQ_STATUSES.includes(status) ? status : 'Open';
  const finalLocation = (location !== undefined ? location : r_location) || null;
  try {
    const [r] = await pool.query(
      'INSERT INTO crm_requirements (client_id,poc_id,title,jd,status,budget,location,created_by) VALUES (?,?,?,?,?,?,?,?)',
      [client_id, poc_id || null, title, jd || null, finalStatus, budget || null, finalLocation, req.session.user.id]
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create requirement.' });
  }
});

// ─── PUT update requirement ──────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const { client_id, poc_id, title, jd, status, budget, location, r_location } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required.' });
  const finalStatus = status && REQ_STATUSES.includes(status) ? status : 'Open';
  const finalLocation = (location !== undefined ? location : r_location) || null;
  try {
    const user = req.session.user;
    if (user && user.role === 'emp') {
      const [owner] = await pool.query('SELECT created_by FROM crm_requirements WHERE id=?', [req.params.id]);
      if (!owner.length) return res.status(404).json({ error: 'Not found.' });
      if (owner[0].created_by !== user.id) return res.status(403).json({ error: 'Permission denied.' });
    }
    await pool.query(
      'UPDATE crm_requirements SET client_id=?,poc_id=?,title=?,jd=?,status=?,budget=?,location=? WHERE id=?',
      [client_id || null, poc_id || null, title, jd || null, finalStatus, budget || null, finalLocation, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update requirement.' });
  }
});

// ─── DELETE requirement ──────────────────────────────────────────────────────
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

    const [mappedRows] = await conn.query(
      'SELECT resource_id FROM crm_requirement_resources WHERE requirement_id=?', [reqId]
    );

    await conn.query("DELETE FROM crm_activity_logs WHERE entity_type='requirement' AND entity_id=?", [reqId]);
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

// ─── Toggle is_shared: 1 / 0 ───────────────────────────────────────────────
router.post('/:id/toggle-share', async (req, res) => {
  const { is_shared } = req.body;
  const reqId = req.params.id;
  const shareVal = (is_shared == 1 || is_shared === true || is_shared === '1') ? 1 : 0;

  try {
    const user = req.session.user;
    if (user && user.role === 'emp') {
      const [owner] = await pool.query('SELECT created_by FROM crm_requirements WHERE id=?', [reqId]);
      if (!owner.length) return res.status(404).json({ error: 'Not found.' });
      if (owner[0].created_by !== user.id) return res.status(403).json({ error: 'Permission denied.' });
    }

    await pool.query('UPDATE crm_requirements SET is_shared=? WHERE id=?', [shareVal, reqId]);
    res.json({ ok: true, is_shared: shareVal });
  } catch (err) {
    console.error('toggle-share error:', err);
    res.status(500).json({ error: 'Failed to update share status.' });
  }
});

// ─── FIX 11: Map Resource to Requirement ─────────────────────────────────────
router.post('/:id/map-resource', (req, res, next) => {
  upload.single('cv')(req, res, err => { if (err) return res.status(400).json({ error: err.message }); next(); });
}, async (req, res) => {
  if (req.file) {
    try {
      if (!(await hasExpectedSignature(req.file))) {
        await removeUploadedFile(req.file);
        return res.status(400).json({ error: 'Uploaded document content does not match its file type.' });
      }
    } catch (err) {
      await removeUploadedFile(req.file);
      return res.status(400).json({ error: 'Uploaded document could not be validated.' });
    }
  }

  const reqId = req.params.id;

  const [reqRows] = await pool.query('SELECT id, created_by FROM crm_requirements WHERE id=?', [reqId]);
  if (!reqRows.length) {
    await removeUploadedFile(req.file);
    return res.status(404).json({ error: 'Requirement not found.' });
  }
  if (req.session.user.role === 'emp' && reqRows[0].created_by !== req.session.user.id) {
    await removeUploadedFile(req.file);
    return res.status(403).json({ error: 'Permission denied.' });
  }

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
      if (!b.resource_name || !b.skills || !b.type) {
        await conn.rollback();
        return res.status(400).json({ error: 'resource_name, skills, type required for new resource.' });
      }

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

      // ✅ FIXED: Extract experience_years and salary_lpm
      const experience_years = b.experience_years || null;
      const salary_lpm = b.salary_lpm || null;

      const [newRes] = await conn.query(
        `INSERT INTO crm_resources
         (unique_uid, resource_name, title, skills, cv_path, type, status, vendor_id, poc_id,
          managed_by, contact_number, email, linkedin, preferred_location, current_location,
          experience_years, salary_lpm, created_by)
         VALUES (?,?,?,?,?,?,'Available',?,?,?,?,?,?,?,?,?,?,?)`,
        [
          uniqueUid, 
          b.resource_name, 
          b.title || null, 
          b.skills, 
          cvPath, 
          type,
          type === 'Vendor' ? resolvedVendorId : null,
          type === 'Vendor' ? (b.poc_id || null) : null,
          type === 'In-House' ? (b.managed_by || null) : null,
          type === 'In-House' ? (b.contact_number || null) : null,
          type === 'In-House' ? (b.email || null) : null,
          type === 'In-House' ? (b.linkedin || null) : null,
          b.preferred_location || null, 
          b.current_location || null,
          experience_years,  // ✅ ADDED
          salary_lpm,        // ✅ ADDED
          req.session.user.id
        ]
      );
      resourceId = newRes.insertId;
    }

    // ── Step 1: Link resource to requirement ──────────────────────────────────
    await conn.query('UPDATE crm_requirements SET resource_id=? WHERE id=?', [resourceId, reqId]);

    // ── Step 2: Auto-update resource status to Mapped ─────────────────────────
    await conn.query("UPDATE crm_resources SET status='Mapped' WHERE id=?", [resourceId]);

    // ── Step 3: Create/keep the pipeline row ──────────────────────────────────
    await conn.query(
      `INSERT INTO crm_requirement_resources (requirement_id, resource_id, stage, created_by)
       VALUES (?, ?, 'L1', ?)
       ON DUPLICATE KEY UPDATE requirement_id = requirement_id`,
      [reqId, resourceId, req.session.user.id]
    );

    // ── Step 4: Auto activity log on resource ─────────────────────────────────
    const mapNote = `Mapped to Requirement ID: ${reqId}${req.body.req_title ? ' — ' + req.body.req_title : ''}`;
    await conn.query(
      `INSERT INTO crm_activity_logs (entity_type,entity_id,note,ref_requirement_id,created_by)
       VALUES ('resource',?,?,?,?)`,
      [resourceId, mapNote, reqId, req.session.user.id]
    );

    // ── Step 5: Activity log on requirement side ──────────────────────────────
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
    await removeUploadedFile(req.file);
    res.status(500).json({ error: 'Failed to map resource.' });
  } finally {
    conn.release();
  }
});

// ─── Resource pipeline stage change ─────────────────────────────────────────
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

    await conn.query(
      `INSERT INTO crm_activity_logs (entity_type,entity_id,note,ref_resource_id,created_by)
       VALUES ('requirement',?,?,?,?)`,
      [reqId, `${pair.resource_name} (${pair.unique_uid}) moved to stage: ${stage}`, resourceId, user.id]
    );
    await conn.query(
      `INSERT INTO crm_activity_logs (entity_type,entity_id,note,ref_requirement_id,created_by)
       VALUES ('resource',?,?,?,?)`,
      [resourceId, `Moved to stage: ${stage} for Requirement — ${pair.req_title}`, reqId, user.id]
    );

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