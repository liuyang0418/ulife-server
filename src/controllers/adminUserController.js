// src/controllers/adminUserController.js
// 管理员：用户管理 + 管家邀请码 + 三剑客小组

const bcrypt  = require('bcryptjs')
const { v4: uuidv4 } = require('uuid')

class AdminUserController {

  // ─── 用户列表 ─────────────────────────────────────────────────
  // GET /api/admin/users?role=caregiver&keyword=xxx
  async listUsers(req, res) {
    const { role, keyword, is_active, page = 1, pageSize = 20 } = req.query
    const query = req.db('users')
      .modify(b => {
        if (role)      b.where('role', role)
        if (keyword)   b.where(inner => inner.where('name', 'like', `%${keyword}%`).orWhere('phone', 'like', `%${keyword}%`))
        if (is_active !== undefined) b.where('is_active', is_active === 'true' ? 1 : 0)
      })
      .orderBy('created_at', 'desc')

    const total = await query.clone().count('id as cnt').first()
    const rows  = await query
      .offset((Number(page) - 1) * Number(pageSize)).limit(Number(pageSize))
      .select('id','name','phone','role','avatar','is_active','last_login_at','created_at')

    return res.json({ code: 'OK', data: { list: rows, total: Number(total.cnt) } })
  }

  // ─── 创建管家账号（管理员专用）──────────────────────────────
  // POST /api/admin/users/caregiver
  // body: { name, phone, password }
  async createCaregiver(req, res) {
    const { name, phone, password } = req.body
    if (!name?.trim())  return res.status(400).json({ code: 'INVALID_PARAM', message: '姓名不能为空' })
    if (!phone)         return res.status(400).json({ code: 'INVALID_PARAM', message: '手机号不能为空' })
    if (!password)      return res.status(400).json({ code: 'INVALID_PARAM', message: '密码不能为空' })

    const exists = await req.db('users').where({ phone }).first()
    if (exists) return res.status(409).json({ code: 'PHONE_EXISTS', message: '该手机号已注册' })

    const password_hash = await bcrypt.hash(password, 10)
    const [id] = await req.db('users').insert({
      name: name.trim(), phone, password_hash, role: 'caregiver',
      is_active: 1, created_at: req.db.fn.now(),
    })

    return res.status(201).json({ code: 'OK', data: { id }, message: '管家账号已创建' })
  }

  // ─── 停用/启用账号（admin 不可被停用）────────────────────────
  // PATCH /api/admin/users/:id/status
  // body: { is_active: 0|1 }
  async setUserStatus(req, res) {
    const { id }       = req.params
    const { is_active } = req.body

    if (Number(id) === req.user.id) return res.status(400).json({ code: 'INVALID_PARAM', message: '不能停用自己' })

    const user = await req.db('users').where({ id }).first()
    if (!user) return res.status(404).json({ code: 'NOT_FOUND', message: '用户不存在' })
    if (user.role === 'admin' && !is_active) return res.status(403).json({ code: 'FORBIDDEN', message: '不可停用管理员账号' })

    await req.db('users').where({ id }).update({ is_active: is_active ? 1 : 0 })
    return res.json({ code: 'OK', message: is_active ? '账号已启用' : '账号已停用' })
  }

  // ─── 重置用户密码（admin）────────────────────────────────────
  // POST /api/admin/users/:id/reset-password
  // body: { new_password }
  async resetPassword(req, res) {
    const { id }          = req.params
    const { new_password } = req.body
    if (!new_password) return res.status(400).json({ code: 'INVALID_PARAM', message: '请提供新密码' })

    const hash = await bcrypt.hash(new_password, 10)
    await req.db('users').where({ id }).update({ password_hash: hash })
    return res.json({ code: 'OK', message: '密码已重置' })
  }

  // ─── 生成管家邀请码 ───────────────────────────────────────────
  // POST /api/admin/invite-codes/:caregiverId
  async generateInviteCode(req, res) {
    const { caregiverId } = req.params

    const caregiver = await req.db('users').where({ id: caregiverId, role: 'caregiver', is_active: 1 }).first()
    if (!caregiver) return res.status(404).json({ code: 'NOT_FOUND', message: '管家不存在' })

    // 生成8位唯一邀请码
    let code, tries = 0
    do {
      code = uuidv4().replace(/-/g, '').slice(0, 8).toUpperCase()
      tries++
    } while (tries < 10 && await req.db('caregiver_invite_codes').where({ code }).first())

    await req.db('caregiver_invite_codes')
      .insert({ caregiver_id: caregiverId, code, is_active: 1, created_at: req.db.fn.now() })
      .onConflict('caregiver_id').merge({ code, is_active: 1 })

    return res.json({ code: 'OK', data: { code }, message: '邀请码已生成' })
  }

  // ─── 查询管家邀请码 ───────────────────────────────────────────
  // GET /api/admin/invite-codes/:caregiverId
  async getInviteCode(req, res) {
    const { caregiverId } = req.params
    const inviteCode = await req.db('caregiver_invite_codes').where({ caregiver_id: caregiverId }).first()
    return res.json({ code: 'OK', data: inviteCode || null })
  }

