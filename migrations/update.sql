-- ============================================================
-- 优宅·续航智脑 数据库完整更新脚本
-- 版本: 1.2.0  日期: 2026-04-16
-- 说明: 幂等脚本，可在全新或已有数据库上重复执行
-- 执行: mysql -u root -p < update.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS ulife
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE ulife;

GRANT ALL PRIVILEGES ON ulife.* TO 'ulife'@'localhost';
FLUSH PRIVILEGES;

-- ============================================================
-- 001 用户与权限
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
  INDEX idx_active  (is_active, is_cancelled),
  INDEX idx_alert   (alert_level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='老人档案表';

CREATE TABLE IF NOT EXISTS caregiver_assignments (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  caregiver_id  BIGINT UNSIGNED NOT NULL,
  customer_id   BIGINT UNSIGNED NOT NULL,
  assigned_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_assign (caregiver_id, customer_id),
  INDEX idx_customer (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='管家老人分配表';

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
-- 001b 邀请码 / 三剑客 / 套餐 / 任务库 / 商城
-- ============================================================

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

-- caregiver_assignments 增量字段
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

-- ============================================================
-- 002 AFI 健康数据
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

-- afi_alerts 增量字段（003）
SET @col1 = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema='ulife' AND table_name='afi_alerts' AND column_name='escalated_at');
SET @sql1 = IF(@col1=0,
  'ALTER TABLE afi_alerts ADD COLUMN escalated_at DATETIME NULL COMMENT ''升级通知协同管家的时间'' AFTER handle_note',
  'SELECT ''escalated_at already exists''');
PREPARE s1 FROM @sql1; EXECUTE s1; DEALLOCATE PREPARE s1;

SET @col2 = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema='ulife' AND table_name='afi_alerts' AND column_name='escalated_to');
SET @sql2 = IF(@col2=0,
  'ALTER TABLE afi_alerts ADD COLUMN escalated_to JSON NULL COMMENT ''已通知的协同管家ID列表'' AFTER escalated_at',
  'SELECT ''escalated_to already exists''');
PREPARE s2 FROM @sql2; EXECUTE s2; DEALLOCATE PREPARE s2;

SET @idx = (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema='ulife' AND table_name='afi_alerts' AND index_name='idx_escalation_check');
SET @sql3 = IF(@idx=0,
  'ALTER TABLE afi_alerts ADD INDEX idx_escalation_check (status, escalated_at, created_at)',
  'SELECT ''index already exists''');
PREPARE s3 FROM @sql3; EXECUTE s3; DEALLOCATE PREPARE s3;

-- ============================================================
-- 003 任务与打卡
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
-- 004 积分系统
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
-- 005 题库 & 试卷体系
-- ============================================================

DROP TABLE IF EXISTS assessment_options;
DROP TABLE IF EXISTS assessment_questions;
DROP TABLE IF EXISTS assessment_templates;

CREATE TABLE IF NOT EXISTS question_bank (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(30)      NOT NULL UNIQUE    COMMENT '题目编码，如 QB-MOTOR-001',
  content     TEXT             NOT NULL           COMMENT '题目正文',
  dimension   VARCHAR(50)      NOT NULL           COMMENT '能力维度：运动/认知/饮食/社交/睡眠/情绪',
  type        ENUM('single')   NOT NULL DEFAULT 'single' COMMENT '题型（当前仅单选）',
  remark      VARCHAR(300)                        COMMENT '出题说明，供管理员参考',
  is_active   TINYINT(1)       NOT NULL DEFAULT 1,
  sort_order  INT UNSIGNED     NOT NULL DEFAULT 0 COMMENT '题库内排序',
  created_by  BIGINT UNSIGNED  NOT NULL,
  created_at  DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME         ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_dimension (dimension, is_active),
  INDEX idx_sort      (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='题库（题目池）';

CREATE TABLE IF NOT EXISTS question_options (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  question_id BIGINT UNSIGNED  NOT NULL,
  seq_no      TINYINT UNSIGNED NOT NULL           COMMENT '选项排序 1=A 2=B 3=C 4=D',
  label       CHAR(1)          NOT NULL           COMMENT 'A / B / C / D',
  content     VARCHAR(500)     NOT NULL           COMMENT '选项文字',
  score       SMALLINT         NOT NULL DEFAULT 0 COMMENT '该选项对应得分（可为负分）',
  INDEX idx_question_seq (question_id, seq_no),
  CONSTRAINT fk_opt_question FOREIGN KEY (question_id)
    REFERENCES question_bank(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='题库选项（含分值）';

CREATE TABLE IF NOT EXISTS exam_papers (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(100)     NOT NULL           COMMENT '试卷名称',
  description  TEXT                                COMMENT '试卷说明',
  level        TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '测评等级：1=L1 2=L2',
  is_published TINYINT(1)       NOT NULL DEFAULT 0 COMMENT '0=草稿可编辑，1=已发布锁定',
  is_active    TINYINT(1)       NOT NULL DEFAULT 1,
  question_count SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '题目数（冗余）',
  created_by   BIGINT UNSIGNED  NOT NULL,
  updated_by   BIGINT UNSIGNED,
  created_at   DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME         ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_level_active (level, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='试卷（题目组合）';

CREATE TABLE IF NOT EXISTS exam_paper_questions (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  paper_id    BIGINT UNSIGNED  NOT NULL,
  question_id BIGINT UNSIGNED  NOT NULL,
  seq_no      SMALLINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '题目顺序',
  is_required TINYINT(1)       NOT NULL DEFAULT 1  COMMENT '是否必答',
  added_by    BIGINT UNSIGNED  NOT NULL,
  added_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_paper_question (paper_id, question_id),
  INDEX idx_paper_seq (paper_id, seq_no),
  CONSTRAINT fk_epq_paper    FOREIGN KEY (paper_id)    REFERENCES exam_papers(id)   ON DELETE CASCADE,
  CONSTRAINT fk_epq_question FOREIGN KEY (question_id) REFERENCES question_bank(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='试卷-题目关联（多对多）';

CREATE TABLE IF NOT EXISTS customer_assessments (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id    BIGINT UNSIGNED NOT NULL,
  paper_id       BIGINT UNSIGNED NOT NULL           COMMENT '使用的试卷ID',
  paper_snapshot JSON                               COMMENT '试卷名称快照',
  conducted_by   BIGINT UNSIGNED NOT NULL           COMMENT '主持测评的管家ID',
  status         ENUM('in_progress','completed') NOT NULL DEFAULT 'in_progress',
  total_score    SMALLINT                           COMMENT '总分（完成后填入）',
  started_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at   DATETIME,
  INDEX idx_customer_status (customer_id, status),
  CONSTRAINT fk_ca_paper FOREIGN KEY (paper_id) REFERENCES exam_papers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='客户测评记录';

CREATE TABLE IF NOT EXISTS customer_assessment_answers (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  assessment_id      BIGINT UNSIGNED NOT NULL,
  question_id        BIGINT UNSIGNED NOT NULL,
  selected_option_id BIGINT UNSIGNED NOT NULL,
  score              SMALLINT        NOT NULL DEFAULT 0,
  UNIQUE KEY uk_assessment_question (assessment_id, question_id),
  INDEX idx_assessment (assessment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='客户答题记录';

CREATE TABLE IF NOT EXISTS option_task_mappings (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  option_id  BIGINT UNSIGNED NOT NULL              COMMENT '题库选项ID',
  task_id    BIGINT UNSIGNED NOT NULL              COMMENT '任务库任务ID',
  priority   TINYINT UNSIGNED NOT NULL DEFAULT 5  COMMENT '任务优先级 1=最高 10=最低',
  frequency  ENUM('daily','weekly','monthly') NOT NULL DEFAULT 'daily',
  note       VARCHAR(200)                          COMMENT '配置说明',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_option_task (option_id, task_id),
  INDEX idx_option (option_id),
  CONSTRAINT fk_otm_option FOREIGN KEY (option_id) REFERENCES question_options(id) ON DELETE CASCADE,
  CONSTRAINT fk_otm_task   FOREIGN KEY (task_id)   REFERENCES task_library(id)     ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='选项→任务映射（任务引擎核心）';

CREATE TABLE IF NOT EXISTS customer_task_assignments (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id    BIGINT UNSIGNED NOT NULL,
  task_id        BIGINT UNSIGNED NOT NULL,
  source         ENUM('engine','manual') NOT NULL DEFAULT 'engine',
  assessment_id  BIGINT UNSIGNED                   COMMENT '来源测评ID',
  frequency      ENUM('daily','weekly','monthly') NOT NULL DEFAULT 'daily',
  priority       TINYINT UNSIGNED NOT NULL DEFAULT 5,
  status         ENUM('active','paused','removed') NOT NULL DEFAULT 'active',
  assigned_by    BIGINT UNSIGNED  NOT NULL,
  assigned_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  remove_reason  VARCHAR(200),
  UNIQUE KEY uk_customer_task (customer_id, task_id),
  INDEX idx_customer_status (customer_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='客户任务分配';

-- ============================================================
-- 006 健康报告 / 站内消息 / 任务提醒
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

-- 积分全局配置（365天有效期）
INSERT INTO points_config (validity_days, remind_threshold, updated_by)
VALUES (365, 100, 1)
ON DUPLICATE KEY UPDATE validity_days=365;

-- 全局任务提醒（早9点 晚8点）
INSERT INTO task_reminder_configs (task_id, remind_times, sms_template, created_by)
VALUES (0, '["09:00","20:00"]', 'your task is not done today, please check in!', 1)
ON DUPLICATE KEY UPDATE remind_times='["09:00","20:00"]';

-- 默认服务套餐（399元/月）
INSERT IGNORE INTO service_packages (name, price_fen, description, valid_days, includes_l1, created_at)
VALUES ('续航智脑基础套餐', 39900, '包含L1测评+30天任务管理服务', 30, 1, NOW());

-- 默认管理员账号（密码: Admin@123456，bcrypt已加密）
INSERT INTO users (name, phone, password_hash, role)
VALUES ('系统管理员', '13800000000', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'admin')
ON DUPLICATE KEY UPDATE name='系统管理员';

-- ============================================================
-- 完成验证
-- ============================================================

SELECT '✅ 数据库更新完成！版本 1.2.0' AS 状态;

SELECT table_name AS 表名, table_comment AS 说明, table_rows AS 预估行数
FROM information_schema.tables
WHERE table_schema = 'ulife'
ORDER BY table_name;
