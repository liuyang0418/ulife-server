// src/controllers/familyController.js
// 家属授权：申请绑定、管理员审批、家属端数据访问

const MessageService = require('../services/messageService')

class FamilyController {

  // ─── 按手机号查找老人（家属端申请绑定前用）──────────────────
  // GET /api/family/find-elder?phone=xxx
  async findElderByPhone(req, res) {
    const { phone } = req.query
    if (!phone) return res.status(400).json({ code: 'INVALID_PARAM', message: '请提供手机号' })

    const customer = await req.db('customers as c')
      .join('users as u', 'u.id', 'c.user_id')
      .where({ 'u.phone': phone, 'u.role': 'elder', 'c.is_cancelled': 0 })
      .select('c.id as customer_id', 'c.name', 'c.room_no', 'c.care_level')
      .first()

    if (!customer) return res.status(404).json({ code: 'NOT_FOUND', message: '未找到该手机号对应的长辈' })
    return res.json({ code: 'OK', data: customer })
  }

  // ─── 家属申请绑定老人 ────────────────────────────────────────
  // POST /api/family/apply
  // body: { customer_id, remark? }
  async apply(req, res) {
    const { customer_id, remark } = req.body
    if (!customer_id) return res.status(400).json({ code: 'INVALID_PARAM', message: '请指定老人' })

    const customer = await req.db('customers').where({ id: customer_id, is_cancelled: 0 }).first()
    if (!customer) return res.status(404).json({ code: 'NOT_FOUND', message: '老人不存在' })

    // 检查是否已申请或已绑定
    const existing = await req.db('family_authorizations')
      .where({ family_user_id: req.user.id, customer_id }).first()
    if (existing) {
      if (existing.status === 'approved') return res.status(409).json({ code: 'ALREADY_APPROVED', message: '您已绑定该老人' })
      if (existing.status === 'pending')  return res.status(409).json({ code: 'PENDING', message: '您的申请正在审核中' })
      // 已被撤销，允许重新申请
      await req.db('family_authorizations').where({ id: existing.id }).update({
        status: 'pending', applied_at: req.db.fn.now(),
        remark: remark?.trim() || null,
        approved_by: null, approved_at: null,
        revoked_by: null, revoked_at: null, revoke_reason: null,
      })
      return res.json({ code: 'OK', message: '已重新提交申请，等待管理员审核' })
    }

    await req.db('family_authorizations').insert({
      family_user_id: req.user.id,
      customer_id,
      status:         'pending',
      applied_at:     req.db.fn.now(),
      remark:         remark?.trim() || null,
      can_view_afi:       1, can_view_reports: 1,
      can_view_points:    1, can_view_tasks:   1, can_view_alerts: 1,
    })

    // 通知管理员
    const admins = await req.db('users').where({ role: 'admin', is_active: 1 }).select('id')
    if (admins.length > 0) {
      const msgSvc = new MessageService(req.db)
      await msgSvc.sendBatch(admins.map(a => ({ id: a.id, role: 'admin' })), {
        type:        'auth_apply',
        priority:    'normal',
        title:       '新的家属授权申请',
        content:     `用户 ${req.user.name || req.user.id} 申请绑定老人 ${customer.name}，请审核。`,
        actionUrl:   `/admin/family-auth`,
        actionLabel: '去审核',
        refType:     'family_auth',
      })
    }

    return res.status(201).json({ code: 'OK', message: '申请已提交，等待管理员审核' })
  }

