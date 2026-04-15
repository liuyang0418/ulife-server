// src/controllers/mallController.js
// 积分商城：商品管理 + 兑换 + 核销

const { v4: uuidv4 } = require('uuid')
const dayjs          = require('dayjs')
const PointsService  = require('../services/pointsService')

class MallController {

  // ─── 商品列表（老人/家属可见）────────────────────────────────
  // GET /api/mall/products?category=xxx
  async listProducts(req, res) {
    const { category, page = 1, pageSize = 20 } = req.query
    const query = req.db('mall_products')
      .where({ is_active: 1 })
      .modify(b => { if (category) b.where('category', category) })
      .orderBy('sort_order').orderBy('id')

    const total = await query.clone().count('id as cnt').first()
    const rows  = await query
      .offset((Number(page) - 1) * Number(pageSize)).limit(Number(pageSize))
      .select('id','name','image_url','description','points_price','stock','valid_days','category','sort_order')

    return res.json({
      code: 'OK',
      data: { list: rows, total: Number(total.cnt), page: Number(page), pageSize: Number(pageSize) },
    })
  }

  // ─── 创建商品（admin）────────────────────────────────────────
  // POST /api/mall/products
  async createProduct(req, res) {
    const { name, image_url, description, points_price, stock = -1, valid_days, category = 'general', sort_order = 0 } = req.body
    if (!name?.trim())    return res.status(400).json({ code: 'INVALID_PARAM', message: '商品名称不能为空' })
    if (!points_price || points_price <= 0) return res.status(400).json({ code: 'INVALID_PARAM', message: '积分价格必须大于0' })

    const [id] = await req.db('mall_products').insert({
      name: name.trim(), image_url: image_url || null, description: description?.trim() || null,
      points_price, stock, valid_days: valid_days || null, category, sort_order,
      is_active: 1, created_by: req.user.id, created_at: req.db.fn.now(),
    })
    return res.status(201).json({ code: 'OK', data: { id }, message: '商品已创建' })
  }

  // ─── 更新商品（admin）────────────────────────────────────────
  // PUT /api/mall/products/:id
  async updateProduct(req, res) {
    const { id } = req.params
    const { name, image_url, description, points_price, stock, valid_days, category, sort_order, is_active } = req.body
    const updates = { updated_at: req.db.fn.now() }
    if (name !== undefined)         updates.name         = name.trim()
    if (image_url !== undefined)    updates.image_url    = image_url || null
    if (description !== undefined)  updates.description  = description?.trim() || null
    if (points_price !== undefined) updates.points_price = Number(points_price)
    if (stock !== undefined)        updates.stock        = Number(stock)
    if (valid_days !== undefined)   updates.valid_days   = valid_days || null
    if (category !== undefined)     updates.category     = category
    if (sort_order !== undefined)   updates.sort_order   = Number(sort_order)
    if (is_active !== undefined)    updates.is_active    = is_active ? 1 : 0

    await req.db('mall_products').where({ id }).update(updates)
    return res.json({ code: 'OK', message: '商品已更新' })
  }

  // ─── 兑换商品（老人端）──────────────────────────────────────
  // POST /api/mall/exchange
  // body: { product_id }
  async exchange(req, res) {
    // 找老人 customerId
    const customer = await req.db('customers').where({ user_id: req.user.id, is_cancelled: 0 }).first()
    if (!customer) return res.status(404).json({ code: 'NOT_FOUND', message: '老人档案不存在' })

    const { product_id } = req.body
    if (!product_id) return res.status(400).json({ code: 'INVALID_PARAM', message: '请选择商品' })

    const product = await req.db('mall_products').where({ id: product_id, is_active: 1 }).first()
    if (!product) return res.status(404).json({ code: 'NOT_FOUND', message: '商品不存在' })

    // 库存检查（-1 表示无限）
    if (product.stock !== -1 && product.stock <= 0) {
      return res.status(400).json({ code: 'OUT_OF_STOCK', message: '商品库存不足' })
    }

    try {
      const result = await req.db.transaction(async trx => {
        // 扣积分（内部检查余额）
        const svc = new PointsService(trx)

        // 先插入 exchange_log 获取 ID（用作 sourceId）
        const verifyCode = uuidv4().replace(/-/g, '').slice(0, 12).toUpperCase()
        const expiresAt  = product.valid_days
          ? dayjs().add(product.valid_days, 'day').format('YYYY-MM-DD HH:mm:ss')
          : dayjs().add(30, 'day').format('YYYY-MM-DD HH:mm:ss')

        const [logId] = await trx('exchange_log').insert({
          customer_id:      customer.id,
          product_id,
          points_deducted:  product.points_price,
          ledger_id:        0,  // 先占位，后更新
          verify_code:      verifyCode,
          qr_content:       `ULIFE_EXCHANGE:${verifyCode}`,
          status:           'pending',
          expires_at:       expiresAt,
          created_at:       trx.fn.now(),
        })

        const { ledgerId, balanceAfter } = await svc.change({
          customerId:   customer.id,
          action:       'redeem',
          points:       -product.points_price,
          operatorRole: 'system',
          remark:       `兑换商品：${product.name}`,
          sourceType:   'exchange_log',
          sourceId:     logId,
        }, trx)

        // 更新 ledger_id
        await trx('exchange_log').where({ id: logId }).update({ ledger_id: ledgerId })

        // 扣库存
        if (product.stock !== -1) {
          await trx('mall_products').where({ id: product_id }).decrement('stock', 1)
        }

        return { logId, verifyCode, expiresAt, balanceAfter }
      })

      return res.status(201).json({
        code: 'OK',
        data: {
          exchange_id:  result.logId,
          verify_code:  result.verifyCode,
          qr_content:   `ULIFE_EXCHANGE:${result.verifyCode}`,
          expires_at:   result.expiresAt,
          balance_after: result.balanceAfter,
        },
        message: '兑换成功，请保存核销码',
      })
    } catch (err) {
      if (err.code === 'INSUFFICIENT_POINTS') {
        return res.status(400).json({ code: 'INSUFFICIENT_POINTS', message: err.message })
      }
      throw err
    }
  }

