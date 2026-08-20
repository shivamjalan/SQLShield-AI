require("dotenv").config();

module.exports = {
  PORT: process.env.PORT || 4000,
  NODE_ENV: process.env.NODE_ENV || "development",
  LOG_LEVEL: process.env.LOG_LEVEL,
  DATABASE_URL: process.env.DATABASE_URL,
  // Separate Postgres database representing the "protected" business DB the
  // optimizer runs EXPLAIN ANALYZE against -- kept apart from the app's own
  // sqlshield_core DB so optimizer index experiments never touch app data.
  TARGET_DATABASE_URL: process.env.TARGET_DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  LLM_API_KEY: process.env.LLM_API_KEY,
  // NaraRouter's OpenAI-compatible endpoint by default -- override via env
  // to point at a different OpenAI-compatible provider.
  LLM_BASE_URL: process.env.LLM_BASE_URL || "https://router.bynara.id/v1",
  LLM_MODEL: process.env.LLM_MODEL || "agnes-2.0-flash",
};
