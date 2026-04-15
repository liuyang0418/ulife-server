#!/bin/bash
# =============================================================
# scripts/setup-server.sh — 服务器初始化（首次购买 ECS 后执行）
# 系统：Ubuntu 22.04 LTS
# 执行：以 root 身份运行
# =============================================================
set -e
GREEN='\033[0;32m'; NC='\033[0m'
info() { echo -e "${GREEN}[INFO]${NC} $1"; }

# ─── 1. 系统更新 ─────────────────────────────────────────────
info "更新系统..."
apt-get update -qq && apt-get upgrade -y -qq

# ─── 2. 安装基础工具 ─────────────────────────────────────────
apt-get install -y -qq curl git vim ufw fail2ban

# ─── 3. 创建应用用户（不用 root 运行 Node）──────────────────
if ! id -u ulife &>/dev/null; then
  useradd -m -s /bin/bash ulife
  info "用户 ulife 已创建"
fi

# ─── 4. MySQL 8.0 ───────────────────────────────────────────
info "安装 MySQL 8.0..."
apt-get install -y -qq mysql-server

# 安全加固（自动化版）
mysql -e "ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '${MYSQL_ROOT_PASSWORD:-请修改此密码}';"
mysql -e "DELETE FROM mysql.user WHERE User='';"
mysql -e "DELETE FROM mysql.user WHERE User='root' AND Host NOT IN ('localhost');"
mysql -e "DROP DATABASE IF EXISTS test;"
mysql -e "FLUSH PRIVILEGES;"

# 创建应用数据库和用户
DB_PASS="${DB_PASSWORD:-请修改此密码}"
mysql -e "CREATE DATABASE IF NOT EXISTS ulife CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -e "CREATE USER IF NOT EXISTS 'ulife'@'localhost' IDENTIFIED BY '${DB_PASS}';"
mysql -e "GRANT ALL PRIVILEGES ON ulife.* TO 'ulife'@'localhost';"
mysql -e "FLUSH PRIVILEGES;"
info "MySQL 配置完成"

# ─── 5. Redis 7 ─────────────────────────────────────────────
info "安装 Redis..."
apt-get install -y -qq redis-server

# 设置密码（编辑 /etc/redis/redis.conf）
REDIS_PASS="${REDIS_PASSWORD:-请修改此密码}"
sed -i "s/^# requirepass .*/requirepass ${REDIS_PASS}/" /etc/redis/redis.conf
sed -i "s/^requirepass .*/requirepass ${REDIS_PASS}/" /etc/redis/redis.conf
# 绑定只监听本地
sed -i "s/^bind .*/bind 127.0.0.1 ::1/" /etc/redis/redis.conf
# 关闭保护模式
sed -i "s/^protected-mode yes/protected-mode no/" /etc/redis/redis.conf

systemctl restart redis-server
systemctl enable redis-server
info "Redis 配置完成"

# ─── 6. Node.js 20 LTS ──────────────────────────────────────
info "安装 Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
apt-get install -y -qq nodejs
npm install -g pm2 --quiet
info "Node.js $(node -v) 安装完成"

# ─── 7. Nginx ───────────────────────────────────────────────
info "安装 Nginx..."
apt-get install -y -qq nginx
systemctl enable nginx

# ─── 8. Certbot（SSL 证书）────────────────────────────────
info "安装 Certbot..."
apt-get install -y -qq certbot python3-certbot-nginx

# ─── 9. 防火墙 ──────────────────────────────────────────────
info "配置 UFW 防火墙..."
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
# 注意：3000 端口不对外开放，只通过 Nginx 代理访问
ufw --force enable

# ─── 10. Fail2ban（防暴力破解 SSH）────────────────────────
info "配置 Fail2ban..."
systemctl enable fail2ban
systemctl start fail2ban

# ─── 11. 日志目录 ───────────────────────────────────────────
mkdir -p /var/log/ulife
chown ulife:ulife /var/log/ulife

# ─── 12. MySQL 性能调优（适合 2-4G 内存 ECS）───────────────
cat >> /etc/mysql/mysql.conf.d/mysqld.cnf << 'EOF'

# === ulife 性能调优 ===
innodb_buffer_pool_size    = 512M
innodb_log_file_size       = 128M
innodb_flush_log_at_trx_commit = 2
max_connections            = 200
query_cache_type           = 0
slow_query_log             = 1
slow_query_log_file        = /var/log/mysql/slow.log
long_query_time            = 1
EOF
systemctl restart mysql

info "✅ 服务器初始化完成！"
echo ""
echo "下一步："
echo "  1. 将代码推送到 Git 仓库"
echo "  2. 克隆到服务器 /opt/ulife-server"
echo "  3. 复制 .env.production.example 为 .env 并填写配置"
echo "  4. 执行 bash scripts/deploy.sh"
echo "  5. 申请 SSL 证书：certbot --nginx -d 你的域名.com"
echo ""
