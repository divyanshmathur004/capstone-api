const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const { randomBytes, randomUUID } = require("crypto");
const pool = require("./db");
const redisClient = require("./redisClient");

require("dotenv").config();

const app = express();

const PORT = process.env.PORT || 5000;
const REGISTER_COOLDOWN_MS = 60000;

const PLAN_LIMITS = {
  free: { daily: 5000, burstPerMinute: 100 },
  premium: { daily: 50000, burstPerMinute: 500 },
  pro: { daily: 300000, burstPerMinute: 2000 },
  unlimited: { daily: 1000000, burstPerMinute: 5000 },
};

const registerCooldowns = new Map();

const generateApiKey = () => `ak_${randomBytes(24).toString("hex")}`;
const generateApiSecret = () => `as_${randomBytes(32).toString("hex")}`;

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  req.requestId = `req_${randomUUID()}`;
  req.startTime = Date.now();

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Strict-Transport-Security", "max-age=31536000");
  res.setHeader("Content-Security-Policy", "default-src 'self'");

  next();
});

setInterval(() => {
  const cutoff = Date.now() - REGISTER_COOLDOWN_MS;
  for (const [ip, timestamp] of registerCooldowns.entries()) {
    if (timestamp < cutoff) {
      registerCooldowns.delete(ip);
    }
  }
}, REGISTER_COOLDOWN_MS).unref();

const normalizePlan = (planValue) => {
  const key = String(planValue || "free").toLowerCase();
  return PLAN_LIMITS[key] ? key : "free";
};

const setRateHeaders = (res, limit, remaining, resetEpoch) => {
  res.setHeader("X-RateLimit-Limit", String(limit));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, remaining)));
  res.setHeader("X-RateLimit-Reset", String(resetEpoch));
};

const clampCount = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(Math.floor(parsed), Number.MAX_SAFE_INTEGER);
};

const maskApiKey = (apiKey) => {
  const key = String(apiKey || "");
  if (!key || key === "unknown") return "unknown";
  if (key.length <= 8) return `${key.slice(0, 2)}****${key.slice(-2)}`;
  return `${key.slice(0, 5)}****${key.slice(-4)}`;
};

