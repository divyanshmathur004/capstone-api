import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const sslDisabled = process.env.PGSSLMODE === "disable" || process.env.DATABASE_SSL === "false";

const pool = new Pool({
  connectionString,
  ssl: sslDisabled
    ? false
    : {
        rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== "false",
      },
  max: Number(process.env.PGPOOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.PGPOOL_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.PGPOOL_CONNECTION_TIMEOUT_MS || 5000),
});

export default pool;
