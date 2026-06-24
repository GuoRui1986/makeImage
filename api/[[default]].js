/**
 * 最小测试版本 - 确认 IGA Pages Functions 能否正常部署
 */
import express from 'express'

const app = express()
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ code: 200, data: { status: 'ok', time: new Date().toISOString() }, message: '服务正常' })
})

app.get('/api/test', (_req, res) => {
  res.json({ code: 200, data: { message: 'IGA Pages Functions 测试成功!' } })
})

export default app
