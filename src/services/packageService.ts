import path from "node:path";

const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: any };

const dbPath = path.resolve(process.cwd(), "prisma", "dev.db");

const normalizeSegment = (segment: string): string | null => {
  const value = segment.trim().toLowerCase();
  if (["office", "офис", "офисы"].includes(value)) return "office";
  if (["retail", "ритейл"].includes(value)) return "retail";
  if (["horeca", "ho-re-ca", "хорека", "horeka"].includes(value)) return "horeca";
  return null;
};

export const createServicePackageFromBot = (input: {
  segment: string;
  name: string;
  items: string;
  monthlyPrice: number;
  description: string;
}) => {
  const segment = normalizeSegment(input.segment);
  if (!segment) {
    throw new Error("Segment must be office, retail, or horeca.");
  }

  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS "ServicePackage" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "segment" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT NOT NULL,
        "items" TEXT NOT NULL,
        "monthlyPrice" INTEGER NOT NULL DEFAULT 0,
        "source" TEXT NOT NULL DEFAULT 'ADMIN',
        "status" TEXT NOT NULL DEFAULT 'ACTIVE',
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const result = db.prepare(`
      INSERT INTO "ServicePackage" ("segment", "name", "description", "items", "monthlyPrice", "source")
      VALUES (?, ?, ?, ?, ?, 'BOT')
    `).run(segment, input.name.trim(), input.description.trim(), input.items.trim(), input.monthlyPrice);
    return { id: Number(result.lastInsertRowid), segment };
  } finally {
    db.close();
  }
};

export const listServicePackages = () => {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS "ServicePackage" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "segment" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT NOT NULL,
        "items" TEXT NOT NULL,
        "monthlyPrice" INTEGER NOT NULL DEFAULT 0,
        "source" TEXT NOT NULL DEFAULT 'ADMIN',
        "status" TEXT NOT NULL DEFAULT 'ACTIVE',
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    return db.prepare(`SELECT * FROM "ServicePackage" ORDER BY "createdAt" DESC LIMIT 20`).all() as Array<{
      id: number;
      segment: string;
      name: string;
      monthlyPrice: number;
      source: string;
      status: string;
    }>;
  } finally {
    db.close();
  }
};
