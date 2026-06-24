-- ============================================
-- AI 生图工具 - Supabase 数据库初始化脚本
-- 使用方法：在 Supabase 控制台 → SQL Editor → New Query
-- 粘贴本文件全部内容，点 Run 执行
-- ============================================

-- 启用 pgcrypto 扩展（用于密码哈希）
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================
-- 1. 建表
-- ============================================

-- 普通用户表
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  points_balance DECIMAL(10,2) DEFAULT 0,
  status SMALLINT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

-- 管理员表
CREATE TABLE IF NOT EXISTS admin_users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 积分定价配置表
CREATE TABLE IF NOT EXISTS points_config (
  id SERIAL PRIMARY KEY,
  model_name TEXT NOT NULL,
  quality TEXT,
  points_per_image DECIMAL(10,2) NOT NULL,
  UNIQUE(model_name, quality)
);

-- 积分流水表
CREATE TABLE IF NOT EXISTS points_records (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount DECIMAL(10,2) NOT NULL,
  balance_after DECIMAL(10,2) NOT NULL,
  type TEXT NOT NULL,
  related_task_id INTEGER,
  remark TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_points_records_user ON points_records(user_id);
CREATE INDEX IF NOT EXISTS idx_points_records_created ON points_records(created_at DESC);

-- 生图任务表
CREATE TABLE IF NOT EXISTS image_tasks (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  model_name TEXT NOT NULL,
  mode TEXT NOT NULL,
  prompt TEXT,
  aspect_ratio TEXT,
  quality TEXT,
  image_count INTEGER DEFAULT 1,
  reference_image TEXT,
  points_cost DECIMAL(10,2) DEFAULT 0,
  status TEXT DEFAULT 'pending',
  result_images TEXT,
  fail_reason TEXT,
  duomi_task_ids TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_image_tasks_user ON image_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_image_tasks_status ON image_tasks(status);
CREATE INDEX IF NOT EXISTS idx_image_tasks_created ON image_tasks(created_at DESC);

-- 系统配置表
CREATE TABLE IF NOT EXISTS system_config (
  id SERIAL PRIMARY KEY,
  config_key TEXT UNIQUE NOT NULL,
  config_value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 2. 存储过程（事务操作）
-- ============================================

-- 预扣积分
CREATE OR REPLACE FUNCTION deduct_points(p_user_id INT, p_amount DECIMAL, p_task_id INT)
RETURNS DECIMAL AS $$
DECLARE
  v_balance DECIMAL;
  v_new_balance DECIMAL;
BEGIN
  SELECT points_balance INTO v_balance FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '用户不存在'; END IF;
  IF v_balance < p_amount THEN RAISE EXCEPTION '积分不足'; END IF;
  v_new_balance := v_balance - p_amount;
  UPDATE users SET points_balance = v_new_balance WHERE id = p_user_id;
  INSERT INTO points_records (user_id, amount, balance_after, type, related_task_id, remark)
  VALUES (p_user_id, -p_amount, v_new_balance, 'generate_deduct', p_task_id, '生图预扣积分');
  RETURN v_new_balance;
END;
$$ LANGUAGE plpgsql;

-- 返还积分
CREATE OR REPLACE FUNCTION refund_points(p_user_id INT, p_amount DECIMAL, p_task_id INT)
RETURNS DECIMAL AS $$
DECLARE
  v_balance DECIMAL;
  v_new_balance DECIMAL;
BEGIN
  SELECT points_balance INTO v_balance FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '用户不存在'; END IF;
  v_new_balance := v_balance + p_amount;
  UPDATE users SET points_balance = v_new_balance WHERE id = p_user_id;
  INSERT INTO points_records (user_id, amount, balance_after, type, related_task_id, remark)
  VALUES (p_user_id, p_amount, v_new_balance, 'fail_refund', p_task_id, '生成失败返还积分');
  RETURN v_new_balance;
END;
$$ LANGUAGE plpgsql;

-- 管理员调整积分
CREATE OR REPLACE FUNCTION admin_adjust_points(p_user_id INT, p_amount DECIMAL, p_remark TEXT)
RETURNS DECIMAL AS $$
DECLARE
  v_balance DECIMAL;
  v_new_balance DECIMAL;
BEGIN
  SELECT points_balance INTO v_balance FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '用户不存在'; END IF;
  v_new_balance := v_balance + p_amount;
  IF v_new_balance < 0 THEN RAISE EXCEPTION '调整后余额不能为负数'; END IF;
  UPDATE users SET points_balance = v_new_balance WHERE id = p_user_id;
  INSERT INTO points_records (user_id, amount, balance_after, type, remark)
  VALUES (p_user_id, p_amount, v_new_balance, 'admin_add', COALESCE(p_remark, '管理员调整积分'));
  RETURN v_new_balance;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 3. Storage RLS 策略（允许上传到 bucket）
-- ============================================

-- 允许所有人读取 public bucket 的文件
CREATE POLICY "Public read access" ON storage.objects
  FOR SELECT USING (bucket_id = 'guo rui');

-- 允许所有人上传到 bucket（内部工具，安全要求不高）
CREATE POLICY "Public upload access" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'guo rui');

-- 允许更新（用于 upsert）
CREATE POLICY "Public update access" ON storage.objects
  FOR UPDATE USING (bucket_id = 'guo rui');

-- ============================================
-- 4. 初始化数据
-- ============================================

-- 默认管理员（admin / admin123）
INSERT INTO admin_users (username, password_hash)
SELECT 'admin', crypt('admin123', gen_salt('bf', 10))
WHERE NOT EXISTS (SELECT 1 FROM admin_users WHERE username = 'admin');

-- 管理员同步到 users 表（用于积分、生图等业务，不指定 id 让 SERIAL 自增）
INSERT INTO users (username, password_hash, points_balance, status)
SELECT username, password_hash, 999999, 1
FROM admin_users WHERE username = 'admin'
AND NOT EXISTS (SELECT 1 FROM users WHERE username = 'admin');

-- 默认积分定价
INSERT INTO points_config (model_name, quality, points_per_image)
SELECT * FROM (VALUES
  ('image2', 'standard', 2.0),
  ('image2', 'hd', 5.0),
  ('banana', 'standard', 1.5),
  ('banana', 'hd', 4.0),
  ('seedream', 'standard', 3.0),
  ('seedream', 'hd', 7.0),
  ('i2i_extra', NULL, 0.5)
) AS t(model_name, quality, points_per_image)
WHERE NOT EXISTS (SELECT 1 FROM points_config LIMIT 1);

-- 默认系统配置
INSERT INTO system_config (config_key, config_value)
SELECT 'duomi_api_key', 'jvYFzQbgYvaMhwqp5vdRopjJFt'
WHERE NOT EXISTS (SELECT 1 FROM system_config WHERE config_key = 'duomi_api_key');

INSERT INTO system_config (config_key, config_value)
SELECT 'duomi_base_url', 'https://duomiapi.com'
WHERE NOT EXISTS (SELECT 1 FROM system_config WHERE config_key = 'duomi_base_url');

-- ============================================
-- 完成！
-- ============================================
