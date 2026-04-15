// src/controllers/examPaperController.js
// 试卷管理 —— 管理员组卷、改名、增删题目

class ExamPaperController {

  // ─── 试卷列表 ───────────────────────────────────────────────
  async list(req, res) {
    const { level, published } = req.query
    const papers = await req.db('exam_papers')
      .modify(b => {
        if (level !== undefined)     b.where('level', level)
        if (published !== undefined) b.where('is_published', published === 'true' ? 1 : 0)
      })
      .where('is_active', 1)
      .orderBy('created_at', 'desc')
      .select('id','name','description','level','is_published',
               'question_count','created_at','updated_at')

    res.json({ code: 'OK', data: papers })
  }

  // ─── 创建试卷（空壳，再逐题添加）────────────────────────────
  async create(req, res) {
    const { name, description, level = 1 } = req.body
    const adminId = req.user.id

    if (!name?.trim()) return res.status(400).json({ message: '试卷名称不能为空' })

    const [id] = await req.db('exam_papers').insert({
      name:       name.trim(),
      description: description?.trim() || null,
      level,
      created_by: adminId,
    })

    res.json({ code: 'OK', data: { id }, message: '试卷已创建' })
  }

  // ─── 重命名试卷（已发布也可改名）────────────────────────────
  async rename(req, res) {
    const { id }   = req.params
    const { name, description } = req.body

    if (!name?.trim()) return res.status(400).json({ message: '名称不能为空' })

    await req.db('exam_papers').where({ id }).update({
      name:        name.trim(),
      description: description !== undefined ? (description?.trim() || null) : undefined,
      updated_by:  req.user.id,
    })

    res.json({ code: 'OK', message: '试卷已重命名' })
  }

  // ─── 获取试卷详情（含题目+选项完整信息）────────────────────
  async detail(req, res) {
    const { id } = req.params

    const paper = await req.db('exam_papers').where({ id }).first()
    if (!paper) return res.status(404).json({ message: '试卷不存在' })

    const questions = await req.db('exam_paper_questions as epq')
      .join('question_bank as q', 'q.id', 'epq.question_id')
      .where({ 'epq.paper_id': id })
      .orderBy('epq.seq_no')
      .select(
        'epq.id as mappingId', 'epq.seq_no', 'epq.is_required',
        'q.id as questionId', 'q.code', 'q.content',
        'q.dimension', 'q.type', 'q.remark'
      )

    // 批量拉选项
    const qIds = questions.map(q => q.questionId)
    const options = qIds.length
      ? await req.db('question_options')
          .whereIn('question_id', qIds).orderBy('question_id').orderBy('seq_no')
          .select('id','question_id','label','content','score')
      : []
    const optMap = {}
    for (const o of options) {
      if (!optMap[o.question_id]) optMap[o.question_id] = []
      optMap[o.question_id].push(o)
    }
    questions.forEach(q => { q.options = optMap[q.questionId] || [] })

    // 统计总分范围
    let maxScore = 0, minScore = 0
    for (const q of questions) {
      if (q.options.length) {
        maxScore += Math.max(...q.options.map(o => o.score))
        minScore += Math.min(...q.options.map(o => o.score))
      }
    }

    res.json({
      code: 'OK',
      data: { ...paper, questions, scoreRange: { min: minScore, max: maxScore } }
    })
  }

  // ─── 向试卷添加题目（支持批量）──────────────────────────────
  async addQuestions(req, res) {
    const { id }          = req.params
    const { questionIds } = req.body  // Array of question IDs
    const adminId         = req.user.id

    const paper = await req.db('exam_papers').where({ id, is_active: 1 }).first()
    if (!paper)            return res.status(404).json({ message: '试卷不存在' })
    if (paper.is_published) return res.status(403).json({ code: 'PUBLISHED', message: '试卷已发布，不可添加题目' })

    if (!Array.isArray(questionIds) || questionIds.length === 0) {
      return res.status(400).json({ message: '请选择要添加的题目' })
    }

    // 验证题目有效性
    const validQs = await req.db('question_bank')
      .whereIn('id', questionIds).where('is_active', 1).pluck('id')
    if (validQs.length !== questionIds.length) {
      return res.status(400).json({ message: '包含无效或已停用的题目' })
    }

    // 已存在的题目
    const existing = await req.db('exam_paper_questions')
      .where('paper_id', id).whereIn('question_id', questionIds).pluck('question_id')
    const existingSet = new Set(existing)

    // 获取当前最大序号
    const maxSeq = await req.db('exam_paper_questions')
      .where('paper_id', id).max('seq_no as maxSeq').first()
    let seqNo = (maxSeq?.maxSeq || 0) + 1

    const toInsert = []
    const skipped  = []
    for (const qId of questionIds) {
      if (existingSet.has(qId)) { skipped.push(qId); continue }
      toInsert.push({ paper_id: id, question_id: qId, seq_no: seqNo++, added_by: adminId })
    }

    if (toInsert.length > 0) {
      await req.db.transaction(async trx => {
        await trx('exam_paper_questions').insert(toInsert)
        await trx('exam_papers').where({ id })
          .update({ question_count: req.db.raw('question_count + ?', [toInsert.length]), updated_by: adminId })
      })
    }

    res.json({
      code: 'OK',
      data: { added: toInsert.length, skipped: skipped.length },
      message: `已添加 ${toInsert.length} 道题${skipped.length ? `，${skipped.length} 道已存在跳过` : ''}`
    })
  }

