/**
 * AI生图工具 - IGA Pages Serverless Function
 * 精简依赖版本: 仅 express + jsonwebtoken
 * 其余全部使用 Node.js 内置模块
 */
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'

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
  const token = req.headers['x-auth-token']
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

// 登录
app.post('/api/auth/login', async (req, res) => {
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

    if (user.password_hash !== hashPassword(password)) {
      return res.status(401).json(error('用户名或密码错误'))
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: 'admin' },
      JWT_SECRET,
      { expiresIn: '24h' }
    )

    // 同步到 users 表
    try {
      const existingUsers = await supabaseGet('users', {
        select: 'id',
        filter: { 'admin_user_id': `eq.${user.id}` },
        limit: 1
      })
      if (Array.isArray(existingUsers) && existingUsers.length > 0) {
        await supabaseUpdate('users', existingUsers[0].id, {
          last_login: new Date().toISOString()
        })
      } else {
        await supabasePost('users', {
          admin_user_id: user.id,
          username: user.username,
          nickname: user.nickname || user.username,
          points: 10000,
          role: 'admin',
          status: 'active',
          last_login: new Date().toISOString()
        })
      }
    } catch (e) {
      console.error('Sync user failed:', e.message)
    }

    res.json(success({
      token,
      userInfo: { id: user.id, username: user.username, role: 'admin' }
    }, '登录成功'))
  } catch (e) {
    console.error('Login error:', e)
    res.status(500).json(error('登录失败: ' + e.message))
  }
})

// 获取当前用户信息
app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json(success(req.user))
})

// ====== 路由: 任务 ======

// 创建生图任务
app.post('/api/tasks/create', authMiddleware, async (req, res) => {
  try {
    const { model, prompt, size, count = 1, refImageUrl, n } = req.body
    const numImages = parseInt(n) || parseInt(count) || 1
    if (!model || !prompt) return res.status(400).json(error('缺少必要参数'))

    // 查定价
    const pricingList = await supabaseGet('pricing_config', {
      select: '*',
      filter: { 'model': `eq.${model}`, 'status': `eq.active` },
      single: true
    })
    const pricing = Array.isArray(pricingList) ? pricingList[0] : pricingList
    if (!pricing) return res.status(400).json(error('该模型暂未开放'))

    const totalCost = pricing.points * numImages

    // 检查余额
    const userId = req.user.id
    const balanceData = await supabaseRpc('get_balance', { p_user_id: userId })
    const currentBalance = typeof balanceData === 'number' ? balanceData : (balanceData?.points || 0)

    if (currentBalance < totalCost) {
      return res.status(400).json(error(`积分不足，当前${currentBalance}，需要${totalCost}`))
    }

    // 扣积分
    try {
      await supabaseRpc('deduct_points', { p_user_id: userId, p_amount: totalCost, p_reason: `生成图片-${model}` })
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
        // 退还积分
        try { await supabaseRpc('refund_points', { p_user_id: userId, p_amount: totalCost }) } catch {}
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
app.get('/api/tasks/status/:taskId', authMiddleware, async (req, res) => {
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
      // 退积分
      try { await supabaseRpc('refund_points', { p_user_id: task.user_id, p_amount: task.points_cost }) } catch {}
    }

    res.json(success(results))
  } catch (e) {
    res.status(500).json(error('查询状态失败'))
  }
})

// 上传参考图到 Supabase Storage
app.post('/api/tasks/upload-ref', authMiddleware, async (req, res) => {
  try {
    const base64 = req.body.image
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

// 获取定价
app.get('/api/tasks/pricing', async (req, res) => {
  try {
    const list = await supabaseGet('pricing_config', {
      select: '*',
      filter: { 'status': `eq.active` },
      order: 'points.asc'
    })
    res.json(success(Array.isArray(list) ? list : []))
  } catch (e) {
    res.status(500).json(error('获取定价失败'))
  }
})

// ====== 路由: 积分 ======

// 余额
app.get('/api/points/balance', authMiddleware, async (req, res) => {
  try {
    const data = await supabaseRpc('get_balance', { p_user_id: req.user.id })
    res.json(success({ balance: typeof data === 'number' ? data : (data?.points || 0) }))
  } catch (e) {
    res.status(500).json(error('查询积分失败'))
  }
})

// 记录
app.get('/api/points/records', authMiddleware, async (req, res) => {
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

app.get('/api/history/list', authMiddleware, async (req, res) => {
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
app.get('/api/history/detail/:id', authMiddleware, async (req, res) => {
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
app.get('/api/admin/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const size = Math.min(20, Math.max(1, parseInt(req.query.size) || 10))
    const offset = (page - 1) * size

    const list = await supabaseGet('users', {
      select: '*,admin_user_id(username,nickname)',
      order: 'created_at.desc',
      limit: size,
      offset
    })

    res.json(success({ list: Array.isArray(list) ? list : [], total: 0, page, size }))
  } catch (e) {
    res.status(500).json(error('获取用户列表失败'))
  }
})

// 更新用户积分
app.put('/api/admin/users/:id/points', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { amount, reason } = req.body
    const targetId = req.params.id
    const adjustAmount = Number(amount)
    if (!adjustAmount) return res.status(400).json(error('请输入调整金额'))

    await supabaseRpc('admin_adjust_points', {
      p_user_id: targetId,
      p_amount: adjustAmount,
      p_reason: reason || '管理员手动调整'
    })

    // 查新余额
    const data = await supabaseRpc('get_balance', { p_user_id: targetId })
    res.json(success({ new_balance: typeof data === 'number' ? data : (data?.points || 0) }, '调整成功'))
  } catch (e) {
    res.status(500).json(error('调整积分失败'))
  }
})

// 定价管理
app.get('/api/admin/pricing', authMiddleware, adminOnly, async (req, res) => {
  try {
    const list = await supabaseGet('pricing_config', { select: '*', order: 'id.asc' })
    res.json(success(Array.isArray(list) ? list : []))
  } catch (e) {
    res.status(500).json(error('获取定价配置失败'))
  }
})

app.put('/api/admin/pricing/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { points, description, status } = req.body
    await supabaseUpdate('pricing_config', req.params.id, { points, description, status })
    res.json(success(null, '更新成功'))
  } catch (e) {
    res.status(500).json(error('更新定价失败'))
  }
})

// 积分流水
app.get('/api/admin/records', authMiddleware, adminOnly, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const size = Math.min(20, Math.max(1, parseInt(req.query.size) || 10))
    const offset = (page - 1) * size
    const userId = req.query.user_id

    const filter = {}
    if (userId) filter['user_id'] = `eq.${userId}`

    const list = await supabaseGet('points_records', {
      select: '*,user_id(username)',
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
app.get('/api/admin/settings', authMiddleware, adminOnly, async (req, res) => {
  try {
    const list = await supabaseGet('system_config', { select: '*' })
    res.json(success({ settings: Array.isArray(list) ? list : [] }))
  } catch (e) {
    res.status(500).json(error('获取设置失败'))
  }
})

app.put('/api/admin/settings/:key', authMiddleware, adminOnly, async (req, res) => {
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

// Health check
app.get('/api/health', (req, res) => {
  res.json(success({ status: 'ok', time: new Date().toISOString() }))
})

export default app
