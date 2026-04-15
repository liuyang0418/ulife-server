// src/middleware/auth.js
// JWT 验证 + 角色鉴权中间件

const jwt = require('jsonwebtoken')

const JWT_SECRET = process.env.JWT_SECRET || 'ulife-dev-secret'

/**
 * 验证 JWT，将解码后的用户信息挂到 req.user
 */
function authenticate(req, res, next) {
  const header = req.headers['authorization'] || ''
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null

  if (!token) {
    return res.status(401).json({ code: 'UNAUTHORIZED', message: '请先登录' })
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET)
    next()
  } catch (e) {
    const msg = e.name === 'TokenExpiredError' ? '登录已过期，请重新登录' : 'Token无效'
    return res.status(401).json({ code: 'UNAUTHORIZED', message: msg })
  }
}

/**
 * 角色白名单检查（可传多个角色）
 * 用法: requireRole('admin') 或 requireRole('caregiver','admin')
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ code: 'UNAUTHORIZED', message: '请先登录' })
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ code: 'FORBIDDEN', message: '权限不足' })
    }
    next()
  }
}

/**
 * 生成 JWT
 * @param {Object} payload  - { id, role, name }
 * @param {string} expiresIn - 默认 7 天
 */
function signToken(payload, expiresIn = '7d') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn })
}

module.exports = { authenticate, requireRole, signToken }
