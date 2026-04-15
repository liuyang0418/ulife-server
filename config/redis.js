// config/redis.js
require('dotenv').config()
const Redis = require('ioredis')

const redis = new Redis({
  host:     process.env.REDIS_HOST || '127.0.0.1',
  port:     Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db:       Number(process.env.REDIS_DB) || 0,
  retryStrategy: (times) => Math.min(times * 500, 3000),
})

redis.on('connect', () => console.log('✅ Redis 连接成功'))
redis.on('error',   (e) => console.error('❌ Redis 错误:', e.message))

module.exports = redis
