// src/services/afiService.js
// AFI OLS 回归分析 + 预警触发
// 由 AfiController 和定时任务调用

const dayjs = require('dayjs')

// OLS 线性回归斜率：k = [n·Σ(xy) - Σx·Σy] / [n·Σ(x²) - (Σx)²]
function calcSlope(points) {
  const n = points.length
  if (n < 3) return null   // 至少3个点才有意义

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
  for (const { x, y } of points) {
    sumX  += x
    sumY  += y
    sumXY += x * y
    sumX2 += x * x
  }
  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return 0
  return (n * sumXY - sumX * sumY) / denom
}

function classifyRisk(slope) {
  if (slope === null) return 'STABLE'
  if (slope >  0.05) return 'IMPROVING'
  if (slope >= -0.05) return 'STABLE'
  if (slope >= -0.15) return 'MILD_DECLINE'
  return 'SEVERE_DECLINE'
}

class AfiService {
  /**
   * 重新计算某位老人的 AFI 分析缓存，并在必要时触发预警
   * @param {number} customerId
   * @param {object} db  - knex 实例（来自 req.db）
   */
  async recalculate(customerId, db) {
    try {
      // 取最近90天有效记录（排除异常点和已删除）
      const cutoff = dayjs().subtract(90, 'day').format('YYYY-MM-DD')
      const records = await db('afi_records')
        .where({ customer_id: customerId, is_anomaly: 0, is_deleted: 0 })
        .where('record_date', '>=', cutoff)
        .orderBy('days_from_start', 'asc')
        .select('days_from_start', 'afi_value', 'record_date')

      const points = records.map(r => ({ x: r.days_from_start, y: Number(r.afi_value) }))
      const slope  = calcSlope(points)
      const riskLevel = classifyRisk(slope)

      // 最新AFI值（用于预测）
      const lastRecord = records[records.length - 1]
      const lastValue  = lastRecord ? Number(lastRecord.afi_value) : null
      const lastX      = lastRecord ? lastRecord.days_from_start  : null

      // 预测值（基于回归线：y = lastY + k * Δx）
      let forecast30d = null, forecast90d = null
      if (slope !== null && lastValue !== null) {
        forecast30d = Math.max(0, Math.min(100, lastValue + slope * 30))
        forecast90d = Math.max(0, Math.min(100, lastValue + slope * 90))
      }

      // 获取老人预警阈值
      const customer = await db('customers').where({ id: customerId }).first('afi_critical_value', 'alert_level')
      const threshold = customer ? Number(customer.afi_critical_value) : 60

      const isCritical = lastValue !== null && lastValue < threshold

      // 更新分析缓存（INSERT … ON DUPLICATE KEY UPDATE）
      await db.raw(`
        INSERT INTO afi_analysis_cache
          (customer_id, slope, risk_level, forecast_30d, forecast_90d, is_critical, data_points, computed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
          slope        = VALUES(slope),
          risk_level   = VALUES(risk_level),
          forecast_30d = VALUES(forecast_30d),
          forecast_90d = VALUES(forecast_90d),
          is_critical  = VALUES(is_critical),
          data_points  = VALUES(data_points),
          computed_at  = NOW()
      `, [
        customerId,
        slope !== null ? slope.toFixed(4) : null,
        riskLevel,
        forecast30d !== null ? forecast30d.toFixed(2) : null,
        forecast90d !== null ? forecast90d.toFixed(2) : null,
        isCritical ? 1 : 0,
        points.length,
      ])

      // 若触发预警且当前无 pending 预警，则写入新预警
      const shouldAlert = isCritical || riskLevel === 'SEVERE_DECLINE'
      if (shouldAlert) {
        const existingAlert = await db('afi_alerts')
          .where({ customer_id: customerId, status: 'pending' })
          .first()

        if (!existingAlert) {
          const reasons = []
          if (isCritical)                   reasons.push(`AFI值(${lastValue})低于预警阈值(${threshold})`)
          if (riskLevel === 'SEVERE_DECLINE') reasons.push(`OLS斜率${slope?.toFixed(4)}，呈严重下降趋势`)

          const alertLevel = isCritical ? 'red' : 'yellow'
          await db('afi_alerts').insert({
            customer_id:   customerId,
            alert_level:   alertLevel,
            alert_reasons: JSON.stringify(reasons),
            status:        'pending',
            created_at:    dayjs().format('YYYY-MM-DD HH:mm:ss'),
          })

          // 更新老人档案的预警颜色
          await db('customers').where({ id: customerId })
            .update({ alert_level: alertLevel })
        }
      } else {
        // 若预警已解除（值回升），更新老人档案为绿色
        if (customer?.alert_level !== 'green') {
          await db('customers').where({ id: customerId }).update({ alert_level: 'green' })
        }
      }
    } catch (err) {
      console.error(`[AfiService] recalculate error for customer ${customerId}:`, err.message)
    }
  }
}

module.exports = new AfiService()
