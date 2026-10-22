# 墨舟 (Novel OS) 本地发行容器。
# 基础镜像用 digest 固定（node 22.23.3 / Debian 13 trixie，2026-10-21 解析），
# 既锁定 Node 补丁版本，也锁定整批系统包，避免随 22-trixie-slim 标签漂移。
# 选 trixie 而非 bookworm：bookworm 仍有 1 危急（zlib1g，Debian will_not_fix）
# 与 56 条无修复版本的高危；同一天的 trixie 镜像为 0 危急 / 43 条无修复高危。
FROM node:22.23.3-trixie-slim@sha256:28d03803f09ba76560e273af33beb7eda4ed68fa0698bc9bd15e9a6e35693923 AS builder

WORKDIR /app

ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip

RUN npm install -g pnpm@9.15.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# patches/ 必须随 package.json 的 patchedDependencies 一起进镜像：
# pnpm install --frozen-lockfile 读取补丁文件，缺它则安装直接 ENOENT。
COPY patches ./patches
COPY packages ./packages
COPY apps ./apps
COPY scripts ./scripts
COPY tsconfig.base.json tsconfig.json ./

RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm --filter @mozhou/web build

# 只把生产依赖部署到 /out：pnpm deploy --prod 从既有 store 生成裁剪后的
# node_modules，vitest / vite / esbuild / typescript 等 devDependencies 不会
# 进入运行层。旧镜像把 builder 的整个 node_modules 复制进运行层，Trivy 的
# 24 条 Node.js 告警（tar、tinypool、vite、brace-expansion 等）与 26 条
# esbuild Go 二进制告警全部来自这些从不参与运行的开发依赖。
# 运行期只需要 dist（前端静态资源）、dist-server（编译后的服务端）、package.json
# 与 node_modules；源码/测试/原型/构建配置一律不进运行层。
RUN pnpm --filter @mozhou/web deploy --prod /out \
 && rm -rf /out/src /out/server /out/shared /out/prototypes /out/release-artifacts /out/public \
           /out/index.html /out/vite.config.ts /out/vitest.config.ts \
           /out/tsconfig.json /out/tsconfig.server.json \
           /out/DESIGN.md /out/MOBILE_UI_BRIEF.md /out/README.md \
           /out/.mimosa /out/.mozhou_data

FROM node:22.23.3-trixie-slim@sha256:28d03803f09ba76560e273af33beb7eda4ed68fa0698bc9bd15e9a6e35693923 AS runner

WORKDIR /app

# 运行期不需要 npm/npx/corepack。官方 Node 镜像自带的 npm 会带进 11 条 HIGH
# （brace-expansion、pacote、sigstore、picomatch 等），删掉即可从扫描面移除。
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

ENV NODE_ENV=production
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip
ENV PORT=5173
# 容器内部监听所有接口；docker-compose 只映射到宿主 127.0.0.1。
ENV HOST=0.0.0.0

# 数据根 = 卷挂载点。目录在镜像内预建并归 node 所有：命名卷首次挂载会继承该属主，
# 缺这一步则非 root 的 node 用户无权写入，书稿无法落盘。
ENV MOZHOU_DATA_ROOT=/data
RUN mkdir -p /data && chown node:node /data

# node 官方镜像内置 uid/gid 1000 的非 root 用户；运行期文件归其所有。
COPY --chown=node:node --from=builder /out /app

USER node

EXPOSE 5173

CMD ["node", "dist-server/productionServer.js"]
