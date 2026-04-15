// src/controllers/questionBankController.js
// 题库管理 —— 管理员 CRUD

class QuestionBankController {

  // ─── 题目列表（支持维度/关键词筛选）────────────────────────────
  async list(req, res) {
    const { dimension, keyword, page = 1, pageSize = 20, active } = req.query

    const query = req.db('question_bank as q')
      .modify(b => {
        if (dimension) b.where('q.dimension', dimension)
        if (active !== undefined) b.where('q.is_active', active === 'true' ? 1 : 0)
        if (keyword)   b.where('q.content', 'like', `%${keyword}%`)
      })
      .orderBy('q.sort_order').orderBy('q.id')

    const total = await query.clone().count('q.id as cnt').first()
    const questions = await query
      .offset((page - 1) * pageSize).limit(Number(pageSize))
      .select('q.id','q.code','q.content','q.dimension','q.type',
               'q.remark','q.is_active','q.sort_order','q.created_at')

    // 批量拉取所有选项
    const qIds = questions.map(q => q.id)
    const options = qIds.length
      ? await req.db('question_options')
          .whereIn('question_id', qIds)
          .orderBy('question_id').orderBy('seq_no')
          .select('id','question_id','seq_no','label','content','score')
      : []

    const optMap = {}
    for (const o of options) {
      if (!optMap[o.question_id]) optMap[o.question_id] = []
      optMap[o.question_id].push(o)
    }
    questions.forEach(q => { q.options = optMap[q.id] || [] })

    res.json({ code: 'OK', data: { list: questions, total: Number(total.cnt), page, pageSize } })
  }

  // ─── 获取所有维度（用于筛选下拉）────────────────────────────────
  async dimensions(req, res) {
    const rows = await req.db('question_bank')
      .distinct('dimension').orderBy('dimension').pluck('dimension')
    res.json({ code: 'OK', data: rows })
  }

  // ─── 新增题目（含选项）────────────────────────────────────────
  async create(req, res) {
    const { code, content, dimension, type = 'single', remark, options } = req.body
    const adminId = req.user.id

    // 参数校验
    if (!content?.trim()) return res.status(400).json({ message: '题目内容不能为空' })
    if (!dimension?.trim()) return res.status(400).json({ message: '请选择能力维度' })
    if (!Array.isArray(options) || options.length < 2) {
      return res.status(400).json({ message: '至少需要2个选项' })
    }
    if (options.length > 6) {
      return res.status(400).json({ message: '最多支持6个选项' })
    }

    // 自动生成编码（若未传）
    const finalCode = code?.trim() || await this._genCode(dimension, req.db)

    await req.db.transaction(async trx => {
      const [qId] = await trx('question_bank').insert({
        code:       finalCode,
        content:    content.trim(),
        dimension:  dimension.trim(),
        type,
        remark:     remark?.trim() || null,
        created_by: adminId,
      })

      const labels = ['A','B','C','D','E','F']
      const optRows = options.map((o, i) => ({
        question_id: qId,
        seq_no:      i + 1,
        label:       labels[i],
        content:     o.content.trim(),
        score:       Number(o.score) || 0,
      }))
      await trx('question_options').insert(optRows)

      res.json({ code: 'OK', data: { id: qId }, message: '题目创建成功' })
    })
  }

  // ─── 更新题目（草稿状态才可修改）─────────────────────────────
  async update(req, res) {
    const { id } = req.params
    const { content, dimension, remark, options, is_active } = req.body
    const adminId = req.user.id

    // 检查是否已被发布的试卷使用
    const inPublished = await req.db('exam_paper_questions as epq')
      .join('exam_papers as ep', 'ep.id', 'epq.paper_id')
      .where({ 'epq.question_id': id, 'ep.is_published': 1 })
      .first()

    if (inPublished && (content || dimension || options)) {
      return res.status(403).json({
        code: 'LOCKED',
        message: '该题目已被发布的试卷引用，不可修改题目内容，只能修改启用状态'
      })
    }

    await req.db.transaction(async trx => {
      const updates = { updated_at: new Date() }
      if (content)    updates.content   = content.trim()
      if (dimension)  updates.dimension = dimension.trim()
      if (remark !== undefined) updates.remark = remark?.trim() || null
      if (is_active !== undefined) updates.is_active = is_active ? 1 : 0

      await trx('question_bank').where({ id }).update(updates)

      // 更新选项（先删后插）
      if (Array.isArray(options) && options.length >= 2) {
        await trx('question_options').where({ question_id: id }).delete()
        const labels = ['A','B','C','D','E','F']
        await trx('question_options').insert(
          options.map((o, i) => ({
            question_id: id,
            seq_no:      i + 1,
            label:       labels[i],
            content:     o.content.trim(),
            score:       Number(o.score) || 0,
          }))
        )
      }
    })

    res.json({ code: 'OK', message: '题目已更新' })
  }

  // ─── 批量导入题目（JSON格式）─────────────────────────────────
  async batchImport(req, res) {
    const { questions } = req.body  // Array of question objects
    const adminId = req.user.id

    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ message: '请提供题目数据' })
    }

    const results = { success: 0, failed: 0, errors: [] }

    for (const [idx, q] of questions.entries()) {
      try {
        const code = q.code?.trim() || await this._genCode(q.dimension, req.db)
        await req.db.transaction(async trx => {
          const [qId] = await trx('question_bank').insert({
            code, content: q.content.trim(), dimension: q.dimension.trim(),
            type: 'single', remark: q.remark || null, created_by: adminId,
          })
          const labels = ['A','B','C','D','E','F']
          await trx('question_options').insert(
            q.options.map((o, i) => ({
              question_id: qId, seq_no: i+1, label: labels[i],
              content: o.content.trim(), score: Number(o.score) || 0,
            }))
          )
        })
        results.success++
      } catch (e) {
        results.failed++
        results.errors.push({ index: idx, content: q.content?.slice(0, 20), error: e.message })
      }
    }

    res.json({ code: 'OK', data: results, message: `导入完成：成功${results.success}条，失败${results.failed}条` })
  }

  // ─── 内部：生成题目编码 ───────────────────────────────────────
  async _genCode(dimension, db) {
    const dimMap = { '运动': 'MOT', '认知': 'COG', '饮食': 'DIET',
                     '社交': 'SOC', '睡眠': 'SLP', '情绪': 'EMO' }
    const prefix = dimMap[dimension] || 'GEN'
    const count  = await db('question_bank')
      .where('dimension', dimension).count('id as cnt').first()
    return `QB-${prefix}-${String(Number(count.cnt) + 1).padStart(3, '0')}`
  }
}

module.exports = new QuestionBankController()
