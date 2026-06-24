# AI生图工具（内部轻量版）

浏览器端 AI 生图工具，面向内部小范围使用。多模型 AI 生图 + 积分制计费 + 后台管理。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + Element Plus + Vue Router + Pinia + Vite |
| 后端 | Node.js + Express（IGA Pages Serverless Functions） |
| 数据库 | Supabase (PostgreSQL) — 通过 @supabase/supabase-js |
| 图片存储 | Supabase Storage（参考图上传） |
| 部署 | 火山引擎 IGA Pages |
| AI API | 多米 API（image2 / nano-banana） |

## 目录结构

```
ai-image-tool/
├── api/
│   └── [[default]].js      # Express 应用入口（IGA Pages Functions）
├── server/
│   ├── db/
│   │   └── index.js         # Supabase Client
│   ├── middleware/
│   │   └── auth.js          # JWT 认证中间件
│   ├── routes/
│   │   ├── auth.js          # 登录
│   │   ├── tasks.js         # 生图任务 + 参考图上传
│   │   ├── points.js        # 积分记录
│   │   ├── history.js       # 生成历史
│   │   └── admin/
│   │       ├── users.js     # 用户管理
│   │       ├── pricing.js   # 定价配置
│   │       ├── records.js   # 全局流水+记录
│   │       └── settings.js  # 系统设置
│   ├── services/
│   │   ├── image2.js        # image2 API 封装
│   │   ├── banana.js        # banana API 封装
│   │   └── imageService.js  # 统一生图服务层
│   ├── utils/
│   │   └── response.js      # 统一响应格式
│   └── dev-server.js        # 本地开发服务器
├── src/                      # Vue3 前端源码
├── supabase-schema.sql       # 数据库建表+初始化 SQL（在 Supabase SQL Editor 执行）
├── index.html
├── vite.config.js
├── package.json
└── .env.example
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env`，填写：

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_STORAGE_BUCKET=your-bucket-name
DUOMI_API_KEY=你的多米API密钥
JWT_SECRET=你的JWT密钥
```

### 3. 初始化数据库

在 Supabase 控制台 → SQL Editor → New Query，粘贴 `supabase-schema.sql` 全部内容，点 Run 执行。

这会创建所有数据表、存储过程、Storage 策略，并初始化：
- 默认管理员：`admin` / `admin123`
- 默认积分定价配置
- 系统配置

### 4. 创建 Storage Bucket

在 Supabase 控制台 → Storage → New bucket：
- Bucket name: 与 `.env` 中 `SUPABASE_STORAGE_BUCKET` 一致
- Public bucket: 开启

### 5. 启动开发服务

```bash
npm run dev:all
```

- 前端：http://localhost:5173
- 后端：http://localhost:3001

### 6. 构建生产版本

```bash
npm run build
```

## 部署到火山引擎 IGA Pages

### 1. 准备 Supabase

1. 在火山引擎控制台开通 Supabase 服务
2. 创建新项目
3. 在 SQL Editor 执行 `supabase-schema.sql`
4. 在 Storage 创建 public bucket
5. 在 Settings → API 获取 URL 和 service_role key

### 2. 部署到 IGA Pages

1. 把代码推到 Git 仓库
2. 在 IGA Pages 创建项目，关联仓库
3. 构建配置：
   - 框架：Vue (Vite)
   - 输出目录：`dist`
   - 安装命令：`npm install`
   - 构建命令：`npm run build`
   - Node.js 版本：22.x
4. 环境变量配置：
   - `SUPABASE_URL` = Supabase Project URL
   - `SUPABASE_SERVICE_KEY` = Supabase service_role key
   - `SUPABASE_ANON_KEY` = Supabase anon key
   - `SUPABASE_STORAGE_BUCKET` = Storage bucket 名称
   - `DUOMI_API_KEY` = 多米 API Key
   - `JWT_SECRET` = JWT 密钥
5. 部署完成后，通过 `*.preview.iga-pages.com` 域名访问

## 使用说明

### 默认管理员账号

- 用户名：`admin`
- 密码：`admin123`
- **首次登录后请立即修改密码**

### 支持的模型

| 模型 | 状态 | 说明 |
|------|------|------|
| image2 | 可用 | GPT-Image-2 |
| banana | 可用 | nano-banana-2 (Gemini) |
| seedream | 开发中 | 暂不可用 |

### 积分规则

- 单张积分 = 模型基础积分（按画质）+ 图生图额外积分（仅图生图模式）
- 生成 N 张 = 调用 N 次 API
- 提交时预扣全额积分
- 部分失败按实际失败张数返还
- 全部失败全额返还
