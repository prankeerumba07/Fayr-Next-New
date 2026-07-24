# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Builder — installs ALL deps (incl. dev), generates the Prisma client, compiles
# TypeScript, then prunes dev deps in place. Building and pruning in the same
# Debian base as the runner keeps the native argon2 binary and the Prisma query
# engine ABI-compatible with the runtime image.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app

# Build toolchain for native modules (argon2 compiles from source when no
# prebuilt binary matches the platform, e.g. linux/arm64), plus openssl so the
# postinstall `prisma generate` detects OpenSSL 3.x and emits the matching query
# engine. Builder-only — the runner copies the already-compiled artifacts.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ openssl \
  && rm -rf /var/lib/apt/lists/*

# Install deps first (better layer caching). The prisma schema must be present
# because the postinstall hook runs `prisma generate`.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# Compile.
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# Strip dev dependencies without reinstalling — keeps the already-built argon2
# native binary and the generated Prisma client under node_modules/.prisma.
RUN npm prune --omit=dev

# ─────────────────────────────────────────────────────────────────────────────
# Runner — a lean, non-root image with only production node_modules + dist.
# No build toolchain, no dev deps, no source.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# node:20-slim ships without OpenSSL; Prisma's query engine needs libssl to load.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# Copy the pruned deps, compiled output, and schema (for reference / running
# migrations from this image if desired). `node` is a built-in unprivileged user.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/prisma ./prisma

USER node
EXPOSE 3000

# Liveness check using Node itself (no curl in the slim image). Hits /health,
# which is dependency-free and answers even when the database is down.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/main.js"]
