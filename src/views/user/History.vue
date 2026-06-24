<template>
  <div class="page-container">
    <el-card>
      <template #header>
        <span class="card-title">生成历史</span>
      </template>

      <div v-loading="loading">
        <div v-if="records.length === 0 && !loading" style="padding: 40px 0">
          <el-empty description="还没有生成记录" />
        </div>

        <div class="history-grid">
          <div v-for="item in records" :key="item.id" class="history-card" @click="goDetail(item.id)">
            <div class="history-thumb">
              <el-image v-if="item.firstImage" :src="item.firstImage" fit="cover" class="thumb-img" />
              <div v-else class="thumb-placeholder">
                <el-icon size="32"><Picture /></el-icon>
              </div>
            </div>
            <div class="history-info">
              <div class="info-row">
                <el-tag size="small" effect="plain">{{ item.modelName }}</el-tag>
                <el-tag size="small" :type="modeType(item.mode)">{{ modeLabel(item.mode) }}</el-tag>
                <el-tag size="small" :type="statusType(item.status)">{{ statusLabel(item.status) }}</el-tag>
              </div>
              <div class="info-meta">
                <span>{{ item.imageCount }}张 · {{ item.pointsCost }}积分</span>
                <span>{{ formatTime(item.createdAt) }}</span>
              </div>
              <div class="info-prompt">{{ item.prompt }}</div>
            </div>
          </div>
        </div>

        <div class="pagination">
          <el-pagination
            v-model:current-page="page"
            :page-size="12"
            :total="total"
            layout="prev, pager, next"
            @current-change="loadData"
          />
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { historyApi } from '../../api/history'

const router = useRouter()
const records = ref([])
const loading = ref(false)
const page = ref(1)
const total = ref(0)

const formatTime = (t) => {
  if (!t) return '-'
  return new Date(t).toLocaleString('zh-CN')
}

const modeLabel = (m) => m === 'txt2img' ? '文生图' : '图生图'
const modeType = (m) => m === 'txt2img' ? '' : 'success'
const statusLabel = (s) => ({ pending: '等待中', running: '生成中', success: '成功', failed: '失败' }[s] || s)
const statusType = (s) => ({ pending: 'info', running: 'warning', success: 'success', failed: 'danger' }[s] || 'info')

const goDetail = (id) => router.push(`/history/${id}`)

const loadData = async () => {
  loading.value = true
  try {
    const res = await historyApi.getList(page.value)
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

.history-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.history-card {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: box-shadow 0.2s;
}

.history-card:hover {
  box-shadow: 0 4px 16px rgba(0,0,0,0.1);
}

.history-thumb {
  height: 180px;
  background: #f5f7fa;
}

.thumb-img {
  width: 100%;
  height: 100%;
}

.thumb-placeholder {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #c0c4cc;
}

.history-info {
  padding: 12px;
}

.info-row {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}

.info-meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #909399;
  margin-bottom: 6px;
}

.info-prompt {
  font-size: 13px;
  color: #555;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pagination {
  margin-top: 20px;
  display: flex;
  justify-content: center;
}
</style>
