// src/controllers/taskCheckinController.js
// 视频打卡：老人端提交 + 管家/admin 审核 + 积分奖励

const PointsService  = require('../services/pointsService')
const MessageService = require('../services/messageService')
const dayjs          = require('dayjs')

class TaskCheckinController {

  // ─── 老人提交打卡（仅记录元数据，视频已由客户端直传 OSS）────
  // POST /api/task-checkins
  // body: { task_id, task_date, video_key, video_url, file_size, duration_sec, thumbnail_key? }
  async submit(req, res) {
    const { task_id, task_date, video_key, video_url, file_size, duration_sec, thumbnail_key } = req.body

    const customer = await req.db('customers').where({ user_id: req.user.id, is_cancelled: 0 }).first()
    if (!customer) return res.status(404).json({ code: 'NOT_FOUND', message: '老人档案不存在' })

    if (!task_id || !video_key || !video_url || !file_size || !duration_sec) {
      return res.status(400).json({ code: 'INVALID_PARAM', message: '缺少必要参数' })
    }
    const date = task_date || dayjs().format('YYYY-MM-DD')

    // 验证该任务已分配给该老人
    const assignment = await req.db('customer_task_assignments')
      .where({ customer_id: customer.id, task_id, status: 'active' }).first()
    if (!assignment) return res.status(403).json({ code: 'NOT_ASSIGNED', message: '该任务未分配给您' })

    // 检查今日是否已打卡
    const today = await req.db('task_videos')
      .where({ customer_id: customer.id, task_id, task_date: date, is_deleted: 0 })
      .whereNot('status', 'rejected')
      .first()
    if (today) return res.status(409).json({ code: 'ALREADY_SUBMITTED', message: '今日已提交该任务打卡' })

    // 视频时长校验
    const task = await req.db('task_library').where({ id: task_id }).first()
    if (task && (duration_sec < task.min_duration || duration_sec > task.max_duration)) {
      return res.status(400).json({
        code: 'INVALID_DURATION',
        message: `视频时长须在 ${task.min_duration}~${task.max_duration} 秒之间`,
      })
    }

    const [id] = await req.db('task_videos').insert({
      customer_id:   customer.id,
      task_id,
      task_date:     date,
      video_key,
      video_url,
      thumbnail_key: thumbnail_key || null,
      file_size,
      duration_sec,
      upload_ip:     req.ip,
      status:        'pending',
      uploaded_at:   req.db.fn.now(),
    })

    // 通知管家有新打卡待审核
    const caregivers = await req.db('caregiver_assignments as ca')
      .join('users as u', 'u.id', 'ca.caregiver_id')
      .where({ 'ca.customer_id': customer.id, 'u.is_active': 1 })
      .select('u.id', 'u.role')
    if (caregivers.length > 0) {
      const msgSvc = new MessageService(req.db)
      await msgSvc.sendBatch(caregivers.map(c => ({ id: c.id, role: 'caregiver' })), {
        type:        'video_pending',
        priority:    'normal',
        title:       `${customer.name} 提交了打卡视频`,
        content:     `${customer.name} 提交了"${task?.name || '任务'}"的打卡视频，请审核。`,
        actionUrl:   `/caregiver/checkins/${id}`,
        actionLabel: '去审核',
        refType:     'task_video',
        refId:       id,
      })
    }

    return res.status(201).json({ code: 'OK', data: { id }, message: '打卡提交成功，等待管家审核' })
  }

  // ─── 查询打卡记录（老人查自己，管家查负责老人）──────────────
  // GET /api/task-checkins?customer_id=xxx&date_from=&date_to=&status=
  async list(req, res) {
    const { customer_id, date_from, date_to, status, task_id, page = 1, pageSize = 20 } = req.query

    let resolvedCustomerId = customer_id
    if (req.user.role === 'elder') {
      const c = await req.db('customers').where({ user_id: req.user.id }).first('id')
      resolvedCustomerId = c?.id
    }
    if (!resolvedCustomerId) return res.status(400).json({ code: 'INVALID_PARAM', message: '请指定老人' })

    const query = req.db('task_videos as tv')
      .join('task_library as tl', 'tl.id', 'tv.task_id')
      .where({ 'tv.customer_id': resolvedCustomerId, 'tv.is_deleted': 0 })
      .modify(b => {
        if (status)    b.where('tv.status', status)
        if (task_id)   b.where('tv.task_id', task_id)
        if (date_from) b.where('tv.task_date', '>=', date_from)
        if (date_to)   b.where('tv.task_date', '<=', date_to)
      })
      .orderBy('tv.task_date', 'desc')

    const total = await query.clone().count('tv.id as cnt').first()
    const rows  = await query
      .offset((Number(page) - 1) * Number(pageSize)).limit(Number(pageSize))
      .select(
        'tv.id','tv.task_id','tl.name as task_name','tl.category',
        'tv.task_date','tv.video_url','tv.thumbnail_key','tv.duration_sec',
        'tv.status','tv.reject_reason','tv.points_awarded','tv.uploaded_at','tv.reviewed_at'
      )

    return res.json({ code: 'OK', data: { list: rows, total: Number(total.cnt) } })
  }

