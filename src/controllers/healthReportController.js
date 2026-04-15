// src/controllers/healthReportController.js
// 健康月报：生成 + 查看（管家/管理员生成，家属可查看）

const dayjs = require('dayjs')

class HealthReportController {

  // ─── 生成或更新月报（管家/admin）────────────────────────────
  // POST /api/health-reports
  // body: { customer_id, report_month }  report_month 格式: "2026-04"
  async generate(req, res) {
    const { customer_id, report_month } = req.body
    if (!customer_id)    return res.status(400).json({ code: 'INVALID_PARAM', message: '请指定老人' })
    if (!report_month)   return res.status(400).json({ code: 'INVALID_PARAM', message: '请指定报告月份（格式 2026-04）' })

    // 权限检查（管家只能生成自己负责老人的报告）
    if (req.user.role === 'caregiver') {
      const ok = await req.db('caregiver_assignments')
        .where({ caregiver_id: req.user.id, customer_id }).first()
      if (!ok) return res.status(403).json({ code: 'FORBIDDEN', message: '无权操作该老人' })
    }

    const customer = await req.db('customers').where({ id: customer_id, is_cancelled: 0 }).first()
    if (!customer) return res.status(404).json({ code: 'NOT_FOUND', message: '老人不存在' })

    const monthStart = dayjs(`${report_month}-01`).format('YYYY-MM-DD')
    const monthEnd   = dayjs(`${report_month}-01`).endOf('month').format('YYYY-MM-DD')

    // 1. AFI 数据快照（本月）
    const afiRecords = await req.db('afi_records')
      .where({ customer_id, is_deleted: 0, is_anomaly: 0 })
      .whereBetween('record_date', [monthStart, monthEnd])
      .orderBy('record_date')
      .select('afi_value', 'record_date', 'days_from_start')

    const afiValues   = afiRecords.map(r => Number(r.afi_value))
    const afiStart    = afiValues[0]          || null
    const afiEnd      = afiValues[afiValues.length - 1] || null
    const afiAvg      = afiValues.length ? (afiValues.reduce((s, v) => s + v, 0) / afiValues.length).toFixed(2) : null
    const afiTrend    = afiStart && afiEnd ? (afiEnd - afiStart).toFixed(2) : null

    // 2. 打卡统计（本月）
    const checkinStats = await req.db('task_videos')
      .where({ customer_id, is_deleted: 0 })
      .whereBetween('task_date', [monthStart, monthEnd])
      .select(
        req.db.raw("SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) as approved"),
        req.db.raw("SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) as rejected"),
        req.db.raw("SUM(CASE WHEN status='pending'  THEN 1 ELSE 0 END) as pending"),
        req.db.raw("SUM(CASE WHEN status='approved' THEN points_awarded ELSE 0 END) as total_points")
      )
      .first()

    // 3. 预警情况（本月）
    const alertStats = await req.db('afi_alerts')
      .where('customer_id', customer_id)
      .whereBetween('created_at', [`${monthStart} 00:00:00`, `${monthEnd} 23:59:59`])
      .select(
        req.db.raw("COUNT(*) as total"),
        req.db.raw("SUM(CASE WHEN alert_level='red' THEN 1 ELSE 0 END) as red_count"),
        req.db.raw("SUM(CASE WHEN status='handled' THEN 1 ELSE 0 END) as handled_count")
      )
      .first()

    // 4. 分析缓存（当前状态）
    const analysis = await req.db('afi_analysis_cache').where({ customer_id }).first()

    // 5. 构建 AFI 快照 JSON
    const afi_snapshot = {
      month:          report_month,
      records_count:  afiRecords.length,
      afi_start:      afiStart,
      afi_end:        afiEnd,
      afi_avg:        afiAvg ? Number(afiAvg) : null,
      afi_trend:      afiTrend ? Number(afiTrend) : null,
      risk_level:     analysis?.risk_level || 'STABLE',
      forecast_30d:   analysis?.forecast_30d ? Number(analysis.forecast_30d) : null,
      checkins: {
        approved: Number(checkinStats?.approved || 0),
        rejected: Number(checkinStats?.rejected || 0),
        pending:  Number(checkinStats?.pending  || 0),
        total_points: Number(checkinStats?.total_points || 0),
      },
      alerts: {
        total:         Number(alertStats?.total   || 0),
        red_count:     Number(alertStats?.red_count || 0),
        handled_count: Number(alertStats?.handled_count || 0),
      },
    }

    // 6. 生成文字摘要
    const summary = this._generateSummary(customer.name, report_month, afi_snapshot)

    // 7. UPSERT 月报
    await req.db.raw(`
      INSERT INTO health_reports (customer_id, report_month, summary, afi_snapshot, created_at)
      VALUES (?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        summary      = VALUES(summary),
        afi_snapshot = VALUES(afi_snapshot)
    `, [customer_id, report_month, summary, JSON.stringify(afi_snapshot)])

    const report = await req.db('health_reports')
      .where({ customer_id, report_month }).first()

    return res.json({ code: 'OK', data: report, message: '月报已生成' })
  }