  // ─── 从试卷移除题目 ──────────────────────────────────────────
  async removeQuestion(req, res) {
    const { id, questionId } = req.params
    const adminId            = req.user.id

    const paper = await req.db('exam_papers').where({ id }).first()
    if (!paper)             return res.status(404).json({ message: '试卷不存在' })
    if (paper.is_published) return res.status(403).json({ code: 'PUBLISHED', message: '试卷已发布，不可删除题目' })

    const deleted = await req.db('exam_paper_questions')
      .where({ paper_id: id, question_id: questionId }).delete()

    if (deleted) {
      await req.db('exam_papers').where({ id })
        .update({ question_count: req.db.raw('GREATEST(question_count - 1, 0)'), updated_by: adminId })
      // 重排序号
      await this._reorder(id, req.db)
    }

    res.json({ code: 'OK', message: deleted ? '题目已移除' : '题目不存在' })
  }

  // ─── 拖拽调整题目顺序 ────────────────────────────────────────
  async reorder(req, res) {
    const { id }       = req.params
    const { orderedIds } = req.body  // 按新顺序排列的 question_id 数组
    const adminId      = req.user.id

    const paper = await req.db('exam_papers').where({ id }).first()
    if (!paper)             return res.status(404).json({ message: '试卷不存在' })
    if (paper.is_published) return res.status(403).json({ code: 'PUBLISHED', message: '试卷已发布，不可调整顺序' })

    await req.db.transaction(async trx => {
      for (let i = 0; i < orderedIds.length; i++) {
        await trx('exam_paper_questions')
          .where({ paper_id: id, question_id: orderedIds[i] })
          .update({ seq_no: i + 1 })
      }
      await trx('exam_papers').where({ id }).update({ updated_by: adminId })
    })

    res.json({ code: 'OK', message: '顺序已更新' })
  }

  // ─── 设置题目是否必答 ─────────────────────────────────────────
  async setRequired(req, res) {
    const { id, questionId } = req.params
    const { isRequired }     = req.body

    const paper = await req.db('exam_papers').where({ id }).first()
    if (paper?.is_published) return res.status(403).json({ message: '试卷已发布，不可修改' })

    await req.db('exam_paper_questions')
      .where({ paper_id: id, question_id: questionId })
      .update({ is_required: isRequired ? 1 : 0 })

    res.json({ code: 'OK' })
  }

  // ─── 发布试卷（发布后锁定，可用于测评）───────────────────────
  async publish(req, res) {
    const { id }   = req.params
    const adminId  = req.user.id

    const paper = await req.db('exam_papers').where({ id }).first()
    if (!paper)             return res.status(404).json({ message: '试卷不存在' })
    if (paper.is_published) return res.json({ code: 'OK', message: '试卷已是发布状态' })
    if (paper.question_count < 1) {
      return res.status(400).json({ message: '试卷至少需要1道题目才能发布' })
    }

    await req.db('exam_papers').where({ id }).update({
      is_published: 1, updated_by: adminId
    })

    res.json({ code: 'OK', message: '试卷已发布，现可用于客户测评' })
  }

  // ─── 撤销发布（若无客户使用此卷则允许撤销）──────────────────
  async unpublish(req, res) {
    const { id } = req.params

    const inUse = await req.db('customer_assessments').where({ paper_id: id }).first()
    if (inUse) {
      return res.status(403).json({ message: '已有客户使用此试卷进行测评，不可撤销发布' })
    }

    await req.db('exam_papers').where({ id })
      .update({ is_published: 0, updated_by: req.user.id })

    res.json({ code: 'OK', message: '已撤销发布，试卷重新变为可编辑状态' })
  }

  // ─── 复制试卷（快速基于已有卷创建新卷）──────────────────────
  async duplicate(req, res) {
    const { id }   = req.params
    const adminId  = req.user.id

    const paper = await req.db('exam_papers').where({ id }).first()
    if (!paper) return res.status(404).json({ message: '试卷不存在' })

    const questions = await req.db('exam_paper_questions').where({ paper_id: id }).orderBy('seq_no')

    const [newId] = await req.db('exam_papers').insert({
      name:           `${paper.name}（副本）`,
      description:    paper.description,
      level:          paper.level,
      is_published:   0,
      question_count: paper.question_count,
      created_by:     adminId,
    })

    if (questions.length > 0) {
      await req.db('exam_paper_questions').insert(
        questions.map(q => ({
          paper_id:    newId,
          question_id: q.question_id,
          seq_no:      q.seq_no,
          is_required: q.is_required,
          added_by:    adminId,
        }))
      )
    }

    res.json({ code: 'OK', data: { id: newId }, message: '试卷已复制' })
  }

  // ─── 内部：重新整理题目序号 ───────────────────────────────────
  async _reorder(paperId, db) {
    const rows = await db('exam_paper_questions')
      .where({ paper_id: paperId }).orderBy('seq_no').select('id')
    for (let i = 0; i < rows.length; i++) {
      await db('exam_paper_questions').where({ id: rows[i].id }).update({ seq_no: i + 1 })
    }
  }
}

module.exports = new ExamPaperController()
