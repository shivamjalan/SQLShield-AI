const Redis = require("ioredis");
const env = require("./env");
const logger = require("./logger");

const WINDOW_SECONDS = 60;
const MAX_REQUESTS_PER_WINDOW = 30;

const redis = new Redis(env.REDIS_URL, {
  // Don't open a TCP connection until the first command actually runs --
  // routes/modules that require this file but never call `rateLimit` (most
  // test suites) never touch the network at all.
  lazyConnect: true,
  // Rate limiting should degrade gracefully, not hang requests: give up on
  // a command quickly rather than queueing it indefinitely, and stop
  // trying to reconnect after a few attempts rather than retrying forever.
  maxRetriesPerRequest: 1,
  retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 2000)),
});

redis.on("error", (err) => {
  logger.error({ event: "redis_error", err: err.message }, "Redis client error");
});

// Fixed-window counter via INCR+EXPIRE: simple and standard for per-user
// rate limiting. Fails OPEN (lets the request through) if Redis itself is
// unreachable -- rate limiting exists to protect against abuse, but the
// security/policy engines are what actually gate query safety, so a Redis
// outage should degrade availability gracefully rather than take the whole
// API down with it.
async function rateLimit(req, res, next) {
  const key = `ratelimit:query:${req.user.id}`;

  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, WINDOW_SECONDS);
    }

    if (count > MAX_REQUESTS_PER_WINDOW) {
      logger.warn({ event: "rate_limit_hit", userId: req.user.id, count }, "Rate limit exceeded");
      return res.status(429).json({
        error: `Rate limit exceeded: max ${MAX_REQUESTS_PER_WINDOW} queries per minute`,
      });
    }

    next();
  } catch (err) {
    logger.error({ event: "rate_limit_error", err: err.message }, "Rate limiter failed open due to a Redis error");
    next();
  }
}

module.exports = { redis, rateLimit };
