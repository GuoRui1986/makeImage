/**
 * 统一响应格式: { code, data, message }
 */
export function success(data = null, message = '操作成功') {
  return { code: 200, data, message }
}

export function error(message = '操作失败', code = 400) {
  return { code, data: null, message }
}

export function notFound(message = '资源不存在') {
  return { code: 404, data: null, message }
}

export function unauthorized(message = '未登录或登录已过期') {
  return { code: 401, data: null, message }
}

export function forbidden(message = '无权限访问') {
  return { code: 403, data: null, message }
}
