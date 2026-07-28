/**
 * ──────────────────────────────────────────────────────────────
 * RESOURCES API ROUTES - resources.js
 * Handles all CRUD operations for resources
 * ──────────────────────────────────────────────────────────────
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const pool = require('../db');

// ──────────────────────────────────────────────────────────────
// MULTER CONFIGURATION - File Upload Setup
// ──────────────────────────────────────────────────────────────

/**
 * Configure storage location and filename for uploaded CVs
 * Files are saved to: uploads/cvs/
 * Filename format: timestamp-originalname
 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Save to uploads/cvs folder
    cb(null, path.join(__dirname, '..', 'uploads', 'cvs'));
  },
  filename: (req, file, cb) => {
    // Replace special characters with underscore for safe filename
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    // Add timestamp to avoid filename conflicts
    cb(null, `${Date.now()}-${safe}`);
  }
});

/**
 * Multer upload configuration
 * - Max file size: 5MB
 * - Allowed file types: PDF, DOC, DOCX
 */
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.pdf', '.doc', '.docx'];
    const isValid = allowedExtensions.includes(
      path.extname(file.originalname).toLowerCase()
    );
    cb(isValid ? null : new Error('Only PDF, DOC, DOCX files are allowed.'), isValid);
  }
});

// ──────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ──────────────────────────────────────────────────────────────

/**
 * Sanitize a string for use in UID
 * - Removes special characters
 * - Converts to uppercase
 * - Only keeps A-Z and 0-9
 * 
 * @param {string} str - Input string to sanitize
 * @returns {string} Sanitized string (uppercase, alphanumeric only)
 */
function sanitizeToken(str) {
  return (str || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

// ──────────────────────────────────────────────────────────────
// DUPLICATE-AWARE UID GENERATOR
// ──────────────────────────────────────────────────────────────

/**
 * Generate a unique UID for a resource with duplicate checking
 * 
 * UID FORMAT: VENDORCODE-RESOURCENAME-TECH-COUNT
 * Example: INH-SHUBHAM-JAVA-1
 * 
 * DUPLICATE RULES:
 * 1. Same vendor + same name + same tech = DUPLICATE (blocked)
 * 2. Same vendor + same name + different tech = NEW PROFILE (count++)
 * 3. Different vendor = ALWAYS ALLOWED (fresh count from 1)
 * 
 * Uses row locking (FOR UPDATE) to prevent race conditions
 * 
 * @param {Object} conn - Database connection (for transaction)
 * @param {string} vendorCode - Vendor short code or 'INH' for In-House
 * @param {string} resourceName - Resource name
 * @param {string} technology - Primary technology (from title or first skill)
 * @returns {Object} { duplicate: boolean, uid: string, existingUid: string }
 */
async function generateUid(conn, { vendorCode, resourceName, technology }) {
  // Sanitize name and technology for UID
  const nameToken = sanitizeToken(resourceName);
  const techToken = sanitizeToken(technology);
  
  // Exact base for duplicate check: VENDORCODE-NAME-TECH
  const exactBase = `${vendorCode}-${nameToken}-${techToken}`;
  // Prefix for counting: VENDORCODE-NAME-
  const namePrefix = `${vendorCode}-${nameToken}-`;

  /**
   * ── LOCK ROWS for this vendor+name to prevent race conditions ──
   * FOR UPDATE locks rows so concurrent requests can't both pass
   * the duplicate check at the same time
   */
  const [rows] = await conn.query(
    'SELECT unique_uid FROM crm_resources WHERE unique_uid LIKE ? FOR UPDATE',
    [`${namePrefix}%`]
  );

  /**
   * ── CHECK FOR EXACT DUPLICATE ──
   * Same vendor + same name + same skill = DUPLICATE
   */
  const existing = rows.find(row => row.unique_uid.startsWith(`${exactBase}-`));
  if (existing) {
    return { 
      duplicate: true, 
      existingUid: existing.unique_uid 
    };
  }

  /**
   * ── FIND MAX COUNT FOR SAME VENDOR + SAME NAME ──
   * Different skill = new profile, increment the count
   */
  let max = 0;
  for (const row of rows) {
    const parts = row.unique_uid.split('-');
    const count = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(count) && count > max) max = count;
  }
  
  // Return new UID with incremented count
  return { 
    duplicate: false, 
    uid: `${exactBase}-${max + 1}` 
  };
}

// ──────────────────────────────────────────────────────────────
// GET /api/resources
// Description: Get all resources with optional filters
// Query Parameters: type, vendor_id
// ──────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { type, vendor_id } = req.query;
    
    /**
     * Base SQL query with vendor name join
     * SELECT all resource fields + vendor name
     */
    let sql = `SELECT r.*, v.vendor_name 
               FROM crm_resources r 
               LEFT JOIN crm_vendors v ON v.id = r.vendor_id`;
    const params = [];
    const conditions = [];
    
    // Apply filters if provided
    if (type) { 
      conditions.push('r.type = ?'); 
      params.push(type); 
    }
    if (vendor_id) { 
      conditions.push('r.vendor_id = ?'); 
      params.push(vendor_id); 
    }
    
    // Add WHERE clause if conditions exist
    if (conditions.length) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    
    // Sort by newest first
    sql += ' ORDER BY r.created_at DESC';
    
    const [rows] = await pool.query(sql, params);
    res.json(rows);
    
  } catch (err) {
    console.error('GET resources error:', err);
    res.status(500).json({ error: 'Failed to fetch resources.' });
  }
});

