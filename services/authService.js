/**
 * services/authService.js
 * Handles persistent "Remember Me" / Save Login tokens and automatic session restoration.
 */

const crypto = require('crypto');
const pool = require('../db');

const REMEMBER_COOKIE_NAME = 'crm_remember';
const REMEMBER_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Ensure the remember tokens table exists in the database
 */
async function initRememberTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS crm_remember_tokens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        token_hash VARCHAR(255) NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_token_hash (token_hash)
      ) ENGINE=InnoDB;
    `);
  } catch (err) {
    console.error('Failed to initialize crm_remember_tokens table:', err);
  }
}

/**
 * Generate a persistent remember token for a user
 * @param {number} userId
 * @returns {Promise<{cookieValue: string, maxAge: number}>}
 */
async function createRememberToken(userId) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + REMEMBER_DURATION_MS);

  await pool.query(
    'INSERT INTO crm_remember_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [userId, tokenHash, expiresAt]
  );

  return {
    cookieName: REMEMBER_COOKIE_NAME,
    cookieValue: `${userId}:${rawToken}`,
    maxAge: REMEMBER_DURATION_MS,
    options: {
      maxAge: REMEMBER_DURATION_MS,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/'
    }
  };
}

/**
 * Verify a remember cookie and return the user if valid
 * @param {string} cookieValue
 * @returns {Promise<object|null>}
 */
async function verifyRememberToken(cookieValue) {
  if (!cookieValue || typeof cookieValue !== 'string') return null;

  const parts = cookieValue.split(':');
  if (parts.length !== 2) return null;

  const [userIdStr, rawToken] = parts;
  const userId = parseInt(userIdStr, 10);
  if (!userId || !rawToken) return null;

  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const [rows] = await pool.query(
    `SELECT r.id AS token_id, u.*
     FROM crm_remember_tokens r
     JOIN crm_users u ON u.id = r.user_id
     WHERE r.user_id = ? AND r.token_hash = ? AND r.expires_at > NOW() AND u.status = 'active'
     LIMIT 1`,
    [userId, tokenHash]
  );

  if (!rows || rows.length === 0) {
    return null;
  }

  return rows[0];
}

/**
 * Delete a specific remember token
 * @param {string} cookieValue
 */
async function deleteRememberToken(cookieValue) {
  if (!cookieValue || typeof cookieValue !== 'string') return;

  const parts = cookieValue.split(':');
  if (parts.length !== 2) return;

  const [userIdStr, rawToken] = parts;
  const userId = parseInt(userIdStr, 10);
  if (!userId || !rawToken) return;

  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  await pool.query(
    'DELETE FROM crm_remember_tokens WHERE user_id = ? AND token_hash = ?',
    [userId, tokenHash]
  );
}

/**
 * Express middleware to automatically log in users who have a valid remember token
 */
async function autoLoginMiddleware(req, res, next) {
  // If user already has an active session, continue
  if (req.session && req.session.user) {
    return next();
  }

  const rememberCookie = req.cookies ? req.cookies[REMEMBER_COOKIE_NAME] : null;
  if (!rememberCookie) {
    return next();
  }

  try {
    const user = await verifyRememberToken(rememberCookie);
    if (user) {
      // Regenerate session for security
      if (req.session.regenerate) {
        await new Promise((resolve) => req.session.regenerate(resolve));
      }

      // Restore session user object
      req.session.user = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar_path: user.avatar_path || null
      };

      // Extend session cookie duration
      req.session.cookie.maxAge = REMEMBER_DURATION_MS;
    } else {
      // Token is invalid or expired, clear the cookie
      res.clearCookie(REMEMBER_COOKIE_NAME, { path: '/' });
    }
  } catch (err) {
    console.error('Error during auto-login via remember token:', err);
  }

  next();
}

module.exports = {
  REMEMBER_COOKIE_NAME,
  REMEMBER_DURATION_MS,
  initRememberTable,
  createRememberToken,
  verifyRememberToken,
  deleteRememberToken,
  autoLoginMiddleware
};
