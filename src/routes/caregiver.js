// src/routes/caregiver.js
// 管家端路由

const router      = require('express').Router()
const { authenticate, requireRole } = require('../middleware/auth')
const afiCtrl     = require('../controllers/afiController')
const reportCtrl  = require('../controllers/afiReportController')

const caregiver = [authenticate, requireRole('caregiver', 'admin')]

// ─── AFI 数据录入与查询 ───────────────────────────────────────
router.post ('/afi-records',              ...caregiver, (r, s) => afiCtrl.create(r, s))
router.get  ('/afi-records/:customerId',  ...caregiver, (r, s) => afiCtrl.list(r, s))
router.put  ('/afi-records/:id',          ...caregiver, (r, s) => afiCtrl.update(r, s))

// ─── AFI 报告（仪表盘数据）────────────────────────────────────
router.get  ('/afi-report',               ...caregiver, (r, s) => reportCtrl.report(r, s))

// ─── 预警处理 ─────────────────────────────────────────────────
router.patch('/afi-alerts/:id/handle',    ...caregiver, (r, s) => afiCtrl.handleAlert(r, s))

module.exports = router
