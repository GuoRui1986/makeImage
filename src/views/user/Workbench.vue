<template>
  <div class="workbench">
    <el-row :gutter="20">
      <!-- 左侧：参数配置 -->
      <el-col :span="10">
        <el-card>
          <template #header>
            <span class="card-title">参数配置</span>
          </template>

          <!-- 模型选择 -->
          <el-form label-position="top">
            <el-form-item label="选择模型">
              <el-select v-model="config.modelName" style="width: 100%" @change="onModelChange">
                <el-option
                  v-for="m in modelOptions"
                  :key="m.name"
                  :label="m.label + (m.available ? '' : '（开发中）')"
                  :value="m.name"
                  :disabled="!m.available"
                />
              </el-select>
              <div v-if="currentModelPoints" class="price-hint">
                单张消耗 {{ currentModelPoints }} 积分{{ config.mode === 'img2img' ? ` + ${i2iExtra} 图生图` : '' }}
              </div>
            </el-form-item>

            <!-- 生成模式 -->
            <el-form-item label="生成模式">
              <el-radio-group v-model="config.mode">
                <el-radio-button value="txt2img">文生图</el-radio-button>
                <el-radio-button value="img2img">图生图</el-radio-button>
              </el-radio-group>
            </el-form-item>

            <!-- 图生图：参考图上传 -->
            <el-form-item v-if="config.mode === 'img2img'" label="参考图">
              <el-upload
                class="ref-upload"
                :show-file-list="false"
                :auto-upload="true"
                :http-request="handleRefUpload"
                accept="image/*"
              >
                <div v-if="config.referenceImageUrl" class="ref-preview">
                  <img :src="config.referenceImageUrl" alt="参考图" />
                </div>
                <el-button v-else type="primary" plain :loading="uploading">
                  <el-icon><Upload /></el-icon> 上传参考图
                </el-button>
              </el-upload>
            </el-form-item>

            <!-- 提示词 -->
            <el-form-item label="提示词">
              <el-input
                v-model="config.prompt"
                type="textarea"
                :rows="4"
                placeholder="描述你想生成的图片，建议用英文效果更好"
              />
            </el-form-item>

            <!-- 画面比例 -->
            <el-form-item label="画面比例">
              <el-radio-group v-model="config.aspectRatio">
                <el-radio-button v-for="r in ratios" :key="r" :value="r">{{ r }}</el-radio-button>
              </el-radio-group>
            </el-form-item>

            <!-- 画质 -->
            <el-form-item label="画质">
              <el-radio-group v-model="config.quality">
                <el-radio-button value="standard">标准</el-radio-button>
                <el-radio-button value="hd">高清</el-radio-button>
              </el-radio-group>
            </el-form-item>

            <!-- 生成数量 -->
            <el-form-item label="生成数量">
              <el-radio-group v-model="config.imageCount">
                <el-radio-button :value="1">1 张</el-radio-button>
                <el-radio-button :value="2">2 张</el-radio-button>
                <el-radio-button :value="4">4 张</el-radio-button>
              </el-radio-group>
            </el-form-item>

            <!-- 总消耗提示 -->
            <el-form-item>
              <el-alert type="info" :closable="false">
                <template #title>
                  本次生成 {{ config.imageCount }} 张，预计消耗 <strong style="color:#e6a23c">{{ totalCost }}</strong> 积分
                </template>
              </el-alert>
            </el-form-item>

            <!-- 提交按钮 -->
            <el-form-item>
              <el-button
                type="primary"
                size="large"
                style="width: 100%"
                :loading="generating"
                :disabled="!canSubmit"
                @click="handleGenerate"
              >
                <el-icon><MagicStick /></el-icon>
                开始生成
              </el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>

      <!-- 右侧：结果展示 -->
      <el-col :span="14">
        <el-card>
          <template #header>
            <div class="card-header">
              <span class="card-title">生成结果</span>
              <el-tag v-if="generating" type="warning" effect="dark">
                <el-icon class="is-loading"><Loading /></el-icon>
                生成中... {{ progressText }}
              </el-tag>
            </div>
          </template>

          <!-- 空状态 -->
          <el-empty v-if="resultImages.length === 0 && !generating" description="还没有生成结果" />

          <!-- 加载中 -->
          <div v-if="generating" class="generating-grid">
            <div v-for="i in config.imageCount" :key="i" class="generating-item">
              <el-skeleton animated>
                <template #template>
                  <el-skeleton-item variant="image" style="width: 100%; height: 200px" />
                </template>
              </el-skeleton>
            </div>
          </div>

          <!-- 结果图片 -->
          <div v-if="resultImages.length > 0" class="result-grid">
            <div v-for="(img, idx) in resultImages" :key="idx" class="result-item">
              <el-image
                :src="img"
                fit="contain"
                :preview-src-list="resultImages"
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

          <!-- 失败提示 -->
          <el-result
            v-if="generateFailed"
            icon="error"
            title="生成失败"
            :sub-title="failReason"
          />
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { taskApi } from '../../api/tasks'
import { useAuthStore } from '../../stores/auth'

const authStore = useAuthStore()

const ratios = ['1:1', '3:4', '4:3', '9:16', '16:9']

const config = reactive({
  modelName: 'image2',
  mode: 'txt2img',
  prompt: '',
  aspectRatio: '1:1',
  quality: 'standard',
  imageCount: 1,
  referenceImageUrl: ''
})

const modelOptions = ref([
  { name: 'image2', label: 'image2', available: true },
  { name: 'banana', label: 'banana', available: true },
  { name: 'seedream', label: 'seedream', available: false }
])

const pricingData = ref({ pricing: {}, i2iExtra: 0 })