// ──────────────────────────────────────────────────────────────
// GET /api/resources/:id
// Description: Get a single resource by ID (used for edit modal)
// ──────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.*, v.vendor_name, p.poc_name 
       FROM crm_resources r
       LEFT JOIN crm_vendors v ON v.id = r.vendor_id
       LEFT JOIN crm_pocs p ON p.id = r.poc_id
       WHERE r.id = ?`, 
      [req.params.id]
    );
    
    if (!rows.length) {
      return res.status(404).json({ error: 'Resource not found.' });
    }
    
    res.json(rows[0]);
    
  } catch (err) {
    console.error('GET resource error:', err);
    res.status(500).json({ error: 'Failed to fetch resource.' });
  }
});

// ──────────────────────────────────────────────────────────────
// POST /api/resources
// Description: Create a new resource with duplicate check
// ──────────────────────────────────────────────────────────────
router.post('/', (req, res, next) => {
  /**
   * First, handle file upload using multer
   * If upload fails, return error
   */
  upload.single('cv')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  /**
   * Extract form data from request body
   * Fields: resource_name, title, skills, type, vendor_id, etc.
   */
  const {
    resource_name, title, experience_years, skills, type,
    vendor_id, poc_id,
    managed_by, contact_number, email, linkedin,
    preferred_location, current_location,
    salary_lpm
  } = req.body;

  // ── VALIDATE REQUIRED FIELDS ──
  if (!resource_name || !skills || !type) {
    return res.status(400).json({ 
      error: 'resource_name, skills, and type are required.' 
    });
  }

  // ── START DATABASE TRANSACTION ──
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // ── DETERMINE VENDOR CODE ──
    let vendorCode = 'INH'; // Default for In-House
    let resolvedVendorId = null;
    let resolvedPocId = poc_id || null;

    if (type === 'Vendor') {
      // Vendor type requires vendor_id
      if (!vendor_id) {
        await conn.rollback();
        return res.status(400).json({ 
          error: 'vendor_id required for Vendor type.' 
        });
      }
      
      // Fetch vendor details with row lock
      const [vRows] = await conn.query(
        'SELECT id, short_code FROM crm_vendors WHERE id = ? FOR UPDATE', 
        [vendor_id]
      );
      
      if (!vRows.length) {
        await conn.rollback();
        return res.status(404).json({ error: 'Vendor not found.' });
      }
      
      vendorCode = sanitizeToken(vRows[0].short_code);
      resolvedVendorId = vRows[0].id;
    }

    /**
     * ── ✅ FIX: Use TITLE for UID (not skills) ──
     * Priority: title > skills first value > fallback
     * 
     * Why? Title is shorter and more meaningful for UID
     * Example: "Python Developer" instead of "Python, Django, AWS..."
     */
    let technology = '';
    if (title && title.trim()) {
      // Use title if available
      technology = title.trim();
    } else if (skills && skills.trim()) {
      // Fallback: use first skill
      technology = skills.split(',')[0].trim();
    } else {
      // Ultimate fallback (should never happen due to validation)
      technology = 'SKILL';
    }
    
    // ── GENERATE UNIQUE UID ──
    const uidResult = await generateUid(conn, { 
      vendorCode, 
      resourceName: resource_name, 
      technology 
    });
    
    // ── CHECK FOR DUPLICATE ──
    if (uidResult.duplicate) {
      await conn.rollback();
      return res.status(409).json({
        error: `⚠️ Duplicate resource found. Already exists as ${uidResult.existingUid}.`,
        existing_uid: uidResult.existingUid
      });
    }
    
    const uniqueUid = uidResult.uid;
    
    // ── HANDLE CV UPLOAD ──
    const cvPath = req.file ? `/uploads/cvs/${req.file.filename}` : null;

    // ── INSERT INTO DATABASE ──
    // BUG FIX: this used to insert into a column called "salary_lpm", which
    // doesn't exist — the real column is "salary_lpm". Every single Add
    // Resource submission was failing with a SQL error because of this.
    const [result] = await conn.query(
      `INSERT INTO crm_resources
       (unique_uid, resource_name, title, experience_years, skills, cv_path, type, status, 
        vendor_id, poc_id, managed_by, contact_number, email, linkedin, 
        preferred_location, current_location, salary_lpm, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Available', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uniqueUid, 
        resource_name, 
        title || null, 
        experience_years || null,
        skills, 
        cvPath, 
        type,
        type === 'Vendor' ? resolvedVendorId : null,
        type === 'Vendor' ? resolvedPocId : null,
        type === 'In-House' ? (managed_by || null) : null,
        type === 'In-House' ? (contact_number || null) : null,
        type === 'In-House' ? (email || null) : null,
        type === 'In-House' ? (linkedin || null) : null,
        preferred_location || null, 
        current_location || null,
        salary_lpm || null, 
        req.session.user.id
      ]
    );

    // ── COMMIT TRANSACTION ──
    await conn.commit();
    
    res.status(201).json({ 
      id: result.insertId, 
      unique_uid: uniqueUid,
      message: 'Resource created successfully!' 
    });
    
  } catch (err) {
    // ── ROLLBACK ON ERROR ──
    await conn.rollback();
    console.error('POST resource error:', err);
    res.status(500).json({ error: 'Failed to create resource.' });
  } finally {
    conn.release();
  }
});

