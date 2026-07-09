import type { BotContext } from "../types";
import { prisma } from "../db/prisma";
import { roleFromEnv } from "../config";
import { UserRole, type UserRole as UserRoleType } from "../domain";

export const canModerate = (role: string): boolean =>
  role === UserRole.MODERATOR || role === UserRole.ADMIN;

export const isAdmin = (role: string): boolean => role === UserRole.ADMIN;

export const ensureUser = async (ctx: BotContext) => {
  if (!ctx.from) return null;

  const telegramId = String(ctx.from.id);
  const envRole = roleFromEnv(telegramId);
  const existing = await prisma.user.findUnique({ where: { telegramId } });

  if (!envRole && !existing) return null;

  const role = envRole ?? existing?.role ?? UserRole.EMPLOYEE;

  return prisma.user.upsert({
    where: { telegramId },
    update: {
      username: ctx.from.username ?? null,
      firstName: ctx.from.first_name ?? null,
      role
    },
    create: {
      telegramId,
      username: ctx.from.username ?? null,
      firstName: ctx.from.first_name ?? null,
      role
    }
  });
};

export const listUsers = () =>
  prisma.user.findMany({ orderBy: [{ role: "asc" }, { createdAt: "asc" }] });

export const addUser = (telegramId: string, role: UserRoleType) =>
  prisma.user.upsert({
    where: { telegramId },
    update: { role },
    create: { telegramId, role }
  });

export const setUserRole = (telegramId: string, role: UserRoleType) =>
  prisma.user.update({ where: { telegramId }, data: { role } });

export const moderatorsAndAdmins = () =>
  prisma.user.findMany({
    where: { role: { in: [UserRole.MODERATOR, UserRole.ADMIN] } }
  });
