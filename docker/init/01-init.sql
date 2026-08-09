-- 墨舟 Postgres 初始化（首次创建 volume 时执行）
-- 启用 pgvector 扩展（RAG 向量检索，工单 06）
CREATE EXTENSION IF NOT EXISTS vector;
