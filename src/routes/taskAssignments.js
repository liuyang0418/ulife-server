// src/routes/taskAssignments.js
// 老人任务分配路由（管家 + admin）

const router = require('express').Router()
const { authenticate, requireRole } = require('../middleware/auth')
const ctrl   = require('../controllers/taskAssignmentController')

const staff = [authenticate, requireRole('caregiver', 'admin')]

router.get('/',        ...staff, (r, s, n) => ctrl.list(r, s).catch(n))
router.post('/',       ...staff, (r, s, n) => ctrl.assign(r, s).catch(n))
router.patch('/:id',   ...staff, (r, s, n) => ctrl.updateStatus(r, s).catch(n))

module.exports = router
