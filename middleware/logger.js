const pool = require("../db");

const loggerMiddleware = (req, res, next) => {
  // Capture start time BEFORE next()
  const start = Date.now();
  const apiKey = req.user?.apiKey || req.headers["x-api-key"] || "unknown";
  const userId = req.user?.id || null;

  // Call next() immediately — never block the response
  next();

  res.on("finish", () => {
    // responseMs measured dynamically
    const responseMs  = Date.now() - start;
    const statusCode  = res.statusCode;
    // req.originalUrl is crucial; req.path drops query params (e.g. ?q=Ambe)
    const endpoint    = req.originalUrl || req.path;
    const method      = req.method;
    const ip          = req.ip || req.connection?.remoteAddress || "unknown";

    // setImmediate ensures DB write happens after the response is fully sent
    setImmediate(() => {
      // Note: We'd need to add user_id column to api_logs if we strictly want it,
      // but for now we simply log what we can. 
      pool.query(
        `INSERT INTO api_logs (api_key, endpoint, method, status_code, response_ms, ip)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [apiKey, endpoint, method, statusCode, responseMs, ip]
      ).catch((err) => {
        // Silent fail — logging should never crash the API
        console.error("Logger insert failed:", err.message);
      });
    });
  });
};

module.exports = loggerMiddleware;
