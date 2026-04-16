const crypto = require("crypto");

/**
 * Generates a unique API key with "ak_" prefix for easy identification.
 * Prefix prevents raw hex strings that are hard to spot in logs/debug.
 */
function generateApiKey() {
  return "ak_" + crypto.randomBytes(24).toString("hex");
}

/**
 * Generates a strong API secret with "as_" prefix.
 * Stored as bcrypt hash — this plain value is returned once and never again.
 */
function generateApiSecret() {
  return "as_" + crypto.randomBytes(32).toString("hex");
}

module.exports = { generateApiKey, generateApiSecret };