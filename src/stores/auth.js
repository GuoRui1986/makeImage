import { defineStore } from 'pinia'
import { authApi } from '../api/auth'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('token') || '',
    user: null,
    pointsBalance: 0
  }),

  getters: {
    isLoggedIn: (state) => !!state.token,
    isAdmin: (state) => state.user?.role === 'admin'
  },

  actions: {
    async login(username, password) {
      const res = await authApi.login(username, password)
      this.token = res.data.token
      localStorage.setItem('token', this.token)
      this.user = {
        username: res.data.username,
        role: res.data.role
      }
      if (res.data.pointsBalance !== undefined) {
        this.pointsBalance = res.data.pointsBalance
      }
      return res.data
    },

    initFromStorage() {
      if (!this.token) return
      this.fetchUserInfo()
    },

    async fetchUserInfo() {
      try {
        const res = await authApi.info()
        this.user = res.data
        if (res.data.pointsBalance !== undefined) {
          this.pointsBalance = res.data.pointsBalance
        }
      } catch {
        this.logout()
      }
    },

    async refreshPoints() {
      if (this.user?.role === 'admin') return
      try {
        const res = await authApi.info()
        if (res.data.pointsBalance !== undefined) {
          this.pointsBalance = res.data.pointsBalance
        }
      } catch {
        // ignore
      }
    },

    logout() {
      this.token = ''
      this.user = null
      this.pointsBalance = 0
      localStorage.removeItem('token')
    }
  }
})
