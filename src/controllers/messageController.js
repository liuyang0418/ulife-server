// src/controllers/messageController.js
// 站内消息控制器 —— 前端轮询、标记已读

const MessageService = require('../services/messageService')

class MessageController {

  // ─── 获取未读消息列表（前端每30秒轮询）────────────────────────
  async listUnread(req, res) {
    const msgSvc = new MessageService(req.db)
    const messages = await msgSvc.getUnread(req.user.id, 30)
    const count    = await msgSvc.unreadCount(req.user.id)
    res.json({ code: 'OK', data: { messages, unreadCount: count } })
  }

  // ─── 获取消息列表（含已读，分页）─────────────────────────────
  async list(req, res) {
    const { page = 1, pageSize = 20 } = req.query
    const offset = (page - 1) * pageSize

    const [messages, countRow] = await Promise.all([
      req.db('in_app_messages')
        .where({ receiver_id: req.user.id, is_deleted: 0 })
        .orderBy('created_at', 'desc')
        .offset(offset).limit(Number(pageSize))
        .select('id','type','priority','title','content','action_url','action_label',
                'ref_type','ref_id','is_read','read_at','created_at'),
      req.db('in_app_messages')
        .where({ receiver_id: req.user.id, is_deleted: 0 })
        .count('id as cnt').first(),
    ])

    res.json({
      code: 'OK',
      data: { list: messages, total: Number(countRow.cnt), page: Number(page), pageSize: Number(pageSize) },
    })
  }

  // ─── 标记已读 ──────────────────────────────────────────────
  async markRead(req, res) {
    const { ids } = req.body  // 可选：不传则全部标记
    const msgSvc  = new MessageService(req.db)
    await msgSvc.markRead(req.user.id, ids)
    res.json({ code: 'OK', message: '已标记为已读' })
  }

  // ─── 软删除消息 ────────────────────────────────────────────
  async remove(req, res) {
    const { id } = req.params
    await req.db('in_app_messages')
      .where({ id, receiver_id: req.user.id })
      .update({ is_deleted: 1 })
    res.json({ code: 'OK' })
  }
}

module.exports = new MessageController()
