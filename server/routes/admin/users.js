import express from 'express'
import bcrypt from 'bcryptjs'
import { authRequired, adminRequired } from '../../middleware/auth.js'
import { success, error } from '../../utils/response.js'
import { supabase } from '../../db/index.js'
import { adminAdjustPoints } from '../../services/imageService.js'

const router = express.Router()

/**
 * GET /api/admin/users
 */
router.get('/', authRequired, adminRequired, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const keyword = req.query.keyword || ''
    const pageSize = 20
    const offset = (page - 1) * pageSize

    let query = supabase
      .from('users')
      .select('id, username, points_balance, status, created_at, last_login_at', { count: 'exact' })
      .order('created_at', { ascending: false })

    if (keyword) {
      query = query.ilike('username', `%${keyword}%`)
    }

    const { data: rows, count } = await query.range(offset, offset + pageSize - 1)

    const total = count || 0
    const users = (rows || []).map(r => ({
      ...r,
      pointsBalance: parseFloat(r.points_balance),
      createdAt: r.created_at,
      lastLoginAt: r.last_login_at
    }))

    res.json(success({ users, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }))
  } catch (err) {
    res.status(500).json(error(err.message))
  }
})

/**
 * POST /api/admin/users
 */
router.post('/', authRequired, adminRequired, async (req, res) => {
  try {
    const { username, password, initialPoints } = req.body
    if (!username?.trim()) return res.status(400).json(error('用户名不能为空'))
    if (!password?.trim()) return res.status(400).json(error('密码不能为空'))
    if (username.length < 2) return res.status(400).json(error('用户名至少2个字符'))
    if (password.length < 6) return res.status(400).json(error('密码至少6个字符'))

    const points = parseFloat(initialPoints) || 0

    // 检查用户名唯一性
    const { data: exists } = await supabase
      .from('users')
      .select('id')
      .eq('username', username)
      .single()
    if (exists) return res.status(400).json(error('用户名已存在'))

    const hash = await bcrypt.hash(password, 10)

    const { data: result, error: insertError } = await supabase
      .from('users')
      .insert({
        username,
        password_hash: hash,
        points_balance: points,
        status: 1
      })
      .select('id, username, points_balance, status, created_at')
      .single()

    if (insertError) throw new Error(insertError.message)

    // 如果有初始积分，记录流水
    if (points > 0) {
      await supabase
        .from('points_records')
        .insert({
          user_id: result.id,
          amount: points,
          balance_after: points,
          type: 'admin_add',
          remark: '初始积分发放'
        })
    }

    res.json(success({ ...result, pointsBalance: parseFloat(result.points_balance) }, '用户创建成功'))
  } catch (err) {
    res.status(500).json(error(err.message))
  }
})

/**
 * PUT /api/admin/users/:id/points
 */
router.put('/:id/points', authRequired, adminRequired, async (req, res) => {
  try {
    const userId = parseInt(req.params.id)
    const { amount, remark } = req.body

    if (amount === undefined || amount === null) return res.status(400).json(error('调整积分数额不能为空'))
    const adjustAmount = parseFloat(amount)
    if (isNaN(adjustAmount) || adjustAmount === 0) return res.status(400).json(error('调整积分数额无效'))

    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .single()
    if (!user) return res.status(404).json(error('用户不存在'))

    const newBalance = await adminAdjustPoints(userId, adjustAmount, remark)

    res.json(success({ userId, newBalance }, '积分调整成功'))
  } catch (err) {
    res.status(500).json(error(err.message))
  }
})

/**
 * PUT /api/admin/users/:id/password
 */
router.put('/:id/password', authRequired, adminRequired, async (req, res) => {
  try {
    const userId = parseInt(req.params.id)
    const { newPassword } = req.body
    if (!newPassword?.trim()) return res.status(400).json(error('新密码不能为空'))
    if (newPassword.length < 6) return res.status(400).json(error('密码至少6个字符'))

    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .single()
    if (!user) return res.status(404).json(error('用户不存在'))

    const hash = await bcrypt.hash(newPassword, 10)
    await supabase
      .from('users')
      .update({ password_hash: hash })
      .eq('id', userId)

    res.json(success(null, '密码重置成功'))
  } catch (err) {
    res.status(500).json(error(err.message))
  }
})

/**
 * PUT /api/admin/users/:id/status
 */
router.put('/:id/status', authRequired, adminRequired, async (req, res) => {
  try {
    const userId = parseInt(req.params.id)
    const { status } = req.body
    if (![0, 1].includes(status)) return res.status(400).json(error('状态值无效'))

    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .single()
    if (!user) return res.status(404).json(error('用户不存在'))

    await supabase
      .from('users')
      .update({ status })
      .eq('id', userId)

    res.json(success(null, status === 1 ? '用户已启用' : '用户已禁用'))
  } catch (err) {
    res.status(500).json(error(err.message))
  }
})

export default router