const getDbDailyUsage = async (apiKey, startOfDay) => {
  const dbUsageResult = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM api_logs
     WHERE api_key = $1 AND created_at >= $2`,
    [apiKey, startOfDay]
  );
  return clampCount(dbUsageResult.rows[0]?.total || 0);
};

const getReconciledDailyUsage = async (apiKey, resetDaily, startOfDay) => {
  const dayKey = `rl:day:${apiKey}:${resetDaily}`;
  let dbCount = null;
  const getDbCountOnce = async () => {
    if (dbCount === null) {
      dbCount = await getDbDailyUsage(apiKey, startOfDay);
    }
    return dbCount;
  };

  if (!redisClient.isOpen) {
    return getDbCountOnce();
  }

  try {
    const rawCount = await redisClient.get(dayKey);
    if (rawCount === null) {
      const rebuilt = await getDbCountOnce();
      await redisClient.setEx(dayKey, 86400 + 60, String(rebuilt));
      return rebuilt;
    }

    const redisCount = clampCount(rawCount);
    const authoritativeCount = Math.max(redisCount, await getDbCountOnce());
    if (authoritativeCount !== redisCount) {
      await redisClient.setEx(dayKey, 86400 + 60, String(authoritativeCount));
    }
    return authoritativeCount;
  } catch (_) {
    return getDbCountOnce();
  }
};

const buildMeta = (req) => ({
  requestId: req.requestId,
  responseTime: Date.now() - req.startTime,
  rateLimit: req.rateLimit || null,
});

const sendSuccess = (req, res, data, extra = {}, statusCode = 200) => {
  const count = Array.isArray(data) ? data.length : 1;
  return res.status(statusCode).json({
    success: true,
    count,
    data,
    ...extra,
    meta: buildMeta(req),
  });
};

const sendError = (req, res, status, code, message) => {
  return res.status(status).json({
    success: false,
    errorCode: code,
    message,
    meta: buildMeta(req),
  });
};

const buildApiLogsQuery = (queryParams) => {
  const startDate = queryParams.startDate ? new Date(String(queryParams.startDate)) : null;
  const endDate = queryParams.endDate ? new Date(String(queryParams.endDate)) : null;
  const statusCode = queryParams.statusCode ? Number(queryParams.statusCode) : null;
  const endpoint = queryParams.endpoint ? String(queryParams.endpoint) : null;
  const apiKeyId = queryParams.apiKeyId ? Number(queryParams.apiKeyId) : null;
  const page = Math.max(1, Number(queryParams.page) || 1);
  const limit = Math.max(1, Math.min(Number(queryParams.limit) || 50, 200));
  const offset = (page - 1) * limit;

  const clauses = [];
  const params = [];

  if (startDate && !Number.isNaN(startDate.getTime())) {
    clauses.push(`created_at >= $${params.length + 1}`);
    params.push(startDate);
  }
  if (endDate && !Number.isNaN(endDate.getTime())) {
    clauses.push(`created_at <= $${params.length + 1}`);
    params.push(endDate);
  }
  if (Number.isInteger(statusCode)) {
    clauses.push(`status_code = $${params.length + 1}`);
    params.push(statusCode);
  }
  if (endpoint) {
    clauses.push(`endpoint ILIKE $${params.length + 1}`);
    params.push(`%${endpoint}%`);
  }
  if (Number.isInteger(apiKeyId)) {
    clauses.push(`api_key_id = $${params.length + 1}`);
    params.push(apiKeyId);
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return { whereSql, params, page, limit, offset };
};

const fetchAdminLogs = async (queryParams) => {
  const { whereSql, params, page, limit, offset } = buildApiLogsQuery(queryParams);
  const countQuery = `SELECT COUNT(*)::int AS total FROM api_logs ${whereSql}`;
  const dataQuery = `
    SELECT id, api_key_id, api_key, endpoint, method, status_code, response_ms, ip, created_at
    FROM api_logs
    ${whereSql}
    ORDER BY created_at DESC
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}`;

  const [countResult, dataResult] = await Promise.all([
    pool.query(countQuery, params),
    pool.query(dataQuery, [...params, limit, offset]),
  ]);

  return {
    rows: dataResult.rows.map((row) => ({
      ...row,
      api_key: maskApiKey(row.api_key),
    })),
    pagination: {
      page,
      limit,
      total: countResult.rows[0]?.total || 0,
    },
  };
};

const getStateAccessScope = async (req) => {
  if (req.stateAccessScope) return req.stateAccessScope;
  if (!req.auth?.userId) {
    req.stateAccessScope = { fullAccess: true, stateCodes: [] };
    return req.stateAccessScope;
  }

  if (req.auth.fullAccess) {
    req.stateAccessScope = { fullAccess: true, stateCodes: [] };
    return req.stateAccessScope;
  }

  const result = await pool.query(
    `SELECT s.code
     FROM user_state_access usa
     JOIN state s ON s.id = usa.state_id
     WHERE usa.user_id = $1`,
    [req.auth.userId]
  );

  req.stateAccessScope = {
    fullAccess: false,
    stateCodes: result.rows.map((row) => String(row.code)),
  };
  return req.stateAccessScope;
};

const enforceStateAccess = async (req, res, stateCode) => {
  const scope = await getStateAccessScope(req);
  const normalizedStateCode = String(stateCode);
  if (scope.fullAccess) return true;
  if (scope.stateCodes.length === 0 || !scope.stateCodes.includes(normalizedStateCode)) {
    sendError(req, res, 403, "ACCESS_DENIED", "No access to requested state");
    return false;
  }
  return true;
};

const authAndRateLimit = async (req, res, next) => {
  if (!req.path.startsWith("/api/v1/") || req.path === "/api/v1/register" || req.path.startsWith("/api/v1/admin/")) {
    return next();
  }

  const apiKey = req.headers["x-api-key"];
  if (!apiKey) {
    return sendError(req, res, 401, "ACCESS_DENIED", "API key missing");
  }

  try {
    const keyResult = await pool.query(
      `SELECT ak.id AS api_key_id, ak.user_id, ak.api_key, ak.api_secret_hash, ak.is_active, u.plan, u.status, u.full_access
       FROM api_keys ak
       JOIN users u ON u.id = ak.user_id
       WHERE ak.api_key = $1`,
      [apiKey]
    );

    if (keyResult.rows.length === 0) {
      return sendError(req, res, 401, "ACCESS_DENIED", "Invalid API key");
    }

    const keyRow = keyResult.rows[0];
    if (!keyRow.is_active) {
      return sendError(req, res, 403, "ACCESS_DENIED", "API key is revoked");
    }
    if (keyRow.status !== "ACTIVE") {
      return sendError(req, res, 403, "ACCESS_DENIED", "User is not active");
    }
    const method = String(req.method).toUpperCase();

    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      const apiSecret = req.headers["x-api-secret"];
      if (!apiSecret) {
        return sendError(req, res, 403, "ACCESS_DENIED", "API secret required for write operations");
      }
      const validSecret = await bcrypt.compare(apiSecret, keyRow.api_secret_hash);
      if (!validSecret) {
        return sendError(req, res, 403, "ACCESS_DENIED", "Invalid API secret");
      }
    }

    const plan = normalizePlan(keyRow.plan);
    const limits = PLAN_LIMITS[plan];
    req.auth = {
      apiKeyId: keyRow.api_key_id,
      userId: keyRow.user_id,
      apiKey: keyRow.api_key,
      plan,
      fullAccess: keyRow.full_access,
    };

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const resetDaily = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() / 1000);
    const minuteBucket = Math.floor(Date.now() / 60000);
    let dailyCount = 0;
    let burstCount = 0;

    if (redisClient.isOpen) {
      try {
        const dayKey = `rl:day:${apiKey}:${resetDaily}`;
        const minuteKey = `rl:min:${apiKey}:${minuteBucket}`;
        const [dailyIncr, burstIncr] = await Promise.all([
          redisClient.incr(dayKey),
          redisClient.incr(minuteKey),
        ]);

        dailyCount = clampCount(dailyIncr);
        burstCount = clampCount(burstIncr);

        if (dailyIncr === 1) {
          const historicalCount = await getDbDailyUsage(apiKey, startOfDay);
          const rebuiltCount = Math.max(1, historicalCount + 1);
          if (rebuiltCount !== dailyCount) {
            dailyCount = rebuiltCount;
            await redisClient.setEx(dayKey, 86400 + 60, String(rebuiltCount));
          } else {
            await redisClient.expire(dayKey, 86400 + 60);
          }
        }
        if (burstIncr === 1) {
          await redisClient.expire(minuteKey, 120);
        }
      } catch (_) {
        dailyCount = (await getDbDailyUsage(apiKey, startOfDay)) + 1;
        burstCount = 0;
      }
    } else {
      dailyCount = (await getDbDailyUsage(apiKey, startOfDay)) + 1;
      burstCount = 0;
    }

    dailyCount = clampCount(dailyCount);
    const remaining = Math.max(0, limits.daily - dailyCount);
    req.rateLimit = {
      limit: limits.daily,
      remaining,
      reset: resetDaily,
    };

    setRateHeaders(res, limits.daily, remaining, resetDaily);

    if (dailyCount > limits.daily || burstCount > limits.burstPerMinute) {
      return sendError(req, res, 429, "RATE_LIMITED", "Rate limit exceeded");
    }

    return next();
  } catch (err) {
    console.error("Auth/Rate limit error:", err.message);
    return sendError(req, res, 500, "INTERNAL_ERROR", "Authentication pipeline failed");
  }
};

app.use(authAndRateLimit);

app.use((req, res, next) => {
  res.on("finish", async () => {
    try {
      await pool.query(
        `INSERT INTO api_logs (api_key_id, api_key, endpoint, method, status_code, response_ms, ip)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          req.auth?.apiKeyId || null,
          req.auth?.apiKey || req.headers["x-api-key"] || "unknown",
          req.originalUrl,
          req.method,
          res.statusCode,
          Date.now() - req.startTime,
          req.ip || req.connection?.remoteAddress || "unknown",
        ]
      );
    } catch (_) {
      // Logging is best effort.
    }
  });
  next();
});

app.get("/", (req, res) => {
  return sendSuccess(req, res, { message: "Geo Data API Running" });
});

app.get("/api/v1/states", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 100, 500));
    const scope = await getStateAccessScope(req);
    if (!scope.fullAccess && scope.stateCodes.length === 0) {
      return sendError(req, res, 403, "ACCESS_DENIED", "No state access configured");
    }

    const cacheKey = scope.fullAccess
      ? "states:all"
      : `states:restricted:${scope.stateCodes.slice().sort().join(",")}`;
    let cached = null;
    try {
      cached = await redisClient.get(cacheKey);
    } catch (_) {}

    if (cached) {
      return sendSuccess(req, res, JSON.parse(cached));
    }

    const result = scope.fullAccess
      ? await pool.query("SELECT id, code, name FROM state ORDER BY name LIMIT $1", [limit])
      : await pool.query(
          `SELECT id, code, name
           FROM state
           WHERE code = ANY($1::text[])
           ORDER BY name
           LIMIT $2`,
          [scope.stateCodes, limit]
        );
    try {
      await redisClient.setEx(cacheKey, 3600, JSON.stringify(result.rows));
    } catch (_) {}

    return sendSuccess(req, res, result.rows);
  } catch (err) {
    console.error(err);
    return sendError(req, res, 500, "INTERNAL_ERROR", "Error fetching states");
  }
});

