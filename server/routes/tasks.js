import express from 'express'
import { authRequired } from '../middleware/auth.js'
import { success, error } from '../utils/response.js'
import { supabase } from '../db/index.js'
import {
  calculateTotalCost,
  createSingleImageTask,
  querySingleTaskStatus,
  deductPoints,
  refundPoints,
  getApiKey
} from '../services/imageService.js'

const router = express.Router()

/**
 * POST /api/tasks/create
 */
router.post('/create', authRequired, async (req, res) => {
  try {
    const { modelName, mode, prompt, aspectRatio, quality, imageCount, referenceImageUrl } = req.body

    // 参数校验
    if (!['image2', 'banana', 'seedream'].includes(modelName)) {
      return res.status(400).json(error('模型选择无效'))
    }
    if (modelName === 'seedream') {
      return res.status(400).json(error('seedream 模型开发中，暂不可用'))
    }
    if (!['txt2img', 'img2img'].includes(mode)) {
      return res.status(400).json(error('生成模式无效'))
    }
    if (!prompt?.trim()) {
      return res.status(400).json(error('提示词不能为空'))
    }
    if (!['1:1', '3:4', '4:3', '9:16', '16:9'].includes(aspectRatio)) {
      return res.status(400).json(error('画面比例无效'))
    }
    if (!['standard', 'hd'].includes(quality)) {
      return res.status(400).json(error('画质选择无效'))
    }
    if (![1, 2, 4].includes(imageCount)) {
      return res.status(400).json(error('生成数量无效'))
    }
    if (mode === 'img2img' && !referenceImageUrl) {
      return res.status(400).json(error('图生图模式需要上传参考图'))
    }

    // 计算总消耗
    const totalCost = await calculateTotalCost(modelName, quality, mode, imageCount)

    // 检查余额
    const { data: user } = await supabase
      .from('users')
      .select('points_balance')
      .eq('id', req.user.id)
      .single()
    if (!user) return res.status(400).json(error('用户不存在'))
    if (parseFloat(user.points_balance) < totalCost) {
      return res.status(400).json(error(`积分不足，需要 ${totalCost} 积分，当前余额 ${user.points_balance}`))
    }

    // 创建任务记录
    const { data: taskRow, error: insertError } = await supabase
      .from('image_tasks')
      .insert({
        user_id: req.user.id,
        model_name: modelName,
        mode,
        prompt,
        aspect_ratio: aspectRatio,
        quality,
        image_count: imageCount,
        reference_image: referenceImageUrl || null,
        points_cost: totalCost,
        status: 'pending'
      })
      .select('id')
      .single()

    if (insertError) throw new Error(insertError.message)
    const taskId = taskRow.id

    // 预扣积分
    await deductPoints(req.user.id, totalCost, taskId)

    // 逐张调用多米 API
    const apiKey = await getApiKey()
    if (!apiKey) {
      await refundPoints(req.user.id, totalCost, taskId)
      await supabase
        .from('image_tasks')
        .update({ status: 'failed', fail_reason: '系统未配置 API Key', finished_at: new Date().toISOString() })
        .eq('id', taskId)
      return res.status(500).json(error('系统未配置 API Key，请联系管理员'))
    }

    const duomiTaskIds = []
    let allCreated = true
    let createError = null

    for (let i = 0; i < imageCount; i++) {
      try {
        const result = await createSingleImageTask({
          modelName, mode, prompt, aspectRatio, quality, referenceImageUrl, apiKey
        })
        duomiTaskIds.push(result.taskId)
      } catch (err) {
        createError = err.message
        allCreated = false
        duomiTaskIds.push(null)
        break
      }
    }

    if (!allCreated) {
      await refundPoints(req.user.id, totalCost, taskId)
      await supabase
        .from('image_tasks')
        .update({ status: 'failed', fail_reason: `API 创建任务失败: ${createError}`, finished_at: new Date().toISOString() })
        .eq('id', taskId)
      return res.status(500).json(error(`创建生图任务失败: ${createError}`))
    }

    // 保存多米任务 ID
    await supabase
      .from('image_tasks')
      .update({ status: 'running', duomi_task_ids: JSON.stringify(duomiTaskIds) })
      .eq('id', taskId)

    res.json(success({ taskId, duomiTaskIds, totalCost }, '任务创建成功，正在生成中...'))
  } catch (err) {
    console.error('[TASK CREATE ERROR]', err)
    res.status(500).json(error(err.message))
  }
})

/**
 * GET /api/tasks/:id/status
 */
