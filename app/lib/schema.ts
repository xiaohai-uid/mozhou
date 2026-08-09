import {
  integer,
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

/** 对话会话（04 工单；novel_id 留 05 小说项目绑定） */
export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("新会话"),
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