const getDistrictsByState = async (req, res, stateCode) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 1000, 5000));
    const hasAccess = await enforceStateAccess(req, res, stateCode);
    if (!hasAccess) return;

    const cacheKey = `districts:${stateCode}`;
    let cached = null;
    try {
      cached = await redisClient.get(cacheKey);
    } catch (_) {}

    if (cached) {
      return sendSuccess(req, res, JSON.parse(cached));
    }

    const result = await pool.query(
      `SELECT d.id, d.code, d.name
       FROM district d
       JOIN state s ON d.state_id = s.id
       WHERE s.code = $1
       ORDER BY d.name
       LIMIT $2`,
      [stateCode, limit]
    );
    if (result.rows.length === 0) {
      const stateExists = await pool.query("SELECT 1 FROM state WHERE code = $1", [stateCode]);
      if (stateExists.rows.length === 0) {
        return sendError(req, res, 404, "NOT_FOUND", "State not found");
      }
    }
    try {
      await redisClient.setEx(cacheKey, 3600, JSON.stringify(result.rows));
    } catch (_) {}
    return sendSuccess(req, res, result.rows);
  } catch (err) {
    console.error(err);
    return sendError(req, res, 500, "INTERNAL_ERROR", "Error fetching districts");
  }
};

const getSubdistrictsByDistrict = async (req, res, districtCode) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 1000, 5000));
    const stateResult = await pool.query(
      `SELECT s.code AS state_code
       FROM district d
       JOIN state s ON s.id = d.state_id
       WHERE d.code = $1
       LIMIT 1`,
      [districtCode]
    );
    if (stateResult.rows.length === 0) {
      return sendError(req, res, 404, "NOT_FOUND", "District not found");
    }
    const hasAccess = await enforceStateAccess(req, res, stateResult.rows[0].state_code);
    if (!hasAccess) return;

    const cacheKey = `subdistricts:${districtCode}`;
    let cached = null;
    try {
      cached = await redisClient.get(cacheKey);
    } catch (_) {}

    if (cached) {
      return sendSuccess(req, res, JSON.parse(cached));
    }

    const result = await pool.query(
      `SELECT sd.id, sd.code, sd.name
       FROM subdistrict sd
       JOIN district d ON sd.district_id = d.id
       WHERE d.code = $1
       ORDER BY sd.name
       LIMIT $2`,
      [districtCode, limit]
    );

    try {
      await redisClient.setEx(cacheKey, 3600, JSON.stringify(result.rows));
    } catch (_) {}

    return sendSuccess(req, res, result.rows);
  } catch (err) {
    console.error(err);
    return sendError(req, res, 500, "INTERNAL_ERROR", "Error fetching subdistricts");
  }
};

const getVillagesBySubdistrict = async (req, res, subdistrictCode) => {
  try {
    const stateResult = await pool.query(
      `SELECT s.code AS state_code
       FROM subdistrict sd
       JOIN district d ON d.id = sd.district_id
       JOIN state s ON s.id = d.state_id
       WHERE sd.code = $1
       LIMIT 1`,
      [subdistrictCode]
    );
    if (stateResult.rows.length === 0) {
      return sendError(req, res, 404, "NOT_FOUND", "Subdistrict not found");
    }
    const hasAccess = await enforceStateAccess(req, res, stateResult.rows[0].state_code);
    if (!hasAccess) return;

    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 100, 1000));
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const offset = (page - 1) * limit;

    const cacheKey = `villages:${subdistrictCode}:p${page}:l${limit}`;
    let cached = null;
    try {
      cached = await redisClient.get(cacheKey);
    } catch (_) {}

    if (cached) {
      return sendSuccess(req, res, JSON.parse(cached), { page, limit });
    }

    const result = await pool.query(
      `SELECT v.id, v.code, v.name
       FROM village v
       JOIN subdistrict sd ON v.subdistrict_id = sd.id
       WHERE sd.code = $1
       ORDER BY v.name
       LIMIT $2 OFFSET $3`,
      [subdistrictCode, limit, offset]
    );

    try {
      await redisClient.setEx(cacheKey, 3600, JSON.stringify(result.rows));
    } catch (_) {}

    return sendSuccess(req, res, result.rows, { page, limit });
  } catch (err) {
    console.error(err);
    return sendError(req, res, 500, "INTERNAL_ERROR", "Error fetching villages");
  }
};

app.get("/api/v1/districts/:state_code", async (req, res) => getDistrictsByState(req, res, req.params.state_code));
app.get("/api/v1/states/:id/districts", async (req, res) => getDistrictsByState(req, res, req.params.id));

app.get("/api/v1/subdistricts/:district_code", async (req, res) => getSubdistrictsByDistrict(req, res, req.params.district_code));
app.get("/api/v1/districts/:id/subdistricts", async (req, res) => getSubdistrictsByDistrict(req, res, req.params.id));

app.get("/api/v1/villages/:subdistrict_code", async (req, res) => getVillagesBySubdistrict(req, res, req.params.subdistrict_code));
app.get("/api/v1/subdistricts/:id/villages", async (req, res) => getVillagesBySubdistrict(req, res, req.params.id));