const generating = ref(false)
const generateFailed = ref(false)
const failReason = ref('')
const resultImages = ref([])
const uploading = ref(false)
const progressText = ref('')
const pollTimer = ref(null)

const currentModelPoints = computed(() => {
  const modelPricing = pricingData.value.pricing[config.modelName]
  if (!modelPricing) return null
  return modelPricing[config.quality]
})

const totalCost = computed(() => {
  if (!currentModelPoints.value) return 0
  const perImage = currentModelPoints.value + (config.mode === 'img2img' ? pricingData.value.i2iExtra : 0)
  return (perImage * config.imageCount).toFixed(2)
})

const canSubmit = computed(() => {
  if (generating.value) return false
  if (!config.prompt.trim()) return false
  if (config.mode === 'img2img' && !config.referenceImageUrl) return false
  return true
})

const onModelChange = () => {
  resultImages.value = []
  generateFailed.value = false
}

const loadPricing = async () => {
  try {
    const res = await taskApi.getPricing()
    pricingData.value = res.data
  } catch {
    // ignore
  }
}

const handleRefUpload = async (options) => {
  uploading.value = true
  try {
    const file = options.file
    // 转成 base64 发给后端，后端上传到 Supabase Storage
    const reader = new FileReader()
    reader.onload = async () => {
      const base64 = reader.result.split(',')[1]
      try {
        const res = await taskApi.uploadRef({
          image: 'data:image/' + (file.type.includes('png') ? 'png' : 'jpeg') + ';base64,' + base64,
          imageBase64: base64,
          filename: file.name
        })
        if (res.data?.url) {
          config.referenceImageUrl = res.data.url
          ElMessage.success('参考图上传成功')
        } else {
          throw new Error('服务器未返回URL')
        }
      } catch (err) {
        ElMessage.warning('参考图上传失败，请重试')
      } finally {
        uploading.value = false
      }
    }
    reader.onerror = () => {
      ElMessage.warning('图片读取失败')
      uploading.value = false
    }
    reader.readAsDataURL(file)
  } catch (err) {
    ElMessage.warning('参考图上传失败，请重试')
    uploading.value = false
  }
}

const handleGenerate = async () => {
  try {
    await ElMessageBox.confirm(
      `本次生成 ${config.imageCount} 张，预计消耗 ${totalCost.value} 积分，确认生成？`,
      '确认生成',
      { confirmButtonText: '确认', cancelButtonText: '取消', type: 'info' }
    )
  } catch {
    return
  }

  generating.value = true
  generateFailed.value = false
  resultImages.value = []

  try {
    const res = await taskApi.create({
      model: config.modelName,
      modelName: config.modelName,
      prompt: config.prompt,
      size: config.aspectRatio,
      aspectRatio: config.aspectRatio,
      quality: config.quality,
      count: config.imageCount,
      imageCount: config.imageCount,
      referenceImageUrl: config.referenceImageUrl || undefined,
      refImageUrl: config.referenceImageUrl || undefined
    })

    const taskId = res.data.task_id || res.data.taskId
    progressText.value = '任务已提交...'

    // 开始轮询
    startPolling(taskId)
  } catch (err) {
    generating.value = false
    generateFailed.value = true
    failReason.value = err.message || '提交任务失败'
  }
}

const startPolling = (taskId) => {
  if (pollTimer.value) clearInterval(pollTimer.value)

  const poll = async () => {
    try {
      const res = await taskApi.getStatus(taskId)
      const data = res.data
      // 后端返回 [{task_id, status, image_url/error}] 数组格式
      const results = Array.isArray(data) ? data : (data.results || [data])

      const successItems = results.filter(r => r.status === 'success')
      const failedItems = results.filter(r => r.status === 'failed')
      const pendingItems = results.filter(r => r.status === 'pending')

      if (pendingItems.length === 0) {
        clearInterval(pollTimer.value)
        pollTimer.value = null
        generating.value = false

        if (successItems.length > 0) {
          resultImages.value = successItems.map(r => r.image_url || r.imageUrl).filter(Boolean)
          ElMessage.success(`生成完成，成功 ${successItems.length} 张`)
        }

        if (failedItems.length > 0) {
          generateFailed.value = successItems.length === 0
          failReason.value = failedItems.map(r => r.error || r.failReason || '生成失败').join('; ')
          ElMessage.error(`部分图片生成失败：${failReason.value}`)
        }

        authStore.refreshPoints()
      } else {
        progressText.value = `成功 ${successItems.length} / 失败 ${failedItems.length} / 等待 ${pendingItems.length}`
      }
    } catch {
      // 轮询出错不中断，继续重试
    }
  }

  poll() // 立即执行一次
  pollTimer.value = setInterval(poll, 3000)
}

const downloadImage = async (url, index) => {
  try {
    const resp = await fetch(url)
    const blob = await resp.blob()
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `ai-image-${Date.now()}-${index + 1}.png`
    link.click()
    URL.revokeObjectURL(link.href)
  } catch {
    // 如果跨域无法 fetch，直接打开新窗口
    window.open(url, '_blank')
  }
}

onMounted(() => {
  loadPricing()
  authStore.refreshPoints()
})
</script>

<style scoped>
.workbench {
  max-width: 1200px;
  margin: 0 auto;
}

.card-title {
  font-size: 16px;
  font-weight: 600;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.price-hint {
  margin-top: 4px;
  font-size: 13px;
  color: #909399;
}

.ref-upload {
  width: 100%;
}

.ref-preview {
  width: 100%;
  max-height: 200px;
  overflow: hidden;
  border-radius: 8px;
}

.ref-preview img {
  width: 100%;
  height: auto;
  display: block;
}

.result-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.generating-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
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
