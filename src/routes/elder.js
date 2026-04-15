// src/routes/elder.js
// 长者端路由

const router     = require('express').Router()
const { authenticate, requireRole } = require('../middleware/auth')
const reportCtrl = require('../controllers/afiReportController')

const elder = [authenticate, requireRole('elder', 'caregiver', 'admin')]

// ─── 生命仪表盘数据（三环所需全量）────────────────────────────
router.get('/afi-report', ...elder, (r, s) => reportCtrl.report(r, s))

module.exports = router
