# Build and run the Sendex worker (send loop, scheduler, public API, postbacks).
# Built from the monorepo root: docker build -f apps/worker/Dockerfile .
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@10.34.7 --activate

FROM base AS deps
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/providers/package.json packages/providers/
COPY packages/redis-utils/package.json packages/redis-utils/
# --ignore-scripts: the root `prepare` runs `lefthook install`, which needs git; nothing the
# worker depends on has a native build step.
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @sendex/worker...

FROM deps AS build
COPY apps/worker apps/worker
COPY packages/core packages/core
COPY packages/db packages/db
COPY packages/providers packages/providers
COPY packages/redis-utils packages/redis-utils
# esbuild bundles the workspace packages (TypeScript sources) into dist/index.js; npm
# dependencies stay external and are resolved from node_modules (apps/worker/scripts/build.mjs).
RUN pnpm --filter @sendex/worker run build

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/worker/dist/index.js"]
