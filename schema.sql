-- ============================================================
-- schema.sql v3 — Full fresh install
-- phpMyAdmin → Import → select this file → Go
-- ============================================================

CREATE DATABASE IF NOT EXISTS crm_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE crm_db;

-- Users
CREATE TABLE IF NOT EXISTS crm_users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('super_admin','admin','emp') NOT NULL,
  status        ENUM('active','disabled') NOT NULL DEFAULT 'active',
  avatar_path   VARCHAR(500) NULL,
  created_by    INT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- License
CREATE TABLE IF NOT EXISTS crm_license (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  license_key  VARCHAR(255) NOT NULL,
  valid_from   DATE NOT NULL,
  valid_until  DATE NOT NULL,
  activated_by INT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Clients (with extra fields)
CREATE TABLE IF NOT EXISTS crm_clients (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  company_name VARCHAR(255) NOT NULL,
  website      VARCHAR(500) NULL,
  address      TEXT NULL,
  email        VARCHAR(255) NULL,
  phone        VARCHAR(50) NULL,
  created_by   INT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Vendors (with extra fields)
CREATE TABLE IF NOT EXISTS crm_vendors (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  vendor_name VARCHAR(255) NOT NULL,
  short_code  VARCHAR(10) NOT NULL,
  website     VARCHAR(500) NULL,
  address     TEXT NULL,
  email       VARCHAR(255) NULL,
  phone       VARCHAR(50) NULL,
  created_by  INT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- POCs
CREATE TABLE IF NOT EXISTS crm_pocs (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NULL,
  vendor_id INT NULL,
  poc_name  VARCHAR(255) NOT NULL,
  poc_email VARCHAR(255) NULL,
  poc_phone VARCHAR(50) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pocs_client FOREIGN KEY (client_id) REFERENCES crm_clients(id) ON DELETE CASCADE,
  CONSTRAINT fk_pocs_vendor FOREIGN KEY (vendor_id) REFERENCES crm_vendors(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE INDEX idx_pocs_client ON crm_pocs(client_id);
CREATE INDEX idx_pocs_vendor ON crm_pocs(vendor_id);

-- Resources (with status + locations)
CREATE TABLE IF NOT EXISTS crm_resources (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  unique_uid          VARCHAR(255) NOT NULL UNIQUE,
  resource_name       VARCHAR(255) NOT NULL,
  title               VARCHAR(255) NULL,
  skills              VARCHAR(500) NULL,
  cv_path             VARCHAR(500) NULL,
  type                ENUM('In-House','Vendor') NOT NULL,
  status              ENUM('Available','Mapped','Inactive') NOT NULL DEFAULT 'Available',
  vendor_id           INT NULL,
  poc_id              INT NULL,
  managed_by          VARCHAR(255) NULL,
  contact_number      VARCHAR(50) NULL,
  email               VARCHAR(255) NULL,
  linkedin            VARCHAR(500) NULL,
  preferred_location  VARCHAR(255) NULL,
  current_location    VARCHAR(255) NULL,
  salary_lpm          DECIMAL(10,2) NULL,
  created_by          INT NULL,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_res_vendor FOREIGN KEY (vendor_id) REFERENCES crm_vendors(id) ON DELETE SET NULL,
  CONSTRAINT fk_res_poc    FOREIGN KEY (poc_id)    REFERENCES crm_pocs(id)    ON DELETE SET NULL
) ENGINE=InnoDB;

-- Requirements (with resource_id)
-- status: 'Open' (actively being worked) or 'Hold' (paused).
-- NOTE: there is deliberately no 'Closed' value stored here — closing a
-- requirement in the app DELETES the row (see routes/requirements.js,
-- POST /:id/status). See DOCUMENTATION.md for why.
CREATE TABLE IF NOT EXISTS crm_requirements (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  client_id   INT NULL,
  poc_id      INT NULL,
  resource_id INT NULL,
  title       VARCHAR(255) NOT NULL,
  jd          TEXT NULL,
  status      ENUM('Open','Hold') NOT NULL DEFAULT 'Open',
  budget      VARCHAR(100) NULL,
  created_by  INT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_req_client   FOREIGN KEY (client_id)   REFERENCES crm_clients(id)   ON DELETE CASCADE,
  CONSTRAINT fk_req_poc      FOREIGN KEY (poc_id)      REFERENCES crm_pocs(id)      ON DELETE SET NULL,
  CONSTRAINT fk_req_resource FOREIGN KEY (resource_id) REFERENCES crm_resources(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Requirement ⇄ Resource pipeline (many resources can be sent against one
-- requirement; each one tracks its own interview stage independently).
-- This single table is read by BOTH the requirement detail page and the
-- resource detail page, which is what keeps their stage buttons in sync.
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

CREATE INDEX idx_rr_requirement ON crm_requirement_resources(requirement_id);
CREATE INDEX idx_rr_resource    ON crm_requirement_resources(resource_id);

-- Leads
CREATE TABLE IF NOT EXISTS crm_leads (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  email      VARCHAR(255) NULL,
  phone      VARCHAR(50) NULL,
  source     ENUM('Email','LinkedIn','Website') NOT NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Activity logs
-- ref_requirement_id: set on a RESOURCE's log entry when it was auto-created
-- by mapping that resource to a requirement. Lets the UI render "Mapped to
-- Requirement ID: X" as a clickable link straight to that requirement.
CREATE TABLE IF NOT EXISTS crm_activity_logs (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  entity_type         ENUM('requirement','resource','lead') NOT NULL,
  entity_id           INT NOT NULL,
  note                TEXT NOT NULL,
  ref_resource_id     INT NULL,
  ref_client_id       INT NULL,
  ref_requirement_id  INT NULL,
  created_by          INT NULL,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_log_resource    FOREIGN KEY (ref_resource_id)    REFERENCES crm_resources(id)    ON DELETE SET NULL,
  CONSTRAINT fk_log_client      FOREIGN KEY (ref_client_id)      REFERENCES crm_clients(id)      ON DELETE SET NULL,
  CONSTRAINT fk_log_requirement FOREIGN KEY (ref_requirement_id) REFERENCES crm_requirements(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE INDEX idx_logs_entity ON crm_activity_logs(entity_type, entity_id);

-- Follow-up tasks / reminders
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

-- Seed vendors
INSERT IGNORE INTO crm_vendors (id, vendor_name, short_code) VALUES
  (1, 'Webit Solutions', 'WIT'),
  (2, 'TechSpire Inc', 'TSI');