  // ─── 审核打卡（管家/admin）───────────────────────────────────
  // PATCH /api/task-checkins/:id/review
  // body: { action: 'approve'|'reject', reject_reason? }
  async review(req, res) {
    const { id }                    = req.params
    const { action, reject_reason } = req.body

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ code: 'INVALID_PARAM', message: 'action 只能为 approve 或 reject' })
    }
    if (action === 'reject' && !reject_reason?.trim()) {
      return res.status(400).json({ code: 'INVALID_PARAM', message: '驳回时请填写原因' })
    }

    const video = await req.db('task_videos').where({ id, is_deleted: 0 }).first()
    if (!video)              return res.status(404).json({ code: 'NOT_FOUND', message: '打卡记录不存在' })
    if (video.status !== 'pending') {
      return res.status(400).json({ code: 'ALREADY_REVIEWED', message: '该打卡已审核，不可重复操作' })
    }

    const msgSvc = new MessageService(req.db)

    if (action === 'approve') {
      // 查任务积分值
      const task = await req.db('task_library').where({ id: video.task_id }).first()

      // 查积分配置有效期
      const config = await req.db('points_config').first('validity_days')
      const validDays = config?.validity_days || 365
      const expiresAt = dayjs().add(validDays, 'day').toDate()

      let ledgerId = null
      let pointsAwarded = 0

      await req.db.transaction(async trx => {
        const svc = new PointsService(trx)
        const result = await svc.change({
          customerId:   video.customer_id,
          action:       'earn_checkin',
          points:       task?.points_value || 10,
          operatorId:   req.user.id,
          operatorRole: req.user.role,
          remark:       `打卡审核通过：${task?.name || '任务'}`,
          sourceType:   'task_video',
          sourceId:     video.id,
          expiresAt,
        }, trx)
        ledgerId     = result.ledgerId
        pointsAwarded = task?.points_value || 10

        await trx('task_videos').where({ id }).update({
          status:         'approved',
          reviewer_id:    req.user.id,
          reviewed_at:    trx.fn.now(),
          points_awarded: pointsAwarded,
          ledger_id:      ledgerId,
        })
      })

      // 通知老人审核通过
      const elder = await req.db('customers as c')
        .join('users as u', 'u.id', 'c.user_id')
        .where('c.id', video.customer_id).select('u.id as userId').first()
      if (elder) {
        await msgSvc.send({
          receiverId:   elder.userId,
          receiverRole: 'elder',
          type:         'review_approved',
          title:        '打卡审核通过',
          content:      `您的打卡视频已通过审核，获得 ${pointsAwarded} 积分！`,
          refType:      'task_video',
          refId:        video.id,
        })
      }

      return res.json({ code: 'OK', message: `审核通过，已奖励 ${pointsAwarded} 积分` })

    } else {
      // 驳回
      await req.db('task_videos').where({ id }).update({
        status:         'rejected',
        reviewer_id:    req.user.id,
        reviewed_at:    req.db.fn.now(),
        reject_reason:  reject_reason.trim(),
      })

      const elder = await req.db('customers as c')
        .join('users as u', 'u.id', 'c.user_id')
        .where('c.id', video.customer_id).select('u.id as userId').first()
      if (elder) {
        await msgSvc.send({
          receiverId:   elder.userId,
          receiverRole: 'elder',
          type:         'review_rejected',
          priority:     'high',
          title:        '打卡视频被驳回',
          content:      `您的打卡视频未通过审核，原因：${reject_reason.trim()}。请重新提交。`,
          refType:      'task_video',
          refId:        video.id,
        })
      }

      return res.json({ code: 'OK', message: '已驳回该打卡' })
    }
  }

  // ─── 待审核列表（管家/admin）─────────────────────────────────
  // GET /api/task-checkins/pending
  async listPending(req, res) {
    const { page = 1, pageSize = 20 } = req.query
    const caregiverId = req.user.id
    const isAdmin     = req.user.role === 'admin'

    const query = req.db('task_videos as tv')
      .join('task_library as tl', 'tl.id', 'tv.task_id')
      .join('customers as c', 'c.id', 'tv.customer_id')
      .where({ 'tv.status': 'pending', 'tv.is_deleted': 0 })
      .modify(b => {
        if (!isAdmin) {
          // 管家只看自己负责老人的打卡
          b.whereIn('tv.customer_id', function () {
            this.select('customer_id').from('caregiver_assignments').where('caregiver_id', caregiverId)
          })
        }
      })
      .orderBy('tv.uploaded_at', 'asc')

    const total = await query.clone().count('tv.id as cnt').first()
    const rows  = await query
      .offset((Number(page) - 1) * Number(pageSize)).limit(Number(pageSize))
      .select(
        'tv.id','tv.customer_id','c.name as customer_name',
        'tv.task_id','tl.name as task_name',
        'tv.task_date','tv.video_url','tv.duration_sec','tv.uploaded_at'
      )

    return res.json({ code: 'OK', data: { list: rows, total: Number(total.cnt) } })
  }
}

module.exports = new TaskCheckinController()
