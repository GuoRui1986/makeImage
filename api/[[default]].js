/**
 * AI生图工具 - IGA Pages Serverless Function (自包含版)
 * 精简依赖: 仅使用 express + @supabase/supabase-js + jsonwebtoken + bcryptjs + cors
 * 多米API调用使用原生 fetch (无额外依赖)
 */
import express from 'express'
import cors from 'cors'
import { createClient } from '@supabase/supabase-js'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'

// ====== 初始化 ======
const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
const DUOMI_API_KEY = process.env.DUOMI_API_KEY || ''
const JWT_SECRET = process.env.JWT_SECRET || 'ai-image-tool-secret-key-2024'
const STORAGE_BUCKET = (process.env.SUPABASE_STORAGE_BUCKET || '').trim()

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ 缺少 Supabase 配置')
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ====== 工具函数 ======
function success(data, message = 'ok') { return { code: 200, data, message } }
function error(message, code = 400) { return { code, message } }

function getToken(req) {
  const auth = req.headers.authorization || ''
  return auth.replace('Bearer ', '')
}

async function verifyToken(req, res) {
  const token = getToken(req)
  if (!token) { res.status(401).json(error('未登录')); return null }
  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    return decoded
  } catch {
    res.status(401).json(error('登录已过期', 401))
    return null
  }
}

async function requireAdmin(req, res) {
  const user = await verifyToken(req, res)
  if (!user) return null
  if (user.role !== 'admin') { res.status(403).json(error('无权限', 403)); return null }
  return user
}

// ====== 多米 API 封装 (原生 fetch) ======

/** 构造 multipart form-data (无需 form-data 库) */
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

/** 调用多米 image2 API */
export async function generateImage2(params, apiKey) {
  const BASE_URL = 'https://duomiapi.com'
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

  const resp = await fetch(`${BASE_URL}/v1/images/generations?async=true`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': contentType },
    body,
  })
  const data = await resp.json()
  if (!resp.ok) throw new Error(data.message || `image2 error ${resp.status}`)
  if (!data.task_id) throw new Error('未返回 task_id')
  return data.task_id
}

/** 调用多米 banana API */
export async function generateBanana(params, apiKey) {
  const BASE_URL = 'https://duomiapi.com'
  const url = params.ref_image ? '/api/gemini/nano-banana-edit' : '/api/gemini/nano-banana'

  let body
  let contentType = 'application/json'
  if (params.ref_image) {
    const parts = [
      { name: 'prompt', value: params.prompt },
      { name: 'image', value: params.ref_image, filename: 'ref.png', contentType: 'image/png' },
    ]
    const built = buildMultipart(parts)
    body = built.body
    contentType = built.contentType
  } else {
    body = JSON.stringify({
      prompt: params.prompt,
      model_name: params.model || 'gemini-2.0-flash-exp',
      n: params.n || 1,
    })
  }

  const resp = await fetch(`${BASE_URL}${url}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': contentType },
    body,
  })
  const data = await resp.json()
  if (!resp.ok) throw new Error(data.message || `banana error ${resp.status}`)
  if (!data.task_id) throw new Error('未返回 task_id')
  return data.task_id
}

/** 查询任务状态 (image2 和 banana 共用) */
export async function queryTaskStatus(taskId, apiKey) {
  const resp = await fetch(`https://duomiapi.com/v1/tasks/${taskId}`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  })
  const data = await resp.json()
  if (!resp.ok) throw new Error(data.message || `query error ${resp.status}`)
  const state = data.state
  if (state === 'succeeded') {
    const imageUrl = data.data?.images?.[0]?.url || null
    return { status: 'success', imageUrl }
  }
  if (state === 'failed') {
    return { status: 'failed', error: data.error || '生成失败' }
  }
  return { status: 'pending' }
}

// ====== 积分操作 ======

async function deductPoints(userId, amount, desc) {
  const { data, error } = await supabase.rpc('deduct_points', {
    p_user_id: userId,
    p_amount: amount,
    p_description: desc,
  })
  if (error) throw error
  return data
}

async function refundPoints(userId, amount, desc) {
  const { data, error } = await supabase.rpc('refund_points', {
    p_user_id: userId,
    p_amount: amount,
    p_description: desc,
  })
  if (error) throw error
  return data
}

// ====== 路由: 认证 ======

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body
    if (!username || !password) { res.json(error('请输入用户名和密码')); return }

    // 查管理员表
    const { data: admin } = await supabase.from('admin_users').select('*').eq('username', username).single()
    if (admin && admin.is_active !== false) {
      const valid = await bcrypt.compare(password, admin.password_hash)
      if (valid) {
        // 同步到 users 表
        const { data: existingUser } = await supabase.from('users').select('id').eq('username', username).single()
        let userId = existingUser?.id
        if (!userId) {
          const { data: newUser } = await supabase.from('users').insert({
            username, nickname: admin.nickname || username, role: 'admin', points: 99999,
          }).select('id').single()
          userId = newUser?.id
        }
        const token = jwt.sign({ id: userId, username, role: 'admin' }, JWT_SECRET, { expiresIn: '7d' })
        res.json(success({ token, user: { id: userId, username, role: 'admin', nickname: admin.nickname || username }, points: 99999 }, '登录成功'))
        return
      }
    }

    // 查普通用户表
    const { data: user } = await supabase.from('users').select('*').eq('username', username).single()
    if (!user) { res.json(error('用户不存在')); return }
    if (user.password_hash) {
      const valid = await bcrypt.compare(password, user.password_hash)
      if (!valid) { res.json(error('密码错误')); return }
    }
    const token = jwt.sign({ id: user.id, username, role: user.role || 'user' }, JWT_SECRET, { expiresIn: '7d' })

    const { data: updatedUser } = await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id).select('points').single()
    res.json(success({ token, user: { id: user.id, username, role: user.role || 'user', nickname: user.nickname || username }, points: updatedUser?.points ?? user.points }, '登录成功'))
  } catch (e) {
    console.error('登录错误:', e)
    res.status(500).json(error('服务器内部错误'))
  }
})

