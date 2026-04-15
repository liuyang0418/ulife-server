-- ============================================================
-- 迁移 001b：上一轮补充需求的新增表
-- 邀请码 / 三剑客 / 套餐 / 任务库 / 商城
-- 版本: 1.0.1  日期: 2026-04-14
-- ============================================================

USE ulife;

-- 管家邀请码
CREATE TABLE IF NOT EXISTS caregiver_invite_codes (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  caregiver_id BIGINT UNSIGNED NOT NULL UNIQUE,
  code         CHAR(8)         NOT NULL UNIQUE,
  qr_code_url  VARCHAR(500),
  total_used   INT UNSIGNED    NOT NULL DEFAULT 0,
  is_active    TINYINT(1)      NOT NULL DEFAULT 1,
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='管家邀请码';

-- 三剑客小组
CREATE TABLE IF NOT EXISTS caregiver_groups (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  group_name   VARCHAR(50)     NOT NULL,
  max_capacity INT UNSIGNED    NOT NULL DEFAULT 600,
  is_active    TINYINT(1)      NOT NULL DEFAULT 1,
  created_by   BIGINT UNSIGNED NOT NULL,
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='三剑客小组';

CREATE TABLE IF NOT EXISTS caregiver_group_members (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  group_id     BIGINT UNSIGNED NOT NULL,
  caregiver_id BIGINT UNSIGNED NOT NULL,
  max_primary  SMALLINT UNSIGNED NOT NULL DEFAULT 200,
  joined_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_group_caregiver (group_id, caregiver_id),
  UNIQUE KEY uk_caregiver       (caregiver_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='三剑客成员';

-- 升级 caregiver_assignments（增加 assignment_type 和 group_id，兼容已存在列）
SET @col1 = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema='ulife' AND table_name='caregiver_assignments' AND column_name='assignment_type');
SET @sql1 = IF(@col1=0,
  'ALTER TABLE caregiver_assignments ADD COLUMN assignment_type ENUM(''primary'',''co'') NOT NULL DEFAULT ''primary'' AFTER customer_id',
  'SELECT ''assignment_type already exists''');
PREPARE s1 FROM @sql1; EXECUTE s1; DEALLOCATE PREPARE s1;

SET @col2 = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema='ulife' AND table_name='caregiver_assignments' AND column_name='group_id');
SET @sql2 = IF(@col2=0,
  'ALTER TABLE caregiver_assignments ADD COLUMN group_id BIGINT UNSIGNED AFTER assignment_type',
  'SELECT ''group_id already exists''');
PREPARE s2 FROM @sql2; EXECUTE s2; DEALLOCATE PREPARE s2;

-- 服务套餐
CREATE TABLE IF NOT EXISTS service_packages (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(100)    NOT NULL,
  price_fen   INT UNSIGNED    NOT NULL,
  description TEXT,
  valid_days  INT UNSIGNED    NOT NULL DEFAULT 365,
  includes_l1 TINYINT(1)      NOT NULL DEFAULT 1,
  is_active   TINYINT(1)      NOT NULL DEFAULT 1,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='服务套餐定义';

CREATE TABLE IF NOT EXISTS customer_packages (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id  BIGINT UNSIGNED NOT NULL,
  package_id   BIGINT UNSIGNED NOT NULL,
  order_no     VARCHAR(64)     NOT NULL UNIQUE,
  amount_fen   INT UNSIGNED    NOT NULL,
  pay_status   ENUM('pending','paid','refunded') NOT NULL DEFAULT 'pending',
  pay_channel  ENUM('wechat_pay','manual','free') NOT NULL DEFAULT 'wechat_pay',
  paid_at      DATETIME,
  wx_trade_no  VARCHAR(64),
  expires_at   DATETIME,
  activated_by BIGINT UNSIGNED,
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_customer (customer_id, pay_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='套餐购买记录';

-- 任务库
CREATE TABLE IF NOT EXISTS task_library (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code         VARCHAR(30)      NOT NULL UNIQUE,
  name         VARCHAR(100)     NOT NULL,
  category     VARCHAR(50)      NOT NULL,
  description  TEXT,
  video_guide  VARCHAR(500),
  min_duration TINYINT UNSIGNED NOT NULL DEFAULT 5,
  max_duration TINYINT UNSIGNED NOT NULL DEFAULT 60,
  points_value SMALLINT UNSIGNED NOT NULL DEFAULT 10,
  difficulty   TINYINT UNSIGNED NOT NULL DEFAULT 1,
  tags         JSON,
  is_active    TINYINT(1)       NOT NULL DEFAULT 1,
  import_batch VARCHAR(50),
  created_by   BIGINT UNSIGNED  NOT NULL,
  created_at   DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME         ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_category (category, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='任务库';

-- 积分商城商品
CREATE TABLE IF NOT EXISTS mall_products (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(100)    NOT NULL,
  image_url    VARCHAR(500),
  description  TEXT,
  points_price INT UNSIGNED    NOT NULL,
  stock        INT             NOT NULL DEFAULT -1,
  valid_days   INT UNSIGNED,
  category     VARCHAR(50)     NOT NULL DEFAULT 'general',
  sort_order   INT UNSIGNED    NOT NULL DEFAULT 0,
  is_active    TINYINT(1)      NOT NULL DEFAULT 1,
  created_by   BIGINT UNSIGNED NOT NULL,
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME        ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_active_sort (is_active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='积分商城商品';

CREATE TABLE IF NOT EXISTS exchange_log (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id     BIGINT UNSIGNED NOT NULL,
  product_id      BIGINT UNSIGNED NOT NULL,
  points_deducted INT UNSIGNED    NOT NULL,
  ledger_id       BIGINT UNSIGNED NOT NULL,
  verify_code     CHAR(12)        NOT NULL UNIQUE,
  qr_content      VARCHAR(500)    NOT NULL,
  status          ENUM('pending','verified','expired') NOT NULL DEFAULT 'pending',
  verified_by     BIGINT UNSIGNED,
  verified_at     DATETIME,
  expires_at      DATETIME,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_customer    (customer_id, status),
  INDEX idx_verify_code (verify_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='积分兑换核销记录';

-- 默认套餐数据
INSERT IGNORE INTO service_packages (name, price_fen, description, valid_days, includes_l1, created_at)
VALUES ('续航智脑基础套餐', 39900, '包含L1测评+30天任务管理服务', 30, 1, NOW());

SELECT '✅ 迁移 001b 执行完成' AS status;
