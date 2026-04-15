// src/routes/admin.js
// 管理员路由汇总

const router = require('express').Router()
const { authenticate, requireRole } = require('../middleware/auth')
const qbCtrl       = require('../controllers/questionBankController')
const paperCtrl    = require('../controllers/examPaperController')
const userCtrl     = require('../controllers/adminUserController')

const admin = [authenticate, requireRole('admin')]

// ─── 题库 ─────────────────────────────────────────────────────
router.get   ('/question-bank',                ...admin, (r,s) => qbCtrl.list(r,s))
router.get   ('/question-bank/dimensions',     ...admin, (r,s) => qbCtrl.dimensions(r,s))
router.post  ('/question-bank',                ...admin, (r,s) => qbCtrl.create(r,s))
router.put   ('/question-bank/:id',            ...admin, (r,s) => qbCtrl.update(r,s))
router.post  ('/question-bank/batch-import',   ...admin, (r,s) => qbCtrl.batchImport(r,s))

// ─── 试卷 ─────────────────────────────────────────────────────
router.get   ('/exam-papers',                  ...admin, (r,s) => paperCtrl.list(r,s))
router.post  ('/exam-papers',                  ...admin, (r,s) => paperCtrl.create(r,s))
router.get   ('/exam-papers/:id',              ...admin, (r,s) => paperCtrl.detail(r,s))
router.patch ('/exam-papers/:id/rename',       ...admin, (r,s) => paperCtrl.rename(r,s))
router.post  ('/exam-papers/:id/questions',    ...admin, (r,s) => paperCtrl.addQuestions(r,s))
router.delete('/exam-papers/:id/questions/:questionId', ...admin, (r,s) => paperCtrl.removeQuestion(r,s))
router.put   ('/exam-papers/:id/reorder',      ...admin, (r,s) => paperCtrl.reorder(r,s))
router.patch ('/exam-papers/:id/questions/:questionId/required', ...admin, (r,s) => paperCtrl.setRequired(r,s))
router.post  ('/exam-papers/:id/publish',      ...admin, (r,s) => paperCtrl.publish(r,s))
router.post  ('/exam-papers/:id/unpublish',    ...admin, (r,s) => paperCtrl.unpublish(r,s))
router.post  ('/exam-papers/:id/duplicate',    ...admin, (r,s) => paperCtrl.duplicate(r,s))

// ─── 用户管理 ─────────────────────────────────────────────────
router.get   ('/users',                        ...admin, (r,s,n) => userCtrl.listUsers(r,s).catch(n))
router.post  ('/users/caregiver',              ...admin, (r,s,n) => userCtrl.createCaregiver(r,s).catch(n))
router.patch ('/users/:id/status',             ...admin, (r,s,n) => userCtrl.setUserStatus(r,s).catch(n))
router.post  ('/users/:id/reset-password',     ...admin, (r,s,n) => userCtrl.resetPassword(r,s).catch(n))

// ─── 管家邀请码 ───────────────────────────────────────────────
router.post  ('/invite-codes/:caregiverId',    ...admin, (r,s,n) => userCtrl.generateInviteCode(r,s).catch(n))
router.get   ('/invite-codes/:caregiverId',    ...admin, (r,s,n) => userCtrl.getInviteCode(r,s).catch(n))

// ─── 三剑客小组 ───────────────────────────────────────────────
router.get   ('/groups',                       ...admin, (r,s,n) => userCtrl.listGroups(r,s).catch(n))
router.post  ('/groups',                       ...admin, (r,s,n) => userCtrl.createGroup(r,s).catch(n))
router.post  ('/groups/:id/members',           ...admin, (r,s,n) => userCtrl.addGroupMember(r,s).catch(n))
router.delete('/groups/:id/members/:caregiverId', ...admin, (r,s,n) => userCtrl.removeGroupMember(r,s).catch(n))

module.exports = router
