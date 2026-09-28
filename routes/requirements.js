const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const pool = require('../db'); // Correct relative path to root db.js

// ======================== MULTER CONFIG ========================
const fs = require('fs');

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '..', 'uploads', 'cvs');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });;

// ======================== CONSTANTS ========================
const REQ_STATUSES = ['Open', 'Hold'];
const PIPELINE_STAGES = ['SR', 'L1', 'L2', 'Select', 'Reject'];

// ======================== HELPER FUNCTIONS ========================
function sanitizeToken(str) {
  return (str || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

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

// ======================== GET ALL REQUIREMENTS (LIST) ========================
router.get('/', async (req, res) => {
  try {
    const [requirements] = await pool.query(`
      SELECT r.*, 
             c.company_name AS client_name,
             u.name AS submitted_by_name,
             r.is_shared,
             r.location,
             r.share_status,
             (
               SELECT COUNT(*) FROM crm_requirement_resources rr 
               WHERE rr.requirement_id = r.id AND rr.stage != 'Reject'
             ) AS mapped_profile_count
      FROM crm_requirements r
      LEFT JOIN crm_clients c ON r.client_id = c.id
      LEFT JOIN crm_users u ON r.created_by = u.id
      ORDER BY r.id DESC
    `);

    const groupsMap = {};
    requirements.forEach(reqItem => {
      const dateKey = reqItem.created_at ? new Date(reqItem.created_at).toISOString().split('T')[0] : 'Other';
      const label = reqItem.created_at ? new Date(reqItem.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'LONG', year: 'numeric' }).toUpperCase() : 'OTHER';
      
      if (!groupsMap[dateKey]) {
        groupsMap[dateKey] = { key: dateKey, label: label, requirements: [] };
      }
      groupsMap[dateKey].requirements.push(reqItem);
    });

    const groups = Object.values(groupsMap);

    res.render('requirements/list', {
      user: req.session.user,
      active: 'requirements',
      groups: groups,
      requirements: requirements
    });
  } catch (err) {
    console.error('Error fetching requirements list:', err);
    res.status(500).send('Server Error');
  }
});

//==============================SHARE REQUIREMENT  DETAIL / API ===============
router.get('/share/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT r.*, c.company_name AS client_name 
      FROM crm_requirements r
      LEFT JOIN crm_clients c ON r.client_id = c.id
      WHERE r.id = ?
    `, [req.params.id]);

    if (!rows.length) return res.status(404).send('Requirement not found');
    
    const requirement = rows[0];
    
    // Ek public view render karo jisme login ki zaroorat na ho
    res.render('requirements/public-share', { requirement });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// ======================== GET REQUIREMENT DETAIL / API ========================
router.get('/:id', async (req, res) => {
  const reqId = req.params.id;
  
  try {
    const [reqRows] = await pool.query(`
      SELECT r.*, 
             c.company_name,
             c.id AS client_id,
             p.poc_name,
             p.id AS poc_id,
             r.is_shared,
             r.location,
             res.id AS mapped_resource_id,
             res.resource_name AS mapped_resource_name,
             res.unique_uid AS mapped_uid
      FROM crm_requirements r
      LEFT JOIN crm_clients c ON r.client_id = c.id
      LEFT JOIN crm_pocs p ON r.poc_id = p.id
      LEFT JOIN crm_resources res ON r.resource_id = res.id
      WHERE r.id = ?
    `, [reqId]);

    if (!reqRows.length) {
      if (req.xhr || req.headers.accept?.indexOf('json') > -1 || req.originalUrl.startsWith('/api/')) {
        return res.status(404).json({ error: 'Requirement not found' });
      }
      return res.status(404).send('Requirement not found');
    }

    const requirement = reqRows[0];

    if (req.xhr || req.headers.accept?.indexOf('json') > -1 || req.originalUrl.startsWith('/api/')) {
      const [clients] = await pool.query('SELECT id, company_name FROM crm_clients ORDER BY company_name');
      const [pocs] = await pool.query('SELECT id, poc_name, client_id FROM crm_pocs ORDER BY poc_name');
      
      return res.json({ 
        requirement: {
          ...requirement,
          location: requirement.location || ''
        }, 
        clients, 
        pocs 
      });
    }

    const [activity] = await pool.query(`
      SELECT a.*, u.name AS created_by_name,
             res.resource_name, res.unique_uid
      FROM crm_activity_logs a
      LEFT JOIN crm_users u ON a.created_by = u.id
      LEFT JOIN crm_resources res ON a.ref_resource_id = res.id
      WHERE a.entity_type = 'requirement' AND a.entity_id = ?
      ORDER BY a.created_at DESC
    `, [reqId]);

    const [resourcesSent] = await pool.query(`
      SELECT rr.id AS rr_id, rr.stage, rr.requirement_id,
             res.id AS id, res.id AS resource_id, res.resource_name, res.skills, res.unique_uid,
             v.vendor_name
      FROM crm_requirement_resources rr
      JOIN crm_resources res ON rr.resource_id = res.id
      LEFT JOIN crm_vendors v ON res.vendor_id = v.id
      WHERE rr.requirement_id = ?
      ORDER BY rr.created_at DESC
    `, [reqId]);

    res.render('requirements/detail', {
      user: req.session.user,
      active: 'requirements',
      requirement: requirement,
      activity: activity,
      resourcesSent: resourcesSent
    });

  } catch (err) {
    console.error('Error fetching requirement details:', err);
    if (req.xhr || req.headers.accept?.indexOf('json') > -1 || req.originalUrl.startsWith('/api/')) {
      return res.status(500).json({ error: 'Server Error: ' + err.message });
    }
    res.status(500).send('Server Error');
  }
});

// ======================== CREATE NEW REQUIREMENT ========================
router.post('/', async (req, res) => {
  const { client_id, poc_id, title, jd, status, budget, r_location } = req.body;
  if (!client_id || !title) return res.status(400).json({ error: 'client_id and title are required.' });
  const finalStatus = status && REQ_STATUSES.includes(status) ? status : 'Open';
  try {
    const [r] = await pool.query(
      'INSERT INTO crm_requirements (client_id, poc_id, title, jd, status, budget, location, created_by, is_shared) VALUES (?,?,?,?,?,?,?,?,?)',
      [client_id, poc_id || null, title, jd || null, finalStatus, budget || null, r_location || null, req.session.user.id, 0]
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) {
    console.error('Create error:', err);
    res.status(500).json({ error: 'Failed to create requirement. ' + err.message });
  }
});

// ======================== UPDATE REQUIREMENT ========================
router.put('/:id', async (req, res) => {
  const { client_id, poc_id, title, jd, status, budget, r_location } = req.body;
  
  if (!title) {
    return res.status(400).json({ success: false, error: 'title is required.' });
  }
  
  const finalStatus = status && REQ_STATUSES.includes(status) ? status : 'Open';
  
  try {
    const user = req.session.user;
    if (user && user.role === 'emp') {
      const [owner] = await pool.query('SELECT created_by FROM crm_requirements WHERE id=?', [req.params.id]);
      if (!owner.length) return res.status(404).json({ success: false, error: 'Not found.' });
      if (owner[0].created_by !== user.id) return res.status(403).json({ success: false, error: 'Permission denied.' });
    }
    
    await pool.query(
      'UPDATE crm_requirements SET client_id=?, poc_id=?, title=?, jd=?, status=?, budget=?, location=? WHERE id=?',
      [client_id || null, poc_id || null, title, jd || null, finalStatus, budget || null, r_location || null, req.params.id]
    );
    
    res.json({ success: true, message: 'Requirement updated successfully!' });
  } catch (err) {
    console.error('PUT requirement error:', err);
    res.status(500).json({ success: false, error: 'Failed to update requirement. ' + err.message });
  }
});

// ======================== DELETE REQUIREMENT ========================
router.delete('/:id', async (req, res) => {
  const reqId = req.params.id;
  const user = req.session.user;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (user && user.role === 'emp') {
      const [owner] = await conn.query('SELECT created_by FROM crm_requirements WHERE id=?', [reqId]);
      if (!owner.length) {
        await conn.rollback();
        return res.status(404).json({ error: 'Not found.' });
      }
      if (owner[0].created_by !== user.id) {
        await conn.rollback();
        return res.status(403).json({ error: 'Permission denied.' });
      }
    }

    await conn.query('DELETE FROM crm_requirement_resources WHERE requirement_id = ?', [reqId]);
    await conn.query("DELETE FROM crm_activity_logs WHERE (entity_type='requirement' AND entity_id=?) OR ref_requirement_id=?", [reqId, reqId]);

    const [delResult] = await conn.query('DELETE FROM crm_requirements WHERE id = ?', [reqId]);

    if (delResult.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Requirement not found.' });
    }

    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error('Delete requirement error:', err);
    res.status(500).json({ error: 'Failed to delete requirement: ' + err.message });
  } finally {
    conn.release();
  }
});

// ======================== TOGGLE SHARE ========================
router.post('/:id/toggle-share', async (req, res) => {
  const reqId = req.params.id;
  const { is_shared } = req.body;
  
  try {
    const sharedVal = (is_shared === '1' || is_shared === 1 || is_shared === true) ? 1 : 0;
    
    await pool.query('UPDATE crm_requirements SET is_shared = ? WHERE id = ?', [sharedVal, reqId]);
    
    const message = sharedVal ? '✅ Requirement marked as Shared' : '❌ Requirement marked as Not Shared';
    await pool.query(
      `INSERT INTO crm_activity_logs (entity_type, entity_id, note, created_by)
       VALUES ('requirement', ?, ?, ?)`,
      [reqId, message, req.session.user ? req.session.user.id : 1]
    );
    
    res.json({ 
      ok: true, 
      is_shared: sharedVal,
      message: message
    });
    
  } catch (err) {
    console.error('Toggle share error:', err);
    res.status(500).json({ error: 'Failed to update share status: ' + err.message });
  }
});

// ======================== UPDATE STATUS ========================
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
//========================= requirements track l1,l2,selected 


// ======================== MAP RESOURCE ========================
router.post('/:id/map-resource', (req, res, next) => {
  upload.single('cv')(req, res, err => { if (err) return res.status(400).json({ error: err.message }); next(); });
}, async (req, res) => {
  const reqId = req.params.id;

  const [reqRows] = await pool.query('SELECT id FROM crm_requirements WHERE id=?', [reqId]);
  if (!reqRows.length) return res.status(404).json({ error: 'Requirement not found.' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let resourceId;

    if (req.body.resource_id) {
      resourceId = parseInt(req.body.resource_id);
      const [rRows] = await conn.query('SELECT id FROM crm_resources WHERE id=?', [resourceId]);
      if (!rRows.length) { await conn.rollback(); return res.status(404).json({ error: 'Resource not found.' }); }
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

      const technology = (b.title || '').trim() || (b.skills || '').split(',')[0];
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
          experience_years,
          salary_lpm,
          req.session.user.id
        ]
      );
      resourceId = newRes.insertId;
    }

    await conn.query('UPDATE crm_requirements SET resource_id=? WHERE id=?', [resourceId, reqId]);
    await conn.query("UPDATE crm_resources SET status='Mapped' WHERE id=?", [resourceId]);
    await conn.query(
      `INSERT INTO crm_requirement_resources (requirement_id, resource_id, stage, created_by)
       VALUES (?, ?, 'SR', ?)
       ON DUPLICATE KEY UPDATE requirement_id = requirement_id`,
      [reqId, resourceId, req.session.user.id]
    );

    const mapNote = `Mapped to Requirement ID: ${reqId}${req.body.req_title ? ' — ' + req.body.req_title : ''}`;
    await conn.query(
      `INSERT INTO crm_activity_logs (entity_type,entity_id,note,ref_requirement_id,created_by)
       VALUES ('resource',?,?,?,?)`,
      [resourceId, mapNote, reqId, req.session.user.id]
    );

    await conn.query(
      `INSERT INTO crm_activity_logs (entity_type,entity_id,note,ref_resource_id,created_by)
       VALUES ('requirement',?,?,?,?)`,
      [reqId, `Resource mapped to this requirement.`, resourceId, req.session.user.id]
    );

    await conn.query('UPDATE crm_requirements SET is_shared = 1 WHERE id = ?', [reqId]);

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

// ======================== UPDATE STAGE ========================
router.patch('/:id/resource/:resourceId/stage', async (req, res) => {
  const reqId = req.params.id;
  const resourceId = req.params.resourceId;
  const { stage } = req.body;

  if (!PIPELINE_STAGES.includes(stage))
    return res.status(400).json({ error: `Invalid stage.` });

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
    if (!pairRows.length) { await conn.rollback(); return res.status(404).json({ error: 'Not mapped.' }); }
    const pair = pairRows[0];

    await conn.query('UPDATE crm_requirement_resources SET stage=? WHERE id=?', [stage, pair.id]);

    await conn.query(
      `INSERT INTO crm_activity_logs (entity_type,entity_id,note,ref_resource_id,created_by)
       VALUES ('requirement',?,?,?,?)`,
      [reqId, `${pair.resource_name} (${pair.unique_uid}) moved to stage: ${stage}`, resourceId, user.id]
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