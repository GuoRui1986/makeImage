<template>
  <div class="page-container">
    <el-row :gutter="20">
      <!-- API 配置 -->
      <el-col :span="12">
        <el-card>
          <template #header>
            <span class="card-title">模型 API 配置</span>
          </template>
          <el-form label-position="top">
            <el-form-item label="多米 API Key">
              <el-input
                v-model="apiConfig.duomiApiKey"
                placeholder="输入新的 API Key（留空不修改）"
                type="password"
                show-password
              />
              <div v-if="settings.duomi_api_key_configured" class="hint">
                当前已配置 Key: {{ settings.duomi_api_key }}
              </div>
            </el-form-item>
            <el-form-item label="多米 API 地址">
              <el-input v-model="apiConfig.duomiBaseUrl" placeholder="https://duomiapi.com" />
            </el-form-item>
            <el-button type="primary" :loading="savingApi" @click="saveApiConfig">保存</el-button>
          </el-form>
        </el-card>
      </el-col>

      <!-- 修改密码 -->
      <el-col :span="12">
        <el-card>
          <template #header>
            <span class="card-title">修改管理员密码</span>
          </template>
          <el-form label-position="top">
            <el-form-item label="原密码">
              <el-input v-model="pwdForm.oldPassword" type="password" show-password />
            </el-form-item>
            <el-form-item label="新密码">
              <el-input v-model="pwdForm.newPassword" type="password" show-password placeholder="至少6位" />
            </el-form-item>
            <el-form-item label="确认新密码">
              <el-input v-model="pwdForm.confirmPassword" type="password" show-password />
            </el-form-item>
            <el-button type="primary" :loading="savingPwd" @click="savePassword">修改密码</el-button>
          </el-form>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { adminApi } from '../../api/admin'

const settings = ref({})
const savingApi = ref(false)
const savingPwd = ref(false)

const apiConfig = reactive({
  duomiApiKey: '',
  duomiBaseUrl: 'https://duomiapi.com'
})

const pwdForm = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: ''
})

const loadSettings = async () => {
  const res = await adminApi.getSettings()
  settings.value = res.data.settings
  if (settings.value.duomi_base_url) {
    apiConfig.duomiBaseUrl = settings.value.duomi_base_url
  }
}

const saveApiConfig = async () => {
  savingApi.value = true
  try {
    await adminApi.updateApiConfig({
      duomiApiKey: apiConfig.duomiApiKey || undefined,
      duomiBaseUrl: apiConfig.duomiBaseUrl
    })
    ElMessage.success('API配置已保存')
    apiConfig.duomiApiKey = ''
    loadSettings()
  } finally {
    savingApi.value = false
  }
}

const savePassword = async () => {
  if (!pwdForm.oldPassword || !pwdForm.newPassword) {
    ElMessage.warning('请填写完整')
    return
  }
  if (pwdForm.newPassword.length < 6) {
    ElMessage.warning('新密码至少6位')
    return
  }
  if (pwdForm.newPassword !== pwdForm.confirmPassword) {
    ElMessage.warning('两次密码不一致')
    return
  }
  savingPwd.value = true
  try {
    await adminApi.updatePassword(pwdForm.oldPassword, pwdForm.newPassword)
    ElMessage.success('密码修改成功')
    pwdForm.oldPassword = ''
    pwdForm.newPassword = ''
    pwdForm.confirmPassword = ''
  } finally {
    savingPwd.value = false
  }
}

onMounted(loadSettings)
</script>

<style scoped>
.card-title { font-size: 16px; font-weight: 600; }
.hint { margin-top: 4px; font-size: 12px; color: #909399; }
</style>
