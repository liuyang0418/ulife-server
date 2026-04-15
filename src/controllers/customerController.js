// src/controllers/customerController.js
// 老人档案管理（管理员 + 管家端）

const dayjs = require('dayjs')

class CustomerController {

  // ─── 列表（管家只看自己负责的；admin看全部）────────────────────
  async list(req, res) {
    const { role, id: userId } = req.user
    const {
      page = 1, pageSize = 20,
      keyword, alert_level, is_active,
    } = req.query

    let query = req.db('customers as c')
      .join('users as u', 'u.id', 'c.user_id')
      .where('c.is_cancelled', 0)
      .modify(b => {
        if (keyword) {
          b.where(inner =>
            inner.where('c.name', 'like', `%${keyword}%`)
                 .orWhere('c.phone', 'like', `%${keyword}%`)
                 .orWhere('c.room_no', 'like', `%${keyword}%`)
          )
        }
        if (alert_level)            b.where('c.alert_level', alert_level)
        if (is_active !== undefined) b.where('c.is_active', is_active === 'true' ? 1 : 0)
      })

    // 管家只能查看被分配的老人
    if (role === 'caregiver') {
      query = query
        .join('caregiver_assignments as ca', function () {
          this.on('ca.customer_id', 'c.id').andOn('ca.caregiver_id', req.db.raw('?', [userId]))
        })
    }

    const total = await query.clone().count('c.id as cnt').first()

    const rows = await query
      .offset((Number(page) - 1) * Number(pageSize))
      .limit(Number(pageSize))
      .orderBy('c.alert_level', 'desc')   // 红色预警排前
      .orderBy('c.id', 'asc')
      .select(
        'c.id', 'c.user_id', 'c.name', 'c.phone', 'c.room_no',
        'c.birth_date', 'c.gender', 'c.avatar',
        'c.emergency_contact', 'c.emergency_phone',
        'c.joined_date', 'c.afi_critical_value', 'c.alert_level',
        'c.is_active', 'c.created_at'
      )

    return res.json({
      code: 'OK',
      data: { list: rows, total: Number(total.cnt), page: Number(page), pageSize: Number(pageSize) },
    })
  }

  // ─── 详情 ────────────────────────────────────────────────────
  async detail(req, res) {
    const { id } = req.params

    await this._checkAccess(req, id)

    const customer = await req.db('customers as c')
      .join('users as u', 'u.id', 'c.user_id')
      .where({ 'c.id': id, 'c.is_cancelled': 0 })
      .select(
        'c.*',
        'u.phone as login_phone', 'u.wechat_openid', 'u.last_login_at'
      )
      .first()

    if (!customer) return res.status(404).json({ code: 'NOT_FOUND', message: '老人不存在' })

    // 附上负责管家列表
    const caregivers = await req.db('caregiver_assignments as ca')
      .join('users as u', 'u.id', 'ca.caregiver_id')
      .where('ca.customer_id', id)
      .select('u.id', 'u.name', 'u.phone', 'u.avatar', 'ca.assignment_type', 'ca.assigned_at')

    return res.json({ code: 'OK', data: { ...customer, caregivers } })
  }

  // ─── 创建老人档案（仅 admin）────────────────────────────────
  async create(req, res) {
    const {
      name, phone, password, room_no, birth_date, gender = 'unknown',
      emergency_contact, emergency_phone, joined_date,
      afi_critical_value = 60.00,
    } = req.body
    const adminId = req.user.id

    if (!name?.trim())    return res.status(400).json({ code: 'INVALID_PARAM', message: '姓名不能为空' })
    if (!joined_date)     return res.status(400).json({ code: 'INVALID_PARAM', message: '入住日期不能为空' })

    // 若提供手机号则检查重复
    if (phone) {
      const exists = await req.db('users').where({ phone }).first()
      if (exists) return res.status(409).json({ code: 'PHONE_EXISTS', message: '该手机号已注册' })
    }

    try {
      let userId

      await req.db.transaction(async trx => {
        // 创建 users 记录
        const bcrypt = require('bcryptjs')
        const password_hash = password
          ? await bcrypt.hash(password, 10)
          : null

        ;[userId] = await trx('users').insert({
          name:          name.trim(),
          phone:         phone || null,
          password_hash,
          role:          'elder',
          is_active:     1,
          created_at:    trx.fn.now(),
        })

        // 创建 customers 档案
        await trx('customers').insert({
          user_id:           userId,
          name:              name.trim(),
          phone:             phone || null,
          room_no:           room_no?.trim() || null,
          birth_date:        birth_date || null,
          gender,
          emergency_contact: emergency_contact?.trim() || null,
          emergency_phone:   emergency_phone?.trim() || null,
          joined_date,
          afi_critical_value,
          created_at:        trx.fn.now(),
        })
      })

      const customer = await req.db('customers').where({ user_id: userId }).first()

      return res.status(201).json({
        code: 'OK',
        data: { id: customer.id, user_id: userId },
        message: '老人档案已创建',
      })
    } catch (err) {
      return res.status(500).json({ code: 'SERVER_ERROR', message: err.message })
    }
  }

