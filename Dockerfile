# 墨舟 (Novel OS) 生产级容器化部署镜像
FROM node:22-bookworm-slim AS builder

WORKDIR /app

ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip

# 安装 pnpm
RUN npm install -g pnpm@9.15.0

# 复制依赖配置与源码
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY apps ./apps
COPY scripts ./scripts
COPY tsconfig.base.json tsconfig.json ./

# 安装依赖并构建
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm --filter @mozhou/web build

# 生产运行阶段
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip
ENV PORT=5173
ENV HOST=0.0.0.0

RUN npm install -g pnpm@9.15.0

COPY --from=builder /app /app

EXPOSE 5173

CMD ["pnpm", "--filter", "@mozhou/web", "preview", "--port", "5173", "--host", "0.0.0.0"]
