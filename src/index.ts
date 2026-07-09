import { createBot } from "./bot";
import { prisma } from "./db/prisma";
import { ensureStorageDirs } from "./services/fileService";

const bootstrap = async () => {
  await ensureStorageDirs();
  const bot = createBot();

  await bot.launch();
  console.log("Catalog Flow Bot is running with long polling.");

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}. Stopping bot...`);
    bot.stop(signal);
    await prisma.$disconnect();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
};

bootstrap().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
