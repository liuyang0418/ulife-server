// src/controllers/taskLibraryController.js
// 任务库管理（管理员 CRUD）

class TaskLibraryController {

  // ─── 任务库列表 ───────────────────────────────────────────────
  async list(req, res) {
    const { category, keyword, page = 1, pageSize = 20, active } = req.query
    const query = req.db('task_library')
      .modify(b => {
        if (category) b.where('category', category)
        if (keyword)  b.where('name', 'like', `%${keyword}%`)
        if (active !== undefined) b.where('is_active', active === 'true' ? 1 : 0)
      })
      .orderBy('category').orderBy('sort_order' in req.query ? 'sort_order' : 'id')

    const total = await query.clone().count('id as cnt').first()
    const rows  = await query
      .offset((Number(page) - 1) * Number(pageSize)).limit(Number(pageSize))
      .select('id','code','name','category','description','video_guide',
               'min_duration','max_duration','points_value','difficulty','tags','is_active','created_at')

    return res.json({ code: 'OK', data: { list: rows, total: Number(total.cnt), page: Number(page), pageSize: Number(pageSize) } })
  }

  // ─── 任务分类列表 ─────────────────────────────────────────────
  async categories(req, res) {
    const cats = await req.db('task_library').distinct('category').orderBy('category').pluck('category')
    return res.json({ code: 'OK', data: cats })
  }

  // ─── 创建任务 ─────────────────────────────────────────────────
  async create(req, res) {
    const { code, name, category, description, video_guide, min_duration = 5,
            max_duration = 60, points_value = 10, difficulty = 1, tags } = req.body

    if (!name?.trim())     return res.status(400).json({ code: 'INVALID_PARAM', message: '任务名称不能为空' })
    if (!category?.trim()) return res.status(400).json({ code: 'INVALID_PARAM', message: '任务分类不能为空' })

    const finalCode = code?.trim() || await this._genCode(category, req.db)

    const [id] = await req.db('task_library').insert({
      code: finalCode, name: name.trim(), category: category.trim(),
      description: description?.trim() || null,
      video_guide: video_guide?.trim() || null,
      min_duration, max_duration, points_value, difficulty,
      tags: tags ? JSON.stringify(tags) : null,
      is_active: 1, created_by: req.user.id, created_at: req.db.fn.now(),
    })

    return res.status(201).json({ code: 'OK', data: { id }, message: '任务已创建' })
  }

  // ─── 更新任务 ─────────────────────────────────────────────────
  async update(req, res) {
    const { id } = req.params
    const { name, category, description, video_guide, min_duration, max_duration,
            points_value, difficulty, tags, is_active } = req.body

    const updates = { updated_at: req.db.fn.now() }
    if (name !== undefined)         updates.name         = name.trim()
    if (category !== undefined)     updates.category     = category.trim()
    if (description !== undefined)  updates.description  = description?.trim() || null
    if (video_guide !== undefined)  updates.video_guide  = video_guide?.trim() || null
    if (min_duration !== undefined) updates.min_duration = Number(min_duration)
    if (max_duration !== undefined) updates.max_duration = Number(max_duration)
    if (points_value !== undefined) updates.points_value = Number(points_value)
    if (difficulty !== undefined)   updates.difficulty   = Number(difficulty)
    if (tags !== undefined)         updates.tags         = tags ? JSON.stringify(tags) : null
    if (is_active !== undefined)    updates.is_active    = is_active ? 1 : 0

    await req.db('task_library').where({ id }).update(updates)
    return res.json({ code: 'OK', message: '任务已更新' })
  }

  // ─── 内部：生成任务编码 ───────────────────────────────────────
  async _genCode(category, db) {
    const count = await db('task_library').where('category', category).count('id as cnt').first()
    const prefix = category.slice(0, 3).toUpperCase()
    return `TASK-${prefix}-${String(Number(count.cnt) + 1).padStart(3, '0')}`
  }
}

module.exports = new TaskLibraryController()