app.get('/api/auth/me', async (req, res) => {
  const user = await verifyToken(req, res)
  if (!user) return
  const { data } = await supabase.from('users').select('*').eq('id', user.id).single()
  if (data) res.json(success({ id: data.id, username: data.username, role: data.role || 'user', nickname: data.nickname || data.username, points: data.points }))
  else res.json(error('用户不存在', 404))
})

// ====== 路由: 定价 ======

app.get('/api/pricing', async (_req, res) => {
  try {
    const { data, count } = await supabase.from('pricing_config').select('*', { count: 'exact' }).order('model')
    res.json(success({ list: data || [], total: count || 0 }))
  } catch (e) {
    res.status(500).json(error('获取定价失败'))
  }
})

// ====== 路由: 任务 ======

app.post('/api/tasks/create', async (req, res) => {
  const user = await verifyToken(req, res)
  if (!user) return
  try {
    const { model, prompt, n = 1, size, ref_image_url } = req.body
    if (!prompt || !model) { res.json(error('缺少必要参数')); return }
    if (!['image2', 'banana'].includes(model)) { res.json(error('不支持的模型')); return }

    // 定价
    const { data: pricing } = await supabase.from('pricing_config').select('points_cost').eq('model', model).single()
    const cost = (pricing?.points_cost || 5) * n

    // 扣积分
    await deductPoints(user.id, cost, `生图任务(${model}×${n})`)

    // 调用API
    const params = { prompt, model, n, size: size || '1024x1024', ref_image: ref_image_url || null }
    const genFn = model === 'image2' ? generateImage2 : generateBanana
    const taskId = await genFn(params, DUOMI_API_KEY)

    // 创建任务记录
    const { data: task } = await supabase.from('image_tasks').insert({
      user_id: user.id, model, prompt, n, size: size || '1024x1024',
      status: 'pending', external_task_id: taskId, points_cost: cost,
      ref_image_url: ref_image_url || null,
    }).select().single()

    res.json(success({ task_id: task?.id, external_task_id: taskId }, '任务创建成功'))
  } catch (e) {
    console.error('任务创建失败:', e)
    res.status(500).json(e.message.includes('余额不足') ? error(e.message, 400) : error('创建失败:' + e.message))
  }
})

