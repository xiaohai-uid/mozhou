import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** 会员等级（11 工单消费） */
export const tierEnum = pgEnum("tier", ["free", "member"]);

/** 对话消息角色（04 工单） */
export const messageRoleEnum = pgEnum("message_role", ["user", "assistant"]);

/** 用户（02 工单扩展认证字段） */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  tier: tierEnum("tier").notNull().default("free"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** 对话会话（04 工单；novelId 绑定当前写作作品，06 工单 R3 决策落地） */
export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("新会话"),
  novelId: integer("novel_id").references(() => novels.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** 对话消息（04 工单） */
export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  role: messageRoleEnum("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** 章节状态（05 工单） */
export const chapterStatusEnum = pgEnum("chapter_status", ["draft", "final"]);

/** 小说项目（05 工单；sessions.novel_id 绑定由此表承载） */
export const novels = pgTable("novels", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  /** RAG 注入开关（06 收尾：projects 页开关绑定，false 时对话不检索该作品设定） */
  ragEnabled: boolean("rag_enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** 章节（05 工单） */
export const chapters = pgTable("chapters", {
  id: serial("id").primaryKey(),
  novelId: integer("novel_id")
    .notNull()
    .references(() => novels.id, { onDelete: "cascade" }),
  ch: text("ch").notNull(), // 章节号（"001"）
  title: text("title").notNull(),
  status: chapterStatusEnum("status").notNull().default("draft"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** 人物库条目（05 工单） */
export const characterEntries = pgTable("character_entries", {
  id: serial("id").primaryKey(),
  novelId: integer("novel_id")
    .notNull()
    .references(() => novels.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** 世界观条目（05 工单） */
export const worldviewEntries = pgTable("worldview_entries", {
  id: serial("id").primaryKey(),
  novelId: integer("novel_id")
    .notNull()
    .references(() => novels.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** 用量事件（11 工单）：每次 LLM 调用记账一行，/api/v1/account 聚合展示 */
export const usageEvents = pgTable("usage_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** 功能节点：写作对话/风格蒸馏/小说拆解/抽卡模式 */
  nodeType: text("node_type").notNull(),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** 书架（08 工单）：从书源导入的书，供阅读参考与拆解 */
export const shelfBooks = pgTable("shelf_books", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  source: text("source").notNull(),
  author: text("author"),
  site: text("site"),
  status: text("status"),
  importedAt: timestamp("imported_at").notNull().defaultNow(),
});

/** 技能（任务二-A）：声明式技能 = 名称 + 说明 + 系统提示词，chat 可加载注入 */
export const skills = pgTable("skills", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  /** 广场来源：墨舟官方 / 社区 */
  author: text("author").notNull().default("自定义"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** WebDAV 同步配置（任务二-C）：每用户一条，保存后连接测试 */
export const syncConfigs = pgTable("sync_configs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  username: text("username").notNull(),
  /** 应用密码（存储为明文是权衡；生产应加密，见 AGENTS.md 基建备注） */
  password: text("password").notNull(),
  autoSync: boolean("auto_sync").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** 风格指南（蒸馏产物，四维）——POST /distill 返回、styles 表存储、chat 按 styleId 注入（工单 14/15） */
export interface StyleGuide {
  narrative: string; // 叙事视角
  sentence: string; // 句式节奏
  imagery: string; // 意象偏好
  rhythm: string; // 情绪节奏
}

/** 风格库（工单 14）：用户保存的风格指南，命名/列表/删除；同名允许（与 skills 一致，无唯一约束） */
export const styles = pgTable("styles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  guide: jsonb("guide_json").$type<StyleGuide>().notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
