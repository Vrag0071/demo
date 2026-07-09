import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config";
import { prisma } from "../db/prisma";
import { SubmissionStatus } from "../domain";

const csvEscape = (value: unknown): string => {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
};

export const exportApprovedProducts = async () => {
  await fs.mkdir(config.exportsDir, { recursive: true });

  const products = await prisma.productSubmission.findMany({
    where: { status: SubmissionStatus.APPROVED },
    include: { photos: true, submittedBy: true },
    orderBy: { createdAt: "asc" }
  });

  const jsonPath = path.join(config.exportsDir, "approved-products.json");
  const csvPath = path.join(config.exportsDir, "approved-products.csv");

  const rows = products.map((product) => ({
    id: product.id,
    submissionType: product.submissionType,
    productName: product.productName,
    category: product.category,
    description: product.description,
    price: product.price,
    currency: product.currency,
    availability: product.availability,
    segment: product.segment,
    customSegment: product.customSegment,
    sku: product.sku,
    internalComment: product.internalComment,
    photoPaths: product.photos.map((photo) => photo.localPath).join(";"),
    submittedByTelegramId: product.submittedBy.telegramId,
    createdAt: product.createdAt.toISOString()
  }));

  await fs.writeFile(jsonPath, JSON.stringify(rows, null, 2), "utf8");

  const headers = Object.keys(rows[0] ?? {
    id: "",
    submissionType: "",
    productName: "",
    category: "",
    description: "",
    price: "",
    currency: "",
    availability: "",
    segment: "",
    customSegment: "",
    sku: "",
    internalComment: "",
    photoPaths: "",
    submittedByTelegramId: "",
    createdAt: ""
  });
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header as keyof typeof row])).join(","))
  ].join("\n");
  await fs.writeFile(csvPath, csv, "utf8");

  if (products.length > 0) {
    await prisma.productSubmission.updateMany({
      where: { id: { in: products.map((product) => product.id) } },
      data: { status: SubmissionStatus.EXPORTED, exportStatus: "EXPORTED" }
    });
  }

  return { count: products.length, jsonPath, csvPath };
};
