import request from './index'

export const pointsApi = {
  getRecords: (page = 1) => request.get('/points/records', { params: { page } }),
  getBalance: () => request.get('/points/balance')
}
