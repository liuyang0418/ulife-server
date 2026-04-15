// src/controllers/afiReportController.js
// GET /api/v1/customer/afi-report
// 返回长者端生命仪表盘所需的全量数据：
//   current_score、slope_value、life_label、
//   actual_curve（实际AFI点位）、ideal_decline_curve（生理学标准曲线）

const dayjs = require('dayjs')

// 生理学抗衰老标准：健康老人每年自然下降约 0.5 分
// 折算为每天：-0.5/365 ≈ -0.00137
const IDEAL_DAILY_DECLINE = -0.00137

// AFI 区间 → 生命周期标签（友好话术）
function getLifeLabel(score) {
  if (score >= 90) return { label: '青春活力型', color: '#52c41a', emoji: '💪' }
  if (score >= 70) return { label: '稳健续航型', color: '#1890ff', emoji: '🚀' }
  if (score >= 50) return { label: '精细管理型', color: '#faad14', emoji: '🌱' }
  return               { label: '应急干预型', color: '#ff4d4f', emoji: '🆘' }
}

// 平滑插值：对连续两个已知点之间的空白周，线性填充
// 避免曲线因某周无打卡而断开或归零
function smoothCurve(records) {
  if (records.length === 0) return []
  if (records.length === 1) return records

  const result = [records[0]]
  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1]
    const curr = records[i]
    const gapDays = curr.days_from_start - prev.days_from_start

    // 超过 7 天的空隙，插入线性过渡点
    if (gapDays > 7) {
      const steps = Math.floor(gapDays / 7)
      for (let s = 1; s < steps; s++) {
        const ratio = s / steps
        result.push({
          date:            null,  // 虚拟补充点，前端标注为灰色
          days_from_start: Math.round(prev.days_from_start + gapDays * ratio),
          afi_value:       Number((prev.afi_value + (curr.afi_value - prev.afi_value) * ratio).toFixed(2)),
          is_interpolated: true,
        })
      }
    }
    result.push(curr)
  }
  return result
}

// 生成理想曲线：从老人入住首个AFI值出发，按生理学标准缓慢下降
function buildIdealCurve(firstRecord, lastDaysFromStart) {
  if (!firstRecord) return []
  const start = firstRecord.days_from_start
  const baseValue = Number(firstRecord.afi_value)
  const points = []

  for (let d = start; d <= lastDaysFromStart; d += 7) {
    points.push({
      days_from_start: d,
      afi_value: Math.max(0, +(baseValue + IDEAL_DAILY_DECLINE * (d - start)).toFixed(2)),
    })
  }
  return points
}

class AfiReportController {

  async report(req, res) {
    // 管家查询用 customerId 参数，老人查询用自己的 customer_id
    let customerId = req.query.customerId
    if (!customerId && req.user.role === 'elder') {
      const c = await req.db('customers').where({ user_id: req.user.id }).first('id')
      customerId = c?.id
    }
    if (!customerId) return res.status(400).json({ message: '请指定老人' })

    // 权限校验：管家只能查询自己负责的老人
    if (req.user.role === 'caregiver') {
      const assigned = await req.db('caregiver_assignments')
        .where({ caregiver_id: req.user.id, customer_id: customerId }).first()
      if (!assigned) return res.status(403).json({ message: '无权查询该老人数据' })
    }

    // 取最近 90 天有效记录（过滤异常点 is_anomaly=1）
    const cutoff = dayjs().subtract(90, 'day').format('YYYY-MM-DD')
    const records = await req.db('afi_records')
      .where({ customer_id: customerId, is_anomaly: 0, is_deleted: 0 })
      .where('record_date', '>=', cutoff)
      .orderBy('days_from_start', 'asc')
      .select('afi_value', 'record_date', 'days_from_start')

    // 取分析缓存（slope、risk_level 等）
    const analysis = await req.db('afi_analysis_cache')
      .where({ customer_id: customerId }).first()

    const currentScore = records.length > 0
      ? Number(records[records.length - 1].afi_value)
      : null

    const lifeLabel = currentScore !== null ? getLifeLabel(currentScore) : null

    // 实际曲线（平滑处理，无记录周线性插值）
    const smoothed = smoothCurve(
      records.map(r => ({
        date:            r.record_date,
        days_from_start: r.days_from_start,
        afi_value:       Number(r.afi_value),
        is_interpolated: false,
      }))
    )

    // 理想曲线（生理学标准）
    const firstRecord    = records[0] || null
    const lastDays       = records.length > 0 ? records[records.length - 1].days_from_start : 0
    const idealCurve     = buildIdealCurve(firstRecord, lastDays)

    // 剪刀差：实际曲线与理想曲线的差值（用于前端填充渲染）
    const scissorsDiff = smoothed
      .filter(p => !p.is_interpolated)
      .map(p => {
        const ideal = firstRecord
          ? Number((Number(firstRecord.afi_value) + IDEAL_DAILY_DECLINE * (p.days_from_start - firstRecord.days_from_start)).toFixed(2))
          : null
        return {
          days_from_start: p.days_from_start,
          actual:          p.afi_value,
          ideal,
          diff: ideal !== null ? +(p.afi_value - ideal).toFixed(2) : null,
        }
      })

    // 斜率语义：避免刺激性词汇，统一友好话术
    const slopeValue = analysis?.slope ? Number(analysis.slope) : null
    const slopeHint  = (() => {
      if (slopeValue === null) return null
      if (slopeValue >  0.05) return { text: '您的身体机能正在持续提升，继续保持！', tone: 'positive' }
      if (slopeValue >= -0.05) return { text: '您的身体状态保持稳定，管家会陪伴您维持现状。', tone: 'neutral' }
      if (slopeValue >= -0.15) return { text: '身体正在发出修复信号，管家已为您调整了健康计划。', tone: 'gentle' }
      return { text: '身体正在发出修复信号，需要管家协助调整方案，请及时联系管家。', tone: 'care' }
    })()

    res.json({
      code: 'OK',
      data: {
        currentScore,
        lifeLabel,
        slopeValue,
        slopeHint,
        riskLevel:      analysis?.risk_level || 'STABLE',
        forecast30d:    analysis?.forecast_30d ? Number(analysis.forecast_30d) : null,
        forecast90d:    analysis?.forecast_90d ? Number(analysis.forecast_90d) : null,
        dataPoints:     analysis?.data_points  || 0,
        computedAt:     analysis?.computed_at  || null,
        actualCurve:    smoothed,
        idealCurve,
        scissorsDiff,
      },
    })
  }
}

module.exports = new AfiReportController()
