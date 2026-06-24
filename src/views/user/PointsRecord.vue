<template>
  <div class="page-container">
    <el-card>
      <template #header>
        <span class="card-title">积分记录</span>
      </template>

      <el-table :data="records" v-loading="loading" stripe>
        <el-table-column prop="createdAt" label="时间" width="180">
          <template #default="{ row }">
            {{ formatTime(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column prop="typeLabel" label="变动类型" width="120" />
        <el-table-column prop="amount" label="积分变动" width="120">
          <template #default="{ row }">
            <span :style="{ color: row.amount > 0 ? '#67c23a' : '#f56c6c', fontWeight: 600 }">
              {{ row.amount > 0 ? '+' : '' }}{{ row.amount }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="balanceAfter" label="变动后余额" width="120" />
        <el-table-column prop="remark" label="备注" min-width="200" />
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
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { pointsApi } from '../../api/points'

const records = ref([])
const loading = ref(false)
const page = ref(1)
const total = ref(0)

const formatTime = (t) => {
  if (!t) return '-'
  return new Date(t).toLocaleString('zh-CN')
}

const loadData = async () => {
  loading.value = true
  try {
    const res = await pointsApi.getRecords(page.value)
    records.value = res.data.records
    total.value = res.data.total
  } finally {
    loading.value = false
  }
}

onMounted(loadData)
</script>

<style scoped>
.card-title {
  font-size: 16px;
  font-weight: 600;
}

.pagination {
  margin-top: 16px;
  display: flex;
  justify-content: center;
}
</style>