app.get('/api/tasks/status/:taskId', async (req, res) => {
  const user = await verifyToken(req, res)
  if (!user) return
  try {
    const { taskId } = req.params
    const { data: task } = await supabase.from('image_tasks').select('*').eq('id', taskId).single()
    if (!task) { res.json(error('任务不存在')); return }

    if (task.status === 'succeeded' || task.status === 'failed') {
      res.json(success({ status: task.status, images: task.result_images, error: task.error_msg }))
      return
    }

    const result = await queryTaskStatus(task.external_task_id, DUOMI_API_KEY)
    const updates = { status: result.status }
    if (result.status === 'success') updates.result_images = JSON.stringify([result.imageUrl])
    if (result.status === 'failed') updates.error_msg = result.error || '生成失败'
    updates.updated_at = new Date().toISOString()

    await supabase.from('image_tasks').update(updates).eq('id', taskId)

    if (result.status === 'pending') res.json(success({ status: 'pending' }))
    else if (result.status === 'success') res.json(success({ status: 'succeeded', images: [result.imageUrl] }))
    else res.json(success({ status: 'failed', error: result.error }))
  } catch (e) {
    console.error('查询状态失败:', e)
    res.status(500).json(error('查询状态失败'))
  }
})

// 参考图上传 → Supabase Storage
app.post('/api/tasks/upload-ref', async (req, res) => {
  const user = await verifyToken(req, res)
  if (!user) return
  try {
    const { base64Data, mimeType = 'image/png' } = req.body
    if (!base64Data) { res.json(error('没有图片数据')); return }
    const base64 = base64Data.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64, 'base64')
    const ext = mimeType === 'image/jpeg' ? 'jpg' : 'png'
    const path = `refs/${user.id}/${Date.now()}.${ext}`
    const { data, error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(path, buffer, { contentType: mimeType, upsert: true, cacheControl: '3600' })
    if (uploadError) throw uploadError
    const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path)
    res.json(success({ url: urlData.publicUrl, path }, '上传成功'))
  } catch (e) {
    console.error('上传参考图失败:', e)
    res.status(500).json(error('上传失败: ' + e.message))
  }
})

// ====== 路由: 积分 ======

app.get('/api/points/balance', async (req, res) => {
  const user = await verifyToken(req, res)
  if (!user) return
  try {
    const { data } = await supabase.from('users').select('points').eq('id', user.id).single()
    res.json(success({ balance: data?.points || 0 }))
  } catch (e) {
    res.status(500).json(error('查询积分失败'))
  }
})

app.get('/api/points/records', async (req, res) => {
  const user = await verifyToken(req, res)
  if (!user) return
  try {
    const page = parseInt(req.query.page) || 1
    const size = parseInt(req.query.size) || 10
    const from = (page - 1) * size
    const to = from + size - 1
    const { data, count } = await supabase.from('points_records').select('*', { count: 'exact' }).eq('user_id', user.id).order('created_at', { ascending: false }).range(from, to)
    res.json(success({ list: data || [], total: count || 0, page, size }))
  } catch (e) {
    res.status(500).json(error('查询积分记录失败'))
  }
})

// ====== 路由: 历史 ======

app.get('/api/history/list', async (req, res) => {
  const user = await verifyToken(req, res)
  if (!user) return
  try {
    const page = parseInt(req.query.page) || 1
    const size = parseInt(req.query.size) || 10
    const from = (page - 1) * size
    const to = from + size - 1
    const model = req.query.model
    let q = supabase.from('image_tasks').select('*', { count: 'exact' }).eq('user_id', user.id)
    if (model) q = q.eq('model', model)
    const { data, count } = await q.order('created_at', { ascending: false }).range(from, to)
    const list = (data || []).map(t => ({ ...t, images: t.result_images ? JSON.parse(t.result_images) : [] }))
    res.json(success({ list, total: count || 0, page, size }))
  } catch (e) {
    res.status(500).json(error('获取历史失败'))
  }
})

