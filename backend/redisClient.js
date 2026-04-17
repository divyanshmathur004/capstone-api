const { createClient } = require("redis");
require("dotenv").config();

const client = createClient({
  url: process.env.REDIS_URL,
  socket: {
    reconnectStrategy: () => false,
  },
});

client.on("error", (err) => console.log("Redis Error", err.message));

(async () => {
  try {
    await client.connect();
    console.log("Redis Connected");
  } catch (err) {
    console.log("Redis unavailable, continuing without cache/rate-limit backing", err.message);
  }
})();

module.exports = client;