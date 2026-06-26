/**
 * AI生图工具 - IGA Pages Serverless Function
 * 精简依赖版本: 仅 express + jsonwebtoken
 * 其余全部使用 Node.js 内置模块
 */
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'

// ====== 配置（适配 IGA Pages 环境变量） ======
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
  if (!res.ok) throw new Error(`Supabase GET ${table} error: ${res.status}`)
  // Handle single object vs array
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
  if (!res.ok) throw new Error(`Supabase UPDATE ${table} error: ${res.status}`)
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
  // 兼容两种 header: Authorization (Bearer token) 和 x-auth-token
  let token = req.headers['x-auth-token']
  if (!token && req.headers.authorization) {
    // 从 Authorization: Bearer xxx 中提取 token
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

// ====== 路由: 认证 ======

// 登录（管理员和用户共用，根据数据库 role 字段区分）
app.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body
    if (!username || !password) return res.status(400).json(error('请输入用户名和密码'))

    const users = await supabaseGet('admin_users', {
      select: '*',
      filter: { 'username': `eq.${username}` },
      single: true
    })

    if (!users) return res.status(401).json(error('用户名或密码错误'))
    const user = Array.isArray(users) ? users[0] : users

    // 兼容两种密码哈希格式：SHA256（新用户）和 bcrypt（初始数据/旧数据）
    let passwordOk = false
    if (user.password_hash === hashPassword(password)) {
      passwordOk = true
    } else if (user.password_hash.startsWith('$2a$') || user.password_hash.startsWith('$2b$')) {
      // bcrypt 格式，用 bcryptjs 验证
      try {
        passwordOk = await bcrypt.compare(password, user.password_hash)
      } catch (bcryptErr) {
        console.warn('bcrypt compare error:', bcryptErr.message)
      }
    }
    if (!passwordOk) {
      return res.status(401).json(error('用户名或密码错误'))
    }

    // admin_users 表中的用户默认角色为 admin（不是 user）
    const userRole = user.role || 'admin'

    const token = jwt.sign(
      { id: user.id, username: user.username, role: userRole },
      JWT_SECRET,
      { expiresIn: '24h' }
    )

    const payload = { token, userInfo: { id: user.id, username: user.username, nickname: user.nickname || user.username, role: userRole } }

    // 同步到 users 表
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
      userInfo: { id: user.id, username: user.username, nickname: user.nickname || user.username, role: userRole }
    }, '登录成功'))
  } catch (e) {
    console.error('Login error:', e)
    res.status(500).json(error('登录失败: ' + e.message))
  }
})

