FROM node:22-alpine AS build
RUN apk add --no-cache openssh-client python3 make g++ git
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @opsvault/shared build \
 && pnpm --filter @opsvault/server build \
 && pnpm --filter @opsvault/web build

FROM node:22-alpine AS runtime
RUN apk add --no-cache openssh-client
ARG GIT_COMMIT=dev
ARG BUILD_DATE=
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/app/data \
    GIT_COMMIT=${GIT_COMMIT} \
    BUILD_DATE=${BUILD_DATE}
WORKDIR /app
COPY --from=build /app /app
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/v1/health >/dev/null 2>&1 || exit 1
CMD ["node", "apps/server/dist/main.js"]