app.get('/api/history/:taskId', async (req, res) => {
  const user = await verifyToken(req, res)
  if (!user) return
  try {
    const { data: task } = await supabase.from('image_tasks').select('*').eq('id', req.params.taskId).eq('user_id', user.id).single()
    if (!task) { res.json(error('任务不存在')); return }
    res.json(success({ ...task, images: task.result_images ? JSON.parse(task.result_images) : [] }))
  } catch (e) {
    res.status(500).json(error('获取详情失败'))
  }
})

// ====== 路由: 管理后台 ======

app.get('/admin/api/users', async (_req, res) => {
  try {
    const { data, count } = await supabase.from('users').select('*', { count: 'exact' }).order('created_at', { ascending: false })
    res.json(success({ list: data || [], total: count || 0 }))
  } catch (e) { res.status(500).json(error('获取用户列表失败')) }
})

app.put('/admin/api/users/:id/points', async (req, res) => {
  try {
    const { id } = req.params
    const { amount, reason } = req.body
    if (!amount) { res.json(error('请填写调整数量')); return }
    const numAmount = Number(amount)
    if (isNaN(numAmount)) { res.json(error('无效的数字')); return }
    const desc = reason || `管理员调整${numAmount > 0 ? '+' : ''}${numAmount}积分`
    const { data, error } = await supabase.rpc('admin_adjust_points', {
      p_user_id: id, p_amount: numAmount, p_reason: desc,
    })
    if (error) throw error
    res.json(success({ new_balance: data }, '调整成功'))
  } catch (e) { res.status(500).json(error('操作失败')) }
})

app.get('/admin/api/pricing', async (_req, res) => {
  try {
    const { data, count } = await supabase.from('pricing_config').select('*', { count: 'exact' }).order('model')
    res.json(success({ list: data || [], total: count || 0 }))
  } catch (e) { res.status(500).json(error('获取定价失败')) }
})

app.put('/admin/api/pricing/:id', async (req, res) => {
  try {
    const { model, points_cost } = req.body
    const { error } = await supabase.from('pricing_config').update({ model, points_cost }).eq('id', req.params.id)
    if (error) throw error
    res.json(success(null, '更新成功'))
  } catch (e) { res.status(500).json(error('更新定价失败')) }
})

app.get('/admin/api/records', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const size = parseInt(req.query.size) || 20
    const type = req.query.type
    const userId = req.query.user_id
    let q = supabase.from('points_records').select('*, users!inner(username)', { count: 'exact' }).order('created_at', { ascending: false })
    if (type) q = q.eq('type', type)
    if (userId) q = q.eq('user_id', userId)
    const { data, count } = await q.range((page - 1) * size, page * size - 1)
    res.json(success({ list: data || [], total: count || 0, page, size }))
  } catch (e) { res.status(500).json(error('获取记录失败')) }
})

app.get('/admin/api/tasks', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const size = parseInt(req.query.size) || 20
    const status = req.query.status
    let q = supabase.from('image_tasks').select('*, users!inner(username)', { count: 'exact' }).order('created_at', { ascending: false })
    if (status) q = q.eq('status', status)
    const { data, count } = await q.range((page - 1) * size, page * size - 1)
    res.json(success({ list: data || [], total: count || 0, page, size }))
  } catch (e) { res.status(500).json(error('获取任务列表失败')) }
})

app.get('/admin/api/settings', async (_req, res) => {
  try {
    const { data } = await supabase.from('system_config').select('*')
    res.json(success({ settings: data || [] }))
  } catch (e) { res.status(500).json(error('获取设置失败')) }
})

app.put('/admin/api/settings/:key', async (req, res) => {
  try {
    const { value } = req.body
    const { error } = await supabase.from('system_config').update({ value, updated_at: new Date().toISOString() }).eq('config_key', req.params.key)
    if (error) throw error
    res.json(success(null, '更新成功'))
  } catch (e) { res.status(500).json(error('更新设置失败')) }
})

// ====== 默认路由 ======
app.all('*', (req, res) => {
  res.status(404).json({ code: 404, message: `接口不存在: ${req.method} ${req.path}` })
})

export default app
