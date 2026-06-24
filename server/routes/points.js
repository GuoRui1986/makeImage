import express from 'express'
import { authRequired } from '../middleware/auth.js'
import { success, error } from '../utils/response.js'
import { supabase } from '../db/index.js'

const router = express.Router()
const PAGE_SIZE = 20

/**
 * GET /api/points/records
 */
router.get('/records', authRequired, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const offset = (page - 1) * PAGE_SIZE

    const { data: rows, count } = await supabase
      .from('points_records')
      .select('id, amount, balance_after, type, related_task_id, remark, created_at', { count: 'exact' })
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)

    const typeLabels = {
      admin_add: '管理员发放',
      generate_deduct: '生图扣除',
      fail_refund: '失败返还'
    }

    const records = (rows || []).map(r => ({
      ...r,
      amount: parseFloat(r.amount),
      balanceAfter: parseFloat(r.balance_after),
      typeLabel: typeLabels[r.type] || r.type,
      createdAt: r.created_at
    }))

    const total = count || 0
    res.json(success({ records, total, page, pageSize: PAGE_SIZE, totalPages: Math.ceil(total / PAGE_SIZE) }))
  } catch (err) {
    res.status(500).json(error(err.message))
  }
})

/**
 * GET /api/points/balance
 */
router.get('/balance', authRequired, async (req, res) => {
  try {
    let { data: user } = await supabase
      .from('users')
      .select('points_balance')
      .eq('id', req.user.id)
      .single()

    // 管理员可能 id 不一致，fallback 用 username 查
    if (!user && req.user.role === 'admin') {
      const { data: fallback } = await supabase
        .from('users')
        .select('points_balance')
        .eq('username', req.user.username)
        .single()
      user = fallback
    }

    if (!user) return res.status(404).json(error('用户不存在'))
    res.json(success({ balance: parseFloat(user.points_balance) }))
  } catch (err) {
    res.status(500).json(error(err.message))
  }
})

export default router
