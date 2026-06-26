<template>
  <div class="page-container">
    <el-card>
      <template #header>
        <span class="card-title">全局积分流水</span>
      </template>

      <!-- 筛选 -->
      <div class="filter-bar">
        <el-input v-model="filters.username" placeholder="用户名" clearable style="width: 160px" />
        <el-select v-model="filters.type" placeholder="变动类型" clearable style="width: 140px">
          <el-option label="管理员发放" value="admin_add" />
          <el-option label="生图扣除" value="generate_deduct" />
          <el-option label="失败返还" value="fail_refund" />
        </el-select>
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          value-format="YYYY-MM-DD"
          style="width: 260px"
        />
        <el-button type="primary" @click="loadData">查询</el-button>
        <el-button @click="resetFilters">重置</el-button>
      </div>

      <el-table :data="records" v-loading="loading" stripe>
        <el-table-column prop="username" label="用户名" width="120" />
        <el-table-column prop="createdAt" label="时间" width="180">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column prop="typeLabel" label="变动类型" width="120" />
        <el-table-column prop="amount" label="变动积分" width="100">
          <template #default="{ row }">
            <span :style="{ color: row.amount > 0 ? '#67c23a' : '#f56c6c', fontWeight: 600 }">
              {{ row.amount > 0 ? '+' : '' }}{{ row.amount }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="balanceAfter" label="变动后余额" width="110" />
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
import { ref, reactive, onMounted } from 'vue'
import { adminApi } from '../../api/admin'

const records = ref([])
const loading = ref(false)
const page = ref(1)
const total = ref(0)
const dateRange = ref(null)

const filters = reactive({ username: '', type: '' })

const formatTime = (t) => t ? new Date(t).toLocaleString('zh-CN') : '-'

const loadData = async () => {
  loading.value = true
  try {
    const params = {
      page: page.value,
      username: filters.username || undefined,
      type: filters.type || undefined,
      startDate: dateRange.value?.[0] || undefined,
      endDate: dateRange.value?.[1] || undefined
    }
    const res = await adminApi.getPointsFlow(params)
    // 后端返回 list，前端兼容 list/records 两种 key
    const rawList = res.data.list || res.data.records || []
    records.value = rawList.map(item => ({
      ...item,
      createdAt: item.created_at || item.createdAt,
      typeLabel: item.type === 'admin_adjust' ? '管理员调整' : (item.type === 'generate_deduct' ? '生图扣除' : (item.type === 'fail_refund' ? '失败返还' : item.type)),
      balanceAfter: item.balance_after || item.balanceAfter,
      username: item.username || '用户'
    }))
    total.value = res.data.total
  } finally {
    loading.value = false
  }
}

const resetFilters = () => {
  filters.username = ''
  filters.type = ''
  dateRange.value = null
  page.value = 1
  loadData()
}

onMounted(loadData)
</script>

<style scoped>
.card-title { font-size: 16px; font-weight: 600; }
.filter-bar { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
.pagination { margin-top: 16px; display: flex; justify-content: center; }
</style>
