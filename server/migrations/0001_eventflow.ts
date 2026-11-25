/**
 * 0001_eventflow：EventFlow 重建版全部業務表。
 * 以 CREATE TABLE IF NOT EXISTS 保持可重複執行；由 server/migrate.ts 在啟動時套用。
 */
export const MIGRATION_0001_EVENTFLOW = `
CREATE TABLE IF NOT EXISTS ef_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  event_date DATE NOT NULL,
  start_time VARCHAR(20) NULL,
  venue VARCHAR(300) NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Hong_Kong',
  status ENUM('draft','active','closed') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ef_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NULL UNIQUE,
  email VARCHAR(320) NULL UNIQUE,
  password_hash VARCHAR(255) NULL,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(20) NULL,
  role ENUM('owner','admin','staff','merchant','member') NOT NULL,
  google_sub VARCHAR(128) NULL UNIQUE,
  google_email_verified TINYINT(1) NOT NULL DEFAULT 0,
  merchant_id INT NULL,
  member_id INT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  session_version INT NOT NULL DEFAULT 1,
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  last_login_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX ef_users_role_idx (role),
  INDEX ef_users_member_idx (member_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ef_owner_allowlist (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(320) NOT NULL UNIQUE,
  label VARCHAR(120) NULL,
  user_id INT NULL,
  verified_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ef_members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  member_code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(320) NULL,
  qr_token VARCHAR(64) NOT NULL UNIQUE,
  total_spend_cents INT NOT NULL DEFAULT 0,
  draw_chances_earned INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX ef_members_phone_idx (phone),
  INDEX ef_members_name_idx (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ef_guests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  public_id VARCHAR(40) NOT NULL UNIQUE,
  member_id INT NOT NULL UNIQUE,
  zone VARCHAR(80) NULL,
  seat VARCHAR(80) NULL,
  group_name VARCHAR(80) NULL,
  registration_status ENUM('registered','walk_in') NOT NULL DEFAULT 'registered',
  note VARCHAR(300) NULL,
  checked_in_at TIMESTAMP NULL,
  checked_in_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX ef_guests_zone_idx (zone),
  INDEX ef_guests_checked_idx (checked_in_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ef_merchants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  booth VARCHAR(40) NULL,
  contact_name VARCHAR(120) NULL,
  phone VARCHAR(20) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ef_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  merchant_id INT NOT NULL,
  member_id INT NOT NULL,
  amount_cents INT NOT NULL,
  status ENUM('pending','confirmed','rejected','expired') NOT NULL DEFAULT 'pending',
  request_id VARCHAR(64) NOT NULL,
  note VARCHAR(300) NULL,
  expires_at TIMESTAMP NOT NULL,
  confirmed_at TIMESTAMP NULL,
  rejected_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ef_tx_merchant_request (merchant_id, request_id),
  INDEX ef_tx_member_idx (member_id),
  INDEX ef_tx_status_idx (status),
  INDEX ef_tx_created_idx (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ef_draw_tickets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  member_id INT NOT NULL,
  transaction_id INT NULL,
  sequence INT NOT NULL,
  code VARCHAR(40) NOT NULL UNIQUE,
  status ENUM('available','used') NOT NULL DEFAULT 'available',
  used_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ef_ticket_member_seq (member_id, sequence),
  INDEX ef_ticket_status_idx (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ef_preorders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_no VARCHAR(64) NOT NULL UNIQUE,
  merchant_id INT NOT NULL,
  member_id INT NOT NULL,
  items TEXT NOT NULL,
  amount_cents INT NOT NULL DEFAULT 0,
  status ENUM('pending','collected','cancelled') NOT NULL DEFAULT 'pending',
  collected_at TIMESTAMP NULL,
  collected_by INT NULL,
  note VARCHAR(300) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX ef_preorder_merchant_idx (merchant_id),
  INDEX ef_preorder_member_idx (member_id),
  INDEX ef_preorder_status_idx (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ef_draws (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  kind ENUM('gift','cash','consumer','grand') NOT NULL,
  prize_description VARCHAR(300) NOT NULL,
  prize_count INT NOT NULL DEFAULT 1,
  awarded_count INT NOT NULL DEFAULT 0,
  scheduled_at TIMESTAMP NULL,
  eligibility ENUM('all_registered','checked_in','consumers','tickets','top_spenders') NOT NULL,
  max_wins_per_person INT NOT NULL DEFAULT 1,
  shortlist_size INT NOT NULL DEFAULT 20,
  rules_confirmed TINYINT(1) NOT NULL DEFAULT 0,
  rules_note TEXT NULL,
  status ENUM('draft','ready','completed','cancelled') NOT NULL DEFAULT 'draft',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ef_draw_winners (
  id INT AUTO_INCREMENT PRIMARY KEY,
  draw_id INT NOT NULL,
  member_id INT NOT NULL,
  ticket_id INT NULL,
  prize_label VARCHAR(200) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ef_winner_draw_member (draw_id, member_id),
  INDEX ef_winner_draw_idx (draw_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ef_auctions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  description TEXT NULL,
  starting_price_cents INT NOT NULL,
  min_increment_cents INT NOT NULL DEFAULT 1000,
  starts_at TIMESTAMP NULL,
  ends_at TIMESTAMP NULL,
  duration_minutes INT NULL,
  status ENUM('draft','active','ended','cancelled') NOT NULL DEFAULT 'draft',
  payment_method VARCHAR(300) NULL,
  rules_confirmed TINYINT(1) NOT NULL DEFAULT 0,
  rules_note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ef_bids (
  id INT AUTO_INCREMENT PRIMARY KEY,
  auction_id INT NOT NULL,
  member_id INT NOT NULL,
  amount_cents INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX ef_bid_auction_idx (auction_id),
  INDEX ef_bid_member_idx (member_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ef_audit_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  actor_user_id INT NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(60) NULL,
  entity_id INT NULL,
  detail TEXT NULL,
  ip VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX ef_audit_action_idx (action),
  INDEX ef_audit_created_idx (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ef_settings (
  \`key\` VARCHAR(80) PRIMARY KEY,
  value TEXT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ef_api_keys (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  key_hash VARCHAR(64) NOT NULL UNIQUE,
  prefix VARCHAR(20) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;
