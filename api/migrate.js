require("dotenv").config();
const pool = require("./db");

async function migrate() {
  console.log("Running schema migration...");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS country (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS state (
      id SERIAL PRIMARY KEY,
      country_id INTEGER NOT NULL REFERENCES country(id) ON DELETE RESTRICT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS district (
      id SERIAL PRIMARY KEY,
      state_id INTEGER NOT NULL REFERENCES state(id) ON DELETE RESTRICT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS subdistrict (
      id SERIAL PRIMARY KEY,
      district_id INTEGER NOT NULL REFERENCES district(id) ON DELETE RESTRICT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS village (
      id SERIAL PRIMARY KEY,
      subdistrict_id INTEGER NOT NULL REFERENCES subdistrict(id) ON DELETE RESTRICT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      plan TEXT NOT NULL DEFAULT 'free',
      status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
      full_access BOOLEAN NOT NULL DEFAULT TRUE,
      status_reason TEXT,
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS full_access BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS status_reason TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    CREATE TABLE IF NOT EXISTS api_keys (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key_name TEXT,
      api_key TEXT NOT NULL UNIQUE,
      api_secret_hash TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_name TEXT;
    ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS api_secret_hash TEXT;
    ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
    ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    CREATE TABLE IF NOT EXISTS api_logs (
      id BIGSERIAL PRIMARY KEY,
      api_key_id INTEGER,
      api_key TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      method TEXT NOT NULL,
      status_code INTEGER,
      response_ms INTEGER,
      ip TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE api_logs ADD COLUMN IF NOT EXISTS api_key_id INTEGER;

    CREATE TABLE IF NOT EXISTS user_state_access (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      state_id INTEGER NOT NULL REFERENCES state(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, state_id)
    );

    CREATE INDEX IF NOT EXISTS idx_village_name ON village USING gin (to_tsvector('simple', name));
    CREATE INDEX IF NOT EXISTS idx_village_subdistrict_id ON village (subdistrict_id);
    CREATE INDEX IF NOT EXISTS idx_subdistrict_district_id ON subdistrict (district_id);
    CREATE INDEX IF NOT EXISTS idx_district_state_id ON district (state_id);
    CREATE INDEX IF NOT EXISTS idx_api_logs_created_at ON api_logs (created_at);
    CREATE INDEX IF NOT EXISTS idx_api_logs_api_key ON api_logs (api_key);
    CREATE INDEX IF NOT EXISTS idx_api_logs_api_key_id ON api_logs (api_key_id);
    CREATE INDEX IF NOT EXISTS idx_api_keys_api_key ON api_keys (api_key);

    CREATE INDEX IF NOT EXISTS idx_apikey_key_spec ON api_keys (api_key);
    CREATE INDEX IF NOT EXISTS idx_village_subdistrictid_spec ON village (subdistrict_id);
    CREATE INDEX IF NOT EXISTS idx_district_stateid_spec ON district (state_id);

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_state_country_id') THEN
        ALTER TABLE state
          ADD CONSTRAINT fk_state_country_id
          FOREIGN KEY (country_id) REFERENCES country(id) ON DELETE RESTRICT NOT VALID;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_district_state_id') THEN
        ALTER TABLE district
          ADD CONSTRAINT fk_district_state_id
          FOREIGN KEY (state_id) REFERENCES state(id) ON DELETE RESTRICT NOT VALID;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_subdistrict_district_id') THEN
        ALTER TABLE subdistrict
          ADD CONSTRAINT fk_subdistrict_district_id
          FOREIGN KEY (district_id) REFERENCES district(id) ON DELETE RESTRICT NOT VALID;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_village_subdistrict_id') THEN
        ALTER TABLE village
          ADD CONSTRAINT fk_village_subdistrict_id
          FOREIGN KEY (subdistrict_id) REFERENCES subdistrict(id) ON DELETE RESTRICT NOT VALID;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_state_access_user_id') THEN
        ALTER TABLE user_state_access
          ADD CONSTRAINT fk_user_state_access_user_id
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_state_access_state_id') THEN
        ALTER TABLE user_state_access
          ADD CONSTRAINT fk_user_state_access_state_id
          FOREIGN KEY (state_id) REFERENCES state(id) ON DELETE CASCADE NOT VALID;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_state_code') THEN
        ALTER TABLE state ADD CONSTRAINT uq_state_code UNIQUE (code);
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_district_code') THEN
        ALTER TABLE district ADD CONSTRAINT uq_district_code UNIQUE (code);
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_village_code') THEN
        ALTER TABLE village ADD CONSTRAINT uq_village_code UNIQUE (code);
      END IF;
    END $$;

    DO $$
    BEGIN
      BEGIN
        ALTER TABLE state VALIDATE CONSTRAINT fk_state_country_id;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
      BEGIN
        ALTER TABLE district VALIDATE CONSTRAINT fk_district_state_id;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
      BEGIN
        ALTER TABLE subdistrict VALIDATE CONSTRAINT fk_subdistrict_district_id;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
      BEGIN
        ALTER TABLE village VALIDATE CONSTRAINT fk_village_subdistrict_id;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
      BEGIN
        ALTER TABLE user_state_access VALIDATE CONSTRAINT fk_user_state_access_user_id;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
      BEGIN
        ALTER TABLE user_state_access VALIDATE CONSTRAINT fk_user_state_access_state_id;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END $$;

    CREATE OR REPLACE FUNCTION enforce_max_active_keys()
    RETURNS TRIGGER AS $$
    DECLARE
      active_count INTEGER;
    BEGIN
      IF NEW.is_active THEN
        SELECT COUNT(*) INTO active_count
        FROM api_keys
        WHERE user_id = NEW.user_id
          AND is_active = TRUE
          AND id <> COALESCE(NEW.id, -1);

        IF active_count >= 5 THEN
          RAISE EXCEPTION 'MAX_ACTIVE_KEYS_REACHED';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_enforce_max_active_keys ON api_keys;
    CREATE TRIGGER trg_enforce_max_active_keys
    BEFORE INSERT OR UPDATE OF is_active ON api_keys
    FOR EACH ROW EXECUTE FUNCTION enforce_max_active_keys();
  `);

  console.log("Schema migration complete.");
  await pool.end();
}

migrate().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
