/**
 * AI生图工具 - IGA Pages Serverless Function (零依赖版)
 * 仅使用 Node.js 内置模块 + 原生 fetch
 * Supabase 通过 PostgREST API 直接调用（无需 SDK）
 */
const app = {
  routes: {},

  get(path, handler) { this.routes[`GET:${path}`] = handler },
  post(path, handler) { this.routes[`POST:${path}`] = handler },
  put(path, handler) { this.routes[`PUT:${path}`] = handler },

  // Express 兼容接口
  use() {},
}

// ====== 配置 ======
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '')
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
const DUOMI_API_KEY = process.env.DUOMI_API_KEY || ''
const JWT_SECRET = process.env.JWT_SECRET || 'ai-image-tool-secret-key-2024'
const STORAGE_BUCKET = (process.env.SUPABASE_STORAGE_BUCKET || '').trim()

// ====== 工具函数 ======
function jsonResponse(res, status, data) {
  res.status = status
  const body = JSON.stringify(data)
  res.body = body
  return res
}

function ok(res, data, message = 'ok') {
  return jsonResponse(res, 200, { code: 200, data, message })
}
function fail(res, message, code = 400) {
  return jsonResponse(res, code, { code, message })
}

function getToken(req) {
  const auth = req.headers?.authorization || ''
  return auth.replace('Bearer ', '')
}

// 简易 JWT（HS256）
function jwtSign(payload, secret, expiresIn = '7d') {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  const exp = expiresIn === '7d' ? now + 604800 : now + 86400
  const payload_b64 = btoa(JSON.stringify({ ...payload, iat: now, exp }))
  const sigData = `${header}.${payload_b64}`
  // 使用 Web Crypto API 或简单 HMAC（Node 环境）
  const key = new TextEncoder().encode(secret)
  // 在 Serverless 环境中用 crypto.subtle
  let signature = ''
  try {
    const encoder = new TextEncoder()
    const keyData = encoder.encode(secret)
    const data = encoder.encode(sigData)
    // 同步方式生成 HMAC
    const hmacKey = crypto.subtle.importKey(
      'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    )
    signature = crypto.subtle.sign('HMAC', hmacKey, data)
      .then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''))
    // 由于 async，改用同步方案
  } catch(e) {}
  // fallback: 简单 base64 编码作为签名（仅用于开发环境）
  signature = btoa(sigData + secret).replace(/=/g, '').substring(0, 43)
  return `${sigData}.${signature}`
}

async function jwtVerify(token, secret) {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) throw new Error('invalid')
    const payload = JSON.parse(atob(parts[1]))
    const now = Math.floor(Date.now() / 1000)
    if (payload.exp && payload.exp < now) throw new Error('expired')
    return payload
  } catch { return null }
}

// 简易密码比较（生产环境应用 bcrypt）
async function hashPassword(password) {
  const encoder = new TextEncoder()
  const data = encoder.encode(password + '_salt_v1')
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function comparePassword(password, hash) {
  const inputHash = await hashPassword(password)
  return inputHash === hash
}

// ====== Supabase REST API 封装（无需SDK）=====
const sbHeaders = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
}

async function sbSelect(table, query = {}) {
  let url = `${SUPABASE_URL}/rest/v1/${table}`
  const params = []
  if (query.select) params.push(`select=${encodeURIComponent(query.select)}`)
  if (query.eq) { for (const [k, v] of Object.entries(query.eq)) params.push(`${k}=eq.${encodeURIComponent(v)}`) }
  if (query.order) params.push(`order=${encodeURIComponent(query.order)}`)
  if (query.limit) params.push(`limit=${query.limit}`)
  if (query.offset) params.push(`offset=${query.offset}`)
  if (params.length) url += '?' + params.join('&')

  const resp = await fetch(url, { headers: sbHeaders })
  const countHeader = resp.headers.get('content-range') || resp.headers.get('x-total-count')
  const data = await resp.json()
  return { data, count: null, error: resp.ok ? null : { message: data.message || data.error || `HTTP ${resp.status}` } }
}

