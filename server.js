const express = require("express");
const cors = require("cors");
const { randomUUID } = require("crypto");
const pool = require("./db");
const redisClient = require("./redisClient");
const { generateApiKey, generateApiSecret } = require("./generateApiKey");
const authMiddleware = require("./middleware/auth");
const rateLimitMiddleware = require("./middleware/rateLimit");
const loggerMiddleware = require("./middleware/logger");
const bcrypt = require("bcrypt");

require("dotenv").config();

const app = express();

app.use(cors({
  exposedHeaders: ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"]
}));
app.use(express.json());

const PORT = process.env.PORT || 5000;

// CRITICAL FIX: logger before rateLimit so blocked requests are logged
const protect = [authMiddleware, loggerMiddleware, rateLimitMiddleware];

// In-Memory IP Cooldown specifically applied to /register endpoints to block BOT spam
const registerCooldowns = new Map();

// Helper to inject rate limit headers from req.rateLimit (used during cache hits)
const setRateLimitHeaders = (res, rateLimit) => {
  if (rateLimit) {
    res.set("X-RateLimit-Limit",     String(rateLimit.limit));
    res.set("X-RateLimit-Remaining", String(rateLimit.remaining));
    res.set("X-RateLimit-Reset",     String(rateLimit.reset));
  }
};

// -------------------------------
// ROOT
// -------------------------------
app.get("/", (req, res) => {
  res.json({
    name: "India Geo Data API",
    version: "2.1.0",
    status: "running",
    endpoints: ["/api/v1/states", "/api/v1/districts/:state_code",
                "/api/v1/subdistricts/:district_code", "/api/v1/villages/:subdistrict_code",
                "/api/v1/search", "/api/v1/autocomplete", "/api/v1/usage"]
  });
});

// -------------------------------
// STATES
// -------------------------------
app.get("/api/v1/states", protect, async (req, res) => {
  try {
    const cacheKey = "v2:states";
    let cached;
    try { cached = await redisClient.get(cacheKey); } catch (_) {}
    
    if (cached) {
      setRateLimitHeaders(res, req.rateLimit);
      return res.json(JSON.parse(cached));
    }

    const start = Date.now();
    const result = await pool.query("SELECT id, code, name FROM state ORDER BY name");

    const response = {
      success: true,
      count: result.rows.length,
      data: result.rows,
      meta: {
        requestId: `req_${randomUUID()}`,
        responseTime: Date.now() - start, // Integer MS
        plan: req.user.plan
      }
    };

    try { await redisClient.setEx(cacheKey, 3600, JSON.stringify(response)); } catch (_) {}
    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Error fetching states" });
  }
});

// -------------------------------
// DISTRICTS
// -------------------------------
app.get("/api/v1/districts/:state_code", protect, async (req, res) => {
  try {
    const { state_code } = req.params;
    const cacheKey = `v2:districts:${state_code}`;
    let cached;
    try { cached = await redisClient.get(cacheKey); } catch (_) {}
    
    if (cached) {
      setRateLimitHeaders(res, req.rateLimit);
      return res.json(JSON.parse(cached));
    }

    const start = Date.now();
    const result = await pool.query(
      `SELECT d.id, d.code, d.name
       FROM district d JOIN state s ON d.state_id = s.id
       WHERE s.code = $1 ORDER BY d.name`,
      [state_code]
    );

    const response = {
      success: true,
      count: result.rows.length,
      data: result.rows,
      meta: { requestId: `req_${randomUUID()}`, responseTime: Date.now() - start, plan: req.user.plan }
    };

    try { await redisClient.setEx(cacheKey, 3600, JSON.stringify(response)); } catch (_) {}
    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Error fetching districts" });
  }
});

// -------------------------------
// SUBDISTRICTS
// -------------------------------
app.get("/api/v1/subdistricts/:district_code", protect, async (req, res) => {
  try {
    const { district_code } = req.params;
    const cacheKey = `v2:subdistricts:${district_code}`;
    let cached;
    try { cached = await redisClient.get(cacheKey); } catch (_) {}
    
    if (cached) {
      setRateLimitHeaders(res, req.rateLimit);
      return res.json(JSON.parse(cached));
    }

    const start = Date.now();
    const result = await pool.query(
      `SELECT sd.id, sd.code, sd.name
       FROM subdistrict sd JOIN district d ON sd.district_id = d.id
       WHERE d.code = $1 ORDER BY sd.name`,
      [district_code]
    );

    const response = {
      success: true,
      count: result.rows.length,
      data: result.rows,
      meta: { requestId: `req_${randomUUID()}`, responseTime: Date.now() - start, plan: req.user.plan }
    };

    try { await redisClient.setEx(cacheKey, 3600, JSON.stringify(response)); } catch (_) {}
    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Error fetching subdistricts" });
  }
});