app.get("/api/v1/autocomplete", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const hierarchyLevel = String(req.query.hierarchyLevel || "village").toLowerCase();
    const scope = await getStateAccessScope(req);
    if (!scope.fullAccess && scope.stateCodes.length === 0) {
      return sendError(req, res, 403, "ACCESS_DENIED", "No state access configured");
    }
    if (q.length < 2) {
      return sendError(req, res, 400, "INVALID_QUERY", "Query must be at least 2 characters");
    }
    if (!["village", "subdistrict", "district", "state"].includes(hierarchyLevel)) {
      return sendError(req, res, 400, "INVALID_QUERY", "Invalid hierarchyLevel");
    }

    const scopeKey = scope.fullAccess ? "all" : scope.stateCodes.slice().sort().join(",");
    const cacheKey = `autocomplete:${hierarchyLevel}:${q.toLowerCase()}:scope:${scopeKey}`;
    let cached = null;
    try {
      cached = await redisClient.get(cacheKey);
    } catch (_) {}

    if (cached) {
      return sendSuccess(req, res, JSON.parse(cached));
    }

    let formatted = [];
    if (hierarchyLevel === "village") {
      const params = [`${q}%`, `%${q}%`];
      let sql =
        `SELECT v.code AS value, v.name AS village, sd.name AS subdistrict, d.name AS district, s.name AS state,
                CASE WHEN LOWER(v.name) LIKE LOWER($1) THEN 1 WHEN LOWER(v.name) LIKE LOWER($2) THEN 2 ELSE 3 END AS rank
         FROM village v
         JOIN subdistrict sd ON v.subdistrict_id = sd.id
         JOIN district d ON sd.district_id = d.id
         JOIN state s ON d.state_id = s.id
         WHERE (LOWER(v.name) LIKE LOWER($1) OR LOWER(v.name) LIKE LOWER($2))`;
      if (!scope.fullAccess) {
        sql += ` AND s.code = ANY($${params.length + 1}::text[])`;
        params.push(scope.stateCodes);
      }
      sql += `
         ORDER BY rank, v.name
         LIMIT 10`;
      const result = await pool.query(sql, params);
      formatted = result.rows.map((row) => ({
        value: row.value,
        label: row.village,
        fullAddress: `${row.village}, ${row.subdistrict}, ${row.district}, ${row.state}, India`,
        hierarchy: { village: row.village, subDistrict: row.subdistrict, district: row.district, state: row.state, country: "India" },
      }));
    } else if (hierarchyLevel === "subdistrict") {
      const params = [`${q}%`, `%${q}%`];
      let sql =
        `SELECT sd.code AS value, sd.name AS subdistrict, d.name AS district, s.name AS state,
                CASE WHEN LOWER(sd.name) LIKE LOWER($1) THEN 1 WHEN LOWER(sd.name) LIKE LOWER($2) THEN 2 ELSE 3 END AS rank
         FROM subdistrict sd
         JOIN district d ON sd.district_id = d.id
         JOIN state s ON d.state_id = s.id
         WHERE (LOWER(sd.name) LIKE LOWER($1) OR LOWER(sd.name) LIKE LOWER($2))`;
      if (!scope.fullAccess) {
        sql += ` AND s.code = ANY($${params.length + 1}::text[])`;
        params.push(scope.stateCodes);
      }
      sql += `
         ORDER BY rank, sd.name
         LIMIT 10`;
      const result = await pool.query(sql, params);
      formatted = result.rows.map((row) => ({
        value: row.value,
        label: row.subdistrict,
        fullAddress: `${row.subdistrict}, ${row.district}, ${row.state}, India`,
        hierarchy: { village: null, subDistrict: row.subdistrict, district: row.district, state: row.state, country: "India" },
      }));
    } else if (hierarchyLevel === "district") {
      const params = [`${q}%`, `%${q}%`];
      let sql =
        `SELECT d.code AS value, d.name AS district, s.name AS state,
                CASE WHEN LOWER(d.name) LIKE LOWER($1) THEN 1 WHEN LOWER(d.name) LIKE LOWER($2) THEN 2 ELSE 3 END AS rank
         FROM district d
         JOIN state s ON d.state_id = s.id
         WHERE (LOWER(d.name) LIKE LOWER($1) OR LOWER(d.name) LIKE LOWER($2))`;
      if (!scope.fullAccess) {
        sql += ` AND s.code = ANY($${params.length + 1}::text[])`;
        params.push(scope.stateCodes);
      }
      sql += `
         ORDER BY rank, d.name
         LIMIT 10`;
      const result = await pool.query(sql, params);
      formatted = result.rows.map((row) => ({
        value: row.value,
        label: row.district,
        fullAddress: `${row.district}, ${row.state}, India`,
        hierarchy: { village: null, subDistrict: null, district: row.district, state: row.state, country: "India" },
      }));
    } else {
      const params = [`${q}%`, `%${q}%`];
      let sql =
        `SELECT s.code AS value, s.name AS state,
                CASE WHEN LOWER(s.name) LIKE LOWER($1) THEN 1 WHEN LOWER(s.name) LIKE LOWER($2) THEN 2 ELSE 3 END AS rank
         FROM state s
         WHERE (LOWER(s.name) LIKE LOWER($1) OR LOWER(s.name) LIKE LOWER($2))`;
      if (!scope.fullAccess) {
        sql += ` AND s.code = ANY($${params.length + 1}::text[])`;
        params.push(scope.stateCodes);
      }
      sql += `
         ORDER BY rank, s.name
         LIMIT 10`;
      const result = await pool.query(sql, params);
      formatted = result.rows.map((row) => ({
        value: row.value,
        label: row.state,
        fullAddress: `${row.state}, India`,
        hierarchy: { village: null, subDistrict: null, district: null, state: row.state, country: "India" },
      }));
    }

    try {
      await redisClient.setEx(cacheKey, 300, JSON.stringify(formatted));
    } catch (_) {}

    return sendSuccess(req, res, formatted);
  } catch (err) {
    console.error(err);
    return sendError(req, res, 500, "INTERNAL_ERROR", "Error in autocomplete");
  }
});

