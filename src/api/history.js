import request from './index'

export const historyApi = {
  getList: (page = 1) => request.get('/history', { params: { page } }),
  getDetail: (id) => request.get(`/history/${id}`)
}
