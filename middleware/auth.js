/**
 * ─────────────────────────────────────────────────────────────────────────────
 * AUTHENTICATION MIDDLEWARE - auth.js
 * Handles all role-based access control for the application
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * ─── requireLogin ─────────────────────────────────────────────────────────────
 * Description: Ensures user is logged in before accessing any route
 * - If not logged in: Redirect to /login (for HTML) or return 401 (for API)
 */
function requireLogin(req, res, next) {
  // Check if user exists in session
  if (!req.session.user) {
    // If API request, return 401 JSON error
    // If HTML request, redirect to login page
    return req.path.startsWith('/api/')
      ? res.status(401).json({ error: 'Please log in.' })
      : res.redirect('/login');
  }
  // User is logged in, proceed to next middleware/route
  next();
}

/**
 * ─── requireRole ──────────────────────────────────────────────────────────────
 * Description: Restricts access to specific roles only
 * @param {...string} roles - List of allowed roles (e.g., 'admin', 'super_admin')
 * 
 * Usage: requireRole('admin', 'super_admin')
 */
function requireRole(...roles) {
  return (req, res, next) => {
    // Check if user is logged in
    if (!req.session.user) {
      return req.path.startsWith('/api/')
        ? res.status(401).json({ error: 'Please log in.' })
        : res.redirect('/login');
    }
    
    // Check if user's role is in allowed roles list
    if (!roles.includes(req.session.user.role)) {
      return req.path.startsWith('/api/')
        ? res.status(403).json({ error: 'Permission denied.' })
        : res.status(403).render('error', { 
            message: 'You do not have permission to view this page.', 
            user: req.session.user 
          });
    }
    
    // User has required role, proceed
    next();
  };
}

/**
 * ─── requireEmployeeAccess ───────────────────────────────────────────────────
 * Description: Allows access to ALL logged-in users (Employee, Admin, Superadmin)
 * Used for: Resources, Clients, Vendors (global sections)
 */
function requireEmployeeAccess(req, res, next) {
  // Check if user is logged in
  if (!req.session.user) {
    return req.path.startsWith('/api/')
      ? res.status(401).json({ error: 'Please log in.' })
      : res.redirect('/login');
  }
  
  // ✅ Sabhi roles ko access allowed (Employee, Admin, Superadmin)
  // No role restriction - just allow all logged-in users
  next();
}

/**
 * ─── requireGlobalAccess ─────────────────────────────────────────────────────
 * Description: Allows access to ALL logged-in users for global sections
 * Used for: Resources, Clients, Vendors
 * Same as requireEmployeeAccess but with explicit allowed roles
 */
function requireGlobalAccess(req, res, next) {
  // Check if user is logged in
  if (!req.session.user) {
    return req.path.startsWith('/api/')
      ? res.status(401).json({ error: 'Please log in.' })
      : res.redirect('/login');
  }
  
  // ✅ Explicitly allow: Employee, Admin, Superadmin
  const allowedRoles = ['emp', 'admin', 'super_admin'];
  if (!allowedRoles.includes(req.session.user.role)) {
    return res.status(403).render('error', {
      message: 'You do not have permission to view this page.',
      user: req.session.user
    });
  }
  
  next();
}

/**
 * ─── requireLeadsAccess ─────────────────────────────────────────────────────
 * Description: Allows access to Leads section for ALL logged-in users
 * Used for: Leads (List, Add, Edit, Detail)
 */
function requireLeadsAccess(req, res, next) {
  // Check if user is logged in
  if (!req.session.user) {
    return req.path.startsWith('/api/')
      ? res.status(401).json({ error: 'Please log in.' })
      : res.redirect('/login');
  }
  
  // ✅ Admin, Superadmin, Employee sabko leads access
  const allowedRoles = ['admin', 'super_admin', 'emp'];
  if (!allowedRoles.includes(req.session.user.role)) {
    return res.status(403).render('error', {
      message: 'You do not have permission to view this page.',
      user: req.session.user
    });
  }
  
  next();
}

/**
 * ─── requireRequirementsAccess ──────────────────────────────────────────────
 * Description: Allows access to Requirements section for ALL logged-in users
 * - Employee: Only their own requirements (filtered in route)
 * - Admin/Superadmin: All requirements
 */
function requireRequirementsAccess(req, res, next) {
  // Check if user is logged in
  if (!req.session.user) {
    return req.path.startsWith('/api/')
      ? res.status(401).json({ error: 'Please log in.' })
      : res.redirect('/login');
  }
  
  // ✅ Sabhi roles ko access allowed
  // Employee → filtering route mein handle hogi
  // Admin/Superadmin → saare requirements
  const allowedRoles = ['admin', 'super_admin', 'emp'];
  if (!allowedRoles.includes(req.session.user.role)) {
    return res.status(403).render('error', {
      message: 'You do not have permission to view this page.',
      user: req.session.user
    });
  }
  
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS - Sabhi middlewares ko export karo
// ─────────────────────────────────────────────────────────────────────────────
module.exports = { 
  requireLogin,               // Basic login check
  requireRole,                // Role-based restriction (specific roles)
  requireEmployeeAccess,      // All logged-in users access
  requireGlobalAccess,        // Global sections access (Resources, Clients, Vendors)
  requireLeadsAccess,         // Leads section access
  requireRequirementsAccess   // Requirements section access
};