// src/routes/customers.js
// 老人档案路由（管理员 + 管家端共用，权限在 controller 内区分）

const router      = require('express').Router()
const { authenticate, requireRole } = require('../middleware/auth')
const ctrl        = require('../controllers/customerController')

const admin    = [authenticate, requireRole('admin')]
const staff    = [authenticate, requireRole('caregiver', 'admin')]

// ─── 列表 & 详情（管家 + admin）──────────────────────────────
router.get('/',                      ...staff, (r, s) => ctrl.list(r, s))
router.get('/:id',                   ...staff, (r, s, n) => ctrl.detail(r, s).catch(n))

// ─── 创建老人档案（仅 admin）──────────────────────────────────
router.post('/',                     ...admin, (r, s, n) => ctrl.create(r, s).catch(n))

// ─── 更新档案（管家 + admin，controller 内鉴权）────────────────
router.put('/:id',                   ...staff, (r, s, n) => ctrl.update(r, s).catch(n))

// ─── 注销（仅 admin）──────────────────────────────────────────
router.post('/:id/cancel',           ...admin, (r, s, n) => ctrl.cancel(r, s).catch(n))

// ─── 管家分配 & 取消（仅 admin）──────────────────────────────
router.post('/:id/caregivers',       ...admin, (r, s, n) => ctrl.assignCaregiver(r, s).catch(n))
router.delete('/:id/caregivers/:caregiverId', ...admin, (r, s, n) => ctrl.removeCaregiver(r, s).catch(n))

module.exports = router
