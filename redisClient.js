const { createClient } = require("redis");
require("dotenv").config();

const redisUrl = process.env.REDIS_URL;
let redisClient;
let isReady = false;

if (!redisUrl) {
  console.log("⚠️ REDIS_URL not set, cache disabled");
} else {
  redisClient = createClient({
    url: redisUrl,
  });

  redisClient.on("ready", () => {
    isReady = true;
    console.log("✅ Redis Connected");
  });
  redisClient.on("end", () => {
    isReady = false;
  });
  redisClient.on("error", (err) => {
    isReady = false;
    console.log("Redis Error", err.message);
  });

  redisClient.connect()
    .catch((err) => {
      console.log("⚠️ Redis connect failed, cache disabled", err.message);
      isReady = false;
    });
}

module.exports = {
  async get(key) {
    if (!redisClient || !isReady) {
      return null;
    }

    try {
      return await redisClient.get(key);
    } catch (err) {
      console.log("⚠️ Redis get failed, cache bypassed", err.message);
      return null;
    }
  },

  async setEx(key, ttl, value) {
    if (!redisClient || !isReady) {
      return null;
    }

    try {
      return await redisClient.setEx(key, ttl, value);
    } catch (err) {
      console.log("⚠️ Redis set failed, cache bypassed", err.message);
      return null;
    }
  },
};
