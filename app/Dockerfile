# 墨舟 Web 应用（生产镜像）
# BASE_IMAGE 可覆盖：镜像源受限环境构建时传 --build-arg BASE_IMAGE=镜像源/library/node:22-alpine
ARG BASE_IMAGE=node:22-alpine
FROM ${BASE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM ${BASE_IMAGE} AS builder
WORKDIR /app
# 构建期占位（next build 收集路由模块时校验生产必需 env；占位仅存于构建阶段，不进最终镜像）
# 运行时真实值由 Cloud Run env / Secret Manager 注入
ARG AUTH_SECRET=build-time-placeholder
ARG DATABASE_URL=postgres://placeholder:placeholder@localhost:5432/placeholder
ENV AUTH_SECRET=$AUTH_SECRET DATABASE_URL=$DATABASE_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM ${BASE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Cloud Run 会注入 HOSTNAME（实例名）；Next standalone 用 HOSTNAME 绑定监听地址 → 必须固定 0.0.0.0
ENV HOSTNAME=0.0.0.0
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
