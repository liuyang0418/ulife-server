// src/routes/auth.js
// 注册、登录、Token 刷新、修改密码路由

const router     = require('express').Router()
const rateLimit  = require('express-rate-limit')
const { authenticate } = require('../middleware/auth')
const authCtrl   = require('../controllers/authController')
const userCtrl   = require('../controllers/adminUserController')

// ─── 登录专用限流（每 IP 15 分钟内最多 10 次）────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: { code: 'TOO_MANY_ATTEMPTS', message: '登录尝试过多，请 15 分钟后再试' },
})

// ─── 注册限流（每 IP 每小时最多 5 次）────────────────────────
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: { code: 'TOO_MANY_ATTEMPTS', message: '注册请求过多，请稍后再试' },
})

// ─── 公开接口 ─────────────────────────────────────────────────
router.post('/register',        registerLimiter, (r, s) => authCtrl.register(r, s))
router.post('/login',           loginLimiter,    (r, s) => authCtrl.login(r, s))

// ─── 需要登录的接口 ───────────────────────────────────────────
router.get ('/me',              authenticate,    (r, s) => authCtrl.me(r, s))
router.post('/refresh',         authenticate,    (r, s) => authCtrl.refresh(r, s))
router.post('/change-password', authenticate,    (r, s) => authCtrl.changePassword(r, s))

// ─── 邀请码绑定（老人注册后使用）────────────────────────────
router.post('/bind-invite',     authenticate,    (r, s, n) => userCtrl.bindByInviteCode(r, s).catch(n))

module.exports = router
