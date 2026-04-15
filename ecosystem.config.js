# ecosystem.config.js — PM2 进程管理配置
# 部署到服务器后执行：pm2 start ecosystem.config.js --env production

module.exports = {
  apps: [
    {
      name:          'ulife-server',
      script:        'src/app.js',
      instances:     'max',          // CPU 核数，生产用 max；单核测试改 1
      exec_mode:     'cluster',      // 集群模式，进程间共享端口
      watch:         false,
      max_memory_restart: '500M',

      // 生产环境变量（实际值由服务器上的 .env 提供，这里只做标记）
      env_production: {
        NODE_ENV: 'production',
      },

      // 日志
      error_file:    '/var/log/ulife/error.log',
      out_file:      '/var/log/ulife/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs:    true,

      // 异常退出后自动重启
      autorestart:   true,
      restart_delay: 3000,
      max_restarts:  10,
    },
  ],
}
