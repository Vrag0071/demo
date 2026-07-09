import { Markup, session, Telegraf } from "telegraf";
import { config } from "./config";
import type { BotContext } from "./types";
import { registerProductFlow, handleProductText, mainMenu, startProductFlow } from "./flows/productFlow";
import { handleModerationText, registerModerationFlow } from "./flows/moderationFlow";
import { exportApprovedProducts } from "./services/exportService";
import { ensureUser, isAdmin, listUsers, addUser, setUserRole, canModerate } from "./services/userService";
import { listMySubmissions } from "./services/productService";
import { createServicePackageFromBot, listServicePackages } from "./services/packageService";
import { UserRole, type UserRole as UserRoleType } from "./domain";

const helpText = [
  "Catalog Flow Bot",
  "",
  "Employee:",
  "- Add product: create a new product card.",
  "- Update product: submit an update for an existing product.",
  "- My submissions: see your latest submissions and statuses.",
  "",
  "Moderator:",
  "- /pending: review submitted cards.",
  "",
  "Admin:",
  "- /users",
  "- /add_user TELEGRAM_ID ROLE",
  "- /set_role TELEGRAM_ID ROLE",
  "- /export",
  "- /packages",
  "- /add_package segment | name | items | price | description",
  "",
  "Use /cancel to stop the current flow."
].join("\n");

const parseRole = (role?: string): UserRoleType | null => {
  if (!role) return null;
  const normalized = role.toUpperCase();
  if (normalized === UserRole.EMPLOYEE) return UserRole.EMPLOYEE;
  if (normalized === UserRole.MODERATOR) return UserRole.MODERATOR;
  if (normalized === UserRole.ADMIN) return UserRole.ADMIN;
  return null;
};

const renderMySubmissions = async (ctx: BotContext) => {
  if (!ctx.currentUser) return;
  const submissions = await listMySubmissions(ctx.currentUser.id);
  if (submissions.length === 0) {
    await ctx.reply("You do not have submissions yet.", mainMenu());
    return;
  }

  for (const submission of submissions) {
    const lines = [
      `#${submission.id} ${submission.submissionType}`,
      `Status: ${submission.status}`,
      `Product: ${submission.productName}`,
      `Created: ${submission.createdAt.toISOString()}`,
      submission.moderationComment ? `Comment: ${submission.moderationComment}` : undefined
    ].filter(Boolean);

    await ctx.reply(
      lines.join("\n"),
      submission.status === "CHANGES_REQUESTED"
        ? Markup.inlineKeyboard([[Markup.button.callback("Edit submission", `edit_submission:${submission.id}`)]])
        : undefined
    );
  }
};

