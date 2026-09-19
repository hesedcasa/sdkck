USE mq_e2e;

INSERT INTO users (id, email, name, status, created_at) VALUES
  (1, 'ada@example.com',     'Ada Lovelace',    'active',   '2024-01-01 10:00:00'),
  (2, 'grace@example.com',   'Grace Hopper',    'active',   '2024-01-02 10:00:00'),
  (3, 'alan@example.com',    'Alan Turing',     'inactive', '2024-01-03 10:00:00'),
  (4, 'katherine@example.com','Katherine Johnson','active',  '2024-01-04 10:00:00'),
  (5, 'edsger@example.com',  'Edsger Dijkstra', 'banned',   '2024-01-05 10:00:00');

INSERT INTO orders (id, user_id, total, status, created_at) VALUES
  (1, 1, 19.99,  'paid',     '2024-02-01 12:00:00'),
  (2, 1, 149.50, 'paid',     '2024-02-02 12:00:00'),
  (3, 2, 8.25,   'refunded', '2024-02-03 12:00:00'),
  (4, 3, 76.00,  'pending',  '2024-02-04 12:00:00'),
  (5, 4, 245.75, 'paid',     '2024-02-05 12:00:00'),
  (6, 4, 12.00,  'pending',  '2024-02-06 12:00:00');

-- 150 rows: enough for the default LIMIT 100 to actually truncate a result set.
INSERT INTO metrics (label, value)
WITH RECURSIVE seq (n) AS (
  SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 150
)
SELECT CONCAT('metric-', n), n * 10 FROM seq;

INSERT INTO quirky (id, note, payload, recorded) VALUES
  (1, 'plain note',                    NULL,           '2024-03-01 09:00:00'),
  (2, 'has, a comma',                  NULL,           NULL),
  (3, 'has "quotes" and\na newline',   0x00FF10,       '2024-03-03 09:00:00'),
  (4, NULL,                            NULL,           NULL);

USE mq_e2e_alt;

INSERT INTO audit_log (id, action, actor_id) VALUES
  (1, 'login',  1),
  (2, 'logout', 1),
  (3, 'login',  2);