app.get("/api/v1/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const state = req.query.state ? String(req.query.state) : null;
    const district = req.query.district ? String(req.query.district) : null;
    const subDistrict = req.query.subDistrict ? String(req.query.subDistrict) : null;

    if (q.length < 2) {
      return sendError(req, res, 400, "INVALID_QUERY", "Query must be at least 2 characters");
    }

    const scope = await getStateAccessScope(req);
    if (!scope.fullAccess && scope.stateCodes.length === 0) {
      return sendError(req, res, 403, "ACCESS_DENIED", "No state access configured");
    }
    if (!scope.fullAccess && state && !scope.stateCodes.includes(state)) {
      return sendError(req, res, 403, "ACCESS_DENIED", "No access to requested state");
    }
    if (district) {
      const districtState = await pool.query(
        `SELECT s.code AS state_code
         FROM district d
         JOIN state s ON s.id = d.state_id
         WHERE d.code = $1
         LIMIT 1`,
        [district]
      );
      if (districtState.rows.length === 0) {
        return sendError(req, res, 404, "NOT_FOUND", "District not found");
      }
      if (!scope.fullAccess && !scope.stateCodes.includes(districtState.rows[0].state_code)) {
        return sendError(req, res, 403, "ACCESS_DENIED", "No access to requested district");
      }
    }
    if (subDistrict) {
      const subdistrictState = await pool.query(
        `SELECT s.code AS state_code
         FROM subdistrict sd
         JOIN district d ON d.id = sd.district_id
         JOIN state s ON s.id = d.state_id
         WHERE sd.code = $1
         LIMIT 1`,
        [subDistrict]
      );
      if (subdistrictState.rows.length === 0) {
        return sendError(req, res, 404, "NOT_FOUND", "Subdistrict not found");
      }
      if (!scope.fullAccess && !scope.stateCodes.includes(subdistrictState.rows[0].state_code)) {
        return sendError(req, res, 403, "ACCESS_DENIED", "No access to requested subdistrict");
      }
    }

    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 20, 100));
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const offset = (page - 1) * limit;

    const scopeKey = scope.fullAccess ? "all" : scope.stateCodes.slice().sort().join(",");
    const cacheKey = `search:${q.toLowerCase()}:${state || "all"}:${district || "all"}:${subDistrict || "all"}:p${page}:l${limit}:scope:${scopeKey}`;
    let cached = null;
    try {
      cached = await redisClient.get(cacheKey);
    } catch (_) {}

    if (cached) {
      return sendSuccess(req, res, JSON.parse(cached), { page, limit });
    }

    let query = `
      SELECT
        v.code AS value,
        v.name AS village,
        sd.name AS subdistrict,
        d.name AS district,
        s.name AS state,
        CASE
          WHEN LOWER(v.name) LIKE LOWER($1) THEN 1
          WHEN LOWER(v.name) LIKE LOWER($2) THEN 2
          ELSE 3
        END AS rank
      FROM village v
      JOIN subdistrict sd ON v.subdistrict_id = sd.id
      JOIN district d ON sd.district_id = d.id
      JOIN state s ON d.state_id = s.id
      WHERE (LOWER(v.name) LIKE LOWER($1) OR LOWER(v.name) LIKE LOWER($2))`;

    const params = [`${q}%`, `%${q}%`];
    if (state) {
      query += ` AND s.code = $${params.length + 1}`;
      params.push(state);
    } else if (!scope.fullAccess) {
      query += ` AND s.code = ANY($${params.length + 1}::text[])`;
      params.push(scope.stateCodes);
    }
    if (district) {
      query += ` AND d.code = $${params.length + 1}`;
      params.push(district);
    }
    if (subDistrict) {
      query += ` AND sd.code = $${params.length + 1}`;
      params.push(subDistrict);
    }
    query += ` ORDER BY rank, v.name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    const formatted = result.rows.map((row) => ({
      value: row.value,
      label: row.village,
      fullAddress: `${row.village}, ${row.subdistrict}, ${row.district}, ${row.state}, India`,
      hierarchy: {
        village: row.village,
        subDistrict: row.subdistrict,
        district: row.district,
        state: row.state,
        country: "India",
      },
    }));

    try {
      await redisClient.setEx(cacheKey, 300, JSON.stringify(formatted));
    } catch (_) {}

    return sendSuccess(req, res, formatted, { page, limit });
  } catch (err) {
    console.error(err);
    return sendError(req, res, 500, "INTERNAL_ERROR", "Error in search API");
  }
});

app.get("/api/v1/usage", async (req, res) => {
  try {
    if (!req.auth?.apiKey) {
      return sendError(req, res, 403, "ACCESS_DENIED", "Authentication required");
    }

    const plan = req.auth.plan;
    const limits = PLAN_LIMITS[plan];
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const resetDaily = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() / 1000);

    const usedToday = await getReconciledDailyUsage(req.auth.apiKey, resetDaily, startOfDay);
    const usedTodayDb = await getDbDailyUsage(req.auth.apiKey, startOfDay);

    const logsResult = await pool.query(
      `SELECT endpoint, method, status_code, response_ms, created_at
       FROM api_logs
       WHERE api_key = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.auth.apiKey]
    );

    return sendSuccess(req, res, {
      plan,
      usage: {
        today: clampCount(usedToday),
        todayDb: usedTodayDb,
        limit: limits.daily,
        remaining: Math.max(0, limits.daily - clampCount(usedToday)),
        reset: resetDaily,
      },
      recentLogs: logsResult.rows,
    });
  } catch (err) {
    console.error(err);
    return sendError(req, res, 500, "INTERNAL_ERROR", "Error fetching usage");
  }
});

app.get("/api/v1/api-keys/:id/usage", async (req, res) => {
  if (!req.auth?.userId) return sendError(req, res, 403, "ACCESS_DENIED", "Authentication required");
  try {
    const keyResult = await pool.query(
      `SELECT id, api_key, key_name, is_active
       FROM api_keys
       WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.auth.userId]
    );
    if (keyResult.rows.length === 0) return sendError(req, res, 404, "NOT_FOUND", "API key not found");

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const resetDaily = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() / 1000);
    const keyValue = keyResult.rows[0].api_key;

    const usedToday = await getReconciledDailyUsage(keyValue, resetDaily, startOfDay);
    const usedTodayDb = await getDbDailyUsage(keyValue, startOfDay);

    return sendSuccess(req, res, {
      id: keyResult.rows[0].id,
      keyName: keyResult.rows[0].key_name,
      isActive: keyResult.rows[0].is_active,
      usage: {
        today: clampCount(usedToday),
        todayDb: usedTodayDb,
        reset: resetDaily,
      },
    });
  } catch (err) {
    console.error(err);
    return sendError(req, res, 500, "INTERNAL_ERROR", "Error fetching key usage");
  }
});

app.get("/health", (req, res) => {
  return sendSuccess(req, res, { status: "OK" });
});

app.post("/api/v1/register", async (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress || "unknown";
  const now = Date.now();

  if (registerCooldowns.has(ip) && now - registerCooldowns.get(ip) < REGISTER_COOLDOWN_MS) {
    return sendError(req, res, 429, "RATE_LIMITED", "Too many registrations. Try again later.");
  }

  const { name, email } = req.body || {};
  if (!name || name.length < 2 || name.length > 50) {
    return sendError(req, res, 400, "INVALID_QUERY", "Invalid name length");
  }
  if (!email || email.length > 100 || !email.includes("@")) {
    return sendError(req, res, 400, "INVALID_QUERY", "Invalid email structure");
  }

  registerCooldowns.set(ip, now);

  try {
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return sendError(req, res, 409, "ACCESS_DENIED", "Email already registered");
    }

    const userResult = await pool.query(
      "INSERT INTO users (name, email, status) VALUES ($1, $2, 'PENDING_APPROVAL') RETURNING id, status",
      [name, email]
    );

    return sendSuccess(req, res, {
      userId: userResult.rows[0].id,
      status: userResult.rows[0].status,
    }, {}, 201);
  } catch (err) {
    console.error(err);
    return sendError(req, res, 500, "INTERNAL_ERROR", "Error registering user");
  }
});

const requireAdmin = (req, res) => {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || req.headers["x-admin-secret"] !== adminSecret) {
    sendError(req, res, 403, "ACCESS_DENIED", "Admin authorization required");
    return false;
  }
  return true;
};

const issueApiKey = async (userId, keyName) => {
  const activeCountResult = await pool.query(
    "SELECT COUNT(*)::int AS count FROM api_keys WHERE user_id = $1 AND is_active = true",
    [userId]
  );
  if (activeCountResult.rows[0].count >= 5) {
    const error = new Error("KEY_LIMIT_REACHED");
    error.status = 429;
    throw error;
  }

  const apiKey = generateApiKey();
  const apiSecret = generateApiSecret();
  const secretHash = await bcrypt.hash(apiSecret, 10);

  let insertResult;
  try {
    insertResult = await pool.query(
      `INSERT INTO api_keys (user_id, key_name, api_key, api_secret_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, api_key, created_at`,
      [userId, keyName || null, apiKey, secretHash]
    );
  } catch (err) {
    if (String(err.message || "").includes("MAX_ACTIVE_KEYS_REACHED")) {
      const limitErr = new Error("KEY_LIMIT_REACHED");
      limitErr.status = 429;
      throw limitErr;
    }
    throw err;
  }

  return {
    id: insertResult.rows[0].id,
    apiKey,
    apiSecret,
    createdAt: insertResult.rows[0].created_at,
  };
};

app.post("/api/v1/admin/users/:id/approve", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const result = await pool.query(
      "UPDATE users SET status = 'ACTIVE', status_reason = NULL, reviewed_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING id, status",
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return sendError(req, res, 404, "NOT_FOUND", "User not found");
    }

    const keyBundle = await issueApiKey(req.params.id, "Initial key");

    return sendSuccess(req, res, { ...result.rows[0], apiKey: keyBundle.apiKey, apiSecret: keyBundle.apiSecret });
  } catch (err) {
    console.error(err);
    if (err.message === "KEY_LIMIT_REACHED") {
      return sendError(req, res, 429, "RATE_LIMITED", "Maximum active keys reached for user");
    }
    return sendError(req, res, 500, "INTERNAL_ERROR", "Error approving user");
  }
});

app.post("/api/v1/admin/users/:id/reject", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const reason = String(req.body?.reason || "Rejected by admin");
    const result = await pool.query(
      "UPDATE users SET status = 'REJECTED', status_reason = $2, reviewed_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING id, status",
      [req.params.id, reason]
    );
    if (result.rows.length === 0) return sendError(req, res, 404, "NOT_FOUND", "User not found");
    return sendSuccess(req, res, result.rows[0]);
  } catch (err) {
    console.error(err);
    return sendError(req, res, 500, "INTERNAL_ERROR", "Error rejecting user");
  }
});

app.post("/api/v1/admin/users/:id/suspend", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const reason = String(req.body?.reason || "Suspended by admin");
    const result = await pool.query(
      "UPDATE users SET status = 'SUSPENDED', status_reason = $2, reviewed_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING id, status",
      [req.params.id, reason]
    );
    if (result.rows.length === 0) return sendError(req, res, 404, "NOT_FOUND", "User not found");
    return sendSuccess(req, res, result.rows[0]);
  } catch (err) {
    console.error(err);
    return sendError(req, res, 500, "INTERNAL_ERROR", "Error suspending user");
  }
});

app.get("/api/v1/admin/users", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 200, 500));
    const result = await pool.query(
      `SELECT id, name, email, plan, status, status_reason, created_at, reviewed_at
       FROM users
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    return sendSuccess(req, res, result.rows);
  } catch (err) {
    console.error(err);
    return sendError(req, res, 500, "INTERNAL_ERROR", "Error fetching users");
  }
});

app.post("/api/v1/admin/users/:id/state-access", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const stateId = Number(req.body?.stateId);
    if (!stateId) return sendError(req, res, 400, "INVALID_QUERY", "stateId is required");
    await pool.query(
      `INSERT INTO user_state_access (user_id, state_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, state_id) DO NOTHING`,
      [req.params.id, stateId]
    );
    await pool.query("UPDATE users SET full_access = false, updated_at = NOW() WHERE id = $1", [req.params.id]);
    return sendSuccess(req, res, { granted: true, userId: Number(req.params.id), stateId });
  } catch (err) {
    console.error(err);
    return sendError(req, res, 500, "INTERNAL_ERROR", "Error granting state access");
  }
});

