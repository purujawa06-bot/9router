# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS base
WORKDIR /app
# CN mirror is opt-in (local builds in China): --build-arg USE_CN_MIRROR=1
# Default off — GitHub Actions runners are outside CN and the Aliyun/npmmirror
# endpoints slow the build down there.
ARG USE_CN_MIRROR=0
RUN if [ "$USE_CN_MIRROR" = "1" ]; then \
      sed -i 's|dl-cdn.alpinelinux.org|mirrors.aliyun.com|g' /etc/apk/repositories && \
      npm config set registry https://registry.npmmirror.com; \
    fi

FROM base AS builder

# NOTE: package-lock.json is gitignored in this repo, so only package.json is
# copied. If a lockfile is committed later, add it to the COPY for `npm ci`.
COPY package.json ./
# Full install (devDeps needed for `next build`). better-sqlite3 is optional:
# its prebuilt musl binary is fetched, no python3/make/g++ needed. If the
# prebuilt is ever missing the optional install fails open and sql.js is used.
RUN --mount=type=cache,target=/root/.npm \
  npm install --no-audit --no-fund

COPY . ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM base AS runner

LABEL org.opencontainers.image.title="9router"

ENV NODE_ENV=production
ENV PORT=20128
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATA_DIR=/app/data

# Slim runtime: production deps only (no devDeps, no build tools).
COPY package.json ./
RUN --mount=type=cache,target=/root/.npm \
  npm install --omit=dev --no-audit --no-fund

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/custom-server.js ./custom-server.js
COPY --from=builder /app/open-sse ./open-sse
# Next file tracing can omit sibling files; MITM runs server.js as a separate process.
COPY --from=builder /app/src/mitm ./src/mitm

RUN mkdir -p /app/data && chown -R node:node /app && \
  mkdir -p /app/data-home && chown node:node /app/data-home && \
  ln -sf /app/data-home /root/.9router 2>/dev/null || true

# No `apk upgrade` here (slow on every build) — only su-exec for the entrypoint.
RUN apk --no-cache add su-exec && \
  printf '#!/bin/sh\nchown -R node:node /app/data /app/data-home 2>/dev/null\nexec su-exec node "$@"\n' > /entrypoint.sh && \
  chmod +x /entrypoint.sh

EXPOSE 20128

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "custom-server.js"]
