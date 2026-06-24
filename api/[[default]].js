/**
 * AI生图工具 - IGA Pages Serverless Function
 * 基于 Express（IGA Pages 官方支持）
 * 依赖: express, cors, @supabase/supabase-js, jsonwebtoken, bcryptjs
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

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ====== 工具函数 ======
const ok = (data, message = 'ok') => ({ code: 200, data, message })
const err = (message, code = 400) => ({ code, message })

function getToken(req) {
  const auth = req.headers.authorization || ''
  return auth.replace('Bearer ', '')
}

function verifyToken(req, res) {
  const token = getToken(req)
  if (!token) { res.status(401).json(err('未登录', 401)); return null }
  try {
    return jwt.verify(token, JWT_SECRET)
  } catch {
    res.status(401).json(err('登录已过期', 401))
    return null
  }
}

// ====== 多米 API（原生 fetch）=====

function buildMultipart(parts) {
  const boundary = '----FormBoundary' + Math.random().toString(36).substring(2)
  let body = ''
  for (const p of parts) {
    body += `--${boundary}\r\n`
    if (p.filename) {
      body += `Content-Disposition: form-data; name="${p.name}"; filename="${p.filename}"\r\n`
      body += `Content-Type: ${p.contentType || 'application/octet-stream'}\r\n\r\n`
    } else {
      body += `Content-Disposition: form-data; name="${p.name}"\r\n\r\n`
    }
    body += `${p.value}\r\n`
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
  const resp = await fetch('https://duomiapi.com/v1/images/generations?async=true', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${DUOMI_API_KEY}`, 'Content-Type': contentType },
    body,
  })
  const data = await resp.json()
  if (!resp.ok) throw new Error(data.message || `image2 error ${resp.status}`)
  if (!data.task_id) throw new Error('未返回 task_id')
  return data.task_id
}

async function generateBanana(params) {
  const path = params.ref_image ? '/api/gemini/nano-banana-edit' : '/api/gemini/nano-banana'
  let body, contentType = 'application/json'
  if (params.ref_image) {
    const built = buildMultipart([
      { name: 'prompt', value: params.prompt },
      { name: 'image', value: params.ref_image, filename: 'ref.png', contentType: 'image/png' },
    ])
    body = built.body
    contentType = built.contentType
  } else {
    body = JSON.stringify({ prompt: params.prompt, model_name: params.model || 'gemini-2.0-flash-exp', n: params.n || 1 })
  }
  const resp = await fetch(`https://duomiapi.com${path}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${DUOMI_API_KEY}`, 'Content-Type': contentType },
    body,
  })
  const data = await resp.json()
  if (!resp.ok) throw new Error(data.message || `banana error ${resp.status}`)
  if (!data.task_id) throw new Error('未返回 task_id')
  return data.task_id
}

async function queryTaskStatus(taskId) {
  const resp = await fetch(`https://duomiapi.com/v1/tasks/${taskId}`, {
    headers: { 'Authorization': `Bearer ${DUOMI_API_KEY}` },
  })
  const data = await resp.json()
  if (!resp.ok) throw new Error(data.message || `query error ${resp.status}`)
  if (data.state === 'succeeded') {
    return { status: 'success', imageUrl: data.data?.images?.[0]?.url || null }
  }
  if (data.state === 'failed') {
    return { status: 'failed', error: data.error || '生成失败' }
  }
  return { status: 'pending' }
}

// ====== 积分操作 ======
async function deductPoints(userId, amount, desc) {
  const { data, error } = await supabase.rpc('deduct_points', {
    p_user_id: userId, p_amount: amount, p_description: desc,
  })
  if (error) throw error
  return data
}

// ====== 路由: 认证 ======

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body
    if (!username || !password) return res.json(err('请输入用户名和密码'))

    // 查管理员表
    const { data: admin } = await supabase.from('admin_users').select('*').eq('username', username).single()
    if (admin && admin.is_active !== false) {
      const valid = await bcrypt.compare(password, admin.password_hash)
      if (valid) {
        const { data: existingUser } = await supabase.from('users').select('id').eq('username', username).single()
        let userId = existingUser?.id
        if (!userId) {
          const { data: newUser } = await supabase.from('users').insert({
            username, nickname: admin.nickname || username, role: 'admin', points: 99999,
          }).select('id').single()
          userId = newUser?.id
        }
        const token = jwt.sign({ id: userId, username, role: 'admin' }, JWT_SECRET, { expiresIn: '7d' })
        return res.json(ok({
          token,
          user: { id: userId, username, role: 'admin', nickname: admin.nickname || username },
          points: 99999,
        }, '登录成功'))
      }
    }

    // 查普通用户
    const { data: user } = await supabase.from('users').select('*').eq('username', username).single()
    if (!user) return res.json(err('用户不存在'))
    if (user.password_hash) {
      const valid = await bcrypt.compare(password, user.password_hash)
      if (!valid) return res.json(err('密码错误'))
    }
    const token = jwt.sign({ id: user.id, username, role: user.role || 'user' }, JWT_SECRET, { expiresIn: '7d' })
    await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id)
    return res.json(ok({
      token,
      user: { id: user.id, username, role: user.role || 'user', nickname: user.nickname || username },
      points: user.points,
    }, '登录成功'))
  } catch (e) {
    console.error('Login error:', e)
    return res.status(500).json(err('服务器内部错误', 500))
  }
})

app.get('/api/auth/info', async (req, res) => {
  const user = verifyToken(req, res)
  if (!user) return
  const { data } = await supabase.from('users').select('*').eq('id', user.id).single()
  if (!data) return res.json(err('用户不存在', 404))
  return res.json(ok({
    id: data.id, username: data.username, role: data.role || 'user',
    nickname: data.nickname || data.username, points: data.points,
  }))
})

// ====== 路由: 任务 ======

app.get('/api/tasks/pricing', async (_req, res) => {
  try {
    const { data, count } = await supabase.from('pricing_config').select('*', { count: 'exact' }).order('model')
    return res.json(ok({ list: data || [], total: count || 0 }))
  } catch (e) {
    return res.status(500).json(err('获取定价失败', 500))
  }
})

app.post('/api/tasks/create', async (req, res) => {
  const user = verifyToken(req, res)
  if (!user) return
  try {
    const { model, prompt, n = 1, size, ref_image_url } = req.body
    if (!prompt || !model) return res.json(err('缺少必要参数'))
    if (!['image2', 'banana'].includes(model)) return res.json(err('不支持的模型'))

    const { data: pricing } = await supabase.from('pricing_config').select('points_cost').eq('model', model).single()
    const cost = (pricing?.points_cost || 5) * n

    await deductPoints(user.id, cost, `生图任务(${model}×${n})`)

    const params = { prompt, model, n, size: size || '1024x1024', ref_image: ref_image_url || null }
    const genFn = model === 'image2' ? generateImage2 : generateBanana
    const taskId = await genFn(params)

    const { data: task } = await supabase.from('image_tasks').insert({
      user_id: user.id, model, prompt, n, size: size || '1024x1024',
      status: 'pending', external_task_id: taskId, points_cost: cost,
      ref_image_url: ref_image_url || null,
    }).select().single()

    return res.json(ok({ task_id: task?.id, external_task_id: taskId }, '任务创建成功'))
  } catch (e) {
    console.error('Create task error:', e)
    const msg = String(e.message || e)
    return res.status(500).json(err(msg.includes('余额不足') ? msg : '创建失败:' + msg, 500))
  }
})

app.get('/api/tasks/:taskId/status', async (req, res) => {
  const user = verifyToken(req, res)
  if (!user) return
  try {
    const { data: task } = await supabase.from('image_tasks').select('*').eq('id', req.params.taskId).single()
    if (!task) return res.json(err('任务不存在'))

    if (task.status === 'succeeded' || task.status === 'failed') {
      const images = task.result_images ? JSON.parse(task.result_images) : []
      return res.json(ok({ status: task.status, images, error: task.error_msg }))
    }

    const result = await queryTaskStatus(task.external_task_id)
    const updates = { status: result.status, updated_at: new Date().toISOString() }
    if (result.status === 'success') updates.result_images = JSON.stringify([result.imageUrl])
    if (result.status === 'failed') updates.error_msg = result.error || '生成失败'
    await supabase.from('image_tasks').update(updates).eq('id', task.id)

    if (result.status === 'pending') return res.json(ok({ status: 'pending' }))
    if (result.status === 'success') return res.json(ok({ status: 'succeeded', images: [result.imageUrl] }))
    return res.json(ok({ status: 'failed', error: result.error }))
  } catch (e) {
    console.error('Query status error:', e)
    return res.status(500).json(err('查询状态失败', 500))
  }
})

app.post('/api/tasks/upload-ref', async (req, res) => {
  const user = verifyToken(req, res)
  if (!user) return
  try {
    const { base64Data, mimeType = 'image/png' } = req.body
    if (!base64Data) return res.json(err('没有图片数据'))
    const base64 = base64Data.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64, 'base64')
    const ext = mimeType === 'image/jpeg' ? 'jpg' : 'png'
    const path = `refs/${user.id}/${Date.now()}.${ext}`
    const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(path, buffer, {
      contentType: mimeType, upsert: true,
    })
    if (uploadError) throw uploadError
    const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path)
    return res.json(ok({ url: urlData.publicUrl, path }, '上传成功'))
  } catch (e) {
    console.error('Upload error:', e)
    return res.status(500).json(err('上传失败: ' + e.message, 500))
  }
})

// ====== 路由: 积分 ======

app.get('/api/points/balance', async (req, res) => {
  const user = verifyToken(req, res)
  if (!user) return
  const { data } = await supabase.from('users').select('points').eq('id', user.id).single()
  return res.json(ok({ balance: data?.points || 0 }))
})

app.get('/api/points/records', async (req, res) => {
  const user = verifyToken(req, res)
  if (!user) return
  const page = parseInt(req.query.page) || 1
  const size = parseInt(req.query.size) || 10
  const from = (page - 1) * size
  const to = from + size - 1
  const { data, count } = await supabase.from('points_records')
    .select('*', { count: 'exact' })
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .range(from, to)
  return res.json(ok({ list: data || [], total: count || 0, page, size }))
})

// ====== 路由: 历史 ======

app.get('/api/history', async (req, res) => {
  const user = verifyToken(req, res)
  if (!user) return
  const page = parseInt(req.query.page) || 1
  const size = parseInt(req.query.size) || 10
  const from = (page - 1) * size
  const to = from + size - 1
  let q = supabase.from('image_tasks').select('*', { count: 'exact' }).eq('user_id', user.id)
  if (req.query.model) q = q.eq('model', req.query.model)
  const { data, count } = await q.order('created_at', { ascending: false }).range(from, to)
  const list = (data || []).map(t => ({ ...t, images: t.result_images ? JSON.parse(t.result_images) : [] }))
  return res.json(ok({ list, total: count || 0, page, size }))
})

app.get('/api/history/:id', async (req, res) => {
  const user = verifyToken(req, res)
  if (!user) return
  const { data: task } = await supabase.from('image_tasks')
    .select('*').eq('id', req.params.id).eq('user_id', user.id).single()
  if (!task) return res.json(err('任务不存在'))
  return res.json(ok({ ...task, images: task.result_images ? JSON.parse(task.result_images) : [] }))
})

// ====== 路由: 管理后台 ======

app.get('/api/admin/users', async (_req, res) => {
  const { data, count } = await supabase.from('users').select('*', { count: 'exact' }).order('created_at', { ascending: false })
  return res.json(ok({ list: data || [], total: count || 0 }))
})

app.post('/api/admin/users', async (req, res) => {
  try {
    const { username, password, nickname, points = 100 } = req.body
    if (!username || !password) return res.json(err('用户名和密码必填'))
    const hash = await bcrypt.hash(password, 10)
    const { data, error: insertError } = await supabase.from('users').insert({
      username, password_hash: hash, nickname: nickname || username, points, role: 'user',
    }).select().single()
    if (insertError) return res.json(err(insertError.message || '创建失败'))
    return res.json(ok(data, '创建成功'))
  } catch (e) {
    return res.status(500).json(err('创建失败: ' + e.message, 500))
  }
})

app.put('/api/admin/users/:id/points', async (req, res) => {
  try {
    const { amount, remark } = req.body
    const numAmount = Number(amount)
    if (!amount || isNaN(numAmount)) return res.json(err('请填写有效的调整数量'))
    const desc = remark || `管理员调整${numAmount > 0 ? '+' : ''}${numAmount}积分`
    const { data, error: rpcError } = await supabase.rpc('admin_adjust_points', {
      p_user_id: req.params.id, p_amount: numAmount, p_reason: desc,
    })
    if (rpcError) return res.json(err(rpcError.message, 500))
    return res.json(ok({ new_balance: data }, '调整成功'))
  } catch (e) {
    return res.status(500).json(err('操作失败: ' + e.message, 500))
  }
})

app.put('/api/admin/users/:id/password', async (req, res) => {
  try {
    const { newPassword } = req.body
    if (!newPassword) return res.json(err('请输入新密码'))
    const hash = await bcrypt.hash(newPassword, 10)
    const { error: updateError } = await supabase.from('users').update({ password_hash: hash }).eq('id', req.params.id)
    if (updateError) return res.json(err(updateError.message, 500))
    return res.json(ok(null, '密码已重置'))
  } catch (e) {
    return res.status(500).json(err('重置失败: ' + e.message, 500))
  }
})

app.put('/api/admin/users/:id/status', async (req, res) => {
  try {
    const { status } = req.body
    const { error: updateError } = await supabase.from('users').update({ is_active: status === 'active' }).eq('id', req.params.id)
    if (updateError) return res.json(err(updateError.message, 500))
    return res.json(ok(null, '状态已更新'))
  } catch (e) {
    return res.status(500).json(err('操作失败: ' + e.message, 500))
  }
})

app.get('/api/admin/pricing', async (_req, res) => {
  const { data, count } = await supabase.from('pricing_config').select('*', { count: 'exact' }).order('model')
  return res.json(ok({ list: data || [], total: count || 0 }))
})

app.put('/api/admin/pricing', async (req, res) => {
  try {
    const { pricing } = req.body
    if (!Array.isArray(pricing)) return res.json(err('数据格式错误'))
    for (const item of pricing) {
      const { error: updateError } = await supabase.from('pricing_config')
        .update({ points_cost: item.points_cost }).eq('id', item.id)
      if (updateError) console.error('Update pricing error:', updateError)
    }
    return res.json(ok(null, '更新成功'))
  } catch (e) {
    return res.status(500).json(err('更新失败: ' + e.message, 500))
  }
})

app.get('/api/admin/records/points', async (req, res) => {
  const page = parseInt(req.query.page) || 1
  const size = parseInt(req.query.size) || 20
  const from = (page - 1) * size
  const to = from + size - 1
  const { data, count } = await supabase.from('points_records')
    .select('*, users!inner(username)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)
  return res.json(ok({ list: data || [], total: count || 0, page, size }))
})

app.get('/api/admin/records/images', async (req, res) => {
  const page = parseInt(req.query.page) || 1
  const size = parseInt(req.query.size) || 20
  const from = (page - 1) * size
  const to = from + size - 1
  let q = supabase.from('image_tasks')
    .select('*, users!inner(username)', { count: 'exact' })
    .order('created_at', { ascending: false })
  if (req.query.status) q = q.eq('status', req.query.status)
  const { data, count } = await q.range(from, to)
  return res.json(ok({ list: data || [], total: count || 0, page, size }))
})

app.get('/api/admin/records/images/:id', async (req, res) => {
  const { data } = await supabase.from('image_tasks').select('*').eq('id', req.params.id).single()
  if (!data) return res.json(err('记录不存在'))
  return res.json(ok({ ...data, images: data.result_images ? JSON.parse(data.result_images) : [] }))
})

app.get('/api/admin/settings', async (_req, res) => {
  const { data } = await supabase.from('system_config').select('*')
  const settings = {}
  for (const item of (data || [])) {
    settings[item.config_key] = item.config_value
  }
  return res.json(ok({ settings }))
})

app.put('/api/admin/settings/api', async (req, res) => {
  try {
    const { duomi_api_key, duomi_base_url } = req.body
    if (duomi_api_key) {
      await supabase.from('system_config').update({ config_value: duomi_api_key, updated_at: new Date().toISOString() }).eq('config_key', 'duomi_api_key')
    }
    if (duomi_base_url) {
      await supabase.from('system_config').update({ config_value: duomi_base_url, updated_at: new Date().toISOString() }).eq('config_key', 'duomi_base_url')
    }
    return res.json(ok(null, '更新成功'))
  } catch (e) {
    return res.status(500).json(err('更新失败: ' + e.message, 500))
  }
})

app.put('/api/admin/settings/password', async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body
    if (!oldPassword || !newPassword) return res.json(err('请填写旧密码和新密码'))
    const { data: admin } = await supabase.from('admin_users').select('password_hash').eq('username', 'admin').single()
    if (!admin) return res.json(err('管理员不存在'))
    const valid = await bcrypt.compare(oldPassword, admin.password_hash)
    if (!valid) return res.json(err('旧密码错误'))
    const hash = await bcrypt.hash(newPassword, 10)
    const { error: updateError } = await supabase.from('admin_users').update({ password_hash: hash }).eq('username', 'admin')
    if (updateError) return res.json(err(updateError.message, 500))
    return res.json(ok(null, '密码已修改'))
  } catch (e) {
    return res.status(500).json(err('修改失败: ' + e.message, 500))
  }
})

// ====== 默认路由 ======
app.all('*', (req, res) => {
  res.status(404).json({ code: 404, message: `接口不存在: ${req.method} ${req.path}` })
})

export default app
