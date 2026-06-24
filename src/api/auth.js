import request from './index'

export const authApi = {
  login: (username, password) => request.post('/auth/login', { username, password }),
  info: () => request.get('/auth/info')
}
