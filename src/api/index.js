import axios from 'axios'
import { ElMessage } from 'element-plus'

const request = axios.create({
  baseURL: '/api',
  timeout: 30000
})

// 请求拦截：附带 token
request.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 响应拦截：统一处理
request.interceptors.response.use(
  response => {
    const res = response.data
    if (res.code === 200) {
      return res
    }
    ElMessage.error(res.message || '请求失败')
    return Promise.reject(new Error(res.message || 'Error'))
  },
  error => {
    if (error.response?.status === 401) {
      const msg = error.response?.data?.message || ''
      // 登录接口返回401时显示具体原因（用户名/密码错误等）
      if (error.config?.url?.includes('/auth/login')) {
        ElMessage.error(msg || '用户名或密码错误')
      } else {
        localStorage.removeItem('token')
        ElMessage.error(msg || '登录已过期，请重新登录')
        setTimeout(() => {
          window.location.href = '/login'
        }, 1500)
      }
    } else {
      const msg = error.response?.data?.message || error.message || '网络错误'
      ElMessage.error(msg)
    }
    return Promise.reject(error)
  }
)

export default request