  // ─── 查询我的授权列表（家属端）──────────────────────────────
  // GET /api/family/my-authorizations
  async myAuthorizations(req, res) {
    const rows = await req.db('family_authorizations as fa')
      .join('customers as c', 'c.id', 'fa.customer_id')
      .where({ 'fa.family_user_id': req.user.id })
      .orderBy('fa.applied_at', 'desc')
      .select(
        'fa.id','fa.status','fa.applied_at','fa.approved_at','fa.revoked_at',
        'fa.can_view_afi','fa.can_view_reports','fa.can_view_points','fa.can_view_tasks','fa.can_view_alerts',
        'c.id as customer_id',
        'c.name','c.gender','c.birth_date','c.room_no','c.avatar',
        'c.care_level','c.alert_level','c.afi_critical_value'
      )

    // 为每个已批准的老人附上最新 AFI 分
    const approvedRows = rows.filter(r => r.status === 'approved')
    if (approvedRows.length > 0) {
      const ids = approvedRows.map(r => r.customer_id)
      const afiRows = await req.db('afi_records')
        .whereIn('customer_id', ids)
        .where({ is_anomaly: 0, is_deleted: 0 })
        .orderBy('record_date', 'desc')
        .select('customer_id', 'afi_value')
      const afiMap = {}
      for (const a of afiRows) {
        if (!afiMap[a.customer_id]) afiMap[a.customer_id] = a.afi_value
      }
      for (const r of rows) {
        r.latest_afi_score = afiMap[r.customer_id] ?? null
      }
    }

    return res.json({ code: 'OK', data: rows })
  }

  // ─── 家属查看绑定老人的 AFI 报告 ─────────────────────────────
  // GET /api/family/elders/:customerId/afi-report
  async elderAfi(req, res) {
    const { customerId } = req.params
    const auth = await this._checkFamilyAuth(req, res, customerId, 'can_view_afi')
    if (!auth) return

    // 复用 afiReportController 的逻辑（直接查数据库）
    const records = await req.db('afi_records')
      .where({ customer_id: customerId, is_anomaly: 0, is_deleted: 0 })
      .orderBy('record_date', 'desc').limit(30)
      .select('afi_value', 'record_date', 'days_from_start')

    const analysis = await req.db('afi_analysis_cache').where({ customer_id: customerId }).first()
    const customer = await req.db('customers').where({ id: customerId }).first('name','alert_level','afi_critical_value')

    return res.json({
      code: 'OK',
      data: {
        customer,
        current_score: records.length ? Number(records[0].afi_value) : null,
        risk_level:    analysis?.risk_level || 'STABLE',
        slope:         analysis?.slope ? Number(analysis.slope) : null,
        forecast_30d:  analysis?.forecast_30d ? Number(analysis.forecast_30d) : null,
        recent_records: records,
      },
    })
  }

  // ─── 家属查看老人积分余额 ─────────────────────────────────────
  // GET /api/family/elders/:customerId/points
  async elderPoints(req, res) {
    const { customerId } = req.params
    const auth = await this._checkFamilyAuth(req, res, customerId, 'can_view_points')
    if (!auth) return

    const balance = await req.db('points_balance').where({ customer_id: customerId }).first()
    return res.json({ code: 'OK', data: balance || { current_balance: 0, total_earned: 0 } })
  }

  // ─── 家属查看老人任务情况 ─────────────────────────────────────
  // GET /api/family/elders/:customerId/tasks
  async elderTasks(req, res) {
    const { customerId } = req.params
    const auth = await this._checkFamilyAuth(req, res, customerId, 'can_view_tasks')
    if (!auth) return

    const tasks = await req.db('customer_task_assignments as cta')
      .join('task_library as tl', 'tl.id', 'cta.task_id')
      .where({ 'cta.customer_id': customerId, 'cta.status': 'active' })
      .select('tl.name','tl.category','tl.points_value','cta.frequency','cta.priority')

    // 最近7天打卡记录
    const checkins = await req.db('task_videos')
      .where({ customer_id: customerId, is_deleted: 0 })
      .where('task_date', '>=', req.db.raw('DATE_SUB(CURDATE(), INTERVAL 7 DAY)'))
      .select('task_id','task_date','status','points_awarded')

    return res.json({ code: 'OK', data: { tasks, recent_checkins: checkins } })
  }

