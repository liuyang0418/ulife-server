// src/services/taskEngineService.js
// 任务引擎：根据测评答案查映射表，批量分配任务给老人

const logger = require('../utils/logger')

/**
 * 测评完成后触发：根据选项→任务映射自动分配任务
 *
 * @param {number} customerId    - 老人 ID
 * @param {number} assessmentId  - 测评记录 ID
 * @param {number[]} optionIds   - 本次测评所有已选选项 ID
 * @param {number} assignedBy    - 操作人 ID（管家）
 * @param {object} db            - knex 实例
 * @returns {{ assigned: number, skipped: number }}
 */
async function assignTasksFromAssessment({ customerId, assessmentId, optionIds, assignedBy, db }) {
  if (!optionIds || optionIds.length === 0) return { assigned: 0, skipped: 0 }

  // 1. 查询所有匹配的任务映射
  const mappings = await db('option_task_mappings as otm')
    .join('task_library as tl', 'tl.id', 'otm.task_id')
    .whereIn('otm.option_id', optionIds)
    .where('tl.is_active', 1)
    .select(
      'otm.task_id',
      'otm.priority',
      'otm.frequency',
      'tl.name as task_name'
    )

  if (mappings.length === 0) {
    logger.info(`任务引擎: 测评 ${assessmentId} 无匹配任务映射`)
    return { assigned: 0, skipped: 0 }
  }

  // 2. 去重（同一任务可能被多个选项映射，取最高优先级）
  const taskMap = new Map()
  for (const m of mappings) {
    const existing = taskMap.get(m.task_id)
    if (!existing || m.priority < existing.priority) {
      taskMap.set(m.task_id, m)
    }
  }

  // 3. 查询老人已有的任务分配（避免重复）
  const taskIds = Array.from(taskMap.keys())
  const existing = await db('customer_task_assignments')
    .where({ customer_id: customerId })
    .whereIn('task_id', taskIds)
    .whereNot('status', 'removed')
    .pluck('task_id')
  const existingSet = new Set(existing)

  // 4. 构建待插入列表
  const toInsert = []
  const now = db.fn.now()

  for (const [taskId, m] of taskMap) {
    if (existingSet.has(taskId)) continue  // 已分配，跳过
    toInsert.push({
      customer_id:   customerId,
      task_id:       taskId,
      source:        'engine',
      assessment_id: assessmentId,
      frequency:     m.frequency,
      priority:      m.priority,
      status:        'active',
      assigned_by:   assignedBy,
      assigned_at:   now,
    })
  }

  if (toInsert.length === 0) {
    logger.info(`任务引擎: 测评 ${assessmentId} 所有任务已分配，skipped=${taskMap.size}`)
    return { assigned: 0, skipped: taskMap.size }
  }

  // 5. 批量写入
  await db('customer_task_assignments').insert(toInsert)

  logger.info(
    `任务引擎: 测评 ${assessmentId} 为老人 ${customerId} 分配 ${toInsert.length} 个任务，` +
    `跳过 ${existingSet.size} 个已有任务`
  )

  return { assigned: toInsert.length, skipped: existingSet.size }
}

module.exports = { assignTasksFromAssessment }