  // ─── 查询某老人的月报列表 ────────────────────────────────────
  // GET /api/health-reports?customer_id=xxx
  async list(req, res) {
    const { customer_id, page = 1, pageSize = 12 } = req.query
    const resolvedId = await this._resolveId(req, res, customer_id)
    if (!resolvedId) return

    const rows = await req.db('health_reports')
      .where({ customer_id: resolvedId })
      .orderBy('report_month', 'desc')
      .offset((Number(page) - 1) * Number(pageSize)).limit(Number(pageSize))
      .select('id','report_month','created_at')

    // 仅返回摘要列表（不含完整内容）
    const total = await req.db('health_reports').where({ customer_id: resolvedId }).count('id as cnt').first()
    return res.json({ code: 'OK', data: { list: rows, total: Number(total.cnt) } })
  }

  // ─── 查询某月报详情 ──────────────────────────────────────────
  // GET /api/health-reports/:id
  async detail(req, res) {
    const { id } = req.params
    const report = await req.db('health_reports').where({ id }).first()
    if (!report) return res.status(404).json({ code: 'NOT_FOUND', message: '月报不存在' })

    const resolvedId = await this._resolveId(req, res, report.customer_id)
    if (!resolvedId) return

    // 解析 afi_snapshot JSON
    if (typeof report.afi_snapshot === 'string') {
      try { report.afi_snapshot = JSON.parse(report.afi_snapshot) } catch {}
    }

    return res.json({ code: 'OK', data: report })
  }

  // ─── 内部：生成摘要文本 ───────────────────────────────────────
  _generateSummary(customerName, month, snapshot) {
    const { afi_avg, afi_trend, risk_level, checkins, alerts } = snapshot
    const monthLabel  = dayjs(`${month}-01`).format('YYYY年MM月')
    const trendText   = afi_trend === null ? '数据不足' : afi_trend > 0 ? `提升 ${afi_trend} 分` : afi_trend < 0 ? `下降 ${Math.abs(afi_trend)} 分` : '保持稳定'
    const riskMap     = { STABLE: '稳定', IMPROVING: '提升', MILD_DECLINE: '轻度下降', SEVERE_DECLINE: '需关注' }
    const riskLabel   = riskMap[risk_level] || '稳定'
    const checkinRate = checkins.approved + checkins.rejected > 0
      ? Math.round(checkins.approved / (checkins.approved + checkins.rejected) * 100)
      : 0

    return [
      `${customerName}${monthLabel}健康月报`,
      ``,
      `【健康活力指数（AFI）】`,
      `本月平均AFI：${afi_avg ?? '暂无数据'}分，较月初${trendText}，整体趋势：${riskLabel}。`,
      ``,
      `【任务打卡】`,
      `本月共提交打卡 ${checkins.approved + checkins.rejected} 次，通过率 ${checkinRate}%，获得 ${checkins.total_points} 积分。`,
      ``,
      `【健康预警】`,
      alerts.total > 0
        ? `本月共触发预警 ${alerts.total} 次（红色 ${alerts.red_count} 次），已处理 ${alerts.handled_count} 次。`
        : '本月未触发任何健康预警，状态良好。',
    ].join('\n')
  }

  // ─── 内部：解析 customerId 并做权限检查 ──────────────────────
  async _resolveId(req, res, customerId) {
    if (req.user.role === 'elder') {
      const c = await req.db('customers').where({ user_id: req.user.id }).first('id')
      return c?.id || null
    }
    if (req.user.role === 'family') {
      const auth = await req.db('family_authorizations')
        .where({ family_user_id: req.user.id, customer_id: customerId, status: 'approved', can_view_reports: 1 }).first()
      if (!auth) { res.status(403).json({ code: 'FORBIDDEN', message: '无权查看该老人报告' }); return null }
    }
    if (req.user.role === 'caregiver') {
      const ok = await req.db('caregiver_assignments')
        .where({ caregiver_id: req.user.id, customer_id: customerId }).first()
      if (!ok) { res.status(403).json({ code: 'FORBIDDEN', message: '无权查看该老人报告' }); return null }
    }
    return customerId
  }
}

module.exports = new HealthReportController()