  // ─── 老人查看自己的兑换记录 ───────────────────────────────────
  // GET /api/mall/my-exchanges
  async myExchanges(req, res) {
    const customer = await req.db('customers').where({ user_id: req.user.id }).first('id')
    if (!customer) return res.json({ code: 'OK', data: { list: [], total: 0 } })

    const { page = 1, pageSize = 20 } = req.query
    const rows = await req.db('exchange_log as el')
      .join('mall_products as mp', 'mp.id', 'el.product_id')
      .where('el.customer_id', customer.id)
      .orderBy('el.created_at', 'desc')
      .offset((Number(page) - 1) * Number(pageSize)).limit(Number(pageSize))
      .select('el.id','mp.name as product_name','mp.image_url','el.points_deducted',
               'el.verify_code','el.status','el.expires_at','el.verified_at','el.created_at')

    const total = await req.db('exchange_log').where({ customer_id: customer.id }).count('id as cnt').first()
    return res.json({ code: 'OK', data: { list: rows, total: Number(total.cnt) } })
  }

  // ─── 管理员/管家核销兑换码 ───────────────────────────────────
  // POST /api/mall/verify
  // body: { verify_code }
  async verify(req, res) {
    const { verify_code } = req.body
    if (!verify_code) return res.status(400).json({ code: 'INVALID_PARAM', message: '请提供核销码' })

    const log = await req.db('exchange_log as el')
      .join('mall_products as mp', 'mp.id', 'el.product_id')
      .join('customers as c', 'c.id', 'el.customer_id')
      .where('el.verify_code', verify_code.toUpperCase().trim())
      .select('el.*', 'mp.name as product_name', 'c.name as customer_name')
      .first()

    if (!log) return res.status(404).json({ code: 'NOT_FOUND', message: '核销码不存在' })
    if (log.status === 'verified') return res.status(400).json({ code: 'ALREADY_VERIFIED', message: '该码已核销' })
    if (log.status === 'expired' || (log.expires_at && dayjs().isAfter(dayjs(log.expires_at)))) {
      await req.db('exchange_log').where({ id: log.id }).update({ status: 'expired' })
      return res.status(400).json({ code: 'EXPIRED', message: '核销码已过期' })
    }

    await req.db('exchange_log').where({ id: log.id }).update({
      status:      'verified',
      verified_by: req.user.id,
      verified_at: req.db.fn.now(),
    })

    return res.json({
      code: 'OK',
      data: {
        product_name:   log.product_name,
        customer_name:  log.customer_name,
        points_deducted: log.points_deducted,
      },
      message: '核销成功',
    })
  }

  // ─── 管理员查看全部兑换记录 ──────────────────────────────────
  // GET /api/mall/exchanges?status=pending
  async listExchanges(req, res) {
    const { status, page = 1, pageSize = 20 } = req.query
    const query = req.db('exchange_log as el')
      .join('mall_products as mp', 'mp.id', 'el.product_id')
      .join('customers as c', 'c.id', 'el.customer_id')
      .modify(b => { if (status) b.where('el.status', status) })
      .orderBy('el.created_at', 'desc')

    const total = await query.clone().count('el.id as cnt').first()
    const rows  = await query
      .offset((Number(page) - 1) * Number(pageSize)).limit(Number(pageSize))
      .select('el.id','c.name as customer_name','mp.name as product_name',
               'el.points_deducted','el.verify_code','el.status',
               'el.expires_at','el.verified_at','el.created_at')

    return res.json({ code: 'OK', data: { list: rows, total: Number(total.cnt) } })
  }
}

module.exports = new MallController()
