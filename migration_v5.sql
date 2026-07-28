-- ============================================================
-- migration_v5.sql
-- Run this in phpMyAdmin → crm_db → SQL tab (after migration_v3.sql).
--
-- What this migration does (see DOCUMENTATION.md for the full picture):
--   1. Requirement status changes from (InProcess, Closed) to (Open, Hold).
--      "Closed" is no longer a stored status — closing a requirement now
--      DELETES it (and everything linked to it) from the app, so there is
--      nothing left in the "Closed" enum to migrate rows into. Any
--      requirement that is already 'Closed' today is removed as part of
--      this migration to match that new rule.
--        ⚠️ BACK UP YOUR DATABASE BEFORE RUNNING THIS FILE. ⚠️
--   2. A requirement can now have MANY resources sent against it, and each
--      one moves independently through a 5-stage pipeline:
--      L1 → L2 → L3 → Select, with Reject as a side-branch at any point.
--      This lives in the new crm_requirement_resources table.
--   3. Activity-log entries can now point at a requirement (ref_requirement_id)
--      so "Mapped to Requirement ID: X" on a resource's activity log can be
--      rendered as a clickable link straight to that requirement.
-- ============================================================

USE crm_db;

-- ── Step 1: remove already-closed requirements (see note above) ─────────────
-- Deletes their resource-pipeline rows (via FK cascade added in step 3) and
-- their own activity-log entries. Resource-side history entries that merely
-- *mention* the requirement are kept (their ref_requirement_id just becomes
-- NULL — see step 4's ON DELETE SET NULL) so resource history isn't erased.
DELETE FROM crm_activity_logs
  WHERE entity_type = 'requirement'
    AND entity_id IN (SELECT id FROM crm_requirements WHERE status = 'Closed');
DELETE FROM crm_requirements WHERE status = 'Closed';

-- ── Step 2: swap the status enum from (InProcess, Closed) to (Open, Hold) ──
ALTER TABLE crm_requirements
  MODIFY COLUMN status ENUM('InProcess','Closed','Open','Hold') NOT NULL DEFAULT 'Open';
UPDATE crm_requirements SET status = 'Open' WHERE status = 'InProcess';
ALTER TABLE crm_requirements
  MODIFY COLUMN status ENUM('Open','Hold') NOT NULL DEFAULT 'Open';

-- ── Step 3: multi-resource pipeline table ────────────────────────────────────
-- One row per (requirement, resource) pair sent. `stage` is the single
-- source of truth for that pair's pipeline position — the requirement page
-- and the resource page both read/write the SAME row, which is what keeps
-- them in sync automatically (Point 2B: moving a resource to L1 on the
-- requirement page instantly shows L1 on the resource page too, because
-- there is only one row, not two copies).
CREATE TABLE IF NOT EXISTS crm_requirement_resources (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  requirement_id INT NOT NULL,
  resource_id    INT NOT NULL,
  stage          ENUM('L1','L2','L3','Reject','Select') NOT NULL DEFAULT 'L1',
  created_by     INT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_req_resource (requirement_id, resource_id),
  CONSTRAINT fk_rr_requirement FOREIGN KEY (requirement_id) REFERENCES crm_requirements(id) ON DELETE CASCADE,
  CONSTRAINT fk_rr_resource    FOREIGN KEY (resource_id)    REFERENCES crm_resources(id)    ON DELETE CASCADE
) ENGINE=InnoDB;

-- Backfill: every resource ever mapped to a requirement (found via the old
-- activity-log trail) gets a pipeline row so existing data isn't lost.
-- They all start at 'L1' since the old system had no stage concept.
INSERT IGNORE INTO crm_requirement_resources (requirement_id, resource_id, stage, created_by, created_at)
  SELECT a.entity_id, a.ref_resource_id, 'L1', a.created_by, MIN(a.created_at)
  FROM crm_activity_logs a
  WHERE a.entity_type = 'requirement' AND a.ref_resource_id IS NOT NULL
  GROUP BY a.entity_id, a.ref_resource_id;

-- ── Step 4: let a resource's activity log link back to a requirement ───────
-- ON DELETE SET NULL: if the requirement is later closed/deleted, the old
-- log line on the resource ("Mapped to Requirement ID: X") stays as history
-- text, it just stops being a clickable link.
--
-- FIX: plain MySQL (unlike MariaDB) does NOT support
-- "ADD COLUMN IF NOT EXISTS" / "CREATE INDEX IF NOT EXISTS" — on a plain
-- MySQL server those two lines used to fail with a syntax error and abort
-- the rest of the script, which is the most likely reason things looked
-- broken after running this file. The column/constraint/index adds below
-- are rewritten as small "only run this if it doesn't already exist yet"
-- checks against information_schema, using dynamic SQL — this works on
-- BOTH MySQL and MariaDB, and makes the whole migration safe to run more
-- than once by accident.

SET @dbname = DATABASE();

-- 4a. Add ref_requirement_id column if missing
SET @sql = (SELECT IF(
  NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE table_schema = @dbname AND table_name = 'crm_activity_logs' AND column_name = 'ref_requirement_id'
  ),
  'ALTER TABLE crm_activity_logs ADD COLUMN ref_requirement_id INT NULL AFTER ref_client_id',
  'SELECT 1'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4b. Add its foreign key if missing
SET @sql = (SELECT IF(
  NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE table_schema = @dbname AND table_name = 'crm_activity_logs' AND constraint_name = 'fk_log_requirement'
  ),
  'ALTER TABLE crm_activity_logs ADD CONSTRAINT fk_log_requirement FOREIGN KEY (ref_requirement_id) REFERENCES crm_requirements(id) ON DELETE SET NULL',
  'SELECT 1'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4c. Add helper indexes on the pipeline table if missing
SET @sql = (SELECT IF(
  NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE table_schema = @dbname AND table_name = 'crm_requirement_resources' AND index_name = 'idx_rr_requirement'
  ),
  'CREATE INDEX idx_rr_requirement ON crm_requirement_resources(requirement_id)',
  'SELECT 1'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE table_schema = @dbname AND table_name = 'crm_requirement_resources' AND index_name = 'idx_rr_resource'
  ),
  'CREATE INDEX idx_rr_resource ON crm_requirement_resources(resource_id)',
  'SELECT 1'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── Step 5: sanity check — run this after the migration to confirm it worked
-- SELECT COUNT(*) AS pipeline_rows FROM crm_requirement_resources;
-- SHOW COLUMNS FROM crm_activity_logs LIKE 'ref_requirement_id';
