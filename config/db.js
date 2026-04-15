// config/db.js
require('dotenv').config()
const knex = require('knex')

const db = knex({
  client: 'mysql2',
  connection: {
    host:     process.env.DB_HOST,
    port:     Number(process.env.DB_PORT),
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset:  'utf8mb4',
    timezone: '+08:00',
  },
  pool: {
    min: Number(process.env.DB_POOL_MIN) || 2,
    max: Number(process.env.DB_POOL_MAX) || 10,
  },
  acquireConnectionTimeout: 10000,
})

module.exports = db
