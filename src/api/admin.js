import request from './index'

export const adminApi = {
  // 用户管理
  getUsers: (params) => request.get('/admin/users', { params }),
  createUser: (data) => request.post('/admin/users', data),
  adjustPoints: (userId, amount, remark) => request.put(`/admin/users/${userId}/points`, { amount, remark }),
  resetPassword: (userId, newPassword) => request.put(`/admin/users/${userId}/password`, { newPassword }),
  toggleStatus: (userId, status) => request.put(`/admin/users/${userId}/status`, { status }),

  // 定价配置
  getPricing: () => request.get('/admin/pricing'),
  updatePricing: (pricing) => request.put('/admin/pricing', { pricing }),

  // 全局记录
  getPointsFlow: (params) => request.get('/admin/records/points', { params }),
  getImageRecords: (params) => request.get('/admin/records/images', { params }),
  getImageRecordDetail: (id) => request.get(`/admin/records/images/${id}`),

  // 系统设置
  getSettings: () => request.get('/admin/settings'),
  updateApiConfig: (data) => request.put('/admin/settings/api', data),
  updatePassword: (oldPassword, newPassword) => request.put('/admin/settings/password', { oldPassword, newPassword })
}