app.delete("/api/v1/admin/users/:id/state-access/:stateId", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const result = await pool.query(
      `DELETE FROM user_state_access
       WHERE user_id = $1 AND state_id = $2
       RETURNING id`,
      [req.params.id, req.params.stateId]
    );
    if (result.rows.length === 0) return sendError(req, res, 404, "NOT_FOUND", "State access not found");

    const remaining = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM user_state_access
       WHERE user_id = $1`,
      [req.params.id]
    );
    if (remaining.rows[0].total === 0) {
      await pool.query("UPDATE users SET full_access = true, updated_at = NOW() WHERE id = $1", [req.params.id]);
    }

    return sendSuccess(req, res, { revoked: true, userId: Number(req.params.id), stateId: Number(req.params.stateId) });
  } catch (err) {
    console.error(err);
    return sendError(req, res, 500, "INTERNAL_ERROR", "Error revoking state access");
  }
});

app.get("/api/v1/admin/api-logs", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const result = await fetchAdminLogs(req.query || {});
    return sendSuccess(req, res, result.rows, { pagination: result.pagination });
  } catch (err) {
    console.error(err);
    return sendError(req, res, 500, "INTERNAL_ERROR", "Error fetching API logs");
  }
});

app.get("/api/v1/admin/metrics/response-time", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const startDate = req.query.startDate ? new Date(String(req.query.startDate)) : null;
    const endDate = req.query.endDate ? new Date(String(req.query.endDate)) : null;
    const clauses = [];
    const params = [];
    if (startDate && !Number.isNaN(startDate.getTime())) {
      clauses.push(`created_at >= $${params.length + 1}`);
      params.push(startDate);
    }
    if (endDate && !Number.isNaN(endDate.getTime())) {
      clauses.push(`created_at <= $${params.length + 1}`);
      params.push(endDate);
    }
    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

    const metricsResult = await pool.query(
      `SELECT
         COALESCE(ROUND(AVG(response_ms)::numeric, 2), 0) AS avg,
         COALESCE(ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_ms)::numeric, 2), 0) AS p95,
         COALESCE(ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_ms)::numeric, 2), 0) AS p99
       FROM api_logs
       ${whereSql}`,
      params
    );

    return sendSuccess(req, res, {
      avg: Number(metricsResult.rows[0].avg || 0),
      p95: Number(metricsResult.rows[0].p95 || 0),
      p99: Number(metricsResult.rows[0].p99 || 0),
    });
  } catch (err) {
    console.error(err);
    return sendError(req, res, 500, "INTERNAL_ERROR", "Error fetching response-time metrics");
  }
});

app.get("/api/v1/admin/analytics", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const [users, logs, keys, villages, plans] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active, COUNT(*) FILTER (WHERE status = 'PENDING_APPROVAL')::int AS pending FROM users`),
      pool.query(`SELECT COUNT(*)::int AS total FROM api_logs`),
      pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_active = true)::int AS active FROM api_keys`),
      pool.query(`SELECT COUNT(*)::int AS total FROM village`),
      pool.query(`SELECT plan, COUNT(*)::int AS total FROM users GROUP BY plan ORDER BY plan`),
    ]);

    return sendSuccess(req, res, {
      users: users.rows[0],
      apiLogs: logs.rows[0],
      apiKeys: keys.rows[0],
      villages: villages.rows[0],
      plans: plans.rows,
    });
  } catch (err) {
    console.error(err);
    return sendError(req, res, 500, "INTERNAL_ERROR", "Error fetching analytics");
  }
});

app.get("/api/v1/api-keys", async (req, res) => {
  if (!req.auth?.userId) return sendError(req, res, 403, "ACCESS_DENIED", "Authentication required");
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 50, 100));
    const result = await pool.query(
      `SELECT id, key_name, api_key, is_active, revoked_at, created_at, updated_at
       FROM api_keys
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [req.auth.userId, limit]
    );
    return sendSuccess(
      req,
      res,
      result.rows.map((row) => ({
        ...row,
        api_key: maskApiKey(row.api_key),
      }))
    );
  } catch (err) {
    console.error(err);
    return sendError(req, res, 500, "INTERNAL_ERROR", "Error fetching API keys");
  }
});

