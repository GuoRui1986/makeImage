import request from './index'

export const historyApi = {
  getList: (page = 1) => request.get('/history/list', { params: { page } }),
  getDetail: (id) => request.get(`/history/detail/${id}`)
}
