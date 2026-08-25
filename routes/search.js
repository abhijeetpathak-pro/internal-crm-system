// Import Express framework
const express = require('express');
// Create Express router instance
const router = express.Router();
// Import database connection pool
const pool = require('../db');

// ─── Global Search Endpoint ──────────────────────────────────────────────
// Multiple entity types (Resources, Requirements, Clients, Vendors, Leads) mein search karta hai
// Query parameter 'q' ke through search term leta hai
router.get('/', async (req, res) => {
  // Search query ko trim karna aur extract karna
  const q = String(req.query.q || '').trim();
  
  // Keep autocomplete requests small and predictable.
  if (!q || q.length < 2 || q.length > 100) return res.json([]);
  
  // SQL LIKE pattern banana for partial matching
  const like = `%${q}%`;
  // Results array jisme saari entities ki results store hongi
  const results = [];
  
  try {
    // ─── Search in Resources ──────────────────────────────────────────────
    // Resource name, unique UID, ya skills ke hisaab se search
    // LIMIT 6 - maximum 6 results
    const [resources] = await pool.query(
      "SELECT id,resource_name,unique_uid,title,skills,type FROM crm_resources WHERE resource_name LIKE ? OR unique_uid LIKE ? OR skills LIKE ? LIMIT 6", 
      [like, like, like]
    );
    // Har resource ko formatted result mein convert karna
    resources.forEach(r => results.push({ 
      type: r.type==='In-House'?'In-House':'Resource',  // Type display ke liye
      label: `${r.resource_name} — ${r.unique_uid}`,     // Main label - name + UID
      sublabel: r.skills,                                 // Sub-label - skills
      url: `/resources/${r.id}`                          // Detail page URL
    }));

    // ─── Search in Requirements ──────────────────────────────────────────
    // Requirement title ya client company name ke hisaab se search
    // LEFT JOIN with clients to get company name
    // LIMIT 5 - maximum 5 results
    let requirementsSql = `SELECT r.id,r.title,r.status,c.company_name
      FROM crm_requirements r
      LEFT JOIN crm_clients c ON c.id=r.client_id
      WHERE (r.title LIKE ? OR c.company_name LIKE ?)`;
    const requirementParams = [like, like];
    if (req.session.user.role === 'emp') {
      requirementsSql += ' AND r.created_by = ?';
      requirementParams.push(req.session.user.id);
    }
    requirementsSql += ' LIMIT 5';
    const [reqs] = await pool.query(requirementsSql, requirementParams);
    // Har requirement ko formatted result mein convert karna
    reqs.forEach(r => results.push({ 
      type: 'Requirement',        // Entity type
      label: r.title,             // Main label - requirement title
      sublabel: r.company_name||'', // Sub-label - company name (if exists)
      url: `/requirements/${r.id}` // Detail page URL
    }));

    // ─── Search in Clients ──────────────────────────────────────────────
    // Client company name ke hisaab se search
    // LIMIT 4 - maximum 4 results
    const [clients] = await pool.query(
      "SELECT id,company_name FROM crm_clients WHERE company_name LIKE ? LIMIT 4", 
      [like]
    );
    // Har client ko formatted result mein convert karna
    clients.forEach(c => results.push({ 
      type: 'Client',              // Entity type
      label: c.company_name,       // Main label - company name
      sublabel: '',                // No sub-label
      url: `/clients/${c.id}`      // Detail page URL
    }));

    // ─── Search in Vendors ──────────────────────────────────────────────
    // Vendor name ya short code ke hisaab se search
    // LIMIT 4 - maximum 4 results
    const [vendors] = await pool.query(
      "SELECT id,vendor_name,short_code FROM crm_vendors WHERE vendor_name LIKE ? OR short_code LIKE ? LIMIT 4", 
      [like, like]
    );
    // Har vendor ko formatted result mein convert karna
    vendors.forEach(v => results.push({ 
      type: 'Vendor',              // Entity type
      label: `${v.vendor_name} (${v.short_code})`, // Main label - name + short code
      sublabel: '',                // No sub-label
      url: `/vendors/${v.id}`      // Detail page URL
    }));

    // ─── Search in Leads ─────────────────────────────────────────────────
    // Lead name ya email ke hisaab se search
    // LIMIT 4 - maximum 4 results
    const [leads] = await pool.query(
      "SELECT id,name,email FROM crm_leads WHERE name LIKE ? OR email LIKE ? LIMIT 4", 
      [like, like]
    );
    // Har lead ko formatted result mein convert karna
    leads.forEach(l => results.push({ 
      type: 'Lead',                // Entity type
      label: l.name,               // Main label - lead name
      sublabel: l.email||'',       // Sub-label - email (if exists)
      url: `/leads/${l.id}`        // Detail page URL
    }));

    // ─── Return combined results ────────────────────────────────────────
    // Saari entities ki combined results ko JSON format mein return karna
    res.json(results);
    
  } catch (err) { 
    // Agar koi error aata hai toh 500 error return karna
    res.status(500).json({ error: 'Search failed.' }); 
  }
});

// Export router for use in main application
// Router ko export karna taaki main app mein use kar sakein
module.exports = router;