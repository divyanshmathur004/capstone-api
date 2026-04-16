const { createClient } = require("redis");
require("dotenv").config();

const client = createClient({
  url: process.env.REDIS_URL,
});

// Explicit error handler to prevent crashing
client.on("error", (err) => {
  console.error("❌ Redis Error:", err.message);
});

(async () => {
  try {
    await client.connect();
    console.log("✅ Redis Connected");
  } catch (err) {
    console.error("❌ Redis Connection Failed. Service will dynamically fallback to DB/un-cached mode.");
  }
})();

module.exports = client;