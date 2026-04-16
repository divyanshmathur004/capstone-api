const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    // Neon requires SSL. Use verify-full in production with a proper CA cert.
    rejectUnauthorized: false,
  },
  // Connection pool tuning — prevents DB overload under concurrent traffic
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("Unexpected DB pool error:", err.message);
});

module.exports = pool;