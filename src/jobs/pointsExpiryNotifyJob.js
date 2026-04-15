// src/jobs/pointsExpiryNotifyJob.js
// 积分到期预警定时任务
// 每天 09:00 执行：检查 30 天内将要过期的积分批次
// → 向老人 + 其已授权的家属发送站内消息

const cron           = require('node-cron')
const dayjs          = require('dayjs')
const MessageService = require('../services/messageService')
const logger         = require('../utils/logger')

const JOB_NAME = '[PointsExpiry]'

async function runNotify(db) {
  const now      = dayjs()
  const in30days = now.add(30, 'day').format('YYYY-MM-DD HH:mm:ss')
  const today    = now.format('YYYY-MM-DD HH:mm:ss')

  // 找出 30 天内到期、尚未过期、且积分 > 0 的账本批次
  // 按 customer_id 聚合，避免同一老人收到多条消息
  const expiringRows = await db('points_ledger as pl')
    .join('customers as c', 'c.id', 'pl.customer_id')
    .join('users as u', 'u.id', 'c.user_id')
    .where('pl.expires_at', '>', today)
    .where('pl.expires_at', '<=', in30days)
    .where('pl.points', '>', 0)
    .where('u.is_active', 1)
    .where('c.is_active', 1)
    .groupBy('pl.customer_id')
    .select(
      'pl.customer_id',
      'c.name as customerName',
      'u.id as userId',
      db.raw('SUM(pl.points) as expiringPoints'),
      db.raw('MIN(pl.expires_at) as nearestExpiry')
    )

  if (expiringRows.length === 0) {
    logger.info(`${JOB_NAME} 暂无即将过期积分`)
    return
  }

  logger.info(`${JOB_NAME} 发现 ${expiringRows.length} 位老人积分即将过期，开始推送通知`)

  const msgSvc = new MessageService(db)

  for (const row of expiringRows) {
    const expiryDate = dayjs(row.nearestExpiry).format('YYYY年MM月DD日')
    const daysLeft   = dayjs(row.nearestExpiry).diff(now, 'day') + 1

    // 通知老人本人
    await msgSvc.send({
      receiverId:   row.userId,
      receiverRole: 'elder',
      type:         'points_change',
      priority:     daysLeft <= 7 ? 'high' : 'normal',
      title:        '您有积分即将过期，记得兑换哦',
      content:      `您有 ${row.expiringPoints} 积分将于 ${expiryDate} 到期（还剩 ${daysLeft} 天），快去积分商城兑换礼品吧！`,
      actionUrl:    '/elder/mall',
      actionLabel:  '去兑换',
      refType:      'points_expiry',
    })

    // 通知已授权且有查看积分权限的家属
    const families = await db('family_authorizations as fa')
      .join('users as u', 'u.id', 'fa.family_user_id')
      .where({
        'fa.customer_id':    row.customer_id,
        'fa.status':         'approved',
        'fa.can_view_points': 1,
        'u.is_active':       1,
      })
      .select('u.id as userId')

    if (families.length > 0) {
      const receivers = families.map(f => ({ id: f.userId, role: 'family' }))
      await msgSvc.sendBatch(receivers, {
        type:        'points_change',
        priority:    'normal',
        title:       `${row.customerName}的积分即将过期`,
        content:     `${row.customerName} 有 ${row.expiringPoints} 积分将于 ${expiryDate} 到期，可提醒老人登录商城兑换。`,
        actionUrl:   `/family/elder/${row.customer_id}/points`,
        actionLabel: '查看详情',
        refType:     'points_expiry',
      })
    }
  }

  logger.info(`${JOB_NAME} 积分到期通知推送完成`)
}

/**
 * 启动积分到期预警定时任务
 * @param {import('knex').Knex} db
 */
function start(db) {
  // 每天 09:03 执行（错开整点）
  cron.schedule('3 9 * * *', async () => {
    logger.info(`${JOB_NAME} 开始检查积分到期...`)
    await runNotify(db).catch(err =>
      logger.error(`${JOB_NAME} 任务异常：${err.message}`)
    )
  })

  logger.info(`${JOB_NAME} 定时任务已启动（每天 09:03 执行）`)
}

module.exports = { start }