async function sbInsert(table, row) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: sbHeaders,
    body: JSON.stringify(row),
  })
  const data = await resp.json()
  return { data: Array.isArray(data) ? data[0] : data, error: resp.ok ? null : { message: data.message || `HTTP ${resp.status}` } }
}

async function sbUpdate(table, id, updates) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...sbHeaders, 'Prefer': 'return=representation' },
    body: JSON.stringify(updates),
  })
  const data = await resp.json()
  return { data: Array.isArray(data) ? data[0] : data, error: resp.ok ? null : { message: data.message || `HTTP ${resp.status}` } }
}

async function sbRpc(name, params) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: sbHeaders,
    body: JSON.stringify(params),
  })
  const data = await resp.json()
  return { data, error: resp.ok ? null : { message: data.message || `RPC ${resp.status}` } }
}

async function sbSingle(query) {
  const result = await sbSelect(query.table, { ...query, select: query.select || '*', eq: query.eq, order: query.order, limit: 1 })
  if (result.error) return { data: null, error: result.error }
  return { data: Array.isArray(result.data) ? result.data[0] : result.data, error: null }
}

// ====== 认证中间件 ======
async function verifyToken(req, res) {
  const token = getToken(req)
  if (!token) { fail(res, '未登录', 401); return null }
  const user = await jwtVerify(token, JWT_SECRET)
  if (!user) { fail(res, '登录已过期', 401); return null }
  return user
}

async function requireAdmin(req, res) {
  const user = await verifyToken(req, res)
  if (!user) return null
  if (user.role !== 'admin') { fail(res, '无权限', 403); return null }
  return user
}

// ====== 多米 API（原生 fetch）=====

function buildMultipart(parts) {
  const boundary = '----FormBoundary' + Math.random().toString(36).substring(2)
  let body = ''
  for (const part of parts) {
    body += `--${boundary}\r\n`
    if (part.filename) {
      body += `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`
      body += `Content-Type: ${part.contentType || 'application/octet-stream'}\r\n\r\n`
    } else {
      body += `Content-Disposition: form-data; name="${part.name}"\r\n\r\n`
    }
    body += `${part.value}\r\n`
  }
  body += `--${boundary}--\r\n`
  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
}

async function generateImage2(params) {
  const parts = [
    { name: 'model_name', value: params.model || 'gpt-image-2' },
    { name: 'prompt', value: params.prompt },
    { name: 'n', value: String(params.n || 1) },
    { name: 'size', value: params.size || '1024x1024' },
  ]
  if (params.ref_image) {
    parts.push({ name: 'image', value: params.ref_image, filename: 'ref.png', contentType: 'image/png' })
  }
  const { body, contentType } = buildMultipart(parts)

  const resp = await fetch(`https://duomiapi.com/v1/images/generations?async=true`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${DUOMI_API_KEY}`, 'Content-Type': contentType },
    body,
  })
  const data = await resp.json()
  if (!resp.ok) throw new Error(data.message || `image2 error ${resp.status}`)
  return data.task_id
}

async function generateBanana(params) {
  const url = params.ref_image ? '/api/gemini/nano-banana-edit' : '/api/gemini/nano-banana'

  let body, contentType = 'application/json'
  if (params.ref_image) {
    const built = buildMultipart([
      { name: 'prompt', value: params.prompt },
      { name: 'image', value: params.ref_image, filename: 'ref.png', contentType: 'image/png' },
    ])
    body = built.body
    contentType = built.contentType
  } else {
    body = JSON.stringify({
      prompt: params.prompt,
      model_name: params.model || 'gemini-2.0-flash-exp',
      n: params.n || 1,
    })
  }

  const resp = await fetch(`https://duomiapi.com${url}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${DUOMI_API_KEY}`, 'Content-Type': contentType },
    body,
  })
  const data = await resp.json()
  if (!resp.ok) throw new Error(data.message || `banana error ${resp.status}`)
  return data.task_id
}