app.post("/api/v1/api-keys", async (req, res) => {
  if (!req.auth?.userId) return sendError(req, res, 403, "ACCESS_DENIED", "Authentication required");
  try {
    const userResult = await pool.query("SELECT status FROM users WHERE id = $1", [req.auth.userId]);
    if (userResult.rows[0]?.status !== "ACTIVE") {
      return sendError(req, res, 403, "ACCESS_DENIED", "User is not active");
    }
    const keyBundle = await issueApiKey(req.auth.userId, String(req.body?.keyName || "API key"));
    return sendSuccess(req, res, keyBundle, {}, 201);
  } catch (err) {
    console.error(err);
    if (err.message === "KEY_LIMIT_REACHED") {
      return sendError(req, res, 429, "RATE_LIMITED", "Maximum active keys reached for user");
    }
    return sendError(req, res, 500, "INTERNAL_ERROR", "Error creating API key");
  }
});

app.delete("/api/v1/api-keys/:id", async (req, res) => {
  if (!req.auth?.userId) return sendError(req, res, 403, "ACCESS_DENIED", "Authentication required");
  try {
    const result = await pool.query(
      `UPDATE api_keys
       SET is_active = false, revoked_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING id, is_active`,
      [req.params.id, req.auth.userId]
    );
    if (result.rows.length === 0) return sendError(req, res, 404, "NOT_FOUND", "API key not found");
    return sendSuccess(req, res, result.rows[0]);
  } catch (err) {
    console.error(err);
    return sendError(req, res, 500, "INTERNAL_ERROR", "Error revoking API key");
  }
});

app.post("/api/v1/api-keys/:id/rotate", async (req, res) => {
  if (!req.auth?.userId) return sendError(req, res, 403, "ACCESS_DENIED", "Authentication required");
  try {
    const revoked = await pool.query(
      `UPDATE api_keys
       SET is_active = false, revoked_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING key_name`,
      [req.params.id, req.auth.userId]
    );
    if (revoked.rows.length === 0) return sendError(req, res, 404, "NOT_FOUND", "API key not found");

    const keyBundle = await issueApiKey(req.auth.userId, revoked.rows[0].key_name || "Rotated key");
    return sendSuccess(req, res, keyBundle, {}, 201);
  } catch (err) {
    console.error(err);
    if (err.message === "KEY_LIMIT_REACHED") {
      return sendError(req, res, 429, "RATE_LIMITED", "Maximum active keys reached for user");
    }
    return sendError(req, res, 500, "INTERNAL_ERROR", "Error rotating API key");
  }
});

app.get("/api/admin/users", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 200, 500));
    const result = await pool.query(
      `SELECT id, name, email, plan, status, status_reason, created_at, reviewed_at
       FROM users
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    return sendSuccess(req, res, result.rows);
  } catch (err) {
    console.error(err);
    return sendError(req, res, 500, "INTERNAL_ERROR", "Error fetching users");
  }
});

app.post("/api/admin/users/:id/approve", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const result = await pool.query(
      "UPDATE users SET status = 'ACTIVE', status_reason = NULL, reviewed_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING id, status",
      [req.params.id]
    );
    if (result.rows.length === 0) return sendError(req, res, 404, "NOT_FOUND", "User not found");
    const keyBundle = await issueApiKey(req.params.id, "Initial key");
    return sendSuccess(req, res, { ...result.rows[0], apiKey: keyBundle.apiKey, apiSecret: keyBundle.apiSecret });
  } catch (err) {
    console.error(err);
    if (err.message === "KEY_LIMIT_REACHED") return sendError(req, res, 429, "RATE_LIMITED", "Maximum active keys reached for user");
    return sendError(req, res, 500, "INTERNAL_ERROR", "Error approving user");
  }
});

app.post("/api/admin/users/:id/reject", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const reason = String(req.body?.reason || "Rejected by admin");
    const result = await pool.query(
      "UPDATE users SET status = 'REJECTED', status_reason = $2, reviewed_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING id, status",
      [req.params.id, reason]
    );
    if (result.rows.length === 0) return sendError(req, res, 404, "NOT_FOUND", "User not found");
    return sendSuccess(req, res, result.rows[0]);
  } catch (err) {
    console.error(err);
    return sendError(req, res, 500, "INTERNAL_ERROR", "Error rejecting user");
  }
});

app.post("/api/admin/users/:id/suspend", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const reason = String(req.body?.reason || "Suspended by admin");
    const result = await pool.query(
      "UPDATE users SET status = 'SUSPENDED', status_reason = $2, reviewed_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING id, status",
      [req.params.id, reason]
    );
    if (result.rows.length === 0) return sendError(req, res, 404, "NOT_FOUND", "User not found");
    return sendSuccess(req, res, result.rows[0]);
  } catch (err) {
    console.error(err);
    return sendError(req, res, 500, "INTERNAL_ERROR", "Error suspending user");
  }
});

app.post("/api/admin/users/:id/grant-state", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const stateId = Number(req.body?.stateId);
    if (!stateId) return sendError(req, res, 400, "INVALID_QUERY", "stateId is required");
    await pool.query(
      `INSERT INTO user_state_access (user_id, state_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, state_id) DO NOTHING`,
      [req.params.id, stateId]
    );
    await pool.query("UPDATE users SET full_access = false, updated_at = NOW() WHERE id = $1", [req.params.id]);
    return sendSuccess(req, res, { granted: true, userId: Number(req.params.id), stateId });
  } catch (err) {
    console.error(err);
    return sendError(req, res, 500, "INTERNAL_ERROR", "Error granting state access");
  }
});

app.post("/api/admin/users/:id/revoke-state", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const stateId = Number(req.body?.stateId);
    if (!stateId) return sendError(req, res, 400, "INVALID_QUERY", "stateId is required");
    const result = await pool.query(
      `DELETE FROM user_state_access
       WHERE user_id = $1 AND state_id = $2
       RETURNING id`,
      [req.params.id, stateId]
    );
    if (result.rows.length === 0) return sendError(req, res, 404, "NOT_FOUND", "State access not found");

    const remaining = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM user_state_access
       WHERE user_id = $1`,
      [req.params.id]
    );
    if (remaining.rows[0].total === 0) {
      await pool.query("UPDATE users SET full_access = true, updated_at = NOW() WHERE id = $1", [req.params.id]);
    }

    return sendSuccess(req, res, { revoked: true, userId: Number(req.params.id), stateId });
  } catch (err) {
    console.error(err);
    return sendError(req, res, 500, "INTERNAL_ERROR", "Error revoking state access");
  }
});

