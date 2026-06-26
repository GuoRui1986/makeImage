<template>
  <div class="page-container">
    <el-card v-loading="loading">
      <template #header>
        <div class="card-header">
          <span class="card-title">任务详情 #{{ task?.id }}</span>
          <el-button @click="$router.back()">返回</el-button>
        </div>
      </template>

      <template v-if="task">
        <el-descriptions :column="3" border>
          <el-descriptions-item label="模型">{{ task.modelName }}</el-descriptions-item>
          <el-descriptions-item label="模式">{{ task.mode === 'txt2img' ? '文生图' : '图生图' }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="statusType(task.status)">{{ statusLabel(task.status) }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="画面比例">{{ task.aspectRatio }}</el-descriptions-item>
          <el-descriptions-item label="画质">{{ task.quality === 'hd' ? '高清' : '标准' }}</el-descriptions-item>
          <el-descriptions-item label="生成数量">{{ task.imageCount }} 张</el-descriptions-item>
          <el-descriptions-item label="消耗积分">{{ task.pointsCost }}</el-descriptions-item>
          <el-descriptions-item label="创建时间">{{ formatTime(task.createdAt) }}</el-descriptions-item>
          <el-descriptions-item label="完成时间">{{ formatTime(task.finishedAt) }}</el-descriptions-item>
          <el-descriptions-item label="提示词" :span="3">{{ task.prompt }}</el-descriptions-item>
          <el-descriptions-item v-if="task.referenceImage" label="参考图" :span="3">
            <el-image :src="task.referenceImage" fit="contain" style="max-height: 200px" />
          </el-descriptions-item>
          <el-descriptions-item v-if="task.failReason" label="失败原因" :span="3">
            <span style="color: #f56c6c">{{ task.failReason }}</span>
          </el-descriptions-item>
        </el-descriptions>

        <div v-if="task.resultImages?.length > 0" class="result-section">
          <h4>生成结果</h4>
          <div class="result-grid">
            <div v-for="(img, idx) in task.resultImages" :key="idx" class="result-item">
              <el-image
                :src="img"
                fit="contain"
                :preview-src-list="task.resultImages"
                :initial-index="idx"
                preview-teleported
                class="result-image"
              />
              <div class="result-actions">
                <el-button size="small" type="primary" plain @click="downloadImage(img, idx)">
                  <el-icon><Download /></el-icon> 下载
                </el-button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { historyApi } from '../../api/history'

const route = useRoute()
const task = ref(null)
const loading = ref(false)

const formatTime = (t) => t ? new Date(t).toLocaleString('zh-CN') : '-'
const statusLabel = (s) => ({ pending: '等待中', running: '生成中', success: '成功', failed: '失败' }[s] || s)
const statusType = (s) => ({ pending: 'info', running: 'warning', success: 'success', failed: 'danger' }[s] || 'info')

const downloadImage = async (url, index) => {
  try {
    const resp = await fetch(url)
    const blob = await resp.blob()
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `ai-image-task${task.value.id}-${index + 1}.png`
    link.click()
    URL.revokeObjectURL(link.href)
  } catch {
    window.open(url, '_blank')
  }
}

const loadData = async () => {
  loading.value = true
  try {
    const res = await historyApi.getDetail(route.params.id)
    const raw = res.data
    // 后端返回 snake_case 字段，前端转 camelCase
    task.value = {
      ...raw,
      modelName: raw.model || raw.modelName || raw.model_name,
      mode: raw.mode || 'txt2img',
      aspectRatio: raw.size || raw.aspectRatio || raw.aspect_ratio,
      quality: raw.quality || 'standard',
      imageCount: raw.count || raw.imageCount || raw.image_count || 1,
      pointsCost: raw.points_cost || raw.pointsCost || 0,
      createdAt: raw.created_at || raw.createdAt,
      finishedAt: raw.completed_at || raw.finishedAt || raw.finished_at,
      referenceImage: raw.reference_image || raw.referenceImageUrl || raw.referenceImageUrl,
      resultImages: raw.images || raw.result_images || (raw.resultImages ? raw.resultImages : []),
      failReason: raw.fail_reason || raw.failReason,
      status: raw.status
    }
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

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.result-section {
  margin-top: 24px;
}

.result-section h4 {
  margin-bottom: 16px;
  color: #333;
}

.result-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 16px;
}

.result-item {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  overflow: hidden;
}

.result-image {
  width: 100%;
  height: 220px;
  display: block;
}

.result-actions {
  padding: 8px;
  text-align: center;
  background: #fafafa;
}
</style>
