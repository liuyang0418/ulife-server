-- ============================================================
-- 迁移 003：预警升级字段 & AFI噪声标记增强
-- 版本: 1.2.0  日期: 2026-04-14
-- ============================================================

USE ulife;

-- 为 afi_alerts 添加升级相关字段
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

-- 为索引加速升级查询（status + created_at 已有，补充 escalated_at）
SET @idx = (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema='ulife' AND table_name='afi_alerts' AND index_name='idx_escalation_check');
SET @sql3 = IF(@idx=0,
  'ALTER TABLE afi_alerts ADD INDEX idx_escalation_check (status, escalated_at, created_at)',
  'SELECT ''index already exists''');
PREPARE s3 FROM @sql3; EXECUTE s3; DEALLOCATE PREPARE s3;

SELECT '✅ 迁移 003 执行完成' AS status;
