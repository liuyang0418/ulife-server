// src/routes/mall.js
// 积分商城路由

const router = require('express').Router()
const { authenticate, requireRole } = require('../middleware/auth')
const ctrl   = require('../controllers/mallController')

const auth    = [authenticate]
const admin   = [authenticate, requireRole('admin')]
const staff   = [authenticate, requireRole('caregiver', 'admin')]
const elder   = [authenticate, requireRole('elder')]

// 商品列表（登录即可查看）
router.get('/products',         ...auth,  (r, s, n) => ctrl.listProducts(r, s).catch(n))
// 商品管理（admin）
router.post('/products',        ...admin, (r, s, n) => ctrl.createProduct(r, s).catch(n))
router.put('/products/:id',     ...admin, (r, s, n) => ctrl.updateProduct(r, s).catch(n))
// 老人兑换
router.post('/exchange',        ...elder, (r, s, n) => ctrl.exchange(r, s).catch(n))
// 老人查看自己的兑换记录
router.get('/my-exchanges',     ...elder, (r, s, n) => ctrl.myExchanges(r, s).catch(n))
// 核销（管家/admin）
router.post('/verify',          ...staff, (r, s, n) => ctrl.verify(r, s).catch(n))
// 管理员查看全部兑换记录
router.get('/exchanges',        ...admin, (r, s, n) => ctrl.listExchanges(r, s).catch(n))

module.exports = router
