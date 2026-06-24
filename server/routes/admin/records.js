import express from 'express'
import { authRequired, adminRequired } from '../../middleware/auth.js'
import { success, error } from '../../utils/response.js'
import { supabase } from '../../db/index.js'

const router = express.Router()

const TYPE_LABELS = {
  admin_add: '管理员发放',
  generate_deduct: '生图扣除',
  fail_refund: '失败返还'
}

/**
 * GET /api/admin/records/points
 * 全局积分流水（分页 + 筛选）
 */
router.get('/points', authRequired, adminRequired, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const pageSize = 20
    const offset = (page - 1) * pageSize
    const { username, type, startDate, endDate } = req.query

    // 先查出匹配的 user_id
    let userIds = null
    if (username) {
      const { data: matchedUsers } = await supabase
        .from('users')
        .select('id, username')
        .ilike('username', `%${username}%`)
      userIds = (matchedUsers || []).map(u => u.id)
      if (userIds.length === 0) {
        return res.json(success({ records: [], total: 0, page, pageSize, totalPages: 0 }))
      }
    }

    let query = supabase
      .from('points_records')
      .select(`
        id,
        user_id,
        amount,
        balance_after,
        type,
        related_task_id,
        remark,
        created_at,
        users!inner(username)
      `, { count: 'exact' })

    if (userIds) {
      query = query.in('user_id', userIds)
    }
    if (type) {
      query = query.eq('type', type)
    }
    if (startDate) {
      query = query.gte('created_at', startDate)
    }
    if (endDate) {
      query = query.lte('created_at', endDate)
    }

    const { data: rows, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1)

    const total = count || 0
    const records = (rows || []).map(r => ({
      id: r.id,
      userId: r.user_id,
      username: r.users?.username || '',
      amount: parseFloat(r.amount),
      balanceAfter: parseFloat(r.balance_after),
      type: r.type,
      typeLabel: TYPE_LABELS[r.type] || r.type,
      relatedTaskId: r.related_task_id,
      remark: r.remark,
      createdAt: r.created_at
    }))

    res.json(success({ records, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }))
  } catch (err) {
    res.status(500).json(error(err.message))
  }
})

/**
 * GET /api/admin/records/images
 * 全局生图记录（分页 + 筛选）
 */
router.get('/images', authRequired, adminRequired, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const pageSize = 20
    const offset = (page - 1) * pageSize
    const { username, modelName, status, startDate, endDate } = req.query

    // 先查出匹配的 user_id
    let userIds = null
    if (username) {
      const { data: matchedUsers } = await supabase
        .from('users')
        .select('id, username')
        .ilike('username', `%${username}%`)
      userIds = (matchedUsers || []).map(u => u.id)
      if (userIds.length === 0) {
        return res.json(success({ records: [], total: 0, page, pageSize, totalPages: 0 }))
      }
    }

    let query = supabase
      .from('image_tasks')
      .select(`
        id,
        user_id,
        model_name,
        mode,
        aspect_ratio,
        quality,
        image_count,
        points_cost,
        status,
        result_images,
        fail_reason,
        created_at,
        finished_at,
        users!inner(username)
      `, { count: 'exact' })

    if (userIds) {
      query = query.in('user_id', userIds)
    }
    if (modelName) {
      query = query.eq('model_name', modelName)
    }
    if (status) {
      query = query.eq('status', status)
    }
    if (startDate) {
      query = query.gte('created_at', startDate)
    }
    if (endDate) {
      query = query.lte('created_at', endDate)
    }

    const { data: rows, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1)

    const total = count || 0
    const records = (rows || []).map(r => {
      let firstImage = null
      if (r.result_images) {
        const images = JSON.parse(r.result_images)
        firstImage = images[0] || null
      }
      return {
        id: r.id,
        userId: r.user_id,
        username: r.users?.username || '',
        modelName: r.model_name,
        mode: r.mode,
        aspectRatio: r.aspect_ratio,
        quality: r.quality,
        imageCount: r.image_count,
        pointsCost: parseFloat(r.points_cost),
        status: r.status,
        firstImage,
        failReason: r.fail_reason,
        createdAt: r.created_at,
        finishedAt: r.finished_at
      }
    })

    res.json(success({ records, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }))
  } catch (err) {
    res.status(500).json(error(err.message))
  }
})

/**
 * GET /api/admin/records/images/:id
 */
router.get('/images/:id', authRequired, adminRequired, async (req, res) => {
  try {
    const taskId = parseInt(req.params.id)
    const { data: task } = await supabase
      .from('image_tasks')
      .select(`
        *,
        users!inner(username)
      `)
      .eq('id', taskId)
      .single()

    if (!task) return res.status(404).json(error('任务不存在'))

    let resultImages = []
    if (task.result_images) {
      resultImages = JSON.parse(task.result_images)
    }

    res.json(success({
      ...task,
      username: task.users?.username || '',
      pointsCost: parseFloat(task.points_cost),
      resultImages,
      createdAt: task.created_at,
      finishedAt: task.finished_at
    }))
  } catch (err) {
    res.status(500).json(error(err.message))
  }
})

export default router
