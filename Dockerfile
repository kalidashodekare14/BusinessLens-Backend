# syntax=docker/dockerfile:1

# One image serves both the API and the worker; docker-compose overrides the
# command for the worker. The `build` stage is also used by the one-shot
# `migrate` service because it keeps the Prisma CLI.

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV npm_config_update_notifier=false
# Prisma detects the OpenSSL version at generate/run time; slim images omit it.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --include=dev

FROM deps AS build
COPY . .
RUN npx prisma generate && npm run build

FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
