import { Markup, Telegraf } from "telegraf";
import type { BotContext, ProductDraft, ProductFlowMode } from "../types";
import { saveTelegramPhoto } from "../services/fileService";
import { createSubmission, getSubmission, updateSubmissionFromDraft } from "../services/productService";
import { moderatorsAndAdmins } from "../services/userService";
import { formatDraftPreview, formatSubmissionPreview } from "../utils/formatProductPreview";
import { SubmissionStatus } from "../domain";
import {
  availabilityOptions,
  currencies,
  isAvailability,
  isCurrency,
  isPositivePrice,
  isSegment,
  normalizePrice,
  segmentOptions,
  updateScopes,
  validateRequired
} from "../utils/validators";

const skipText = "Skip";
const donePhotosText = "Done after photos";

export const mainMenu = () =>
  Markup.keyboard([["Add product", "Update product"], ["My submissions", "Help"]]).resize();

const cancelHint = "\n\nUse /cancel to stop this flow.";

const currencyKeyboard = () => Markup.keyboard([currencies as unknown as string[]]).resize();
const availabilityKeyboard = () => Markup.keyboard([availabilityOptions as unknown as string[]]).resize();
const segmentKeyboard = () => Markup.keyboard([segmentOptions as unknown as string[]]).resize();
const optionalKeyboard = () => Markup.keyboard([[skipText]]).resize();
const photoKeyboard = () => Markup.keyboard([[donePhotosText], ["/cancel"]]).resize();
const updateScopeKeyboard = () => Markup.keyboard(updateScopes.map((scope) => [scope])).resize();

export const startProductFlow = async (
  ctx: BotContext,
  mode: ProductFlowMode,
  editSubmissionId?: number,
  initialDraft?: ProductDraft
) => {
  ctx.session.productFlow = {
    mode,
    step: mode === "UPDATE" && !editSubmissionId ? "updateTarget" : "photos",
    editSubmissionId,
    draft: initialDraft ?? { photos: [] }
  };

  if (mode === "UPDATE" && !editSubmissionId) {
    await ctx.reply(`Product name or SKU to update.${cancelHint}`, Markup.removeKeyboard());
    return;
  }

  const existingCount = initialDraft?.photos.length ?? 0;
  await ctx.reply(
    `Send product photos. Minimum 1, maximum 5.${existingCount ? ` Current photos: ${existingCount}.` : ""}\nPress "${donePhotosText}" when ready.${cancelHint}`,
    photoKeyboard()
  );
};

const askNext = async (ctx: BotContext) => {
  const flow = ctx.session.productFlow;
  if (!flow) return;

  switch (flow.step) {
    case "photos":
      await ctx.reply(
        `Send product photos. Minimum 1, maximum 5.\nCurrent photos: ${flow.draft.photos.length}.\nPress "${donePhotosText}" when ready.${cancelHint}`,
        photoKeyboard()
      );
      break;
    case "updateScope":
      await ctx.reply("What is being updated?", updateScopeKeyboard());
      break;
    case "name":
      await ctx.reply(`Product name.${cancelHint}`, Markup.removeKeyboard());
      break;
    case "category":
      await ctx.reply(`Category.${cancelHint}`, Markup.removeKeyboard());
      break;
    case "description":
      await ctx.reply(`Description.${cancelHint}`, Markup.removeKeyboard());
      break;
    case "price":
      await ctx.reply(`Price. Use a number greater than 0.${cancelHint}`, Markup.removeKeyboard());
      break;
    case "currency":
      await ctx.reply("Currency:", currencyKeyboard());
      break;
    case "availability":
      await ctx.reply("Availability:", availabilityKeyboard());
      break;
    case "segment":
      await ctx.reply("Business segment:", segmentKeyboard());
      break;
    case "customSegment":
      await ctx.reply(`Enter business segment.${cancelHint}`, Markup.removeKeyboard());
      break;
    case "sku":
      await ctx.reply(`SKU / internal code. Optional.${cancelHint}`, optionalKeyboard());
      break;
    case "internalComment":
      await ctx.reply(`Internal comment. Optional.${cancelHint}`, optionalKeyboard());
      break;
    case "preview":
      await ctx.reply(
        formatDraftPreview(flow.mode, flow.draft),
        Markup.inlineKeyboard([
          [Markup.button.callback("Submit for moderation", "product_submit")],
          [Markup.button.callback("Edit", "product_edit"), Markup.button.callback("Cancel", "product_cancel")]
        ])
      );
      break;
  }
};

