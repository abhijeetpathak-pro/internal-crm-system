-- ============================================================
-- migration_v3.sql
-- Run this in phpMyAdmin → crm_db → SQL tab
-- Run ONLY if you already ran migration_v2.sql before.
-- If fresh install, just import schema_v3.sql instead.
-- ============================================================

USE crm_db;

-- Fix 5/6/7: preferred_location + current_location (skip if already added)
ALTER TABLE crm_resources
  ADD COLUMN IF NOT EXISTS preferred_location VARCHAR(255) NULL AFTER linkedin,
  ADD COLUMN IF NOT EXISTS current_location   VARCHAR(255) NULL AFTER preferred_location;

-- Fix 11: status on resources (Available / Mapped / Inactive)
ALTER TABLE crm_resources
  ADD COLUMN IF NOT EXISTS status ENUM('Available','Mapped','Inactive') NOT NULL DEFAULT 'Available' AFTER type;

-- Fix 11: resource_id on requirements (which resource is mapped)
ALTER TABLE crm_requirements
  ADD COLUMN IF NOT EXISTS resource_id INT NULL AFTER poc_id;

-- Fix 1/2/3: client extra fields
ALTER TABLE crm_clients
  ADD COLUMN IF NOT EXISTS website VARCHAR(500) NULL AFTER company_name,
  ADD COLUMN IF NOT EXISTS address TEXT         NULL AFTER website,
  ADD COLUMN IF NOT EXISTS email   VARCHAR(255) NULL AFTER address,
  ADD COLUMN IF NOT EXISTS phone   VARCHAR(50)  NULL AFTER email;

-- Fix 12/13: vendor extra fields
ALTER TABLE crm_vendors
  ADD COLUMN IF NOT EXISTS website VARCHAR(500) NULL AFTER vendor_name,
  ADD COLUMN IF NOT EXISTS address TEXT         NULL AFTER website,
  ADD COLUMN IF NOT EXISTS email   VARCHAR(255) NULL AFTER address,
  ADD COLUMN IF NOT EXISTS phone   VARCHAR(50)  NULL AFTER email;
