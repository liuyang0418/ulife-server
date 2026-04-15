// src/middleware/errorHandler.js
// 全局错误处理，统一响应格式

const logger = require('../utils/logger')

// eslint-disable-next-line no-unused-vars
module.exports = (err, req, res, _next) => {
  // Knex / MySQL 已知错误
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ code: 'DUPLICATE', message: '数据已存在，请勿重复提交' })
  }
  if (err.code === 'ER_NO_REFERENCED_ROW_2') {
    return res.status(400).json({ code: 'REF_ERROR', message: '关联数据不存在' })
  }

  logger.error(`${req.method} ${req.path} → ${err.message}`, {
    stack: err.stack,
    body:  req.body,
    user:  req.user?.id,
  })

  const status = err.status || err.statusCode || 500
  res.status(status).json({
    code:    status === 500 ? 'SERVER_ERROR' : 'ERROR',
    message: status === 500 ? '服务器内部错误，请稍后重试' : err.message,
  })
}
