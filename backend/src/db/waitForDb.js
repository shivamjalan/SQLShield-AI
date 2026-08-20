const logger = require("../config/logger");

// Retries `attempt` with backoff until it resolves. Used at the start of
// migrate.js/seedTarget.js (the first things that run on container boot)
// so a backend container that starts a moment before Postgres finishes
// accepting connections waits and retries instead of crashing outright --
// belt-and-suspenders alongside docker-compose's own healthcheck/depends_on.
async function waitFor(label, attempt, { retries = 30, delayMs = 1000 } = {}) {
  for (let i = 1; i <= retries; i++) {
    try {
      await attempt();
      logger.info({ event: "dependency_ready", label, attempts: i }, `${label} is ready`);
      return;
    } catch (err) {
      if (i === retries) {
        logger.error(
          { event: "dependency_unreachable", label, attempts: i, err: err.message },
          `${label} did not become ready in time`
        );
        throw err;
      }
      logger.warn(
        { event: "dependency_wait", label, attempt: i, retries },
        `${label} not ready yet (attempt ${i}/${retries}), retrying in ${delayMs}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

module.exports = { waitFor };
