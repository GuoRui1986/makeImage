/**
 * IGA Pages Serverless Function - AI生图工具 API
 * 自包含版本：不依赖 server/ 目录，所有逻辑内联
 */

import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { createClient } from '@supabase/supabase-js'

// ==================== 初始化 Supabase ====================
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false }
})

// ==================== JWT 配置 ====================
const JWT_SECRET = process.env.JWT_SECRET || 'ai-image-tool-default-secret'

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' })
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET) } catch { return null }
}

// ==================== 统一响应格式 ====================
function success(data = null, message = '操作成功') {
  return { code: 200, data, message }
}
function error(msg = '操作失败', code = 400) {
  return { code, data: null, message: msg }
}
function unauthorized() {
  return { code: 401, data: null, message: '未登录或登录已过期' }
}

// ==================== 中间件 ====================
function authRequired(req, res, next) {
  const h = req.headers.authorization
  if (!h?.startsWith('Bearer ')) return res.status(401).json(unauthorized())
  const payload = verifyToken(h.slice(7))
  if (!payload) return res.status(401).json(unauthorized())
  req.user = payload
  next()
}

function adminRequired(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ code: 403, data: null, message: '无权限访问' })
  next()
}

// ==================== 多米 API 封装 ====================
const DUOMI_BASE_URL = process.env.DUOMI_BASE_URL || 'https://duomiapi.com'

async function getApiKey() {
  const { data } = await supabase.from('system_config').select('config_value').eq('config_key', 'duomi_api_key').single()
  return data?.config_value || process.env.DUOMI_API_KEY || ''
}

async function getPointsPerImage(modelName, quality) {
  const { data } = await supabase.from('points_config').select('points_per_image').eq('model_name', modelName).eq('quality', quality).single()
  if (!data) throw new Error(`未找到模型 ${modelName} 的 ${quality} 定价配置`)
  return parseFloat(data.points_per_image)
}

async function calculateTotalCost(modelName, quality, mode, count) {
  const base = await getPointsPerImage(modelName, quality)
  if (mode === 'img2img') {
    const { data: extra } = await supabase.from('points_config').select('points_per_image').eq('model_name', 'i2i_extra').single()
    return (base + parseFloat(extra?.points_per_image || 0)) * count
  }
  return base * count
}

async function deductPoints(userId, amount, taskId) {
  const { data, error: e } = await supabase.rpc('deduct_points', { p_user_id: userId, p_amount: amount, p_task_id: taskId })
  if (e) throw new Error(e.message)
  return parseFloat(data)
}

async function refundPoints(userId, amount, taskId) {
  const { data, error: e } = await supabase.rpc('refund_points', { p_user_id: userId, p_amount: amount, p_task_id: taskId })
  if (e) throw new Error(e.message)
  return parseFloat(data)
}

async function adminAdjustPoints(userId, amount, remark) {
  const { data, error: e } = await supabase.rpc('admin_adjust_points', { p_user_id: userId, p_amount: amount, p_remark: remark })
  if (e) throw new Error(e.message)
  return parseFloat(data)
}

// --- image2 API ---
const IMAGE2_SIZE_MAP = { '1:1': '1024x1024', '3:4': '768x1024', '4:3': '1024x768', '9:16': '576x1024', '16:9': '1024x576' }
const IMAGE2_QUALITY_MAP = { standard: 'low', hd: 'high' }

async function image2CreateTask({ prompt, aspectRatio, quality, referenceImageUrl, apiKey }) {
  const size = IMAGE2_SIZE_MAP[aspectRatio] || '1024x1024'
  const q = IMAGE2_QUALITY_MAP[quality] || 'low'
  const body = { model: 'gpt-image-2', prompt, size, quality: q, n: 1, response_format: 'url' }
  if (referenceImageUrl) body.image = referenceImageUrl

  const resp = await fetch(`${DUOMI_BASE_URL}/v1/images/generations?async=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body)
  })
  const data = await resp.json()
  if (!resp.ok || data.error) throw new Error(data.error?.message || data.message || `image2 error: ${resp.status}`)
  const taskId = data.data?.id || data.id || data.task_id
  if (!taskId) throw new Error('image2 未返回 task_id')
  return { taskId: String(taskId) }
}

async function image2QueryStatus(taskId, apiKey) {
  const resp = await fetch(`${DUOMI_BASE_URL}/v1/tasks/${taskId}`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${apiKey}` }
  })
  const data = await resp.json()
  if (!resp.ok) throw new Error(data.error?.message || data.message || `query error: ${resp.status}`)
  const state = data.state
  if (state === 'succeeded') return { status: 'success', imageUrl: data.data?.images?.[0]?.url || null }
  if (state === 'failed') return { status: 'failed', error: data.error?.message || '生成失败' }
  return { status: 'pending' }
}

