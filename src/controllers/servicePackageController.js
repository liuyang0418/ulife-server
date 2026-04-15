// src/controllers/servicePackageController.js
// 服务套餐管理（管理员维护 + 购买激活）

const { v4: uuidv4 } = require('uuid')
const dayjs          = require('dayjs')

class ServicePackageController {

  // ─── 套餐列表（公开）────────────────────────────────────────
  async list(req, res) {
    const { active } = req.query
    const rows = await req.db('service_packages')
      .modify(b => { if (active !== undefined) b.where('is_active', active === 'true' ? 1 : 0) })
      .where('is_active', 1)
      .orderBy('price_fen')
      .select('id','name','price_fen','description','valid_days','includes_l1','is_active','created_at')

    return res.json({ code: 'OK', data: rows })
  }

  // ─── 创建套餐（admin）────────────────────────────────────────
  async create(req, res) {
    const { name, price_fen, description, valid_days = 30, includes_l1 = 1 } = req.body
    if (!name?.trim())  return res.status(400).json({ code: 'INVALID_PARAM', message: '套餐名称不能为空' })
    if (!price_fen || price_fen <= 0) return res.status(400).json({ code: 'INVALID_PARAM', message: '价格必须大于0' })

    const [id] = await req.db('service_packages').insert({
      name: name.trim(), price_fen, description: description?.trim() || null,
      valid_days, includes_l1: includes_l1 ? 1 : 0, is_active: 1, created_at: req.db.fn.now(),
    })
    return res.status(201).json({ code: 'OK', data: { id }, message: '套餐已创建' })
  }

  // ─── 更新套餐（admin）────────────────────────────────────────
  async update(req, res) {
    const { id } = req.params
    const { name, price_fen, description, valid_days, includes_l1, is_active } = req.body
    const updates = {}
    if (name !== undefined)        updates.name        = name.trim()
    if (price_fen !== undefined)   updates.price_fen   = Number(price_fen)
    if (description !== undefined) updates.description = description?.trim() || null
    if (valid_days !== undefined)  updates.valid_days  = Number(valid_days)
    if (includes_l1 !== undefined) updates.includes_l1 = includes_l1 ? 1 : 0
    if (is_active !== undefined)   updates.is_active   = is_active ? 1 : 0
    await req.db('service_packages').where({ id }).update(updates)
    return res.json({ code: 'OK', message: '套餐已更新' })
  }

  // ─── 手动创建购买记录（admin 代老人购买/免费开通）──────────
  // POST /api/service-packages/:id/purchase
  // body: { customer_id, pay_channel: 'manual'|'free' }
  async purchase(req, res) {
    const { id: packageId } = req.params
    const { customer_id, pay_channel = 'manual' } = req.body

    if (!customer_id) return res.status(400).json({ code: 'INVALID_PARAM', message: '请指定老人' })

    const pkg = await req.db('service_packages').where({ id: packageId, is_active: 1 }).first()
    if (!pkg) return res.status(404).json({ code: 'NOT_FOUND', message: '套餐不存在' })

    const customer = await req.db('customers').where({ id: customer_id, is_cancelled: 0 }).first()
    if (!customer) return res.status(404).json({ code: 'NOT_FOUND', message: '老人不存在' })

    const orderNo   = `ORD-${Date.now()}-${uuidv4().slice(0, 8).toUpperCase()}`
    const paidAt    = dayjs().format('YYYY-MM-DD HH:mm:ss')
    const expiresAt = dayjs().add(pkg.valid_days, 'day').format('YYYY-MM-DD HH:mm:ss')

    const [orderId] = await req.db('customer_packages').insert({
      customer_id,
      package_id:   packageId,
      order_no:     orderNo,
      amount_fen:   pkg.price_fen,
      pay_status:   'paid',
      pay_channel,
      paid_at:      paidAt,
      expires_at:   expiresAt,
      activated_by: req.user.id,
      created_at:   req.db.fn.now(),
    })

    return res.status(201).json({
      code: 'OK',
      data: { order_id: orderId, order_no: orderNo, expires_at: expiresAt },
      message: '套餐已开通',
    })
  }

  // ─── 查询老人的套餐记录 ──────────────────────────────────────
  // GET /api/service-packages/orders?customer_id=xxx
  async orders(req, res) {
    const { customer_id, page = 1, pageSize = 10 } = req.query
    if (!customer_id) return res.status(400).json({ code: 'INVALID_PARAM', message: '请指定老人' })

    const rows = await req.db('customer_packages as cp')
      .join('service_packages as sp', 'sp.id', 'cp.package_id')
      .where('cp.customer_id', customer_id)
      .orderBy('cp.created_at', 'desc')
      .offset((Number(page) - 1) * Number(pageSize)).limit(Number(pageSize))
      .select(
        'cp.id','cp.order_no','sp.name as package_name','sp.valid_days',
        'cp.amount_fen','cp.pay_status','cp.pay_channel',
        'cp.paid_at','cp.expires_at','cp.created_at'
      )

    // 判断当前是否有效套餐
    const active = await req.db('customer_packages')
      .where({ customer_id, pay_status: 'paid' })
      .where('expires_at', '>', req.db.fn.now())
      .orderBy('expires_at', 'desc')
      .first('expires_at')

    return res.json({
      code: 'OK',
      data: { list: rows, active_until: active?.expires_at || null },
    })
  }
}

module.exports = new ServicePackageController()
