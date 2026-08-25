const pool = require('../db');

// Basic public routes & static assets
const ALWAYS_ALLOWED = [
  '/login',
  '/logout',
  '/super-admin/license',
  '/css',
  '/js',
  '/img',
  '/api/health'
];

async function checkLicense(req, res, next) {
  // 1. Static assets & Login / Super-Admin License Page allow karo
  if (ALWAYS_ALLOWED.some(p => req.path.startsWith(p))) {
    return next();
  }

  // 2. ONLY Super Admin is allowed without a valid license
  if (req.session && req.session.user && req.session.user.role === 'super_admin') {
    return next();
  }

  // 3. Admin & Employees ke liye strict License Check
  try {
    const [rows] = await pool.query('SELECT * FROM crm_license ORDER BY valid_until DESC LIMIT 1');
    const today = new Date().toISOString().slice(0, 10);

    // Agar table khali hai YA license date expire ho chuki hai -> BLOCK
    const isValid = rows.length > 0 && rows[0].valid_until >= today;

    if (!isValid) {
      return req.path.startsWith('/api/')
        ? res.status(402).json({ error: 'License missing or expired. Contact Super Admin.' })
        : res.status(402).render('license-expired', { user: req.session.user || null });
    }

    // License active hai -> Allow access
    next();
  } catch (err) {
    console.error('License check error:', err);
    return req.path.startsWith('/api/')
      ? res.status(500).json({ error: 'License check database error.' })
      : res.status(500).send('License verification failed.');
  }
}

module.exports = checkLicense;