const express = require("express");
const cors = require("cors");
const pool = require("./db");
const redisClient = require("./redisClient");
const start = Date.now();


require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

// Root route
app.get("/", (req, res) => {
  res.send("🚀 Geo Data API Running");
});

// -------------------------------
// STATES API
// -------------------------------
app.get("/api/v1/states", async (req, res) => {
  try {
    const cacheKey = "states";

    let cached;

        try {
            cached = await redisClient.get(cacheKey);
        } catch (err) {
            console.log("⚠️ Redis failed, using DB");
        }

        if (cached) {
          console.log("⚡ Cache HIT");
          return res.json(JSON.parse(cached));
        }

    console.log("🐢 Cache MISS");

    const result = await pool.query(
      "SELECT id, code, name FROM state ORDER BY name"
    );

    try {
        await redisClient.setEx(cacheKey, 3600, JSON.stringify(result.rows));
    } catch (err) {
        console.log("⚠️ Redis set failed");
    }

    res.json({
  success: true,
  count: result.rows.length,
  data: result.rows,
  meta: {
    responseTime: Date.now()
  }
});
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching states");
  }
});

// -------------------------------
// DISTRICTS BY STATE
// -------------------------------
app.get("/api/v1/districts/:state_code", async (req, res) => {
  try {
    const { state_code } = req.params;
    const cacheKey = `districts:${state_code}`;

    let cached;

    try {
      cached = await redisClient.get(cacheKey);
    } catch (err) {
      console.log("⚠️ Redis failed, using DB");
    }

    if (cached) {
      console.log("⚡ Cache HIT - districts");
      return res.json(JSON.parse(cached));
    }

    console.log("🐢 Cache MISS - districts");

    const result = await pool.query(
  `
  SELECT d.id, d.code, d.name
  FROM district d
  JOIN state s ON d.state_id = s.id
  WHERE s.code = $1
  ORDER BY d.name
  `,
  [state_code]
);

    try {
      await redisClient.setEx(cacheKey, 3600, JSON.stringify(result.rows));
    } catch (err) {
      console.log("⚠️ Redis set failed");
    }

    res.json({
  success: true,
  count: result.rows.length,
  data: result.rows,
  meta: {
    responseTime: Date.now() -start
  }
});
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching districts");
  }
});

// -------------------------------
// SUBDISTRICTS
// -------------------------------
app.get("/api/v1/subdistricts/:district_code", async (req, res) => {
  try {
    const { district_code } = req.params;
    const cacheKey = `subdistricts:${district_code}`;

    let cached;

    try {
      cached = await redisClient.get(cacheKey);
    } catch (err) {
      console.log("⚠️ Redis failed, using DB");
    }

    if (cached) {
      console.log("⚡ Cache HIT - subdistricts");
      return res.json(JSON.parse(cached));
    }

    console.log("🐢 Cache MISS - subdistricts");

    const result = await pool.query(
  `
  SELECT sd.id, sd.code, sd.name
  FROM subdistrict sd
  JOIN district d ON sd.district_id = d.id
  WHERE d.code = $1
  ORDER BY sd.name
  `,
  [district_code]
);

    try {
      await redisClient.setEx(cacheKey, 3600, JSON.stringify(result.rows));
    } catch (err) {
      console.log("⚠️ Redis set failed");
    }

    res.json({
  success: true,
  count: result.rows.length,
  data: result.rows,
  meta: {
    responseTime: Date.now() -start
  }
});
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching subdistricts");
  }
});

