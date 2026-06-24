-- ============================================
-- 修复脚本：管理员用户记录 & 自增序列修复
-- 在 Supabase SQL Editor 中执行此文件
-- ============================================

-- 1. 删除之前手动插入的错误记录（如果有）
DELETE FROM users WHERE username = 'admin';

-- 2. 重置自增序列
SELECT setval('users_id_seq', (SELECT COALESCE(MAX(id), 0) FROM users));

-- 3. 正确插入管理员到 users 表（不指定 id，让 SERIAL 自动分配）
INSERT INTO users (username, password_hash, points_balance, status)
VALUES (
  'admin',
  (SELECT password_hash FROM admin_users WHERE username = 'admin'),
  999999,
  1
);

-- 验证结果
SELECT id, username, points_balance FROM users;
