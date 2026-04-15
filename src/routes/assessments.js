// src/routes/assessments.js
// 客户测评路由（管家端）

const router = require('express').Router()
const { authenticate, requireRole } = require('../middleware/auth')
const ctrl   = require('../controllers/assessmentController')

const staff = [authenticate, requireRole('caregiver', 'admin')]

// ─── 发起测评 ─────────────────────────────────────────────────
router.post('/',                       ...staff, (r, s, n) => ctrl.start(r, s).catch(n))

// ─── 历史测评列表（?customer_id=xxx）─────────────────────────
router.get('/',                        ...staff, (r, s, n) => ctrl.list(r, s).catch(n))

// ─── 测评详情 ─────────────────────────────────────────────────
router.get('/:id',                     ...staff, (r, s, n) => ctrl.detail(r, s).catch(n))

// ─── 批量提交答案 ──────────────────────────────────────────────
router.post('/:id/answers',            ...staff, (r, s, n) => ctrl.submitAnswers(r, s).catch(n))

// ─── 完成测评（触发算分 + 任务引擎）──────────────────────────
router.post('/:id/complete',           ...staff, (r, s, n) => ctrl.complete(r, s).catch(n))

module.exports = router
