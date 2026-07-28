// ============================================================================
// routes/stats.js — Dashboard statistics API
//
// Mounted at /api/dashboard/stats in server.js (see the comment there — this
// exact mount path used to be wrong, which is why dashboard charts never
// rendered; see DOCUMENTATION.md → "Dashboard Chart Data Flow").
//
// Point 7 (dashboard works for every role): this route has no requireRole
// gate, only the blanket requireLogin applied to all of /api in server.js —
// every role can call it. Requirement-related numbers are additionally
// scoped to "my own" for an emp, matching the same visibility rule used on
// the Requirements list/detail pages, so an employee's dashboard reflects
// their own pipeline rather than the whole company's.
// ============================================================================

// Import Express framework
const express = require('express');
// Create Express router instance
const router = express.Router();
// Import database connection pool
const pool = require('../db');

// ─── Dashboard Statistics API Endpoint ──────────────────────────────────
// Dashboard ke charts aur cards ke liye data provide karta hai
// Har role (admin, super_admin, emp) ke liye alag-alag data based on permissions
router.get('/', async (req, res) => {
  try {
    // Current logged-in user ki info
    const user = req.session.user;
    
    // Employees only see counts for requirements THEY created; admin/super_admin see everything.
    // Employee ke liye filter: sirf unki own requirements dikhein
    // Admin/SuperAdmin ke liye: saari requirements dikhein
    const ownFilter  = user && user.role === 'emp' ? ' AND created_by = ?' : '';
    const ownParams  = user && user.role === 'emp' ? [user.id] : [];

    // ─── Today's Requirements ─────────────────────────────────────────────
    // Aaj create hui requirements ki count
    const [[{reqToday}]] = await pool.query(
      `SELECT COUNT(*) AS reqToday FROM crm_requirements WHERE DATE(created_at)=CURDATE()${ownFilter}`, ownParams);
    
    // ─── This Month's Requirements ────────────────────────────────────────
    // Is mahine create hui requirements ki count
    const [[{reqMonth}]] = await pool.query(
      `SELECT COUNT(*) AS reqMonth FROM crm_requirements WHERE YEAR(created_at)=YEAR(CURDATE()) AND MONTH(created_at)=MONTH(CURDATE())${ownFilter}`, ownParams);
    
    // "Profiles Sent" = resource-mapping activity-log entries (each one is
    // created when a resource is sent against a requirement — see
    // routes/requirements.js map-resource). Point: Admin/Super Admin see the
    // company-wide total; an emp sees only the profiles THEY sent
    // (created_by = their own id), same ownership rule as everywhere else.
    // ─── Today's Profiles Sent ────────────────────────────────────────────
    // Aaj bheje gaye profiles (resources mapped to requirements) ki count
    const profilesOwnFilter = user && user.role === 'emp' ? ' AND created_by = ?' : '';
    const profilesOwnParams = user && user.role === 'emp' ? [user.id] : [];
    const [[{profilesToday}]] = await pool.query(
      `SELECT COUNT(*) AS profilesToday FROM crm_activity_logs WHERE ref_resource_id IS NOT NULL AND DATE(created_at)=CURDATE()${profilesOwnFilter}`, profilesOwnParams);
    
    // ─── This Month's Profiles Sent ──────────────────────────────────────
    // Is mahine bheje gaye profiles ki count
    const [[{profilesMonth}]] = await pool.query(
      `SELECT COUNT(*) AS profilesMonth FROM crm_activity_logs WHERE ref_resource_id IS NOT NULL AND YEAR(created_at)=YEAR(CURDATE()) AND MONTH(created_at)=MONTH(CURDATE())${profilesOwnFilter}`, profilesOwnParams);
    
    // ─── This Month's Leads ──────────────────────────────────────────────
    // Is mahine create hui leads ki count
    const [[{leadsMonth}]] = await pool.query(
      "SELECT COUNT(*) AS leadsMonth FROM crm_leads WHERE YEAR(created_at)=YEAR(CURDATE()) AND MONTH(created_at)=MONTH(CURDATE())");
    
    // Master-data totals (resources/clients/vendors) stay company-wide for
    // every role — they aren't "owned" by whoever created them.
    // ─── Total Resources ──────────────────────────────────────────────────
    // Total resources count (company-wide)
    const [[{resourcesTotal}]] = await pool.query("SELECT COUNT(*) AS resourcesTotal FROM crm_resources");
    
    // ─── Total Clients ────────────────────────────────────────────────────
    // Total clients count (company-wide)
    const [[{clientsTotal}]] = await pool.query("SELECT COUNT(*) AS clientsTotal FROM crm_clients");
    
    // ─── Total Vendors ────────────────────────────────────────────────────
    // Total vendors count (company-wide)
    const [[{vendorsTotal}]] = await pool.query("SELECT COUNT(*) AS vendorsTotal FROM crm_vendors");
    
    // 'Open' / 'Hold' — the two real requirement statuses (see migration_v5.sql;
    // 'Closed' is a delete action, not a stored value, so there's no closedReqs card anymore).
    // ─── Open Requirements ────────────────────────────────────────────────
    // Status 'Open' wali requirements ki count
    const [[{openReqs}]] = await pool.query(
      `SELECT COUNT(*) AS openReqs FROM crm_requirements WHERE status='Open'${ownFilter}`, ownParams);
    
    // ─── Hold Requirements ────────────────────────────────────────────────
    // Status 'Hold' wali requirements ki count
    const [[{holdReqs}]] = await pool.query(
      `SELECT COUNT(*) AS holdReqs FROM crm_requirements WHERE status='Hold'${ownFilter}`, ownParams);

    // ─── Requirements Trend (Last 30 Days) ──────────────────────────────
    // Last 30 days ka daily requirements trend for chart
    const [reqTrend] = await pool.query(
      `SELECT DATE(created_at) AS day, COUNT(*) AS count FROM crm_requirements
       WHERE created_at>=DATE_SUB(CURDATE(),INTERVAL 29 DAY)${ownFilter}
       GROUP BY DATE(created_at) ORDER BY day ASC`, ownParams);
    
    // ─── Leads Trend (Last 7 Days) ──────────────────────────────────────
    // Last 7 days ka daily leads trend for chart
    const [leadsTrend] = await pool.query(
      "SELECT DATE(created_at) AS day, COUNT(*) AS count FROM crm_leads WHERE created_at>=DATE_SUB(CURDATE(),INTERVAL 6 DAY) GROUP BY DATE(created_at) ORDER BY day ASC");

    // ─── Monthly Breakdown for Charts ────────────────────────────────────
    // Current month ke requirements count (for pie chart)
    const [[{reqMonthD}]] = await pool.query(
      `SELECT COUNT(*) AS reqMonthD FROM crm_requirements WHERE YEAR(created_at)=YEAR(CURDATE()) AND MONTH(created_at)=MONTH(CURDATE())${ownFilter}`, ownParams);
    
    // ─── Monthly Resources ────────────────────────────────────────────────
    // Current month ke resources count (for pie chart)
    const [[{resMonthD}]] = await pool.query("SELECT COUNT(*) AS resMonthD FROM crm_resources WHERE YEAR(created_at)=YEAR(CURDATE()) AND MONTH(created_at)=MONTH(CURDATE())");
    
    // ─── Monthly Leads ────────────────────────────────────────────────────
    // Current month ke leads count (for pie chart)
    const [[{leadMonthD}]] = await pool.query("SELECT COUNT(*) AS leadMonthD FROM crm_leads WHERE YEAR(created_at)=YEAR(CURDATE()) AND MONTH(created_at)=MONTH(CURDATE())");
    
    // ─── Resource Split ──────────────────────────────────────────────────
    // In-House vs Vendor resources split (for pie chart)
    const [[{inHouseCount}]] = await pool.query("SELECT COUNT(*) AS inHouseCount FROM crm_resources WHERE type='In-House'");
    const [[{vendorCount}]] = await pool.query("SELECT COUNT(*) AS vendorCount FROM crm_resources WHERE type='Vendor'");

    // Turns a sparse "day -> count" result set into a dense, zero-filled
    // array covering the last `days` calendar days (so the line/bar chart
    // doesn't have gaps on days with zero activity).
    // Helper function: Sparse data ko dense array mein convert karta hai
    // Missing dates ke liye 0 value fill karta hai (chart mein gaps nahi aane deta)
    function buildDailyArray(days, rows) {
      const map = {};
      rows.forEach(r => { map[r.day] = Number(r.count); });
      const labels = [], data = [];
      for (let i = days-1; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate()-i);
        const key = d.toISOString().slice(0,10);
        labels.push(d.toLocaleDateString('en-IN',{month:'short',day:'numeric'}));
        data.push(map[key] || 0);
      }
      return { labels, data };
    }

    // ─── Final Response ──────────────────────────────────────────────────
    // Cards data + Charts data combined JSON response
    res.json({
      cards: { 
        reqToday,           // Aaj ki requirements
        reqMonth,           // Is mahine ki requirements
        profilesToday,      // Aaj bheje gaye profiles
        profilesMonth,      // Is mahine bheje gaye profiles
        leadsMonth,         // Is mahine ki leads
        resourcesTotal,     // Total resources
        clientsTotal,       // Total clients
        vendorsTotal,       // Total vendors
        openReqs,           // Open requirements
        holdReqs            // Hold requirements
      },
      charts: {
        reqTrend: buildDailyArray(30, reqTrend),      // Last 30 days requirements trend
        leadsTrend: buildDailyArray(7, leadsTrend),   // Last 7 days leads trend
        workBreakdown: {                              // Current month breakdown
          requirements: reqMonthD, 
          resources: resMonthD, 
          leads: leadMonthD 
        },
        resourceSplit: {                              // Resources split
          inHouse: inHouseCount, 
          vendor: vendorCount 
        }
      }
    });
  } catch (err) {
    // Agar koi error aata hai toh console mein log karna aur 500 error return karna
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats.' });
  }
});

// Export router for use in main application
// Router ko export karna taaki main app mein use kar sakein
module.exports = router;