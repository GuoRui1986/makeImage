<template>
  <div class="page-container">
    <el-card>
      <template #header>
        <span class="card-title">全局生图记录</span>
      </template>

      <!-- 筛选 -->
      <div class="filter-bar">
        <el-input v-model="filters.username" placeholder="用户名" clearable style="width: 160px" />
        <el-select v-model="filters.modelName" placeholder="模型" clearable style="width: 140px">
          <el-option label="image2" value="image2" />
          <el-option label="banana" value="banana" />
          <el-option label="seedream" value="seedream" />
        </el-select>
        <el-select v-model="filters.status" placeholder="状态" clearable style="width: 120px">
          <el-option label="等待中" value="pending" />
          <el-option label="生成中" value="running" />
          <el-option label="成功" value="success" />
          <el-option label="失败" value="failed" />
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
        <el-table-column prop="model_name" label="模型" width="90" />
        <el-table-column prop="mode" label="模式" width="80">
          <template #default="{ row }">{{ row.mode === 'txt2img' ? '文生图' : '图生图' }}</template>
        </el-table-column>
        <el-table-column prop="image_count" label="数量" width="60" />
        <el-table-column prop="pointsCost" label="消耗积分" width="100" />
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" width="180">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link @click="viewDetail(row.id)">详情</el-button>
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

    <!-- 详情弹窗 -->
    <el-dialog v-model="showDetail" title="任务详情" width="700px">
      <div v-if="detail">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="用户">{{ detail.username }}</el-descriptions-item>
          <el-descriptions-item label="模型">{{ detail.model_name }}</el-descriptions-item>
          <el-descriptions-item label="模式">{{ detail.mode === 'txt2img' ? '文生图' : '图生图' }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ statusLabel(detail.status) }}</el-descriptions-item>
          <el-descriptions-item label="画面比例">{{ detail.aspect_ratio }}</el-descriptions-item>
          <el-descriptions-item label="画质">{{ detail.quality === 'hd' ? '高清' : '标准' }}</el-descriptions-item>
          <el-descriptions-item label="数量">{{ detail.image_count }}</el-descriptions-item>
          <el-descriptions-item label="消耗积分">{{ parseFloat(detail.points_cost) }}</el-descriptions-item>
          <el-descriptions-item label="提示词" :span="2">{{ detail.prompt }}</el-descriptions-item>
          <el-descriptions-item v-if="detail.fail_reason" label="失败原因" :span="2">
            <span style="color: #f56c6c">{{ detail.fail_reason }}</span>
          </el-descriptions-item>
        </el-descriptions>
        <div v-if="detailImages.length > 0" class="detail-images">
          <el-image
            v-for="(img, idx) in detailImages"
            :key="idx"
            :src="img"
            fit="contain"
            :preview-src-list="detailImages"
            :initial-index="idx"
            preview-teleported
            style="width: 200px; height: 200px; border: 1px solid #ebeef5; border-radius: 4px"
          />
        </div>
      </div>
    </el-dialog>
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
const showDetail = ref(false)
const detail = ref(null)
const detailImages = ref([])

const filters = reactive({ username: '', modelName: '', status: '' })

const formatTime = (t) => t ? new Date(t).toLocaleString('zh-CN') : '-'
const statusLabel = (s) => ({ pending: '等待中', running: '生成中', success: '成功', failed: '失败' }[s] || s)
const statusType = (s) => ({ pending: 'info', running: 'warning', success: 'success', failed: 'danger' }[s] || 'info')

const loadData = async () => {
  loading.value = true
  try {
    const params = {
      page: page.value,
      username: filters.username || undefined,
      modelName: filters.modelName || undefined,
      status: filters.status || undefined,
      startDate: dateRange.value?.[0] || undefined,
      endDate: dateRange.value?.[1] || undefined
    }
    const res = await adminApi.getImageRecords(params)
    // 后端返回 list，前端兼容 list/records 两种 key
    const rawList = res.data.list || res.data.records || []
    records.value = rawList.map(item => ({
      ...item,
      username: item.username || '用户',
      image_count: item.count || item.image_count || item.imageCount || 1,
      points_cost: item.points_cost || item.pointsCost || 0,
    }))
    total.value = res.data.total
  } finally {
    loading.value = false
  }
}

const resetFilters = () => {
  filters.username = ''
  filters.modelName = ''
  filters.status = ''
  dateRange.value = null
  page.value = 1
  loadData()
}

const viewDetail = async (id) => {
    const res = await adminApi.getImageRecordDetail(id)
    const raw = res.data
    // 后端返回 snake_case，转 camelCase 用于显示
    detail.value = {
      ...raw,
      images: raw.images || (raw.result_images ? JSON.parse(raw.result_images) : []),
      mode: raw.mode || 'txt2img',
    }
    detailImages.value = detail.value.images || []
    showDetail.value = true
  }

onMounted(loadData)
</script>

<style scoped>
.card-title { font-size: 16px; font-weight: 600; }
.filter-bar { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
.pagination { margin-top: 16px; display: flex; justify-content: center; }
.detail-images { margin-top: 16px; display: flex; gap: 12px; flex-wrap: wrap; }
</style>
