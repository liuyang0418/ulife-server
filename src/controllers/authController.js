// src/controllers/authController.js
// 用户注册、登录、Token 刷新、修改密码

const bcrypt    = require('bcryptjs')
const { signToken } = require('../middleware/auth')
const logger    = require('../utils/logger')

// ─── 辅助：手机号格式校验 ─────────────────────────────────────
const PHONE_RE = /^1[3-9]\d{9}$/

// ─── 辅助：密码强度校验（8-32位，含字母+数字）────────────────
const PWD_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,32}$/

/**
 * POST /api/auth/register
 * body: { name, phone, password, role }
 * role 只允许 caregiver / family（elder 和 admin 由后台创建）
 */
async function register(req, res) {
  const { name, phone, password, role } = req.body

  // ── 参数校验 ──
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return res.status(400).json({ code: 'INVALID_PARAM', message: '姓名至少2个字符' })
  }
  if (!PHONE_RE.test(phone)) {
    return res.status(400).json({ code: 'INVALID_PARAM', message: '手机号格式不正确' })
  }
  if (!PWD_RE.test(password)) {
    return res.status(400).json({ code: 'INVALID_PARAM', message: '密码须为8-32位且包含字母和数字' })
  }
  const allowedRoles = ['caregiver', 'family']
  if (!allowedRoles.includes(role)) {
    return res.status(400).json({ code: 'INVALID_PARAM', message: '角色只能为 caregiver 或 family' })
  }

  try {
    // ── 检查手机号是否已注册 ──
    const existing = await req.db('users').where({ phone }).first()
    if (existing) {
      return res.status(409).json({ code: 'PHONE_EXISTS', message: '该手机号已注册' })
    }

    // ── 加密密码 ──
    const password_hash = await bcrypt.hash(password, 10)

    // ── 插入用户 ──
    const [id] = await req.db('users').insert({
      name:          name.trim(),
      phone,
      password_hash,
      role,
      is_active:     1,
      created_at:    req.db.fn.now(),
    })

    // ── 生成 token ──
    const token = signToken({ id, role, name: name.trim() })

    logger.info(`用户注册成功: id=${id} role=${role} phone=${phone}`)

    return res.status(201).json({
      code: 'OK',
      data: {
        token,
        user: { id, name: name.trim(), phone, role },
      },
    })
  } catch (err) {
    logger.error(`注册失败: ${err.message}`)
    return res.status(500).json({ code: 'SERVER_ERROR', message: '服务器内部错误' })
  }
}

/**
 * POST /api/auth/login
 * body: { phone, password }
 */
async function login(req, res) {
  const { phone, password } = req.body

  if (!phone || !password) {
    return res.status(400).json({ code: 'INVALID_PARAM', message: '手机号和密码不能为空' })
  }
  if (!PHONE_RE.test(phone)) {
    return res.status(400).json({ code: 'INVALID_PARAM', message: '手机号格式不正确' })
  }

  try {
    const user = await req.db('users')
      .where({ phone, is_active: 1 })
      .select('id', 'name', 'phone', 'role', 'password_hash', 'avatar')
      .first()

    // 用户不存在 or 密码错误 → 统一提示，避免枚举
    if (!user) {
      return res.status(401).json({ code: 'AUTH_FAILED', message: '手机号或密码错误' })
    }

    if (!user.password_hash) {
      // 微信用户无密码，不可用密码登录
      return res.status(401).json({ code: 'AUTH_FAILED', message: '该账号请使用微信登录' })
    }

    const match = await bcrypt.compare(password, user.password_hash)
    if (!match) {
      return res.status(401).json({ code: 'AUTH_FAILED', message: '手机号或密码错误' })
    }

    // ── 更新最后登录时间 ──
    await req.db('users').where({ id: user.id }).update({ last_login_at: req.db.fn.now() })

    const token = signToken({ id: user.id, role: user.role, name: user.name })

    logger.info(`用户登录: id=${user.id} role=${user.role}`)

    return res.json({
      code: 'OK',
      data: {
        token,
        user: {
          id:     user.id,
          name:   user.name,
          phone:  user.phone,
          role:   user.role,
          avatar: user.avatar || null,
        },
      },
    })
  } catch (err) {
    logger.error(`登录失败: ${err.message}`)
    return res.status(500).json({ code: 'SERVER_ERROR', message: '服务器内部错误' })
  }
}

/**
 * GET /api/auth/me
 * 需要 authenticate 中间件，返回当前用户完整信息
 */
async function me(req, res) {
  try {
    const user = await req.db('users')
      .where({ id: req.user.id, is_active: 1 })
      .select('id', 'name', 'phone', 'role', 'avatar', 'wechat_openid', 'last_login_at', 'created_at')
      .first()

    if (!user) {
      return res.status(404).json({ code: 'NOT_FOUND', message: '用户不存在或已停用' })
    }

    return res.json({ code: 'OK', data: user })
  } catch (err) {
    logger.error(`获取用户信息失败: ${err.message}`)
    return res.status(500).json({ code: 'SERVER_ERROR', message: '服务器内部错误' })
  }
}

/**
 * POST /api/auth/refresh
 * 用旧（未过期）token 换取新 token，延长有效期
 * 需要 authenticate 中间件
 */
async function refresh(req, res) {
  try {
    // req.user 已由 authenticate 中间件注入
    const { id, role, name } = req.user
    const token = signToken({ id, role, name })
    return res.json({ code: 'OK', data: { token } })
  } catch (err) {
    logger.error(`Token刷新失败: ${err.message}`)
    return res.status(500).json({ code: 'SERVER_ERROR', message: '服务器内部错误' })
  }
}

/**
 * POST /api/auth/change-password
 * body: { old_password, new_password }
 * 需要 authenticate 中间件
 */
async function changePassword(req, res) {
  const { old_password, new_password } = req.body

  if (!old_password || !new_password) {
    return res.status(400).json({ code: 'INVALID_PARAM', message: '旧密码和新密码不能为空' })
  }
  if (!PWD_RE.test(new_password)) {
    return res.status(400).json({ code: 'INVALID_PARAM', message: '新密码须为8-32位且包含字母和数字' })
  }
  if (old_password === new_password) {
    return res.status(400).json({ code: 'INVALID_PARAM', message: '新密码不能与旧密码相同' })
  }

  try {
    const user = await req.db('users')
      .where({ id: req.user.id, is_active: 1 })
      .select('id', 'password_hash')
      .first()

    if (!user) {
      return res.status(404).json({ code: 'NOT_FOUND', message: '用户不存在' })
    }

    if (!user.password_hash) {
      return res.status(400).json({ code: 'NO_PASSWORD', message: '该账号未设置密码，请联系管理员' })
    }

    const match = await bcrypt.compare(old_password, user.password_hash)
    if (!match) {
      return res.status(401).json({ code: 'AUTH_FAILED', message: '旧密码不正确' })
    }

    const new_hash = await bcrypt.hash(new_password, 10)
    await req.db('users').where({ id: user.id }).update({ password_hash: new_hash })

    logger.info(`用户修改密码: id=${user.id}`)

    return res.json({ code: 'OK', message: '密码修改成功' })
  } catch (err) {
    logger.error(`修改密码失败: ${err.message}`)
    return res.status(500).json({ code: 'SERVER_ERROR', message: '服务器内部错误' })
  }
}

module.exports = { register, login, me, refresh, changePassword }
