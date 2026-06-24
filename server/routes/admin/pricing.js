import express from 'express'
import { authRequired, adminRequired } from '../../middleware/auth.js'
import { success, error } from '../../utils/response.js'
import { supabase } from '../../db/index.js'

const router = express.Router()

/**
 * GET /api/admin/pricing
 */
router.get('/', authRequired, adminRequired, async (req, res) => {
  try {
    const { data: configs } = await supabase
      .from('points_config')
      .select('id, model_name, quality, points_per_image')
      .order('model_name')
      .order('quality')

    const pricing = (configs || []).map(c => ({
      ...c,
      pointsPerImage: parseFloat(c.points_per_image)
    }))
    res.json(success({ pricing }))
  } catch (err) {
    res.status(500).json(error(err.message))
  }
})

/**
 * PUT /api/admin/pricing
 */
router.put('/', authRequired, adminRequired, async (req, res) => {
  try {
    const { pricing } = req.body
    if (!Array.isArray(pricing) || pricing.length === 0) {
      return res.status(400).json(error('定价数据不能为空'))
    }

    for (const item of pricing) {
      if (!item.id) continue
      const points = parseFloat(item.pointsPerImage)
      if (isNaN(points) || points < 0) {
        return res.status(400).json(error(`定价配置 ID ${item.id} 的积分值无效`))
      }
      const { error: updateError } = await supabase
        .from('points_config')
        .update({ points_per_image: points })
        .eq('id', item.id)
      if (updateError) throw new Error(updateError.message)
    }

    res.json(success(null, '定价配置已更新'))
  } catch (err) {
    res.status(500).json(error(err.message))
  }
})

export default router
