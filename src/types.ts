import type { Context } from "telegraf";
import type { User } from "@prisma/client";

export type ProductFlowMode = "NEW_PRODUCT" | "UPDATE";

export type ProductFlowStep =
  | "photos"
  | "updateTarget"
  | "updateScope"
  | "name"
  | "category"
  | "description"
  | "price"
  | "currency"
  | "availability"
  | "segment"
  | "customSegment"
  | "sku"
  | "internalComment"
  | "preview";

export interface FlowPhoto {
  telegramFileId: string;
  localPath: string;
}

export interface ProductDraft {
  photos: FlowPhoto[];
  productName?: string;
  category?: string;
  description?: string;
  price?: string;
  currency?: string;
  availability?: string;
  segment?: string;
  customSegment?: string;
  sku?: string;
  internalComment?: string;
  updateTarget?: string;
  updateScope?: string;
}

export interface ProductFlowState {
  mode: ProductFlowMode;
  step: ProductFlowStep;
  editSubmissionId?: number;
  draft: ProductDraft;
}

export interface ModerationActionState {
  submissionId: number;
  action: "request_changes" | "reject";
}

export interface SessionData {
  productFlow?: ProductFlowState;
  moderationAction?: ModerationActionState;
}

export type BotContext = Context & {
  session: SessionData;
  currentUser?: User;
};
