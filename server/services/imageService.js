/**
 * 统一生图服务层
 * 根据 model_name 分发到对应模型 API
 */
import * as image2 from './image2.js'
import * as banana from './banana.js'
import { supabase } from '../db/index.js'

/**
 * 获取多米 API Key（优先从数据库读取，其次环境变量）
 */
export async function getApiKey() {
  const { data } = await supabase
    .from('system_config')
    .select('config_value')
    .eq('config_key', 'duomi_api_key')
    .single()
  return data?.config_value || process.env.DUOMI_API_KEY || ''
}

/**
 * 根据模型名+画质获取单张积分
 */
export async function getPointsPerImage(modelName, quality) {
  const { data, error } = await supabase
    .from('points_config')
    .select('points_per_image')
    .eq('model_name', modelName)
    .eq('quality', quality)
    .single()
  if (error || !data) throw new Error(`未找到模型 ${modelName} 的 ${quality} 画质定价配置`)
  return parseFloat(data.points_per_image)
}

/**
 * 获取图生图额外积分
 */
export async function getI2IExtraPoints() {
  const { data } = await supabase
    .from('points_config')
    .select('points_per_image')
    .eq('model_name', 'i2i_extra')
    .single()
  return parseFloat(data?.points_per_image || 0)
}

/**
 * 计算单次生成任务总积分消耗
 */
export async function calculateTotalCost(modelName, quality, mode, count) {
  const basePoints = await getPointsPerImage(modelName, quality)
  const extraPoints = mode === 'img2img' ? await getI2IExtraPoints() : 0
  const perImage = basePoints + extraPoints
  return perImage * count
}

/**
 * 检查模型是否可用
 */
export function isModelAvailable(modelName) {
  return modelName === 'image2' || modelName === 'banana'
}

/**
 * 为单个图片创建生成任务（调一次 API 生成一张）
 */
export async function createSingleImageTask({ modelName, mode, prompt, aspectRatio, quality, referenceImageUrl, apiKey }) {
  if (!isModelAvailable(modelName)) {
    throw new Error(`模型 ${modelName} 暂不可用`)
  }
  const service = modelName === 'image2' ? image2 : banana
  if (mode === 'img2img') {
    if (!referenceImageUrl) throw new Error('图生图模式需要参考图')
    return service.createImage2ImageTask({ prompt, aspectRatio, quality, referenceImageUrl, apiKey })
  } else {
    return service.createText2ImageTask({ prompt, aspectRatio, quality, apiKey })
  }
}

/**
 * 查询单个任务状态
 */
export async function querySingleTaskStatus(duomiTaskId, modelName, apiKey) {
  if (!isModelAvailable(modelName)) {
    throw new Error(`模型 ${modelName} 暂不可用`)
  }
  const service = modelName === 'image2' ? image2 : banana
  return service.queryTaskStatus(duomiTaskId, apiKey)
}

/**
 * 预扣积分（通过 RPC 调用 PostgreSQL 函数，保证事务原子性）
 */
export async function deductPoints(userId, amount, taskId) {
  const { data, error } = await supabase
    .rpc('deduct_points', {
      p_user_id: userId,
      p_amount: amount,
      p_task_id: taskId
    })
  if (error) throw new Error(error.message)
  return parseFloat(data)
}

/**
 * 返还积分
 */
export async function refundPoints(userId, amount, taskId) {
  const { data, error } = await supabase
    .rpc('refund_points', {
      p_user_id: userId,
      p_amount: amount,
      p_task_id: taskId
    })
  if (error) throw new Error(error.message)
  return parseFloat(data)
}

/**
 * 管理员调整积分
 */
export async function adminAdjustPoints(userId, amount, remark) {
  const { data, error } = await supabase
    .rpc('admin_adjust_points', {
      p_user_id: userId,
      p_amount: amount,
      p_remark: remark
    })
  if (error) throw new Error(error.message)
  return parseFloat(data)
}
