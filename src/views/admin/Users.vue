<template>
  <div class="page-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <span class="card-title">用户管理</span>
          <el-button type="primary" @click="showCreateDialog = true">
            <el-icon><Plus /></el-icon> 创建用户
          </el-button>
        </div>
      </template>

      <!-- 搜索 -->
      <div class="filter-bar">
        <el-input
          v-model="keyword"
          placeholder="搜索用户名"
          clearable
          style="width: 240px"
          @keyup.enter="loadData"
          @clear="loadData"
        />
        <el-button @click="loadData">搜索</el-button>
      </div>

      <!-- 表格 -->
      <el-table :data="users" v-loading="loading" stripe>
        <el-table-column prop="id" label="ID" width="60" />
        <el-table-column prop="username" label="用户名" width="150" />
        <el-table-column label="剩余积分" width="100">
          <template #default="{ row }">{{ row.points ?? row.points_balance ?? row.pointsBalance ?? '-' }}</template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 || row.status === 'active' ? 'success' : 'danger'">
              {{ row.status === 1 || row.status === 'active' ? '启用' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" width="180">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column prop="lastLoginAt" label="最后登录" width="180">
          <template #default="{ row }">{{ formatTime(row.lastLoginAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openPointsDialog(row)">调整积分</el-button>
            <el-button size="small" @click="openPasswordDialog(row)">重置密码</el-button>
            <el-button size="small" :type="row.status === 1 ? 'danger' : 'success'" plain @click="toggleStatus(row)">
              {{ row.status === 1 ? '禁用' : '启用' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination">
        <el-pagination
          v-model:current-page="page"
          :page-size="20"
          :total="total"
          layout="prev, pager, next"
          @current-change="loadData"
        />
      </div>
    </el-card>

    <!-- 创建用户弹窗 -->
    <el-dialog v-model="showCreateDialog" title="创建用户" width="440px">
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="80px">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="createForm.username" placeholder="请输入用户名" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="createForm.password" type="password" placeholder="至少6位" show-password />
        </el-form-item>
        <el-form-item label="初始积分" prop="initialPoints">
          <el-input-number v-model="createForm.initialPoints" :min="0" :precision="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleCreate">创建</el-button>
      </template>
    </el-dialog>

    <!-- 调整积分弹窗 -->
    <el-dialog v-model="showPointsDialog" title="调整积分" width="440px">
      <el-form label-width="80px">
        <el-form-item label="用户">
          <span>{{ currentUser?.username }}（当前余额: {{ currentUser?.points ?? currentUser?.points_balance ?? currentUser?.pointsBalance ?? 0 }}）</span>
        </el-form-item>
        <el-form-item label="调整额度">
          <el-input-number v-model="pointsForm.amount" :precision="2" placeholder="正数增加，负数减少" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="pointsForm.remark" type="textarea" :rows="2" placeholder="调整原因（选填）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showPointsDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleAdjustPoints">确认</el-button>
      </template>
    </el-dialog>

    <!-- 重置密码弹窗 -->
    <el-dialog v-model="showPasswordDialog" title="重置密码" width="440px">
      <el-form label-width="80px">
        <el-form-item label="用户">
          <span>{{ currentUser?.username }}</span>
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="newPassword" type="password" placeholder="至少6位" show-password />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showPasswordDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleResetPassword">确认</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { adminApi } from '../../api/admin'

const users = ref([])
const loading = ref(false)
const page = ref(1)
const total = ref(0)
const keyword = ref('')
const submitting = ref(false)

const showCreateDialog = ref(false)
const showPointsDialog = ref(false)
const showPasswordDialog = ref(false)
const currentUser = ref(null)
const newPassword = ref('')

const createFormRef = ref()
const createForm = reactive({ username: '', password: '', initialPoints: 0 })
const createRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }, { min: 6, message: '至少6位', trigger: 'blur' }]
}

const pointsForm = reactive({ amount: 0, remark: '' })

const formatTime = (t) => t ? new Date(t).toLocaleString('zh-CN') : '-'

const loadData = async () => {
  loading.value = true
  try {
    const res = await adminApi.getUsers({ page: page.value, keyword: keyword.value })
    users.value = res.data.list || []
    total.value = res.data.total || 0
  } finally {
    loading.value = false
  }
}

const handleCreate = async () => {
  await createFormRef.value.validate(async (valid) => {
    if (!valid) return
    submitting.value = true
    try {
      await adminApi.createUser(createForm)
      ElMessage.success('用户创建成功')
      showCreateDialog.value = false
      createForm.username = ''
      createForm.password = ''
      createForm.initialPoints = 0
      loadData()
    } finally {
      submitting.value = false
    }
  })
}

const openPointsDialog = (user) => {
  currentUser.value = user
  pointsForm.amount = 0
  pointsForm.remark = ''
  showPointsDialog.value = true
}

const handleAdjustPoints = async () => {
  if (pointsForm.amount === 0) {
    ElMessage.warning('调整额度不能为0')
    return
  }
  submitting.value = true
  try {
    await adminApi.adjustPoints(currentUser.value.id, pointsForm.amount, pointsForm.remark)
    ElMessage.success('积分调整成功')
    showPointsDialog.value = false
    loadData()
  } finally {
    submitting.value = false
  }
}

const openPasswordDialog = (user) => {
  currentUser.value = user
  newPassword.value = ''
  showPasswordDialog.value = true
}

const handleResetPassword = async () => {
  if (!newPassword.value || newPassword.value.length < 6) {
    ElMessage.warning('密码至少6位')
    return
  }
  submitting.value = true
  try {
    await adminApi.resetPassword(currentUser.value.id, newPassword.value)
    ElMessage.success('密码重置成功')
    showPasswordDialog.value = false
  } finally {
    submitting.value = false
  }
}

const toggleStatus = async (user) => {
  try {
    await ElMessageBox.confirm(
      `确认${user.status === 1 ? '禁用' : '启用'}用户「${user.username}」？`,
      '确认操作',
      { type: 'warning' }
    )
    await adminApi.toggleStatus(user.id, user.status === 1 ? 0 : 1)
    ElMessage.success('操作成功')
    loadData()
  } catch {
    // 取消
  }
}

onMounted(loadData)
</script>

<style scoped>
.card-title { font-size: 16px; font-weight: 600; }
.card-header { display: flex; align-items: center; justify-content: space-between; }
.filter-bar { display: flex; gap: 8px; margin-bottom: 16px; }
.pagination { margin-top: 16px; display: flex; justify-content: center; }
</style>