// ──────────────────────────────────────────────────────────────
// PUT /api/resources/:id
// Description: Update a resource - preserves existing data
// ──────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    // ── 1. Load existing record first ──
    const [existing] = await pool.query(
      'SELECT * FROM crm_resources WHERE id = ?', 
      [req.params.id]
    );
    
    if (!existing.length) {
      return res.status(404).json({ error: 'Resource not found.' });
    }

    const current = existing[0];
    const body = req.body;

    /**
     * ── 2. Merge: use body value if provided, otherwise keep existing ──
     * v() - returns body value if present, else current value
     * vNull() - same but allows null values
     */
    const v = (key) => (body[key] !== undefined && body[key] !== '') 
      ? body[key] 
      : current[key];
    
    const vNull = (key) => (body[key] !== undefined) 
      ? (body[key] || null) 
      : current[key];

    const type = body.type || current.type;

    // ── 3. Update query ──
    // BUG FIX: same salary_lpm/salary_lpm mismatch as the POST route above —
    // this UPDATE was targeting a column that doesn't exist.
    await pool.query(
      `UPDATE crm_resources SET
       resource_name = ?, title = ?, experience_years = ?, skills = ?, type = ?, status = ?,
       vendor_id = ?, poc_id = ?,
       managed_by = ?, contact_number = ?, email = ?, linkedin = ?,
       preferred_location = ?, current_location = ?, salary_lpm = ?
       WHERE id = ?`,
      [
        v('resource_name'), 
        vNull('title'), 
        vNull('experience_years'),
        v('skills'), 
        type,
        body.status || current.status,
        type === 'Vendor' ? vNull('vendor_id') : null,
        type === 'Vendor' ? vNull('poc_id') : null,
        type === 'In-House' ? vNull('managed_by') : null,
        type === 'In-House' ? vNull('contact_number') : null,
        type === 'In-House' ? vNull('email') : null,
        type === 'In-House' ? vNull('linkedin') : null,
        vNull('preferred_location'), 
        vNull('current_location'),
        vNull('salary_lpm'),
        req.params.id
      ]
    );
    
    res.json({ 
      ok: true,
      message: 'Resource updated successfully!' 
    });
    
  } catch (err) {
    console.error('PUT resource error:', err);
    res.status(500).json({ error: 'Failed to update resource.' });
  }
});

// ──────────────────────────────────────────────────────────────
// DELETE /api/resources/:id
// Description: Delete a resource by ID
// ──────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const [result] = await pool.query(
      'DELETE FROM crm_resources WHERE id = ?', 
      [req.params.id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Resource not found.' });
    }
    
    res.json({ 
      ok: true,
      message: 'Resource deleted successfully!' 
    });
    
  } catch (err) {
    console.error('DELETE resource error:', err);
    res.status(500).json({ error: 'Failed to delete resource.' });
  }
});

module.exports = router;