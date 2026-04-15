#!/bin/bash
# =============================================================
# scripts/backup.sh — 数据库每日自动备份
# 配置 cron：0 3 * * * /opt/ulife-server/scripts/backup.sh
# =============================================================
set -e

source /opt/ulife-server/.env

BACKUP_DIR="/opt/backups/ulife"
DATE=$(date +%Y%m%d_%H%M%S)
FILE="$BACKUP_DIR/ulife_${DATE}.sql.gz"
KEEP_DAYS=7  # 保留 7 天

mkdir -p "$BACKUP_DIR"

# 导出并压缩
mysqldump -h"$DB_HOST" -u"$DB_USER" -p"$DB_PASSWORD" \
  --single-transaction --quick --routines \
  "$DB_NAME" | gzip > "$FILE"

echo "[$(date)] 备份完成: $FILE ($(du -sh $FILE | cut -f1))"

# 删除超期备份
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +$KEEP_DAYS -delete
echo "[$(date)] 已清理 ${KEEP_DAYS} 天前的旧备份"
