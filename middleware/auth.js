const pool = require("../db");
const bcrypt = require("bcrypt");

const authMiddleware = async (req, res, next) => {
  try {
    const apiKey = req.headers["x-api-key"];
    const apiSecret = req.headers["x-api-secret"];

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        message: "API key missing. Pass x-api-key header."
      });
    }

    if (!apiSecret) {
      return res.status(401).json({
        success: false,
        message: "API secret missing. Pass x-api-secret header."
      });
    }

    // Look up the api_key row (contains the hash)
    const keyResult = await pool.query(
      `SELECT ak.*, u.plan, u.name, u.email
       FROM api_keys ak
       JOIN users u ON ak.user_id = u.id
       WHERE ak.api_key = $1`,
      [apiKey]
    );

    if (keyResult.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Invalid API key"
      });
    }

    const keyRow = keyResult.rows[0];

    // Compare provided secret against stored bcrypt hash
    const secretValid = await bcrypt.compare(apiSecret, keyRow.api_secret_hash);

    if (!secretValid) {
      return res.status(403).json({
        success: false,
        message: "Invalid API secret"
      });
    }

    // Attach full user + plan to request
    req.user = {
      id: keyRow.user_id,
      name: keyRow.name,
      email: keyRow.email,
      plan: keyRow.plan || "free",
      apiKey: keyRow.api_key
    };

    next();

  } catch (err) {
    console.error("Auth error:", err);
    res.status(500).json({ success: false, message: "Auth error" });
  }
};

module.exports = authMiddleware;