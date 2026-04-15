// src/routes/taskCheckins.js
// 视频打卡路由

const router = require('express').Router()
const { authenticate, requireRole } = require('../middleware/auth')
const ctrl   = require('../controllers/taskCheckinController')

const auth  = [authenticate]
const elder = [authenticate, requireRole('elder')]
const staff = [authenticate, requireRole('caregiver', 'admin')]

// 老人提交打卡
router.post('/',              ...elder, (r, s, n) => ctrl.submit(r, s).catch(n))
// 查询打卡记录（老人查自己；管家传 customer_id）
router.get('/',               ...auth,  (r, s, n) => ctrl.list(r, s).catch(n))
// 待审核列表（管家/admin）
router.get('/pending',        ...staff, (r, s, n) => ctrl.listPending(r, s).catch(n))
// 审核打卡
router.patch('/:id/review',   ...staff, (r, s, n) => ctrl.review(r, s).catch(n))

module.exports = router
