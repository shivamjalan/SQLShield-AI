const pino = require("pino");
const env = require("./env");

// Pretty-printed, colorized output only in local dev -- in "test" (what
// Jest sets by default) logging is silenced so test output stays clean, and
// in "production" (set by the Docker image) plain JSON goes to stdout,
// which is what log aggregators expect and doesn't need the pino-pretty
// worker thread thats only installed as a devDependency anyway.
const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL || "info",
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:standard", ignore: "pid,hostname" } }
      : undefined,
});

module.exports = logger;
