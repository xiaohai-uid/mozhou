import { pgEnum, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/** 会员等级（11 工单消费） */
export const tierEnum = pgEnum("tier", ["free", "member"]);

/** 用户（02 工单扩展认证字段） */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  tier: tierEnum("tier").notNull().default("free"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