  // ─── 管理员：查看所有待审核申请 ──────────────────────────────
  // GET /api/family/applications?status=pending
  async listApplications(req, res) {
    const { status = 'pending', page = 1, pageSize = 20 } = req.query
    const rows = await req.db('family_authorizations as fa')
      .join('users as u', 'u.id', 'fa.family_user_id')
      .join('customers as c', 'c.id', 'fa.customer_id')
      .modify(b => { if (status) b.where('fa.status', status) })
      .orderBy('fa.applied_at', 'desc')
      .offset((Number(page) - 1) * Number(pageSize)).limit(Number(pageSize))
      .select(
        'fa.id','fa.status','fa.applied_at','fa.remark',
        'u.id as family_user_id','u.name as family_name','u.phone as family_phone',
        'c.id as customer_id','c.name as customer_name'
      )
    return res.json({ code: 'OK', data: rows })
  }

  // ─── 管理员审批申请 ───────────────────────────────────────────
  // PATCH /api/family/applications/:id
  // body: { action: 'approve'|'revoke', revoke_reason?, permissions? }
  async review(req, res) {
    const { id }  = req.params
    const { action, revoke_reason, permissions } = req.body

    if (!['approve', 'revoke'].includes(action)) {
      return res.status(400).json({ code: 'INVALID_PARAM', message: 'action 只能为 approve 或 revoke' })
    }

    const fa = await req.db('family_authorizations').where({ id }).first()
    if (!fa) return res.status(404).json({ code: 'NOT_FOUND', message: '申请不存在' })

    const updates = {}
    const msgSvc  = new MessageService(req.db)

    if (action === 'approve') {
      Object.assign(updates, {
        status:      'approved',
        approved_by: req.user.id,
        approved_at: req.db.fn.now(),
      })
      // 可选权限覆盖
      if (permissions) {
        if (permissions.can_view_afi     !== undefined) updates.can_view_afi     = permissions.can_view_afi ? 1 : 0
        if (permissions.can_view_reports !== undefined) updates.can_view_reports = permissions.can_view_reports ? 1 : 0
        if (permissions.can_view_points  !== undefined) updates.can_view_points  = permissions.can_view_points ? 1 : 0
        if (permissions.can_view_tasks   !== undefined) updates.can_view_tasks   = permissions.can_view_tasks ? 1 : 0
        if (permissions.can_view_alerts  !== undefined) updates.can_view_alerts  = permissions.can_view_alerts ? 1 : 0
      }
      await msgSvc.send({
        receiverId: fa.family_user_id, receiverRole: 'family',
        type: 'auth_result', priority: 'high',
        title: '授权申请已通过', content: '您的家属绑定申请已通过审核，现在可以查看老人的健康数据了。',
        actionUrl: '/family/home', actionLabel: '立即查看',
      })
    } else {
      Object.assign(updates, {
        status:       'revoked',
        revoked_by:   req.user.id,
        revoked_at:   req.db.fn.now(),
        revoke_reason: revoke_reason?.trim() || null,
      })
      await msgSvc.send({
        receiverId: fa.family_user_id, receiverRole: 'family',
        type: 'auth_result', priority: 'normal',
        title: '授权申请未通过', content: `您的家属绑定申请未通过审核${revoke_reason ? '，原因：' + revoke_reason : ''}。`,
      })
    }

    await req.db('family_authorizations').where({ id }).update(updates)
    return res.json({ code: 'OK', message: action === 'approve' ? '已批准' : '已撤销' })
  }

  // ─── 内部：家属权限检查 ───────────────────────────────────────
  async _checkFamilyAuth(req, res, customerId, permField) {
    const auth = await req.db('family_authorizations')
      .where({ family_user_id: req.user.id, customer_id: customerId, status: 'approved' })
      .first()
    if (!auth || !auth[permField]) {
      res.status(403).json({ code: 'FORBIDDEN', message: '无权查看该老人数据' })
      return null
    }
    return auth
  }
}

module.exports = new FamilyController()
