-- ============================================================
-- 迁移 002：题库 & 试卷体系
-- 替换原 assessment_templates / assessment_questions / assessment_options
-- 版本: 1.1.0  日期: 2026-04-14
-- ============================================================

USE ulife;

-- 原测评模板旧表（如已存在则保留数据后重命名，首次建库直接跳过）
DROP TABLE IF EXISTS assessment_options;
DROP TABLE IF EXISTS assessment_questions;
DROP TABLE IF EXISTS assessment_templates;

-- ============================================================
-- 一、题库（管理员维护，题目与选项独立存储）
-- ============================================================

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

-- ============================================================
-- 二、试卷（管理员从题库中选题组卷）
-- ============================================================

CREATE TABLE IF NOT EXISTS exam_papers (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(100)     NOT NULL           COMMENT '试卷名称（可随时重命名）',
  description  TEXT                                COMMENT '试卷说明',
  level        TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '对应测评等级：1=L1 2=L2',
  is_published TINYINT(1)       NOT NULL DEFAULT 0 COMMENT '0=草稿可编辑，1=已发布锁定',
  is_active    TINYINT(1)       NOT NULL DEFAULT 1,
  question_count SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '题目数（冗余，便于列表展示）',
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
  seq_no      SMALLINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '在此试卷中的题目顺序',
  is_required TINYINT(1)       NOT NULL DEFAULT 1  COMMENT '是否必答',
  added_by    BIGINT UNSIGNED  NOT NULL,
  added_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_paper_question (paper_id, question_id),
  INDEX idx_paper_seq (paper_id, seq_no),
  CONSTRAINT fk_epq_paper    FOREIGN KEY (paper_id)    REFERENCES exam_papers(id)   ON DELETE CASCADE,
  CONSTRAINT fk_epq_question FOREIGN KEY (question_id) REFERENCES question_bank(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='试卷-题目关联（多对多）';

-- ============================================================
-- 三、客户测评记录（引用试卷而非旧模板）
-- ============================================================

CREATE TABLE IF NOT EXISTS customer_assessments (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id    BIGINT UNSIGNED NOT NULL,
  paper_id       BIGINT UNSIGNED NOT NULL           COMMENT '使用的试卷ID（快照版本）',
  paper_snapshot JSON                               COMMENT '试卷名称快照，防止试卷改名影响历史',
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

-- ============================================================
-- 四、任务引擎映射（选项 → 任务库）
-- ============================================================

CREATE TABLE IF NOT EXISTS option_task_mappings (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  option_id  BIGINT UNSIGNED NOT NULL              COMMENT '题库选项ID',
  task_id    BIGINT UNSIGNED NOT NULL              COMMENT '任务库任务ID',
  priority   TINYINT UNSIGNED NOT NULL DEFAULT 5  COMMENT '任务优先级 1=最高 10=最低',
  frequency  ENUM('daily','weekly','monthly') NOT NULL DEFAULT 'daily',
  note       VARCHAR(200)                          COMMENT '配置说明（供管理员参考）',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_option_task (option_id, task_id),
  INDEX idx_option (option_id),
  CONSTRAINT fk_otm_option FOREIGN KEY (option_id) REFERENCES question_options(id) ON DELETE CASCADE,
  CONSTRAINT fk_otm_task   FOREIGN KEY (task_id)   REFERENCES task_library(id)     ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='选项→任务映射（任务引擎核心）';

-- ============================================================
-- 五、客户任务分配（引擎输出 + 管家可调整）
-- ============================================================

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

SELECT '✅ 迁移 002 执行完成' AS 状态;
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'ulife' ORDER BY table_name;
