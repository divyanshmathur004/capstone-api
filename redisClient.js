const { createClient } = require("redis");
require("dotenv").config();

const redisUrl = process.env.REDIS_URL;
let client;

if (!redisUrl) {
  client = {
    async get() {
      return null;
    },
    async setEx() {
      return null;
    },
  };
  console.log("⚠️ REDIS_URL not set, cache disabled");
} else {
  client = createClient({
    url: redisUrl,
  });

  client.on("error", (err) => console.log("Redis Error", err));

  client.connect()
    .then(() => {
      console.log("✅ Redis Connected");
    })
    .catch((err) => {
      console.log("⚠️ Redis connect failed, cache disabled", err.message);
    });
}

module.exports = client;
