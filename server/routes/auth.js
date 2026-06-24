import express from 'express'
import bcrypt from 'bcryptjs'
import { supabase } from '../db/index.js'
import { signToken, verifyToken } from '../middleware/auth.js'
import { success, error, unauthorized } from '../utils/response.js'

const router = express.Router()

/**
 * POST /api/auth/login
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body
    if (!username || !password) {
      return res.status(400).json(error('用户名和密码不能为空'))
    }

    // 先查管理员表
    const { data: admin } = await supabase
      .from('admin_users')
      .select('*')
      .eq('username', username)
      .single()

    if (admin) {
      const valid = await bcrypt.compare(password, admin.password_hash)
      if (!valid) return res.status(400).json(error('密码错误'))
      const token = signToken({ id: admin.id, username: admin.username, role: 'admin' })
      return res.json(success({ token, role: 'admin', username: admin.username }, '登录成功'))
    }

    // 再查普通用户表
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('username', username)
      .single()

    if (!user) return res.status(400).json(error('账号不存在'))
    if (user.status === 0) return res.status(400).json(error('账号已被禁用，请联系管理员'))

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) return res.status(400).json(error('密码错误'))

    // 更新最后登录时间
    await supabase
      .from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', user.id)

    const token = signToken({ id: user.id, username: user.username, role: 'user' })
    res.json(success({
      token,
      role: 'user',
      username: user.username,
      pointsBalance: parseFloat(user.points_balance)
    }, '登录成功'))
  } catch (err) {
    res.status(500).json(error(err.message))
  }
})

/**
 * GET /api/auth/info
 */
router.get('/info', async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json(unauthorized())
    }

    const payload = verifyToken(authHeader.slice(7))
    if (!payload) return res.status(401).json(unauthorized())

    if (payload.role === 'admin') {
      const { data: admin } = await supabase
        .from('admin_users')
        .select('id, username, created_at')
        .eq('id', payload.id)
        .single()
      return res.json(success({ ...admin, role: 'admin' }))
    }

    const { data: user } = await supabase
      .from('users')
      .select('id, username, points_balance, status, created_at, last_login_at')
      .eq('id', payload.id)
      .single()

    if (!user) return res.status(401).json(unauthorized())
    if (user.status === 0) return res.status(403).json(error('账号已被禁用'))

    res.json(success({ ...user, role: 'user', pointsBalance: parseFloat(user.points_balance) }))
  } catch (err) {
    res.status(500).json(error(err.message))
  }
})

export default router
