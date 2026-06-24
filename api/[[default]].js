import express from 'express'
import cors from 'cors'

// 路由
import authRoutes from '../server/routes/auth.js'
import taskRoutes from '../server/routes/tasks.js'
import pointsRoutes from '../server/routes/points.js'
import historyRoutes from '../server/routes/history.js'
import adminUserRoutes from '../server/routes/admin/users.js'
import adminPricingRoutes from '../server/routes/admin/pricing.js'
import adminRecordRoutes from '../server/routes/admin/records.js'
import adminSettingRoutes from '../server/routes/admin/settings.js'

const app = express()

// 中间件
app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// 静态文件（开发模式下不需要，生产由 IGA Pages 处理）
// app.use(express.static('dist'))

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ code: 200, data: { status: 'ok', time: new Date().toISOString() }, message: '服务正常' })
})

// 路由挂载
app.use('/api/auth', authRoutes)
app.use('/api/tasks', taskRoutes)
app.use('/api/points', pointsRoutes)
app.use('/api/history', historyRoutes)
app.use('/api/admin/users', adminUserRoutes)
app.use('/api/admin/pricing', adminPricingRoutes)
app.use('/api/admin/records', adminRecordRoutes)
app.use('/api/admin/settings', adminSettingRoutes)

// 全局错误处理
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message)
  res.status(err.status || 500).json({
    code: err.status || 500,
    data: null,
    message: err.message || '服务器内部错误'
  })
})

// 404
app.use((req, res) => {
  res.status(404).json({ code: 404, data: null, message: '接口不存在' })
})

export default app