  // ─── 更新档案（admin / 负责管家）───────────────────────────
  async update(req, res) {
    const { id } = req.params
    const {
      name, room_no, birth_date, gender, avatar,
      emergency_contact, emergency_phone,
      joined_date, afi_critical_value, is_active,
    } = req.body

    await this._checkAccess(req, id)

    const customer = await req.db('customers').where({ id, is_cancelled: 0 }).first()
    if (!customer) return res.status(404).json({ code: 'NOT_FOUND', message: '老人不存在' })

    const updates = {}
    if (name !== undefined)              updates.name              = name.trim()
    if (room_no !== undefined)           updates.room_no           = room_no?.trim() || null
    if (birth_date !== undefined)        updates.birth_date        = birth_date || null
    if (gender !== undefined)            updates.gender            = gender
    if (avatar !== undefined)            updates.avatar            = avatar || null
    if (emergency_contact !== undefined) updates.emergency_contact = emergency_contact?.trim() || null
    if (emergency_phone !== undefined)   updates.emergency_phone   = emergency_phone?.trim() || null
    if (joined_date !== undefined)       updates.joined_date       = joined_date
    if (afi_critical_value !== undefined) updates.afi_critical_value = Number(afi_critical_value)
    if (is_active !== undefined)         updates.is_active         = is_active ? 1 : 0

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ code: 'INVALID_PARAM', message: '没有任何字段需要更新' })
    }

    await req.db('customers').where({ id }).update(updates)

    // 同步 users.name（若修改了姓名）
    if (updates.name) {
      await req.db('users').where({ id: customer.user_id }).update({ name: updates.name })
    }

    return res.json({ code: 'OK', message: '档案已更新' })
  }

  // ─── 注销（软删除，仅 admin）────────────────────────────────
  async cancel(req, res) {
    const { id }    = req.params
    const { reason } = req.body

    const customer = await req.db('customers').where({ id, is_cancelled: 0 }).first()
    if (!customer) return res.status(404).json({ code: 'NOT_FOUND', message: '老人不存在或已注销' })

    await req.db.transaction(async trx => {
      await trx('customers').where({ id }).update({ is_cancelled: 1, is_active: 0 })
      await trx('users').where({ id: customer.user_id }).update({ is_active: 0 })
    })

    return res.json({ code: 'OK', message: '老人档案已注销' })
  }

  // ─── 分配管家（admin）────────────────────────────────────
  async assignCaregiver(req, res) {
    const { id }                              = req.params  // customer_id
    const { caregiver_id, assignment_type = 'primary' } = req.body

    if (!caregiver_id) return res.status(400).json({ code: 'INVALID_PARAM', message: '请指定管家' })
    if (!['primary', 'co'].includes(assignment_type)) {
      return res.status(400).json({ code: 'INVALID_PARAM', message: 'assignment_type 只能为 primary 或 co' })
    }

    const caregiver = await req.db('users').where({ id: caregiver_id, role: 'caregiver', is_active: 1 }).first()
    if (!caregiver) return res.status(404).json({ code: 'NOT_FOUND', message: '管家不存在' })

    await req.db('caregiver_assignments')
      .insert({ caregiver_id, customer_id: id, assignment_type })
      .onConflict(['caregiver_id', 'customer_id'])
      .merge({ assignment_type })

    return res.json({ code: 'OK', message: '管家分配成功' })
  }

  // ─── 取消管家分配（admin）────────────────────────────────
  async removeCaregiver(req, res) {
    const { id, caregiverId } = req.params
    await req.db('caregiver_assignments')
      .where({ customer_id: id, caregiver_id: caregiverId }).delete()
    return res.json({ code: 'OK', message: '已取消分配' })
  }

  // ─── 内部：权限检查（管家只能访问自己负责的老人）────────────
  async _checkAccess(req, customerId) {
    const { role, id: userId } = req.user
    if (role === 'admin') return  // admin 无限制

    const assignment = await req.db('caregiver_assignments')
      .where({ caregiver_id: userId, customer_id: customerId }).first()
    if (!assignment) {
      const err = new Error('您无权访问该老人的信息')
      err.status = 403
      err.code   = 'FORBIDDEN'
      throw err
    }
  }
}

module.exports = new CustomerController()
