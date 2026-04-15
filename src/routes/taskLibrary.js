// src/routes/taskLibrary.js
// 任务库路由（管理员）

const router = require('express').Router()
const { authenticate, requireRole } = require('../middleware/auth')
const ctrl   = require('../controllers/taskLibraryController')

const admin = [authenticate, requireRole('admin')]
const staff = [authenticate, requireRole('caregiver', 'admin')]

router.get('/',            ...staff, (r, s, n) => ctrl.list(r, s).catch(n))
router.get('/categories',  ...staff, (r, s, n) => ctrl.categories(r, s).catch(n))
router.post('/',           ...admin, (r, s, n) => ctrl.create(r, s).catch(n))
router.put('/:id',         ...admin, (r, s, n) => ctrl.update(r, s).catch(n))

module.exports = router
