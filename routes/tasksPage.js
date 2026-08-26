const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireLogin } = require('../middleware/auth');

router.get('/tasks', requireLogin, async (req, res) => {
  try {
    const user = req.session.user;
    const params = [];
    let sql = `SELECT t.*, assignee.name AS assignee_name, creator.name AS creator_name
      FROM crm_tasks t
      LEFT JOIN crm_users assignee ON assignee.id=t.assigned_to
      LEFT JOIN crm_users creator ON creator.id=t.created_by
      WHERE 1=1`;
    if (!['admin', 'super_admin'].includes(user.role)) {
      sql += ' AND (t.created_by=? OR t.assigned_to=?)';
      params.push(user.id, user.id);
    }
    sql += ' ORDER BY (t.status IN ("Completed","Cancelled")), t.due_date IS NULL, t.due_date ASC, FIELD(t.priority,"High","Medium","Low"), t.created_at DESC LIMIT 250';
    const [tasks] = await pool.query(sql, params);
    const [users] = ['admin', 'super_admin'].includes(user.role)
      ? await pool.query('SELECT id,name,email FROM crm_users WHERE status="active" ORDER BY name')
      : [[]];
    res.render('tasks', { tasks, users, user, active: 'tasks' });
  } catch (err) {
    console.error('Tasks page error:', err);
    res.status(500).render('error', { message: 'Unable to load follow-up tasks right now.', user: req.session.user });
  }
});

module.exports = router;
