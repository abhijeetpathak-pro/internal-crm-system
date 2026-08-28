const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

const STATUSES = ['Pending', 'In Progress', 'Completed', 'Cancelled'];
const PRIORITIES = ['Low', 'Medium', 'High'];
const ENTITY_TYPES = ['requirement', 'resource', 'lead', 'client', 'vendor'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isAdmin(user) {
  return user.role === 'admin' || user.role === 'super_admin';
}

function parseTaskInput(body) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const priority = body.priority || 'Medium';
  const status = body.status || 'Pending';
  const dueDate = body.due_date ? String(body.due_date) : null;
  const assignedTo = body.assigned_to === '' || body.assigned_to == null ? null : Number.parseInt(body.assigned_to, 10);
  const rawEntityType = typeof body.entity_type === 'string' ? body.entity_type.trim().toLowerCase() : '';
  const entityType = rawEntityType || null;
  const entityId = body.entity_id === '' || body.entity_id == null ? null : Number.parseInt(body.entity_id, 10);

  return { title, description, priority, status, dueDate, assignedTo, entityType, entityId };
}

function validateTaskInput(input, { allowStatus = true } = {}) {
  if (!input.title || input.title.length > 255) return 'Title is required and must be at most 255 characters.';
  if (input.description.length > 5000) return 'Description must be at most 5000 characters.';
  if (!PRIORITIES.includes(input.priority)) return 'Invalid priority.';
  if (allowStatus && !STATUSES.includes(input.status)) return 'Invalid status.';
  if (input.dueDate && (!DATE_RE.test(input.dueDate) || Number.isNaN(Date.parse(`${input.dueDate}T00:00:00Z`)))) return 'Invalid due date.';
  if (input.assignedTo !== null && (!Number.isInteger(input.assignedTo) || input.assignedTo <= 0)) return 'Invalid assignee.';
  if (input.entityType !== null && !ENTITY_TYPES.includes(input.entityType)) return 'Invalid linked entity type.';
  if (input.entityType !== null && (!Number.isInteger(input.entityId) || input.entityId <= 0)) return 'A valid linked entity is required.';
  if (input.entityType === null && input.entityId !== null) return 'Entity type is required when entity ID is provided.';
  return null;
}

async function ensureAssigneeAllowed(actor, userId) {
  const [rows] = await pool.query('SELECT id,role FROM crm_users WHERE id=? AND status="active"', [userId]);
  if (!rows.length) return false;
  if (actor.role === 'super_admin') return ['admin', 'emp'].includes(rows[0].role);
  if (actor.role === 'admin') return rows[0].role === 'emp';
  return rows[0].id === actor.id;
}

async function ensureEntityExists(type, id) {
  if (!type || !id) return true;
  const table = { requirement: 'crm_requirements', resource: 'crm_resources', lead: 'crm_leads', client: 'crm_clients', vendor: 'crm_vendors' }[type];
  const [rows] = await pool.query(`SELECT id FROM ${table} WHERE id=?`, [id]);
  return rows.length > 0;
}

function canManage(task, user) {
  return isAdmin(user) || task.created_by === user.id || task.assigned_to === user.id;
}

// Return real CRM records for the task form instead of asking users to guess IDs.
router.get('/entity-options/:type', async (req, res) => {
  const type = req.params.type;
  const queries = {
    requirement: { sql: 'SELECT id, title AS label FROM crm_requirements ORDER BY created_at DESC LIMIT 500', params: [] },
    resource: { sql: 'SELECT id, CONCAT(resource_name, " — ", unique_uid) AS label FROM crm_resources ORDER BY created_at DESC LIMIT 500', params: [] },
    lead: { sql: 'SELECT id, name AS label FROM crm_leads ORDER BY created_at DESC LIMIT 500', params: [] },
    client: { sql: 'SELECT id, company_name AS label FROM crm_clients ORDER BY company_name LIMIT 500', params: [] },
    vendor: { sql: 'SELECT id, vendor_name AS label FROM crm_vendors ORDER BY vendor_name LIMIT 500', params: [] }
  };
  if (!queries[type]) return res.status(400).json({ error: 'Invalid linked entity type.' });
  try {
    const query = queries[type];
    if (type === 'requirement' && !isAdmin(req.session.user)) {
      query.sql = 'SELECT id, title AS label FROM crm_requirements WHERE created_by=? ORDER BY created_at DESC LIMIT 500';
      query.params = [req.session.user.id];
    }
    const [rows] = await pool.query(query.sql, query.params);
    res.json(rows);
  } catch (err) {
    console.error('GET task entity options error:', err);
    res.status(500).json({ error: 'Failed to load linked records.' });
  }
});

