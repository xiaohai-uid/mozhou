# 墨舟 (Novel OS) 本地发行容器。
# 基础镜像固定到已验证的 Node 22 补丁版本，避免随 22-bookworm-slim 漂移。
FROM node:22.23.2-bookworm-slim AS builder

WORKDIR /app

ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip

RUN npm install -g pnpm@9.15.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY apps ./apps
COPY scripts ./scripts
COPY tsconfig.base.json tsconfig.json ./

RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm --filter @mozhou/web build

FROM node:22.23.2-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip
ENV PORT=5173
# 容器内部监听所有接口；docker-compose 只映射到宿主 127.0.0.1。
ENV HOST=0.0.0.0

# node 官方镜像内置 uid/gid 1000 的非 root 用户；运行期文件归其所有。
COPY --chown=node:node --from=builder /app /app

USER node

EXPOSE 5173

CMD ["node", "apps/web/dist-server/productionServer.js"]
