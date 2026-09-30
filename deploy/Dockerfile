# syntax=docker/dockerfile:1
# One image for both "app" (Next.js standalone) and "worker" (pg-boss + Playwright Chromium).

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH TZ=Asia/Bangkok
RUN corepack enable

FROM base AS deps
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build            # next build (output: 'standalone') + tsup → dist/worker, dist/scripts

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 MIGRATIONS_DIR=/app/db/migrations
# Chromium + Thai fonts for PDF rendering (worker). ~300 MB; acceptable for one shared image.
RUN npx -y playwright@1 install --with-deps chromium && \
    apt-get update && apt-get install -y --no-install-recommends fonts-thai-tlwg && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/.next/standalone ./
COPY --from=build /src/.next/static ./.next/static
COPY --from=build /src/public ./public
COPY --from=build /src/dist/worker ./worker
COPY --from=build /src/dist/scripts ./scripts
COPY --from=build /src/db/migrations ./db/migrations
COPY --from=build /src/fonts ./fonts
RUN useradd -r -u 10001 zw && mkdir -p /data && chown -R zw /data /app
USER zw
EXPOSE 3000
CMD ["node", "server.js"]
