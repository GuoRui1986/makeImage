import pg from 'pg'
import bcrypt from 'bcryptjs'

const { Pool } = pg

const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL

if (!connectionString) {
  console.error('[INIT] DATABASE_URL not set. Please configure .env file.')
  process.exit(1)
}

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('supabase.co')
    ? { rejectUnauthorized: false }
    : false
})

async function initDatabase() {
  const client = await pool.connect()
  try {
    console.log('[INIT] Creating tables...')

    // 1. 普通用户表
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        points_balance DECIMAL(10,2) DEFAULT 0,
        status SMALLINT DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_login_at TIMESTAMPTZ
      )
    `)

    // 2. 管理员表
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    // 3. 积分定价配置表
    await client.query(`
      CREATE TABLE IF NOT EXISTS points_config (
        id SERIAL PRIMARY KEY,
        model_name TEXT NOT NULL,
        quality TEXT,
        points_per_image DECIMAL(10,2) NOT NULL,
        UNIQUE(model_name, quality)
      )
    `)

    // 4. 积分流水表
    await client.query(`
      CREATE TABLE IF NOT EXISTS points_records (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        amount DECIMAL(10,2) NOT NULL,
        balance_after DECIMAL(10,2) NOT NULL,
        type TEXT NOT NULL,
        related_task_id INTEGER,
        remark TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_points_records_user ON points_records(user_id)`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_points_records_created ON points_records(created_at DESC)`)

    // 5. 生图任务表
    await client.query(`
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
      )
    `)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_image_tasks_user ON image_tasks(user_id)`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_image_tasks_status ON image_tasks(status)`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_image_tasks_created ON image_tasks(created_at DESC)`)

    // 6. 系统配置表
    await client.query(`
      CREATE TABLE IF NOT EXISTS system_config (
        id SERIAL PRIMARY KEY,
        config_key TEXT UNIQUE NOT NULL,
        config_value TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    console.log('[INIT] Tables created.')

    // 初始化默认管理员
    const adminExists = await client.query('SELECT id FROM admin_users WHERE username = $1', ['admin'])
    if (adminExists.rows.length === 0) {
      const hash = await bcrypt.hash('admin123', 10)
      await client.query(
        'INSERT INTO admin_users (username, password_hash) VALUES ($1, $2)',
        ['admin', hash]
      )
      console.log('[INIT] Default admin created: admin / admin123')
    } else {
      console.log('[INIT] Admin already exists, skipping.')
    }

    // 初始化默认积分定价
    const pricingExists = await client.query('SELECT id FROM points_config LIMIT 1')
    if (pricingExists.rows.length === 0) {
      const defaults = [
        ['image2', 'standard', 2],
        ['image2', 'hd', 5],
        ['banana', 'standard', 1.5],
        ['banana', 'hd', 4],
        ['seedream', 'standard', 3],
        ['seedream', 'hd', 7],
        ['i2i_extra', null, 0.5]
      ]
      for (const [model, quality, points] of defaults) {
        await client.query(
          'INSERT INTO points_config (model_name, quality, points_per_image) VALUES ($1, $2, $3)',
          [model, quality, points]
        )
      }
      console.log('[INIT] Default pricing config created.')
    } else {
      console.log('[INIT] Pricing config already exists, skipping.')
    }

    // 初始化默认系统配置
    const configExists = await client.query("SELECT id FROM system_config WHERE config_key = 'duomi_api_key'")
    if (configExists.rows.length === 0) {
      await client.query(
        "INSERT INTO system_config (config_key, config_value) VALUES ($1, $2)",
        ['duomi_api_key', process.env.DUOMI_API_KEY || '']
      )
      await client.query(
        "INSERT INTO system_config (config_key, config_value) VALUES ($1, $2)",
        ['duomi_base_url', 'https://duomiapi.com']
      )
      console.log('[INIT] Default system config created.')
    }

    console.log('[INIT] Database initialization complete.')
  } catch (err) {
    console.error('[INIT] Error:', err.message)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

initDatabase()
