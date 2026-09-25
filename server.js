/**
 * server.js — CWA Internal CRM v3
 */
require('dotenv').config();
const express   = require('express');
const path      = require('path');
const session   = require('express-session');
const helmet    = require('helmet');
const MySQLStore = require('express-mysql-session')(session);
const pool      = require('./db');

const { requireLogin } = require('./middleware/auth');
const checkLicense     = require('./middleware/license');

// ── Page routes ──────────────────────────────────────────────────────────────
const authRoutes       = require('./routes/auth');
const dashboardRoutes  = require('./routes/dashboard');
const superAdminRoutes = require('./routes/superadmin');
const clientsPage      = require('./routes/clientsPage');
const vendorsPage      = require('./routes/vendorsPage');
const leadsPage        = require('./routes/leadsPage');
const requirementsPage = require('./routes/requirementsPage');
const resourcesPage    = require('./routes/resourcesPage');
const membersPage      = require('./routes/membersPage');
const profilePage      = require('./routes/profilePage');
const teamPage         = require('./routes/teamPage');
const tasksPage         = require('./routes/tasksPage');

// ── JSON API routes ───────────────────────────────────────────────────────────
const usersApi        = require('./routes/users');
const clientsApi      = require('./routes/clients');
const vendorsApi      = require('./routes/vendors');
const pocsApi         = require('./routes/pocs');
const resourcesApi    = require('./routes/resources');
const leadsApi        = require('./routes/leads');
const requirementsApi = require('./routes/requirements');
const activityApi     = require('./routes/activity');
const statsApi        = require('./routes/stats');
const searchApi       = require('./routes/search');
const tasksApi        = require('./routes/tasks');
const aiApi           = require('./routes/ai');

const app  = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be set and contain at least 32 characters.');
}

// ── View engine ───────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Security headers + body parsers + static ───────────────────────────────────
app.disable('x-powered-by');
// CSP is disabled temporarily because the current EJS views use inline scripts;
// migrate those scripts to external files/nonces before enabling a strict CSP.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb', parameterLimit: 100 }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Sessions ──────────────────────────────────────────────────────────────────
const sessionStore = new MySQLStore({}, pool);
app.use(session({
  key: 'crm_session',
  secret: SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 8, // 8 hours
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));

// ── Root redirect ─────────────────────────────────────────────────────────────
app.get('/', (req, res) =>
  res.redirect(req.session.user ? '/dashboard' : '/login')
);

// ── Auth — always reachable ───────────────────────────────────────────────────
app.use('/', authRoutes);

// ── License gate ──────────────────────────────────────────────────────────────
app.use(checkLicense);

// Uploaded CVs and avatars are private CRM data; serve them only after
// authentication and the license gate have both passed.
app.use('/uploads', requireLogin, express.static(path.join(__dirname, 'uploads'), {
  dotfiles: 'deny',
  fallthrough: false
}));

// ── Page routes ───────────────────────────────────────────────────────────────
app.use('/', dashboardRoutes);
app.use('/', clientsPage);
app.use('/', vendorsPage);
app.use('/', leadsPage);
app.use('/', requirementsPage);
app.use('/', resourcesPage);
app.use('/', membersPage);
app.use('/', profilePage);
app.use('/', teamPage);          // GET /team + POST /api/team/*
app.use('/', tasksPage);
app.use('/super-admin', superAdminRoutes);

// ── API routes (all need login) ───────────────────────────────────────────────
app.use('/api', requireLogin);
app.use('/api/users',        usersApi);
app.use('/api/clients',      clientsApi);
app.use('/api/vendors',      vendorsApi);
app.use('/api/pocs',         pocsApi);
app.use('/api/resources',    resourcesApi);
app.use('/api/leads',        leadsApi);
app.use('/api/requirements', requirementsApi);
app.use('/api/activity',     activityApi);
// NOTE: dashboard.ejs calls fetch('/api/dashboard/stats'), so statsApi
// (which defines its handler at router.get('/')) must be mounted at
// '/api/dashboard/stats' — NOT '/api/dashboard'. Mounting it one level too
// shallow was the bug behind "dashboard charts never render": every request
// silently 404'd, the frontend's destructuring of an empty error object then
// threw, and the whole chart-drawing script aborted before touching Chart.js.
app.use('/api/dashboard/stats', statsApi);
app.use('/api/search',       searchApi);   // GET /api/search?q=
app.use('/api/tasks',        tasksApi);
app.use('/api/ai',           aiApi);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', ts: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/'))
    return res.status(404).json({ error: 'Route not found.' });
  res.status(404).render('404');
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  if (req.path.startsWith('/api/'))
    return res.status(500).json({ error: 'Internal server error.' });
  res.status(500).send('Internal server error.');
});

app.listen(PORT, () => {
  console.log(`\n🚀  CWA CRM → http://localhost:${PORT}\n`);
  pool.testConnection();
});
