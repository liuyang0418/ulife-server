#!/bin/bash
# =============================================================
# deploy.sh — 一键部署 / 更新脚本（在服务器上执行）
# 用法：bash deploy.sh          首次部署
#       bash deploy.sh update   更新代码（保留 .env 和数据库）
# =============================================================
set -e

APP_DIR="/opt/ulife-server"
REPO_URL="https://github.com/你的用户名/ulife-server.git"   # 替换为实际仓库地址
BRANCH="main"
LOG_DIR="/var/log/ulife"
NODE_MIN_VERSION=18

# ─── 颜色输出 ────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ─── 检查 root ──────────────────────────────────────────────
[ "$(id -u)" -eq 0 ] || error "请以 root 身份运行此脚本"

MODE="${1:-install}"
info "部署模式: $MODE"

# ─── 1. 系统依赖 ─────────────────────────────────────────────
if [ "$MODE" = "install" ]; then
  info "安装系统依赖..."
  apt-get update -qq
  apt-get install -y -qq curl git nginx ufw

  # Node.js（通过 NodeSource）
  if ! command -v node &>/dev/null || [ "$(node -e 'process.exit(+process.versions.node.split(".")[0]<'$NODE_MIN_VERSION'?1:0)')" = "" ]; then
    info "安装 Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  fi

  # PM2
  npm install -g pm2 --quiet

  # 日志目录
  mkdir -p "$LOG_DIR"
  info "系统依赖安装完成"
fi

# ─── 2. 拉取代码 ─────────────────────────────────────────────
if [ "$MODE" = "install" ]; then
  info "克隆代码仓库..."
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
else
  info "更新代码..."
  cd "$APP_DIR"
  git fetch origin
  git reset --hard "origin/$BRANCH"
fi

cd "$APP_DIR"

# ─── 3. 安装 npm 依赖（生产模式，不装 devDependencies）──────
info "安装 npm 依赖..."
npm ci --omit=dev --quiet

# ─── 4. 检查 .env ────────────────────────────────────────────
if [ ! -f "$APP_DIR/.env" ]; then
  warn ".env 文件不存在！"
  warn "请复制 .env.production.example 为 .env 并填写配置："
  warn "  cp $APP_DIR/.env.production.example $APP_DIR/.env"
  warn "  vi $APP_DIR/.env"
  error "配置 .env 后重新执行部署脚本"
fi

# ─── 5. 数据库初始化（仅首次）───────────────────────────────
if [ "$MODE" = "install" ]; then
  info "执行数据库迁移..."
  source "$APP_DIR/.env"
  mysql -h"$DB_HOST" -u"$DB_USER" -p"$DB_PASSWORD" < "$APP_DIR/migrations/001_init.sql"
  mysql -h"$DB_HOST" -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < "$APP_DIR/migrations/001b_supplement.sql"
  mysql -h"$DB_HOST" -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < "$APP_DIR/migrations/002_question_bank.sql"
  mysql -h"$DB_HOST" -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < "$APP_DIR/migrations/003_alert_escalation.sql"
  info "数据库初始化完成"
fi

# ─── 6. PM2 启动 / 重载 ──────────────────────────────────────
info "启动/重载服务..."
if pm2 list | grep -q "ulife-server"; then
  pm2 reload ecosystem.config.js --env production
else
  pm2 start ecosystem.config.js --env production
fi
pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash 2>/dev/null || true

# ─── 7. Nginx 配置 ──────────────────────────────────────────
if [ "$MODE" = "install" ]; then
  info "配置 Nginx..."
  cp "$APP_DIR/nginx/ulife.conf" /etc/nginx/sites-available/ulife
  ln -sf /etc/nginx/sites-available/ulife /etc/nginx/sites-enabled/ulife
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx
fi

# ─── 8. 防火墙 ──────────────────────────────────────────────
if [ "$MODE" = "install" ]; then
  info "配置防火墙..."
  ufw allow 22/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
fi

info "✅ 部署完成！"
echo ""
echo "  服务状态：pm2 status"
echo "  查看日志：pm2 logs ulife-server"
echo "  健康检查：curl http://localhost:3000/health"
echo ""
