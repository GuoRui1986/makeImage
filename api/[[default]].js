/**
 * AI生图工具 - IGA Pages Serverless Function
 * 
 * 【重要】实际数据库 schema（来自 supabase-schema.sql）：
 * 
 * admin_users: id(SERIAL), username(TEXT), password_hash(TEXT), created_at(TIMESTAMPTZ) — 仅4列，无role/nickname/status
 * users: id(SERIAL), username(TEXT), password_hash(TEXT), points_balance(DECIMAL), status(SMALLINT), created_at(TIMESTAMPTZ), last_login_at(TIMESTAMPTZ) — 7列，无admin_user_id/nickname/points/role
 * points_config: id(SERIAL), model_name(TEXT), quality(TEXT), points_per_image(DECIMAL) — 4列，无model/points/status
 * points_records: id, user_id, amount, balance_after, type, related_task_id, remark, created_at — 8列
 * image_tasks: id, user_id, model_name, mode, prompt, aspect_ratio, quality, image_count, reference_image, points_cost, status, result_images, fail_reason, duomi_task_ids, created_at, finished_at — 16列
 * system_config: id, config_key, config_value, updated_at — 4列，无key/value
 */
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'

// ====== 配置 ======
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
const DUOMI_API_KEY = process.env.DUOMI_API_KEY || ''
const JWT_SECRET = process.env.JWT_SECRET || 'ai-image-tool-secret-key-2024'
const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || ''

const app = express()

// ====== 中间件 ======
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-auth-token')
  if (req.method === 'OPTIONS') return res.status(204).end()
  next()
})

app.use(express.json({ limit: '10mb' }))

// ====== 工具函数 ======
function success(data, message = 'success') {
  return { code: 200, data, message }
}
function error(message, code = 500) {
  return { code, message }
}

function supabaseHeaders() {
  return {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  }
}

async function supabaseGet(table, options = {}) {
  const params = new URLSearchParams()
  if (options.select) params.set('select', options.select)
  if (options.filter) Object.entries(options.filter).forEach(([k, v]) => params.set(k, v))
  if (options.order) params.set('order', options.order)
  if (options.limit !== undefined) params.set('limit', String(options.limit))
  if (options.offset !== undefined) params.set('offset', String(options.offset))

  const url = `${SUPABASE_URL}/rest/v1/${table}?${params}`
  const res = await fetch(url, { headers: supabaseHeaders() })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Supabase GET ${table} error: ${res.status} ${errText}`)
  }
  const text = await res.text()
  if (!text) return options.single ? null : []
  const data = JSON.parse(text)
  if (options.single && Array.isArray(data)) return data[0] || null
  return data
}

async function supabasePost(table, body) {
  const url = `${SUPABASE_URL}/rest/v1/${table}`
  const res = await fetch(url, {
    method: 'POST',
    headers: supabaseHeaders(),
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Supabase POST ${table} error: ${res.status} ${errText}`)
  }
  return res.json()
}

