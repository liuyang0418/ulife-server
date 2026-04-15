// src/controllers/afiController.js
// AFI 数据录入、查询、修改 —— 管家端

const dayjs     = require('dayjs')
const afiService = require('../services/afiService')

class AfiController {

  // ─── 录入 AFI 数据（含噪声检测）──────────────────────────────
  async create(req, res) {
    const { customerId, afiValue, recordDate, confirmed = false } = req.body
    const caregiverId = req.user.id

    // 参数校验
    if (!customerId)                        return res.status(400).json({ message: '请指定老人' })
    const val = Number(afiValue)
    if (isNaN(val) || val < 0 || val > 100) return res.status(400).json({ message: 'AFI值必须在0~100之间' })
    if (!recordDate)                        return res.status(400).json({ message: '请选择记录日期' })
    if (dayjs(recordDate).isAfter(dayjs())) return res.status(400).json({ message: '不能录入未来日期的数据' })

    // 验证管家有权限操作此老人
    const assignment = await req.db('caregiver_assignments')
      .where({ caregiver_id: caregiverId, customer_id: customerId }).first()
    if (!assignment) return res.status(403).json({ message: '您无权操作该老人的数据' })

    // ─── 噪声检测：与上次有效值偏差超30%时须用户确认 ────────────
    if (!confirmed) {
      const last = await req.db('afi_records')
        .where({ customer_id: customerId, is_anomaly: 0, is_deleted: 0 })
        .orderBy('record_date', 'desc')
        .first('afi_value', 'record_date')

      if (last) {
        const lastVal   = Number(last.afi_value)
        const deviation = Math.abs(val - lastVal) / lastVal

        if (deviation > 0.3) {
          return res.json({
            code: 'ANOMALY_DETECTED',
            data: {
              lastValue:    lastVal,
              lastDate:     last.record_date,
              newValue:     val,
              deviation:    (deviation * 100).toFixed(1),
            },
            message: `本次录入值(${val})与上次(${lastVal}, ${last.record_date})偏差${(deviation * 100).toFixed(1)}%，超过30%，请确认是否真实`,
          })
        }
      }
    }

    // ─── 计算距入住天数（OLS x 轴）────────────────────────────
    const customer = await req.db('customers').where({ id: customerId }).first('joined_date')
    if (!customer?.joined_date) return res.status(400).json({ message: '老人入住日期未设置，无法录入AFI' })

    const daysFromStart = dayjs(recordDate).diff(dayjs(customer.joined_date), 'day')
    if (daysFromStart < 0) return res.status(400).json({ message: '记录日期不能早于入住日期' })

    // ─── 写入记录 ─────────────────────────────────────────────
    try {
      await req.db('afi_records').insert({
        customer_id:     customerId,
        afi_value:       val.toFixed(2),
        record_date:     recordDate,
        days_from_start: daysFromStart,
        is_anomaly:      0,   // confirmed=true 或未超阈值，均视为可信数据
        recorded_by:     caregiverId,
        created_at:      dayjs().format('YYYY-MM-DD HH:mm:ss'),
      })
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ message: '该日期已有AFI记录，请修改已有记录' })
      }
      throw e
    }

    // 异步重新计算（不阻塞响应）
    afiService.recalculate(customerId, req.db).catch(() => {})

    res.json({ code: 'OK', message: 'AFI数据已录入' })
  }

  // ─── 查询老人 AFI 历史（近90天 + 分析缓存）────────────────────
  async list(req, res) {
    const { customerId } = req.params
    const days           = Math.min(Number(req.query.days) || 90, 365)
    const cutoff         = dayjs().subtract(days, 'day').format('YYYY-MM-DD')

    const records = await req.db('afi_records')
      .where({ customer_id: customerId, is_deleted: 0 })
      .where('record_date', '>=', cutoff)
      .orderBy('record_date', 'asc')
      .select('id','afi_value','record_date','days_from_start','is_anomaly','recorded_by','created_at')

    const analysis = await req.db('afi_analysis_cache')
      .where({ customer_id: customerId }).first()

    res.json({ code: 'OK', data: { records, analysis: analysis || null } })
  }

  // ─── 修改已有 AFI 记录（需填写原因，写审计日志）──────────────
  async update(req, res) {
    const { id }                = req.params
    const { afiValue, reason }  = req.body
    const modifier              = req.user

    if (!reason?.trim()) return res.status(400).json({ message: '请填写修改原因' })
    const val = Number(afiValue)
    if (isNaN(val) || val < 0 || val > 100) return res.status(400).json({ message: 'AFI值必须在0~100之间' })

    const record = await req.db('afi_records').where({ id, is_deleted: 0 }).first()
    if (!record) return res.status(404).json({ message: 'AFI记录不存在' })

    await req.db.transaction(async trx => {
      // 审计日志
      await trx('afi_record_modifications').insert({
        afi_record_id: id,
        customer_id:   record.customer_id,
        modifier_id:   modifier.id,
        modifier_role: modifier.role,
        modified_at:   dayjs().format('YYYY-MM-DD HH:mm:ss'),
        before_value:  JSON.stringify({ afi_value: record.afi_value }),
        after_value:   JSON.stringify({ afi_value: val }),
        reason:        reason.trim(),
      })
      // 更新记录
      await trx('afi_records').where({ id }).update({
        afi_value:  val.toFixed(2),
        updated_at: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      })
    })

    // 异步重算
    afiService.recalculate(record.customer_id, req.db).catch(() => {})

    res.json({ code: 'OK', message: 'AFI记录已更新' })
  }

  // ─── 管家标记预警处理状态 ──────────────────────────────────────
  async handleAlert(req, res) {
    const { id }     = req.params
    const { status, note } = req.body   // status: 'handling' | 'handled'
    const caregiverId = req.user.id

    if (!['handling', 'handled'].includes(status)) {
      return res.status(400).json({ message: 'status 只能为 handling 或 handled' })
    }

    const alert = await req.db('afi_alerts').where({ id }).first()
    if (!alert) return res.status(404).json({ message: '预警记录不存在' })
    if (alert.status === 'handled') return res.status(400).json({ message: '预警已处理完成，不可重复操作' })

    const updates = { status, handled_by: caregiverId }
    if (note?.trim()) updates.handle_note = note.trim()
    if (status === 'handled') updates.handled_at = dayjs().format('YYYY-MM-DD HH:mm:ss')

    await req.db('afi_alerts').where({ id }).update(updates)

    res.json({ code: 'OK', message: status === 'handling' ? '已标记为处理中' : '预警已处理完成' })
  }
}

module.exports = new AfiController()