router.get('/:id/status', authRequired, async (req, res) => {
  try {
    const taskId = parseInt(req.params.id)
    const { data: task } = await supabase
      .from('image_tasks')
      .select('*')
      .eq('id', taskId)
      .eq('user_id', req.user.id)
      .single()

    if (!task) return res.status(404).json(error('任务不存在'))

    // 已完成的直接返回
    if (task.status === 'success' || task.status === 'failed') {
      return res.json(success({
        taskId: task.id,
        status: task.status,
        resultImages: task.result_images ? JSON.parse(task.result_images) : [],
        failReason: task.fail_reason,
        pointsCost: parseFloat(task.points_cost)
      }))
    }

    // 查询多米状态
    const apiKey = await getApiKey()
    const duomiTaskIds = task.duomi_task_ids ? JSON.parse(task.duomi_task_ids) : []

    const results = []
    let successCount = 0
    let failedCount = 0
    let stillRunning = false

    for (const duomiId of duomiTaskIds) {
      if (!duomiId) {
        results.push({ status: 'failed', imageUrl: null })
        failedCount++
        continue
      }
      try {
        const statusResult = await querySingleTaskStatus(duomiId, task.model_name, apiKey)
        if (statusResult.status === 'success') {
          results.push({ status: 'success', imageUrl: statusResult.imageUrl })
          successCount++
        } else if (statusResult.status === 'failed') {
          results.push({ status: 'failed', imageUrl: null, error: statusResult.error })
          failedCount++
        } else {
          results.push({ status: 'pending', imageUrl: null })
          stillRunning = true
        }
      } catch (err) {
        results.push({ status: 'pending', imageUrl: null, error: err.message })
        stillRunning = true
      }
    }

    // 全部完成
    if (!stillRunning) {
      const imageUrls = results.filter(r => r.imageUrl).map(r => r.imageUrl)

      if (imageUrls.length > 0) {
        if (failedCount > 0) {
          const perImageCost = parseFloat(task.points_cost) / task.image_count
          const refundAmount = perImageCost * failedCount
          if (refundAmount > 0) {
            await refundPoints(task.user_id, refundAmount, taskId)
          }
        }
        await supabase
          .from('image_tasks')
          .update({ status: 'success', result_images: JSON.stringify(imageUrls), finished_at: new Date().toISOString() })
          .eq('id', taskId)

        return res.json(success({
          taskId: task.id,
          status: 'success',
          resultImages: imageUrls,
          successCount,
          failedCount,
          pointsCost: parseFloat(task.points_cost),
          refundedPoints: failedCount > 0 ? (parseFloat(task.points_cost) / task.image_count * failedCount) : 0
        }))
      } else {
        await refundPoints(task.user_id, parseFloat(task.points_cost), taskId)
        await supabase
          .from('image_tasks')
          .update({ status: 'failed', fail_reason: '全部图片生成失败', finished_at: new Date().toISOString() })
          .eq('id', taskId)

        return res.json(success({
          taskId: task.id,
          status: 'failed',
          failReason: '全部图片生成失败',
          refundedPoints: parseFloat(task.points_cost)
        }))
      }
    }

    // 仍在运行
    res.json(success({
      taskId: task.id,
      status: 'running',
      successCount,
      failedCount,
      pendingCount: duomiTaskIds.length - successCount - failedCount
    }))
  } catch (err) {
    console.error('[TASK STATUS ERROR]', err)
    res.status(500).json(error(err.message))
  }
})

/**
 * POST /api/tasks/upload-ref
 * 上传参考图到 Supabase Storage
 */
router.post('/upload-ref', authRequired, async (req, res) => {
  try {
    const { imageBase64, filename } = req.body
    if (!imageBase64) return res.status(400).json(error('图片数据不能为空'))

    const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'guo rui'
    const fileName = `refs/${Date.now()}-${filename || 'ref.png'}`
    const imageBuffer = Buffer.from(imageBase64, 'base64')

    const { data, error: uploadError } = await supabase
      .storage
      .from(bucket)
      .upload(fileName, imageBuffer, {
        contentType: 'image/png',
        upsert: false
      })

    if (uploadError) throw new Error(uploadError.message)

    const { data: urlData } = supabase
      .storage
      .from(bucket)
      .getPublicUrl(fileName)

    res.json(success({ url: urlData.publicUrl }, '上传成功'))
  } catch (err) {
    res.status(500).json(error(err.message))
  }
})

/**
 * GET /api/tasks/pricing
 */
router.get('/pricing', authRequired, async (req, res) => {
  try {
    const { data: configs } = await supabase
      .from('points_config')
      .select('model_name, quality, points_per_image')
      .order('model_name')
      .order('quality')

    const { data: i2iExtra } = await supabase
      .from('points_config')
      .select('points_per_image')
      .eq('model_name', 'i2i_extra')
      .single()

    const pricing = {}
    for (const row of configs || []) {
      if (row.model_name === 'i2i_extra') continue
      if (!pricing[row.model_name]) pricing[row.model_name] = {}
      pricing[row.model_name][row.quality] = parseFloat(row.points_per_image)
    }

    res.json(success({
      pricing,
      i2iExtra: parseFloat(i2iExtra?.points_per_image || 0),
      models: [
        { name: 'image2', label: 'image2', available: true },
        { name: 'banana', label: 'banana', available: true },
        { name: 'seedream', label: 'seedream', available: false }
      ]
    }))
  } catch (err) {
    res.status(500).json(error(err.message))
  }
})

export default router
