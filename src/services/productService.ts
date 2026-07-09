import type { FlowPhoto, ProductDraft, ProductFlowMode } from "../types";
import { prisma } from "../db/prisma";
import { SubmissionStatus, SubmissionType } from "../domain";

const toType = (mode: ProductFlowMode): SubmissionType =>
  mode === "NEW_PRODUCT" ? SubmissionType.NEW_PRODUCT : SubmissionType.UPDATE;

export const createSubmission = async (
  submittedById: number,
  mode: ProductFlowMode,
  draft: ProductDraft,
  status: typeof SubmissionStatus.SUBMITTED | typeof SubmissionStatus.RESUBMITTED = SubmissionStatus.SUBMITTED
) => {
  return prisma.productSubmission.create({
    data: {
      submissionType: toType(mode),
      status,
      submittedById,
      productName: draft.productName!,
      category: draft.category!,
      description: draft.description!,
      price: draft.price!,
      currency: draft.currency!,
      availability: draft.availability!,
      segment: draft.segment!,
      customSegment: draft.customSegment ?? null,
      sku: draft.sku ?? null,
      internalComment: draft.internalComment ?? null,
      photos: {
        create: draft.photos.map((photo: FlowPhoto) => ({
          telegramFileId: photo.telegramFileId,
          localPath: photo.localPath
        }))
      },
      history: {
        create: {
          toStatus: status,
          changedById: submittedById
        }
      }
    },
    include: { photos: true, submittedBy: true }
  });
};

export const updateSubmissionFromDraft = async (
  submissionId: number,
  changedById: number,
  draft: ProductDraft
) => {
  const previous = await prisma.productSubmission.findUniqueOrThrow({
    where: { id: submissionId },
    include: { photos: true }
  });

  return prisma.$transaction(async (tx) => {
    await tx.productPhoto.deleteMany({ where: { submissionId } });
    const updated = await tx.productSubmission.update({
      where: { id: submissionId },
      data: {
        status: SubmissionStatus.RESUBMITTED,
        productName: draft.productName!,
        category: draft.category!,
        description: draft.description!,
        price: draft.price!,
        currency: draft.currency!,
        availability: draft.availability!,
        segment: draft.segment!,
        customSegment: draft.customSegment ?? null,
        sku: draft.sku ?? null,
        internalComment: draft.internalComment ?? null,
        moderationComment: null,
        reviewedById: null,
        reviewedAt: null,
        photos: {
          create: draft.photos.map((photo) => ({
            telegramFileId: photo.telegramFileId,
            localPath: photo.localPath
          }))
        }
      },
      include: { photos: true, submittedBy: true }
    });
    await tx.submissionHistory.create({
      data: {
        submissionId,
        fromStatus: previous.status,
        toStatus: SubmissionStatus.RESUBMITTED,
        changedById
      }
    });
    return updated;
  });
};

export const getSubmission = (id: number) =>
  prisma.productSubmission.findUnique({
    where: { id },
    include: { photos: true, submittedBy: true, reviewedBy: true }
  });

export const listMySubmissions = (submittedById: number) =>
  prisma.productSubmission.findMany({
    where: { submittedById },
    orderBy: { createdAt: "desc" },
    take: 20
  });

export const listPendingSubmissions = () =>
  prisma.productSubmission.findMany({
    where: { status: { in: [SubmissionStatus.SUBMITTED, SubmissionStatus.RESUBMITTED, SubmissionStatus.IN_REVIEW] } },
    include: { photos: true, submittedBy: true },
    orderBy: { createdAt: "asc" }
  });

export const setModerationStatus = async (
  submissionId: number,
  status:
    | typeof SubmissionStatus.APPROVED
    | typeof SubmissionStatus.REJECTED
    | typeof SubmissionStatus.CHANGES_REQUESTED,
  reviewerId: number,
  comment?: string
) => {
  const previous = await prisma.productSubmission.findUniqueOrThrow({ where: { id: submissionId } });

  return prisma.productSubmission.update({
    where: { id: submissionId },
    data: {
      status,
      reviewedById: reviewerId,
      reviewedAt: new Date(),
      moderationComment: comment ?? null,
      history: {
        create: {
          fromStatus: previous.status,
          toStatus: status,
          changedById: reviewerId,
          comment
        }
      }
    },
    include: { photos: true, submittedBy: true }
  });
};