const moveTo = async (ctx: BotContext, step: NonNullable<BotContext["session"]["productFlow"]>["step"]) => {
  if (!ctx.session.productFlow) return;
  ctx.session.productFlow.step = step;
  await askNext(ctx);
};

const submitCurrentDraft = async (ctx: BotContext) => {
  const flow = ctx.session.productFlow;
  const user = ctx.currentUser;
  if (!flow || !user) return;

  const submission = flow.editSubmissionId
    ? await updateSubmissionFromDraft(flow.editSubmissionId, user.id, flow.draft)
    : await createSubmission(user.id, flow.mode, flow.draft, SubmissionStatus.SUBMITTED);

  ctx.session.productFlow = undefined;
  await ctx.reply("Product submitted for moderation.", mainMenu());

  const reviewers = await moderatorsAndAdmins();
  const preview = formatSubmissionPreview(submission);
  for (const reviewer of reviewers) {
    await ctx.telegram.sendMessage(
      reviewer.telegramId,
      preview,
      Markup.inlineKeyboard([
        [
          Markup.button.callback("Approve", `mod_approve:${submission.id}`),
          Markup.button.callback("Request changes", `mod_changes:${submission.id}`),
          Markup.button.callback("Reject", `mod_reject:${submission.id}`)
        ]
      ])
    );

    if (submission.photos.length > 0) {
      await ctx.telegram.sendMediaGroup(
        reviewer.telegramId,
        submission.photos.map((photo) => ({ type: "photo", media: photo.telegramFileId }))
      );
    }
  }
};

const validateDraftForPreview = (draft: ProductDraft): string | null => {
  if (draft.photos.length < 1) return "Please add at least 1 photo.";
  if (draft.photos.length > 5) return "Maximum 5 photos are allowed.";
  if (!validateRequired(draft.productName)) return "Product name is required.";
  if (!validateRequired(draft.category)) return "Category is required.";
  if (!validateRequired(draft.description)) return "Description is required.";
  if (!draft.price || !isPositivePrice(draft.price)) return "Price must be a number greater than 0.";
  if (!draft.currency || !isCurrency(draft.currency)) return "Currency must be MDL, EUR, or USD.";
  if (!draft.availability || !isAvailability(draft.availability)) return "Choose availability from the list.";
  if (!draft.segment || !isSegment(draft.segment)) return "Choose segment from the list.";
  if (draft.segment === "Other" && !validateRequired(draft.customSegment)) return "Custom segment is required.";
  return null;
};

export const registerProductFlow = (bot: Telegraf<BotContext>) => {
  bot.action("product_submit", async (ctx) => {
    const flow = ctx.session.productFlow;
    if (!flow) return ctx.answerCbQuery("No active product flow.");

    const error = validateDraftForPreview(flow.draft);
    if (error) {
      await ctx.answerCbQuery(error);
      await ctx.reply(error);
      return askNext(ctx);
    }

    await ctx.answerCbQuery();
    await submitCurrentDraft(ctx);
  });

  bot.action("product_edit", async (ctx) => {
    const flow = ctx.session.productFlow;
    if (!flow) return ctx.answerCbQuery("No active product flow.");
    flow.step = "photos";
    flow.draft.photos = [];
    await ctx.answerCbQuery();
    await askNext(ctx);
  });

  bot.action("product_cancel", async (ctx) => {
    ctx.session.productFlow = undefined;
    await ctx.answerCbQuery();
    await ctx.reply("Flow cancelled.", mainMenu());
  });

  bot.action(/^edit_submission:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const submission = await getSubmission(id);
    if (!submission || !ctx.currentUser || submission.submittedById !== ctx.currentUser.id) {
      await ctx.answerCbQuery("Submission not found.");
      return;
    }
    if (submission.status !== SubmissionStatus.CHANGES_REQUESTED) {
      await ctx.answerCbQuery("This submission is not awaiting changes.");
      return;
    }

    await ctx.answerCbQuery();
    await startProductFlow(ctx, submission.submissionType as ProductFlowMode, id, {
      photos: submission.photos.map((photo) => ({
        telegramFileId: photo.telegramFileId,
        localPath: photo.localPath
      })),
      productName: submission.productName,
      category: submission.category,
      description: submission.description,
      price: submission.price,
      currency: submission.currency,
      availability: submission.availability,
      segment: submission.segment,
      customSegment: submission.customSegment ?? undefined,
      sku: submission.sku ?? undefined,
      internalComment: submission.internalComment ?? undefined
    });
  });

  bot.on("photo", async (ctx, next) => {
    const flow = ctx.session.productFlow;
    if (!flow || flow.step !== "photos") return next();

    if (flow.draft.photos.length >= 5) {
      await ctx.reply("Maximum 5 photos are allowed. Press Done after photos to continue.");
      return;
    }

    const photos = ctx.message.photo;
    const bestPhoto = photos[photos.length - 1];
    const localPath = await saveTelegramPhoto(ctx, bestPhoto.file_id);
    flow.draft.photos.push({ telegramFileId: bestPhoto.file_id, localPath });

    await ctx.reply(
      `Photo saved (${flow.draft.photos.length}/5). Send another photo or press "${donePhotosText}".`,
      photoKeyboard()
    );
  });
};

