import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  ''

const supabaseKey =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  ''

if (!supabaseUrl || !supabaseKey) {
  console.warn('[DB] WARNING: SUPABASE_URL or SUPABASE_SERVICE_KEY not set')
}

// 使用 service_role key，后端绕过 RLS
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false }
})

export default supabase
