require("dotenv").config();
const pool = require("./db");

async function cleanupOldLogs() {
  console.log("🧹 Starting API logs cleanup job...");
  try {
    const result = await pool.query(`
      DELETE FROM api_logs
      WHERE created_at < NOW() - INTERVAL '7 days';
    `);
    console.log(`✅ Cleanup complete. Deleted ${result.rowCount} old log records.`);
  } catch (err) {
    console.error("❌ Error during cleanup:", err.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

cleanupOldLogs();
