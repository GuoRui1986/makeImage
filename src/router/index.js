import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const routes = [
  { path: '/login', name: 'Login', component: () => import('../views/Login.vue'), meta: { public: true } },
  {
    path: '/',
    component: () => import('../components/UserLayout.vue'),
    redirect: '/workbench',
    children: [
      { path: 'workbench', name: 'Workbench', component: () => import('../views/user/Workbench.vue'), meta: { title: '生图工作台' } },
      { path: 'points', name: 'PointsRecord', component: () => import('../views/user/PointsRecord.vue'), meta: { title: '积分记录' } },
      { path: 'history', name: 'History', component: () => import('../views/user/History.vue'), meta: { title: '生成历史' } },
      { path: 'history/:id', name: 'TaskDetail', component: () => import('../views/user/TaskDetail.vue'), meta: { title: '任务详情' } },
    ]
  },
  {
    path: '/admin',
    component: () => import('../components/AdminLayout.vue'),
    redirect: '/admin/users',
    children: [
      { path: 'users', name: 'AdminUsers', component: () => import('../views/admin/Users.vue'), meta: { title: '用户管理', admin: true } },
      { path: 'pricing', name: 'AdminPricing', component: () => import('../views/admin/Pricing.vue'), meta: { title: '积分定价', admin: true } },
      { path: 'points-flow', name: 'AdminPointsFlow', component: () => import('../views/admin/PointsFlow.vue'), meta: { title: '全局积分流水', admin: true } },
      { path: 'image-records', name: 'AdminImageRecords', component: () => import('../views/admin/ImageRecords.vue'), meta: { title: '全局生图记录', admin: true } },
      { path: 'settings', name: 'AdminSettings', component: () => import('../views/admin/Settings.vue'), meta: { title: '系统设置', admin: true } },
    ]
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// 路由守卫
router.beforeEach((to, from, next) => {
  const authStore = useAuthStore()
  const token = localStorage.getItem('token')

  if (to.meta.public) {
    if (token) return next('/')
    return next()
  }

  if (!token) {
    return next('/login')
  }

  // 如果 store 还没初始化，先加载用户信息
  if (!authStore.user) {
    authStore.initFromStorage()
  }

  // 管理员路由检查
  if (to.meta.admin && authStore.user?.role !== 'admin') {
    return next('/')
  }

  next()
})

export default router