// GET tasks; employees see tasks they created or were assigned.
router.get('/', async (req, res) => {
  try {
    const params = [];
    let sql = `SELECT t.*, assignee.name AS assignee_name, creator.name AS creator_name
      FROM crm_tasks t
      LEFT JOIN crm_users assignee ON assignee.id=t.assigned_to
      LEFT JOIN crm_users creator ON creator.id=t.created_by
      WHERE 1=1`;
    if (!isAdmin(req.session.user)) {
      sql += ' AND (t.created_by=? OR t.assigned_to=?)';
      params.push(req.session.user.id, req.session.user.id);
    }
    if (STATUSES.includes(req.query.status)) {
      sql += ' AND t.status=?';
      params.push(req.query.status);
    }
    if (PRIORITIES.includes(req.query.priority)) {
      sql += ' AND t.priority=?';
      params.push(req.query.priority);
    }
    if (req.query.due === 'overdue') sql += ' AND t.due_date < CURRENT_DATE() AND t.status NOT IN ("Completed","Cancelled")';
    if (req.query.due === 'today') sql += ' AND t.due_date = CURRENT_DATE() AND t.status NOT IN ("Completed","Cancelled")';
    sql += ' ORDER BY (t.status IN ("Completed","Cancelled")), t.due_date IS NULL, t.due_date ASC, FIELD(t.priority,"High","Medium","Low"), t.created_at DESC LIMIT 250';

    const [tasks] = await pool.query(sql, params);
    res.json(tasks);
  } catch (err) {
    console.error('GET tasks error:', err);
    res.status(500).json({ error: 'Failed to fetch tasks.' });
  }
});

router.post('/', async (req, res) => {
  const input = parseTaskInput(req.body);
  const error = validateTaskInput(input, { allowStatus: false });
  if (error) return res.status(400).json({ error });

  try {
    if (!isAdmin(req.session.user)) input.assignedTo = req.session.user.id;
    if (input.assignedTo && !(await ensureAssigneeAllowed(req.session.user, input.assignedTo))) return res.status(400).json({ error: 'Assignee not found, inactive, or not allowed for your role.' });
    if (!(await ensureEntityExists(input.entityType, input.entityId))) return res.status(400).json({ error: 'Linked entity not found.' });

    const [result] = await pool.query(
      `INSERT INTO crm_tasks (title,description,due_date,priority,assigned_to,entity_type,entity_id,created_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [input.title, input.description || null, input.dueDate, input.priority, input.assignedTo, input.entityType, input.entityId, req.session.user.id]
    );
    res.status(201).json({ id: result.insertId, message: 'Task created successfully.' });
  } catch (err) {
    console.error('POST task error:', err);
    res.status(500).json({ error: 'Failed to create task.' });
  }
});

router.patch('/:id/status', async (req, res) => {
  const status = req.body.status;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  try {
    const [rows] = await pool.query('SELECT * FROM crm_tasks WHERE id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Task not found.' });
    if (!canManage(rows[0], req.session.user)) return res.status(403).json({ error: 'Permission denied.' });
    await pool.query('UPDATE crm_tasks SET status=?, completed_at=? WHERE id=?', [status, status === 'Completed' ? new Date() : null, req.params.id]);
    res.json({ message: 'Task status updated successfully.' });
  } catch (err) {
    console.error('PATCH task status error:', err);
    res.status(500).json({ error: 'Failed to update task status.' });
  }
});

router.patch('/:id', async (req, res) => {
  const input = parseTaskInput(req.body);
  const error = validateTaskInput(input);
  if (error) return res.status(400).json({ error });

  try {
    const [rows] = await pool.query('SELECT * FROM crm_tasks WHERE id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Task not found.' });
    const task = rows[0];
    if (!canManage(task, req.session.user)) return res.status(403).json({ error: 'Permission denied.' });
    if (!isAdmin(req.session.user)) {
      // Employee forms do not expose these fields; preserve them during edits.
      input.assignedTo = task.assigned_to;
      input.entityType = task.entity_type;
      input.entityId = task.entity_id;
    }
    if (!isAdmin(req.session.user) && input.assignedTo !== null && input.assignedTo !== req.session.user.id) {
      return res.status(403).json({ error: 'Employees can assign tasks only to themselves.' });
    }
    if (input.assignedTo && !(await ensureAssigneeAllowed(req.session.user, input.assignedTo))) return res.status(400).json({ error: 'Assignee not found, inactive, or not allowed for your role.' });
    if (!(await ensureEntityExists(input.entityType, input.entityId))) return res.status(400).json({ error: 'Linked entity not found.' });

    const completedAt = input.status === 'Completed' ? 'CURRENT_TIMESTAMP' : 'NULL';
    await pool.query(
      `UPDATE crm_tasks SET title=?, description=?, due_date=?, priority=?, status=?, assigned_to=?, entity_type=?, entity_id=?, completed_at=${completedAt} WHERE id=?`,
      [input.title, input.description || null, input.dueDate, input.priority, input.status, input.assignedTo, input.entityType, input.entityId, req.params.id]
    );
    res.json({ message: 'Task updated successfully.' });
  } catch (err) {
    console.error('PATCH task error:', err);
    res.status(500).json({ error: 'Failed to update task.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT created_by, assigned_to FROM crm_tasks WHERE id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Task not found.' });
    if (!isAdmin(req.session.user) && rows[0].created_by !== req.session.user.id) return res.status(403).json({ error: 'Only the task creator or an admin can delete this task.' });
    await pool.query('DELETE FROM crm_tasks WHERE id=?', [req.params.id]);
    res.json({ message: 'Task deleted successfully.' });
  } catch (err) {
    console.error('DELETE task error:', err);
    res.status(500).json({ error: 'Failed to delete task.' });
  }
});

module.exports = router;
