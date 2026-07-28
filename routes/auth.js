// Import Express framework
const express = require('express');
// Create Express router instance
const router = express.Router();
// Import bcrypt for password hashing and comparison
const bcrypt = require('bcryptjs');
// Import database connection pool
const pool = require('../db');

// GET route to display login page
router.get('/login', (req, res) => {
  // If user is already logged in, redirect to dashboard
  if (req.session.user) return res.redirect('/dashboard');
  // Render login page with no error message initially
  res.render('login', { error: null });
});

// POST route to handle login form submission
router.post('/login', async (req, res) => {
  // Extract email and password from request body
  const { email, password } = req.body;
  
  // Validate that both email and password are provided
  if (!email || !password) return res.render('login', { error: 'Email and password are required.' });
  
  try {
    // Query database for user with the provided email
    const [rows] = await pool.query('SELECT * FROM crm_users WHERE email=?', [email]);
    
    // If no user found, return error
    if (!rows.length) return res.render('login', { error: 'Invalid email or password.' });
    
    // Get the first matching user record
    const user = rows[0];
    
    // Check if user account is disabled
    if (user.status === 'disabled') return res.render('login', { error: 'This account has been disabled. Contact your Super Admin.' });
    
    // Compare provided password with stored password hash
    const match = await bcrypt.compare(password, user.password_hash);
    
    // If passwords don't match, return error
    if (!match) return res.render('login', { error: 'Invalid email or password.' });
    
    // Store user session data (exclude sensitive info like password_hash)
    req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role, avatar_path: user.avatar_path || null };
    
    // Redirect to dashboard on successful login
    res.redirect('/dashboard');
  } catch (err) {
    // Log the actual error for debugging purposes
    console.error('Login error:', err);
    // Show generic error message to user
    res.render('login', { error: 'Something went wrong. Please try again.' });
  }
});

// GET route to handle user logout
router.get('/logout', (req, res) => { 
  // Destroy the session and redirect to login page
  req.session.destroy(() => res.redirect('/login')); 
});

// Export router for use in main application
module.exports = router;