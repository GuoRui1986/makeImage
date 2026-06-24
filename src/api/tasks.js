import request from './index'

export const taskApi = {
  create: (data) => request.post('/tasks/create', data),
  getStatus: (taskId) => request.get(`/tasks/${taskId}/status`),
  getPricing: () => request.get('/tasks/pricing'),
  uploadRef: (data) => request.post('/tasks/upload-ref', data)
}
