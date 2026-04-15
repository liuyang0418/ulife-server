// src/jobs/alertEscalationJob.js
// 预警升级定时任务
// 每 5 分钟检查：status='pending' 且超过 30 分钟未处理的预警
// → 自动通知该三剑客小组内的另外 2 名协同管家

const cron           = require('node-cron')
const dayjs          = require('dayjs')
const MessageService = require('../services/messageService')
const logger         = require('../utils/logger')

const JOB_NAME = '[AlertEscalation]'

async function runEscalation(db) {
  // 查找所有超过 30 分钟未处理且尚未升级的 pending 预警
  const threshold = dayjs().subtract(30, 'minute').format('YYYY-MM-DD HH:mm:ss')

  const overdueAlerts = await db('afi_alerts')
    .where({ status: 'pending' })
    .whereNull('escalated_at')
    .where('created_at', '<=', threshold)
    .select('id', 'customer_id', 'alert_level', 'alert_reasons')

  if (overdueAlerts.length === 0) return

  logger.info(`${JOB_NAME} 发现 ${overdueAlerts.length} 条预警需要升级`)

  const msgSvc = new MessageService(db)

  for (const alert of overdueAlerts) {
    try {
      // 1. 找主责管家
      const primary = await db('caregiver_assignments')
        .where({ customer_id: alert.customer_id, assignment_type: 'primary' })
        .first('caregiver_id')

      if (!primary) {
        logger.warn(`${JOB_NAME} 预警 ${alert.id}：未找到主责管家，跳过`)
        continue
      }

      // 2. 找主责管家所在三剑客小组
      const groupMember = await db('caregiver_group_members')
        .where({ caregiver_id: primary.caregiver_id })
        .first('group_id')

      if (!groupMember) {
        logger.warn(`${JOB_NAME} 预警 ${alert.id}：主责管家不在任何小组，跳过`)
        continue
      }

      // 3. 找同组另外 2 名协同管家的用户信息
      const coMembers = await db('caregiver_group_members as cgm')
        .join('users as u', 'u.id', 'cgm.caregiver_id')
        .where('cgm.group_id', groupMember.group_id)
        .whereNot('cgm.caregiver_id', primary.caregiver_id)
        .where('u.is_active', 1)
        .select('u.id as userId', 'u.name')

      if (coMembers.length === 0) {
        logger.warn(`${JOB_NAME} 预警 ${alert.id}：小组内无其他协同管家`)
        continue
      }

      // 4. 获取老人姓名
      const customer = await db('customers')
        .where({ id: alert.customer_id })
        .first('name')

      const reasons = (() => {
        try { return JSON.parse(alert.alert_reasons) } catch { return [] }
      })()
      const reasonText = reasons.length ? reasons[0] : '健康指标异常'

      // 5. 批量发送站内消息（urgent 级别）
      const receivers = coMembers.map(m => ({ id: m.userId, role: 'caregiver' }))
      await msgSvc.sendBatch(receivers, {
        type:        'alert_warning',
        priority:    'urgent',
        title:       `【升级预警】${customer?.name || '老人'} ${alert.alert_level === 'red' ? '🔴红色' : '🟡黄色'}预警待处理`,
        content:     `主责管家已超30分钟未响应。原因：${reasonText}。请您立即登录系统查看并处理。`,
        actionUrl:   `/caregiver/alerts/${alert.id}`,
        actionLabel: '立即处理',
        refType:     'afi_alert',
        refId:       alert.id,
      })

      // 6. 更新预警记录，标记已升级（防止重复通知）
      await db('afi_alerts').where({ id: alert.id }).update({
        escalated_at: dayjs().format('YYYY-MM-DD HH:mm:ss'),
        escalated_to: JSON.stringify(coMembers.map(m => m.userId)),
      })

      logger.info(`${JOB_NAME} 预警 ${alert.id} 已升级通知协同管家：${coMembers.map(m => m.name).join('、')}`)
    } catch (err) {
      logger.error(`${JOB_NAME} 处理预警 ${alert.id} 失败：${err.message}`)
    }
  }
}

/**
 * 启动预警升级定时任务
 * @param {import('knex').Knex} db
 */
function start(db) {
  // 每 5 分钟执行一次
  cron.schedule('*/5 * * * *', async () => {
    logger.info(`${JOB_NAME} 检查预警升级...`)
    await runEscalation(db).catch(err =>
      logger.error(`${JOB_NAME} 任务异常：${err.message}`)
    )
  })

  logger.info(`${JOB_NAME} 定时任务已启动（每5分钟检查）`)
}

module.exports = { start }