// 获取当前用户信息
app.get('/auth/me', authMiddleware, async (req, res) => {
  try {
    // 从 JWT payload 中获取基本信息
    const userInfo = {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role
    }
    // 从 users 表获取积分余额
    try {
      const userRec = await supabaseGet('users', {
        select: '*',
        filter: { 'id': `eq.${req.user.id}` },
        single: true
      })
      const user = Array.isArray(userRec) ? userRec[0] : userRec
      if (user) {
        userInfo.nickname = user.nickname || user.username
        userInfo.pointsBalance = Number(user.points ?? user.points_balance ?? 0)
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
    // 兼容前端两种字段命名格式（camelCase 和 snake_case）
    const model = body.model || body.modelName
    const prompt = body.prompt
    const size = body.size || body.aspectRatio
    const refImageUrl = body.refImageUrl || body.referenceImageUrl
    const count = body.count || body.imageCount || body.n || 1
    const numImages = parseInt(count) || 1
    if (!model || !prompt) return res.status(400).json(error('缺少必要参数'))

    // 查定价（带默认值兜底）
    const defaultPricing = { points: model === 'banana' ? 1 : 40 }
    let pricing
    try {
      const pricingList = await supabaseGet('pricing_config', {
        select: '*',
        filter: { 'model': `eq.${model}`, 'status': `eq.active` },
        single: true
      })
      pricing = Array.isArray(pricingList) ? pricingList[0] : pricingList
    } catch (e) {
      console.error('Pricing query failed, using default:', e.message)
      pricing = null
    }
    if (!pricing) pricing = defaultPricing

    const totalCost = pricing.points * numImages

    // 检查余额（直接查 users 表，不用 RPC）
    const userId = req.user.id
    const userRec = await supabaseGet('users', {
      select: '*',
      filter: { 'id': `eq.${userId}` },
      single: true
    })
    const userObj = Array.isArray(userRec) ? userRec[0] : userRec
    const currentBalance = Number(userObj?.points ?? userObj?.points_balance ?? 0)

    if (currentBalance < totalCost) {
      return res.status(400).json(error(`积分不足，当前${currentBalance}，需要${totalCost}`))
    }

    // 扣积分（直接 UPDATE，不用 RPC）
    const newBalance = currentBalance - totalCost
    const balCol = userObj?.hasOwnProperty('points') ? 'points' : (userObj?.hasOwnProperty('points_balance') ? 'points_balance' : 'points')
    try {
      await supabaseUpdate('users', userId, { [balCol]: newBalance })
      try {
        await supabasePost('points_records', {
          user_id: userId,
          amount: -totalCost,
          balance_after: newBalance,
          type: 'generate_deduct',
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
        apiPath = '/v1/images/generations'
        requestBody = JSON.stringify({
          model: 'gpt-image-2',
          prompt: prompt,
          image_size: size || '1024x1024',
          n: 1
        })
        contentType = 'application/json'
      } else if (model === 'banana' || model === 'nano-banana') {
        apiPath = refImageUrl ? '/api/gemini/nano-banana-edit' : '/api/gemini/nano-banana'
        const formData = new URLSearchParams()
        formData.append('prompt', prompt)
        if (refImageUrl) formData.append('image_url', refImageUrl)
        if (size) formData.append('size', size)
        requestBody = formData.toString()
        contentType = 'application/x-www-form-urlencoded'
      } else if (model === 'nano-banana-2') {
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
        // 退还积分（直接 UPDATE，不用 RPC）
        try {
          const uRec2 = await supabaseGet('users', {
            select: '*',
            filter: { 'id': `eq.${userId}` },
            single: true
          })
          const u2 = Array.isArray(uRec2) ? uRec2[0] : uRec2
          const bal2 = Number(u2?.points ?? u2?.points_balance ?? 0) + totalCost
          const refCol2 = u2?.hasOwnProperty('points') ? 'points' : (u2?.hasOwnProperty('points_balance') ? 'points_balance' : 'points')
          await supabaseUpdate('users', userId, { [refCol2]: bal2 })
        } catch {}
        return res.status(502).json(error(result.message || `调用AI接口失败: ${resp.status}`))
      }
      taskIds.push(String(result.task_id))
    }

    // 写入数据库
    const taskRecord = await supabasePost('image_tasks', {
      user_id: userId,
      model: model,
      prompt: prompt,
      size: size || '1024x1024',
      count: numImages,
      task_ids: JSON.stringify(taskIds),
      status: 'processing',
      points_cost: totalCost,
      created_at: new Date().toISOString()
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

    const taskIds = JSON.parse(task.task_ids || '[]')
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
        completed_at: new Date().toISOString()
      })
    } else if (allDone && !allSuccess) {
      await supabaseUpdate('image_tasks', taskId, { status: 'failed' })
      // 退积分（直接 UPDATE，不用 RPC）
      try {
        const uRec = await supabaseGet('users', {
          select: '*',
          filter: { 'id': `eq.${task.user_id}` },
          single: true
        })
        const u = Array.isArray(uRec) ? uRec[0] : uRec
        const bal = Number(u?.points ?? u?.points_balance ?? 0) + Number(task.points_cost || 0)
        const refCol = u?.hasOwnProperty('points') ? 'points' : (u?.hasOwnProperty('points_balance') ? 'points_balance' : 'points')
        await supabaseUpdate('users', task.user_id, { [refCol]: bal })
        try {
          await supabasePost('points_records', {
            user_id: task.user_id,
            amount: Number(task.points_cost || 0),
            balance_after: bal,
            type: 'fail_refund',
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
    // 兼容前端两种字段名: image 和 imageBase64
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
    res.json(success({ url: publicUrl }), '上传成功')
  } catch (e) {
    res.status(500).json(error('上传失败: ' + e.message))
  }
})

// 获取定价（返回前端期望的格式：{ pricing: { modelName: { standard, hd } }, i2iExtra }）
app.get('/tasks/pricing', async (req, res) => {
  // 默认定价（pricing_config 表为空或不存在时使用）
  const defaultPricing = {
    pricing: {
      image2: { standard: 40, hd: 80 },
      banana: { standard: 1, hd: 2 }
    },
    i2iExtra: 0
  }

  try {
    const list = await supabaseGet('pricing_config', {
      select: '*',
      filter: { 'status': `eq.active` },
      order: 'points.asc'
    })
    const items = Array.isArray(list) ? list : (list ? [list] : [])

    if (items.length === 0) {
      return res.json(success(defaultPricing))
    }

    // 将数据库格式转换为前端期望的格式
    const pricing = {}
    let i2iExtra = 0
    for (const item of items) {
      const model = item.model || item.model_name || 'image2'
      const pts = Number(item.points) || 40
      pricing[model] = {
        standard: pts,
        hd: Math.round(pts * 2)
      }
      if (item.i2i_extra) i2iExtra = Number(item.i2i_extra)
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
      select: '*',
      filter: { 'id': `eq.${req.user.id}` },
      single: true
    })
    const user = Array.isArray(userList) ? userList[0] : userList
    const balance = Number(user?.points ?? user?.points_balance ?? 0)
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
    const [list, countResult] = await Promise.all([
      supabaseGet('points_records', { select: '*', filter: q, order: 'created_at.desc', limit: size, offset }),
      supabaseGet('points_records', { select: 'id', filter: q, header: 'Content-Range' })
    ])

    const count = Array.isArray(countResult) ? countResult.length : 0
    res.json(success({ list: Array.isArray(list) ? list : [], total: count, page, size }))
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
      task_ids: JSON.parse(task.task_ids || '[]')
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

    // 简化查询：不用嵌套关联（避免FK不存在时报错）
    const list = await supabaseGet('users', {
      select: '*',
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

    // 检查是否已存在
    const existing = await supabaseGet('users', {
      select: 'id',
      filter: { 'username': `eq.${username}` },
      limit: 1
    })
    if (Array.isArray(existing) && existing.length > 0) {
      return res.status(400).json(error('用户名已存在'))
    }

    // 同时在 admin_users 和 users 表创建
    // 注意：admin_users 只有 id,username,password_hash,created_at 四列
    const hashedPassword = hashPassword(password)

    const adminUser = await supabasePost('admin_users', {
      username,
      password_hash: hashedPassword
    })

    const adminUserId = Array.isArray(adminUser) ? adminUser[0]?.id : adminUser?.id

    // users 表：id,username,password_hash,points_balance,status,created_at,last_login_at
    const user = await supabasePost('users', {
      username,
      password_hash: hashedPassword,
      points_balance: Number(points),
      status: 1
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

    // 先查当前用户和余额
    const userList = await supabaseGet('users', {
      select: '*',
      filter: { 'id': `eq.${targetId}` },
      single: true
    })
    const user = Array.isArray(userList) ? userList[0] : userList
    if (!user) return res.status(404).json(error('用户不存在'))

    // 兼容多种可能的列名
    const currentBalance = Number(user.points ?? user.points_balance ?? user.points_balance ?? 0)
    const newBalance = currentBalance + adjustAmount
    if (newBalance < 0) return res.status(400).json(error('调整后余额不能为负数'))

    // 更新余额：自动检测实际存在的列名
    const balanceCol = user.hasOwnProperty('points') ? 'points' : (user.hasOwnProperty('points_balance') ? 'points_balance' : 'points')
    await supabaseUpdate('users', targetId, { [balanceCol]: newBalance })

    // 写流水记录
    try {
      await supabasePost('points_records', {
        user_id: targetId,
        amount: adjustAmount,
        balance_after: newBalance,
        type: 'admin_adjust',
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

    // 查用户记录（同时尝试 users 和 admin_users 表）
    let user = null
    // 先查 admin_users（管理员和普通用户的认证信息都存这里）
    user = await supabaseGet('admin_users', {
      select: '*',
      filter: { 'id': `eq.${targetId}` },
      single: true
    })
    if (!user) {
      // 再尝试直接按 id 查 users 表
      user = await supabaseGet('users', {
        select: '*',
        filter: { 'id': `eq.${targetId}` },
        single: true
      })
    }
    if (!user) return res.status(404).json(error('用户不存在'))

    // 如果从 admin_users 找到了，直接更新
    if (user.id) {
      await supabaseUpdate('admin_users', user.id, { password_hash: hashPassword(newPassword) })
    } else {
      // 从 users 表找到的，用 username 去 admin_users 更新
      const adminList = await supabaseGet('admin_users', {
        select: 'id',
        filter: { 'username': `eq.${user.username}` },
        limit: 1
      })
      const adminRec = Array.isArray(adminList) ? adminList[0] : adminList
      if (!adminRec) return res.status(404).json(error('找不到对应的管理员账号'))
      await supabaseUpdate('admin_users', adminRec.id, { password_hash: hashPassword(newPassword) })
    }

    // 同步更新 users 表的密码（如果有这条记录）
    try {
      const userInUsers = await supabaseGet('users', {
        select: 'id',
        filter: { 'username': `eq.${user.username}` },
        limit: 1
      })
      const u = Array.isArray(userInUsers) ? userInUsers[0] : userInUsers
      if (u?.id) {
        await supabaseUpdate('users', u.id, { password_hash: hashPassword(newPassword) })
      }
    } catch (e2) {
      // users表更新失败不阻塞主流程
      console.warn('Sync password to users table failed:', e2.message)
    }

    res.json(success(null, '密码重置成功'))
  } catch (e) {
    console.error('Reset password error:', e.message)
    res.status(500).json(error('重置密码失败: ' + e.message))
  }
})

// 切换用户状态
app.put('/admin/users/:id/status', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { status } = req.body
    const targetId = req.params.id

    // 更新 users 表状态
    await supabaseUpdate('users', targetId, { status: Number(status) })

    // 尝试同步更新 admin_users 表（通过 username 查找）
    try {
      const userList = await supabaseGet('users', {
        select: 'username',
        filter: { 'id': `eq.${targetId}` },
        single: true
      })
      const user = Array.isArray(userList) ? userList[0] : userList
      if (user?.username) {
        // admin_users表无status列，跳过同步
        console.log(`Status sync skipped: admin_users has no 'status' column`)
      }
    } catch (e2) {
      // admin_users 同步失败不阻塞
      console.warn('Sync status to admin_users failed:', e2.message)
    }

    res.json(success(null, '状态更新成功'))
  } catch (e) {
    console.error('Toggle status error:', e.message)
    res.status(500).json(error('状态更新失败'))
  }
})

// 定价管理（返回前端 Pricing.vue 期望的格式）
app.get('/admin/pricing', authMiddleware, adminOnly, async (req, res) => {
  // 默认定价数据（数据库不可用时使用）
  const defaultData = {
    pricing: [
      { id: 'new-image2-standard', model_name: 'image2', quality: 'standard', points_per_image: 2 },
      { id: 'new-image2-hd', model_name: 'image2', quality: 'hd', points_per_image: 4 },
      { id: 'new-banana-standard', model_name: 'banana', quality: 'standard', points_per_image: 2 },
      { id: 'new-banana-hd', model_name: 'banana', quality: 'hd', points_per_image: 4 },
      { id: 'new-seedream-standard', model_name: 'seedream', quality: 'standard', points_per_image: 2 },
      { id: 'new-seedream-hd', model_name: 'seedream', quality: 'hd', points_per_image: 4 }
    ],
    i2i_extra: 1
  }

  try {
    const list = await supabaseGet('pricing_config', { select: '*', order: 'id.asc' })
    const items = Array.isArray(list) ? list : (list ? [list] : [])

    if (items.length === 0) {
      return res.json(success(defaultData))
    }

    // 转换数据库格式为前端期望格式：{ pricing: [...], i2iExtra }
    const pricing = []
    let i2iExtra = 1
    for (const item of items) {
      const modelName = item.model || item.model_name || 'image2'
      const quality = item.quality || (item.hd_only ? 'hd' : 'standard')
      pricing.push({
        id: item.id,
        model_name: modelName,
        quality,
        points_per_image: Number(item.points) || Number(item.points_per_image) || 2
      })
      if (item.i2i_extra !== undefined) i2iExtra = Number(item.i2i_extra)
    }
    res.json(success({ pricing, i2i_extra }))
  } catch (e) {
    console.error('Admin pricing error:', e.message)
    res.json(success(defaultData))
  }
})

// 批量保存定价（前端调用 PUT /admin/pricing，无 :id）
app.put('/admin/pricing', authMiddleware, adminOnly, async (req, res) => {
  try {
    // 前端发送格式：{ pricing: [{ id, pointsPerImage }] } 或直接数组
    const items = req.body.pricing || req.body
    const updates = Array.isArray(items) ? items : [items]

    for (const item of updates) {
      const { id, pointsPerImage } = item
      if (!id) continue
      const pts = Number(pointsPerImage)
      // new- 前缀表示是新记录需要创建
      if (String(id).startsWith('new-')) {
        try {
          await supabasePost('pricing_config', {
            model: id.replace('new-', '').replace('-standard', '').replace('-hd', ''),
            quality: id.includes('-hd') ? 'hd' : 'standard',
            points: pts,
            status: 'active'
          })
        } catch {}
      } else {
        // 更新已有记录
        try {
          await supabaseUpdate('pricing_config', id, { points: pts })
        } catch {}
      }
    }

    res.json(success(null, '保存成功'))
  } catch (e) {
    console.error('Batch save pricing error:', e.message)
    res.status(500).json(error('保存失败'))
  }
})

app.put('/admin/pricing/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { points, description, status } = req.body
    await supabaseUpdate('pricing_config', req.params.id, { points, description, status })
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

// 系统设置
app.get('/admin/settings', authMiddleware, adminOnly, async (req, res) => {
  try {
    const list = await supabaseGet('system_config', { select: '*' })
    res.json(success({ settings: Array.isArray(list) ? list : [] }))
  } catch (e) {
    res.status(500).json(error('获取设置失败'))
  }
})

app.put('/admin/settings/:key', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { value } = req.body
    // 先查是否存在
    const existing = await supabaseGet('system_config', {
      select: 'id,key,value',
      filter: { 'key': `eq.${req.params.key}` },
      single: true
    })
    const item = Array.isArray(existing) ? existing[0] : existing
    if (item) {
      await supabaseUpdate('system_config', item.id, { value: value ?? '' })
    } else {
      await supabasePost('system_config', { key: req.params.key, value: value ?? '' })
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
    // 验证旧密码
    const adminList = await supabaseGet('admin_users', {
      select: '*',
      filter: { 'id': `eq.${req.user.id}` },
      single: true
    })
    const adminUser = Array.isArray(adminList) ? adminList[0] : adminList
    if (!adminUser) return res.status(404).json(error('用户不存在'))
    if (adminUser.password_hash !== hashPassword(oldPassword)) {
      return res.status(400).json(error('原密码错误'))
    }
    // 更新密码
    await supabaseUpdate('admin_users', req.user.id, { password_hash: hashPassword(newPassword) })
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
