// src/routes/points.js
// 积分路由

const router = require('express').Router()
const { authenticate, requireRole } = require('../middleware/auth')
const ctrl   = require('../controllers/pointsController')

const auth    = [authenticate]
const admin   = [authenticate, requireRole('admin')]
const staff   = [authenticate, requireRole('caregiver', 'admin')]

// 余额查询（老人查自己；管家/admin 传 ?customerId=；家属传 ?customerId=）
router.get('/balance',     ...auth,  (r, s, n) => ctrl.balance(r, s).catch(n))
// 流水查询
router.get('/ledger',      ...auth,  (r, s, n) => ctrl.ledger(r, s).catch(n))
// 管理员手动调整
router.post('/adjust',     ...admin, (r, s, n) => ctrl.adjust(r, s).catch(n))
// 积分全局配置
router.get('/config',      ...staff, (r, s, n) => ctrl.getConfig(r, s).catch(n))
router.put('/config',      ...admin, (r, s, n) => ctrl.updateConfig(r, s).catch(n))

module.exports = router
