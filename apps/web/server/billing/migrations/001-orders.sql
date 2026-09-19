-- 001-orders.sql 独立订单与履约数据表架构迁移
-- 核心约束补足 C4，不修改约束让测试通过

CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  price_version TEXT NOT NULL,
  amount_fen INTEGER NOT NULL CHECK(amount_fen > 0),
  currency TEXT NOT NULL DEFAULT 'CNY',
  state TEXT NOT NULL,
  provider_transaction_id TEXT,
  checkout_url TEXT,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS orders_user_idempotency ON orders(user_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS orders_provider_tx ON orders(channel, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_events (
  event_id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  order_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  raw_payload TEXT NOT NULL,
  received_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_events_unique ON payment_events(channel, event_id);

CREATE TABLE IF NOT EXISTS entitlement_grants (
  grant_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  granted_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS grants_once_per_order ON entitlement_grants(order_id);
