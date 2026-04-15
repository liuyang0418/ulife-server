// src/middleware/dbInject.js
// 将 knex 实例挂载到 req.db，所有路由无需手动 require

const db = require('../../config/db')

module.exports = (req, _res, next) => {
  req.db = db
  next()
}