async function supabaseUpdate(table, id, body, idCol = 'id') {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${idCol}=eq.${id}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...supabaseHeaders(), 'Prefer': 'return=representation' },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Supabase UPDATE ${table} error: ${res.status} ${errText}`)
  }
  return res.json()
}

async function supabaseRpc(fnName, params = {}) {
  const url = `${SUPABASE_URL}/rest/v1/rpc/${fnName}`
  const res = await fetch(url, {
    method: 'POST',
    headers: supabaseHeaders(),
    body: JSON.stringify(params)
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`RPC ${fnName} error: ${res.status} ${errText}`)
  }
  return res.json()
}

// ====== JWT 鉴权中间件 ======
function authMiddleware(req, res, next) {
  let token = req.headers['x-auth-token']
  if (!token && req.headers.authorization) {
    const auth = req.headers.authorization
    token = auth.startsWith('Bearer ') ? auth.slice(7) : auth
  }
  if (!token) return res.status(401).json(error('未登录'))
  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    req.user = decoded
    next()
  } catch {
    res.status(401).json(error('登录已过期'))
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json(error('需要管理员权限'))
  next()
}

// ====== 密码工具 ======
const PASSWORD_SALT = 'ai_image_tool_salt_v1'

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + PASSWORD_SALT).digest('hex')
}

// 兼容验证：先SHA256，再bcrypt（数据库初始数据用crypt/bcrypt）
async function verifyPassword(password, storedHash) {
  // SHA256 匹配
  if (storedHash === hashPassword(password)) return true
  // bcrypt 匹配
  if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$')) {
    try {
      return await bcrypt.compare(password, storedHash)
    } catch (e) {
      console.warn('bcrypt compare error:', e.message)
    }
  }
  return false
}

// ====== 路由: 认证 ======

// 登录
app.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body
    if (!username || !password) return res.status(400).json(error('请输入用户名和密码'))

    // admin_users 只有 id,username,password_hash,created_at 四列（无role/nickname/status）
    const users = await supabaseGet('admin_users', {
      select: '*',
      filter: { 'username': `eq.${username}` },
      single: true
    })

    if (!users) return res.status(401).json(error('用户名或密码错误'))
    const user = Array.isArray(users) ? users[0] : users

    if (!await verifyPassword(password, user.password_hash)) {
      return res.status(401).json(error('用户名或密码错误'))
    }

    // 判断角色：查 users 表的 status 列
    // admin_users 没有 role 列，用 username 查 users 表判断
    let userRole = 'admin' // 默认为admin（管理员账号）
    let userIdForJwt = user.id
    try {
      const userRec = await supabaseGet('users', {
        select: 'id,username,points_balance,status',
        filter: { 'username': `eq.${user.username}` },
        single: true
      })
      const u = Array.isArray(userRec) ? userRec[0] : userRec
      if (u && u.id !== user.id) {
        // users表有独立记录，说明是普通用户（管理员admin是users表id=1）
        // admin 的 users.id 和 admin_users.id 可能不同，但 username='admin' 的肯定是管理员
        if (user.username !== 'admin') {
          userRole = 'user'
          userIdForJwt = u.id // 用 users 表的 id 作为业务主键
        }
      }
    } catch (e) {
      console.warn('Role check failed, assuming admin:', e.message)
    }

    const token = jwt.sign(
      { id: userIdForJwt, username: user.username, role: userRole },
      JWT_SECRET,
      { expiresIn: '24h' }
    )

    // 同步到 users 表（更新 last_login_at）
    try {
      const existingUsers = await supabaseGet('users', {
        select: 'id',
        filter: { 'username': `eq.${user.username}` },
        limit: 1
      })
      if (Array.isArray(existingUsers) && existingUsers.length > 0) {
        await supabaseUpdate('users', existingUsers[0].id, {
          last_login_at: new Date().toISOString()
        })
      } else {
        await supabasePost('users', {
          username: user.username,
          password_hash: user.password_hash,
          points_balance: 10000,
          status: 1,
          last_login_at: new Date().toISOString()
        })
      }
    } catch (e) {
      console.error('Sync user failed:', e.message)
    }

    res.json(success({
      token,
      userInfo: { id: userIdForJwt, username: user.username, nickname: user.username, role: userRole }
    }, '登录成功'))
  } catch (e) {
    console.error('Login error:', e)
    res.status(500).json(error('登录失败: ' + e.message))
  }
})

// 获取当前用户信息
app.get('/auth/me', authMiddleware, async (req, res) => {
  try {
    const userInfo = {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role,
      nickname: req.user.username // admin_users 和 users 都没有 nickname 列
    }
    try {
      const userRec = await supabaseGet('users', {
        select: '*',
        filter: { 'id': `eq.${req.user.id}` },
        single: true
      })
      const user = Array.isArray(userRec) ? userRec[0] : userRec
      if (user) {
        userInfo.pointsBalance = Number(user.points_balance ?? 0)
      }
    } catch {}
    res.json(success(userInfo))
  } catch (e) {
    res.json(success(req.user))
  }
})

// ====== 路由: 任务 ======

// 创建生图任务
app.post('/tasks/create', authMiddleware, async (req, res) => {
  try {
    const body = req.body
    // 兼容前端两种字段命名格式
    const model = body.model || body.modelName
    const prompt = body.prompt
    const size = body.size || body.aspectRatio
    const refImageUrl = body.refImageUrl || body.referenceImageUrl
    const count = body.count || body.imageCount || body.n || 1
    const numImages = parseInt(count) || 1
    if (!model || !prompt) return res.status(400).json(error('缺少必要参数'))

    // 查定价（points_config 表，列: model_name, quality, points_per_image）
    let pointsPerImage = model === 'banana' ? 1 : 40 // 默认值
    try {
      const pricingList = await supabaseGet('points_config', {
        select: '*',
        filter: { 'model_name': `eq.${model}` },
        single: true
      })
      const pricing = Array.isArray(pricingList) ? pricingList[0] : pricingList
      if (pricing) {
        pointsPerImage = Number(pricing.points_per_image ?? pricing.points_per_image ?? 40)
      }
    } catch (e) {
      console.warn('Pricing query failed, using default:', e.message)
    }

    const totalCost = pointsPerImage * numImages

    // 检查余额（users 表列: points_balance）
    const userId = req.user.id
    const userRec = await supabaseGet('users', {
      select: '*',
      filter: { 'id': `eq.${userId}` },
      single: true
    })
    const userObj = Array.isArray(userRec) ? userRec[0] : userRec
    const currentBalance = Number(userObj?.points_balance ?? 0)

    if (currentBalance < totalCost) {
      return res.status(400).json(error(`积分不足，当前${currentBalance}，需要${totalCost}`))
    }

    // 扣积分（直接 UPDATE users 表的 points_balance 列）
    const newBalance = currentBalance - totalCost
    try {
      await supabaseUpdate('users', userId, { points_balance: newBalance })
      try {
        await supabasePost('points_records', {
          user_id: userId,
          amount: -totalCost,
          balance_after: newBalance,
          type: 'generate_deduct',
          related_task_id: null,
          remark: `生成图片-${model}`
        })
      } catch {}
    } catch (deductErr) {
      console.error('Deduct points failed:', deductErr.message)
      return res.status(500).json(error('扣费失败，请重试'))
    }

    // 调多米API创建任务
    const duomiBaseUrl = 'https://duomiapi.com'
    const taskIds = []

    for (let i = 0; i < numImages; i++) {
      let apiPath, requestBody, contentType

      if (model === 'image2') {
        // 多米API: image2 必须带 ?async=true
        apiPath = '/v1/images/generations?async=true'
        const body = {
          model: 'gpt-image-2',
          prompt: prompt,
          image_size: size || '1024x1024',
          n: 1
        }
        // 图生图模式：附加参考图
        if (refImageUrl) {
          body.image = refImageUrl
        }
        requestBody = JSON.stringify(body)
        contentType = 'application/json'
      } else if (model === 'banana' || model === 'nano-banana' || model === 'nano-banana-2') {
        apiPath = refImageUrl ? '/api/gemini/nano-banana-edit' : '/api/gemini/nano-banana'
        const formData = new URLSearchParams()
        formData.append('prompt', prompt)
        if (refImageUrl) formData.append('image_url', refImageUrl)
        if (size) formData.append('size', size)
        requestBody = formData.toString()
        contentType = 'application/x-www-form-urlencoded'
      } else {
        return res.status(400).json(error('不支持的模型'))
      }

      const resp = await fetch(`${duomiBaseUrl}${apiPath}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${DUOMI_API_KEY}`,
          'Content-Type': contentType
        },
        body: requestBody
      })

      const result = await resp.json()
      if (!resp.ok || !result.task_id) {
        // 退还积分
        try {
          const uRec2 = await supabaseGet('users', {
            select: 'points_balance',
            filter: { 'id': `eq.${userId}` },
            single: true
          })
          const u2 = Array.isArray(uRec2) ? uRec2[0] : uRec2
          const bal2 = Number(u2?.points_balance ?? 0) + totalCost
          await supabaseUpdate('users', userId, { points_balance: bal2 })
        } catch {}
        return res.status(502).json(error(result.message || `调用AI接口失败: ${resp.status}`))
      }
      taskIds.push(String(result.task_id))
    }

    // 写入 image_tasks 表（列名严格对齐 schema）
    const taskRecord = await supabasePost('image_tasks', {
      user_id: userId,
      model_name: model,           // schema 列: model_name
      mode: model,                  // schema 列: mode
      prompt: prompt,
      aspect_ratio: size || '1024x1024', // schema 列: aspect_ratio
      quality: 'standard',
      image_count: numImages,       // schema 列: image_count
      reference_image: refImageUrl || null, // schema 列: reference_image
      points_cost: totalCost,
      status: 'processing',
      result_images: null,
      fail_reason: null,
      duomi_task_ids: JSON.stringify(taskIds) // schema 列: duomi_task_ids
    })

    const taskId = Array.isArray(taskRecord) ? taskRecord[0]?.id : taskRecord?.id

    res.json(success({ task_id: taskId, task_ids: taskIds }, '任务已提交'))
  } catch (e) {
    console.error('Create task error:', e)
    res.status(500).json(error('创建任务失败: ' + e.message))
  }
})

// 查询任务状态
app.get('/tasks/status/:taskId', authMiddleware, async (req, res) => {
  try {
    const taskId = req.params.taskId
    const tasks = await supabaseGet('image_tasks', {
      select: '*',
      filter: { 'id': `eq.${taskId}` },
      single: true
    })
    const task = Array.isArray(tasks) ? tasks[0] : tasks
    if (!task) return res.status(404).json(error('任务不存在'))

    const taskIds = JSON.parse(task.duomi_task_ids || '[]') // schema 列: duomi_task_ids
    const results = []

    for (const tid of taskIds) {
      try {
        const resp = await fetch(`https://duomiapi.com/v1/tasks/${tid}`, {
          headers: { 'Authorization': `Bearer ${DUOMI_API_KEY}` }
        })
        const data = await resp.json()
        const state = data.state

        if (state === 'succeeded') {
          results.push({ task_id: tid, status: 'success', image_url: data.data?.images?.[0]?.url || null })
        } else if (state === 'failed') {
          results.push({ task_id: tid, status: 'failed', error: data.error || '生成失败' })
        } else {
          results.push({ task_id: tid, status: 'pending' })
        }
      } catch {
        results.push({ task_id: tid, status: 'failed', error: '查询状态失败' })
      }
    }

    const allDone = results.every(r => r.status !== 'pending')
    const allSuccess = results.every(r => r.status === 'success')

    if (allDone && allSuccess) {
      const images = results.map(r => r.image_url).filter(Boolean)
      await supabaseUpdate('image_tasks', taskId, {
        status: 'completed',
        result_images: JSON.stringify(images),
        finished_at: new Date().toISOString() // schema 列: finished_at（不是completed_at）
      })
    } else if (allDone && !allSuccess) {
      await supabaseUpdate('image_tasks', taskId, { status: 'failed' })
      // 退积分
      try {
        const uRec = await supabaseGet('users', {
          select: 'points_balance',
          filter: { 'id': `eq.${task.user_id}` },
          single: true
        })
        const u = Array.isArray(uRec) ? uRec[0] : uRec
        const bal = Number(u?.points_balance ?? 0) + Number(task.points_cost || 0)
        await supabaseUpdate('users', task.user_id, { points_balance: bal })
        try {
          await supabasePost('points_records', {
            user_id: task.user_id,
            amount: Number(task.points_cost || 0),
            balance_after: bal,
            type: 'fail_refund',
            related_task_id: taskId,
            remark: '生成失败返还积分'
          })
        } catch {}
      } catch (refErr) { console.error('Refund failed:', refErr.message) }
    }

    res.json(success(results))
  } catch (e) {
    res.status(500).json(error('查询状态失败'))
  }
})

