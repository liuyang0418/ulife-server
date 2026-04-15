// src/routes/servicePackages.js
// 服务套餐路由

const router = require('express').Router()
const { authenticate, requireRole } = require('../middleware/auth')
const ctrl   = require('../controllers/servicePackageController')

const auth  = [authenticate]
const admin = [authenticate, requireRole('admin')]

// 套餐列表（登录可见）
router.get('/',                    ...auth,  (r, s, n) => ctrl.list(r, s).catch(n))
// 套餐管理（admin）
router.post('/',                   ...admin, (r, s, n) => ctrl.create(r, s).catch(n))
router.put('/:id',                 ...admin, (r, s, n) => ctrl.update(r, s).catch(n))
// 为老人购买/开通套餐（admin）
router.post('/:id/purchase',       ...admin, (r, s, n) => ctrl.purchase(r, s).catch(n))
// 查询老人套餐记录
router.get('/orders',              ...auth,  (r, s, n) => ctrl.orders(r, s).catch(n))

module.exports = router