export const createBot = () => {
  const bot = new Telegraf<BotContext>(config.botToken);

  bot.use(session({ defaultSession: () => ({}) }));

  bot.use(async (ctx, next) => {
    const user = await ensureUser(ctx);
    if (!user) {
      await ctx.reply("Access denied. Please contact administrator.");
      return;
    }
    ctx.currentUser = user;
    return next();
  });

  bot.start(async (ctx) => {
    await ctx.reply(
      "Welcome to Catalog Flow Bot. Choose an action:",
      mainMenu()
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(helpText, mainMenu());
  });

  bot.command("cancel", async (ctx) => {
    ctx.session.productFlow = undefined;
    ctx.session.moderationAction = undefined;
    await ctx.reply("Current flow cancelled.", mainMenu());
  });

  bot.command("my", renderMySubmissions);

  bot.command("users", async (ctx) => {
    if (!ctx.currentUser || !isAdmin(ctx.currentUser.role)) {
      await ctx.reply("This command is available only for admins.");
      return;
    }
    const users = await listUsers();
    if (users.length === 0) {
      await ctx.reply("No users found.");
      return;
    }
    await ctx.reply(
      users
        .map((user) => `${user.telegramId} | ${user.role} | ${user.username ?? "-"} | ${user.firstName ?? "-"}`)
        .join("\n")
    );
  });

  bot.command("add_user", async (ctx) => {
    if (!ctx.currentUser || !isAdmin(ctx.currentUser.role)) {
      await ctx.reply("This command is available only for admins.");
      return;
    }

    const [, telegramId, roleInput] = ctx.message.text.trim().split(/\s+/);
    const role = parseRole(roleInput);
    if (!telegramId || !role) {
      await ctx.reply("Usage: /add_user TELEGRAM_ID ROLE\nRoles: EMPLOYEE, MODERATOR, ADMIN");
      return;
    }
    await addUser(telegramId, role);
    await ctx.reply(`User ${telegramId} added as ${role}.`);
  });

  bot.command("set_role", async (ctx) => {
    if (!ctx.currentUser || !isAdmin(ctx.currentUser.role)) {
      await ctx.reply("This command is available only for admins.");
      return;
    }

    const [, telegramId, roleInput] = ctx.message.text.trim().split(/\s+/);
    const role = parseRole(roleInput);
    if (!telegramId || !role) {
      await ctx.reply("Usage: /set_role TELEGRAM_ID ROLE\nRoles: EMPLOYEE, MODERATOR, ADMIN");
      return;
    }
    await setUserRole(telegramId, role);
    await ctx.reply(`User ${telegramId} role changed to ${role}.`);
  });

  bot.command("export", async (ctx) => {
    if (!ctx.currentUser || !isAdmin(ctx.currentUser.role)) {
      await ctx.reply("This command is available only for admins.");
      return;
    }

    const result = await exportApprovedProducts();
    await ctx.reply(
      `Export completed. Products: ${result.count}\nCSV: ${result.csvPath}\nJSON: ${result.jsonPath}`
    );
    await ctx.replyWithDocument({ source: result.csvPath, filename: "approved-products.csv" });
    await ctx.replyWithDocument({ source: result.jsonPath, filename: "approved-products.json" });
  });

  bot.command("packages", async (ctx) => {
    if (!ctx.currentUser || !canModerate(ctx.currentUser.role)) {
      await ctx.reply("This command is available only for moderators and admins.");
      return;
    }

    const packages = listServicePackages();
    if (packages.length === 0) {
      await ctx.reply("No service packages yet.");
      return;
    }

    await ctx.reply(
      packages
        .map((pkg) => `#${pkg.id} | ${pkg.segment} | ${pkg.name} | ${pkg.monthlyPrice} EUR/mo | ${pkg.source} | ${pkg.status}`)
        .join("\n")
    );
  });

  bot.command("add_package", async (ctx) => {
    if (!ctx.currentUser || !canModerate(ctx.currentUser.role)) {
      await ctx.reply("This command is available only for moderators and admins.");
      return;
    }

    const raw = ctx.message.text.replace(/^\/add_package(@\w+)?\s*/i, "").trim();
    const [segment, name, items, price, description] = raw.split("|").map((part) => part.trim());
    const monthlyPrice = Number(price);

    if (!segment || !name || !items || !Number.isFinite(monthlyPrice) || monthlyPrice < 0 || !description) {
      await ctx.reply(
        [
          "Usage:",
          "/add_package segment | name | items | price | description",
          "",
          "Example:",
          "/add_package office | Coffee + machine + service | Coffee beans, Coffee machine, Monthly service | 990 | Office coffee bundle for 30 people"
        ].join("\n")
      );
      return;
    }

    try {
      const created = createServicePackageFromBot({
        segment,
        name,
        items: items.replace(/,\s*/g, "\n"),
        monthlyPrice,
        description
      });
      await ctx.reply(`Package #${created.id} added to ${created.segment}. It is visible on the local site and admin packages page.`);
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : "Could not create package.");
    }
  });

  registerProductFlow(bot);
  registerModerationFlow(bot);

  bot.hears("Add product", async (ctx) => {
    await startProductFlow(ctx, "NEW_PRODUCT");
  });

  bot.hears("Update product", async (ctx) => {
    await startProductFlow(ctx, "UPDATE");
  });

  bot.hears("My submissions", renderMySubmissions);

  bot.hears("Help", async (ctx) => {
    await ctx.reply(helpText, mainMenu());
  });

  bot.on("text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) return;

    if (await handleModerationText(ctx, text)) return;
    if (await handleProductText(ctx, text)) return;

    if (ctx.currentUser && canModerate(ctx.currentUser.role)) {
      await ctx.reply("Choose an action from the menu or use /pending.", mainMenu());
      return;
    }

    await ctx.reply("Choose an action from the menu.", mainMenu());
  });

  bot.catch((error) => {
    console.error("Bot error:", error);
  });

  return bot;
};
