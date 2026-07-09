import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const dbPath = resolve(process.cwd(), "prisma", "dev.db");
const existed = existsSync(dbPath);
const db = new DatabaseSync(dbPath);

db.exec(`
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "User" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "telegramId" TEXT NOT NULL,
  "username" TEXT,
  "firstName" TEXT,
  "role" TEXT NOT NULL DEFAULT 'EMPLOYEE',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "User_telegramId_key" ON "User"("telegramId");

CREATE TABLE IF NOT EXISTS "ProductSubmission" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "submissionType" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "submittedById" INTEGER NOT NULL,
  "reviewedById" INTEGER,
  "reviewedAt" DATETIME,
  "productName" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "price" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "availability" TEXT NOT NULL,
  "segment" TEXT NOT NULL,
  "customSegment" TEXT,
  "sku" TEXT,
  "internalComment" TEXT,
  "moderationComment" TEXT,
  "exportStatus" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductSubmission_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProductSubmission_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProductPhoto" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "submissionId" INTEGER NOT NULL,
  "telegramFileId" TEXT NOT NULL,
  "localPath" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductPhoto_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "ProductSubmission" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "SubmissionHistory" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "submissionId" INTEGER NOT NULL,
  "fromStatus" TEXT,
  "toStatus" TEXT NOT NULL,
  "changedById" INTEGER,
  "comment" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubmissionHistory_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "ProductSubmission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SubmissionHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TRIGGER IF NOT EXISTS "User_updatedAt"
AFTER UPDATE ON "User"
FOR EACH ROW
BEGIN
  UPDATE "User" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = OLD."id";
END;

CREATE TRIGGER IF NOT EXISTS "ProductSubmission_updatedAt"
AFTER UPDATE ON "ProductSubmission"
FOR EACH ROW
BEGIN
  UPDATE "ProductSubmission" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = OLD."id";
END;

CREATE TABLE IF NOT EXISTS "AdminAccount" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "email" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "sessionToken" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "ClientLead" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "segment" TEXT NOT NULL,
  "companyName" TEXT NOT NULL,
  "contactName" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT,
  "companySize" TEXT NOT NULL,
  "employeeCount" INTEGER NOT NULL DEFAULT 0,
  "locationsCount" INTEGER NOT NULL DEFAULT 1,
  "services" TEXT NOT NULL,
  "message" TEXT,
  "estimatedMonthlyPrice" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'NEW',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "CalculatorRule" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "segment" TEXT NOT NULL,
  "companySize" TEXT NOT NULL,
  "basePrice" INTEGER NOT NULL,
  "perEmployeePrice" INTEGER NOT NULL,
  "perLocationPrice" INTEGER NOT NULL,
  "active" INTEGER NOT NULL DEFAULT 1,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("segment", "companySize")
);

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

CREATE TABLE IF NOT EXISTS "CatalogItem" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "segment" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "unitPrice" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "imageUrl" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "CommercialProposal" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "leadId" INTEGER,
  "clientName" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "segment" TEXT NOT NULL,
  "items" TEXT NOT NULL,
  "subtotal" INTEGER NOT NULL DEFAULT 0,
  "discountPercent" INTEGER NOT NULL DEFAULT 0,
  "total" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT,
  "publicToken" TEXT NOT NULL UNIQUE,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

const insertRule = db.prepare(`
  INSERT OR IGNORE INTO "CalculatorRule" ("segment", "companySize", "basePrice", "perEmployeePrice", "perLocationPrice")
  VALUES (?, ?, ?, ?, ?)
`);

for (const segment of ["office", "retail", "horeca"]) {
  insertRule.run(segment, "small", 390, 8, 90);
  insertRule.run(segment, "medium", 790, 6, 150);
  insertRule.run(segment, "large", 1490, 4, 240);
}

const packageCount = db.prepare(`SELECT COUNT(*) as count FROM "ServicePackage"`).get().count;
if (packageCount === 0) {
  const insertPackage = db.prepare(`
    INSERT INTO "ServicePackage" ("segment", "name", "description", "items", "monthlyPrice", "source")
    VALUES (?, ?, ?, ?, ?, 'SYSTEM')
  `);
  insertPackage.run("office", "Office Coffee Core", "Coffee, machine rental and scheduled maintenance for a growing office.", "Coffee beans\nCoffee machine\nMonthly service\nWater starter pack", 890);
  insertPackage.run("retail", "Retail Daily Ops", "Store consumables, POS basics and replenishment routine for retail locations.", "Store consumables\nPOS supplies\nShelf care\nMonthly delivery route", 1240);
  insertPackage.run("horeca", "HoReCa Bar Ready", "Professional coffee setup with service response and hygiene essentials.", "Coffee beans\nProfessional machine\nMachine service\nKitchen hygiene starter", 1760);
}

const catalogCount = db.prepare(`SELECT COUNT(*) as count FROM "CatalogItem"`).get().count;
if (catalogCount === 0) {
  const insertItem = db.prepare(`
    INSERT INTO "CatalogItem" ("segment", "category", "name", "description", "unitPrice", "imageUrl")
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertItem.run("office", "Coffee", "Kimbo Espresso Office Blend", "Balanced office coffee for daily consumption and stable machine extraction.", 18, "https://images.unsplash.com/photo-1611854779393-1b2da9d400fe?auto=format&fit=crop&w=900&q=82");
  insertItem.run("office", "Tea", "Premium Tea Selection Box", "Black, green and herbal tea assortment for meeting rooms and kitchens.", 24, "https://images.unsplash.com/photo-1564890369478-c89ca6d9cde9?auto=format&fit=crop&w=900&q=82");
  insertItem.run("office", "Equipment", "Office Automatic Coffee Machine", "Bean-to-cup machine with maintenance plan and replacement option.", 420, "https://images.unsplash.com/photo-1517668808822-9ebb02f2a0e6?auto=format&fit=crop&w=900&q=82");
  insertItem.run("horeca", "Coffee", "HoReCa Signature Espresso Beans", "Higher-intensity blend for restaurants, cafes and hotel breakfast areas.", 31, "https://images.unsplash.com/photo-1447933601403-0c6688de566e?auto=format&fit=crop&w=900&q=82");
  insertItem.run("horeca", "Service", "Barista Launch Training", "On-site staff training for menu quality, extraction and repeatable service.", 260, "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=900&q=82");
  insertItem.run("retail", "Retail", "Self-Service Coffee Corner Kit", "Standardized corner setup for stores with traffic and centralized supply.", 640, "https://images.unsplash.com/photo-1604719312566-8912e9227c6a?auto=format&fit=crop&w=900&q=82");
  insertItem.run("retail", "Consumables", "Retail Cups & Lids Pack", "Branded cups, lids, stirrers and sugar sticks for daily retail flow.", 85, "https://images.unsplash.com/photo-1522992319-0365e5f11656?auto=format&fit=crop&w=900&q=82");
}

db.close();
console.log(`${existed ? "Updated" : "Created"} SQLite database at ${dbPath}`);
