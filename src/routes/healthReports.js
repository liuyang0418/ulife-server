// src/routes/healthReports.js
// 健康月报路由

const router = require('express').Router()
const { authenticate, requireRole } = require('../middleware/auth')
const ctrl   = require('../controllers/healthReportController')

const auth  = [authenticate]
const staff = [authenticate, requireRole('caregiver', 'admin')]

// 生成月报（管家/admin）
router.post('/',      ...staff, (r, s, n) => ctrl.generate(r, s).catch(n))
// 查询列表（本人/管家/家属/admin）
router.get('/',       ...auth,  (r, s, n) => ctrl.list(r, s).catch(n))
// 查询详情
router.get('/:id',    ...auth,  (r, s, n) => ctrl.detail(r, s).catch(n))

module.exports = router
