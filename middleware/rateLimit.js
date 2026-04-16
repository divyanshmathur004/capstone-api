const redisClient = require("../redisClient");
const pool = require("../db");

const PLAN_LIMITS = {
  free:       1000,
  premium:    10000,
  enterprise: 100000
};

const rateLimitMiddleware = async (req, res, next) => {
  try {
    const apiKey = req.user?.apiKey;
    if (!apiKey) return next(); // Skip if no API key (e.g. public routes)

    const plan   = req.user?.plan || "free";
    const limit  = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

    // Midnight of today as UNIX timestamp (for X-RateLimit-Reset)
    const resetTime = Math.floor(new Date().setHours(24, 0, 0, 0) / 1000);
    // Unique key per day per user
    const rateKey = `rate_limit:${apiKey}:${resetTime}`;

    let currentCount = 0;

    if (redisClient.isOpen) {
      currentCount = await redisClient.incr(rateKey);
      if (currentCount === 1) {
        // First request of the day, set expiration to a bit over 24h
        await redisClient.expire(rateKey, 86400 + 3600);
      }
    } else {
      // IF REDIS FAILS, silently fallback so API doesn't completely die
      // We will skip rate limiting in fallback mode.
      console.warn("⚠️ Redis unavailable, skipping rate limit check");
    }

    const remaining = Math.max(0, limit - currentCount);

    // Attach to request so that downstream handlers (like route caching) can read it
    req.rateLimit = {
      limit,
      remaining,
      reset: resetTime
    };

    res.set("X-RateLimit-Limit",     String(limit));
    res.set("X-RateLimit-Remaining", String(remaining));
    res.set("X-RateLimit-Reset",     String(resetTime));

    if (currentCount > limit) {
      return res.status(429).json({
        success: false,
        message: `Rate limit exceeded. Your ${plan} plan allows ${limit} requests/day.`,
        rateLimitReset: resetTime
      });
    }

    next();

  } catch (err) {
    console.error("Rate limit error:", err.message);
    // Failsafe: let request through if rate limiter randomly breaks
    next();
  }
};

module.exports = rateLimitMiddleware;