-- ============================================================
-- migration_v6.sql
-- Run this in phpMyAdmin → crm_db → SQL tab (after migration_v5.sql).
--
-- What this adds:
--   1. crm_users.avatar_path — lets a user upload their own profile picture
--      (Profile page → "wo khud thik kr sake, Image laga sake, apna name
--      change kar sake").
--
-- Written with the same portable "check information_schema first" pattern
-- as migration_v5.sql, so it works on plain MySQL (not just MariaDB) and is
-- safe to run more than once by accident.
-- ============================================================

USE crm_db;

SET @dbname = DATABASE();

SET @sql = (SELECT IF(
  NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE table_schema = @dbname AND table_name = 'crm_users' AND column_name = 'avatar_path'
  ),
  'ALTER TABLE crm_users ADD COLUMN avatar_path VARCHAR(500) NULL AFTER status',
  'SELECT 1'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
