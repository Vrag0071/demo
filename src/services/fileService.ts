import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { BotContext } from "../types";
import { config } from "../config";

export const ensureStorageDirs = async () => {
  await fs.mkdir(config.uploadsDir, { recursive: true });
  await fs.mkdir(config.exportsDir, { recursive: true });
};

export const saveTelegramPhoto = async (ctx: BotContext, fileId: string): Promise<string> => {
  await fs.mkdir(config.uploadsDir, { recursive: true });
  const link = await ctx.telegram.getFileLink(fileId);
  const response = await fetch(link);

  if (!response.ok) {
    throw new Error(`Telegram file download failed: ${response.status} ${response.statusText}`);
  }

  const extension = path.extname(link.pathname) || ".jpg";
  const fileName = `${Date.now()}-${randomUUID()}${extension}`;
  const localPath = path.join(config.uploadsDir, fileName);
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(localPath, bytes);
  return localPath;
};
