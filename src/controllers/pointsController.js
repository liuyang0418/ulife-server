// src/controllers/pointsController.js
// 积分查询 + 管理员调整

const PointsService = require('../services/pointsService')

class PointsController {

  // ─── 查询积分余额（老人/家属/管家/admin）────────────────────
  // GET /api/points/balance?customerId=xxx
  async balance(req, res) {
    const customerId = await this._resolveCustomerId(req, res)
    if (!customerId) return

    const svc     = new PointsService(req.db)
    const balance = await svc.getBalance(customerId)

    // 查即将过期积分（30天内）
    const in30d = req.db.raw("DATE_ADD(NOW(), INTERVAL 30 DAY)")
    const expiring = await req.db('points_ledger')
      .where('customer_id', customerId)
      .where('points', '>', 0)
      .where('expires_at', '>', req.db.fn.now())
      .where('expires_at', '<=', in30d)
      .sum('points as total')
      .first()

    return res.json({
      code: 'OK',
      data: {
        current_balance:  balance.current_balance,
        total_earned:     balance.total_earned,
        total_redeemed:   balance.total_redeemed,
        total_expired:    balance.total_expired,
        expiring_soon:    Number(expiring?.total || 0),
        updated_at:       balance.updated_at,
      },
    })
  }

  // ─── 积分流水（分页）─────────────────────────────────────────
  // GET /api/points/ledger?customerId=xxx&page=1&pageSize=20
  async ledger(req, res) {
    const customerId = await this._resolveCustomerId(req, res)
    if (!customerId) return

    const { page = 1, pageSize = 20, action } = req.query

    const query = req.db('points_ledger')
      .where({ customer_id: customerId })
      .modify(b => { if (action) b.where('action', action) })
      .orderBy('created_at', 'desc')

    const total = await query.clone().count('id as cnt').first()
    const rows  = await query
      .offset((Number(page) - 1) * Number(pageSize))
      .limit(Number(pageSize))
      .select('id','action','points','balance_after','expires_at',
               'operator_role','remark','source_type','source_id','created_at')

    return res.json({
      code: 'OK',
      data: { list: rows, total: Number(total.cnt), page: Number(page), pageSize: Number(pageSize) },
    })
  }

  // ─── 管理员手动调整积分 ──────────────────────────────────────
  // POST /api/points/adjust
  // body: { customer_id, points, remark }
  async adjust(req, res) {
    const { customer_id, points, remark } = req.body

    if (!customer_id)          return res.status(400).json({ code: 'INVALID_PARAM', message: '请指定老人' })
    if (!points || points === 0) return res.status(400).json({ code: 'INVALID_PARAM', message: '积分不能为 0' })
    if (!remark?.trim())       return res.status(400).json({ code: 'INVALID_PARAM', message: '请填写调整原因' })
    if (Math.abs(points) > 10000) return res.status(400).json({ code: 'INVALID_PARAM', message: '单次调整不能超过 10000 积分' })

    const customer = await req.db('customers').where({ id: customer_id, is_active: 1, is_cancelled: 0 }).first()
    if (!customer) return res.status(404).json({ code: 'NOT_FOUND', message: '老人不存在' })

    const svc = new PointsService(req.db)
    try {
      const result = await svc.adminAdjust({
        customerId: customer_id,
        points:     Number(points),
        adminId:    req.user.id,
        remark:     remark.trim(),
      })
      return res.json({
        code: 'OK',
        data: { ledger_id: result.ledgerId, balance_after: result.balanceAfter },
        message: `积分调整成功，当前余额 ${result.balanceAfter}`,
      })
    } catch (err) {
      if (err.code === 'INSUFFICIENT_POINTS') {
        return res.status(400).json({ code: 'INSUFFICIENT_POINTS', message: err.message })
      }
      throw err
    }
  }

  // ─── 积分全局配置查询 ─────────────────────────────────────────
  // GET /api/points/config
  async getConfig(req, res) {
    const config = await req.db('points_config').first()
    return res.json({ code: 'OK', data: config })
  }

  // ─── 积分全局配置更新（admin）────────────────────────────────
  // PUT /api/points/config
  async updateConfig(req, res) {
    const { validity_days, remind_threshold } = req.body

    const updates = { updated_by: req.user.id }
    if (validity_days !== undefined)   updates.validity_days    = Number(validity_days)
    if (remind_threshold !== undefined) updates.remind_threshold = Number(remind_threshold)

    await req.db('points_config').update(updates)
    return res.json({ code: 'OK', message: '积分配置已更新' })
  }

  // ─── 内部：解析 customerId（老人用自己的，其他传参）──────────
  async _resolveCustomerId(req, res) {
    if (req.user.role === 'elder') {
      const c = await req.db('customers').where({ user_id: req.user.id, is_cancelled: 0 }).first('id')
      if (!c) { res.status(404).json({ code: 'NOT_FOUND', message: '老人档案不存在' }); return null }
      return c.id
    }

    const { customerId } = req.query
    if (!customerId) { res.status(400).json({ code: 'INVALID_PARAM', message: '请指定老人' }); return null }

    // 管家权限检查
    if (req.user.role === 'caregiver') {
      const ok = await req.db('caregiver_assignments')
        .where({ caregiver_id: req.user.id, customer_id: customerId }).first()
      if (!ok) { res.status(403).json({ code: 'FORBIDDEN', message: '无权查询该老人积分' }); return null }
    }

    // 家属权限检查
    if (req.user.role === 'family') {
      const ok = await req.db('family_authorizations')
        .where({ family_user_id: req.user.id, customer_id: customerId, status: 'approved', can_view_points: 1 }).first()
      if (!ok) { res.status(403).json({ code: 'FORBIDDEN', message: '无权查询该老人积分' }); return null }
    }

    return customerId
  }
}

module.exports = new PointsController()
