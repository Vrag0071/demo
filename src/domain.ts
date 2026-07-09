export const UserRole = {
  EMPLOYEE: "EMPLOYEE",
  MODERATOR: "MODERATOR",
  ADMIN: "ADMIN"
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const SubmissionType = {
  NEW_PRODUCT: "NEW_PRODUCT",
  UPDATE: "UPDATE"
} as const;

export type SubmissionType = (typeof SubmissionType)[keyof typeof SubmissionType];

export const SubmissionStatus = {
  DRAFT: "DRAFT",
  SUBMITTED: "SUBMITTED",
  IN_REVIEW: "IN_REVIEW",
  CHANGES_REQUESTED: "CHANGES_REQUESTED",
  RESUBMITTED: "RESUBMITTED",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  EXPORTED: "EXPORTED"
} as const;

export type SubmissionStatus = (typeof SubmissionStatus)[keyof typeof SubmissionStatus];