// -------------------------------
// VILLAGES
// -------------------------------
app.get("/api/v1/villages/:subdistrict_code", async (req, res) => {
  try {
    const { subdistrict_code } = req.params;

    const limit = parseInt(req.query.limit) || 100;
    const page = parseInt(req.query.page) || 1;
    const offset = (page - 1) * limit;

    const cacheKey = `villages:${subdistrict_code}:p${page}:l${limit}`;

    let cached;

    try {
      cached = await redisClient.get(cacheKey);
    } catch (err) {
      console.log("⚠️ Redis failed, using DB");
    }

    if (cached) {
      console.log("⚡ Cache HIT - villages");
      return res.json(JSON.parse(cached));
    }

    console.log("🐢 Cache MISS - villages");

    const result = await pool.query(
      `
      SELECT v.id, v.code, v.name
      FROM village v
      JOIN subdistrict sd ON v.subdistrict_id = sd.id
      WHERE sd.code = $1
      ORDER BY v.name
      LIMIT $2 OFFSET $3
      `,
      [subdistrict_code, limit, offset]
    );

    try {
      await redisClient.setEx(cacheKey, 3600, JSON.stringify({
        success: true,
        count: result.rows.length,
        page,
        limit,
        data: result.rows
      }));
    } catch (err) {
      console.log("⚠️ Redis set failed");
    }

    res.json({
      success: true,
      count: result.rows.length,
      page,
      limit,
      data: result.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching villages");
  }
});

// -------------------------------
// AUTOCOMPLETE
// -------------------------------
app.get("/api/v1/autocomplete", async (req, res) => {
  try {
    const q = req.query.q;

    if (!q || q.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Query must be at least 2 characters"
      });
    }

    const limit = 10;

    const cacheKey = `autocomplete:${q.toLowerCase()}`;

    let cached;

    try {
      cached = await redisClient.get(cacheKey);
    } catch (err) {
      console.log("⚠️ Redis failed, using DB");
    }

    if (cached) {
      console.log("⚡ Cache HIT - autocomplete");
      return res.json(JSON.parse(cached));
    }

    console.log("🐢 Cache MISS - autocomplete");

    const result = await pool.query(
      `
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

        WHERE 
            LOWER(v.name) LIKE LOWER($1)
            OR LOWER(v.name) LIKE LOWER($2)

        ORDER BY rank, v.name
        LIMIT $3
      `,
      [`${q}%`, `%${q}%`, limit]
    );

    // Format response
    const formatted = result.rows.map(row => ({
      value: row.value,
      label: row.village,
      fullAddress: `${row.village}, ${row.subdistrict}, ${row.district}, ${row.state}, India`,
      hierarchy: {
        village: row.village,
        subDistrict: row.subdistrict,
        district: row.district,
        state: row.state,
        country: "India"
      }
    }));

    const response = {
      success: true,
      count: formatted.length,
      data: formatted
    };

    try {
      await redisClient.setEx(cacheKey, 3600, JSON.stringify(response));
    } catch (err) {
      console.log("⚠️ Redis set failed");
    }

    res.json(response);

  } catch (err) {
    console.error(err);
    res.status(500).send("Error in autocomplete");
  }
});

// -------------------------------
// SEARCH
// -------------------------------

app.get("/api/v1/search", async (req, res) => {
  try {
    const { q, state } = req.query;

    if (!q || q.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Query must be at least 2 characters"
      });
    }

    const limit = parseInt(req.query.limit) || 20;
    const page = parseInt(req.query.page) || 1;
    const offset = (page - 1) * limit;

    const cacheKey = `search:${q.toLowerCase()}:${state || "all"}:p${page}:l${limit}`;

    let cached;

    try {
      cached = await redisClient.get(cacheKey);
    } catch (err) {
      console.log("⚠️ Redis failed, using DB");
    }

    if (cached) {
      console.log("⚡ Cache HIT - search");
      return res.json(JSON.parse(cached));
    }

    console.log("🐢 Cache MISS - search");

    // Build dynamic query
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

      WHERE (
        LOWER(v.name) LIKE LOWER($1)
        OR LOWER(v.name) LIKE LOWER($2)
      )
    `;

    const params = [`${q}%`, `%${q}%`];

    // Optional filter by state code
    if (state) {
      query += ` AND s.code = $3`;
      params.push(state);
    }

    query += `
      ORDER BY rank, v.name
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
    `;

    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Format response
    const formatted = result.rows.map(row => ({
      value: row.value,
      label: row.village,
      fullAddress: `${row.village}, ${row.subdistrict}, ${row.district}, ${row.state}, India`,
      hierarchy: {
        village: row.village,
        subDistrict: row.subdistrict,
        district: row.district,
        state: row.state,
        country: "India"
      }
    }));

    const response = {
      success: true,
      count: formatted.length,
      page,
      limit,
      data: formatted
    };

    try {
      await redisClient.setEx(cacheKey, 3600, JSON.stringify(response));
    } catch (err) {
      console.log("⚠️ Redis set failed");
    }

    res.json(response);

  } catch (err) {
    console.error(err);
    res.status(500).send("Error in search API");
  }
});

//-------------------------------
// HEALTH CHECK
//-------------------------------
app.get("/health", (req, res) => {
  res.json({ status: "OK" });
});

//-------------------------------
//
//-------------------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}

module.exports = app;