// --- banana API ---
const BANANA_MODEL = 'gemini-3.1-flash-image-preview'
const BANANA_QUALITY_MAP = { standard: '1K', hd: '2K' }

async function bananaCreateTextTask({ prompt, aspectRatio, quality, apiKey }) {
  const resp = await fetch(`${DUOMI_BASE_URL}/api/gemini/nano-banana`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
    body: JSON.stringify({ model: BANANA_MODEL, prompt, aspect_ratio: aspectRatio || '1:1', image_size: BANANA_QUALITY_MAP[quality] || '1K' })
  })
  const data = await resp.json()
  if (!resp.ok || data.code !== 200) throw new Error(data.message || data.msg || `banana error: ${resp.status}`)
  const taskId = data.data?.task_id
  if (!taskId) throw new Error('banana 未返回 task_id')
  return { taskId: String(taskId) }
}

async function bananaCreateImgTask({ prompt, aspectRatio, quality, referenceImageUrl, apiKey }) {
  const resp = await fetch(`${DUOMI_BASE_URL}/api/gemini/nano-banana-edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
    body: JSON.stringify({ model: BANANA_MODEL, prompt, image_urls: [referenceImageUrl], aspect_ratio: aspectRatio || 'auto', image_size: BANANA_QUALITY_MAP[quality] || '1K' })
  })
  const data = await resp.json()
  if (!resp.ok || data.code !== 200) throw new Error(data.message || data.msg || `banana edit error: ${resp.status}`)
  const taskId = data.data?.task_id
  if (!taskId) throw new Error('banana edit 未返回 task_id')
  return { taskId: String(taskId) }
}

async function bananaQueryStatus(taskId, apiKey) {
  const resp = await fetch(`${DUOMI_BASE_URL}/v1/tasks/${taskId}`, {
    method: 'GET', headers: { 'Authorization': `Bearer ${apiKey}` }
  })
  const data = await resp.json()
  if (!resp.ok) {
    // fallback: banana专用查询
    const r2 = await fetch(`${DUOMI_BASE_URL}/api/gemini/nano-banana-result?task_id=${taskId}`, {
      method: 'GET', headers: { 'Authorization': apiKey }
    })
    const d2 = await r2.json()
    if (!r2.ok || d2.code !== 200) throw new Error(d2.message || d2.msg || `banana query error: ${r2.status}`)
    const s2 = d2.data?.state || d2.data?.status
    if (s2 === 'succeeded' || s2 === 'success' || d2.data?.images?.length > 0) {
      const url = d2.data.images?.[0]?.url || d2.data.images?.[0]
      return { status: 'success', imageUrl: typeof url === 'string' ? url : url?.url }
    }
    if (s2 === 'failed') return { status: 'failed', error: d2.data?.error || '生成失败' }
    return { status: 'pending' }
  }
  const state = data.state
  if (state === 'succeeded') return { status: 'success', imageUrl: data.data?.images?.[0]?.url || null }
  if (state === 'failed') return { status: 'failed', error: data.error?.message || '生成失败' }
  return { status: 'pending' }
}

async function createSingleImageTask({ modelName, mode, prompt, aspectRatio, quality, referenceImageUrl, apiKey }) {
  if (modelName === 'image2') {
    return image2CreateTask({ prompt, aspectRatio, quality, referenceImageUrl, apiKey })
  }
  if (mode === 'img2img') {
    return bananaCreateImgTask({ prompt, aspectRatio, quality, referenceImageUrl, apiKey })
  }
  return bananaCreateTextTask({ prompt, aspectRatio, quality, apiKey })
}

async function querySingleTaskStatus(duomiId, modelName, apiKey) {
  if (modelName === 'image2') return image2QueryStatus(duomiId, apiKey)
  return bananaQueryStatus(duomiId, apiKey)
}

// ==================== Express App ====================
const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

app.get('/api/health', (_req, res) => {
  res.json(success({ status: 'ok', time: new Date().toISOString() }, '服务正常'))
})

// ========== /api/auth ==========
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body
    if (!username || !password) return res.status(400).json(error('用户名和密码不能为空'))

    const { data: admin } = await supabase.from('admin_users').select('*').eq('username', username).single()
    if (admin) {
      if (!(await bcrypt.compare(password, admin.password_hash))) return res.status(400).json(error('密码错误'))
      return res.json(success({ token: signToken({ id: admin.id, username: admin.username, role: 'admin' }), role: 'admin' }, '登录成功'))
    }

    const { data: user } = await supabase.from('users').select('*').eq('username', username).single()
    if (!user) return res.status(400).json(error('账号不存在'))
    if (user.status === 0) return res.status(400).json(error('账号已被禁用，请联系管理员'))
    if (!(await bcrypt.compare(password, user.password_hash))) return res.status(400).json(error('密码错误'))

    await supabase.from('users').update({ last_login_at: new Date().toISOString() }).eq('id', user.id)

    res.json(success({
      token: signToken({ id: user.id, username: user.username, role: 'user' }),
      role: 'user', username: user.username, pointsBalance: parseFloat(user.points_balance)
    }, '登录成功'))
  } catch (err) { res.status(500).json(error(err.message)) }
})

app.get('/api/auth/info', async (req, res) => {
  try {
    const h = req.headers.authorization
    if (!h?.startsWith('Bearer ')) return res.status(401).json(unauthorized())
    const payload = verifyToken(h.slice(7))
    if (!payload) return res.status(401).json(unauthorized())

    if (payload.role === 'admin') {
      const { data: admin } = await supabase.from('admin_users').select('id, username, created_at').eq('id', payload.id).single()
      return res.json(success({ ...admin, role: 'admin' }))
    }
    const { data: user } = await supabase.from('users').select('id, username, points_balance, status, created_at, last_login_at').eq('id', payload.id).single()
    if (!user) return res.status(401).json(unauthorized())
    if (user.status === 0) return res.status(403).json(error('账号已被禁用'))
    res.json(success({ ...user, role: 'user', pointsBalance: parseFloat(user.points_balance) }))
  } catch (err) { res.status(500).json(error(err.message)) }
})

// ========== /api/tasks ==========
app.post('/api/tasks/create', authRequired, async (req, res) => {
  try {
    let { modelName, mode, prompt, aspectRatio, quality, imageCount, referenceImageUrl } = req.body

    if (!['image2', 'banana', 'seedream'].includes(modelName)) return res.status(400).json(error('模型选择无效'))
    if (modelName === 'seedream') return res.status(400).json(error('seedream 模型开发中，暂不可用'))
    if (!['txt2img', 'img2img'].includes(mode)) return res.status(400).json(error('生成模式无效'))
    if (!prompt?.trim()) return res.status(400).json(error('提示词不能为空'))
    if (!['1:1', '3:4', '4:3', '9:16', '16:9'].includes(aspectRatio)) return res.status(400).json(error('画面比例无效'))
    if (!['standard', 'hd'].includes(quality)) return res.status(400).json(error('画质选择无效'))
    if (![1, 2, 4].includes(imageCount)) return res.status(400).json(error('生成数量无效'))
    if (mode === 'img2img' && !referenceImageUrl) return res.status(400).json(error('图生图模式需要上传参考图'))

    const totalCost = await calculateTotalCost(modelName, quality, mode, imageCount)

    const { data: user } = await supabase.from('users').select('points_balance').eq('id', req.user.id).single()
    if (!user) return res.status(400).json(error('用户不存在'))
    if (parseFloat(user.points_balance) < totalCost) return res.status(400).json(error(`积分不足，需要 ${totalCost} 积分`))

    const { data: taskRow, error: insertErr } = await supabase.from('image_tasks').insert({
      user_id: req.user.id, model_name: modelName, mode, prompt,
      aspect_ratio: aspectRatio, quality, image_count: imageCount,
      reference_image: referenceImageUrl || null, points_cost: totalCost, status: 'pending'
    }).select('id').single()
    if (insertErr) throw new Error(insertErr.message)
    const taskId = taskRow.id

    await deductPoints(req.user.id, totalCost, taskId)

    const apiKey = await getApiKey()
    if (!apiKey) {
      await refundPoints(req.user.id, totalCost, taskId)
      await supabase.from('image_tasks').update({ status: 'failed', fail_reason: '系统未配置API Key' }).eq('id', taskId)
      return res.status(500).json(error('系统未配置API Key'))
    }

    const duomiIds = []
    for (let i = 0; i < imageCount; i++) {
      try {
        const r = await createSingleImageTask({ modelName, mode, prompt, aspectRatio, quality, referenceImageUrl, apiKey })
        duomiIds.push(r.taskId)
      } catch (e) {
        await refundPoints(req.user.id, totalCost, taskId)
        await supabase.from('image_tasks').update({ status: 'failed', fail_reason: `创建任务失败: ${e.message}` }).eq('id', taskId)
        return res.status(500).json(error(`创建生图任务失败: ${e.message}`))
      }
    }

    await supabase.from('image_tasks').update({ status: 'running', duomi_task_ids: JSON.stringify(duomiIds) }).eq('id', taskId)
    res.json(success({ taskId, duomiTaskIds: duomiIds, totalCost }, '任务创建成功，正在生成中...'))
  } catch (err) { console.error('[TASK CREATE]', err); res.status(500).json(error(err.message)) }
})

app.get('/api/tasks/:id/status', authRequired, async (req, res) => {
  try {
    const taskId = parseInt(req.params.id)
    const { data: task } = await supabase.from('image_tasks').select('*').eq('id', taskId).eq('user_id', req.user.id).single()
    if (!task) return res.status(404).json(error('任务不存在'))

    if (task.status === 'success' || task.status === 'failed') {
      return res.json(success({
        taskId: task.id, status: task.status,
        resultImages: task.result_images ? JSON.parse(task.result_images) : [],
        failReason: task.fail_reason, pointsCost: parseFloat(task.points_cost)
      }))
    }

    const apiKey = await getApiKey()
    const duomiIds = task.duomi_task_ids ? JSON.parse(task.duomi_task_ids) : []
    const results = [], done = []
    let running = false

    for (const did of duomiIds) {
      if (!did) { results.push({ status: 'failed' }); continue }
      try {
        const s = await querySingleTaskStatus(did, task.model_name, apiKey)
        results.push(s); done.push(s)
        if (s.status !== 'success' && s.status !== 'failed') running = true
      } catch { results.push({ status: 'pending' }); running = true }
    }

    if (!running) {
      const urls = results.filter(r => r.imageUrl).map(r => r.imageUrl)
      const failCnt = results.filter(r => r.status === 'failed').length
      if (urls.length > 0) {
        if (failCnt > 0) {
          const perImg = parseFloat(task.points_cost) / task.image_count
          await refundPoints(task.user_id, perImg * failCnt, taskId)
        }
        await supabase.from('image_tasks').update({ status: 'success', result_images: JSON.stringify(urls), finished_at: new Date().toISOString() }).eq('id', taskId)
        return res.json(success({ taskId: task.id, status: 'success', resultImages: urls, pointsCost: parseFloat(task.points_cost), failedCount: failCnt }))
      }
      await refundPoints(task.user_id, parseFloat(task.points_cost), taskId)
      await supabase.from('image_tasks').update({ status: 'failed', fail_reason: '全部生成失败', finished_at: new Date().toISOString() }).eq('id', taskId)
      return res.json(success({ taskId: task.id, status: 'failed', failReason: '全部生成失败' }))
    }

    res.json(success({ taskId: task.id, status: 'running', pendingCount: duomiIds.length - done.filter(d => ['success','failed'].includes(d.status)).length }))
  } catch (err) { res.status(500).json(error(err.message)) }
})

app.post('/api/tasks/upload-ref', authRequired, async (req, res) => {
  try {
    const { imageBase64, filename } = req.body
    if (!imageBase64) return res.status(400).json(error('图片数据不能为空'))
    const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'guo rui'
    const fn = `refs/${Date.now()}-${filename || 'ref.png'}`
    const buf = Buffer.from(imageBase64, 'base64')
    const { error: ue } = await supabase.storage.from(bucket).upload(fn, buf, { contentType: 'image/png', upsert: false })
    if (ue) throw new Error(ue.message)
    const { data: ud } = supabase.storage.from(bucket).getPublicUrl(fn)
    res.json(success({ url: ud.publicUrl }, '上传成功'))
  } catch (err) { res.status(500).json(error(err.message)) }
})

app.get('/api/tasks/pricing', authRequired, async (_req, res) => {
  try {
    const { data: configs } = await supabase.from('points_config').select('model_name, quality, points_per_image').order('model_name').order('quality')
    const pricing = {}
    ;(configs || []).forEach(c => {
      if (c.model_name === 'i2i_extra') return
      if (!pricing[c.model_name]) pricing[c.model_name] = {}
      pricing[c.model_name][c.quality] = parseFloat(c.points_per_image)
    })
    res.json(success({ pricing, models: [
      { name: 'image2', label: 'image2', available: true },
      { name: 'banana', label: 'banana', available: true },
      { name: 'seedream', label: 'seedream', available: false }
    ] }))
  } catch (err) { res.status(500).json(error(err.message)) }
})

// ========== /api/points ==========
app.get('/api/points/balance', authRequired, async (req, res) => {
  try {
    let { data: u } = await supabase.from('users').select('points_balance').eq('id', req.user.id).single()
    if (!u && req.user.role === 'admin') {
      const { data: fb } = await supabase.from('users').select('points_balance').eq('username', req.user.username).single()
      u = fb
    }
    if (!u) return res.status(404).json(error('用户不存在'))
    res.json(success({ balance: parseFloat(u.points_balance) }))
  } catch (err) { res.status(500).json(error(err.message)) }
})

app.get('/api/points/records', authRequired, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1, PS = 20
    const { data: rows, count } = await supabase.from('points_records')
      .select('id, amount, balance_after, type, related_task_id, remark, created_at', { count: 'exact' })
      .eq('user_id', req.user.id).order('created_at', { ascending: false })
      .range((page - 1) * PS, page * PS - 1)
    const TL = { admin_add: '管理员发放', generate_deduct: '生图扣除', fail_refund: '失败返还' }
    const records = (rows || []).map(r => ({ ...r, amount: parseFloat(r.amount), balanceAfter: parseFloat(r.balance_after), typeLabel: TL[r.type] || r.type, createdAt: r.created_at }))
    res.json(success({ records, total: count || 0, page, pageSize: PS, totalPages: Math.ceil((count || 0) / PS) }))
  } catch (err) { res.status(500).json(error(err.message)) }
})

// ========== /api/history ==========
app.get('/api/history', authRequired, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1, PS = 12
    const { data: rows, count } = await supabase.from('image_tasks')
      .select('id, model_name, mode, prompt, aspect_ratio, quality, image_count, points_cost, status, result_images, created_at', { count: 'exact' })
      .eq('user_id', req.user.id).order('created_at', { ascending: false }).range((page - 1) * PS, page * PS - 1)
    const records = (rows || []).map(r => ({
      id: r.id, modelName: r.model_name, mode: r.mode, prompt: r.prompt, aspectRatio: r.aspect_ratio,
      quality: r.quality, imageCount: r.image_count, pointsCost: parseFloat(r.points_cost), status: r.status,
      firstImage: r.result_images ? JSON.parse(r.result_images)[0] || null : null, createdAt: r.created_at
    }))
    res.json(success({ records, total: count || 0, page, pageSize: PS, totalPages: Math.ceil((count || 0) / PS) }))
  } catch (err) { res.status(500).json(error(err.message)) }
})

app.get('/api/history/:id', authRequired, async (req, res) => {
  try {
    const { data: t } = await supabase.from('image_tasks').select('*').eq('id', parseInt(req.params.id)).eq('user_id', req.user.id).single()
    if (!t) return res.status(404).json(error('任务不存在'))
    res.json(success({
      id: t.id, modelName: t.model_name, mode: t.mode, prompt: t.prompt, aspectRatio: t.aspect_ratio,
      quality: t.quality, imageCount: t.image_count, referenceImage: t.reference_image,
      pointsCost: parseFloat(t.points_cost), status: t.status,
      resultImages: t.result_images ? JSON.parse(t.result_images) : [], failReason: t.fail_reason,
      createdAt: t.created_at, finishedAt: t.finished_at
    }))
  } catch (err) { res.status(500).json(error(err.message)) }
})

// ========== /api/admin/users ==========
app.get('/api/admin/users', [authRequired, adminRequired], async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1, kw = req.query.keyword || '', PS = 20, off = (page - 1) * PS
    let q = supabase.from('users').select('id, username, points_balance, status, created_at, last_login_at', { count: 'exact' }).order('created_at', { ascending: false })
    if (kw) q = q.ilike('username', `%${kw}%`)
    const { data: rows, count } = await q.range(off, off + PS - 1)
    const users = (rows || []).map(r => ({ ...r, pointsBalance: parseFloat(r.points_balance), createdAt: r.created_at, lastLoginAt: r.last_login_at }))
    res.json(success({ users, total: count || 0, page, pageSize: PS, totalPages: Math.ceil((count || 0) / PS) }))
  } catch (err) { res.status(500).json(error(err.message)) }
})

app.post('/api/admin/users', [authRequired, adminRequired], async (req, res) => {
  try {
    const { username, password, initialPoints } = req.body
    if (!username?.trim()) return res.status(400).json(error('用户名不能为空'))
    if (!password?.trim()) return res.status(400).json(error('密码不能为空'))
    if (username.length < 2) return res.status(400).json(error('用户名至少2字符'))
    if (password.length < 6) return res.status(400).json(error('密码至少6字符'))

    const { data: exists } = await supabase.from('users').select('id').eq('username', username).single()
    if (exists) return res.status(400).json(error('用户名已存在'))

    const pts = parseFloat(initialPoints) || 0
    const hash = await bcrypt.hash(password, 10)
    const { data: result, error: ie } = await supabase.from('users').insert({ username, password_hash: hash, points_balance: pts, status: 1 }).select('id, username, points_balance, status, created_at').single()
    if (ie) throw new Error(ie.message)
    if (pts > 0) await supabase.from('points_records').insert({ user_id: result.id, amount: pts, balance_after: pts, type: 'admin_add', remark: '初始积分发放' })
    res.json(success({ ...result, pointsBalance: parseFloat(result.points_balance) }, '用户创建成功'))
  } catch (err) { res.status(500).json(error(err.message)) }
})

app.put('/api/admin/users/:id/points', [authRequired, adminRequired], async (req, res) => {
  try {
    const userId = parseInt(req.params.id), { amount, remark } = req.body
    const adj = parseFloat(amount)
    if (isNaN(adj) || adj === 0) return res.status(400).json(error('调整数额无效'))
    const { data: u } = await supabase.from('users').select('id').eq('id', userId).single()
    if (!u) return res.status(404).json(error('用户不存在'))
    const nb = await adminAdjustPoints(userId, adj, remark)
    res.json(success({ userId, newBalance: nb }, '积分调整成功'))
  } catch (err) { res.status(500).json(error(err.message)) }
})

app.put('/api/admin/users/:id/password', [authRequired, adminRequired], async (req, res) => {
  try {
    const { newPassword } = req.body
    if (!newPassword?.trim() || newPassword.length < 6) return res.status(400).json(error('新密码至少6字符'))
    const hash = await bcrypt.hash(newPassword, 10)
    await supabase.from('users').update({ password_hash: hash }).eq('id', parseInt(req.params.id))
    res.json(success(null, '密码重置成功'))
  } catch (err) { res.status(500).json(error(err.message)) }
})

app.put('/api/admin/users/:id/status', [authRequired, adminRequired], async (req, res) => {
  try {
    const { status } = req.body
    if (![0, 1].includes(status)) return res.status(400).json(error('状态值无效'))
    await supabase.from('users').update({ status }).eq('id', parseInt(req.params.id))
    res.json(success(null, status ? '用户已启用' : '用户已禁用'))
  } catch (err) { res.status(500).json(error(err.message)) }
})

// ========== /api/admin/pricing ==========
app.get('/api/admin/pricing', [authRequired, adminRequired], async (_req, res) => {
  try {
    const { data: configs } = await supabase.from('points_config').select('id, model_name, quality, points_per_image').order('model_name').order('quality')
    res.json(success({ pricing: (configs || []).map(c => ({ ...c, pointsPerImage: parseFloat(c.points_per_image) })) }))
  } catch (err) { res.status(500).json(error(err.message)) }
})

app.put('/api/admin/pricing', [authRequired, adminRequired], async (req, res) => {
  try {
    const { pricing } = req.body
    if (!Array.isArray(pricing) || pricing.length === 0) return res.status(400).json(error('定价数据不能为空'))
    for (const item of pricing) {
      if (!item.id) continue
      const pts = parseFloat(item.pointsPerImage)
      if (isNaN(pts) || pts < 0) return res.status(400).json(error(`ID ${item.id} 的积分无效`))
      const { error: ue } = await supabase.from('points_config').update({ points_per_image: pts }).eq('id', item.id)
      if (ue) throw new Error(ue.message)
    }
    res.json(success(null, '定价已更新'))
  } catch (err) { res.status(500).json(error(err.message)) }
})

// ========== /api/admin/records ==========
const TYPE_LABELS = { admin_add: '管理员发放', generate_deduct: '生图扣除', fail_refund: '失败返还' }

app.get('/api/admin/records/points', [authRequired, adminRequired], async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1, PS = 20, off = (page - 1) * PS
    const { username, type, startDate, endDate } = req.query
    let userIds = null
    if (username) {
      const { data: mu } = await supabase.from('users').select('id, username').ilike('username', `%${username}%`)
      userIds = (mu || []).map(u => u.id)
      if (userIds.length === 0) return res.json(success({ records: [], total: 0, page, pageSize: PS, totalPages: 0 }))
    }
    let q = supabase.from('points_records').select('id, user_id, amount, balance_after, type, related_task_id, remark, created_at, users!inner(username)', { count: 'exact' })
    if (userIds) q = q.in('user_id', userIds)
    if (type) q = q.eq('type', type)
    if (startDate) q = q.gte('created_at', startDate)
    if (endDate) q = q.lte('created_at', endDate)
    const { data: rows, count } = await q.order('created_at', { ascending: false }).range(off, off + PS - 1)
    const records = (rows || []).map(r => ({ id: r.id, userId: r.user_id, username: r.users?.username || '', amount: parseFloat(r.amount), balanceAfter: parseFloat(r.balance_after), type: r.type, typeLabel: TYPE_LABELS[r.type] || r.type, createdAt: r.created_at, remark: r.remark }))
    res.json(success({ records, total: count || 0, page, pageSize: PS, totalPages: Math.ceil((count || 0) / PS) }))
  } catch (err) { res.status(500).json(error(err.message)) }
})

app.get('/api/admin/records/images', [authRequired, adminRequired], async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1, PS = 20, off = (page - 1) * PS
    const { username, modelName, status, startDate, endDate } = req.query
    let userIds = null
    if (username) {
      const { data: mu } = await supabase.from('users').select('id, username').ilike('username', `%${username}%`)
      userIds = (mu || []).map(u => u.id)
      if (userIds.length === 0) return res.json(success({ records: [], total: 0, page, pageSize: PS, totalPages: 0 }))
    }
    let q = supabase.from('image_tasks').select('id, user_id, model_name, mode, aspect_ratio, quality, image_count, points_cost, status, result_images, fail_reason, created_at, finished_at, users!inner(username)', { count: 'exact' })
    if (userIds) q = q.in('user_id', userIds)
    if (modelName) q = q.eq('model_name', modelName)
    if (status) q = q.eq('status', status)
    if (startDate) q = q.gte('created_at', startDate)
    if (endDate) q = q.lte('created_at', endDate)
    const { data: rows, count } = await q.order('created_at', { ascending: false }).range(off, off + PS - 1)
    const records = (rows || []).map(r => ({
      id: r.id, userId: r.user_id, username: r.users?.username || '', modelName: r.model_name, mode: r.mode,
      aspectRatio: r.aspect_ratio, quality: r.quality, imageCount: r.image_count, pointsCost: parseFloat(r.points_cost),
      status: r.status, firstImage: r.result_images ? JSON.parse(r.result_images)[0] || null : null,
      failReason: r.fail_reason, createdAt: r.created_at, finishedAt: r.finished_at
    }))
    res.json(success({ records, total: count || 0, page, pageSize: PS, totalPages: Math.ceil((count || 0) / PS) }))
  } catch (err) { res.status(500).json(error(err.message)) }
})

app.get('/api/admin/records/images/:id', [authRequired, adminRequired], async (req, res) => {
  try {
    const { data: t } = await supabase.from('image_tasks').select('*, users!inner(username)').eq('id', parseInt(req.params.id)).single()
    if (!t) return res.status(404).json(error('任务不存在'))
    res.json(success({ ...t, username: t.users?.username || '', pointsCost: parseFloat(t.points_cost), resultImages: t.result_images ? JSON.parse(t.result_images) : [], createdAt: t.created_at, finishedAt: t.finished_at }))
  } catch (err) { res.status(500).json(error(err.message)) }
})

// ========== /api/admin/settings ==========
app.get('/api/admin/settings', [authRequired, adminRequired], async (_req, res) => {
  try {
    const { data: configs } = await supabase.from('system_config').select('config_key, config_value')
    const settings = {}
    for (const c of configs || []) {
      if (c.config_key === 'duomi_api_key' && c.config_value) {
        settings.duomi_api_key = c.config_value.slice(0, 4) + '****' + c.config_value.slice(-4)
        settings.duomi_api_key_configured = true
      } else { settings[c.config_key] = c.config_value }
    }
    res.json(success({ settings }))
  } catch (err) { res.status(500).json(error(err.message)) }
})

app.put('/api/admin/settings/api', [authRequired, adminRequired], async (req, res) => {
  try {
    const { duomiApiKey, duomiBaseUrl } = req.body
    if (duomiApiKey && !duomiApiKey.includes('****')) {
      const { data: ex } = await supabase.from('system_config').select('id').eq('config_key', 'duomi_api_key').single()
      if (ex) await supabase.from('system_config').update({ config_value: duomiApiKey, updated_at: new Date().toISOString() }).eq('config_key', 'duomi_api_key')
      else await supabase.from('system_config').insert({ config_key: 'duomi_api_key', config_value: duomiApiKey })
    }
    if (duomiBaseUrl) {
      const { data: ex } = await supabase.from('system_config').select('id').eq('config_key', 'duomi_base_url').single()
      if (ex) await supabase.from('system_config').update({ config_value: duomiBaseUrl, updated_at: new Date().toISOString() }).eq('config_key', 'duomi_base_url')
      else await supabase.from('system_config').insert({ config_key: 'duomi_base_url', config_value: duomiBaseUrl })
    }
    res.json(success(null, 'API配置已更新'))
  } catch (err) { res.status(500).json(error(err.message)) }
})

app.put('/api/admin/settings/password', [authRequired, adminRequired], async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body
    if (!newPassword?.trim() || newPassword.length < 6) return res.status(400).json(error('新密码至少6字符'))
    const { data: admin } = await supabase.from('admin_users').select('password_hash').eq('id', req.user.id).single()
    if (!admin) return res.status(404).json(error('管理员不存在'))
    if (!(await bcrypt.compare(oldPassword, admin.password_hash))) return res.status(400).json(error('原密码错误'))
    const hash = await bcrypt.hash(newPassword, 10)
    await supabase.from('admin_users').update({ password_hash: hash }).eq('id', req.user.id)
    res.json(success(null, '密码修改成功'))
  } catch (err) { res.status(500).json(error(err.message)) }
})

// ========== 错误处理 ==========
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message)
  res.status(err.status || 500).json({ code: err.status || 500, data: null, message: err.message || '服务器内部错误' })
})

app.use((_req, res) => {
  res.status(404).json({ code: 404, data: null, message: '接口不存在' })
})

export default app
