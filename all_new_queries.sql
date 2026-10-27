-- ============================================================================
-- CRM v3 - ALL NEW SQL MIGRATIONS & APPLICATION QUERIES
-- File: all_new_queries.sql
-- Database: crm_db (MySQL / MariaDB)
-- Description:
--   Contains all newly introduced database schema changes (DDL) and all
--   corresponding application queries (DML) used in the Node.js backend.
-- ============================================================================

USE crm_db;

-- ============================================================================
-- SECTION 1: SCHEMA MIGRATIONS (DDL)
-- Idempotent queries (safe to run on any existing database multiple times)
-- ============================================================================

-- 1.1 Add 'experience_years' to crm_resources
SET @sql := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crm_resources' AND COLUMN_NAME='experience_years') = 0,
  'ALTER TABLE crm_resources ADD COLUMN experience_years DECIMAL(4,1) NULL AFTER current_location',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1.2 Add 'salary_lpm' to crm_resources (if not present)
SET @sql := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crm_resources' AND COLUMN_NAME='salary_lpm') = 0,
  'ALTER TABLE crm_resources ADD COLUMN salary_lpm DECIMAL(10,2) NULL AFTER experience_years',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1.3 Add 'location' to crm_requirements
SET @sql := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crm_requirements' AND COLUMN_NAME='location') = 0,
  'ALTER TABLE crm_requirements ADD COLUMN location VARCHAR(255) NULL AFTER budget',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1.4 Add 'is_shared' to crm_requirements
SET @sql := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crm_requirements' AND COLUMN_NAME='is_shared') = 0,
  'ALTER TABLE crm_requirements ADD COLUMN is_shared TINYINT(1) NOT NULL DEFAULT 0 AFTER location',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1.5 Update stage ENUM in crm_requirement_resources to include 'SR' and default to 'SR'
ALTER TABLE crm_requirement_resources
  MODIFY COLUMN stage ENUM('SR','L1','L2','L3','Select','Reject') NOT NULL DEFAULT 'SR';

-- 1.6 Add 'is_shared' to crm_requirement_resources (if missing)
SET @sql := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crm_requirement_resources' AND COLUMN_NAME='is_shared') = 0,
  'ALTER TABLE crm_requirement_resources ADD COLUMN is_shared TINYINT(1) DEFAULT 0 AFTER updated_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1.7 Add 'avatar_path' to crm_users (Profile picture support)
SET @sql := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crm_users' AND COLUMN_NAME='avatar_path') = 0,
  'ALTER TABLE crm_users ADD COLUMN avatar_path VARCHAR(500) NULL AFTER status',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1.8 Create crm_tasks table (Follow-up Tasks & Reminders)
