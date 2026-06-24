/**
 * 本地开发服务器 - 模拟 IGA Pages Functions 运行时
 * 用于本地开发调试，生产环境由 IGA Pages 托管，不需要此文件
 */
import app from '../api/[[default]].js'

const PORT = process.env.SERVER_PORT || 3001

app.listen(PORT, () => {
  console.log(`[DEV] Server running at http://localhost:${PORT}`)
  console.log(`[DEV] API base: http://localhost:${PORT}/api`)
})