app.get("/api/admin/logs", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const result = await fetchAdminLogs(req.query || {});
    return sendSuccess(req, res, result.rows, { pagination: result.pagination });
  } catch (err) {
    console.error(err);
    return sendError(req, res, 500, "INTERNAL_ERROR", "Error fetching API logs");
  }
});

app.get("/api/admin/metrics/response-time", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const startDate = req.query.startDate ? new Date(String(req.query.startDate)) : null;
    const endDate = req.query.endDate ? new Date(String(req.query.endDate)) : null;
    const clauses = [];
    const params = [];
    if (startDate && !Number.isNaN(startDate.getTime())) {
      clauses.push(`created_at >= $${params.length + 1}`);
      params.push(startDate);
    }
    if (endDate && !Number.isNaN(endDate.getTime())) {
      clauses.push(`created_at <= $${params.length + 1}`);
      params.push(endDate);
    }
    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

    const metricsResult = await pool.query(
      `SELECT
         COALESCE(ROUND(AVG(response_ms)::numeric, 2), 0) AS avg,
         COALESCE(ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_ms)::numeric, 2), 0) AS p95,
         COALESCE(ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_ms)::numeric, 2), 0) AS p99
       FROM api_logs
       ${whereSql}`,
      params
    );

    return sendSuccess(req, res, {
      avg: Number(metricsResult.rows[0].avg || 0),
      p95: Number(metricsResult.rows[0].p95 || 0),
      p99: Number(metricsResult.rows[0].p99 || 0),
    });
  } catch (err) {
    console.error(err);
    return sendError(req, res, 500, "INTERNAL_ERROR", "Error fetching response-time metrics");
  }
});

if (process.env.NODE_ENV !== "production") {
  app.post("/api/test/verify-access", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      if (typeof fetch !== "function") {
        return sendError(req, res, 500, "INTERNAL_ERROR", "Fetch API is unavailable in this Node runtime");
      }

      const baseUrl = String(req.body?.baseUrl || `http://127.0.0.1:${PORT}`);
      const stateResult = await pool.query(
        `SELECT id, code
         FROM state
         ORDER BY id
         LIMIT 3`
      );
      if (stateResult.rows.length < 2) {
        return sendError(req, res, 500, "INTERNAL_ERROR", "At least 2 states are required for access verification");
      }

      const allowedState = stateResult.rows[0];
      const blockedState = stateResult.rows.find((row) => row.code !== allowedState.code);
      if (!blockedState) {
        return sendError(req, res, 500, "INTERNAL_ERROR", "Unable to determine blocked state for restricted access test");
      }

      const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const usersColumnsResult = await pool.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'users'
           AND column_name IN ('status', 'full_access', 'updated_at')`
      );
      const usersColumns = new Set(usersColumnsResult.rows.map((row) => row.column_name));

      const fullUserResult = await pool.query(
        `INSERT INTO users (name, email)
         VALUES ($1, $2)
         RETURNING id, email`,
        [`Test Full ${suffix}`, `test_full_${suffix}@local.dev`]
      );
      const restrictedUserResult = await pool.query(
        `INSERT INTO users (name, email)
         VALUES ($1, $2)
         RETURNING id, email`,
        [`Test Restricted ${suffix}`, `test_restricted_${suffix}@local.dev`]
      );

      const applyUserAccessMode = async (userId, fullAccess) => {
        const sets = [];
        const params = [];
        if (usersColumns.has("status")) {
          sets.push(`status = $${params.length + 1}`);
          params.push("ACTIVE");
        }
        if (usersColumns.has("full_access")) {
          sets.push(`full_access = $${params.length + 1}`);
          params.push(fullAccess);
        }
        if (usersColumns.has("updated_at")) {
          sets.push(`updated_at = NOW()`);
        }
        if (sets.length === 0) return;
        params.push(userId);
        await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
      };

      await applyUserAccessMode(fullUserResult.rows[0].id, true);
      await applyUserAccessMode(restrictedUserResult.rows[0].id, false);

      await pool.query(
        `INSERT INTO user_state_access (user_id, state_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, state_id) DO NOTHING`,
        [restrictedUserResult.rows[0].id, allowedState.id]
      );

      const fullKey = await issueApiKey(fullUserResult.rows[0].id, "Verification Full Key");
      const restrictedKey = await issueApiKey(restrictedUserResult.rows[0].id, "Verification Restricted Key");

      const runCheck = async (label, apiKey, stateCode, expectedStatus) => {
        const url = `${baseUrl}/api/v1/districts/${stateCode}`;
        const response = await fetch(url, { headers: { "x-api-key": apiKey } });
        return {
          label,
          url,
          expectedStatus,
          actualStatus: response.status,
          pass: response.status === expectedStatus,
        };
      };

      const checks = [
        await runCheck("full_access_allowed", fullKey.apiKey, allowedState.code, 200),
        await runCheck("restricted_allowed", restrictedKey.apiKey, allowedState.code, 200),
        await runCheck("restricted_blocked", restrictedKey.apiKey, blockedState.code, 403),
      ];

      for (const check of checks) {
        console.log(`[verify-access] ${check.label} expected=${check.expectedStatus} actual=${check.actualStatus} pass=${check.pass}`);
      }

      const passed = checks.every((check) => check.pass);
      return sendSuccess(
        req,
        res,
        {
          passed,
          states: {
            allowed: allowedState.code,
            blocked: blockedState.code,
          },
          seededUsers: {
            fullAccess: {
              id: fullUserResult.rows[0].id,
              email: fullUserResult.rows[0].email,
              apiKeyId: fullKey.id,
              apiKeyMasked: maskApiKey(fullKey.apiKey),
            },
            restricted: {
              id: restrictedUserResult.rows[0].id,
              email: restrictedUserResult.rows[0].email,
              apiKeyId: restrictedKey.id,
              apiKeyMasked: maskApiKey(restrictedKey.apiKey),
            },
          },
          checks,
        },
        {},
        passed ? 200 : 500
      );
    } catch (err) {
      console.error("verify-access error:", err);
      return sendError(req, res, 500, "INTERNAL_ERROR", "Access verification flow failed");
    }
  });
}

const verifyStartupSafety = async () => {
  const requiredEnvVars = ["DATABASE_URL", "ADMIN_SECRET", "REDIS_URL"];
  const missingEnvVars = requiredEnvVars.filter((name) => !process.env[name]);
  if (missingEnvVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingEnvVars.join(", ")}`);
  }

  await pool.query("SELECT 1");

  if (!redisClient.isOpen) {
    throw new Error("Redis connection is required but not available");
  }

  await redisClient.ping();
};

const startServer = async () => {
  try {
    await verifyStartupSafety();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Startup safety check failed:", err.message);
    process.exit(1);
  }
};

startServer();