CREATE TABLE IF NOT EXISTS crm_tasks (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  title            VARCHAR(255) NOT NULL,
  description      TEXT NULL,
  due_date         DATE NULL,
  priority         ENUM('Low','Medium','High') NOT NULL DEFAULT 'Medium',
  status           ENUM('Pending','In Progress','Completed','Cancelled') NOT NULL DEFAULT 'Pending',
  assigned_to      INT NULL,
  entity_type      ENUM('requirement','resource','lead','client','vendor') NULL,
  entity_id        INT NULL,
  created_by       INT NOT NULL,
  completed_at     TIMESTAMP NULL,
  last_reminded_at TIMESTAMP NULL,
  followup_to      VARCHAR(255) NULL,
  followup_subject VARCHAR(255) NULL,
  followup_body    TEXT NULL,
  email_sent_at    TIMESTAMP NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_task_assigned_to FOREIGN KEY (assigned_to) REFERENCES crm_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_task_created_by FOREIGN KEY (created_by) REFERENCES crm_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- 1.9 Helper indexes for crm_tasks performance
SET @sql := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS 
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crm_tasks' AND INDEX_NAME='idx_tasks_assigned_status') = 0,
  'CREATE INDEX idx_tasks_assigned_status ON crm_tasks(assigned_to, status, due_date)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS 
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crm_tasks' AND INDEX_NAME='idx_tasks_entity') = 0,
  'CREATE INDEX idx_tasks_entity ON crm_tasks(entity_type, entity_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS 
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crm_tasks' AND INDEX_NAME='idx_tasks_due_date') = 0,
  'CREATE INDEX idx_tasks_due_date ON crm_tasks(due_date, status)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1.10 Add 'ref_requirement_id' to crm_activity_logs (Clickable requirement links)
SET @sql := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crm_activity_logs' AND COLUMN_NAME='ref_requirement_id') = 0,
  'ALTER TABLE crm_activity_logs ADD COLUMN ref_requirement_id INT NULL AFTER ref_client_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============================================================================
-- SECTION 2: APPLICATION RUNTIME QUERIES (DML)
-- The exact queries executed in the application backend
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 2.1 TASKS & REMINDER SYSTEM (routes/tasks.js & scripts/send-task-reminders.js)
-- ----------------------------------------------------------------------------

-- Query 2.1.1: Create Task with Follow-Up Email fields
-- Used in: POST /api/tasks
INSERT INTO crm_tasks (
  title, description, due_date, priority, assigned_to, entity_type, entity_id,
  followup_to, followup_subject, followup_body, created_by
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);

-- Query 2.1.2: Fetch Tasks with Assignee & Creator Names
-- Used in: GET /api/tasks
SELECT t.*, 
       assignee.name AS assignee_name, 
       creator.name AS creator_name
FROM crm_tasks t
LEFT JOIN crm_users assignee ON assignee.id = t.assigned_to
LEFT JOIN crm_users creator ON creator.id = t.created_by
WHERE 1=1
  -- Optional Role filter: AND (t.created_by = ? OR t.assigned_to = ?)
  -- Optional Status filter: AND t.status = ?
  -- Optional Priority filter: AND t.priority = ?
  -- Optional Overdue filter: AND t.due_date < CURRENT_DATE() AND t.status NOT IN ('Completed','Cancelled')
ORDER BY (t.status IN ('Completed','Cancelled')), 
         t.due_date IS NULL, 
         t.due_date ASC, 
         FIELD(t.priority,'High','Medium','Low'), 
         t.created_at DESC 
LIMIT 250;

-- Query 2.1.3: Update Task Status & Completion Timestamp
-- Used in: PATCH /api/tasks/:id/status
UPDATE crm_tasks 
SET status = ?, 
    completed_at = IF(? = 'Completed', CURRENT_TIMESTAMP, NULL) 
WHERE id = ?;

-- Query 2.1.4: Update Entire Task Record
-- Used in: PATCH /api/tasks/:id
UPDATE crm_tasks 
SET title = ?, 
    description = ?, 
    due_date = ?, 
    priority = ?, 
    status = ?, 
    assigned_to = ?, 
    entity_type = ?, 
    entity_id = ?, 
    followup_to = ?, 
    followup_subject = ?, 
    followup_body = ?, 
    email_sent_at = NULL, 
    completed_at = IF(? = 'Completed', CURRENT_TIMESTAMP, NULL) 
WHERE id = ?;

-- Query 2.1.5: Mark Follow-Up Email Sent
-- Used in: POST /api/tasks/:id/send-email
UPDATE crm_tasks 
SET email_sent_at = CURRENT_TIMESTAMP 
WHERE id = ?;

-- Query 2.1.6: Background Cron: Find Due / Overdue Tasks for Email Reminders
-- Used in: scripts/send-task-reminders.js
SELECT t.id, t.title, t.priority, t.due_date, t.assigned_to, u.email, u.name
FROM crm_tasks t
JOIN crm_users u ON u.id = t.assigned_to AND u.status = 'active'
WHERE t.assigned_to IS NOT NULL
  AND t.due_date IS NOT NULL
  AND t.due_date <= CURRENT_DATE()
  AND t.status NOT IN ('Completed','Cancelled')
  AND (t.last_reminded_at IS NULL OR DATE(t.last_reminded_at) < CURRENT_DATE())
ORDER BY u.email, t.due_date, FIELD(t.priority,'High','Medium','Low');

-- Query 2.1.7: Record Reminder Sent Timestamp
-- Used in: scripts/send-task-reminders.js
UPDATE crm_tasks 
SET last_reminded_at = CURRENT_TIMESTAMP 
WHERE id IN (?);

-- Query 2.1.8: Delete Task
-- Used in: DELETE /api/tasks/:id
DELETE FROM crm_tasks WHERE id = ?;

-- ----------------------------------------------------------------------------
-- 2.2 REQUIREMENTS & PIPELINE (routes/requirements.js & requirementsPage.js)
-- ----------------------------------------------------------------------------

-- Query 2.2.1: Create Requirement with Location & Share Status
-- Used in: POST /api/requirements
INSERT INTO crm_requirements (
  client_id, poc_id, title, jd, status, budget, location, created_by, is_shared
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0);

-- Query 2.2.2: Update Requirement with Location
-- Used in: PUT /api/requirements/:id
UPDATE crm_requirements 
SET client_id = ?, poc_id = ?, title = ?, jd = ?, status = ?, budget = ?, location = ? 
WHERE id = ?;

-- Query 2.2.3: Toggle Requirement Share Status
-- Used in: POST /api/requirements/:id/toggle-share
UPDATE crm_requirements 
SET is_shared = ? 
WHERE id = ?;

-- Query 2.2.4: Fetch Requirements List with Mapped Count and Share Status
-- Used in: GET /requirements
SELECT r.*, 
       c.company_name AS client_name,
       u.name AS submitted_by_name,
       r.is_shared,
       r.location,
       (
         SELECT COUNT(*) FROM crm_requirement_resources rr 
         WHERE rr.requirement_id = r.id AND rr.stage != 'Reject'
       ) AS mapped_profile_count
FROM crm_requirements r
LEFT JOIN crm_clients c ON r.client_id = c.id
LEFT JOIN crm_users u ON r.created_by = u.id
ORDER BY r.id DESC;

-- Query 2.2.5: View Results - Fetch All Shared Requirements
-- Used in: GET /view-results
SELECT r.id, r.title, r.status, r.budget, r.location, r.created_at, r.is_shared,
       c.company_name, u.name AS submitted_by_name
FROM crm_requirements r
LEFT JOIN crm_clients c ON c.id = r.client_id
LEFT JOIN crm_users u ON u.id = r.created_by
WHERE r.is_shared = 1
ORDER BY r.created_at DESC;

-- Query 2.2.6: View Results - Fetch Candidate Mapping Pipeline for Shared Requirements
-- Used in: GET /view-results
SELECT rr.requirement_id, rr.stage, res.id AS resource_id, res.resource_name, res.unique_uid, res.skills
FROM crm_requirement_resources rr
JOIN crm_resources res ON res.id = rr.resource_id
WHERE rr.requirement_id IN (?)
ORDER BY rr.created_at ASC;

-- Query 2.2.7: Map Resource to Requirement with Stage defaulting to 'SR'
-- Used in: POST /api/requirements/:id/map-resource
INSERT INTO crm_requirement_resources (requirement_id, resource_id, stage, created_by)
VALUES (?, ?, 'SR', ?)
ON DUPLICATE KEY UPDATE requirement_id = requirement_id;

-- Query 2.2.8: Update Candidate Stage in Pipeline (SR -> L1 -> L2 -> Select / Reject)
-- Used in: PATCH /api/requirements/:id/resource/:resourceId/stage
UPDATE crm_requirement_resources 
SET stage = ? 
WHERE id = ?;

-- Query 2.2.9: Unmap Resource from Requirement
-- Used in: DELETE /api/requirements/:id/resource/:resourceId
DELETE FROM crm_requirement_resources 
WHERE requirement_id = ? AND resource_id = ?;

-- Query 2.2.10: Check if Resource is still mapped anywhere else
-- Used in: refreshResourceAvailability()
SELECT COUNT(*) AS activeCount 
FROM crm_requirement_resources
WHERE resource_id = ? AND stage NOT IN ('Reject');

-- Query 2.2.11: Close Requirement (Cascading delete as per spec)
-- Used in: POST /api/requirements/:id/status (with status='Closed')
DELETE FROM crm_activity_logs WHERE entity_type='requirement' AND entity_id=?;
DELETE FROM crm_requirements WHERE id=?;

-- ----------------------------------------------------------------------------
-- 2.3 RESOURCES MANAGEMENT (routes/resources.js & routes/resourcesPage.js)
-- ----------------------------------------------------------------------------

-- Query 2.3.1: Check Duplicate Resource with Row Lock
-- Used in: generateUid()
SELECT unique_uid 
FROM crm_resources 
WHERE unique_uid LIKE ? 
FOR UPDATE;

-- Query 2.3.2: Insert New Resource with Experience & Salary LPM
-- Used in: POST /api/resources
INSERT INTO crm_resources (
  unique_uid, resource_name, title, experience_years, skills, cv_path, type, status, 
  vendor_id, poc_id, managed_by, contact_number, email, linkedin, 
  preferred_location, current_location, salary_lpm, created_by
) VALUES (?, ?, ?, ?, ?, ?, ?, 'Available', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);

-- Query 2.3.3: Update Resource Details with Experience & Salary LPM
-- Used in: PUT /api/resources/:id
UPDATE crm_resources SET
  resource_name = ?, title = ?, experience_years = ?, skills = ?, type = ?, status = ?,
  vendor_id = ?, poc_id = ?,
  managed_by = ?, contact_number = ?, email = ?, linkedin = ?,
  preferred_location = ?, current_location = ?, salary_lpm = ?
WHERE id = ?;

-- ----------------------------------------------------------------------------
-- 2.4 USER PROFILE & TEAM MANAGEMENT (routes/profilePage.js & routes/teamPage.js)
-- ----------------------------------------------------------------------------

-- Query 2.4.1: Update User Avatar Path
-- Used in: POST /profile/avatar
UPDATE crm_users 
SET avatar_path = ? 
WHERE id = ?;

-- Query 2.4.2: Update User Display Name
-- Used in: POST /profile/name
UPDATE crm_users 
SET name = ? 
WHERE id = ?;

-- Query 2.4.3: Update User Password Hash
-- Used in: POST /profile/password & POST /api/team/:id/reset-password
UPDATE crm_users 
SET password_hash = ? 
WHERE id = ?;

-- Query 2.4.4: Super Admin Role-wise Team Counts
-- Used in: GET /team
SELECT
  SUM(role='super_admin') AS super_admins,
  SUM(role='admin')       AS admins,
  SUM(role='emp')         AS emps
FROM crm_users;

-- ----------------------------------------------------------------------------
-- 2.5 AI CANDIDATE MATCHING (routes/ai.js & services/ai.js)
-- ----------------------------------------------------------------------------

-- Query 2.5.1: Fetch Candidate & Requirement attributes for AI scoring
-- Used in: POST /api/ai/match
SELECT id, title, jd, budget, created_by 
FROM crm_requirements 
WHERE id = ?;

SELECT id, resource_name, title, skills, experience_years, current_location, preferred_location, salary_lpm 
FROM crm_resources 
WHERE id = ?;
