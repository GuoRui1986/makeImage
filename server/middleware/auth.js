import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'ai-image-tool-default-secret'
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d'

/**
 * 生成 JWT Token
 * @param {object} payload - { id, username, role: 'user' | 'admin' }
 */
export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES })
}

/**
 * 验证 Token，返回 payload 或 null
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET)
  } catch {
    return null
  }
}

/**
 * Express 中间件：验证用户登录
 */
export function authRequired(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ code: 401, data: null, message: '未登录或登录已过期' })
  }
  const token = authHeader.slice(7)
  const payload = verifyToken(token)
  if (!payload) {
    return res.status(401).json({ code: 401, data: null, message: '未登录或登录已过期' })
  }
  req.user = payload
  next()
}

/**
 * 中间件：仅管理员可访问
 */
export function adminRequired(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ code: 403, data: null, message: '无权限访问' })
  }
  next()
}
