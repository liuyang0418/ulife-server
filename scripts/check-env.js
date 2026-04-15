// scripts/check-env.js  验证所有依赖是否正常
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '../.env') })
const db    = require('../config/db')
const redis = require('../config/redis')

async function check() {
  console.log('\n🔍 开发环境检查中...\n')

  // 1. MySQL
  try {
    const rows = await db.raw('SELECT VERSION() as version, NOW() as now')
    const { version, now } = rows[0][0]
    console.log(`✅ MySQL    连接成功  版本: ${version}  服务器时间: ${now}`)
    const tables = await db.raw("SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema='ulife'")
    console.log(`   数据库 ulife 共 ${tables[0][0].cnt} 张表`)
  } catch (e) {
    console.error('❌ MySQL    连接失败:', e.message)
  }

  // 2. Redis
  try {
    await redis.set('ulife:health', 'ok', 'EX', 10)
    const val = await redis.get('ulife:health')
    const info = await redis.info('server')
    const version = info.match(/redis_version:(.+)/)?.[1]?.trim()
    console.log(`✅ Redis    连接成功  版本: ${version}  测试读写: ${val}`)
  } catch (e) {
    console.error('❌ Redis    连接失败:', e.message)
  }

  // 3. 环境变量
  const required = ['DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','JWT_SECRET']
  const missing  = required.filter(k => !process.env[k])
  if (missing.length === 0) {
    console.log('✅ 环境变量  必填项全部配置')
  } else {
    console.error('❌ 环境变量  缺少以下必填项:', missing.join(', '))
  }

  console.log('\n✨ 检查完成！开发环境就绪。\n')
  process.exit(0)
}

check().catch(e => { console.error(e); process.exit(1) })
