-- CRM follow-up tasks / reminders
-- Apply after schema.sql and existing migrations.

CREATE TABLE IF NOT EXISTS crm_tasks (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  title        VARCHAR(255) NOT NULL,
  description  TEXT NULL,
  due_date     DATE NULL,
  priority     ENUM('Low','Medium','High') NOT NULL DEFAULT 'Medium',
  status       ENUM('Pending','In Progress','Completed','Cancelled') NOT NULL DEFAULT 'Pending',
  assigned_to  INT NULL,
  entity_type  ENUM('requirement','resource','lead','client','vendor') NULL,
  entity_id    INT NULL,
  created_by   INT NOT NULL,
  completed_at     TIMESTAMP NULL,
  last_reminded_at TIMESTAMP NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_task_assigned_to FOREIGN KEY (assigned_to) REFERENCES crm_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_task_created_by FOREIGN KEY (created_by) REFERENCES crm_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE INDEX idx_tasks_assigned_status ON crm_tasks(assigned_to, status, due_date);
CREATE INDEX idx_tasks_entity ON crm_tasks(entity_type, entity_id);
CREATE INDEX idx_tasks_due_date ON crm_tasks(due_date, status);

-- Safe to run on an installation that already applied the CREATE TABLE above.
SET @task_reminder_column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_tasks' AND COLUMN_NAME = 'last_reminded_at'
);
SET @task_reminder_sql := IF(@task_reminder_column_exists = 0,
  'ALTER TABLE crm_tasks ADD COLUMN last_reminded_at TIMESTAMP NULL AFTER completed_at',
  'SELECT 1');
PREPARE task_reminder_stmt FROM @task_reminder_sql;
EXECUTE task_reminder_stmt;
DEALLOCATE PREPARE task_reminder_stmt;

ALTER TABLE crm_requirement_resources ADD COLUMN is_shared TINYINT(1) DEFAULT 0;
