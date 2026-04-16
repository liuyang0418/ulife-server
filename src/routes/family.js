// src/routes/family.js
// 家属授权路由

const router = require('express').Router()
const { authenticate, requireRole } = require('../middleware/auth')
const ctrl   = require('../controllers/familyController')

const auth   = [authenticate]
const admin  = [authenticate, requireRole('admin')]
const family = [authenticate, requireRole('family')]

// 家属按手机号查找老人
router.get('/find-elder',                           ...family, (r, s, n) => ctrl.findElderByPhone(r, s).catch(n))
// 家属申请绑定
router.post('/apply',                           ...family, (r, s, n) => ctrl.apply(r, s).catch(n))
// 家属查询自己的授权列表
router.get('/my-authorizations',                ...family, (r, s, n) => ctrl.myAuthorizations(r, s).catch(n))
// 家属查看老人数据
router.get('/elders/:customerId/afi-report',    ...family, (r, s, n) => ctrl.elderAfi(r, s).catch(n))
router.get('/elders/:customerId/points',        ...family, (r, s, n) => ctrl.elderPoints(r, s).catch(n))
router.get('/elders/:customerId/tasks',         ...family, (r, s, n) => ctrl.elderTasks(r, s).catch(n))
// 管理员查看所有申请
router.get('/applications',                     ...admin,  (r, s, n) => ctrl.listApplications(r, s).catch(n))
// 管理员审批
router.patch('/applications/:id',               ...admin,  (r, s, n) => ctrl.review(r, s).catch(n))

module.exports = router