  // ─── 通过邀请码注册后绑定管家（老人/家属用）─────────────────
  // POST /api/admin/invite-codes/bind
  // body: { code }
  // 用于老人注册后与管家建立关联
  async bindByInviteCode(req, res) {
    const { code } = req.body
    if (!code) return res.status(400).json({ code: 'INVALID_PARAM', message: '请提供邀请码' })

    const invite = await req.db('caregiver_invite_codes as cic')
      .join('users as u', 'u.id', 'cic.caregiver_id')
      .where({ 'cic.code': code.toUpperCase().trim(), 'cic.is_active': 1, 'u.is_active': 1 })
      .first('cic.caregiver_id', 'u.name as caregiver_name')

    if (!invite) return res.status(404).json({ code: 'NOT_FOUND', message: '邀请码无效或已失效' })

    // 老人才能绑定
    if (req.user.role !== 'elder') return res.status(403).json({ code: 'FORBIDDEN', message: '仅老人账号可使用邀请码' })

    const customer = await req.db('customers').where({ user_id: req.user.id }).first('id')
    if (!customer) return res.status(404).json({ code: 'NOT_FOUND', message: '老人档案不存在，请联系管理员' })

    await req.db('caregiver_assignments')
      .insert({ caregiver_id: invite.caregiver_id, customer_id: customer.id, assignment_type: 'primary' })
      .onConflict(['caregiver_id', 'customer_id']).ignore()

    // 更新邀请码使用次数
    await req.db('caregiver_invite_codes').where({ caregiver_id: invite.caregiver_id }).increment('total_used', 1)

    return res.json({ code: 'OK', message: `已绑定管家 ${invite.caregiver_name}` })
  }

  // ─── 三剑客小组：创建 ─────────────────────────────────────────
  // POST /api/admin/groups
  // body: { group_name, max_capacity? }
  async createGroup(req, res) {
    const { group_name, max_capacity = 600 } = req.body
    if (!group_name?.trim()) return res.status(400).json({ code: 'INVALID_PARAM', message: '小组名称不能为空' })

    const [id] = await req.db('caregiver_groups').insert({
      group_name: group_name.trim(), max_capacity,
      is_active: 1, created_by: req.user.id, created_at: req.db.fn.now(),
    })
    return res.status(201).json({ code: 'OK', data: { id }, message: '小组已创建' })
  }

  // ─── 三剑客小组：列表 ─────────────────────────────────────────
  async listGroups(req, res) {
    const groups = await req.db('caregiver_groups').where('is_active', 1).orderBy('id').select('*')

    const groupIds = groups.map(g => g.id)
    const members = groupIds.length
      ? await req.db('caregiver_group_members as cgm')
          .join('users as u', 'u.id', 'cgm.caregiver_id')
          .whereIn('cgm.group_id', groupIds)
          .select('cgm.group_id','u.id','u.name','u.phone','cgm.max_primary','cgm.joined_at')
      : []

    const memberMap = {}
    for (const m of members) {
      if (!memberMap[m.group_id]) memberMap[m.group_id] = []
      memberMap[m.group_id].push(m)
    }
    groups.forEach(g => { g.members = memberMap[g.id] || [] })

    return res.json({ code: 'OK', data: groups })
  }

  // ─── 三剑客小组：添加成员 ─────────────────────────────────────
  // POST /api/admin/groups/:id/members
  // body: { caregiver_id, max_primary? }
  async addGroupMember(req, res) {
    const { id }                      = req.params
    const { caregiver_id, max_primary = 200 } = req.body

    const caregiver = await req.db('users').where({ id: caregiver_id, role: 'caregiver' }).first()
    if (!caregiver) return res.status(404).json({ code: 'NOT_FOUND', message: '管家不存在' })

    // 检查管家是否已在其他小组
    const inOtherGroup = await req.db('caregiver_group_members')
      .where({ caregiver_id }).whereNot('group_id', id).first()
    if (inOtherGroup) return res.status(409).json({ code: 'IN_OTHER_GROUP', message: '该管家已在其他小组中' })

    await req.db('caregiver_group_members')
      .insert({ group_id: id, caregiver_id, max_primary, joined_at: req.db.fn.now() })
      .onConflict(['group_id', 'caregiver_id']).merge({ max_primary })

    return res.json({ code: 'OK', message: '成员已加入小组' })
  }

  // ─── 三剑客小组：移除成员 ─────────────────────────────────────
  // DELETE /api/admin/groups/:id/members/:caregiverId
  async removeGroupMember(req, res) {
    const { id, caregiverId } = req.params
    await req.db('caregiver_group_members').where({ group_id: id, caregiver_id: caregiverId }).delete()
    return res.json({ code: 'OK', message: '成员已移出小组' })
  }
}

module.exports = new AdminUserController()
