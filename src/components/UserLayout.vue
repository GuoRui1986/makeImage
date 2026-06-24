<template>
  <el-container class="layout-container">
    <el-aside width="220px" class="sidebar">
      <div class="logo">
        <el-icon size="24"><Picture /></el-icon>
        <span>AI生图工具</span>
      </div>
      <el-menu
        :default-active="activeMenu"
        router
        class="sidebar-menu"
      >
        <el-menu-item index="/workbench">
          <el-icon><MagicStick /></el-icon>
          <span>生图工作台</span>
        </el-menu-item>
        <el-menu-item index="/points">
          <el-icon><Wallet /></el-icon>
          <span>积分记录</span>
        </el-menu-item>
        <el-menu-item index="/history">
          <el-icon><Clock /></el-icon>
          <span>生成历史</span>
        </el-menu-item>
        <el-menu-item v-if="authStore.isAdmin" index="/admin/users">
          <el-icon><Setting /></el-icon>
          <span>管理后台</span>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="header">
        <div class="header-left">
          <span class="page-title">{{ currentTitle }}</span>
        </div>
        <div class="header-right">
          <span v-if="!authStore.isAdmin" class="points-badge">
            <el-icon><Coin /></el-icon>
            {{ authStore.pointsBalance }} 积分
          </span>
          <el-dropdown @command="handleCommand">
            <span class="user-info">
              <el-icon><User /></el-icon>
              {{ authStore.user?.username || '用户' }}
              <el-icon class="arrow"><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="logout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <el-main class="main-content">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const activeMenu = computed(() => route.path)
const currentTitle = computed(() => route.meta.title || '')

const handleCommand = (command) => {
  if (command === 'logout') {
    authStore.logout()
    router.push('/login')
  }
}

onMounted(() => {
  if (!authStore.user) {
    authStore.initFromStorage()
  }
})
</script>

<style scoped>
.layout-container {
  height: 100vh;
}

.sidebar {
  background: #1a1a2e;
  display: flex;
  flex-direction: column;
}

.logo {
  height: 60px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 20px;
  color: #fff;
  font-size: 18px;
  font-weight: 700;
  border-bottom: 1px solid rgba(255,255,255,0.1);
}

.sidebar-menu {
  border-right: none;
  background: transparent;
  flex: 1;
}

.sidebar-menu .el-menu-item {
  color: rgba(255,255,255,0.7);
}

.sidebar-menu .el-menu-item:hover {
  background: rgba(255,255,255,0.08);
  color: #fff;
}

.sidebar-menu .el-menu-item.is-active {
  background: rgba(102, 126, 234, 0.3);
  color: #fff;
}

.header {
  height: 60px;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  border-bottom: 1px solid #e8e8e8;
  box-shadow: 0 1px 4px rgba(0,0,0,0.04);
}

.page-title {
  font-size: 16px;
  font-weight: 600;
  color: #333;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 20px;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: #555;
  font-size: 14px;
}

.user-info .arrow {
  font-size: 12px;
}

.main-content {
  background: #f5f6fa;
  overflow-y: auto;
}
</style>
