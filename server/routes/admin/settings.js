import express from 'express'
import bcrypt from 'bcryptjs'
import { authRequired, adminRequired } from '../../middleware/auth.js'
import { success, error } from '../../utils/response.js'
import { supabase } from '../../db/index.js'

const router = express.Router()

/**
 * GET /api/admin/settings
 */
router.get('/', authRequired, adminRequired, async (req, res) => {
  try {
    const { data: configs } = await supabase
      .from('system_config')
      .select('config_key, config_value')

    const settings = {}
    for (const c of configs || []) {
      if (c.config_key === 'duomi_api_key' && c.config_value) {
        const key = c.config_value
        settings[c.config_key] = key.slice(0, 4) + '****' + key.slice(-4)
        settings.duomi_api_key_configured = true
      } else {
        settings[c.config_key] = c.config_value
      }
    }
    res.json(success({ settings }))
  } catch (err) {
    res.status(500).json(error(err.message))
  }
})

/**
 * PUT /api/admin/settings/api
 */
router.put('/api', authRequired, adminRequired, async (req, res) => {
  try {
    const { duomiApiKey, duomiBaseUrl } = req.body

    if (duomiApiKey && !duomiApiKey.includes('****')) {
      // upsert
      const { data: existing } = await supabase
        .from('system_config')
        .select('id')
        .eq('config_key', 'duomi_api_key')
        .single()

      if (existing) {
        await supabase
          .from('system_config')
          .update({ config_value: duomiApiKey, updated_at: new Date().toISOString() })
          .eq('config_key', 'duomi_api_key')
      } else {
        await supabase
          .from('system_config')
          .insert({ config_key: 'duomi_api_key', config_value: duomiApiKey })
      }
    }

    if (duomiBaseUrl) {
      const { data: existing } = await supabase
        .from('system_config')
        .select('id')
        .eq('config_key', 'duomi_base_url')
        .single()

      if (existing) {
        await supabase
          .from('system_config')
          .update({ config_value: duomiBaseUrl, updated_at: new Date().toISOString() })
          .eq('config_key', 'duomi_base_url')
      } else {
        await supabase
          .from('system_config')
          .insert({ config_key: 'duomi_base_url', config_value: duomiBaseUrl })
      }
    }

    res.json(success(null, 'API配置已更新'))
  } catch (err) {
    res.status(500).json(error(err.message))
  }
})

/**
 * PUT /api/admin/settings/password
 */
router.put('/password', authRequired, adminRequired, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body
    if (!newPassword?.trim()) return res.status(400).json(error('新密码不能为空'))
    if (newPassword.length < 6) return res.status(400).json(error('密码至少6个字符'))

    const { data: admin } = await supabase
      .from('admin_users')
      .select('password_hash')
      .eq('id', req.user.id)
      .single()
    if (!admin) return res.status(404).json(error('管理员账号不存在'))

    const valid = await bcrypt.compare(oldPassword, admin.password_hash)
    if (!valid) return res.status(400).json(error('原密码错误'))

    const hash = await bcrypt.hash(newPassword, 10)
    await supabase
      .from('admin_users')
      .update({ password_hash: hash })
      .eq('id', req.user.id)

    res.json(success(null, '密码修改成功'))
  } catch (err) {
    res.status(500).json(error(err.message))
  }
})

export default router
