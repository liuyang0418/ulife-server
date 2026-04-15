-- ============================================================
-- 优宅·续航智脑 数据库初始化脚本
-- 版本: 1.0.0  日期: 2026-04-14
-- ============================================================

CREATE DATABASE IF NOT EXISTS ulife
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE ulife;

GRANT ALL PRIVILEGES ON ulife.* TO 'ulife'@'localhost';
FLUSH PRIVILEGES;

-- ============================================================
-- 用户与权限
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(50)  NOT NULL                  COMMENT '姓名',
  phone         VARCHAR(20)  NOT NULL UNIQUE            COMMENT '手机号',
  password_hash VARCHAR(100)                            COMMENT 'bcrypt密码哈希',
  role          ENUM('elder','caregiver','family','admin') NOT NULL,
  wechat_openid VARCHAR(100) UNIQUE                     COMMENT '微信OpenID',
  avatar        VARCHAR(500)                            COMMENT '头像URL',
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  last_login_at DATETIME,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_role_active (role, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统用户表';

-- 老人档案（扩展 users）
CREATE TABLE IF NOT EXISTS customers (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id           BIGINT UNSIGNED NOT NULL UNIQUE     COMMENT '关联users.id',
  name              VARCHAR(50)  NOT NULL,
  phone             VARCHAR(20),
  room_no           VARCHAR(20)                         COMMENT '房间号',
  birth_date        DATE,
  gender            ENUM('M','F','unknown') DEFAULT 'unknown',
  avatar            VARCHAR(500),
  emergency_contact VARCHAR(50)                         COMMENT '紧急联系人',
  emergency_phone   VARCHAR(20),
  joined_date       DATE                                COMMENT '入住日期',
  afi_critical_value DECIMAL(5,2) DEFAULT 60.00         COMMENT 'AFI预警阈值',
  alert_level       ENUM('green','yellow','red') DEFAULT 'green',
  is_cancelled      TINYINT(1)   NOT NULL DEFAULT 0     COMMENT '是否注销',
  is_active         TINYINT(1)   NOT NULL DEFAULT 1,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_active     (is_active, is_cancelled),
  INDEX idx_alert      (alert_level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='老人档案表';

-- 管家与老人分配关系
CREATE TABLE IF NOT EXISTS caregiver_assignments (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  caregiver_id  BIGINT UNSIGNED NOT NULL,
  customer_id   BIGINT UNSIGNED NOT NULL,
  assigned_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_assign (caregiver_id, customer_id),
  INDEX idx_customer (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='管家老人分配表';

-- 家属授权表
CREATE TABLE IF NOT EXISTS family_authorizations (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  family_user_id  BIGINT UNSIGNED NOT NULL,
  customer_id     BIGINT UNSIGNED NOT NULL,
  status          ENUM('pending','approved','revoked') NOT NULL DEFAULT 'pending',
  applied_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by     BIGINT UNSIGNED,
  approved_at     DATETIME,
  revoked_by      BIGINT UNSIGNED,
  revoked_at      DATETIME,
  revoke_reason   VARCHAR(200),
  can_view_afi         TINYINT(1) NOT NULL DEFAULT 1,
  can_view_reports     TINYINT(1) NOT NULL DEFAULT 1,
  can_view_points      TINYINT(1) NOT NULL DEFAULT 1,
  can_view_tasks       TINYINT(1) NOT NULL DEFAULT 1,
  can_view_alerts      TINYINT(1) NOT NULL DEFAULT 1,
  remark          VARCHAR(300),
  UNIQUE KEY uk_family_customer (family_user_id, customer_id),
  INDEX idx_customer_status (customer_id, status),
  INDEX idx_family_status   (family_user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='家属数据授权表';

-- ============================================================
-- AFI 健康数据
-- ============================================================

CREATE TABLE IF NOT EXISTS afi_records (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id    BIGINT UNSIGNED NOT NULL,
  afi_value      DECIMAL(5,2)    NOT NULL               COMMENT 'AFI值 0~100',
  record_date    DATE            NOT NULL,
  days_from_start INT            NOT NULL                COMMENT '距入住天数(x轴)',
  is_anomaly     TINYINT(1)      NOT NULL DEFAULT 0      COMMENT '是否异常点（排除计算）',
  recorded_by    BIGINT UNSIGNED                         COMMENT '录入人ID',
  is_deleted     TINYINT(1)      NOT NULL DEFAULT 0,
  created_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME        ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_customer_date (customer_id, record_date),
  INDEX idx_customer_date_asc (customer_id, record_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AFI记录表';

CREATE TABLE IF NOT EXISTS afi_record_modifications (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  afi_record_id  BIGINT UNSIGNED NOT NULL,
  customer_id    BIGINT UNSIGNED NOT NULL,
  modifier_id    BIGINT UNSIGNED NOT NULL,
  modifier_role  ENUM('caregiver','admin') NOT NULL,
  modified_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  before_value   JSON            NOT NULL,
  after_value    JSON            NOT NULL,
  reason         VARCHAR(500)    NOT NULL,
  INDEX idx_record   (afi_record_id),
  INDEX idx_customer (customer_id, modified_at),
  INDEX idx_modifier (modifier_id, modified_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AFI修改审计日志';

CREATE TABLE IF NOT EXISTS afi_analysis_cache (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id    BIGINT UNSIGNED NOT NULL UNIQUE,
  slope          DECIMAL(8,4)                            COMMENT 'OLS回归斜率',
  risk_level     ENUM('STABLE','MILD_DECLINE','SEVERE_DECLINE','IMPROVING') DEFAULT 'STABLE',
  forecast_30d   DECIMAL(5,2)                            COMMENT '30天预测AFI',
  forecast_90d   DECIMAL(5,2)                            COMMENT '90天预测AFI',
  is_critical    TINYINT(1)      NOT NULL DEFAULT 0,
  data_points    SMALLINT        NOT NULL DEFAULT 0,
  computed_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_risk (risk_level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AFI分析缓存';

CREATE TABLE IF NOT EXISTS afi_alerts (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id    BIGINT UNSIGNED NOT NULL,
  alert_level    ENUM('yellow','red') NOT NULL,
  alert_reasons  JSON            NOT NULL                COMMENT '预警原因列表',
  status         ENUM('pending','handling','handled') DEFAULT 'pending',
  handled_by     BIGINT UNSIGNED,
  handled_at     DATETIME,
  handle_note    VARCHAR(500),
  created_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_customer_status (customer_id, status),
  INDEX idx_status_created  (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='健康预警记录';

-- ============================================================
-- 任务与打卡
-- ============================================================

CREATE TABLE IF NOT EXISTS tasks (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100)    NOT NULL,
  description   TEXT,
  checkin_mode  ENUM('video','qrcode','manual') NOT NULL DEFAULT 'video',
  video_guide   VARCHAR(1024)                           COMMENT '示范视频URL',
  min_duration  TINYINT UNSIGNED NOT NULL DEFAULT 5     COMMENT '最短录制秒数',
  max_duration  TINYINT UNSIGNED NOT NULL DEFAULT 60    COMMENT '最长录制秒数',
  points_value  SMALLINT UNSIGNED NOT NULL DEFAULT 10   COMMENT '完成获得积分',
  is_active     TINYINT(1)       NOT NULL DEFAULT 1,
  created_by    BIGINT UNSIGNED  NOT NULL,
  created_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME         ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='任务定义表';

CREATE TABLE IF NOT EXISTS customer_tasks (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id BIGINT UNSIGNED NOT NULL,
  task_id     BIGINT UNSIGNED NOT NULL,
  is_active   TINYINT(1)      NOT NULL DEFAULT 1,
  assigned_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_customer_task (customer_id, task_id),
  INDEX idx_task (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='老人任务分配表';

CREATE TABLE IF NOT EXISTS task_videos (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id   BIGINT UNSIGNED NOT NULL,
  task_id       BIGINT UNSIGNED NOT NULL,
  task_date     DATE            NOT NULL,
  video_key     VARCHAR(512)    NOT NULL                COMMENT 'OSS对象Key',
  video_url     VARCHAR(1024)   NOT NULL,
  thumbnail_key VARCHAR(512),
  file_size     INT UNSIGNED    NOT NULL,
  duration_sec  SMALLINT UNSIGNED NOT NULL,
  uploaded_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  upload_ip     VARCHAR(64),
  status        ENUM('pending','approved','rejected','expired') NOT NULL DEFAULT 'pending',
  reviewer_id   BIGINT UNSIGNED,
  reviewed_at   DATETIME,
  reject_reason VARCHAR(500),
  points_awarded SMALLINT UNSIGNED,
  ledger_id     BIGINT UNSIGNED,
  is_deleted    TINYINT(1)      NOT NULL DEFAULT 0,
  INDEX idx_customer_date   (customer_id, task_date),
  INDEX idx_status_uploaded (status, uploaded_at),
  INDEX idx_reviewer        (reviewer_id, reviewed_at),
  UNIQUE KEY uk_customer_task_date (customer_id, task_id, task_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='视频打卡记录';

-- ============================================================
-- 积分系统
-- ============================================================

CREATE TABLE IF NOT EXISTS points_config (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  validity_days   INT UNSIGNED NOT NULL DEFAULT 365    COMMENT '积分有效期(天)',
  remind_threshold INT UNSIGNED NOT NULL DEFAULT 100   COMMENT '余额预警阈值',
  updated_by      BIGINT UNSIGNED,
  updated_at      DATETIME ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='积分全局配置';

CREATE TABLE IF NOT EXISTS points_balance (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id      BIGINT UNSIGNED NOT NULL UNIQUE,
  current_balance  INT NOT NULL DEFAULT 0              COMMENT '当前余额',
  total_earned     INT UNSIGNED NOT NULL DEFAULT 0     COMMENT '历史总获得',
  total_redeemed   INT UNSIGNED NOT NULL DEFAULT 0     COMMENT '历史总兑换',
  total_expired    INT UNSIGNED NOT NULL DEFAULT 0     COMMENT '历史总过期',
  updated_at       DATETIME ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_balance_non_negative CHECK (current_balance >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='积分余额（汇总）';

CREATE TABLE IF NOT EXISTS points_ledger (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id  BIGINT UNSIGNED NOT NULL,
  action       ENUM(
    'earn_checkin','earn_activity','earn_admin',
    'redeem','expire','cancel_clear',
    'adjust_add','adjust_deduct'
  ) NOT NULL,
  points       INT NOT NULL                            COMMENT '正数=收入，负数=支出',
  balance_after INT NOT NULL                           COMMENT '操作后余额快照',
  expires_at   DATETIME                                COMMENT '该批积分到期时间',
  operator_id  BIGINT UNSIGNED,
  operator_role ENUM('system','caregiver','admin'),
  remark       VARCHAR(500),
  source_type  VARCHAR(50)                             COMMENT 'task_video/manual等',
  source_id    BIGINT UNSIGNED,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_customer_action  (customer_id, action, created_at),
  INDEX idx_customer_expires (customer_id, expires_at),
  INDEX idx_source           (source_type, source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='积分流水账本（不可修改）';

-- ============================================================
-- 健康报告
-- ============================================================

CREATE TABLE IF NOT EXISTS health_reports (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id   BIGINT UNSIGNED NOT NULL,
  report_month  CHAR(7)         NOT NULL                COMMENT '格式: 2026-04',
  summary       TEXT                                    COMMENT 'AI生成报告正文',
  afi_snapshot  JSON                                    COMMENT '报告期AFI数据快照',
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_customer_month (customer_id, report_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='月度健康报告';

-- ============================================================
-- 站内消息
-- ============================================================

CREATE TABLE IF NOT EXISTS in_app_messages (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  receiver_id   BIGINT UNSIGNED NOT NULL,
  receiver_role ENUM('elder','caregiver','family','admin') NOT NULL,
  type    ENUM(
    'task_reminder','alert_warning','video_pending',
    'review_approved','review_rejected',
    'auth_apply','auth_result','points_change','system'
  ) NOT NULL,
  priority      ENUM('normal','high','urgent') NOT NULL DEFAULT 'normal',
  title         VARCHAR(100)    NOT NULL,
  content       TEXT            NOT NULL,
  action_url    VARCHAR(500),
  action_label  VARCHAR(30),
  ref_type      VARCHAR(50),
  ref_id        BIGINT UNSIGNED,
  is_read       TINYINT(1)      NOT NULL DEFAULT 0,
  read_at       DATETIME,
  is_deleted    TINYINT(1)      NOT NULL DEFAULT 0,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at    DATETIME,
  INDEX idx_receiver_unread (receiver_id, is_read, is_deleted, created_at),
  INDEX idx_receiver_type   (receiver_id, type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='站内消息表';

-- ============================================================
-- 任务提醒配置
-- ============================================================

CREATE TABLE IF NOT EXISTS task_reminder_configs (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id         BIGINT UNSIGNED NOT NULL DEFAULT 0   COMMENT '0=全局默认',
  remind_times    JSON            NOT NULL              COMMENT '["08:30","20:00"]',
  remind_only_if_not_done TINYINT(1) NOT NULL DEFAULT 1,
  remind_days_of_week     JSON                         COMMENT 'null=每天',
  sms_template    VARCHAR(200)    NOT NULL DEFAULT '',
  is_active       TINYINT(1)      NOT NULL DEFAULT 1,
  created_by      BIGINT UNSIGNED NOT NULL,
  updated_by      BIGINT UNSIGNED,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_task (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='任务提醒配置';

-- ============================================================
-- 初始化基础数据
-- ============================================================

-- 积分全局配置（默认365天有效期）
INSERT INTO points_config (validity_days, remind_threshold, updated_by)
VALUES (365, 100, 1)
ON DUPLICATE KEY UPDATE validity_days=365;

-- 全局任务提醒配置（早9点 晚8点）
INSERT INTO task_reminder_configs (task_id, remind_times, sms_template, created_by)
VALUES (0, '["09:00","20:00"]', 'your task is not done today, please check in!', 1)
ON DUPLICATE KEY UPDATE remind_times='["09:00","20:00"]';

-- 默认管理员账号（密码: Admin@123456，bcrypt已加密）
INSERT INTO users (name, phone, password_hash, role)
VALUES ('系统管理员', '13800000000', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'admin')
ON DUPLICATE KEY UPDATE name='系统管理员';

SELECT '✅ 数据库初始化完成！' AS 状态;
SELECT table_name AS 表名, table_comment AS 说明
FROM information_schema.tables
WHERE table_schema = 'ulife'
ORDER BY table_name;
