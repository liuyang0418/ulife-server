/**
 * scripts/seed.js — 开发环境样例数据
 * 运行：node scripts/seed.js
 */
import 'dotenv/config'
import bcrypt from 'bcryptjs'
import knex from 'knex'

const db = knex({
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  },
})

const log = (msg) => console.log(`[seed] ${msg}`)

async function seed() {
  try {
    // ── 1. 检查管理员账号 ─────────────────────────────────
    const admin = await db('users').where({ role: 'admin' }).first()
    if (!admin) {
      const hash = await bcrypt.hash('Admin@123456', 10)
      await db('users').insert({
        name: '系统管理员', phone: '13000000000',
        password_hash: hash, role: 'admin', is_active: 1,
      })
      log('管理员账号已创建 13000000000 / Admin@123456')
    } else {
      log(`管理员已存在：${admin.phone}`)
    }
    const adminUser = await db('users').where({ role: 'admin' }).first()

    // ── 2. 管家账号 ───────────────────────────────────────
    const caregivers = [
      { name: '李管家', phone: '13100000001' },
      { name: '王管家', phone: '13100000002' },
      { name: '张管家', phone: '13100000003' },
    ]
    const caregiverIds = []
    for (const c of caregivers) {
      let u = await db('users').where({ phone: c.phone }).first()
      if (!u) {
        const hash = await bcrypt.hash('Ulife@2024', 10)
        const [id] = await db('users').insert({ ...c, password_hash: hash, role: 'caregiver', is_active: 1 })
        caregiverIds.push(id)
        log(`管家已创建：${c.name}（${c.phone}）`)
      } else {
        caregiverIds.push(u.id)
        log(`管家已存在：${c.name}`)
      }
    }

    // ── 3. 老人账号 + 档案 ────────────────────────────────
    const elders = [
      { name: '张爷爷', phone: '13200000001', birth_date: '1940-03-15', gender: 'M', room_no: 'A-101', emergency_contact: '张小明/138xxxxxxxx' },
      { name: '李奶奶', phone: '13200000002', birth_date: '1942-07-22', gender: 'F', room_no: 'A-102', emergency_contact: '李芳/139xxxxxxxx' },
      { name: '王爷爷', phone: '13200000003', birth_date: '1938-11-08', gender: 'M', room_no: 'B-201', emergency_contact: '王强/136xxxxxxxx' },
      { name: '赵奶奶', phone: '13200000004', birth_date: '1945-05-30', gender: 'F', room_no: 'B-202', emergency_contact: '赵磊/137xxxxxxxx' },
      { name: '陈爷爷', phone: '13200000005', birth_date: '1936-09-12', gender: 'M', room_no: 'C-301', emergency_contact: '陈丽/135xxxxxxxx' },
    ]
    const customerIds = []
    for (let i = 0; i < elders.length; i++) {
      const e = elders[i]
      let u = await db('users').where({ phone: e.phone }).first()
      if (!u) {
        const hash = await bcrypt.hash('Ulife@2024', 10)
        const [uid] = await db('users').insert({ name: e.name, phone: e.phone, password_hash: hash, role: 'elder', is_active: 1 })
        u = { id: uid }
        log(`老人账号已创建：${e.name}`)
      }
      let cust = await db('customers').where({ user_id: u.id }).first()
      if (!cust) {
        const [cid] = await db('customers').insert({
          user_id: u.id, name: e.name, phone: e.phone,
          birth_date: e.birth_date, gender: e.gender,
          room_no: e.room_no, emergency_contact: e.emergency_contact,
          joined_date: '2024-01-01', is_active: 1, is_cancelled: 0,
        })
        customerIds.push(cid)
        log(`老人档案已创建：${e.name}（房间 ${e.room_no}）`)
      } else {
        customerIds.push(cust.id)
        log(`老人档案已存在：${e.name}`)
      }
    }

    // ── 4. 管家-老人分配 ──────────────────────────────────
    // 管家0负责老人0,1；管家1负责老人2,3；管家2负责老人4
    const assignments = [
      [caregiverIds[0], customerIds[0]],
      [caregiverIds[0], customerIds[1]],
      [caregiverIds[1], customerIds[2]],
      [caregiverIds[1], customerIds[3]],
      [caregiverIds[2], customerIds[4]],
    ]
    for (const [cid, kid] of assignments) {
      const exists = await db('caregiver_assignments').where({ caregiver_id: cid, customer_id: kid }).first()
      if (!exists) {
        await db('caregiver_assignments').insert({ caregiver_id: cid, customer_id: kid })
        log(`分配：管家${cid} → 老人${kid}`)
      }
    }

    // ── 5. 积分余额初始化 ─────────────────────────────────
    for (const cid of customerIds) {
      const bal = await db('points_balance').where({ customer_id: cid }).first()
      if (!bal) {
        const initPoints = Math.floor(Math.random() * 200) + 50
        await db('points_balance').insert({
          customer_id: cid, current_balance: initPoints,
          total_earned: initPoints, total_redeemed: 0, total_expired: 0,
        })
        await db('points_ledger').insert({
          customer_id: cid, action: 'earn_admin', points: initPoints,
          balance_after: initPoints, remark: '入住赠送积分',
          operator_id: adminUser.id, operator_role: 'admin',
        })
        log(`积分初始化：老人${cid} = ${initPoints}分`)
      }
    }

    // ── 6. AFI记录（近6个月趋势）─────────────────────────
    for (let ci = 0; ci < customerIds.length; ci++) {
      const cid = customerIds[ci]
      const existing = await db('afi_records').where({ customer_id: cid }).count('id as cnt').first()
      if (existing.cnt > 0) { log(`AFI记录已存在：老人${cid}`); continue }
      const baseScore = 55 + Math.floor(Math.random() * 30)
      for (let m = 5; m >= 0; m--) {
        const date = new Date()
        date.setMonth(date.getMonth() - m)
        const score = Math.max(30, Math.min(95, baseScore + Math.floor(Math.random() * 10) - 5))
        const daysFromStart = (5 - m) * 30 + Math.floor(Math.random() * 10)
        await db('afi_records').insert({
          customer_id: cid,
          recorded_by: caregiverIds[Math.floor(ci / 2)] || caregiverIds[0],
          record_date: date.toISOString().slice(0, 10),
          afi_value: score,
          days_from_start: daysFromStart,
          is_anomaly: 0, is_deleted: 0,
        })
      }
      log(`AFI记录已写入：老人${cid}（近6个月）`)
    }

    // ── 7. 任务库 ─────────────────────────────────────────
    const taskLibraryItems = [
      { code: 'TL-001', name: '晨间体操', category: 'exercise', description: '每日清晨进行15分钟广场舞或健身操，促进血液循环', points_value: 20, difficulty: 1 },
      { code: 'TL-002', name: '散步30分钟', category: 'exercise', description: '在院内或周边进行适度散步，保持基本运动量', points_value: 15, difficulty: 1 },
      { code: 'TL-003', name: '按时服药', category: 'health', description: '按照医嘱准时服药，拍照打卡记录', points_value: 30, difficulty: 1 },
      { code: 'TL-004', name: '血压测量记录', category: 'health', description: '每日晨起测量血压并记录数值', points_value: 25, difficulty: 1 },
      { code: 'TL-005', name: '棋牌益智活动', category: 'cognitive', description: '参与棋牌、拼图等益智游戏，锻炼思维能力', points_value: 20, difficulty: 2 },
      { code: 'TL-006', name: '阅读报纸杂志', category: 'cognitive', description: '每日阅读30分钟以上，保持认知活跃', points_value: 15, difficulty: 1 },
      { code: 'TL-007', name: '参加集体活动', category: 'social', description: '参与院内组织的集体文娱活动', points_value: 30, difficulty: 2 },
      { code: 'TL-008', name: '视频联系家人', category: 'social', description: '通过视频通话与家人保持联系，维护情感纽带', points_value: 20, difficulty: 1 },
      { code: 'TL-009', name: '营养膳食打卡', category: 'diet', description: '按时按量完成三餐，拍照记录饮食情况', points_value: 15, difficulty: 1 },
      { code: 'TL-010', name: '冥想放松练习', category: 'mental', description: '每日进行10分钟冥想或呼吸练习，改善睡眠质量', points_value: 20, difficulty: 2 },
    ]
    for (const t of taskLibraryItems) {
      const exists = await db('task_library').where({ code: t.code }).first()
      if (!exists) {
        await db('task_library').insert({ ...t, min_duration: 5, max_duration: 60, is_active: 1, created_by: adminUser.id })
        log(`任务库：${t.name}`)
      }
    }

    // ── 8. 服务套餐 ───────────────────────────────────────
    const packages = [
      { name: '基础照护套餐', price_fen: 39900, valid_days: 30, description: '包含日常生活照护、健康监测、基础任务管理', is_active: 1 },
      { name: '全程护理套餐', price_fen: 79900, valid_days: 30, description: '包含全天候专业照护、医疗协助、家庭联动服务', is_active: 1 },
      { name: '年度健康套餐', price_fen: 399900, valid_days: 365, description: '全年综合照护服务，享受折扣优惠', is_active: 1 },
    ]
    for (const p of packages) {
      const exists = await db('service_packages').where({ name: p.name }).first()
      if (!exists) {
        await db('service_packages').insert(p)
        log(`服务套餐：${p.name}（¥${p.price_fen / 100}/期）`)
      }
    }

    // ── 9. 积分商城商品 ───────────────────────────────────
    const products = [
      { name: '有机苹果礼盒', description: '新鲜有机苹果，约5斤，产地直发', points_price: 100, stock: 50, valid_days: 30, category: 'food' },
      { name: '保健按摩枕', description: '颈部按摩枕，舒缓颈椎疲劳', points_price: 300, stock: 20, valid_days: 60, category: 'health' },
      { name: '院内消费券(10元)', description: '可在院内食堂、便利店使用', points_price: 80, stock: 100, valid_days: 90, category: 'coupon' },
      { name: '专业理发服务', description: '专业理发师上门服务一次', points_price: 150, stock: 30, valid_days: 30, category: 'service' },
      { name: '有声书月卡', description: '优质有声读物会员月卡', points_price: 50, stock: -1, valid_days: 30, category: 'digital' },
      { name: '定制生日蛋糕', description: '8寸定制生日蛋糕，提前3天预约', points_price: 500, stock: 10, valid_days: 60, category: 'food' },
    ]
    for (const p of products) {
      const exists = await db('mall_products').where({ name: p.name }).first()
      if (!exists) {
        await db('mall_products').insert({ ...p, sort_order: 0, is_active: 1, created_by: adminUser.id })
        log(`商城商品：${p.name}（${p.points_price}积分）`)
      }
    }

    // ── 10. 题库 + 量表 ───────────────────────────────────
    const existingQ = await db('question_bank').count('id as cnt').first()
    if (existingQ.cnt === 0) {
      // 题目数据
      const questions = [
        { code: 'QB-MOTOR-001', content: '您今天能否独立完成穿衣动作？', dimension: '运动', options: [
          { seq_no: 1, label: 'A', content: '完全独立完成', score: 4 },
          { seq_no: 2, label: 'B', content: '需要少量辅助', score: 3 },
          { seq_no: 3, label: 'C', content: '需要较多辅助', score: 2 },
          { seq_no: 4, label: 'D', content: '完全依赖他人', score: 1 },
        ]},
        { code: 'QB-MOTOR-002', content: '您今天能否独立行走50米？', dimension: '运动', options: [
          { seq_no: 1, label: 'A', content: '能独立行走', score: 4 },
          { seq_no: 2, label: 'B', content: '需要辅助工具', score: 3 },
          { seq_no: 3, label: 'C', content: '需要人搀扶', score: 2 },
          { seq_no: 4, label: 'D', content: '无法行走', score: 1 },
        ]},
        { code: 'QB-COG-001', content: '您今天能否记住今日的日期和星期？', dimension: '认知', options: [
          { seq_no: 1, label: 'A', content: '完全记得', score: 4 },
          { seq_no: 2, label: 'B', content: '记得大概', score: 3 },
          { seq_no: 3, label: 'C', content: '有些混乱', score: 2 },
          { seq_no: 4, label: 'D', content: '完全不记得', score: 1 },
        ]},
        { code: 'QB-COG-002', content: '您今天是否能正常与人对话？', dimension: '认知', options: [
          { seq_no: 1, label: 'A', content: '表达清晰流畅', score: 4 },
          { seq_no: 2, label: 'B', content: '偶有词不达意', score: 3 },
          { seq_no: 3, label: 'C', content: '经常理解困难', score: 2 },
          { seq_no: 4, label: 'D', content: '基本无法交流', score: 1 },
        ]},
        { code: 'QB-DIET-001', content: '您今天三餐进食情况如何？', dimension: '饮食', options: [
          { seq_no: 1, label: 'A', content: '正常进食', score: 4 },
          { seq_no: 2, label: 'B', content: '食欲略减', score: 3 },
          { seq_no: 3, label: 'C', content: '进食明显减少', score: 2 },
          { seq_no: 4, label: 'D', content: '基本未进食', score: 1 },
        ]},
        { code: 'QB-SOC-001', content: '您今天是否参与了集体活动？', dimension: '社交', options: [
          { seq_no: 1, label: 'A', content: '主动参与多项活动', score: 4 },
          { seq_no: 2, label: 'B', content: '参与了1项活动', score: 3 },
          { seq_no: 3, label: 'C', content: '在室内与人交谈', score: 2 },
          { seq_no: 4, label: 'D', content: '独处未与人交流', score: 1 },
        ]},
        { code: 'QB-SLEEP-001', content: '您昨晚的睡眠质量如何？', dimension: '睡眠', options: [
          { seq_no: 1, label: 'A', content: '睡眠良好（7小时以上）', score: 4 },
          { seq_no: 2, label: 'B', content: '轻度失眠（5-7小时）', score: 3 },
          { seq_no: 3, label: 'C', content: '中度失眠（3-5小时）', score: 2 },
          { seq_no: 4, label: 'D', content: '严重失眠（3小时以内）', score: 1 },
        ]},
        { code: 'QB-EMO-001', content: '您今天的情绪状态如何？', dimension: '情绪', options: [
          { seq_no: 1, label: 'A', content: '心情愉快开朗', score: 4 },
          { seq_no: 2, label: 'B', content: '情绪平稳正常', score: 3 },
          { seq_no: 3, label: 'C', content: '略感焦虑或低落', score: 2 },
          { seq_no: 4, label: 'D', content: '明显抑郁或烦躁', score: 1 },
        ]},
      ]

      const questionIds = []
      for (const q of questions) {
        const [qid] = await db('question_bank').insert({
          code: q.code, content: q.content, dimension: q.dimension,
          type: 'single', is_active: 1, sort_order: 0, created_by: adminUser.id,
        })
        for (const opt of q.options) {
          await db('question_options').insert({ question_id: qid, ...opt })
        }
        questionIds.push(qid)
        log(`题库：${q.content.slice(0, 20)}...`)
      }

      // 创建量表
      const [paperId] = await db('exam_papers').insert({
        name: '日常功能综合评估量表（ADL）',
        description: '用于评估老人日常生活活动能力，涵盖运动、认知、饮食、社交、睡眠、情绪六个维度',
        level: 1, is_published: 1, question_count: questionIds.length,
        created_by: adminUser.id,
      })
      for (let i = 0; i < questionIds.length; i++) {
        await db('exam_paper_questions').insert({
          paper_id: paperId, question_id: questionIds[i],
          seq_no: i + 1, is_required: 1, added_by: adminUser.id,
        })
      }
      log(`量表已创建：日常功能综合评估量表（${questionIds.length}题）`)
    } else {
      log('题库已有数据，跳过')
    }

    // ── 11. 家属账号 ──────────────────────────────────────
    const familyList = [
      { name: '张小明', phone: '13300000001', customer_idx: 0, relation: '儿子' },
      { name: '李芳',   phone: '13300000002', customer_idx: 1, relation: '女儿' },
    ]
    for (const f of familyList) {
      let u = await db('users').where({ phone: f.phone }).first()
      if (!u) {
        const hash = await bcrypt.hash('Ulife@2024', 10)
        const [uid] = await db('users').insert({ name: f.name, phone: f.phone, password_hash: hash, role: 'family', is_active: 1 })
        u = { id: uid }
        log(`家属账号已创建：${f.name}`)
      }
      // 创建已审批的家属授权
      const cid = customerIds[f.customer_idx]
      if (cid) {
        const exists = await db('family_authorizations').where({ family_user_id: u.id, customer_id: cid }).first()
        if (!exists) {
          await db('family_authorizations').insert({
            family_user_id: u.id, customer_id: cid,
            status: 'approved',
            remark: `关系：${f.relation}`,
            approved_by: adminUser.id, approved_at: new Date(),
            can_view_afi: 1, can_view_reports: 1, can_view_tasks: 1,
            can_view_points: 1, can_view_alerts: 1,
          })
          log(`家属授权已创建：${f.name} → 老人${cid}（已审批）`)
        }
      }
    }

    console.log('\n✅ 样例数据写入完成！\n')
    console.log('账号汇总（密码均为 Ulife@2024）：')
    console.log('  管理员：13000000000 / Admin@123456')
    console.log('  管家：  13100000001~3')
    console.log('  老人：  13200000001~5')
    console.log('  家属：  13300000001~2')

  } catch (err) {
    console.error('❌ 写入失败：', err.message)
    console.error(err)
  } finally {
    await db.destroy()
  }
}

seed()
