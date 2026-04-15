// src/services/pointsService.js
// 积分核心服务：所有积分变动必须通过此服务，保证事务一致性

const dayjs = require('dayjs')
const logger = require('../utils/logger')

class PointsService {
  constructor(db) {
    this.db = db
  }

  /**
   * 获取或初始化老人积分余额
   */
  async getBalance(customerId) {
    let balance = await this.db('points_balance').where({ customer_id: customerId }).first()
    if (!balance) {
      await this.db('points_balance').insert({
        customer_id:    customerId,
        current_balance: 0,
        total_earned:    0,
        total_redeemed:  0,
        total_expired:   0,
      }).onConflict('customer_id').ignore()
      balance = await this.db('points_balance').where({ customer_id: customerId }).first()
    }
    return balance
  }

  /**
   * 通用积分变动（必须在事务中调用，或自行开启事务）
   *
   * @param {object} opts
   * @param {number}  opts.customerId
   * @param {string}  opts.action        - points_ledger.action ENUM
   * @param {number}  opts.points        - 正数=收入 负数=支出
   * @param {number}  [opts.operatorId]  - 操作人 users.id
   * @param {string}  [opts.operatorRole]- system/caregiver/admin
   * @param {string}  [opts.remark]
   * @param {string}  [opts.sourceType]  - task_video / mall_exchange / manual 等
   * @param {number}  [opts.sourceId]
   * @param {Date}    [opts.expiresAt]   - 积分到期时间（仅 earn 类有意义）
   * @param {object}  [trx]              - knex 事务对象，不传则使用 this.db
   * @returns {{ ledgerId: number, balanceAfter: number }}
   */
  async change({ customerId, action, points, operatorId = null, operatorRole = 'system',
                  remark = null, sourceType = null, sourceId = null, expiresAt = null }, trx) {
    const db = trx || this.db

    // 锁行读取余额（SELECT FOR UPDATE）
    const balance = await db('points_balance')
      .where({ customer_id: customerId })
      .forUpdate()
      .first()

    if (!balance) {
      // 首次：初始化余额行
      await db('points_balance').insert({
        customer_id:    customerId,
        current_balance: 0,
        total_earned:    0,
        total_redeemed:  0,
        total_expired:   0,
      })
      return this.change({ customerId, action, points, operatorId, operatorRole,
                            remark, sourceType, sourceId, expiresAt }, trx)
    }

    const newBalance = balance.current_balance + points
    if (newBalance < 0) {
      const err = new Error(`积分不足（当前 ${balance.current_balance}，需要扣除 ${Math.abs(points)}）`)
      err.code   = 'INSUFFICIENT_POINTS'
      err.status = 400
      throw err
    }

    // 更新余额汇总
    const balanceUpdate = { current_balance: newBalance }
    if (points > 0) balanceUpdate.total_earned    = db.raw('total_earned + ?',   [points])
    if (action === 'redeem')         balanceUpdate.total_redeemed = db.raw('total_redeemed + ?', [Math.abs(points)])
    if (action === 'expire')         balanceUpdate.total_expired  = db.raw('total_expired + ?',  [Math.abs(points)])
    balanceUpdate.updated_at = db.fn.now()

    await db('points_balance').where({ customer_id: customerId }).update(balanceUpdate)

    // 写积分流水
    const [ledgerId] = await db('points_ledger').insert({
      customer_id:   customerId,
      action,
      points,
      balance_after: newBalance,
      expires_at:    expiresAt ? dayjs(expiresAt).format('YYYY-MM-DD HH:mm:ss') : null,
      operator_id:   operatorId,
      operator_role: operatorRole,
      remark,
      source_type:   sourceType,
      source_id:     sourceId,
      created_at:    db.fn.now(),
    })

    return { ledgerId, balanceAfter: newBalance }
  }

  /**
   * 视频打卡奖励积分（含有效期计算）
   */
  async earnCheckin({ customerId, taskId, taskVideoId, caregiverId, db: _db }) {
    const db = _db || this.db

    // 查任务积分值
    const task = await db('task_library').where({ id: taskId }).first('points_value')
    if (!task) throw new Error('任务不存在')

    // 查全局积分配置
    const config = await db('points_config').first('validity_days')
    const validDays  = config?.validity_days || 365
    const expiresAt  = dayjs().add(validDays, 'day').toDate()

    return db.transaction(async trx => {
      const result = await this.change({
        customerId,
        action:      'earn_checkin',
        points:      task.points_value,
        operatorId:  caregiverId,
        operatorRole: 'caregiver',
        remark:      `视频打卡奖励`,
        sourceType:  'task_video',
        sourceId:    taskVideoId,
        expiresAt,
      }, trx)

      logger.info(`积分奖励: customer=${customerId} +${task.points_value} balance=${result.balanceAfter}`)
      return result
    })
  }

  /**
   * 兑换商品扣除积分
   */
  async redeem({ customerId, points, exchangeLogId, db: _db }) {
    const db = _db || this.db
    return db.transaction(async trx => {
      return this.change({
        customerId,
        action:      'redeem',
        points:      -points,
        operatorRole: 'system',
        remark:      '积分商城兑换',
        sourceType:  'exchange_log',
        sourceId:    exchangeLogId,
      }, trx)
    })
  }

  /**
   * 管理员手动调整积分
   */
  async adminAdjust({ customerId, points, adminId, remark }) {
    const action = points > 0 ? 'adjust_add' : 'adjust_deduct'
    return this.db.transaction(async trx => {
      return this.change({
        customerId,
        action,
        points,
        operatorId:  adminId,
        operatorRole: 'admin',
        remark,
      }, trx)
    })
  }
}

module.exports = PointsService