// 上传参考图到 Supabase Storage
app.post('/tasks/upload-ref', authMiddleware, async (req, res) => {
  try {
    const base64 = req.body.image || req.body.imageBase64
    if (!base64) return res.status(400).json(error('没有收到图片数据'))

    const base64Data = base64.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')
    const ext = base64.includes('image/png') ? 'png' : 'jpg'
    const fileName = `ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`

    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${fileName}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/octet-stream'
        },
        body: buffer
      }
    )

    if (!uploadRes.ok) {
      const errText = await uploadRes.text().catch(() => '')
      return res.status(502).json(error('上传失败: ' + errText))
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${fileName}`
    res.json(success({ url: publicUrl }, '上传成功'))
  } catch (e) {
    res.status(500).json(error('上传失败: ' + e.message))
  }
})

// 获取定价（前端用户端，返回 { pricing: { modelName: { standard, hd } }, i2iExtra } 格式）
app.get('/tasks/pricing', async (req, res) => {
  const defaultPricing = {
    pricing: {
      image2: { standard: 40, hd: 80 },
      banana: { standard: 1, hd: 2 }
    },
    i2iExtra: 0
  }

  try {
    // 实际表名: points_config，列: model_name, quality, points_per_image
    const list = await supabaseGet('points_config', { select: '*', order: 'id.asc' })
    const items = Array.isArray(list) ? list : (list ? [list] : [])

    if (items.length === 0) {
      return res.json(success(defaultPricing))
    }

    const pricing = {}
    let i2iExtra = 0
    for (const item of items) {
      const model = item.model_name || 'image2' // schema 列: model_name
      const quality = item.quality || 'standard' // schema 列: quality
      const pts = Number(item.points_per_image ?? 40) // schema 列: points_per_image
      if (!pricing[model]) pricing[model] = {}
      pricing[model][quality] = pts
      // 没有专门的 i2i_extra 字段，默认0
    }
    res.json(success({ pricing, i2iExtra }))
  } catch (e) {
    console.error('Get pricing error:', e.message)
    res.json(success(defaultPricing))
  }
})

// ====== 路由: 积分 ======

// 余额
app.get('/points/balance', authMiddleware, async (req, res) => {
  try {
    const userList = await supabaseGet('users', {
      select: 'id,points_balance',
      filter: { 'id': `eq.${req.user.id}` },
      single: true
    })
    const user = Array.isArray(userList) ? userList[0] : userList
    const balance = Number(user?.points_balance ?? 0)
    res.json(success({ balance }))
  } catch (e) {
    console.error('Get balance error:', e.message)
    res.status(500).json(error('查询积分失败'))
  }
})

// 记录
app.get('/points/records', authMiddleware, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const size = Math.min(20, Math.max(1, parseInt(req.query.size) || 10))
    const offset = (page - 1) * size

    const q = { 'user_id': `eq.${req.user.id}` }
    const list = await supabaseGet('points_records', { select: '*', filter: q, order: 'created_at.desc', limit: size, offset })

    res.json(success({ list: Array.isArray(list) ? list : [], total: Array.isArray(list) ? list.length : 0, page, size }))
  } catch (e) {
    res.status(500).json(error('查询积分记录失败'))
  }
})

// ====== 路由: 历史记录 ======

app.get('/history/list', authMiddleware, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const size = Math.min(20, Math.max(1, parseInt(req.query.size) || 10))
    const offset = (page - 1) * size
    const status = req.query.status

    const filter = { 'user_id': `eq.${req.user.id}` }
    if (status) filter['status'] = `eq.${status}`

    const list = await supabaseGet('image_tasks', {
      select: '*',
      filter: filter,
      order: 'created_at.desc',
      limit: size,
      offset
    })

    res.json(success({ list: Array.isArray(list) ? list : [], total: 0, page, size }))
  } catch (e) {
    res.status(500).json(error('查询历史记录失败'))
  }
})

// 任务详情
app.get('/history/detail/:id', authMiddleware, async (req, res) => {
  try {
    const tasks = await supabaseGet('image_tasks', {
      select: '*',
      filter: { 'id': `eq.${req.params.id}` },
      single: true
    })
    const task = Array.isArray(tasks) ? tasks[0] : tasks
    if (!task) return res.status(404).json(error('任务不存在'))
    res.json(success({
      ...task,
      images: task.result_images ? JSON.parse(task.result_images) : [],
      task_ids: JSON.parse(task.duomi_task_ids || '[]') // schema 列: duomi_task_ids
    }))
  } catch (e) {
    res.status(500).json(error('查询详情失败'))
  }
})

// ====== 路由: 管理 ======

// 用户列表
app.get('/admin/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const size = Math.min(20, Math.max(1, parseInt(req.query.size) || 10))
    const offset = (page - 1) * size
    const keyword = req.query.keyword || ''

    let filter = {}
    if (keyword) filter['username'] = `ilike.%${keyword}%`

    const list = await supabaseGet('users', {
      select: '*',
      filter,
      order: 'created_at.desc',
      limit: size,
      offset
    })

    res.json(success({ list: Array.isArray(list) ? list : [], total: 0, page, size }))
  } catch (e) {
    console.error('Get users error:', e.message)
    res.status(500).json(error('获取用户列表失败'))
  }
})

// 创建用户
app.post('/admin/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { username, password, points: rawPoints, initialPoints } = req.body
    const points = Number(rawPoints ?? initialPoints ?? 100)
    if (!username || !password) {
      return res.status(400).json(error('用户名和密码不能为空'))
    }

    // 检查是否已存在（查 users 表）
    const existing = await supabaseGet('users', {
      select: 'id',
      filter: { 'username': `eq.${username}` },
      limit: 1
    })
    if (Array.isArray(existing) && existing.length > 0) {
      return res.status(400).json(error('用户名已存在'))
    }

    // 同时在 admin_users 和 users 表创建（严格按 schema 列）
    const hashedPassword = hashPassword(password)

    // admin_users: id, username, password_hash, created_at（仅4列）
    const adminUser = await supabasePost('admin_users', {
      username,
      password_hash: hashedPassword
    })

    // users: id, username, password_hash, points_balance, status, created_at, last_login_at
    const user = await supabasePost('users', {
      username,
      password_hash: hashedPassword,
      points_balance: Number(points),
      status: 1,
      last_login_at: null
    })

    const userId = Array.isArray(user) ? user[0]?.id : user?.id
    res.json(success({ id: userId, username, points }, '创建成功'))
  } catch (e) {
    console.error('Create user error:', e)
    res.status(500).json(error('创建用户失败: ' + e.message))
  }
})

// 更新用户积分
app.put('/admin/users/:id/points', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { amount, reason, remark } = req.body
    const targetId = req.params.id
    const adjustAmount = Number(amount)
    if (!adjustAmount) return res.status(400).json(error('请输入调整金额'))

    // 查 users 表（列: points_balance）
    const userList = await supabaseGet('users', {
      select: 'id,username,points_balance',
      filter: { 'id': `eq.${targetId}` },
      single: true
    })
    const user = Array.isArray(userList) ? userList[0] : userList
    if (!user) return res.status(404).json(error('用户不存在'))

    const currentBalance = Number(user.points_balance ?? 0)
    const newBalance = currentBalance + adjustAmount
    if (newBalance < 0) return res.status(400).json(error('调整后余额不能为负数'))

    await supabaseUpdate('users', targetId, { points_balance: newBalance })

    try {
      await supabasePost('points_records', {
        user_id: targetId,
        amount: adjustAmount,
        balance_after: newBalance,
        type: 'admin_adjust',
        related_task_id: null,
        remark: reason || remark || '管理员手动调整'
      })
    } catch {}

    res.json(success({ new_balance: newBalance }, '调整成功'))
  } catch (e) {
    console.error('Adjust points error:', e.message)
    res.status(500).json(error('调整积分失败: ' + e.message))
  }
})

// 重置用户密码
app.put('/admin/users/:id/password', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { newPassword } = req.body
    const targetId = req.params.id
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json(error('密码至少6位'))
    }

    // 查 users 表获取 username（用于关联 admin_users）
    const userRec = await supabaseGet('users', {
      select: 'id,username',
      filter: { 'id': `eq.${targetId}` },
      single: true
    })
    const user = Array.isArray(userRec) ? userRec[0] : userRec
    if (!user) return res.status(404).json(error('用户不存在'))

    const hashedPassword = hashPassword(newPassword)

    // 更新 users 表密码
    await supabaseUpdate('users', targetId, { password_hash: hashedPassword })

    // 用 username 查 admin_users 并更新密码（两张表通过 username 关联）
    try {
      const adminList = await supabaseGet('admin_users', {
        select: 'id',
        filter: { 'username': `eq.${user.username}` },
        limit: 1
      })
      const adminRec = Array.isArray(adminList) ? adminList[0] : adminList
      if (adminRec?.id) {
        await supabaseUpdate('admin_users', adminRec.id, { password_hash: hashedPassword })
      }
    } catch (e2) {
      console.warn('Sync password to admin_users failed:', e2.message)
    }

    res.json(success(null, '密码重置成功'))
  } catch (e) {
    console.error('Reset password error:', e.message)
    res.status(500).json(error('重置密码失败: ' + e.message))
  }
})

// 切换用户状态（只更新 users 表，admin_users 无 status 列）
app.put('/admin/users/:id/status', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { status } = req.body
    const targetId = req.params.id

    // users 表 status 是 SMALLINT (1=活跃, 0=禁用)
    await supabaseUpdate('users', targetId, { status: Number(status) })

    res.json(success(null, '状态更新成功'))
  } catch (e) {
    console.error('Toggle status error:', e.message)
    res.status(500).json(error('状态更新失败'))
  }
})

// 定价管理 — 管理端 GET（返回前端 Pricing.vue 期望的格式）
app.get('/admin/pricing', authMiddleware, adminOnly, async (req, res) => {
  const defaultData = {
    pricing: [
      { id: 'new-image2-standard', model_name: 'image2', quality: 'standard', points_per_image: 2 },
      { id: 'new-image2-hd', model_name: 'image2', quality: 'hd', points_per_image: 4 },
      { id: 'new-banana-standard', model_name: 'banana', quality: 'standard', points_per_image: 2 },
      { id: 'new-banana-hd', model_name: 'banana', quality: 'hd', points_per_image: 4 }
    ],
    i2i_extra: 1
  }

  try {
    // 实际表名: points_config
    const list = await supabaseGet('points_config', { select: '*', order: 'id.asc' })
    const items = Array.isArray(list) ? list : (list ? [list] : [])

    if (items.length === 0) {
      return res.json(success(defaultData))
    }

    const pricing = items.map(item => ({
      id: item.id,
      model_name: item.model_name,     // schema 列: model_name
      quality: item.quality,            // schema 列: quality
      points_per_image: Number(item.points_per_image) // schema 列: points_per_image
    }))
    res.json(success({ pricing, i2i_extra: 1 }))
  } catch (e) {
    console.error('Admin pricing error:', e.message)
    res.json(success(defaultData))
  }
})

// 批量保存定价（PUT /admin/pricing，无 :id）
app.put('/admin/pricing', authMiddleware, adminOnly, async (req, res) => {
  try {
    const items = req.body.pricing || req.body
    const updates = Array.isArray(items) ? items : [items]

    for (const item of updates) {
      const { id, pointsPerImage } = item
      if (!id) continue
      const pts = Number(pointsPerImage)

      if (String(id).startsWith('new-')) {
        // 新记录 → 插入 points_config（列: model_name, quality, points_per_image）
        const modelName = id.replace('new-', '').replace('-standard', '').replace('-hd', '')
        const quality = id.includes('-hd') ? 'hd' : 'standard'
        try {
          await supabasePost('points_config', {
            model_name: modelName,       // schema 列: model_name
            quality: quality,            // schema 列: quality
            points_per_image: pts        // schema 列: points_per_image
          })
        } catch {}
      } else {
        // 更新已有记录（列: points_per_image）
        try {
          await supabaseUpdate('points_config', id, { points_per_image: pts })
        } catch {}
      }
    }

    res.json(success(null, '保存成功'))
  } catch (e) {
    console.error('Batch save pricing error:', e.message)
    res.status(500).json(error('保存失败'))
  }
})

// 单条定价更新
app.put('/admin/pricing/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { points_per_image, description } = req.body
    // points_config 列: model_name, quality, points_per_image（无 description/status）
    const updateData = {}
    if (points_per_image !== undefined) updateData.points_per_image = Number(points_per_image)
    await supabaseUpdate('points_config', req.params.id, updateData)
    res.json(success(null, '更新成功'))
  } catch (e) {
    res.status(500).json(error('更新定价失败'))
  }
})

// 积分流水
app.get('/admin/records', authMiddleware, adminOnly, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const size = Math.min(20, Math.max(1, parseInt(req.query.size) || 10))
    const offset = (page - 1) * size
    const userId = req.query.user_id

    const filter = {}
    if (userId) filter['user_id'] = `eq.${userId}`

    const list = await supabaseGet('points_records', {
      select: '*',
      filter,
      order: 'created_at.desc',
      limit: size,
      offset
    })

    res.json(success({ list: Array.isArray(list) ? list : [], total: 0, page, size }))
  } catch (e) {
    res.status(500).json(error('获取积分流水失败'))
  }
})

// 系统设置 GET
app.get('/admin/settings', authMiddleware, adminOnly, async (req, res) => {
  try {
    // system_config 列: id, config_key, config_value, updated_at
    const list = await supabaseGet('system_config', { select: '*' })
    // 转换为前端可能期望的 { key: value } 格式
    const settings = {}
    const items = Array.isArray(list) ? list : (list ? [list] : [])
    for (const item of items) {
      settings[item.config_key] = item.config_value
    }
    res.json(success({ settings, items }))
  } catch (e) {
    res.json(success({ settings: {}, items: [] }))
  }
})

// 系统设置 PUT（单条更新）
app.put('/admin/settings/:key', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { value } = req.body
    const configKey = req.params.key
    // system_config 列: config_key, config_value, updated_at

    // 先查是否存在
    const existing = await supabaseGet('system_config', {
      select: 'id,config_key,config_value',
      filter: { 'config_key': `eq.${configKey}` },
      single: true
    })
    const item = Array.isArray(existing) ? existing[0] : existing
    if (item) {
      await supabaseUpdate('system_config', item.id, { config_value: value ?? '', updated_at: new Date().toISOString() })
    } else {
      await supabasePost('system_config', { config_key: configKey, config_value: value ?? '' })
    }
    res.json(success(null, '更新成功'))
  } catch (e) {
    res.status(500).json(error('更新设置失败'))
  }
})

// 修改管理员密码
app.put('/admin/settings/password', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body
    if (!oldPassword || !newPassword || newPassword.length < 6) {
      return res.status(400).json(error('密码至少6位'))
    }

    const adminList = await supabaseGet('admin_users', {
      select: '*',
      filter: { 'id': `eq.${req.user.id}` },
      single: true
    })
    const adminUser = Array.isArray(adminList) ? adminList[0] : adminList
    if (!adminUser) return res.status(404).json(error('用户不存在'))

    if (!await verifyPassword(oldPassword, adminUser.password_hash)) {
      return res.status(400).json(error('原密码错误'))
    }

    await supabaseUpdate('admin_users', req.user.id, { password_hash: hashPassword(newPassword) })

    // 同步更新 users 表密码
    try {
      const uRec = await supabaseGet('users', {
        select: 'id',
        filter: { 'username': `eq.${adminUser.username}` },
        limit: 1
      })
      const u = Array.isArray(uRec) ? uRec[0] : uRec
      if (u?.id) {
        await supabaseUpdate('users', u.id, { password_hash: hashPassword(newPassword) })
      }
    } catch {}

    res.json(success(null, '密码修改成功'))
  } catch (e) {
    console.error('Change password error:', e.message)
    res.status(500).json(error('修改密码失败'))
  }
})

// Health check
app.get('/health', (req, res) => {
  res.json(success({ status: 'ok', time: new Date().toISOString() }))
})

export default app
