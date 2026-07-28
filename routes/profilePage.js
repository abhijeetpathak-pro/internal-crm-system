// ============================================================================
// routes/profilePage.js — "My Profile" page
//
// Point: "Profile: wo khud thik kr sake like Image laga sake, apna name
// change kar sake" — every logged-in user (any role) can now update their
// own display name and upload their own avatar image from this page, on
// top of the existing change-password flow.
// ============================================================================

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const pool = require('../db');
const { requireLogin } = require('../middleware/auth');

// Avatars go in their own uploads subfolder, same pattern as CV uploads.
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads', 'avatars')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '');
    cb(null, `user-${req.session.user.id}-${Date.now()}${ext}`);
  }
});
function imageFilter(req, file, cb) {
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype)) {
    return cb(new Error('Only image files (png, jpg, webp, gif) are allowed.'));
  }
  cb(null, true);
}
const upload = multer({ storage, fileFilter: imageFilter, limits: { fileSize: 2 * 1024 * 1024 } });

async function loadProfile(userId) {
  const [rows] = await pool.query('SELECT id,name,email,role,status,avatar_path,created_at FROM crm_users WHERE id=?', [userId]);
  return rows[0];
}

router.get('/profile', requireLogin, async (req, res) => {
  const profile = await loadProfile(req.session.user.id);
  if (!profile) return res.redirect('/logout');
  res.render('profile', { user: req.session.user, profile, active: 'profile', success: null, error: null });
});

// ── Update display name ──────────────────────────────────────────────────
router.post('/profile/name', requireLogin, async (req, res) => {
  const { name } = req.body;
  const render = async (error, success) => {
    const profile = await loadProfile(req.session.user.id);
    res.render('profile', { user: req.session.user, profile, active: 'profile', error, success });
  };
  const trimmed = (name || '').trim();
  if (!trimmed) return render('Name cannot be empty.', null);
  if (trimmed.length > 255) return render('Name is too long.', null);

  await pool.query('UPDATE crm_users SET name=? WHERE id=?', [trimmed, req.session.user.id]);
  // Keep the session's copy of the name in sync immediately — otherwise the
  // old name would keep showing in the topbar/sidebar until next login.
  req.session.user.name = trimmed;
  return render(null, 'Name updated successfully.');
});

// ── Upload / change avatar ───────────────────────────────────────────────
router.post('/profile/avatar', requireLogin, (req, res, next) => {
  upload.single('avatar')(req, res, err => {
    if (err) {
      loadProfile(req.session.user.id).then(profile => {
        res.render('profile', { user: req.session.user, profile, active: 'profile', error: err.message, success: null });
      });
      return;
    }
    next();
  });
}, async (req, res) => {
  if (!req.file) {
    const profile = await loadProfile(req.session.user.id);
    return res.render('profile', { user: req.session.user, profile, active: 'profile', error: 'Please choose an image.', success: null });
  }
  const avatarPath = `/uploads/avatars/${req.file.filename}`;
  await pool.query('UPDATE crm_users SET avatar_path=? WHERE id=?', [avatarPath, req.session.user.id]);
  req.session.user.avatar_path = avatarPath;
  const profile = await loadProfile(req.session.user.id);
  res.render('profile', { user: req.session.user, profile, active: 'profile', error: null, success: 'Profile picture updated successfully.' });
});

// ── Existing: change password ────────────────────────────────────────────
router.post('/profile/password', requireLogin, async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  const render = async (error, success) => {
    const profile = await loadProfile(req.session.user.id);
    res.render('profile', { user: req.session.user, profile, active: 'profile', error, success });
  };
  if (new_password !== confirm_password) return render('New passwords do not match.', null);
  if (new_password.length < 8) return render('New password must be at least 8 characters.', null);
  const [rows] = await pool.query('SELECT password_hash FROM crm_users WHERE id=?', [req.session.user.id]);
  const match = await bcrypt.compare(current_password, rows[0].password_hash);
  if (!match) return render('Current password is incorrect.', null);
  const hash = await bcrypt.hash(new_password, 10);
  await pool.query('UPDATE crm_users SET password_hash=? WHERE id=?', [hash, req.session.user.id]);
  return render(null, 'Password updated successfully.');
});

module.exports = router;