export const handleProductText = async (ctx: BotContext, text: string): Promise<boolean> => {
  const flow = ctx.session.productFlow;
  if (!flow) return false;

  const draft = flow.draft;

  if (flow.step === "updateTarget") {
    if (!validateRequired(text)) {
      await ctx.reply("Product name or SKU is required.");
      return true;
    }
    draft.updateTarget = text.trim();
    return moveTo(ctx, "updateScope").then(() => true);
  }

  if (flow.step === "updateScope") {
    if (!updateScopes.includes(text as any)) {
      await ctx.reply("Choose one update option from the keyboard.");
      return true;
    }
    draft.updateScope = text;
    await ctx.reply("For MVP, the bot will collect the full product card for moderation.");
    return moveTo(ctx, "photos").then(() => true);
  }

  if (flow.step === "photos") {
    if (text !== donePhotosText) {
      await ctx.reply(`Please send a photo or press "${donePhotosText}".`);
      return true;
    }
    if (draft.photos.length < 1) {
      await ctx.reply("Please add at least 1 photo.");
      return true;
    }
    return moveTo(ctx, "name").then(() => true);
  }

  if (flow.step === "name") {
    if (!validateRequired(text)) {
      await ctx.reply("Product name is required.");
      return true;
    }
    draft.productName = text.trim();
    return moveTo(ctx, "category").then(() => true);
  }

  if (flow.step === "category") {
    if (!validateRequired(text)) {
      await ctx.reply("Category is required.");
      return true;
    }
    draft.category = text.trim();
    return moveTo(ctx, "description").then(() => true);
  }

  if (flow.step === "description") {
    if (!validateRequired(text)) {
      await ctx.reply("Description is required.");
      return true;
    }
    draft.description = text.trim();
    return moveTo(ctx, "price").then(() => true);
  }

  if (flow.step === "price") {
    if (!isPositivePrice(text)) {
      await ctx.reply("Price must be a number greater than 0.");
      return true;
    }
    draft.price = normalizePrice(text);
    return moveTo(ctx, "currency").then(() => true);
  }

  if (flow.step === "currency") {
    if (!isCurrency(text)) {
      await ctx.reply("Choose MDL, EUR, or USD.");
      return true;
    }
    draft.currency = text;
    return moveTo(ctx, "availability").then(() => true);
  }

  if (flow.step === "availability") {
    if (!isAvailability(text)) {
      await ctx.reply("Choose availability from the list.");
      return true;
    }
    draft.availability = text;
    return moveTo(ctx, "segment").then(() => true);
  }

  if (flow.step === "segment") {
    if (!isSegment(text)) {
      await ctx.reply("Choose segment from the list.");
      return true;
    }
    draft.segment = text;
    if (text === "Other") return moveTo(ctx, "customSegment").then(() => true);
    return moveTo(ctx, "sku").then(() => true);
  }

  if (flow.step === "customSegment") {
    if (!validateRequired(text)) {
      await ctx.reply("Custom segment is required.");
      return true;
    }
    draft.customSegment = text.trim();
    return moveTo(ctx, "sku").then(() => true);
  }

  if (flow.step === "sku") {
    draft.sku = text === skipText ? undefined : text.trim();
    return moveTo(ctx, "internalComment").then(() => true);
  }

  if (flow.step === "internalComment") {
    draft.internalComment = text === skipText ? undefined : text.trim();
    return moveTo(ctx, "preview").then(() => true);
  }

  return true;
};
