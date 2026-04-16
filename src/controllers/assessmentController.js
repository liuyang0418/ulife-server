// src/controllers/assessmentController.js
// 客户测评流程：发起 → 逐题答题 → 完成（自动算分 + 触发任务引擎）

const taskEngine = require('../services/taskEngineService')
const logger     = require('../utils/logger')

class AssessmentController {

  // ─── 发起测评 ────────────────────────────────────────────────
  // POST /api/caregiver/assessments
  // body: { customer_id, paper_id }
  async start(req, res) {
    const { customer_id, paper_id } = req.body
    const caregiverId = req.user.id

    if (!customer_id) return res.status(400).json({ code: 'INVALID_PARAM', message: '请指定老人' })
    if (!paper_id)    return res.status(400).json({ code: 'INVALID_PARAM', message: '请选择试卷' })

    // 验证管家权限
    const assignment = await req.db('caregiver_assignments')
      .where({ caregiver_id: caregiverId, customer_id }).first()
    if (!assignment) {
      return res.status(403).json({ code: 'FORBIDDEN', message: '您无权操作该老人' })
    }

    // 验证试卷已发布
    const paper = await req.db('exam_papers')
      .where({ id: paper_id, is_published: 1, is_active: 1 }).first()
    if (!paper) {
      return res.status(404).json({ code: 'NOT_FOUND', message: '试卷不存在或未发布' })
    }

    // 检查是否有进行中的同试卷测评
    const inProgress = await req.db('customer_assessments')
      .where({ customer_id, paper_id, status: 'in_progress' }).first()
    if (inProgress) {
      return res.status(409).json({
        code: 'ASSESSMENT_IN_PROGRESS',
        message: '该老人已有进行中的同类测评，请先完成或作废后再发起',
        data: { assessment_id: inProgress.id },
      })
    }

    // 获取试卷题目（用于快照）
    const paper_snapshot = { id: paper.id, name: paper.name, level: paper.level }

    const [assessmentId] = await req.db('customer_assessments').insert({
      customer_id,
      paper_id,
      paper_snapshot:  JSON.stringify(paper_snapshot),
      conducted_by:    caregiverId,
      status:          'in_progress',
      started_at:      req.db.fn.now(),
    })

    // 返回试卷题目供前端展示
    const questions = await this._getPaperQuestions(paper_id, req.db)

    logger.info(`测评发起: id=${assessmentId} customer=${customer_id} paper=${paper_id}`)

    return res.status(201).json({
      code: 'OK',
      data: { assessment_id: assessmentId, paper, questions },
    })
  }

  // ─── 批量提交答案（可多次调用，覆盖已答）───────────────────
  // POST /api/caregiver/assessments/:id/answers
  // body: { answers: [{ question_id, option_id }] }
  async submitAnswers(req, res) {
    const { id }      = req.params
    const { answers } = req.body

    if (!Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({ code: 'INVALID_PARAM', message: '请提供答案' })
    }

    const assessment = await this._getActiveAssessment(id, req, res)
    if (!assessment) return  // 已在内部处理响应

    // 验证选项有效性并获取分值
    const optionIds    = answers.map(a => a.option_id)
    const questionIds  = answers.map(a => a.question_id)

    const options = await req.db('question_options')
      .whereIn('id', optionIds)
      .select('id', 'question_id', 'score')

    const optionMap = new Map(options.map(o => [o.id, o]))

    // 确认所有 option_id 合法且属于对应 question_id
    for (const a of answers) {
      const opt = optionMap.get(a.option_id)
      if (!opt || opt.question_id !== a.question_id) {
        return res.status(400).json({
          code: 'INVALID_PARAM',
          message: `选项 ${a.option_id} 不属于题目 ${a.question_id}`,
        })
      }
    }

    // 逐条 upsert（相同 assessment+question 覆盖）
    await req.db.transaction(async trx => {
      for (const a of answers) {
        const opt = optionMap.get(a.option_id)
        await trx('customer_assessment_answers')
          .insert({
            assessment_id:      id,
            question_id:        a.question_id,
            selected_option_id: a.option_id,
            score:              opt.score,
          })
          .onConflict(['assessment_id', 'question_id'])
          .merge({ selected_option_id: a.option_id, score: opt.score })
      }
    })

    return res.json({ code: 'OK', message: `已保存 ${answers.length} 道答案` })
  }

