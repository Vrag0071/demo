import path from "node:path";
import dotenv from "dotenv";
import { UserRole, type UserRole as UserRoleType } from "./domain";

dotenv.config();

const parseIds = (value?: string): string[] =>
  (value ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

export const config = {
  botToken: required("BOT_TOKEN"),
  adminTelegramIds: parseIds(process.env.ADMIN_TELEGRAM_IDS),
  moderatorTelegramIds: parseIds(process.env.MODERATOR_TELEGRAM_IDS),
  uploadsDir: path.resolve(process.cwd(), "uploads", "products"),
  exportsDir: path.resolve(process.cwd(), "exports")
};

export const roleFromEnv = (telegramId: string): UserRoleType | null => {
  if (config.adminTelegramIds.includes(telegramId)) return UserRole.ADMIN;
  if (config.moderatorTelegramIds.includes(telegramId)) return UserRole.MODERATOR;
  return null;
};

export const envAllowedIds = new Set([
  ...config.adminTelegramIds,
  ...config.moderatorTelegramIds
]);
