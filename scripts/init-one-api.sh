#!/usr/bin/env bash
# 墨舟 one-api 初始化：登录 → 创建 DeepSeek/Qwen 渠道 → 创建应用令牌
# 用法: DEEPSEEK_API_KEY=sk-xxx QWEN_API_KEY=sk-xxx bash scripts/init-one-api.sh
set -euo pipefail

BASE="${ONE_API_BASE:-http://localhost:3001}"
USER="${ONE_API_USER:-root}"
PASS="${ONE_API_PASS:-123456}"
DEEPSEEK_KEY="${DEEPSEEK_API_KEY:-sk-placeholder-deepseek}"
QWEN_KEY="${QWEN_API_KEY:-sk-placeholder-qwen}"

echo "==> 登录 one-api ($BASE)"
rm -f /tmp/mozhou-ow-cookies.txt
LOGIN_CODE=$(curl -s -m 10 -c /tmp/mozhou-ow-cookies.txt -X POST "$BASE/api/user/login" -H "Content-Type: application/json" \
  -d "{\"username\":\"$USER\",\"password\":\"$PASS\"}" -o /dev/null -w "%{http_code}")
if [ "$LOGIN_CODE" != "200" ]; then
  echo "登录失败 (HTTP $LOGIN_CODE)：请确认 ONE_API_PASS（默认 123456，见容器日志）"; exit 1
fi
CURL="curl -s -m 10 -b /tmp/mozhou-ow-cookies.txt -L"

echo "==> 创建 DeepSeek 渠道"
$CURL -X POST "$BASE/api/channel/" -H "Content-Type: application/json" \
  -d "{\"type\":1,\"name\":\"deepseek\",\"key\":\"$DEEPSEEK_KEY\",\"base_url\":\"https://api.deepseek.com\",\"models\":\"deepseek-chat,deepseek-reasoner\"}" | head -c 200; echo

echo "==> 创建 Qwen 渠道"
$CURL -X POST "$BASE/api/channel/" -H "Content-Type: application/json" \
  -d "{\"type\":1,\"name\":\"qwen\",\"key\":\"$QWEN_KEY\",\"base_url\":\"https://dashscope.aliyuncs.com/compatible-mode/v1\",\"models\":\"qwen-plus,qwen-turbo\"}" | head -c 200; echo

echo "==> 创建应用令牌 (mozhou-app)"
$CURL -X POST "$BASE/api/token/" -H "Content-Type: application/json" \
  -d '{"name":"mozhou-app","remain_quota":500000000,"expired_time":-1,"unlimited_quota":true}' | head -c 200; echo

echo "==> 完成。若渠道 key 为占位符，请在 one-api 控制台 (http://localhost:3001) 填入真实 API Key。"
