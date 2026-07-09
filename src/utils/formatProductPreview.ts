import type { ProductPhoto, ProductSubmission, User } from "@prisma/client";
import type { ProductDraft, ProductFlowMode } from "../types";

const value = (input?: string | null): string => (input && input.trim() ? input : "-");

export const formatDraftPreview = (mode: ProductFlowMode, draft: ProductDraft): string => {
  const type = mode === "NEW_PRODUCT" ? "NEW_PRODUCT" : "UPDATE";
  const segment = draft.segment === "Other" ? `Other: ${value(draft.customSegment)}` : value(draft.segment);

  return [
    "Product card preview",
    "",
    `Type: ${type}`,
    mode === "UPDATE" ? `Product to update: ${value(draft.updateTarget)}` : undefined,
    mode === "UPDATE" ? `Update scope: ${value(draft.updateScope)}` : undefined,
    `Product name: ${value(draft.productName)}`,
    `Category: ${value(draft.category)}`,
    `Description: ${value(draft.description)}`,
    `Price: ${value(draft.price)}`,
    `Currency: ${value(draft.currency)}`,
    `Availability: ${value(draft.availability)}`,
    `Segment: ${segment}`,
    `SKU: ${value(draft.sku)}`,
    `Internal comment: ${value(draft.internalComment)}`,
    `Photos: ${draft.photos.length}`
  ]
    .filter(Boolean)
    .join("\n");
};

export const formatSubmissionPreview = (
  submission: ProductSubmission & { photos: ProductPhoto[]; submittedBy: User }
): string => {
  const segment =
    submission.segment === "Other"
      ? `Other: ${value(submission.customSegment)}`
      : value(submission.segment);

  return [
    "Moderation request",
    "",
    `Submission ID: ${submission.id}`,
    `Type: ${submission.submissionType}`,
    `Status: ${submission.status}`,
    `Submitted by: ${value(submission.submittedBy.firstName)} (${submission.submittedBy.telegramId})`,
    `Date: ${submission.createdAt.toISOString()}`,
    "",
    `Product name: ${value(submission.productName)}`,
    `Category: ${value(submission.category)}`,
    `Description: ${value(submission.description)}`,
    `Price: ${submission.price}`,
    `Currency: ${submission.currency}`,
    `Availability: ${submission.availability}`,
    `Segment: ${segment}`,
    `SKU: ${value(submission.sku)}`,
    `Internal comment: ${value(submission.internalComment)}`,
    `Moderation comment: ${value(submission.moderationComment)}`,
    `Photos: ${submission.photos.length}`
  ].join("\n");
};
