import { Markup, Telegraf } from "telegraf";
import type { BotContext } from "../types";
import { getSubmission, listPendingSubmissions, setModerationStatus } from "../services/productService";
import { canModerate } from "../services/userService";
import { formatSubmissionPreview } from "../utils/formatProductPreview";
import { SubmissionStatus, type UserRole } from "../domain";

const requireModerator = async (ctx: BotContext): Promise<boolean> => {
  if (!ctx.currentUser || !canModerate(ctx.currentUser.role)) {
    await ctx.reply("This command is available only for moderators and admins.");
    return false;
  }
  return true;
};

const moderationKeyboard = (submissionId: number) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback("Approve", `mod_approve:${submissionId}`),
      Markup.button.callback("Request changes", `mod_changes:${submissionId}`),
      Markup.button.callback("Reject", `mod_reject:${submissionId}`)
    ]
  ]);

const notifyAuthor = async (ctx: BotContext, submissionId: number, message: string, editButton = false) => {
  const submission = await getSubmission(submissionId);
  if (!submission) return;
  await ctx.telegram.sendMessage(
    submission.submittedBy.telegramId,
    message,
    editButton
      ? Markup.inlineKeyboard([[Markup.button.callback("Edit submission", `edit_submission:${submissionId}`)]])
      : undefined
  );
};

export const registerModerationFlow = (bot: Telegraf<BotContext>) => {
  bot.command("pending", async (ctx) => {
    if (!(await requireModerator(ctx))) return;
    const pending = await listPendingSubmissions();
    if (pending.length === 0) {
      await ctx.reply("No pending submissions.");
      return;
    }
    for (const submission of pending) {
      await ctx.reply(formatSubmissionPreview(submission), moderationKeyboard(submission.id));
    }
  });

  bot.action(/^mod_approve:(\d+)$/, async (ctx) => {
    if (!ctx.currentUser || !canModerate(ctx.currentUser.role)) {
      await ctx.answerCbQuery("Not allowed.");
      return;
    }

    const id = Number(ctx.match[1]);
    await setModerationStatus(id, SubmissionStatus.APPROVED, ctx.currentUser.id);
    await ctx.answerCbQuery("Approved.");
    await ctx.reply(`Submission #${id} approved.`);
    await notifyAuthor(ctx, id, "Your product card was approved.");
  });

  bot.action(/^mod_changes:(\d+)$/, async (ctx) => {
    if (!ctx.currentUser || !canModerate(ctx.currentUser.role)) {
      await ctx.answerCbQuery("Not allowed.");
      return;
    }
    ctx.session.moderationAction = { submissionId: Number(ctx.match[1]), action: "request_changes" };
    await ctx.answerCbQuery();
    await ctx.reply("Enter the changes requested comment.");
  });

  bot.action(/^mod_reject:(\d+)$/, async (ctx) => {
    if (!ctx.currentUser || !canModerate(ctx.currentUser.role)) {
      await ctx.answerCbQuery("Not allowed.");
      return;
    }
    ctx.session.moderationAction = { submissionId: Number(ctx.match[1]), action: "reject" };
    await ctx.answerCbQuery();
    await ctx.reply("Enter the rejection reason.");
  });
};

export const handleModerationText = async (ctx: BotContext, text: string): Promise<boolean> => {
  const action = ctx.session.moderationAction;
  if (!action || !ctx.currentUser) return false;

  const comment = text.trim();
  if (!comment) {
    await ctx.reply("Comment is required.");
    return true;
  }

  if (action.action === "request_changes") {
    await setModerationStatus(
      action.submissionId,
      SubmissionStatus.CHANGES_REQUESTED,
      ctx.currentUser.id,
      comment
    );
    await notifyAuthor(
      ctx,
      action.submissionId,
      `Changes requested for your product card.\n\nComment: ${comment}`,
      true
    );
    await ctx.reply(`Changes requested for submission #${action.submissionId}.`);
  } else {
    await setModerationStatus(action.submissionId, SubmissionStatus.REJECTED, ctx.currentUser.id, comment);
    await notifyAuthor(ctx, action.submissionId, `Your product card was rejected.\n\nReason: ${comment}`);
    await ctx.reply(`Submission #${action.submissionId} rejected.`);
  }

  ctx.session.moderationAction = undefined;
  return true;
};

export const roleName = (role: UserRole) => role;
