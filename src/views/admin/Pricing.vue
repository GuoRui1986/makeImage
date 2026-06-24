<template>
  <div class="page-container">
    <el-card v-loading="loading">
      <template #header>
        <div class="card-header">
          <span class="card-title">积分定价配置</span>
          <el-button type="primary" :loading="saving" @click="handleSave">保存配置</el-button>
        </div>
      </template>

      <p class="hint">修改后即时生效，新的生图任务按新价格计算。</p>

      <table class="pricing-table">
        <thead>
          <tr>
            <th>模型</th>
            <th>标准画质（积分/张）</th>
            <th>高清画质（积分/张）</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="model in ['image2', 'banana', 'seedream']" :key="model">
            <td class="model-name">{{ model }}</td>
            <td>
              <el-input-number
                v-model="pricingMap[model + '_standard']"
                :min="0"
                :precision="2"
                :step="0.5"
                size="small"
              />
            </td>
            <td>
              <el-input-number
                v-model="pricingMap[model + '_hd']"
                :min="0"
                :precision="2"
                :step="0.5"
                size="small"
              />
            </td>
          </tr>
        </tbody>
      </table>

      <el-divider />

      <div class="extra-config">
        <span class="label">图生图模式每张额外增加积分：</span>
        <el-input-number
          v-model="pricingMap['i2i_extra']"
          :min="0"
          :precision="2"
          :step="0.5"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { adminApi } from '../../api/admin'

const loading = ref(false)
const saving = ref(false)
const pricingMap = reactive({})
const configIdMap = {}

const loadData = async () => {
  loading.value = true
  try {
    const res = await adminApi.getPricing()
    for (const item of res.data.pricing) {
      const key = item.quality ? `${item.model_name}_${item.quality}` : item.model_name
      pricingMap[key] = parseFloat(item.points_per_image)
      configIdMap[key] = item.id
    }
  } finally {
    loading.value = false
  }
}

const handleSave = async () => {
  saving.value = true
  try {
    const pricing = []
    for (const [key, id] of Object.entries(configIdMap)) {
      pricing.push({ id, pointsPerImage: pricingMap[key] })
    }
    await adminApi.updatePricing(pricing)
    ElMessage.success('定价配置已保存')
  } finally {
    saving.value = false
  }
}

onMounted(loadData)
</script>

<style scoped>
.card-title { font-size: 16px; font-weight: 600; }
.card-header { display: flex; align-items: center; justify-content: space-between; }
.hint { color: #909399; font-size: 13px; margin-bottom: 16px; }

.pricing-table {
  width: 100%;
  border-collapse: collapse;
}
.pricing-table th,
.pricing-table td {
  padding: 12px 16px;
  border: 1px solid #ebeef5;
  text-align: left;
}
.pricing-table th {
  background: #f5f7fa;
  font-weight: 600;
  color: #333;
}
.model-name { font-weight: 600; }

.extra-config {
  display: flex;
  align-items: center;
  gap: 12px;
}
.extra-config .label { font-size: 14px; color: #555; }
</style>
