# Two stages so the final image doesn't need to carry python3/make/g++ --
# they're only needed to compile bcrypt's native binding during install.
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src

EXPOSE 4000

# Runs the schema migration and target_db seed (both idempotent -- safe to
# re-run on every container start) before starting the server, so
# `docker compose up` needs zero manual setup steps. migrate.js itself
# retries against Postgres with backoff (src/db/waitForDb.js), so this also
# tolerates the backend container starting a moment before Postgres is
# actually ready to accept connections.
CMD ["sh", "-c", "node src/db/migrate.js && node src/db/seedTarget.js && node src/server.js"]
