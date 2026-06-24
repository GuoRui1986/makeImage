/**
 * banana (nano-banana) API 封装
 * 文生图: https://duomiapi.com/doc/85
 * 图生图: https://duomiapi.com/doc/86
 */

const BASE_URL = process.env.DUOMI_BASE_URL || 'https://duomiapi.com'

// 使用 nano-banana-2（有失败兜底，同价位）
const BANANA_MODEL = 'gemini-3.1-flash-image-preview'

/**
 * 画质映射: banana 的 image_size 参数
 */
const QUALITY_MAP = {
  standard: '1K',
  hd: '2K'
}

/**
 * 创建 banana 文生图任务
 * @param {object} params - { prompt, aspectRatio, quality, apiKey }
 * @returns {Promise<{taskId: string}>}
 */
export async function createText2ImageTask({ prompt, aspectRatio, quality, apiKey }) {
  const body = {
    model: BANANA_MODEL,
    prompt,
    aspect_ratio: aspectRatio || '1:1',
    image_size: QUALITY_MAP[quality] || '1K'
  }

  const resp = await fetch(`${BASE_URL}/api/gemini/nano-banana`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': apiKey
    },
    body: JSON.stringify(body)
  })

  const data = await resp.json()

  if (!resp.ok || data.code !== 200) {
    throw new Error(data.message || data.msg || `banana API error: ${resp.status}`)
  }

  const taskId = data.data?.task_id
  if (!taskId) {
    throw new Error('banana API 未返回 task_id')
  }

  return { taskId: String(taskId) }
}

/**
 * 创建 banana 图生图任务
 * @param {object} params - { prompt, aspectRatio, quality, referenceImageUrl, apiKey }
 */
export async function createImage2ImageTask({ prompt, aspectRatio, quality, referenceImageUrl, apiKey }) {
  const body = {
    model: BANANA_MODEL,
    prompt,
    image_urls: [referenceImageUrl],
    aspect_ratio: aspectRatio || 'auto',
    image_size: QUALITY_MAP[quality] || '1K'
  }

  const resp = await fetch(`${BASE_URL}/api/gemini/nano-banana-edit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': apiKey
    },
    body: JSON.stringify(body)
  })

  const data = await resp.json()

  if (!resp.ok || data.code !== 200) {
    throw new Error(data.message || data.msg || `banana edit API error: ${resp.status}`)
  }

  const taskId = data.data?.task_id
  if (!taskId) {
    throw new Error('banana edit API 未返回 task_id')
  }

  return { taskId: String(taskId) }
}

/**
 * 查询 banana 任务状态
 * 多米统一查询接口: GET /v1/tasks/{task_id}
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
    // 如果统一接口不支持，尝试 banana 专用查询
    return await queryBananaTask(taskId, apiKey)
  }

  // 多米实际返回格式：{ id, state: "succeeded"|"processing"|"failed", data: { images: [{ url }] } }
  const state = data.state

  if (state === 'succeeded') {
    const imageUrl = data.data?.images?.[0]?.url || null
    return { status: 'success', imageUrl }
  }

  if (state === 'failed') {
    return { status: 'failed', error: data.error?.message || data.message || '生成失败' }
  }

  return { status: 'pending' }
}

/**
 * 备用：banana 专用查询接口
 */
async function queryBananaTask(taskId, apiKey) {
  const resp = await fetch(`${BASE_URL}/api/gemini/nano-banana-result?task_id=${taskId}`, {
    method: 'GET',
    headers: {
      'Authorization': apiKey
    }
  })

  const data = await resp.json()

  if (!resp.ok || data.code !== 200) {
    throw new Error(data.message || data.msg || `banana query error: ${resp.status}`)
  }

  // 统一按 state 字段判断
  const state = data.data?.state || data.data?.status
  if (state === 'succeeded' || state === 'success' || data.data?.images?.length > 0) {
    const imageUrl = data.data.images?.[0]?.url || data.data.images?.[0]
    if (imageUrl) {
      return { status: 'success', imageUrl: typeof imageUrl === 'string' ? imageUrl : imageUrl.url }
    }
    return { status: 'success', imageUrl: null }
  }

  if (state === 'failed') {
    return { status: 'failed', error: data.data?.error || '生成失败' }
  }

  return { status: 'pending' }
}
