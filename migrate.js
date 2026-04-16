require("dotenv").config();
const pool = require("./db");

async function migrate() {
  console.log("🚀 Running migrations...");

  // 1. Add plan column to users (with CHECK constraint)
  await pool.query(`
    ALTER TABLE users 
    ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free'
    CHECK (plan IN ('free','premium','enterprise'));
  `);
  console.log("✅ users.plan column added");

  // 2. Create api_keys table (separate from users — 1 user → many keys)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id               SERIAL PRIMARY KEY,
      user_id          INTEGER REFERENCES users(id) ON DELETE CASCADE,
      api_key          TEXT UNIQUE NOT NULL,
      api_secret_hash  TEXT NOT NULL,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log("✅ api_keys table created");

  // 3. Create api_logs table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_logs (
      id          BIGSERIAL PRIMARY KEY,
      api_key     TEXT NOT NULL,
      endpoint    TEXT NOT NULL,
      method      TEXT NOT NULL,
      status_code INTEGER,
      response_ms INTEGER,
      ip          TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log("✅ api_logs table created");

  console.log("🎉 All migrations complete!");
  process.exit(0);
}

migrate().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
