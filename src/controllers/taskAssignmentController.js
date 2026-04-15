// src/controllers/taskAssignmentController.js
// 老人任务分配管理（管家查看/手动增减任务）

class TaskAssignmentController {

  // ─── 查询某老人的任务分配列表 ────────────────────────────────
  // GET /api/task-assignments?customer_id=xxx&status=active
  async list(req, res) {
    const { customer_id, status, page = 1, pageSize = 50 } = req.query
    if (!customer_id) return res.status(400).json({ code: 'INVALID_PARAM', message: '请指定老人' })

    await this._checkAccess(req, res, customer_id)

    const query = req.db('customer_task_assignments as cta')
      .join('task_library as tl', 'tl.id', 'cta.task_id')
      .where('cta.customer_id', customer_id)
      .modify(b => { if (status) b.where('cta.status', status) })
      .orderBy('cta.priority').orderBy('cta.assigned_at', 'desc')

    const total = await query.clone().count('cta.id as cnt').first()
    const rows  = await query
      .offset((Number(page) - 1) * Number(pageSize)).limit(Number(pageSize))
      .select(
        'cta.id','cta.task_id','tl.name as task_name','tl.category',
        'tl.description','tl.video_guide','tl.points_value',
        'cta.source','cta.frequency','cta.priority','cta.status',
        'cta.assigned_at','cta.remove_reason'
      )

    return res.json({ code: 'OK', data: { list: rows, total: Number(total.cnt) } })
  }

  // ─── 手动添加任务 ────────────────────────────────────────────
  // POST /api/task-assignments
  // body: { customer_id, task_id, frequency, priority }
  async assign(req, res) {
    const { customer_id, task_id, frequency = 'daily', priority = 5 } = req.body
    if (!customer_id) return res.status(400).json({ code: 'INVALID_PARAM', message: '请指定老人' })
    if (!task_id)     return res.status(400).json({ code: 'INVALID_PARAM', message: '请选择任务' })

    await this._checkAccess(req, res, customer_id)

    const task = await req.db('task_library').where({ id: task_id, is_active: 1 }).first()
    if (!task) return res.status(404).json({ code: 'NOT_FOUND', message: '任务不存在' })

    await req.db('customer_task_assignments')
      .insert({
        customer_id, task_id,
        source:      'manual',
        frequency,
        priority:    Number(priority),
        status:      'active',
        assigned_by: req.user.id,
        assigned_at: req.db.fn.now(),
      })
      .onConflict(['customer_id', 'task_id'])
      .merge({ status: 'active', frequency, priority: Number(priority) })

    return res.json({ code: 'OK', message: '任务已分配' })
  }

  // ─── 调整任务状态（暂停/恢复/移除）────────────────────────────
  // PATCH /api/task-assignments/:id
  // body: { status, remove_reason }
  async updateStatus(req, res) {
    const { id }             = req.params
    const { status, remove_reason } = req.body

    if (!['active', 'paused', 'removed'].includes(status)) {
      return res.status(400).json({ code: 'INVALID_PARAM', message: 'status 只能为 active/paused/removed' })
    }
    if (status === 'removed' && !remove_reason?.trim()) {
      return res.status(400).json({ code: 'INVALID_PARAM', message: '移除任务请填写原因' })
    }

    const record = await req.db('customer_task_assignments').where({ id }).first()
    if (!record) return res.status(404).json({ code: 'NOT_FOUND', message: '分配记录不存在' })

    await this._checkAccess(req, res, record.customer_id)

    const updates = { status }
    if (status === 'removed') updates.remove_reason = remove_reason.trim()

    await req.db('customer_task_assignments').where({ id }).update(updates)
    return res.json({ code: 'OK', message: `任务已${status === 'active' ? '恢复' : status === 'paused' ? '暂停' : '移除'}` })
  }

  // ─── 内部：管家只能操作自己负责的老人 ──────────────────────────
  async _checkAccess(req, res, customerId) {
    if (req.user.role === 'admin') return
    const ok = await req.db('caregiver_assignments')
      .where({ caregiver_id: req.user.id, customer_id: customerId }).first()
    if (!ok) {
      res.status(403).json({ code: 'FORBIDDEN', message: '无权操作该老人的任务' })
      throw Object.assign(new Error('forbidden'), { handled: true })
    }
  }
}

module.exports = new TaskAssignmentController()
