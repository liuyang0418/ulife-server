// src/app.js
// 优宅·续航智脑 后端服务入口

require('dotenv').config()

const express    = require('express')
const cors       = require('cors')
const helmet     = require('helmet')
const rateLimit  = require('express-rate-limit')

const db         = require('../config/db')
const logger     = require('./utils/logger')
const dbInject   = require('./middleware/dbInject')
const errorHandler = require('./middleware/errorHandler')

// ─── 路由 ─────────────────────────────────────────────────────
const authRouter            = require('./routes/auth')
const adminRouter           = require('./routes/admin')
const caregiverRouter       = require('./routes/caregiver')
const elderRouter           = require('./routes/elder')
const messagesRouter        = require('./routes/messages')
const customersRouter       = require('./routes/customers')
const assessmentsRouter     = require('./routes/assessments')
const pointsRouter          = require('./routes/points')
const mallRouter            = require('./routes/mall')
const taskLibraryRouter     = require('./routes/taskLibrary')
const taskAssignmentsRouter = require('./routes/taskAssignments')
const taskCheckinsRouter    = require('./routes/taskCheckins')
const servicePackagesRouter = require('./routes/servicePackages')
const familyRouter          = require('./routes/family')
const healthReportsRouter   = require('./routes/healthReports')

// ─── 定时任务 ─────────────────────────────────────────────────
const alertEscalationJob  = require('./jobs/alertEscalationJob')
const pointsExpiryNotify  = require('./jobs/pointsExpiryNotifyJob')

const app  = express()
const PORT = process.env.PORT || 3000

// ─── 安全与解析中间件 ─────────────────────────────────────────
app.use(helmet())
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}))
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true }))

// 全局限流：每个 IP 每分钟最多 200 次请求
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' },
}))

// ─── 将 knex 实例注入 req.db ───────────────────────────────────
app.use(dbInject)

// ─── 健康检查（不需要鉴权）────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }))

// ─── API 路由挂载 ─────────────────────────────────────────────
app.use('/api/auth',             authRouter)
app.use('/api/customers',        customersRouter)
app.use('/api/assessments',      assessmentsRouter)
app.use('/api/points',           pointsRouter)
app.use('/api/mall',             mallRouter)
app.use('/api/task-library',     taskLibraryRouter)
app.use('/api/task-assignments', taskAssignmentsRouter)
app.use('/api/task-checkins',    taskCheckinsRouter)
app.use('/api/service-packages', servicePackagesRouter)
app.use('/api/family',           familyRouter)
app.use('/api/health-reports',   healthReportsRouter)
app.use('/api/messages',         messagesRouter)
app.use('/api/admin',            adminRouter)
app.use('/api/caregiver',        caregiverRouter)
app.use('/api/elder',            elderRouter)

// ─── 404 ──────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ code: 'NOT_FOUND', message: '接口不存在' }))

// ─── 全局错误处理（必须在最后）────────────────────────────────
app.use(errorHandler)

// ─── 启动服务 ─────────────────────────────────────────────────
async function bootstrap() {
  try {
    // 验证数据库连接
    await db.raw('SELECT 1')
    logger.info('✅ 数据库连接成功')

    // 启动定时任务
    alertEscalationJob.start(db)
    pointsExpiryNotify.start(db)

    app.listen(PORT, () => {
      logger.info(`🚀 优宅·续航智脑 服务已启动 → http://localhost:${PORT}`)
    })
  } catch (err) {
    logger.error(`❌ 服务启动失败：${err.message}`)
    process.exit(1)
  }
}

bootstrap()

module.exports = app