// -------------------------------
// VILLAGES (with pagination)
// -------------------------------
app.get("/api/v1/villages/:subdistrict_code", protect, async (req, res) => {
  try {
    const { subdistrict_code } = req.params;
    const limit  = parseInt(req.query.limit) || 100;
    const page   = parseInt(req.query.page)  || 1;
    const offset = (page - 1) * limit;

    const cacheKey = `v2:villages:${subdistrict_code}:p${page}:l${limit}`;
    let cached;
    try { cached = await redisClient.get(cacheKey); } catch (_) {}
    
    if (cached) {
      setRateLimitHeaders(res, req.rateLimit);
      return res.json(JSON.parse(cached));
    }

    const start = Date.now();
    const result = await pool.query(
      `SELECT v.id, v.code, v.name
       FROM village v JOIN subdistrict sd ON v.subdistrict_id = sd.id
       WHERE sd.code = $1 ORDER BY v.name LIMIT $2 OFFSET $3`,
      [subdistrict_code, limit, offset]
    );

    const response = {
      success: true,
      count: result.rows.length,
      page, limit,
      data: result.rows,
      meta: { requestId: `req_${randomUUID()}`, responseTime: Date.now() - start, plan: req.user.plan }
    };

    try { await redisClient.setEx(cacheKey, 3600, JSON.stringify(response)); } catch (_) {}
    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Error fetching villages" });
  }
});

// -------------------------------
// AUTOCOMPLETE
// -------------------------------
app.get("/api/v1/autocomplete", protect, async (req, res) => {
  try {
    const q = req.query.q;
    // Input Sanitization limit memory overhead / regex spam
    if (!q || q.length < 2) return res.status(400).json({ success: false, message: "Query must be at least 2 characters" });
    if (q.length > 50) return res.status(400).json({ success: false, message: "Query is too long" });

    const cacheKey = `v2:autocomplete:${q.toLowerCase()}`;
    let cached;
    try { cached = await redisClient.get(cacheKey); } catch (_) {}
    
    if (cached) {
      setRateLimitHeaders(res, req.rateLimit);
      return res.json(JSON.parse(cached));
    }

    const start = Date.now();
    const result = await pool.query(
      `SELECT v.code AS value, v.name AS village,
              sd.name AS subdistrict, d.name AS district, s.name AS state,
              CASE WHEN LOWER(v.name) LIKE LOWER($1) THEN 1
                   WHEN LOWER(v.name) LIKE LOWER($2) THEN 2 ELSE 3 END AS rank
       FROM village v
       JOIN subdistrict sd ON v.subdistrict_id = sd.id
       JOIN district d ON sd.district_id = d.id
       JOIN state s ON d.state_id = s.id
       WHERE LOWER(v.name) LIKE LOWER($1) OR LOWER(v.name) LIKE LOWER($2)
       ORDER BY rank, v.name LIMIT 10`,
      [`${q}%`, `%${q}%`]
    );

    const formatted = result.rows.map(row => ({
      value: row.value,
      label: row.village,
      fullAddress: `${row.village}, ${row.subdistrict}, ${row.district}, ${row.state}, India`,
      hierarchy: { village: row.village, subDistrict: row.subdistrict, district: row.district, state: row.state, country: "India" }
    }));

    const response = {
      success: true,
      count: formatted.length,
      data: formatted,
      meta: { requestId: `req_${randomUUID()}`, responseTime: Date.now() - start, plan: req.user.plan }
    };

    // TTL reduced to 300s since queries vary wildly; prevents memory explosion
    try { await redisClient.setEx(cacheKey, 300, JSON.stringify(response)); } catch (_) {}
    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Error in autocomplete" });
  }
});

