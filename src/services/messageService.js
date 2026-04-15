// src/services/messageService.js
// 站内消息发送服务 —— 统一入口，所有模块通过此服务发消息

const dayjs = require('dayjs')

class MessageService {
  constructor(db) {
    this.db = db
  }

  /**
   * 发送站内消息
   * @param {Object} opts
   * @param {number}   opts.receiverId    - 接收人 users.id
   * @param {string}   opts.receiverRole  - 'elder'|'caregiver'|'family'|'admin'
   * @param {string}   opts.type          - in_app_messages.type ENUM 值
   * @param {string}   opts.title         - 消息标题（≤100字）
   * @param {string}   opts.content       - 消息正文
   * @param {string}   [opts.priority]    - 'normal'|'high'|'urgent'，默认 'normal'
   * @param {string}   [opts.actionUrl]   - 点击跳转路径
   * @param {string}   [opts.actionLabel] - 按钮文字，如 "立即处理"
   * @param {string}   [opts.refType]     - 关联对象类型，如 'afi_alert'
   * @param {number}   [opts.refId]       - 关联对象ID
   * @param {Date}     [opts.expiresAt]   - 消息有效期（null=永不过期）
   * @returns {Promise<number>} 插入的消息ID
   */
  async send({
    receiverId, receiverRole, type, title, content,
    priority = 'normal', actionUrl = null, actionLabel = null,
    refType = null, refId = null, expiresAt = null,
  }) {
    const [id] = await this.db('in_app_messages').insert({
      receiver_id:   receiverId,
      receiver_role: receiverRole,
      type,
      priority,
      title,
      content,
      action_url:    actionUrl,
      action_label:  actionLabel,
      ref_type:      refType,
      ref_id:        refId,
      is_read:       0,
      is_deleted:    0,
      created_at:    dayjs().format('YYYY-MM-DD HH:mm:ss'),
      expires_at:    expiresAt ? dayjs(expiresAt).format('YYYY-MM-DD HH:mm:ss') : null,
    })
    return id
  }

  /**
   * 批量发送同一条消息给多个用户（相同 role）
   * @param {Array<{id: number, role: string}>} receivers  - 接收人列表
   * @param {Object} opts  - 除 receiverId/receiverRole 外的其余参数
   */
  async sendBatch(receivers, opts) {
    if (!receivers || receivers.length === 0) return
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss')
    const rows = receivers.map(r => ({
      receiver_id:   r.id,
      receiver_role: r.role,
      type:          opts.type,
      priority:      opts.priority || 'normal',
      title:         opts.title,
      content:       opts.content,
      action_url:    opts.actionUrl || null,
      action_label:  opts.actionLabel || null,
      ref_type:      opts.refType || null,
      ref_id:        opts.refId || null,
      is_read:       0,
      is_deleted:    0,
      created_at:    now,
      expires_at:    opts.expiresAt ? dayjs(opts.expiresAt).format('YYYY-MM-DD HH:mm:ss') : null,
    }))
    await this.db('in_app_messages').insert(rows)
  }

  /**
   * 获取用户未读消息列表（前端轮询用）
   * @param {number} receiverId
   * @param {number} [limit=20]
   */
  async getUnread(receiverId, limit = 20) {
    return this.db('in_app_messages')
      .where({ receiver_id: receiverId, is_read: 0, is_deleted: 0 })
      .orderBy('created_at', 'desc')
      .limit(limit)
      .select('id','type','priority','title','content','action_url','action_label','ref_type','ref_id','created_at')
  }

  /**
   * 标记已读
   * @param {number}   receiverId
   * @param {number[]} [msgIds]   不传则标记该用户全部已读
   */
  async markRead(receiverId, msgIds) {
    const q = this.db('in_app_messages')
      .where({ receiver_id: receiverId, is_read: 0, is_deleted: 0 })
    if (msgIds && msgIds.length > 0) q.whereIn('id', msgIds)
    await q.update({ is_read: 1, read_at: dayjs().format('YYYY-MM-DD HH:mm:ss') })
  }

  /**
   * 获取未读数量（徽标用）
   * @param {number} receiverId
   * @returns {Promise<number>}
   */
  async unreadCount(receiverId) {
    const row = await this.db('in_app_messages')
      .where({ receiver_id: receiverId, is_read: 0, is_deleted: 0 })
      .count('id as cnt').first()
    return Number(row.cnt)
  }
}

module.exports = MessageService
