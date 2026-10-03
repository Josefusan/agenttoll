# Founder dashboard. The admin token stays server-side (route handlers proxy the gateway).
FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-slim
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production
COPY --from=build /app ./
USER node
EXPOSE 3000
# Binds all interfaces inside the container; docker-compose decides what the host exposes.
CMD ["pnpm", "exec", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