// -------------------------------
// SEARCH
// -------------------------------
app.get("/api/v1/search", protect, async (req, res) => {
  try {
    const { q, state } = req.query;
    // Sanitization
    if (!q || q.length < 2) return res.status(400).json({ success: false, message: "Query must be at least 2 characters" });
    if (q.length > 50) return res.status(400).json({ success: false, message: "Query is too long" });

    const limit  = parseInt(req.query.limit) || 20;
    const page   = parseInt(req.query.page)  || 1;
    const offset = (page - 1) * limit;

    const cacheKey = `v2:search:${q.toLowerCase()}:${state || "all"}:p${page}:l${limit}`;
    let cached;
    try { cached = await redisClient.get(cacheKey); } catch (_) {}
    
    if (cached) {
      setRateLimitHeaders(res, req.rateLimit);
      return res.json(JSON.parse(cached));
    }

    const start = Date.now();
    let query = `
      SELECT v.code AS value, v.name AS village,
             sd.name AS subdistrict, d.name AS district, s.name AS state,
             CASE WHEN LOWER(v.name) LIKE LOWER($1) THEN 1
                  WHEN LOWER(v.name) LIKE LOWER($2) THEN 2 ELSE 3 END AS rank
      FROM village v
      JOIN subdistrict sd ON v.subdistrict_id = sd.id
      JOIN district d ON sd.district_id = d.id
      JOIN state s ON d.state_id = s.id
      WHERE (LOWER(v.name) LIKE LOWER($1) OR LOWER(v.name) LIKE LOWER($2))`;

    const params = [`${q}%`, `%${q}%`];
    if (state) { query += ` AND s.code = $3`; params.push(state); }
    query += ` ORDER BY rank, v.name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    const formatted = result.rows.map(row => ({
      value: row.value,
      label: row.village,
      fullAddress: `${row.village}, ${row.subdistrict}, ${row.district}, ${row.state}, India`,
      hierarchy: { village: row.village, subDistrict: row.subdistrict, district: row.district, state: row.state, country: "India" }
    }));

    const response = {
      success: true,
      count: formatted.length,
      page, limit,
      data: formatted,
      meta: { requestId: `req_${randomUUID()}`, responseTime: Date.now() - start, plan: req.user.plan }
    };

    try { await redisClient.setEx(cacheKey, 300, JSON.stringify(response)); } catch (_) {}
    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Error in search" });
  }
});

// -------------------------------
// HEALTH CHECK
// -------------------------------
app.get("/health", (req, res) => {
  res.json({ status: "OK", version: "2.1.0", timestamp: new Date().toISOString() });
});

// -------------------------------
// USER REGISTRATION
// -------------------------------
app.post("/api/v1/register", async (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress || "ip";
  const now = Date.now();
  
  // 1. Basic IP Cooldown Limit
  if (registerCooldowns.has(ip) && now - registerCooldowns.get(ip) < 60000) {
    return res.status(429).json({ success: false, message: "Too many registrations. Try again later." });
  }
  registerCooldowns.set(ip, now);

  // 2. Input validation
  const { name, email } = req.body;
  if (!name || name.length > 50 || name.length < 2) return res.status(400).json({ success: false, message: "Invalid name length" });
  if (!email || email.length > 100 || !email.includes("@")) return res.status(400).json({ success: false, message: "Invalid email structure" });

  try {
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) return res.status(409).json({ success: false, message: "Email already registered" });

    // 3. Transactions handling
    await pool.query("BEGIN");

    try {
      const userResult = await pool.query(
        "INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id",
        [name, email]
      );
      const userId = userResult.rows[0].id;

      const apiKey    = generateApiKey();
      const apiSecret = generateApiSecret();
      const secretHash = await bcrypt.hash(apiSecret, 10);

      await pool.query(
        "INSERT INTO api_keys (user_id, api_key, api_secret_hash) VALUES ($1, $2, $3)",
        [userId, apiKey, secretHash]
      );

      await pool.query("COMMIT");

      res.status(201).json({
        success: true,
        message: "Registration successful. Save your apiSecret — it will NOT be shown again.",
        apiKey,
        apiSecret,
        plan: "free",
        limits: { daily: 1000 }
      });

    } catch (dbErr) {
      await pool.query("ROLLBACK");
      throw dbErr; // let parent catch handle 500
    }

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Error registering user" });
  }
});

// -------------------------------
// USAGE LOGS (auth protected)
// -------------------------------
app.get("/api/v1/usage", protect, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT endpoint, method, status_code, response_ms, ip, created_at
       FROM api_logs
       WHERE api_key = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.user.apiKey]
    );

    const PLAN_LIMITS = { free: 1000, premium: 10000, enterprise: 100000 };
    const limit = PLAN_LIMITS[req.user.plan] || 1000;
    
    // We now have to fetch count from Redis!
    const rateKey = `rate_limit:${req.user.apiKey}:${Math.floor(new Date().setHours(24, 0, 0, 0) / 1000)}`;
    let usedToday = 0;
    if (redisClient.isOpen) {
      usedToday = parseInt(await redisClient.get(rateKey)) || 0;
    }

    res.json({
      success: true,
      plan: req.user.plan,
      usage: {
        today: usedToday,
        limit,
        remaining: Math.max(0, limit - usedToday)
      },
      recentLogs: result.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Error fetching usage" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 India Geo Data API v2.1 running on port ${PORT}`);
});