  // ─── 完成测评（计算总分 + 任务引擎）────────────────────────
  // POST /api/caregiver/assessments/:id/complete
  async complete(req, res) {
    const { id } = req.params

    const assessment = await this._getActiveAssessment(id, req, res)
    if (!assessment) return

    // 获取所有必答题
    const requiredQs = await req.db('exam_paper_questions')
      .where({ paper_id: assessment.paper_id, is_required: 1 })
      .pluck('question_id')

    if (requiredQs.length > 0) {
      // 检查必答题是否已全部回答
      const answered = await req.db('customer_assessment_answers')
        .where('assessment_id', id)
        .whereIn('question_id', requiredQs)
        .pluck('question_id')
      const answeredSet = new Set(answered)
      const missing = requiredQs.filter(qId => !answeredSet.has(qId))
      if (missing.length > 0) {
        return res.status(400).json({
          code: 'INCOMPLETE',
          message: `还有 ${missing.length} 道必答题未作答`,
          data: { missing_question_ids: missing },
        })
      }
    }

    // 汇总总分 & 收集已选 option_id（用于任务引擎）
    const answerRows = await req.db('customer_assessment_answers')
      .where('assessment_id', id)
      .select('selected_option_id', 'score')

    const totalScore = answerRows.reduce((sum, r) => sum + (r.score || 0), 0)
    const optionIds  = answerRows.map(r => r.selected_option_id)

    // 更新测评状态
    await req.db('customer_assessments').where({ id }).update({
      status:       'completed',
      total_score:  totalScore,
      completed_at: req.db.fn.now(),
    })

    // 触发任务引擎（同步执行，出错不影响测评完成）
    let taskResult = { assigned: 0, skipped: 0 }
    try {
      taskResult = await taskEngine.assignTasksFromAssessment({
        customerId:   assessment.customer_id,
        assessmentId: id,
        optionIds,
        assignedBy:   req.user.id,
        db:           req.db,
      })
    } catch (err) {
      logger.error(`任务引擎执行失败（测评 ${id}）: ${err.message}`)
    }

    logger.info(`测评完成: id=${id} score=${totalScore} 分配任务=${taskResult.assigned}`)

    return res.json({
      code: 'OK',
      data: {
        assessment_id: Number(id),
        total_score:   totalScore,
        tasks_assigned: taskResult.assigned,
        tasks_skipped:  taskResult.skipped,
      },
      message: `测评完成，总分 ${totalScore}，新增 ${taskResult.assigned} 个任务分配`,
    })
  }

  // ─── 查询可用试卷列表 ────────────────────────────────────────
  // GET /api/assessments/papers
  async listPapers(req, res) {
    const rows = await req.db('exam_papers')
      .where({ is_published: 1, is_active: 1 })
      .orderBy('created_at', 'desc')
      .select('id', 'name', 'level', 'description', 'version', 'question_count')
    return res.json({ code: 'OK', data: { list: rows, total: rows.length } })
  }

  // ─── 查询老人历史测评列表 ────────────────────────────────────
  // GET /api/assessments?customer_id=xxx
  async list(req, res) {
    const { customer_id, page = 1, pageSize = 10 } = req.query
    if (!customer_id) return res.status(400).json({ code: 'INVALID_PARAM', message: '请指定老人' })

    const total = await req.db('customer_assessments')
      .where({ customer_id }).count('id as cnt').first()

    const rows = await req.db('customer_assessments as ca')
      .join('users as u', 'u.id', 'ca.conducted_by')
      .where({ 'ca.customer_id': customer_id })
      .orderBy('ca.started_at', 'desc')
      .offset((Number(page) - 1) * Number(pageSize))
      .limit(Number(pageSize))
      .select(
        'ca.id', 'ca.paper_id', 'ca.paper_snapshot',
        'ca.status', 'ca.total_score',
        'ca.started_at', 'ca.completed_at',
        'u.name as conducted_by_name'
      )

    return res.json({
      code: 'OK',
      data: { list: rows, total: Number(total.cnt), page: Number(page), pageSize: Number(pageSize) },
    })
  }

  // ─── 查询单次测评详情（含答案）──────────────────────────────
  // GET /api/caregiver/assessments/:id
  async detail(req, res) {
    const { id } = req.params

    const assessment = await req.db('customer_assessments').where({ id }).first()
    if (!assessment) return res.status(404).json({ code: 'NOT_FOUND', message: '测评记录不存在' })

    // 拉取答题记录（含题目内容 + 选项）
    const answers = await req.db('customer_assessment_answers as caa')
      .join('question_bank as q',   'q.id',   'caa.question_id')
      .join('question_options as qo', 'qo.id', 'caa.selected_option_id')
      .where('caa.assessment_id', id)
      .select(
        'q.id as question_id', 'q.code', 'q.content', 'q.dimension',
        'qo.id as option_id', 'qo.label', 'qo.content as option_content',
        'caa.score'
      )

    return res.json({ code: 'OK', data: { ...assessment, answers } })
  }

  // ─── 内部：获取进行中测评（含权限验证）────────────────────────
  async _getActiveAssessment(id, req, res) {
    const assessment = await req.db('customer_assessments').where({ id }).first()
    if (!assessment) {
      res.status(404).json({ code: 'NOT_FOUND', message: '测评记录不存在' })
      return null
    }
    if (assessment.status !== 'in_progress') {
      res.status(400).json({ code: 'ASSESSMENT_ENDED', message: '测评已完成，不可修改' })
      return null
    }
    // 仅本人或管理员可操作
    if (req.user.role !== 'admin' && assessment.conducted_by !== req.user.id) {
      res.status(403).json({ code: 'FORBIDDEN', message: '无权操作此测评' })
      return null
    }
    return assessment
  }

  // ─── 内部：获取试卷题目（带选项）──────────────────────────────
  async _getPaperQuestions(paperId, db) {
    const questions = await db('exam_paper_questions as epq')
      .join('question_bank as q', 'q.id', 'epq.question_id')
      .where({ 'epq.paper_id': paperId })
      .orderBy('epq.seq_no')
      .select(
        'epq.seq_no', 'epq.is_required',
        'q.id as question_id', 'q.code', 'q.content', 'q.dimension', 'q.type'
      )

    if (questions.length === 0) return []

    const qIds   = questions.map(q => q.question_id)
    const options = await db('question_options')
      .whereIn('question_id', qIds)
      .orderBy('question_id').orderBy('seq_no')
      .select('id', 'question_id', 'label', 'content', 'score')

    const optMap = {}
    for (const o of options) {
      if (!optMap[o.question_id]) optMap[o.question_id] = []
      optMap[o.question_id].push(o)
    }
    questions.forEach(q => { q.options = optMap[q.question_id] || [] })

    return questions
  }
}

module.exports = new AssessmentController()
