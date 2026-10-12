const express = require("express");
const cors = require("cors");
const env = require("./config/env");
const authRoutes = require("./auth/routes");
const queryRoutes = require("./routes/query");
const policiesRoutes = require("./routes/policies");
const auditRoutes = require("./routes/audit");
const optimizeRoutes = require("./routes/optimize");
const usersRoutes = require("./routes/users");
const { authenticate } = require("./auth/middleware");
const { seedPolicies } = require("./db/seedPolicies");
const logger = require("./config/logger");

const app = express();

const allowedOrigins = [
  "http://localhost:5173",
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth", authRoutes);

app.get("/api/me", authenticate, (req, res) => {
  res.json({ user: req.user });
});

app.use("/api", queryRoutes);
app.use("/api", policiesRoutes);
app.use("/api", auditRoutes);
app.use("/api", optimizeRoutes);
app.use("/api", usersRoutes);

if (require.main === module) {
  seedPolicies()
    .catch((err) => logger.error({ event: "policy_seed_failed", err: err.message }, "Failed to seed default policies"))
    .finally(() => {
      app.listen(env.PORT, () => {
        logger.info({ event: "server_started", port: env.PORT }, `SQLShield backend listening on port ${env.PORT}`);
      });
    });
}

module.exports = app;