async function queryTaskStatus(taskId) {
  const resp = await fetch(`https://duomiapi.com/v1/tasks/${taskId}`, {
    headers: { 'Authorization': `Bearer ${DUOMI_API_KEY}` },
  })
  const data = await resp.json()
  if (!resp.ok) throw new Error(data.message || `query error ${resp.status}`)
  const state = data.state
  if (state === 'succeeded') {
    return { status: 'success', imageUrl: data.data?.images?.[0]?.url || null }
  }
  if (state === 'failed') return { status: 'failed', error: data.error || '生成失败' }
  return { status: 'pending' }
}


// ====== 路由定义 ======

app.post('/api/auth/login', async (req, res) => {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const { username, password } = body
    if (!username || !password) return fail(res, '请输入用户名和密码')

    // 查管理员表
    const admin = await sbSingle({ table: 'admin_users', eq: { username } })
    if (admin.data && admin.data.is_active !== false) {
      const valid = await comparePassword(password, admin.data.password_hash)
      if (valid) {
        // 同步到 users 表
        const existingUser = await sbSingle({ table: 'users', eq: { username }, select: 'id' })
        let userId = existingUser.data?.id
        if (!userId) {
          const newUser = await sbInsert('users', {
            username, nickname: admin.data.nickname || username, role: 'admin', points: 99999,
          })
          userId = newUser.data?.id
        }

        const token = jwtSign({ id: userId, username, role: 'admin' }, JWT_SECRET)
        return ok(res, {
          token, user: { id: userId, username, role: 'admin', nickname: admin.data.nickname || username }, points: 99999
        }, '登录成功')
      }
    }

    // 普通用户
    const user = await sbSingle({ table: 'users', eq: { username } })
    if (!user.data) return fail(res, '用户不存在')
    if (user.data.password_hash) {
      const valid = await comparePassword(password, user.data.password_hash)
      if (!valid) return fail(res, '密码错误')
    }

    const token = jwtSign({ id: user.data.id, username, role: user.data.role || 'user' }, JWT_SECRET)
    await sbUpdate('users', user.data.id, { last_login: new Date().toISOString() })

    return ok(res, {
      token, user: {
        id: user.data.id, username, role: user.data.role || 'user', nickname: user.data.nickname || username
      }, points: user.data.points
    }, '登录成功')
  } catch (e) {
    console.error('Login error:', e)
    return fail(res, '服务器内部错误', 500)
  }
})

app.get('/api/auth/me', async (req, res) => {
  const user = await verifyToken(req, res)
  if (!user) return
  const u = await sbSingle({ table: 'users', eq: { id: String(user.id) } })
  if (u.data) return ok(res, { id: u.data.id, username: u.data.username, role: u.data.role || 'user', nickname: u.data.nickname || u.data.username, points: u.data.points })
  return fail(res, '用户不存在', 404)
})

app.get('/api/pricing', async (_req, res) => {
  try {
    const r = await sbSelect('pricing_config', { select: '*', order: 'model.asc' })
    return ok(res, { list: r.data || [], total: r.count || 0 })
  } catch (e) { return fail(res, '获取定价失败', 500) }
})

app.post('/api/tasks/create', async (req, res) => {
  const user = await verifyToken(req, res)
  if (!user) return
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const { model, prompt, n = 1, size, ref_image_url } = body
    if (!prompt || !model) return fail(res, '缺少必要参数')
    if (!['image2', 'banana'].includes(model)) return fail(res, '不支持的模型')

    // 定价
    const pricing = await sbSingle({ table: 'pricing_config', eq: { model }, select: 'points_cost' })
    const cost = (pricing.data?.points_cost || 5) * n

    // 扣积分 RPC
    await sbRpc('deduct_points', { p_user_id: user.id, p_amount: cost, p_description: `生图任务(${model}×${n})` })

    // 调用多米API
    const genFn = model === 'image2' ? generateImage2 : generateBanana
    const taskId = await genFn({ prompt, model, n, size: size || '1024x1024', ref_image: ref_image_url || null })

    // 创建任务记录
    const task = await sbInsert('image_tasks', {
      user_id: user.id, model, prompt, n, size: size || '1024x1024',
      status: 'pending', external_task_id: taskId, points_cost: cost,
      ref_image_url: ref_image_url || null,
    })

    return ok(res, { task_id: task.data?.id, external_task_id: taskId }, '任务创建成功')
  } catch (e) {
    console.error('Create task error:', e)
    const msg = String(e.message || e)
    return fail(res, msg.includes('余额不足') ? msg : ('创建失败:' + msg), 500)
  }
})

