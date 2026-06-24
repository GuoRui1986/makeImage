/**
 * image2 (gpt-image-2) API 封装
 * 多米接口文档: https://duomiapi.com/doc/55
 */

const BASE_URL = process.env.DUOMI_BASE_URL || 'https://duomiapi.com'

/**
 * 尺寸映射: 画面比例 → image2 的 size 参数
 */
const SIZE_MAP = {
  '1:1': '1024x1024',
  '3:4': '768x1024',
  '4:3': '1024x768',
  '9:16': '576x1024',
  '16:9': '1024x576'
}

/**
 * 画质映射
 */
const QUALITY_MAP = {
  standard: 'low',
  hd: 'high'
}

/**
 * 创建 image2 文生图任务（异步模式）
 * @param {object} params - { prompt, aspectRatio, quality, apiKey }
 * @returns {Promise<{taskId: string}>}
 */
export async function createText2ImageTask({ prompt, aspectRatio, quality, apiKey }) {
  const size = SIZE_MAP[aspectRatio] || '1024x1024'
  const qualityVal = QUALITY_MAP[quality] || 'low'

  const body = {
    model: 'gpt-image-2',
    prompt,
    size,
    quality: qualityVal,
    n: 1,
    response_format: 'url'
  }

  const resp = await fetch(`${BASE_URL}/v1/images/generations?async=true`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  })

  const data = await resp.json()

  if (!resp.ok || data.error) {
    throw new Error(data.error?.message || data.message || `image2 API error: ${resp.status}`)
  }

  // 异步模式返回 task_id
  const taskId = data.data?.id || data.id || data.task_id
  if (!taskId) {
    throw new Error('image2 API 未返回 task_id')
  }

  return { taskId: String(taskId) }
}

/**
 * 创建 image2 图生图任务
 * @param {object} params - { prompt, aspectRatio, quality, referenceImageUrl, apiKey }
 */
export async function createImage2ImageTask({ prompt, aspectRatio, quality, referenceImageUrl, apiKey }) {
  const size = SIZE_MAP[aspectRatio] || '1024x1024'
  const qualityVal = QUALITY_MAP[quality] || 'low'

  const body = {
    model: 'gpt-image-2',
    prompt,
    image: referenceImageUrl,
    size,
    quality: qualityVal,
    n: 1,
    response_format: 'url'
  }

  const resp = await fetch(`${BASE_URL}/v1/images/generations?async=true`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  })

  const data = await resp.json()

  if (!resp.ok || data.error) {
    throw new Error(data.error?.message || data.message || `image2 API error: ${resp.status}`)
  }

  const taskId = data.data?.id || data.id || data.task_id
  if (!taskId) {
    throw new Error('image2 API 未返回 task_id')
  }

  return { taskId: String(taskId) }
}

/**
 * 查询 image2 任务状态
 * @returns {Promise<{status: 'pending'|'success'|'failed', imageUrl?: string, error?: string}>}
 */
export async function queryTaskStatus(taskId, apiKey) {
  const resp = await fetch(`${BASE_URL}/v1/tasks/${taskId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`
    }
  })

  const data = await resp.json()

  if (!resp.ok) {
    throw new Error(data.error?.message || data.message || `image2 query error: ${resp.status}`)
  }

  // 多米实际返回格式：{ id, state: "succeeded"|"processing"|"failed", data: { images: [{ url }] } }
  const state = data.state

  if (state === 'succeeded') {
    // 提取图片 URL：data.images[0].url
    const imageUrl = data.data?.images?.[0]?.url || null
    return { status: 'success', imageUrl }
  }

  if (state === 'failed') {
    return { status: 'failed', error: data.error?.message || data.message || '生成失败' }
  }

  // processing / pending / other
  return { status: 'pending' }
}
