const nodemailer = require('nodemailer');
const pool = require('../db');

const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];
const missing = required.filter(name => !process.env[name]);
if (missing.length) {
  console.error(`Reminder job not configured. Missing: ${missing.join(', ')}`);
  process.exit(2);
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number.parseInt(process.env.SMTP_PORT, 10) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

function formatTask(task) {
  const due = task.due_date ? new Date(task.due_date).toISOString().slice(0, 10) : 'No due date';
  const link = process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, '')}/tasks` : '';
  return `• ${task.title} — ${task.priority} — due ${due}${link ? ` — ${link}` : ''}`;
}

async function main() {
  const [tasks] = await pool.query(
    `SELECT t.id, t.title, t.priority, t.due_date, t.assigned_to, u.email, u.name
     FROM crm_tasks t
     JOIN crm_users u ON u.id=t.assigned_to AND u.status='active'
     WHERE t.assigned_to IS NOT NULL
       AND t.due_date IS NOT NULL
       AND t.due_date <= CURRENT_DATE()
       AND t.status NOT IN ('Completed','Cancelled')
       AND (t.last_reminded_at IS NULL OR DATE(t.last_reminded_at) < CURRENT_DATE())
     ORDER BY u.email, t.due_date, FIELD(t.priority,'High','Medium','Low')`
  );

  const grouped = new Map();
  for (const task of tasks) {
    if (!grouped.has(task.assigned_to)) grouped.set(task.assigned_to, { email: task.email, name: task.name, tasks: [] });
    grouped.get(task.assigned_to).tasks.push(task);
  }

  for (const recipient of grouped.values()) {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: recipient.email,
      subject: `CRM follow-up reminder: ${recipient.tasks.length} task${recipient.tasks.length === 1 ? '' : 's'} due`,
      text: `Hi ${recipient.name || 'there'},\n\nThese CRM follow-up tasks are due or overdue:\n\n${recipient.tasks.map(formatTask).join('\n')}\n\nPlease update their status in the CRM.`
    });
    await pool.query('UPDATE crm_tasks SET last_reminded_at=CURRENT_TIMESTAMP WHERE id IN (?)', [recipient.tasks.map(task => task.id)]);
    console.log(`Sent ${recipient.tasks.length} reminder(s) to ${recipient.email}`);
  }

  console.log(`Processed ${grouped.size} recipient(s) and ${tasks.length} task(s).`);
  await pool.end();
}

main().catch(async err => {
  console.error('Reminder job failed:', err);
  await pool.end().catch(() => {});
  process.exitCode = 1;
});