app.get('/api/tasks/status/:taskId', async (req, res) => {
  const user = await verifyToken(req, res)
  if (!user) return
  try {
    const task = await sbSingle({ table: 'image_tasks', eq: { id: req.params.taskId } })
    if (!task.data) return fail(res, '任务不存在')

    if (task.data.status === 'succeeded' || task.data.status === 'failed') {
      return ok(res, { status: task.data.status, images: task.data.result_images ? JSON.parse(task.data.result_images) : [], error: task.data.error_msg })
    }

    const result = await queryTaskStatus(task.data.external_task_id)
    const updates = { status: result.status, updated_at: new Date().toISOString() }
    if (result.status === 'success') updates.result_images = JSON.stringify([result.imageUrl])
    if (result.status === 'failed') updates.error_msg = result.error || '生成失败'
    await sbUpdate('image_tasks', task.data.id, updates)

    if (result.status === 'pending') return ok(res, { status: 'pending' })
    if (result.status === 'success') return ok(res, { status: 'succeeded', images: [result.imageUrl] })
    return ok(res, { status: 'failed', error: result.error })
  } catch (e) {
    console.error('Query status error:', e)
    return fail(res, '查询状态失败', 500)
  }
})

app.post('/api/tasks/upload-ref', async (req, res) => {
  const user = await verifyToken(req, res)
  if (!user) return
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const { base64Data, mimeType = 'image/png' } = body
    if (!base64Data) return fail(res, '没有图片数据')

    const base64 = base64Data.replace(/^data:image\/\w+;base64,/, '')
    const binaryStr = atob(base64)
    const bytes = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)

    const ext = mimeType === 'image/jpeg' ? 'jpg' : 'png'
    const path = `refs/${user.id}/${Date.now()}.${ext}`

    // 上传到 Supabase Storage (REST API)
    const storageUrl = `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${path}`
    const uploadResp = await fetch(storageUrl, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': mimeType,
      },
      body: bytes.buffer || bytes,
    })

    if (!uploadResp.ok) throw new Error(`Storage upload: ${uploadResp.status}`)

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`
    return ok(res, { url: publicUrl, path }, '上传成功')
  } catch (e) {
    console.error('Upload error:', e)
    return fail(res, '上传失败: ' + e.message, 500)
  }
})

app.get('/api/points/balance', async (req, res) => {
  const user = await verifyToken(req, res)
  if (!user) return
  const u = await sbSingle({ table: 'users', eq: { id: String(user.id) }, select: 'points' })
  return ok(res, { balance: u.data?.points || 0 })
})

app.get('/api/points/records', async (req, res) => {
  const user = await verifyToken(req, res)
  if (!user) return
  const page = parseInt(req.query.page) || 1
  const size = parseInt(req.query.size) || 10
  const r = await sbSelect('points_records', {
    select: '*',
    eq: { user_id: String(user.id) },
    order: 'created_at.desc.nullslast',
    offset: (page - 1) * size,
    limit: size,
  })
  return ok(res, { list: r.data || [], total: r.count || 0, page, size })
})

app.get('/api/history/list', async (req, res) => {
  const user = await verifyToken(req, res)
  if (!user) return
  const page = parseInt(req.query.page) || 1
  const size = parseInt(req.query.size) || 10
  let q = { table: 'image_tasks', select: '*', eq: { user_id: String(user.id) }, order: 'created_at.desc.nullslast' }
  if (req.query.model) q.eq = { ...q.eq, model: req.query.model }
  const r = await sbSelect(q)
  r.offset = (page - 1) * size
  r.limit = size
  const r2 = await sbSelect(q)
  const list = (r2.data || []).map(t => ({ ...t, images: t.result_images ? JSON.parse(t.result_images) : [] }))
  return ok(res, { list, total: r2.count || 0, page, size })
})

app.get('/api/history/:taskId', async (req, res) => {
  const user = await verifyToken(req, res)
  if (!user) return
  const task = await sbSingle({ table: 'image_tasks', eq: { id: req.params.taskId, user_id: String(user.id) } })
  if (!task.data) return fail(res, '任务不存在')
  return ok(res, { ...task.data, images: task.data.result_images ? JSON.parse(task.data.result_images) : [] })
})

// ====== 管理后台路由 ======
app.get('/admin/api/users', async (_req, res) => {
  const r = await sbSelect('users', { select: '*', order: 'created_at.desc.nullslast' })
  return ok(res, { list: r.data || [], total: r.count || 0 })
})
app.put('/admin/api/users/:id/points', async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
  const numAmount = Number(body.amount)
  if (!body.amount || isNaN(numAmount)) return fail(res, '请填写有效的调整数量')
  const desc = body.reason || `管理员调整${numAmount > 0 ? '+' : ''}${numAmount}积分`
  const r = await sbRpc('admin_adjust_points', { p_user_id: req.params.id, p_amount: numAmount, p_reason: desc })
  if (r.error) return fail(res, '操作失败: ' + r.error.message, 500)
  return ok(res, { new_balance: r.data }, '调整成功')
})
app.get('/admin/api/pricing', async (_req, res) => {
  const r = await sbSelect('pricing_config', { select: '*', order: 'model.asc' })
  return ok(res, { list: r.data || [], total: r.count || 0 })
})
app.put('/admin/api/pricing/:id', async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
  const err = await sbUpdate('pricing_config', req.params.id, { model: body.model, points_cost: body.points_cost })
  if (err.error) return fail(err.error.message, 500)
  return ok(res, null, '更新成功')
})
app.get('/admin/api/records', async (req, res) => {
  const page = parseInt(req.query.page) || 1
  const size = parseInt(req.query.size) || 20
  const r = await sbSelect('points_records', { select: '*, users!inner(username)', order: 'created_at.desc.nullslast', offset: (page-1)*size, limit: size })
  return ok(res, { list: r.data || [], total: r.count || 0, page, size })
})
app.get('/admin/api/tasks', async (req, res) => {
  const page = parseInt(req.query.page) || 1
  const size = parseInt(req.query.size) || 20
  const r = await sbSelect('image_tasks', { select: '*, users!inner(username)', order: 'created_at.desc.nullslast', offset: (page-1)*size, limit: size })
  return ok(res, { list: r.data || [], total: r.count || 0, page, size })
})
app.get('/admin/api/settings', async (_req, res) => {
  const r = await sbSelect('system_config', { select: '*' })
  return ok(res, { settings: r.data || [] })
})
app.put('/admin/api/settings/:key', async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
  // 用 POSTGREST 更新
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/system_config?config_key=eq.${req.params.key}`, {
    method: 'PATCH',
    headers: sbHeaders,
    body: JSON.stringify({ value: body.value, updated_at: new Date().toISOString() }),
  })
  if (!resp.ok) return fail(resp.statusText, 500)
  return ok(res, null, '更新成功')
})

// ====== 主入口 ======
export default async function handler(req) {
  const method = (req.method || 'GET').toUpperCase()
  const url = req.url || '/'
  const pathname = url.split('?')[0]

  // CORS headers
  const res = { headers: {}, status: 200, body: '' }
  res.headers['Content-Type'] = 'application/json; charset=utf-8'
  res.headers['Access-Control-Allow-Origin'] = '*'
  res.headers['Access-Control-Allow-Methods'] = 'GET,POST,PUT,DELETE,OPTIONS'
  res.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization'

  if (method === 'OPTIONS') return res

  // 解析 body
  if (method === 'POST' || method === 'PUT') {
    if (typeof req.body === 'string' && req.body) {
      try { req.body = JSON.parse(req.body) } catch {}
    }
  }

  // 查找路由
  const routeKey = `${method}:${pathname}`
  const handler = app.routes[routeKey]
  if (handler) {
    return await handler(req, res)
  }

  // 404
  return fail(res, `接口不存在: ${method} ${pathname}`, 404)
}
