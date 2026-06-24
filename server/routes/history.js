import express from 'express'
import { authRequired } from '../middleware/auth.js'
import { success, error } from '../utils/response.js'
import { supabase } from '../db/index.js'

const router = express.Router()
const PAGE_SIZE = 12

/**
 * GET /api/history
 */
router.get('/', authRequired, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const offset = (page - 1) * PAGE_SIZE

    const { data: rows, count } = await supabase
      .from('image_tasks')
      .select('id, model_name, mode, prompt, aspect_ratio, quality, image_count, points_cost, status, result_images, created_at', { count: 'exact' })
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)

    const total = count || 0

    const records = (rows || []).map(r => {
      let firstImage = null
      if (r.result_images) {
        const images = JSON.parse(r.result_images)
        firstImage = images[0] || null
      }
      return {
        id: r.id,
        modelName: r.model_name,
        mode: r.mode,
        prompt: r.prompt,
        aspectRatio: r.aspect_ratio,
        quality: r.quality,
        imageCount: r.image_count,
        pointsCost: parseFloat(r.points_cost),
        status: r.status,
        firstImage,
        createdAt: r.created_at
      }
    })

    res.json(success({ records, total, page, pageSize: PAGE_SIZE, totalPages: Math.ceil(total / PAGE_SIZE) }))
  } catch (err) {
    res.status(500).json(error(err.message))
  }
})

/**
 * GET /api/history/:id
 */
router.get('/:id', authRequired, async (req, res) => {
  try {
    const taskId = parseInt(req.params.id)
    const { data: task } = await supabase
      .from('image_tasks')
      .select('*')
      .eq('id', taskId)
      .eq('user_id', req.user.id)
      .single()

    if (!task) return res.status(404).json(error('任务不存在'))

    let resultImages = []
    if (task.result_images) {
      resultImages = JSON.parse(task.result_images)
    }

    res.json(success({
      id: task.id,
      modelName: task.model_name,
      mode: task.mode,
      prompt: task.prompt,
      aspectRatio: task.aspect_ratio,
      quality: task.quality,
      imageCount: task.image_count,
      referenceImage: task.reference_image,
      pointsCost: parseFloat(task.points_cost),
      status: task.status,
      resultImages,
      failReason: task.fail_reason,
      createdAt: task.created_at,
      finishedAt: task.finished_at
    }))
  } catch (err) {
    res.status(500).json(error(err.message))
  }
})

export default router
