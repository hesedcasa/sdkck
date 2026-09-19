-- Schema for the `mq` end-to-end test suite.
--
-- Anything the tests assert on (table names, column names, index names, row
-- counts) is fixed here. Tests that need to mutate data create their own
-- scratch tables so re-running the suite against a live container is safe.

CREATE DATABASE IF NOT EXISTS mq_e2e_alt;
-- Deliberately left without a single table, so `mq mysql tables` is covered
-- against a schema where SHOW TABLES returns no rows.
CREATE DATABASE IF NOT EXISTS mq_e2e_empty;

-- `mq mysql databases` asserts every schema is visible to the profile user.
GRANT ALL PRIVILEGES ON mq_e2e.* TO 'mq_user'@'%';
GRANT ALL PRIVILEGES ON mq_e2e_alt.* TO 'mq_user'@'%';
GRANT ALL PRIVILEGES ON mq_e2e_empty.* TO 'mq_user'@'%';
FLUSH PRIVILEGES;

USE mq_e2e;

CREATE TABLE users (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email      VARCHAR(255) NOT NULL,
  name       VARCHAR(100) NOT NULL,
  status     ENUM('active', 'inactive', 'banned') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_users_email (email),
  KEY idx_users_status (status)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE orders (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    INT UNSIGNED NOT NULL,
  total      DECIMAL(10, 2) NOT NULL,
  status     VARCHAR(32) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_orders_user_id (user_id),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- Deliberately more than the default LIMIT of 100 so the auto-LIMIT behaviour
-- is observable through the CLI.
CREATE TABLE metrics (
  id    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  label VARCHAR(32) NOT NULL,
  value INT NOT NULL,
  PRIMARY KEY (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- Exercises the CSV/TOON formatters' escaping and NULL handling.
CREATE TABLE quirky (
  id       INT UNSIGNED NOT NULL AUTO_INCREMENT,
  note     VARCHAR(255) NULL,
  payload  VARBINARY(64) NULL,
  recorded DATETIME NULL,
  PRIMARY KEY (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- A second schema, reachable via the `alt` profile, so profile switching is
-- covered end to end.
USE mq_e2e_alt;

CREATE TABLE audit_log (
  id       INT UNSIGNED NOT NULL AUTO_INCREMENT,
  action   VARCHAR(64) NOT NULL,
  actor_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
