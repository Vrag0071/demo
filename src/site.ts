import "dotenv/config";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import querystring from "node:querystring";

const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: any };

const port = Number(process.env.SITE_PORT ?? 3000);
const siteBaseUrl = (process.env.SITE_URL?.trim() || "https://demo.min4min.com").replace(/\/+$/, "");
const visitsWebhookUrl = process.env.GOOGLE_VISITS_WEBHOOK_URL?.trim() ?? "";
const ignoredVisitIps = new Set((process.env.VISIT_IGNORE_IPS ?? "").split(",").map((ip) => ip.trim()).filter(Boolean));
const recentVisitKeys = new Map<string, number>();
const dbPath = path.resolve(process.cwd(), "prisma", "dev.db");
const assetsDir = path.resolve(process.cwd(), "public", "assets");
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON;");

type Row = Record<string, any>;
type RequestContext = {
  request: http.IncomingMessage;
  response: http.ServerResponse;
  url: URL;
  admin?: Row | null;
};

const businessLines = {
  office: {
    label: "Office",
    title: "Coffee, equipment and service for an office without extra operations",
    short: "Predictable coffee, tea, equipment and service for teams of any size.",
    hero:
      "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=78",
    services: ["Coffee program", "Coffee machines", "Water service", "Cleaning supplies", "Office consumables", "Preventive maintenance"]
  },
  retail: {
    label: "Retail",
    title: "Coffee solutions for stores and networks",
    short: "Standardized beverage systems for stores, networks and high-traffic locations.",
    hero:
      "https://images.unsplash.com/photo-1604719312566-8912e9227c6a?auto=format&fit=crop&w=900&q=78",
    services: ["Store consumables", "Shelf equipment", "Coffee corner", "POS supplies", "Cleaning supplies", "Scheduled replenishment"]
  },
  horeca: {
    label: "HoReCa",
    title: "Stable coffee and service for HoReCa without downtime",
    short: "Professional coffee, equipment, training and service for cafes, hotels and restaurants.",
    hero:
      "https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&w=900&q=78",
    services: ["Coffee beans", "Professional machines", "Machine service", "Tabletop supplies", "Kitchen hygiene", "Emergency replenishment"]
  }
} as const;

const defaultServicePrices: Record<string, number> = {
  "Coffee program": 180,
  "Coffee machines": 420,
  "Water service": 120,
  "Cleaning supplies": 95,
  "Office consumables": 75,
  "Preventive maintenance": 160,
  "Store consumables": 140,
  "Shelf equipment": 380,
  "Coffee corner": 260,
  "POS supplies": 90,
  "Scheduled replenishment": 130,
  "Coffee beans": 220,
  "Professional machines": 520,
  "Machine service": 190,
  "Tabletop supplies": 150,
  "Kitchen hygiene": 170,
  "Emergency replenishment": 240
};

const solutionCopy = {
  office: {
    heroDescription: "Choose your team size, beverage format and required services. Binova will build a solution for your office: coffee, tea, equipment, supply and maintenance.",
    proofTitle: "From a basic set to a complete coffee system for a large team.",
    primaryCta: "Build package",
    packageIntro: "This is a starting point for the offer. Choose a base option, then add the services you need.",
    requestEyebrow: "Solution request",
    requestTitle: "Choose services and send the request",
    requestIntro: "Select what your office needs. We will build the solution and prepare an offer.",
    servicesTitle: "Choose the services you need",
    contextLabel: "Request details",
    contextPlaceholder: "Describe the current situation, supply preferences, equipment, budget and launch timing.",
    submitLabel: "Get offer",
    serviceCta: "Select service",
    companySizeLabel: "Company size",
    companySizeOptions: [] as string[],
    employeeLabel: "Employees",
    employeePlaceholder: "",
    catalogEyebrow: "Catalog",
    catalogTitle: "Products and services behind the experience",
    catalogIntro: "Core products and service components that can be combined for this business line.",
    catalogItems: [] as Array<{ category: string; name: string; description: string; imageUrl: string }>,
    serviceDescriptions: {
      "Coffee program": "Coffee, tea and beverages matched to your team's consumption.",
      "Coffee machines": "Selection, installation and maintenance of office equipment.",
      "Water service": "Water, regular replenishment and service for the consumption point.",
      "Cleaning supplies": "Consumables for the kitchen, office and daily operations.",
      "Office consumables": "Cups, sugar, napkins and other items for regular replenishment.",
      "Preventive maintenance": "Scheduled maintenance so equipment works without downtime."
    },
    presets: [
      {
        name: "Basic office package",
        description: "Coffee, equipment and regular maintenance for stable office operations.",
        items: "Coffee · Coffee machine · Monthly service · Starter kit",
        services: ["Coffee program", "Coffee machines", "Preventive maintenance"]
      },
      {
        name: "Beverages and consumables",
        description: "Coffee, tea, sugar, cups and other items that can be replenished regularly.",
        items: "Coffee beans · Instant coffee · Tea · Sugar · Cups",
        services: ["Coffee program", "Office consumables", "Water service"]
      },
      {
        name: "Equipment and service",
        description: "Coffee machines, installation, maintenance and support so everything works without downtime.",
        items: "Rental · Purchase · Installation · Maintenance · Replacement",
        services: ["Coffee machines", "Preventive maintenance"]
      }
    ]
  },
  retail: {
    heroDescription: "Choose your location format, required services and send the request. Binova will build a solution for your network: equipment, beverages, supply, service and one standard across every location.",
    proofTitle: "From one point to a location network, we shape the setup around your format.",
    primaryCta: "Build solution",
    packageIntro: "This is a starting point for the offer. Choose a base option, then add the services your locations need.",
    requestEyebrow: "Solution request",
    requestTitle: "Build a solution for your point or network",
    requestIntro: "Select what your location needs. Binova will prepare a solution around the format, traffic and operating model.",
    servicesTitle: "What to include in the solution",
    contextLabel: "Request details",
    contextPlaceholder: "Describe the location format, current supplier, delivery frequency, desired launch timing, budget and important requirements.",
    submitLabel: "Get offer",
    serviceCta: "Add",
    companySizeLabel: "Company size",
    companySizeOptions: [] as string[],
    employeeLabel: "Employees",
    employeePlaceholder: "",
    catalogEyebrow: "Catalog",
    catalogTitle: "Products and services for retail",
    catalogIntro: "Key components that can be combined around your location or network format.",
    catalogItems: [
      {
        category: "Consumables",
        name: "Cups and lids for the point",
        description: "Branded or standard cups, lids, stirrers and sugar for daily beverage sales.",
        imageUrl: "https://images.unsplash.com/photo-1522992319-0365e5f11656?auto=format&fit=crop&w=900&q=82"
      },
      {
        category: "Retail",
        name: "Self-service coffee corner",
        description: "A ready solution for stores, gas stations and traffic locations: equipment, beverages, consumables and replenishment.",
        imageUrl: "https://images.unsplash.com/photo-1604719312566-8912e9227c6a?auto=format&fit=crop&w=900&q=82"
      }
    ],
    serviceDescriptions: {
      "Store consumables": "Cups, lids, sugar, stirrers and other items for daily point operations.",
      "Shelf equipment": "POS solutions and equipment for convenient beverage sales at the location.",
      "Coffee corner": "A ready coffee zone for a store, gas station or point with regular traffic.",
      "POS supplies": "Receipts, paper, stickers and basic materials for point operations.",
      "Cleaning supplies": "Products and consumables to keep the beverage zone clean.",
      "Scheduled replenishment": "Regular deliveries of coffee, consumables and related goods by an agreed schedule."
    },
    presets: [
      {
        name: "Basic retail solution",
        description: "A coffee point for a store, gas station, commercial area or another high-traffic location.",
        items: "Equipment · Beverages · Consumables · Basic service",
        services: ["Coffee corner", "Shelf equipment", "Store consumables"]
      },
      {
        name: "Daily replenishment",
        description: "Regular supply of coffee, cups, sugar, consumables and other items for stable point operations.",
        items: "Coffee · Cups · Sugar · Consumables · Planned deliveries",
        services: ["Store consumables", "POS supplies", "Scheduled replenishment"]
      },
      {
        name: "Network service",
        description: "One service standard for several locations: supply, technical support and equipment performance control.",
        items: "Multiple points · One standard · Service · Reporting",
        services: ["Shelf equipment", "Scheduled replenishment", "Cleaning supplies"]
      }
    ]
  },
  horeca: {
    heroDescription: "Choose the required services and send the request. Binova will build a solution around your format: coffee, professional equipment, team training, replenishment and technical support.",
    proofTitle: "Coffee, equipment, training and service in one system for your venue.",
    primaryCta: "Build solution",
    packageIntro: "This is a starting point for the offer. Choose a base option, then add the services your venue format needs.",
    requestEyebrow: "Solution request",
    requestTitle: "Build a solution for your venue",
    requestIntro: "Select what your venue needs. Binova will prepare an offer around the format, guest flow, menu and service load.",
    servicesTitle: "What to include in the solution",
    contextLabel: "Request details",
    contextPlaceholder: "Describe the venue format, current supplier, equipment, beverage menu, guest flow, delivery frequency and desired launch timing.",
    submitLabel: "Get offer",
    serviceCta: "Add",
    companySizeLabel: "Venue format",
    companySizeOptions: ["Cafe", "Restaurant", "Hotel", "Bar", "Coffee shop", "Venue network", "Other"],
    employeeLabel: "Estimated guest flow / day",
    employeePlaceholder: "Example: 100-300 guests",
    catalogEyebrow: "Catalog",
    catalogTitle: "Products and services for HoReCa",
    catalogIntro: "Key components that can be combined around the venue format, menu and service load.",
    catalogItems: [
      {
        category: "Coffee",
        name: "HoReCa espresso blend",
        description: "Coffee beans for restaurants, cafes and hotels, built for stable taste and intensive daily service.",
        imageUrl: "https://images.unsplash.com/photo-1447933601403-0c6688de566e?auto=format&fit=crop&w=900&q=82"
      },
      {
        category: "Training",
        name: "Barista launch training",
        description: "Team training for consistent beverage quality, proper equipment setup and repeatable service.",
        imageUrl: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=900&q=82"
      }
    ],
    serviceDescriptions: {
      "Coffee beans": "Coffee selection around menu, taste, flow intensity and venue format.",
      "Professional machines": "Coffee machines and equipment for stable work during peak hours.",
      "Machine service": "Technical support, calibration and maintenance of equipment.",
      "Tabletop supplies": "Sugar, napkins, cups and other items for guest service.",
      "Kitchen hygiene": "Products and consumables for cleanliness of the coffee zone and equipment.",
      "Emergency replenishment": "Fast supply of coffee, consumables or related goods when stock is low."
    },
    presets: [
      {
        name: "HoReCa starter",
        description: "A base solution for launching or updating the coffee zone: coffee, equipment, service and a hygiene starter set.",
        items: "Coffee · Professional machine · Service · Kitchen hygiene",
        services: ["Coffee beans", "Professional machines", "Machine service", "Kitchen hygiene"]
      },
      {
        name: "Coffee beans",
        description: "Coffee selection around venue format, menu, flow intensity and desired cup taste.",
        items: "Espresso · Blends · Tasting · Regular replenishment",
        services: ["Coffee beans", "Emergency replenishment"]
      },
      {
        name: "Professional machines",
        description: "Selection, installation and maintenance of equipment for stable work during peak hours.",
        items: "Coffee machines · Grinders · Installation · Calibration · Service",
        services: ["Professional machines", "Machine service"]
      }
    ]
  }
} as const;

const companySizes = [
  { value: "small", label: "Small", hint: "1-20 people / one location" },
  { value: "medium", label: "Medium", hint: "21-100 people / several teams" },
  { value: "large", label: "Large", hint: "100+ people / network or complex operation" }
];

const ensureSiteTables = () => {
  db.exec(`
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

    CREATE TRIGGER IF NOT EXISTS "AdminAccount_updatedAt"
    AFTER UPDATE ON "AdminAccount"
    FOR EACH ROW
    BEGIN
      UPDATE "AdminAccount" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = OLD."id";
    END;

    CREATE TRIGGER IF NOT EXISTS "ClientLead_updatedAt"
    AFTER UPDATE ON "ClientLead"
    FOR EACH ROW
    BEGIN
      UPDATE "ClientLead" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = OLD."id";
    END;

    CREATE TRIGGER IF NOT EXISTS "CalculatorRule_updatedAt"
    AFTER UPDATE ON "CalculatorRule"
    FOR EACH ROW
    BEGIN
      UPDATE "CalculatorRule" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = OLD."id";
    END;

    CREATE TRIGGER IF NOT EXISTS "ServicePackage_updatedAt"
    AFTER UPDATE ON "ServicePackage"
    FOR EACH ROW
    BEGIN
      UPDATE "ServicePackage" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = OLD."id";
    END;
  `);

  const addClientLeadColumn = (definition: string) => {
    try {
      db.exec(`ALTER TABLE "ClientLead" ADD COLUMN ${definition}`);
    } catch (error: any) {
      if (!String(error?.message ?? "").includes("duplicate column name")) {
        throw error;
      }
    }
  };

  addClientLeadColumn(`"businessSegment" TEXT`);
  addClientLeadColumn(`"businessFormat" TEXT`);
  addClientLeadColumn(`"contactPerson" TEXT`);
  addClientLeadColumn(`"employeesCount" INTEGER`);
  addClientLeadColumn(`"city" TEXT`);
  addClientLeadColumn(`"currentSupplier" TEXT`);
  addClientLeadColumn(`"currentEquipment" TEXT`);
  addClientLeadColumn(`"desiredStartDate" TEXT`);
  addClientLeadColumn(`"budgetRange" TEXT`);
  addClientLeadColumn(`"deliveryFrequency" TEXT`);
  addClientLeadColumn(`"selectedServices" TEXT`);
  addClientLeadColumn(`"additionalDetails" TEXT`);
  addClientLeadColumn(`"estimatedDealValue" INTEGER`);
  addClientLeadColumn(`"setupFee" INTEGER`);
  addClientLeadColumn(`"yearlyValue" INTEGER`);
  addClientLeadColumn(`"pricingRuleId" TEXT`);
  addClientLeadColumn(`"selectedServiceLayers" TEXT`);
  addClientLeadColumn(`"priceBreakdown" TEXT`);
  addClientLeadColumn(`"assignedManager" TEXT`);
  addClientLeadColumn(`"followUpDate" TEXT`);
  addClientLeadColumn(`"language" TEXT DEFAULT 'en'`);
  addClientLeadColumn(`"summaryToken" TEXT`);

  const insertRule = db.prepare(`
    INSERT OR IGNORE INTO "CalculatorRule" ("segment", "companySize", "basePrice", "perEmployeePrice", "perLocationPrice")
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const segment of ["office", "retail", "horeca"]) {
    insertRule.run(segment, "small", 390, 8, 90);
    insertRule.run(segment, "medium", 790, 6, 150);
    insertRule.run(segment, "large", 1490, 4, 240);
  }

  const countPackages = db.prepare(`SELECT COUNT(*) as count FROM "ServicePackage"`).get().count as number;
  if (countPackages === 0) {
    const insertPackage = db.prepare(`
      INSERT INTO "ServicePackage" ("segment", "name", "description", "items", "monthlyPrice", "source")
      VALUES (?, ?, ?, ?, ?, 'SYSTEM')
    `);
    insertPackage.run("office", "Office Coffee Core", "Coffee, machine rental and scheduled maintenance for a growing office.", "Coffee beans\nCoffee machine\nMonthly service\nWater starter pack", 890);
    insertPackage.run("retail", "Retail Daily Ops", "Store consumables, POS basics and replenishment routine for retail locations.", "Store consumables\nPOS supplies\nShelf care\nMonthly delivery route", 1240);
    insertPackage.run("horeca", "HoReCa Bar Ready", "Professional coffee setup with service response and hygiene essentials.", "Coffee beans\nProfessional machine\nMachine service\nKitchen hygiene starter", 1760);
  }

  const countCatalogItems = db.prepare(`SELECT COUNT(*) as count FROM "CatalogItem"`).get().count as number;
  if (countCatalogItems === 0) {
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
};

ensureSiteTables();

const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const slugLabel = (segment: string): string => businessLines[segment as keyof typeof businessLines]?.label ?? segment;
const money = (value: unknown): string => `${Number(value || 0).toLocaleString("en-US")} EUR/mo`;
const formatDate = (value: string): string => new Date(`${value}Z`).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

const hashPassword = (password: string): string => {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
};

const verifyPassword = (password: string, stored: string): boolean => {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expected));
};

const parseCookies = (request: http.IncomingMessage): Record<string, string> =>
  Object.fromEntries(
    (request.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );

const getBody = (request: http.IncomingMessage): Promise<Record<string, string | string[]>> =>
  new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error("Body too large"));
      }
    });
    request.on("end", () => resolve(querystring.parse(body) as Record<string, string | string[]>));
    request.on("error", reject);
  });

const asString = (value: string | string[] | undefined): string => Array.isArray(value) ? value[0] ?? "" : value ?? "";
const asArray = (value: string | string[] | undefined): string[] => Array.isArray(value) ? value : value ? [value] : [];
const asNumber = (value: string | string[] | undefined, fallback = 0): number => {
  const parsed = Number(asString(value).match(/\d+(?:\.\d+)?/)?.[0] ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
};

const statementAll = (sql: string, ...params: any[]): Row[] => db.prepare(sql).all(...params) as Row[];
const statementGet = (sql: string, ...params: any[]): Row | undefined => db.prepare(sql).get(...params) as Row | undefined;

const activePackages = (segment?: string): Row[] =>
  segment
    ? statementAll(`SELECT * FROM "ServicePackage" WHERE "status" = 'ACTIVE' AND "segment" = ? ORDER BY "monthlyPrice" ASC`, segment)
      : statementAll(`SELECT * FROM "ServicePackage" WHERE "status" = 'ACTIVE' ORDER BY "segment" ASC, "monthlyPrice" ASC`);

const catalogItems = (segment?: string): Row[] =>
  segment
    ? statementAll(`SELECT * FROM "CatalogItem" WHERE "status" = 'ACTIVE' AND "segment" = ? ORDER BY "category", "name"`, segment)
    : statementAll(`SELECT * FROM "CatalogItem" WHERE "status" = 'ACTIVE' ORDER BY "segment", "category", "name"`);

const approvedProducts = (segment?: string): Row[] =>
  segment
    ? statementAll(
        `SELECT ps.*, pp.id as photoId
         FROM "ProductSubmission" ps
         LEFT JOIN "ProductPhoto" pp ON pp."submissionId" = ps."id"
         WHERE ps."segment" = ? AND ps."status" IN ('APPROVED', 'EXPORTED')
         GROUP BY ps."id"
         ORDER BY ps."createdAt" DESC`,
        slugLabel(segment)
      )
    : statementAll(
        `SELECT ps.*, pp.id as photoId
         FROM "ProductSubmission" ps
         LEFT JOIN "ProductPhoto" pp ON pp."submissionId" = ps."id"
         WHERE ps."status" IN ('APPROVED', 'EXPORTED')
         GROUP BY ps."id"
         ORDER BY ps."createdAt" DESC`
      );

const calculateEstimate = (segment: string, companySize: string, employeeCount: number, locationsCount: number, services: string[]): number => {
  const rule = statementGet(
    `SELECT * FROM "CalculatorRule" WHERE "segment" = ? AND "companySize" = ? AND "active" = 1`,
    segment,
    companySize
  );
  const base = Number(rule?.basePrice ?? 500);
  const perEmployee = Number(rule?.perEmployeePrice ?? 5);
  const perLocation = Number(rule?.perLocationPrice ?? 100);
  const serviceTotal = services.reduce((sum, service) => sum + (defaultServicePrices[service] ?? 100), 0);
  return Math.round(base + employeeCount * perEmployee + Math.max(1, locationsCount) * perLocation + serviceTotal);
};

const translations: Record<string, Record<string, string>> = {
  ru: {
    "Binova Group": "Binova Group",
    "Binova Admin": "Админка Binova",
    "Office": "Офис",
    "Retail": "Ритейл",
    "HoReCa": "HoReCa",
    "About": "О нас",
    "Admin": "Админка",
    "Public site": "Сайт",
    "Logout": "Выйти",
    "Privacy Policy": "Политика конфиденциальности",
    "Terms": "Условия",
    "About us": "О нас",
    "Binova Group demo В· local MVP": "Binova Group demo · локальный MVP",
    "Office Solutions": "Офисные решения",
    "Retail Solutions": "Решения для ритейла",
    "HoReCa Solutions": "Решения для HoReCa",
    "Get Offer": "Получить предложение",
    "Coffee & beverage systems built around your business.": "Кофейные и beverage-системы, собранные вокруг вашего бизнеса.",
    "Choose your business type and get a tailored solution for products, equipment, supply, service and long-term support.": "Выберите тип бизнеса и получите решение под продукты, оборудование, поставки, сервис и долгосрочную поддержку.",
    "Get a tailored offer": "Получить персональное предложение",
    "Build package": "Собрать пакет",
    "Office Coffee Solutions": "Офисные кофейные решения",
    "Coffee, equipment and service for an office without extra operations": "Кофе, оборудование и сервис для офиса без лишней операционки",
    "Predictable coffee, tea, equipment and service for teams of any size.": "Предсказуемые кофе, чай, оборудование и сервис для команд любого размера.",
    "Build office package": "Собрать офисный пакет",
    "Retail & Multi-location Solutions": "Решения для ритейла и сетей",
    "Coffee solutions for stores and networks": "Кофейные решения для магазинов и сетей",
    "Standardized beverage systems for stores, networks and high-traffic locations.": "Стандартизированные beverage-системы для магазинов, сетей и точек с высоким трафиком.",
    "Configure retail solution": "Настроить решение для ритейла",
    "HoReCa Beverage Systems": "Beverage-системы для HoReCa",
    "Stable coffee and service for HoReCa without downtime": "Стабильный кофе и сервис для HoReCa без простоев",
    "Professional coffee, equipment, training and service for cafes, hotels and restaurants.": "Профессиональный кофе, оборудование, обучение и сервис для кафе, отелей и ресторанов.",
    "Request HoReCa setup": "Запросить HoReCa setup",
    "Coffee systems for the way your business works.": "Кофейные системы под то, как работает ваш бизнес.",
    "Choose your business line. We will shape the right beverage service experience around your team, locations and customers.": "Выберите направление бизнеса. Мы соберем сервис напитков под вашу команду, точки и клиентов.",
    "Why Binova": "Почему Binova",
    "Less hassle. Better coffee. One managed system.": "Меньше хлопот. Лучше кофе. Одна управляемая система.",
    "Tell us how your business works. We’ll shape the right setup: products, equipment, supply, service and support.": "Расскажите, как работает ваш бизнес. Мы соберем правильную конфигурацию: продукты, оборудование, поставки, сервис и поддержку.",
    "Everything works, every day": "Все работает каждый день",
    "Equipment, supply and service are managed together, so your team does not have to coordinate separate suppliers.": "Оборудование, поставки и сервис управляются вместе, поэтому вашей команде не нужно координировать разных поставщиков.",
    "Quality": "Качество",
    "The right setup for every cup": "Правильная конфигурация для каждой чашки",
    "Coffee, equipment and service are selected around your business type, volume and customer experience.": "Кофе, оборудование и сервис подбираются под тип бизнеса, объем и клиентский опыт.",
    "Control": "Контроль",
    "One partner, one clear process": "Один партнер, один понятный процесс",
    "Every Office, HoReCa or Retail request starts structured and continues with a dedicated Binova team.": "Каждая заявка Office, HoReCa или Retail начинается структурно и продолжается с выделенной командой Binova.",
    "For teams, kitchens, meeting rooms and employee experience.": "Для команд, кухонь, переговорных и employee experience.",
    "For stores, networks, traffic points and standardized service.": "Для магазинов, сетей, точек трафика и стандартизированного сервиса.",
    "For cafes, hotels, restaurants and hospitality operations.": "Для кафе, отелей, ресторанов и hospitality-операций.",
    "Less procurement noise. Better beverage experience.": "Меньше закупочного шума. Лучше опыт напитков.",
    "No public price tables and no catalog maze. Pick the environment, select services, send context.": "Без публичных прайсов и лабиринта каталога. Выберите среду, отметьте сервисы и отправьте контекст.",
    "Pick the environment, choose the service layers and send a structured request to the Binova team.": "Выберите направление, отметьте сервисы и отправьте структурированную заявку команде Binova.",
    "Select what you need and send the request. The Binova team shapes the service around your real operation.": "Выберите нужные сервисы и отправьте заявку. Команда Binova соберет сервис под вашу реальную операционную модель.",
    "Continuity": "Стабильность",
    "Reliable daily service": "Надежный ежедневный сервис",
    "Equipment, replenishment and support are treated as one operating experience.": "Оборудование, пополнение и поддержка работают как единый операционный опыт.",
    "Taste": "Вкус",
    "Coffee people remember": "Кофе, который запоминают",
    "Products and service setup are selected for the business context, not sold as isolated SKUs.": "Продукты и сервис подбираются под бизнес-контекст, а не продаются как отдельные SKU.",
    "Care": "Забота",
    "One partner owns the flow": "Один партнер отвечает за весь процесс",
    "Office, Retail and HoReCa requests start clean and continue with a dedicated Binova conversation.": "Запросы Office, Retail и HoReCa стартуют структурно и продолжаются в отдельном диалоге с Binova.",
    "Office solution": "Решение для офиса",
    "Choose your team size, beverage format and required services. Binova will build a solution for your office: coffee, tea, equipment, supply and maintenance.": "Выберите размер команды, формат напитков и нужные сервисы. Binova соберёт решение под ваш офис: кофе, чай, оборудование, поставки и обслуживание.",
    "From a basic set to a complete coffee system for a large team.": "От базового набора до полноценной кофейной системы для большой команды.",
    "This is a starting point for the offer. Choose a base option, then add the services you need.": "Это отправная точка для предложения. Выберите базовый вариант, а затем добавьте нужные услуги.",
    "Basic office package": "Базовый офисный пакет",
    "Coffee, equipment and regular maintenance for stable office operations.": "Кофе, оборудование и регулярное обслуживание для стабильной работы офиса.",
    "Coffee · Coffee machine · Monthly service · Starter kit": "Кофе · Кофемашина · Ежемесячный сервис · Стартовый набор",
    "Beverages and consumables": "Напитки и расходники",
    "Coffee, tea, sugar, cups and other items that can be replenished regularly.": "Кофе, чай, сахар, стаканы и другие позиции, которые можно пополнять регулярно.",
    "Coffee beans · Instant coffee · Tea · Sugar · Cups": "Зерновой кофе · Растворимый кофе · Чай · Сахар · Стаканы",
    "Equipment and service": "Оборудование и сервис",
    "Coffee machines, installation, maintenance and support so everything works without downtime.": "Кофемашины, установка, обслуживание и поддержка, чтобы всё работало без простоев.",
    "Rental · Purchase · Installation · Maintenance · Replacement": "Аренда · Покупка · Установка · Обслуживание · Замена",
    "Retail solution": "Решение для ритейла",
    "Choose your location format, required services and send the request. Binova will build a solution for your network: equipment, beverages, supply, service and one standard across every location.": "Выберите формат локаций, нужные сервисы и отправьте заявку. Binova соберёт решение для вашей сети: оборудование, напитки, поставки, обслуживание и единый стандарт на всех точках.",
    "From one point to a location network, we shape the setup around your format.": "От одной точки до сети локаций — подберём решение под ваш формат.",
    "This is a starting point for the offer. Choose a base option, then add the services your locations need.": "Это отправная точка для предложения. Выберите базовый вариант, а затем добавьте нужные услуги под ваши локации.",
    "Basic retail solution": "Базовое решение для ритейла",
    "A coffee point for a store, gas station, commercial area or another high-traffic location.": "Кофейная точка для магазина, АЗС, торговой зоны или другой локации с трафиком.",
    "Equipment · Beverages · Consumables · Basic service": "Оборудование · Напитки · Расходники · Базовое обслуживание",
    "Daily replenishment": "Ежедневное пополнение",
    "Regular supply of coffee, cups, sugar, consumables and other items for stable point operations.": "Регулярные поставки кофе, стаканов, сахара, расходников и других позиций для стабильной работы точки.",
    "Coffee · Cups · Sugar · Consumables · Planned deliveries": "Кофе · Стаканы · Сахар · Расходники · Плановые поставки",
    "Network service": "Сервис для сети",
    "One service standard for several locations: supply, technical support and equipment performance control.": "Единый стандарт обслуживания для нескольких локаций: поставки, техническая поддержка и контроль работы оборудования.",
    "Multiple points · One standard · Service · Reporting": "Несколько точек · Единый стандарт · Сервис · Отчётность",
    "HoReCa solution": "Решение для HoReCa",
    "Choose the required services and send the request. Binova will build a solution around your format: coffee, professional equipment, team training, replenishment and technical support.": "Выберите нужные сервисы и отправьте заявку. Binova соберёт решение под ваш формат: кофе, профессиональное оборудование, обучение команды, пополнение и техническую поддержку.",
    "Coffee, equipment, training and service in one system for your venue.": "Кофе, оборудование, обучение и сервис — в одной системе для вашего заведения.",
    "This is a starting point for the offer. Choose a base option, then add the services your venue format needs.": "Это отправная точка для предложения. Выберите базовый вариант, а затем добавьте нужные услуги под ваш формат заведения.",
    "HoReCa starter": "Старт для HoReCa",
    "A base solution for launching or updating the coffee zone: coffee, equipment, service and a hygiene starter set.": "Базовое решение для запуска или обновления кофейной зоны: кофе, оборудование, сервис и гигиенический стартовый набор.",
    "Coffee · Professional machine · Service · Kitchen hygiene": "Кофе · Профессиональная машина · Сервис · Гигиена кухни",
    "Coffee selection around venue format, menu, flow intensity and desired cup taste.": "Подбор кофе под формат заведения, меню, интенсивность потока и желаемый вкус в чашке.",
    "Espresso · Blends · Tasting · Regular replenishment": "Эспрессо · Бленды · Дегустация · Регулярное пополнение",
    "Selection, installation and maintenance of equipment for stable work during peak hours.": "Подбор, установка и обслуживание оборудования для стабильной работы в часы нагрузки.",
    "Coffee machines · Grinders · Installation · Calibration · Service": "Кофемашины · Гриндеры · Установка · Настройка · Сервис",
    "Office operations without daily procurement noise": "Офис без ежедневного закупочного шума",
    "Retail supply packages for stores and networks": "Пакеты снабжения для магазинов и сетей",
    "HoReCa service bundles for hospitality teams": "Сервисные пакеты для HoReCa-команд",
    "Coffee, water, hygiene, consumables, equipment and planned replenishment for offices.": "Кофе, вода, гигиена, расходники, оборудование и плановое пополнение для офисов.",
    "Shelf-ready assortment, replenishment rhythm, store equipment and commercial operations support.": "Готовый ассортимент, ритм пополнения, оборудование точки и поддержка коммерческих операций.",
    "Coffee, equipment, maintenance, hygiene and operational products for hotels, restaurants and cafes.": "Кофе, оборудование, сервис, гигиена и операционные продукты для отелей, ресторанов и кафе.",
    "Select services": "Выбрать сервисы",
    "Build solution": "Собрать решение",
    "Back to segments": "Назад к направлениям",
    "Solution request": "Заявка на решение",
    "Choose services and send the request": "Выберите услуги и отправьте запрос",
    "Select what your office needs. We will build the solution and prepare an offer.": "Отметьте, что нужно вашему офису. Мы соберём решение и подготовим предложение.",
    "Build a solution for your point or network": "Соберите решение для вашей точки или сети",
    "Build a solution for your venue": "Соберите решение для вашего заведения",
    "Select what your location needs. Binova will prepare a solution around the format, traffic and operating model.": "Отметьте, что нужно вашей локации. Binova подготовит решение под формат, трафик и операционную модель.",
    "Select what your venue needs. Binova will prepare an offer around the format, guest flow, menu and service load.": "Отметьте, что нужно вашему заведению. Binova подготовит предложение под формат, поток гостей, меню и сервисную нагрузку.",
    "Choose the services you need": "Выберите нужные услуги",
    "What to include in the solution": "Что включить в решение",
    "Request details": "Детали заявки",
    "Describe the current situation, supply preferences, equipment, budget and launch timing.": "Опишите текущую ситуацию, пожелания по поставкам, оборудованию, бюджету и срокам запуска.",
    "Describe the location format, current supplier, delivery frequency, desired launch timing, budget and important requirements.": "Опишите формат локации, текущего поставщика, частоту поставок, желаемый старт, бюджет и важные требования.",
    "Get offer": "Получить предложение",
    "Select service": "Выбрать услугу",
    "Add": "Добавить",
    "Coffee, tea and beverages matched to your team's consumption.": "Кофе, чай и напитки под потребление вашей команды.",
    "Selection, installation and maintenance of office equipment.": "Подбор, установка и обслуживание оборудования для офиса.",
    "Water, regular replenishment and service for the consumption point.": "Вода, регулярное пополнение и обслуживание точки потребления.",
    "Consumables for the kitchen, office and daily operations.": "Расходные материалы для кухни, офиса и ежедневной операционки.",
    "Cups, sugar, napkins and other items for regular replenishment.": "Стаканы, сахар, салфетки и другие позиции для регулярного пополнения.",
    "Scheduled maintenance so equipment works without downtime.": "Плановое обслуживание, чтобы оборудование работало без простоев.",
    "Cups, lids, sugar, stirrers and other items for daily point operations.": "Стаканы, крышки, сахар, мешалки и другие позиции для ежедневной работы точки.",
    "POS solutions and equipment for convenient beverage sales at the location.": "POS-решения и оборудование для удобной продажи напитков на локации.",
    "A ready coffee zone for a store, gas station or point with regular traffic.": "Готовая кофейная зона для магазина, АЗС или точки с регулярным трафиком.",
    "Receipts, paper, stickers and basic materials for point operations.": "Чеки, бумага, стикеры и базовые материалы для операционной работы точки.",
    "Products and consumables to keep the beverage zone clean.": "Средства и расходные материалы для поддержания чистоты зоны напитков.",
    "Regular deliveries of coffee, consumables and related goods by an agreed schedule.": "Регулярные поставки кофе, расходников и сопутствующих товаров по согласованному графику.",
    "Venue format": "Формат заведения",
    "Cafe": "Кафе",
    "Restaurant": "Ресторан",
    "Hotel": "Отель",
    "Bar": "Бар",
    "Coffee shop": "Кофейня",
    "Venue network": "Сеть заведений",
    "Other": "Другое",
    "Estimated guest flow / day": "Ориентировочный поток гостей / день",
    "Example: 100-300 guests": "Например: 100–300 гостей",
    "Coffee selection around menu, taste, flow intensity and venue format.": "Подбор кофе под меню, вкус, интенсивность потока и формат заведения.",
    "Coffee machines and equipment for stable work during peak hours.": "Кофемашины и оборудование для стабильной работы в часы нагрузки.",
    "Technical support, calibration and maintenance of equipment.": "Техническая поддержка, настройка и обслуживание оборудования.",
    "Sugar, napkins, cups and other items for guest service.": "Сахар, салфетки, стаканы и другие позиции для обслуживания гостей.",
    "Products and consumables for cleanliness of the coffee zone and equipment.": "Средства и расходники для чистоты кофейной зоны и оборудования.",
    "Fast supply of coffee, consumables or related goods when stock is low.": "Быстрая поставка кофе, расходников или сопутствующих товаров при нехватке.",
    "Pick the service layers. We build the system.": "Выберите слои сервиса. Мы соберем систему.",
    "Service direction": "Направление сервиса",
    "Choose a starting package": "Выберите стартовый пакет",
    "Use these as orientation. The final offer is shaped after the request.": "Это ориентиры. Финальное предложение формируется после заявки.",
    "A clean starting point for the conversation with Binova.": "Чистая стартовая точка для разговора с Binova.",
    "Packages are being prepared": "Пакеты готовятся",
    "Send a request and the Binova team will recommend the right service setup.": "Отправьте заявку, и команда Binova предложит подходящую конфигурацию.",
    "Your request": "Ваша заявка",
    "Select services and send context": "Выберите сервисы и отправьте контекст",
    "The cup fills as you build the request. Select what matters now; details can be refined with the Binova team.": "Чашка наполняется по мере сборки заявки. Выберите важные сервисы сейчас, детали уточним с командой Binova.",
    "The preview stays clean as you build the request. Select what matters now; details can be refined with the Binova team.": "Предпросмотр остается аккуратным, пока вы собираете заявку. Выберите важные сервисы сейчас, детали уточнит команда Binova.",
    "Select services below and the preview updates immediately.": "Выберите сервисы ниже, и предпросмотр обновится сразу.",
    "Company name": "Название компании",
    "Contact name": "Контактное лицо",
    "Email": "Email",
    "Phone": "Телефон",
    "Company size": "Тип компании / размер",
    "Employees": "Количество сотрудников",
    "Locations": "Количество локаций",
    "Services": "Сервисы",
    "Context / request": "Контекст / запрос",
    "Send request": "Отправить заявку",
    "Example SRL": "Example SRL",
    "Decision maker": "ЛПР / контакт",
    "+373 ...": "+373 ...",
    "Current supplier, delivery rhythm, expected start date, decision criteria...": "Текущий поставщик, ритм доставки, желаемый старт, критерии решения...",
    "Small - 1-20 people / one location": "Малый - 1-20 человек / одна локация",
    "Medium - 21-100 people / several teams": "Средний - 21-100 человек / несколько команд",
    "Large - 100+ people / network or complex operation": "Крупный - 100+ человек / сеть или сложная операция",
    "Coffee program": "Кофейная программа",
    "Coffee machines": "Кофемашины",
    "Water service": "Вода и сервис",
    "Cleaning supplies": "Клининг-расходники",
    "Office consumables": "Офисные расходники",
    "Preventive maintenance": "Профилактический сервис",
    "Store consumables": "Расходники магазина",
    "Shelf equipment": "Полочное оборудование",
    "Coffee corner": "Кофейный уголок",
    "POS supplies": "POS-расходники",
    "Scheduled replenishment": "Плановое пополнение",
    "Coffee beans": "Кофейные зерна",
    "Professional machines": "Профессиональные машины",
    "Machine service": "Сервис машин",
    "Tabletop supplies": "Расходники для столов",
    "Kitchen hygiene": "Гигиена кухни",
    "Emergency replenishment": "Срочное пополнение",
    "Tap to add this layer to the request.": "Нажмите, чтобы добавить слой в заявку.",
    "Live request preview": "Живой предпросмотр",
    "Your service cup": "Ваша сервисная чашка",
    "Service stack": "Стек сервисов",
    "Selected services become proposal layers. Keep the request lean; Binova shapes the final configuration after review.": "Выбранные сервисы становятся слоями предложения. Заявка остается короткой, финальную конфигурацию Binova соберет после ревью.",
    "Each selected service adds a clean layer to the cup and to the proposal stack.": "Каждый выбранный сервис добавляет аккуратный слой в чашку и в стек предложения.",
    "Each selected service adds a clean layer to the cup.": "Каждый выбранный сервис добавляет аккуратный слой в чашку.",
    "Selected service layers": "Выбранные слои сервисов",
    "Service layer": "Слой сервиса",
    "Ready for Binova review": "Готово к ревью Binova",
    "Ready to send": "Готово к отправке",
    "Select services on the left. The cup fills with coffee, milk and foam layers as your request becomes more complete.": "Выбирайте сервисы слева. Чашка наполняется слоями кофе, молока и пены по мере комплектации заявки.",
    "services selected": "сервисов выбрано",
    "Catalog feel": "Каталог",
    "Products and services behind the experience": "Продукты и сервисы за этим опытом",
    "Products and services for retail": "Продукты и сервисы для ритейла",
    "Products and services for HoReCa": "Продукты и сервисы для HoReCa",
    "No public price table. Just a clear view of what can be included in the service.": "Без публичного прайса. Только понятный обзор того, что может войти в сервис.",
    "Core products and service components that can be combined for this business line.": "Ключевые продукты и сервисные компоненты, которые можно комбинировать для этого направления.",
    "Key components that can be combined around your location or network format.": "Ключевые компоненты, которые можно комбинировать под формат вашей локации или сети.",
    "Key components that can be combined around the venue format, menu and service load.": "Ключевые компоненты, которые можно комбинировать под формат заведения, меню и сервисную нагрузку.",
    "Cups and lids for the point": "Стаканы и крышки для точки",
    "Branded or standard cups, lids, stirrers and sugar for daily beverage sales.": "Брендированные или стандартные стаканы, крышки, мешалки и сахар для ежедневной продажи напитков.",
    "Self-service coffee corner": "Кофейный уголок self-service",
    "A ready solution for stores, gas stations and traffic locations: equipment, beverages, consumables and replenishment.": "Готовое решение для магазинов, АЗС и локаций с трафиком: оборудование, напитки, расходники и пополнение.",
    "HoReCa espresso blend": "Эспрессо-бленд для HoReCa",
    "Coffee beans for restaurants, cafes and hotels, built for stable taste and intensive daily service.": "Кофейные зёрна для ресторанов, кафе и отелей, рассчитанные на стабильный вкус и интенсивную ежедневную работу.",
    "Training": "Обучение",
    "Barista launch training": "Стартовое обучение бариста",
    "Team training for consistent beverage quality, proper equipment setup and repeatable service.": "Обучение команды для стабильного качества напитков, правильной настройки оборудования и повторяемого сервиса.",
    "Can be combined with catalog items, equipment, replenishment rhythm and service support.": "Можно комбинировать с товарами каталога, оборудованием, ритмом пополнения и сервисной поддержкой.",
    "About Binova Group": "О Binova Group",
    "The operator behind business coffee systems.": "Оператор бизнес-систем для кофе.",
    "Binova Group is positioned as the next evolution of fifteen years of Binonic Lux experience: not just a supplier of coffee, but an operator of beverage systems for business. The visible product is coffee. The value is continuity: calibrated equipment, predictable replenishment, service response, replacement logic and a partner who owns the operating complexity.": "Binova Group - следующий этап пятнадцатилетнего опыта Binonic Lux: не просто поставщик кофе, а оператор beverage-систем для бизнеса. Видимый продукт - кофе. Ценность - стабильность: настроенное оборудование, предсказуемое пополнение, сервисная реакция, логика замены и партнер, который берет на себя операционную сложность.",
    "Leadership through systems": "Лидерство через системы",
    "Binova moves the conversation from product price to business reliability: uptime, planned deliveries, service standards and clear commercial ownership.": "Binova переводит разговор с цены продукта на надежность бизнеса: uptime, плановые доставки, стандарты сервиса и понятную коммерческую ответственность.",
    "Service as the differentiator": "Сервис как отличие",
    "Fast intervention, preventive maintenance and replacement equipment become visible sales arguments instead of invisible back-office work.": "Быстрая реакция, профилактика и заменное оборудование становятся видимыми аргументами продаж, а не скрытой операционной работой.",
    "Segment-specific growth": "Рост по сегментам",
    "Office, Retail and HoReCa each get a different logic of offer, because a 10-person office, a cafe and a multi-location chain do not buy the same system.": "Office, Retail и HoReCa получают разную логику предложения, потому что офис на 10 человек, кафе и сеть точек покупают разные системы.",
    "Strategic promise": "Стратегическое обещание",
    "Operational peace becomes business growth.": "Операционное спокойствие становится ростом бизнеса.",
    "For offices, coffee becomes part of culture and retention. For HoReCa, it becomes differentiation, menu quality and repeat visits. For retail, it becomes a profit point with standardized execution across locations.": "Для офисов кофе становится частью культуры и удержания. Для HoReCa - отличием, качеством меню и повторными визитами. Для ритейла - точкой прибыли со стандартизированным исполнением.",
    "Why this digital demo matters": "Зачем это цифровое демо",
    "The website identifies the client segment, captures relevant operating context and gives the commercial team a structured request instead of a vague message.": "Сайт определяет сегмент клиента, собирает операционный контекст и дает коммерческой команде структурированную заявку вместо хаотичного сообщения.",
    "Telegram keeps the catalog alive: products, photos, packages and availability can be added by the team without a developer.": "Telegram поддерживает каталог живым: продукты, фото, пакеты и доступность может добавлять команда без разработчика.",
    "Local demo privacy statement": "Политика приватности локального демо",
    "This MVP stores demo request data locally on this machine in SQLite. It is not connected to a production CRM, payment provider or public hosting environment.": "Этот MVP хранит демо-заявки локально на этой машине в SQLite. Он не подключен к production CRM, оплатам или публичному хостингу.",
    "Data collected": "Какие данные собираются",
    "Company name, contact name, email, phone, company size, selected services and request notes.": "Название компании, контакт, email, телефон, размер компании, выбранные сервисы и комментарий к заявке.",
    "Storage": "Хранение",
    "Data is stored in": "Данные хранятся в",
    "Usage": "Использование",
    "Data is used only to demonstrate request capture, admin review, calculator rules and package preparation.": "Данные используются только для демонстрации приема заявок, админки, правил калькулятора и подготовки пакетов.",
    "Deletion": "Удаление",
    "For the demo, records can be removed directly from SQLite or reset by replacing the local database.": "В демо записи можно удалить напрямую из SQLite или сбросить заменой локальной базы.",
    "Demo terms of use": "Условия использования демо",
    "This local site is a clickable commercial MVP for meetings and internal validation. Prices, packages and calculations are configurable demo values, not final contractual offers.": "Этот локальный сайт - кликабельный коммерческий MVP для встреч и внутренней проверки. Цены, пакеты и расчеты - настраиваемые демо-значения, не финальные коммерческие условия.",
    "Commercial terms": "Коммерческие условия",
    "Commercial conditions are prepared by a Binova manager after reviewing the request.": "Коммерческие условия готовит менеджер Binova после просмотра заявки.",
    "Local operation": "Локальная работа",
    "The demo runs locally on this machine through Telegram long polling and a localhost website.": "Демо работает локально на этой машине через Telegram long polling и localhost-сайт.",
    "Admin responsibility": "Ответственность админа",
    "Admins manage calculator rules, packages and lead review in the private admin area.": "Админы управляют правилами калькулятора, пакетами и заявками в закрытой админке.",
    "Phase 2": "Phase 2",
    "Production deployment should add real authentication, hosting, backups, audit logs and CRM integration.": "Для production нужны настоящая авторизация, хостинг, бэкапы, audit logs и CRM-интеграция.",
    "Control room": "Центр управления",
    "Dashboard": "Дашборд",
    "Leads": "Заявки",
    "Calculator": "Калькулятор",
    "Catalog": "Каталог",
    "Packages": "Пакеты",
    "Proposals": "Предложения",
    "Commercial cockpit": "Коммерческий cockpit",
    "Lead intake, pricing logic, managed catalog, service packages and commercial proposal links in one local control room.": "Заявки, логика цен, управляемый каталог, сервисные пакеты и ссылки на коммерческие предложения в одной локальной админке.",
    "Total leads": "Всего заявок",
    "New leads": "Новые заявки",
    "Bot catalog offers": "Каталог из бота",
    "Lead intake": "Прием заявок",
    "Every public business flow writes a request here.": "Каждый публичный бизнес-flow записывает заявку сюда.",
    "View leads": "Смотреть заявки",
    "Pricing": "Ценообразование",
    "Change base prices by segment and company size.": "Меняйте базовые цены по сегменту и размеру компании.",
    "Tune rules": "Настроить правила",
    "Bundles": "Бандлы",
    "Build offer bundles for sales conversations.": "Собирайте пакеты для коммерческих переговоров.",
    "Manage packages": "Управлять пакетами",
    "Product depth": "Глубина каталога",
    "Manage coffee, tea, equipment, services and consumables.": "Управляйте кофе, чаем, оборудованием, сервисами и расходниками.",
    "Manage catalog": "Управлять каталогом",
    "Proposal": "Предложение",
    "Commercial proposals": "Коммерческие предложения",
    "Turn a lead into a priced offer with selected packages and catalog items.": "Превратите заявку в коммерческое предложение с выбранными пакетами и товарами.",
    "Build proposal": "Собрать предложение"
  },
  ro: {
    "Binova Group": "Binova Group",
    "Binova Admin": "Administrare Binova",
    "Office": "Birouri",
    "Retail": "Retail",
    "HoReCa": "HoReCa",
    "About": "Despre noi",
    "Admin": "Admin",
    "Public site": "Site public",
    "Logout": "Ieșire",
    "Privacy Policy": "Politica de confidențialitate",
    "Terms": "Termeni",
    "About us": "Despre noi",
    "Binova Group demo В· local MVP": "Binova Group demo · MVP local",
    "Office Solutions": "Soluții pentru birouri",
    "Retail Solutions": "Soluții pentru retail",
    "HoReCa Solutions": "Soluții HoReCa",
    "Get Offer": "Cere ofertă",
    "Coffee & beverage systems built around your business.": "Sisteme de cafea și băuturi construite în jurul afacerii tale.",
    "Choose your business type and get a tailored solution for products, equipment, supply, service and long-term support.": "Alege tipul de business și primește o soluție adaptată pentru produse, echipamente, aprovizionare, service și suport pe termen lung.",
    "Get a tailored offer": "Cere o ofertă adaptată",
    "Build package": "Construiește pachetul",
    "Office Coffee Solutions": "Soluții de cafea pentru birouri",
    "Coffee, equipment and service for an office without extra operations": "Cafea, echipamente și service pentru birou fără operațiuni inutile",
    "Predictable coffee, tea, equipment and service for teams of any size.": "Cafea, ceai, echipamente și service predictibil pentru echipe de orice dimensiune.",
    "Build office package": "Construiește pachetul office",
    "Retail & Multi-location Solutions": "Soluții pentru retail și rețele",
    "Coffee solutions for stores and networks": "Soluții de cafea pentru magazine și rețele",
    "Standardized beverage systems for stores, networks and high-traffic locations.": "Sisteme standardizate de băuturi pentru magazine, rețele și locații cu trafic ridicat.",
    "Configure retail solution": "Configurează soluția retail",
    "HoReCa Beverage Systems": "Sisteme de băuturi HoReCa",
    "Stable coffee and service for HoReCa without downtime": "Cafea stabilă și service pentru HoReCa fără întreruperi",
    "Professional coffee, equipment, training and service for cafes, hotels and restaurants.": "Cafea profesională, echipamente, training și service pentru cafenele, hoteluri și restaurante.",
    "Request HoReCa setup": "Cere setup HoReCa",
    "Coffee systems for the way your business works.": "Sisteme de cafea pentru felul în care funcționează afacerea ta.",
    "Choose your business line. We will shape the right beverage service experience around your team, locations and customers.": "Alege direcția de business. Construim experiența potrivită de beverage service în jurul echipei, locațiilor și clienților tăi.",
    "Why Binova": "De ce Binova",
    "Less hassle. Better coffee. One managed system.": "Mai puține bătăi de cap. Cafea mai bună. Un singur sistem gestionat.",
    "Tell us how your business works. We’ll shape the right setup: products, equipment, supply, service and support.": "Spune-ne cum funcționează afacerea ta. Construim configurația potrivită: produse, echipamente, aprovizionare, service și suport.",
    "Everything works, every day": "Totul funcționează, în fiecare zi",
    "Equipment, supply and service are managed together, so your team does not have to coordinate separate suppliers.": "Echipamentele, aprovizionarea și service-ul sunt gestionate împreună, astfel încât echipa ta nu coordonează furnizori separați.",
    "Quality": "Calitate",
    "The right setup for every cup": "Configurația potrivită pentru fiecare ceașcă",
    "Coffee, equipment and service are selected around your business type, volume and customer experience.": "Cafeaua, echipamentele și service-ul sunt alese în funcție de tipul afacerii, volum și experiența clientului.",
    "Control": "Control",
    "One partner, one clear process": "Un partener, un proces clar",
    "Every Office, HoReCa or Retail request starts structured and continues with a dedicated Binova team.": "Fiecare cerere Office, HoReCa sau Retail pornește structurat și continuă cu o echipă Binova dedicată.",
    "For teams, kitchens, meeting rooms and employee experience.": "Pentru echipe, bucătării, săli de meeting și experiența angajaților.",
    "For stores, networks, traffic points and standardized service.": "Pentru magazine, rețele, puncte cu trafic și servicii standardizate.",
    "For cafes, hotels, restaurants and hospitality operations.": "Pentru cafenele, hoteluri, restaurante și operațiuni de ospitalitate.",
    "Less procurement noise. Better beverage experience.": "Mai puțin zgomot în achiziții. O experiență mai bună a băuturilor.",
    "No public price tables and no catalog maze. Pick the environment, select services, send context.": "Fără tabele publice de prețuri și fără labirint de catalog. Alege mediul, selectează serviciile și trimite contextul.",
    "Pick the environment, choose the service layers and send a structured request to the Binova team.": "Alege direcția, selectează straturile de servicii și trimite o cerere structurată echipei Binova.",
    "Select what you need and send the request. The Binova team shapes the service around your real operation.": "Selectează serviciile necesare și trimite cererea. Echipa Binova construiește serviciul în jurul operațiunii tale reale.",
    "Continuity": "Continuitate",
    "Reliable daily service": "Serviciu zilnic de încredere",
    "Equipment, replenishment and support are treated as one operating experience.": "Echipamentul, reaprovizionarea și suportul sunt tratate ca o singură experiență operațională.",
    "Taste": "Gust",
    "Coffee people remember": "Cafea pe care oamenii o țin minte",
    "Products and service setup are selected for the business context, not sold as isolated SKUs.": "Produsele și serviciile sunt alese pentru contextul de business, nu vândute ca SKU-uri izolate.",
    "Care": "Grijă",
    "One partner owns the flow": "Un singur partener gestionează tot fluxul",
    "Office, Retail and HoReCa requests start clean and continue with a dedicated Binova conversation.": "Cererile Office, Retail și HoReCa pornesc structurat și continuă într-o discuție dedicată cu Binova.",
    "Office solution": "Soluție pentru birouri",
    "Choose your team size, beverage format and required services. Binova will build a solution for your office: coffee, tea, equipment, supply and maintenance.": "Alege dimensiunea echipei, formatul băuturilor și serviciile necesare. Binova va construi o soluție pentru biroul tău: cafea, ceai, echipamente, aprovizionare și mentenanță.",
    "From a basic set to a complete coffee system for a large team.": "De la un set de bază până la un sistem complet de cafea pentru o echipă mare.",
    "This is a starting point for the offer. Choose a base option, then add the services you need.": "Acesta este punctul de pornire pentru ofertă. Alege o variantă de bază, apoi adaugă serviciile necesare.",
    "Basic office package": "Pachet office de bază",
    "Coffee, equipment and regular maintenance for stable office operations.": "Cafea, echipamente și mentenanță regulată pentru funcționarea stabilă a biroului.",
    "Coffee · Coffee machine · Monthly service · Starter kit": "Cafea · Espressor · Service lunar · Kit de start",
    "Beverages and consumables": "Băuturi și consumabile",
    "Coffee, tea, sugar, cups and other items that can be replenished regularly.": "Cafea, ceai, zahăr, pahare și alte poziții care pot fi reaprovizionate regulat.",
    "Coffee beans · Instant coffee · Tea · Sugar · Cups": "Cafea boabe · Cafea instant · Ceai · Zahăr · Pahare",
    "Equipment and service": "Echipamente și service",
    "Coffee machines, installation, maintenance and support so everything works without downtime.": "Espressoare, instalare, mentenanță și suport pentru funcționare fără întreruperi.",
    "Rental · Purchase · Installation · Maintenance · Replacement": "Chirie · Achiziție · Instalare · Mentenanță · Înlocuire",
    "Retail solution": "Soluție pentru retail",
    "Choose your location format, required services and send the request. Binova will build a solution for your network: equipment, beverages, supply, service and one standard across every location.": "Alege formatul locațiilor, serviciile necesare și trimite cererea. Binova va construi o soluție pentru rețeaua ta: echipamente, băuturi, aprovizionare, service și un standard unic în toate locațiile.",
    "From one point to a location network, we shape the setup around your format.": "De la un singur punct până la o rețea de locații, adaptăm soluția la formatul tău.",
    "This is a starting point for the offer. Choose a base option, then add the services your locations need.": "Acesta este punctul de pornire pentru ofertă. Alege o variantă de bază, apoi adaugă serviciile necesare locațiilor tale.",
    "Basic retail solution": "Soluție retail de bază",
    "A coffee point for a store, gas station, commercial area or another high-traffic location.": "Un punct de cafea pentru magazin, benzinărie, zonă comercială sau altă locație cu trafic.",
    "Equipment · Beverages · Consumables · Basic service": "Echipamente · Băuturi · Consumabile · Service de bază",
    "Daily replenishment": "Reaprovizionare zilnică",
    "Regular supply of coffee, cups, sugar, consumables and other items for stable point operations.": "Livrări regulate de cafea, pahare, zahăr, consumabile și alte poziții pentru funcționarea stabilă a punctului.",
    "Coffee · Cups · Sugar · Consumables · Planned deliveries": "Cafea · Pahare · Zahăr · Consumabile · Livrări planificate",
    "Network service": "Service pentru rețea",
    "One service standard for several locations: supply, technical support and equipment performance control.": "Un standard unic de service pentru mai multe locații: aprovizionare, suport tehnic și controlul funcționării echipamentelor.",
    "Multiple points · One standard · Service · Reporting": "Mai multe puncte · Un standard · Service · Raportare",
    "HoReCa solution": "Soluție pentru HoReCa",
    "Choose the required services and send the request. Binova will build a solution around your format: coffee, professional equipment, team training, replenishment and technical support.": "Alege serviciile necesare și trimite cererea. Binova va construi o soluție în jurul formatului tău: cafea, echipamente profesionale, training pentru echipă, reaprovizionare și suport tehnic.",
    "Coffee, equipment, training and service in one system for your venue.": "Cafea, echipamente, training și service într-un singur sistem pentru locația ta.",
    "This is a starting point for the offer. Choose a base option, then add the services your venue format needs.": "Acesta este punctul de pornire pentru ofertă. Alege o variantă de bază, apoi adaugă serviciile necesare formatului locației tale.",
    "HoReCa starter": "Start pentru HoReCa",
    "A base solution for launching or updating the coffee zone: coffee, equipment, service and a hygiene starter set.": "O soluție de bază pentru lansarea sau actualizarea zonei de cafea: cafea, echipamente, service și kit igienic de start.",
    "Coffee · Professional machine · Service · Kitchen hygiene": "Cafea · Mașină profesională · Service · Igienă bucătărie",
    "Coffee selection around venue format, menu, flow intensity and desired cup taste.": "Selecție de cafea în funcție de formatul locației, meniu, intensitatea fluxului și gustul dorit în ceașcă.",
    "Espresso · Blends · Tasting · Regular replenishment": "Espresso · Blenduri · Degustare · Reaprovizionare regulată",
    "Selection, installation and maintenance of equipment for stable work during peak hours.": "Selectarea, instalarea și mentenanța echipamentelor pentru lucru stabil în orele de vârf.",
    "Coffee machines · Grinders · Installation · Calibration · Service": "Espressoare · Râșnițe · Instalare · Calibrare · Service",
    "Office operations without daily procurement noise": "Operațiuni de birou fără zgomot zilnic în achiziții",
    "Retail supply packages for stores and networks": "Pachete de aprovizionare pentru magazine și rețele",
    "HoReCa service bundles for hospitality teams": "Pachete de servicii pentru echipe HoReCa",
    "Coffee, water, hygiene, consumables, equipment and planned replenishment for offices.": "Cafea, apă, igienă, consumabile, echipamente și reaprovizionare planificată pentru birouri.",
    "Shelf-ready assortment, replenishment rhythm, store equipment and commercial operations support.": "Asortiment gata de raft, ritm de reaprovizionare, echipament de magazin și suport operațional comercial.",
    "Coffee, equipment, maintenance, hygiene and operational products for hotels, restaurants and cafes.": "Cafea, echipamente, mentenanță, igienă și produse operaționale pentru hoteluri, restaurante și cafenele.",
    "Select services": "Selectează servicii",
    "Build solution": "Construiește soluția",
    "Back to segments": "Înapoi la segmente",
    "Solution request": "Cerere pentru soluție",
    "Choose services and send the request": "Alege serviciile și trimite cererea",
    "Select what your office needs. We will build the solution and prepare an offer.": "Bifează ce are nevoie biroul tău. Vom construi soluția și vom pregăti oferta.",
    "Build a solution for your point or network": "Construiește soluția pentru punctul sau rețeaua ta",
    "Build a solution for your venue": "Construiește soluția pentru locația ta",
    "Select what your location needs. Binova will prepare a solution around the format, traffic and operating model.": "Bifează ce are nevoie locația ta. Binova va pregăti soluția în funcție de format, trafic și model operațional.",
    "Select what your venue needs. Binova will prepare an offer around the format, guest flow, menu and service load.": "Bifează ce are nevoie locația ta. Binova va pregăti oferta în funcție de format, fluxul de oaspeți, meniu și încărcarea serviciului.",
    "Choose the services you need": "Alege serviciile necesare",
    "What to include in the solution": "Ce să includă soluția",
    "Request details": "Detaliile cererii",
    "Describe the current situation, supply preferences, equipment, budget and launch timing.": "Descrie situația actuală, preferințele de aprovizionare, echipamentele, bugetul și termenul de lansare.",
    "Describe the location format, current supplier, delivery frequency, desired launch timing, budget and important requirements.": "Descrie formatul locației, furnizorul actual, frecvența livrărilor, data dorită de start, bugetul și cerințele importante.",
    "Get offer": "Primește oferta",
    "Select service": "Alege serviciul",
    "Add": "Adaugă",
    "Coffee, tea and beverages matched to your team's consumption.": "Cafea, ceai și băuturi adaptate consumului echipei tale.",
    "Selection, installation and maintenance of office equipment.": "Selectarea, instalarea și mentenanța echipamentelor pentru birou.",
    "Water, regular replenishment and service for the consumption point.": "Apă, reaprovizionare regulată și service pentru punctul de consum.",
    "Consumables for the kitchen, office and daily operations.": "Consumabile pentru bucătărie, birou și operațiunile zilnice.",
    "Cups, sugar, napkins and other items for regular replenishment.": "Pahare, zahăr, șervețele și alte poziții pentru reaprovizionare regulată.",
    "Scheduled maintenance so equipment works without downtime.": "Mentenanță planificată pentru ca echipamentele să funcționeze fără întreruperi.",
    "Cups, lids, sugar, stirrers and other items for daily point operations.": "Pahare, capace, zahăr, palete și alte poziții pentru operarea zilnică a punctului.",
    "POS solutions and equipment for convenient beverage sales at the location.": "Soluții POS și echipamente pentru vânzarea comodă a băuturilor în locație.",
    "A ready coffee zone for a store, gas station or point with regular traffic.": "O zonă de cafea gata pentru magazin, benzinărie sau punct cu trafic regulat.",
    "Receipts, paper, stickers and basic materials for point operations.": "Bonuri, hârtie, stickere și materiale de bază pentru operarea punctului.",
    "Products and consumables to keep the beverage zone clean.": "Produse și consumabile pentru menținerea curățeniei în zona de băuturi.",
    "Regular deliveries of coffee, consumables and related goods by an agreed schedule.": "Livrări regulate de cafea, consumabile și produse conexe conform unui program agreat.",
    "Venue format": "Formatul locației",
    "Cafe": "Cafenea",
    "Restaurant": "Restaurant",
    "Hotel": "Hotel",
    "Bar": "Bar",
    "Coffee shop": "Coffee shop",
    "Venue network": "Rețea de locații",
    "Other": "Altul",
    "Estimated guest flow / day": "Flux estimativ de oaspeți / zi",
    "Example: 100-300 guests": "Exemplu: 100-300 oaspeți",
    "Coffee selection around menu, taste, flow intensity and venue format.": "Selecție de cafea în funcție de meniu, gust, intensitatea fluxului și formatul locației.",
    "Coffee machines and equipment for stable work during peak hours.": "Espressoare și echipamente pentru lucru stabil în orele de vârf.",
    "Technical support, calibration and maintenance of equipment.": "Suport tehnic, calibrare și mentenanță pentru echipamente.",
    "Sugar, napkins, cups and other items for guest service.": "Zahăr, șervețele, pahare și alte poziții pentru servirea oaspeților.",
    "Products and consumables for cleanliness of the coffee zone and equipment.": "Produse și consumabile pentru curățenia zonei de cafea și a echipamentelor.",
    "Fast supply of coffee, consumables or related goods when stock is low.": "Livrare rapidă de cafea, consumabile sau produse conexe când stocul este redus.",
    "Pick the service layers. We build the system.": "Alege straturile de servicii. Noi construim sistemul.",
    "Service direction": "Direcția serviciului",
    "Choose a starting package": "Alege un pachet de pornire",
    "Use these as orientation. The final offer is shaped after the request.": "Folosește-le ca orientare. Oferta finală se construiește după cerere.",
    "A clean starting point for the conversation with Binova.": "Un punct de pornire clar pentru discuția cu Binova.",
    "Packages are being prepared": "Pachetele sunt în pregătire",
    "Send a request and the Binova team will recommend the right service setup.": "Trimite o cerere și echipa Binova va recomanda configurația potrivită.",
    "Your request": "Cererea ta",
    "Select services and send context": "Selectează servicii și trimite contextul",
    "The cup fills as you build the request. Select what matters now; details can be refined with the Binova team.": "Ceașca se umple pe măsură ce construiești cererea. Alege ce contează acum; detaliile se clarifică împreună cu echipa Binova.",
    "The preview stays clean as you build the request. Select what matters now; details can be refined with the Binova team.": "Previzualizarea rămâne curată pe măsură ce construiești cererea. Alege serviciile importante acum; detaliile se clarifică împreună cu echipa Binova.",
    "Select services below and the preview updates immediately.": "Selectează serviciile de mai jos, iar previzualizarea se actualizează imediat.",
    "Company name": "Denumirea companiei",
    "Contact name": "Persoană de contact",
    "Email": "Email",
    "Phone": "Telefon",
    "Company size": "Tip companie / mărime",
    "Employees": "Număr de angajați",
    "Locations": "Număr de locații",
    "Services": "Servicii",
    "Context / request": "Context / cerere",
    "Send request": "Trimite cererea",
    "Example SRL": "Example SRL",
    "Decision maker": "Persoana de decizie",
    "+373 ...": "+373 ...",
    "Current supplier, delivery rhythm, expected start date, decision criteria...": "Furnizor actual, ritm de livrare, data estimată de start, criterii de decizie...",
    "Small - 1-20 people / one location": "Mică - 1-20 persoane / o locație",
    "Medium - 21-100 people / several teams": "Medie - 21-100 persoane / mai multe echipe",
    "Large - 100+ people / network or complex operation": "Mare - 100+ persoane / rețea sau operațiune complexă",
    "Coffee program": "Program de cafea",
    "Coffee machines": "Mașini de cafea",
    "Water service": "Serviciu de apă",
    "Cleaning supplies": "Consumabile de curățenie",
    "Office consumables": "Consumabile de birou",
    "Preventive maintenance": "Mentenanță preventivă",
    "Store consumables": "Consumabile magazin",
    "Shelf equipment": "Echipament de raft",
    "Coffee corner": "Colț de cafea",
    "POS supplies": "Consumabile POS",
    "Scheduled replenishment": "Reaprovizionare planificată",
    "Coffee beans": "Boabe de cafea",
    "Professional machines": "Mașini profesionale",
    "Machine service": "Service pentru mașini",
    "Tabletop supplies": "Consumabile pentru mese",
    "Kitchen hygiene": "Igienă bucătărie",
    "Emergency replenishment": "Reaprovizionare urgentă",
    "Tap to add this layer to the request.": "Apasă pentru a adăuga acest strat în cerere.",
    "Live request preview": "Previzualizare live",
    "Your service cup": "Ceașca ta de servicii",
    "Service stack": "Stack de servicii",
    "Selected services become proposal layers. Keep the request lean; Binova shapes the final configuration after review.": "Serviciile selectate devin straturi ale ofertei. Cererea rămâne scurtă; Binova construiește configurația finală după review.",
    "Each selected service adds a clean layer to the cup and to the proposal stack.": "Fiecare serviciu selectat adaugă un strat curat în ceașcă și în stack-ul ofertei.",
    "Each selected service adds a clean layer to the cup.": "Fiecare serviciu selectat adaugă un strat curat în ceașcă.",
    "Selected service layers": "Straturi de servicii selectate",
    "Service layer": "Strat de serviciu",
    "Ready for Binova review": "Gata pentru review Binova",
    "Ready to send": "Gata de trimis",
    "Select services on the left. The cup fills with coffee, milk and foam layers as your request becomes more complete.": "Selectează serviciile din stânga. Ceașca se umple cu straturi de cafea, lapte și spumă pe măsură ce cererea devine mai completă.",
    "services selected": "servicii selectate",
    "Catalog feel": "Catalog",
    "Products and services behind the experience": "Produsele și serviciile din spatele experienței",
    "Products and services for retail": "Produse și servicii pentru retail",
    "Products and services for HoReCa": "Produse și servicii pentru HoReCa",
    "No public price table. Just a clear view of what can be included in the service.": "Fără tabel public de prețuri. Doar o imagine clară a ceea ce poate fi inclus în serviciu.",
    "Core products and service components that can be combined for this business line.": "Produse cheie și componente de servicii care pot fi combinate pentru această direcție de business.",
    "Key components that can be combined around your location or network format.": "Componente cheie care pot fi combinate în jurul formatului locației sau rețelei tale.",
    "Key components that can be combined around the venue format, menu and service load.": "Componente cheie care pot fi combinate în jurul formatului locației, meniului și încărcării de service.",
    "Cups and lids for the point": "Pahare și capace pentru punct",
    "Branded or standard cups, lids, stirrers and sugar for daily beverage sales.": "Pahare branduite sau standard, capace, palete și zahăr pentru vânzarea zilnică a băuturilor.",
    "Self-service coffee corner": "Colț de cafea self-service",
    "A ready solution for stores, gas stations and traffic locations: equipment, beverages, consumables and replenishment.": "O soluție gata pentru magazine, benzinării și locații cu trafic: echipamente, băuturi, consumabile și reaprovizionare.",
    "HoReCa espresso blend": "Blend espresso pentru HoReCa",
    "Coffee beans for restaurants, cafes and hotels, built for stable taste and intensive daily service.": "Cafea boabe pentru restaurante, cafenele și hoteluri, construită pentru gust stabil și lucru zilnic intensiv.",
    "Training": "Training",
    "Barista launch training": "Training de lansare pentru barista",
    "Team training for consistent beverage quality, proper equipment setup and repeatable service.": "Training pentru echipă pentru calitate constantă a băuturilor, setarea corectă a echipamentelor și service repetabil.",
    "Can be combined with catalog items, equipment, replenishment rhythm and service support.": "Poate fi combinat cu produse din catalog, echipamente, ritm de reaprovizionare și suport de service.",
    "About Binova Group": "Despre Binova Group",
    "The operator behind business coffee systems.": "Operatorul din spatele sistemelor de cafea pentru business.",
    "Binova Group is positioned as the next evolution of fifteen years of Binonic Lux experience: not just a supplier of coffee, but an operator of beverage systems for business. The visible product is coffee. The value is continuity: calibrated equipment, predictable replenishment, service response, replacement logic and a partner who owns the operating complexity.": "Binova Group este următoarea evoluție a celor cincisprezece ani de experiență Binonic Lux: nu doar furnizor de cafea, ci operator de sisteme beverage pentru business. Produsul vizibil este cafeaua. Valoarea este continuitatea: echipament calibrat, reaprovizionare predictibilă, reacție de service, logică de înlocuire și un partener care preia complexitatea operațională.",
    "Leadership through systems": "Leadership prin sisteme",
    "Binova moves the conversation from product price to business reliability: uptime, planned deliveries, service standards and clear commercial ownership.": "Binova mută discuția de la prețul produsului la fiabilitatea businessului: uptime, livrări planificate, standarde de service și responsabilitate comercială clară.",
    "Service as the differentiator": "Serviciul ca diferențiator",
    "Fast intervention, preventive maintenance and replacement equipment become visible sales arguments instead of invisible back-office work.": "Intervenția rapidă, mentenanța preventivă și echipamentul de înlocuire devin argumente vizibile de vânzare, nu muncă ascunsă de back-office.",
    "Segment-specific growth": "Creștere specifică pe segmente",
    "Office, Retail and HoReCa each get a different logic of offer, because a 10-person office, a cafe and a multi-location chain do not buy the same system.": "Office, Retail și HoReCa primesc logici diferite de ofertare, pentru că un birou de 10 persoane, o cafenea și o rețea multi-locație nu cumpără același sistem.",
    "Strategic promise": "Promisiune strategică",
    "Operational peace becomes business growth.": "Liniștea operațională devine creștere de business.",
    "For offices, coffee becomes part of culture and retention. For HoReCa, it becomes differentiation, menu quality and repeat visits. For retail, it becomes a profit point with standardized execution across locations.": "Pentru birouri, cafeaua devine parte din cultură și retenție. Pentru HoReCa, devine diferențiere, calitatea meniului și vizite repetate. Pentru retail, devine punct de profit cu execuție standardizată în locații.",
    "Why this digital demo matters": "De ce contează acest demo digital",
    "The website identifies the client segment, captures relevant operating context and gives the commercial team a structured request instead of a vague message.": "Site-ul identifică segmentul clientului, colectează contextul operațional relevant și oferă echipei comerciale o cerere structurată în locul unui mesaj vag.",
    "Telegram keeps the catalog alive: products, photos, packages and availability can be added by the team without a developer.": "Telegram menține catalogul actual: produse, poze, pachete și disponibilitate pot fi adăugate de echipă fără developer.",
    "Local demo privacy statement": "Declarație de confidențialitate pentru demo local",
    "This MVP stores demo request data locally on this machine in SQLite. It is not connected to a production CRM, payment provider or public hosting environment.": "Acest MVP stochează local datele cererilor demo în SQLite. Nu este conectat la CRM de producție, procesator de plăți sau hosting public.",
    "Data collected": "Date colectate",
    "Company name, contact name, email, phone, company size, selected services and request notes.": "Denumirea companiei, persoana de contact, email, telefon, mărimea companiei, serviciile selectate și notele cererii.",
    "Storage": "Stocare",
    "Data is stored in": "Datele sunt stocate în",
    "Usage": "Utilizare",
    "Data is used only to demonstrate request capture, admin review, calculator rules and package preparation.": "Datele sunt folosite doar pentru demonstrarea captării cererilor, review-ului în admin, regulilor de calculator și pregătirii pachetelor.",
    "Deletion": "Ștergere",
    "For the demo, records can be removed directly from SQLite or reset by replacing the local database.": "Pentru demo, înregistrările pot fi șterse direct din SQLite sau resetate prin înlocuirea bazei locale.",
    "Demo terms of use": "Termeni de utilizare demo",
    "This local site is a clickable commercial MVP for meetings and internal validation. Prices, packages and calculations are configurable demo values, not final contractual offers.": "Acest site local este un MVP comercial clicabil pentru întâlniri și validare internă. Prețurile, pachetele și calculele sunt valori demo configurabile, nu oferte contractuale finale.",
    "Commercial terms": "Termeni comerciali",
    "Commercial conditions are prepared by a Binova manager after reviewing the request.": "Condițiile comerciale sunt pregătite de un manager Binova după analiza cererii.",
    "Local operation": "Operare locală",
    "The demo runs locally on this machine through Telegram long polling and a localhost website.": "Demo-ul rulează local pe această mașină prin Telegram long polling și site localhost.",
    "Admin responsibility": "Responsabilitatea adminului",
    "Admins manage calculator rules, packages and lead review in the private admin area.": "Adminii gestionează regulile calculatorului, pachetele și review-ul cererilor în zona privată.",
    "Phase 2": "Phase 2",
    "Production deployment should add real authentication, hosting, backups, audit logs and CRM integration.": "Pentru producție sunt necesare autentificare reală, hosting, backup-uri, audit logs și integrare CRM.",
    "Control room": "Camera de control",
    "Dashboard": "Dashboard",
    "Leads": "Lead-uri",
    "Calculator": "Calculator",
    "Catalog": "Catalog",
    "Packages": "Pachete",
    "Proposals": "Propuneri",
    "Commercial cockpit": "Cockpit comercial",
    "Lead intake, pricing logic, managed catalog, service packages and commercial proposal links in one local control room.": "Cereri, logică de preț, catalog administrat, pachete de servicii și linkuri de propuneri comerciale într-un singur control room local.",
    "Total leads": "Lead-uri totale",
    "New leads": "Lead-uri noi",
    "Bot catalog offers": "Oferte din catalogul botului",
    "Lead intake": "Captare lead-uri",
    "Every public business flow writes a request here.": "Fiecare flow public de business scrie aici o cerere.",
    "View leads": "Vezi lead-uri",
    "Pricing": "Prețuri",
    "Change base prices by segment and company size.": "Modifică prețurile de bază după segment și mărimea companiei.",
    "Tune rules": "Setează reguli",
    "Bundles": "Bundle-uri",
    "Build offer bundles for sales conversations.": "Construiește pachete pentru discuții comerciale.",
    "Manage packages": "Gestionează pachete",
    "Product depth": "Catalog detaliat",
    "Manage coffee, tea, equipment, services and consumables.": "Gestionează cafea, ceai, echipamente, servicii și consumabile.",
    "Manage catalog": "Gestionează catalogul",
    "Proposal": "Propunere",
    "Commercial proposals": "Propuneri comerciale",
    "Turn a lead into a priced offer with selected packages and catalog items.": "Transformă un lead într-o ofertă cu prețuri, pachete și articole selectate.",
    "Build proposal": "Construiește propunere"
  }
};

Object.assign(translations.en = {}, {
  "Админка Binova": "Binova Admin",
  "Центр управления": "Control center",
  "Обзор": "Overview",
  "Заявки": "Requests",
  "Коммерческие предложения": "Commercial proposals",
  "Калькулятор": "Calculator",
  "Пакеты": "Packages",
  "Каталог": "Catalog",
  "Обновления из бота": "Bot updates",
  "Настройки сайта": "Site settings",
  "Центр коммерческого управления": "Commercial control center",
  "Заявки, калькулятор, каталог, пакеты, Bitrix24 и коммерческие предложения в одной рабочей панели.": "Requests, calculator, catalog, packages, Bitrix24 and commercial proposals in one workspace.",
  "Открыть новые заявки": "Open new requests",
  "Новые заявки": "New requests",
  "Запросы, которые ещё не обработаны.": "Requests that have not been processed yet.",
  "КП в работе": "Proposals in progress",
  "Предложения, которые готовятся менеджером.": "Offers being prepared by a manager.",
  "Готовые КП": "Ready proposals",
  "Предложения, готовые к отправке клиенту.": "Offers ready to be sent to the client.",
  "Обновления каталога": "Catalog updates",
  "Позиции из бота, ожидающие проверки.": "Items from the bot waiting for review.",
  "Входящие заявки": "Incoming requests",
  "Все запросы с сайта по Office, HoReCa и Retail попадают сюда со статусом, сегментом и выбранными сервисами.": "All website requests for Office, HoReCa and Retail land here with status, segment and selected services.",
  "Открыть заявки": "Open requests",
  "Расчёт": "Calculation",
  "Калькулятор предложений": "Offer calculator",
  "Настройте правила расчёта: базовые цены, пакеты, сервисные слои и коэффициенты по сегментам.": "Configure calculation rules: base prices, packages, service layers and segment coefficients.",
  "Настроить расчёт": "Configure calculation",
  "Пакеты услуг": "Service packages",
  "Собирайте стартовые решения для Office, HoReCa и Retail: что входит, для кого подходит и как считается.": "Build starter solutions for Office, HoReCa and Retail: what is included, who it fits and how it is calculated.",
  "Управлять пакетами": "Manage packages",
  "Каталог продуктов и сервисов": "Product and service catalog",
  "Управляйте кофе, оборудованием, расходниками, сервисами и товарами, которые используются в предложениях.": "Manage coffee, equipment, consumables, services and items used in offers.",
  "Открыть каталог": "Open catalog",
  "Собирайте КП из заявки, выбранных пакетов, товаров и сервисов. Готовьте версию для отправки клиенту.": "Build proposals from requests, selected packages, items and services. Prepare a client-ready version.",
  "Собрать КП": "Build proposal",
  "Bitrix24 интеграция": "Bitrix24 integration",
  "Передавайте заявки с сайта в Bitrix24 как лиды или сделки с сегментом, услугами, бюджетом и ответственным менеджером.": "Send website requests to Bitrix24 as leads or deals with segment, services, budget and responsible manager.",
  "Настроить интеграцию": "Configure integration",
  "Клиент": "Client",
  "Сегмент и параметры": "Segment and parameters",
  "Выбранные сервисы": "Selected services",
  "Статус": "Status",
  "Действия": "Actions",
  "Новая": "New",
  "В обработке": "In progress",
  "КП готовится": "Proposal in progress",
  "КП отправлено": "Proposal sent",
  "Выиграна": "Won",
  "Потеряна": "Lost",
  "Ответственный: не назначен": "Manager: not assigned",
  "Ответственный:": "Manager:",
  "не назначен": "not assigned",
  "локац.": "loc.",
  "Bitrix24: не отправлено": "Bitrix24: not sent",
  "Создать КП": "Create proposal",
  "Отправить в Bitrix24": "Send to Bitrix24",
  "Заявок пока нет.": "No requests yet.",
  "Каталог на проверке": "Catalog review queue",
  "Нет обновлений на проверке": "No updates pending review",
  "Когда бот отправит новые товары или пакеты, они появятся здесь.": "When the bot sends new products or packages, they will appear here.",
  "CRM интеграция": "CRM integration",
  "Что будет передаваться": "What will be sent",
  "Следующий шаг": "Next step",
  "Подключить webhook Bitrix24 и выбрать режим: создавать лиды или сделки. После этого кнопка в заявке сможет отправлять данные менеджеру в CRM.": "Connect a Bitrix24 webhook and choose the mode: create leads or deals. Then the request button can send data to the manager in CRM.",
  "Конструктор пакетов": "Package Builder",
  "Создавайте коммерческие пакеты для Office, HoReCa и Retail: продукты, оборудование, сервис и регулярную поддержку в одном предложении.": "Create commercial packages for Office, HoReCa and Retail: products, equipment, service and recurring support in one offer.",
  "+ Новый пакет": "+ New package",
  "Все пакеты": "All packages",
  "Сегмент": "Segment",
  "Черновик": "Draft",
  "Активен": "Active",
  "Название пакета": "Package name",
  "Коммерческое позиционирование": "Commercial positioning",
  "Например: предсказуемый месячный пакет для офисов без лишней операционной нагрузки.": "Example: a predictable monthly package for offices without extra operational workload.",
  "Кому подходит": "Recommended for",
  "Модель оплаты": "Billing model",
  "Цена в месяц, EUR": "Monthly price, EUR",
  "Краткое описание": "Short description",
  "Что входит в пакет": "Included in package",
  "Выберите позиции из каталога или добавьте вручную.": "Select items from the catalog or add manually.",
  "+ Добавить вручную": "+ Add custom item",
  "Позиция": "Item",
  "Категория": "Category",
  "Опциональная цена": "Optional price",
  "Добавить позицию": "Add item",
  "Создать пакет": "Create package",
  "Сохранить изменения": "Save changes",
  "Дублировать": "Duplicate",
  "Удалить": "Delete",
  "Выбран пакет для редактирования.": "Package selected for editing.",
  "Пакет сохранён.": "Package saved.",
  "Введите название позиции.": "Enter item name.",
  "Введите название пакета.": "Enter package name.",
  "Добавьте краткое описание.": "Add a short description.",
  "Добавьте минимум одну позицию.": "Add at least one item.",
  "Позиции ещё не выбраны.": "No items selected yet.",
  "Новый пакет": "New package",
  "Краткое описание появится здесь.": "Short description will appear here.",
  "Кому подходит:": "Recommended for:",
  "не указано": "not specified",
  "Добавьте позиции в пакет": "Add items to the package",
  "Обновлено:": "Updated:",
  "Нет пакетов для этого сегмента": "No packages for this segment yet.",
  "Создайте первый пакет для выбранного направления.": "Create the first package for the selected segment.",
  "Офис": "Office",
  "Ритейл": "Retail"
});

Object.assign(translations.ru, {
  "Skip to content": "Перейти к содержанию",
  "Open menu": "Открыть меню",
  "Close menu": "Закрыть меню",
  "Primary navigation": "Основная навигация",
  "Admin navigation": "Навигация админки",
  "Language": "Язык",
  "Coffee and beverage systems for business | Binova Group": "Кофейные и beverage-системы для бизнеса | Binova Group",
  "About us | Binova Group": "О Binova Group | Binova Group",
  "Terms | Binova Group": "Условия использования | Binova Group",
  "Operator of coffee, beverage and service systems": "Оператор систем для кофе, напитков и сервиса",
  "Binova Group is the evolution of Binonic Lux and 15 years of experience with business clients. We do not simply supply coffee or equipment. We build and maintain a system that helps offices, HoReCa and retail operate more reliably: product, equipment, replenishment, service, training and support in one process.": "Binova Group — это эволюция Binonic Lux и 15-летнего опыта работы с бизнес-клиентами. Мы не просто поставляем кофе или оборудование. Мы собираем и обслуживаем систему, которая помогает офисам, HoReCa и ритейлу работать стабильнее: продукт, техника, пополнение, сервис, обучение и поддержка в одном процессе.",
  "A system instead of fragmented supply": "Система вместо разрозненных поставок",
  "Binova combines product, equipment, replenishment and service into one managed process. The client gets one partner responsible for the result, not a list of disconnected suppliers.": "Binova объединяет продукт, оборудование, пополнение и сервис в один управляемый процесс. Клиент получает не набор поставщиков, а одного партнёра, который отвечает за результат.",
  "Service as part of the product": "Сервис как часть продукта",
  "Coffee works only when the equipment works. Maintenance, prevention, calibration and replacement are not extras, but part of the Binova system itself.": "Кофе работает только тогда, когда работает оборудование. Поэтому обслуживание, профилактика, настройка и замена техники — не дополнение, а часть самой системы Binova.",
  "Three segments, three growth logics": "Три сегмента — три логики роста",
  "Offices need team comfort and predictable budgets. HoReCa needs stable quality and no downtime. Retail needs one standard across points and additional sales. That is why each segment gets its own flow and offer.": "Офису важны комфорт команды и предсказуемый бюджет. HoReCa — стабильное качество и отсутствие простоев. Ритейлу — стандарт на всех точках и дополнительная продажа. Поэтому каждый сегмент получает свой flow и своё предложение.",
  "Operational calm that works for growth": "Операционное спокойствие, которое работает на рост",
  "For offices, coffee becomes part of culture and care for the team. For HoReCa, it becomes a product that affects repeat visits and average check. For retail, it becomes a point of additional sales and a way to turn traffic into revenue. Binova takes responsibility for the system behind the cup: equipment, supply, maintenance, training and support.": "Для офиса кофе становится частью культуры и заботы о команде. Для HoReCa — продуктом, который влияет на повторный визит и средний чек. Для ритейла — точкой дополнительной продажи и способом превратить трафик в выручку. Binova берёт на себя систему за чашкой: оборудование, поставки, обслуживание, обучение и поддержку.",
  "Why this digital demo exists": "Зачем это цифровое демо",
  "This demo shows the path from interest to a structured request: the client chooses a segment, marks the required services, and Binova receives the data needed to prepare an accurate commercial offer.": "Это демо показывает путь от интереса к структурированной заявке: клиент выбирает свой сегмент, отмечает нужные сервисы, а Binova получает данные для подготовки точного коммерческого предложения.",
  "Later the request can be passed to Bitrix24 with the segment, selected services, client size, number of locations, and needs for equipment, service and replenishment.": "Дальше заявка может передаваться в Bitrix24: с сегментом, выбранными услугами, размером клиента, количеством локаций, потребностью в оборудовании, сервисе и пополнении."
});

Object.assign(translations.ro, {
  "Skip to content": "Sari la conținut",
  "Open menu": "Deschide meniul",
  "Close menu": "Închide meniul",
  "Primary navigation": "Navigare principală",
  "Admin navigation": "Navigare administrare",
  "Language": "Limbă",
  "Coffee and beverage systems for business | Binova Group": "Sisteme de cafea și băuturi pentru companii | Binova Group",
  "About us | Binova Group": "Despre Binova Group | Binova Group",
  "Terms | Binova Group": "Condiții de utilizare | Binova Group",
  "Админка Binova": "Admin Binova",
  "Центр управления": "Centru de control",
  "Обзор": "Prezentare",
  "Заявки": "Cereri",
  "Коммерческие предложения": "Oferte comerciale",
  "Калькулятор": "Calculator",
  "Пакеты": "Pachete",
  "Каталог": "Catalog",
  "Обновления из бота": "Actualizări din bot",
  "Настройки сайта": "Setări site",
  "Центр коммерческого управления": "Centru de management comercial",
  "Заявки, калькулятор, каталог, пакеты, Bitrix24 и коммерческие предложения в одной рабочей панели.": "Cereri, calculator, catalog, pachete, Bitrix24 și oferte comerciale într-un singur spațiu de lucru.",
  "Открыть новые заявки": "Deschide cererile noi",
  "Новые заявки": "Cereri noi",
  "Запросы, которые ещё не обработаны.": "Cereri care încă nu au fost procesate.",
  "КП в работе": "Oferte în lucru",
  "Предложения, которые готовятся менеджером.": "Oferte pregătite de manager.",
  "Готовые КП": "Oferte gata",
  "Предложения, готовые к отправке клиенту.": "Oferte gata pentru trimitere către client.",
  "Обновления каталога": "Actualizări catalog",
  "Позиции из бота, ожидающие проверки.": "Poziții din bot care așteaptă verificarea.",
  "Входящие заявки": "Cereri primite",
  "Все запросы с сайта по Office, HoReCa и Retail попадают сюда со статусом, сегментом и выбранными сервисами.": "Toate cererile de pe site pentru Office, HoReCa și Retail ajung aici cu status, segment și servicii selectate.",
  "Открыть заявки": "Deschide cererile",
  "Расчёт": "Calcul",
  "Калькулятор предложений": "Calculator de oferte",
  "Настройте правила расчёта: базовые цены, пакеты, сервисные слои и коэффициенты по сегментам.": "Configurează regulile de calcul: prețuri de bază, pachete, straturi de service și coeficienți pe segmente.",
  "Настроить расчёт": "Configurează calculul",
  "Пакеты услуг": "Pachete de servicii",
  "Собирайте стартовые решения для Office, HoReCa и Retail: что входит, для кого подходит и как считается.": "Construiește soluții de start pentru Office, HoReCa și Retail: ce include, cui se potrivește și cum se calculează.",
  "Управлять пакетами": "Gestionează pachetele",
  "Каталог продуктов и сервисов": "Catalog de produse și servicii",
  "Управляйте кофе, оборудованием, расходниками, сервисами и товарами, которые используются в предложениях.": "Gestionează cafeaua, echipamentele, consumabilele, serviciile și produsele folosite în oferte.",
  "Открыть каталог": "Deschide catalogul",
  "Собирайте КП из заявки, выбранных пакетов, товаров и сервисов. Готовьте версию для отправки клиенту.": "Construiește oferta din cerere, pachete selectate, produse și servicii. Pregătește versiunea pentru client.",
  "Собрать КП": "Construiește oferta",
  "Bitrix24 интеграция": "Integrare Bitrix24",
  "Передавайте заявки с сайта в Bitrix24 как лиды или сделки с сегментом, услугами, бюджетом и ответственным менеджером.": "Trimite cererile din site în Bitrix24 ca lead-uri sau deal-uri cu segment, servicii, buget și manager responsabil.",
  "Настроить интеграцию": "Configurează integrarea",
  "Клиент": "Client",
  "Сегмент и параметры": "Segment și parametri",
  "Выбранные сервисы": "Servicii selectate",
  "Статус": "Status",
  "Действия": "Acțiuni",
  "Новая": "Nouă",
  "В обработке": "În procesare",
  "КП готовится": "Oferta se pregătește",
  "КП отправлено": "Oferta trimisă",
  "Выиграна": "Câștigată",
  "Потеряна": "Pierdută",
  "Ответственный: не назначен": "Responsabil: nealocat",
  "Ответственный:": "Responsabil:",
  "не назначен": "nealocat",
  "локац.": "loc.",
  "Bitrix24: не отправлено": "Bitrix24: netrimis",
  "Создать КП": "Creează oferta",
  "Отправить в Bitrix24": "Trimite în Bitrix24",
  "Заявок пока нет.": "Nu există cereri încă.",
  "Каталог на проверке": "Catalog la verificare",
  "Нет обновлений на проверке": "Nu există actualizări la verificare",
  "Когда бот отправит новые товары или пакеты, они появятся здесь.": "Când botul trimite produse sau pachete noi, vor apărea aici.",
  "CRM интеграция": "Integrare CRM",
  "Что будет передаваться": "Ce va fi transmis",
  "Следующий шаг": "Următorul pas",
  "Подключить webhook Bitrix24 и выбрать режим: создавать лиды или сделки. После этого кнопка в заявке сможет отправлять данные менеджеру в CRM.": "Conectează webhook-ul Bitrix24 și alege modul: creare lead-uri sau deal-uri. După aceea butonul din cerere va putea trimite datele managerului în CRM.",
  "Конструктор пакетов": "Constructor de pachete",
  "Создавайте коммерческие пакеты для Office, HoReCa и Retail: продукты, оборудование, сервис и регулярную поддержку в одном предложении.": "Creează pachete comerciale pentru Office, HoReCa și Retail: produse, echipamente, service și suport recurent într-o singură ofertă.",
  "+ Новый пакет": "+ Pachet nou",
  "Все пакеты": "Toate pachetele",
  "Сегмент": "Segment",
  "Черновик": "Ciornă",
  "Активен": "Activ",
  "Название пакета": "Denumirea pachetului",
  "Коммерческое позиционирование": "Poziționare comercială",
  "Например: предсказуемый месячный пакет для офисов без лишней операционной нагрузки.": "Exemplu: pachet lunar predictibil pentru birouri fără efort operațional suplimentar.",
  "Кому подходит": "Recomandat pentru",
  "Модель оплаты": "Model de plată",
  "Цена в месяц, EUR": "Preț lunar, EUR",
  "Краткое описание": "Descriere scurtă",
  "Что входит в пакет": "Ce include pachetul",
  "Выберите позиции из каталога или добавьте вручную.": "Selectează poziții din catalog sau adaugă manual.",
  "+ Добавить вручную": "+ Adaugă manual",
  "Позиция": "Poziție",
  "Категория": "Categorie",
  "Опциональная цена": "Preț opțional",
  "Добавить позицию": "Adaugă poziție",
  "Создать пакет": "Creează pachet",
  "Сохранить изменения": "Salvează modificările",
  "Дублировать": "Duplică",
  "Удалить": "Șterge",
  "Выбран пакет для редактирования.": "Pachet selectat pentru editare.",
  "Пакет сохранён.": "Pachet salvat.",
  "Введите название позиции.": "Introdu denumirea poziției.",
  "Введите название пакета.": "Introdu denumirea pachetului.",
  "Добавьте краткое описание.": "Adaugă o descriere scurtă.",
  "Добавьте минимум одну позицию.": "Adaugă cel puțin o poziție.",
  "Позиции ещё не выбраны.": "Nu sunt poziții selectate încă.",
  "Новый пакет": "Pachet nou",
  "Краткое описание появится здесь.": "Descrierea scurtă va apărea aici.",
  "Кому подходит:": "Recomandat pentru:",
  "не указано": "nespecificat",
  "Добавьте позиции в пакет": "Adaugă poziții în pachet",
  "Обновлено:": "Actualizat:",
  "Нет пакетов для этого сегмента": "Nu există pachete pentru acest segment.",
  "Создайте первый пакет для выбранного направления.": "Creează primul pachet pentru segmentul selectat.",
  "Офис": "Office",
  "Ритейл": "Retail",
  "Operator of coffee, beverage and service systems": "Operator de sisteme pentru cafea, băuturi și servicii",
  "Binova Group is the evolution of Binonic Lux and 15 years of experience with business clients. We do not simply supply coffee or equipment. We build and maintain a system that helps offices, HoReCa and retail operate more reliably: product, equipment, replenishment, service, training and support in one process.": "Binova Group este evoluția Binonic Lux și a celor 15 ani de experiență cu clienți business. Nu livrăm doar cafea sau echipamente. Construim și întreținem un sistem care ajută birourile, HoReCa și retailul să funcționeze mai stabil: produs, echipamente, reaprovizionare, service, training și suport într-un singur proces.",
  "A system instead of fragmented supply": "Un sistem în locul livrărilor fragmentate",
  "Binova combines product, equipment, replenishment and service into one managed process. The client gets one partner responsible for the result, not a list of disconnected suppliers.": "Binova unește produsul, echipamentele, reaprovizionarea și service-ul într-un proces gestionat. Clientul primește un partener responsabil de rezultat, nu o listă de furnizori separați.",
  "Service as part of the product": "Service-ul ca parte a produsului",
  "Coffee works only when the equipment works. Maintenance, prevention, calibration and replacement are not extras, but part of the Binova system itself.": "Cafeaua funcționează doar atunci când funcționează echipamentul. Mentenanța, prevenția, calibrarea și înlocuirea nu sunt opțiuni separate, ci parte din sistemul Binova.",
  "Three segments, three growth logics": "Trei segmente, trei logici de creștere",
  "Offices need team comfort and predictable budgets. HoReCa needs stable quality and no downtime. Retail needs one standard across points and additional sales. That is why each segment gets its own flow and offer.": "Birourile au nevoie de confort pentru echipă și buget predictibil. HoReCa are nevoie de calitate stabilă și fără întreruperi. Retailul are nevoie de standard unic în toate punctele și vânzări suplimentare. De aceea fiecare segment primește propriul flow și propria ofertă.",
  "Operational calm that works for growth": "Liniște operațională care lucrează pentru creștere",
  "For offices, coffee becomes part of culture and care for the team. For HoReCa, it becomes a product that affects repeat visits and average check. For retail, it becomes a point of additional sales and a way to turn traffic into revenue. Binova takes responsibility for the system behind the cup: equipment, supply, maintenance, training and support.": "Pentru birouri, cafeaua devine parte din cultură și grijă pentru echipă. Pentru HoReCa, devine un produs care influențează revenirea clienților și bonul mediu. Pentru retail, devine un punct de vânzare suplimentară și o modalitate de a transforma traficul în venit. Binova preia sistemul din spatele ceștii: echipamente, livrări, mentenanță, training și suport.",
  "Why this digital demo exists": "De ce există acest demo digital",
  "This demo shows the path from interest to a structured request: the client chooses a segment, marks the required services, and Binova receives the data needed to prepare an accurate commercial offer.": "Acest demo arată drumul de la interes la o cerere structurată: clientul alege segmentul, marchează serviciile necesare, iar Binova primește datele pentru pregătirea unei oferte comerciale exacte.",
  "Later the request can be passed to Bitrix24 with the segment, selected services, client size, number of locations, and needs for equipment, service and replenishment.": "Ulterior, cererea poate fi transmisă în Bitrix24 cu segmentul, serviciile selectate, dimensiunea clientului, numărul de locații și nevoile de echipamente, service și reaprovizionare."
});

Object.assign(translations.ru, {
  "Remove": "Убрать",
  "Use in offer": "Использовать в КП",
  "No packages for this segment yet.": "Нет пакетов для этого сегмента.",
  "Create first package": "Создать первый пакет",
  "Select a package to edit or create a new one.": "Выберите пакет для редактирования или создайте новый.",
  "Package Builder": "Конструктор пакетов",
  "Package selected for editing.": "Выбран пакет для редактирования.",
  "Package saved.": "Пакет сохранён.",
  "Add item": "Добавить позицию",
  "Add at least one item.": "Добавьте минимум одну позицию.",
  "Enter package name.": "Введите название пакета.",
  "Enter item name.": "Введите название позиции."
});

Object.assign(translations.ro, {
  "Remove": "Elimină",
  "Use in offer": "Folosește în ofertă",
  "No packages for this segment yet.": "Nu există pachete pentru acest segment.",
  "Create first package": "Creează primul pachet",
  "Select a package to edit or create a new one.": "Selectează un pachet pentru editare sau creează unul nou.",
  "Package Builder": "Constructor de pachete",
  "Package selected for editing.": "Pachet selectat pentru editare.",
  "Package saved.": "Pachet salvat.",
  "Add item": "Adaugă poziție",
  "Add at least one item.": "Adaugă cel puțin o poziție.",
  "Enter package name.": "Introdu denumirea pachetului.",
  "Enter item name.": "Introdu denumirea poziției."
});

Object.assign(translations.en, {
  "Каталог продуктов и сервисов": "Product and service catalog",
  "Управляйте кофе, оборудованием, расходниками и сервисами, которые используются на сайте, в пакетах, заявках и коммерческих предложениях.": "Manage coffee, equipment, consumables and services used on the website, in packages, requests and commercial proposals.",
  "+ Добавить позицию": "+ Add item",
  "Открыть модерацию": "Open moderation",
  "Активные позиции": "Active items",
  "На модерации из бота": "Bot items pending review",
  "Черновики": "Drafts",
  "Требуют обновления": "Need updates",
  "Обновления из Telegram-бота": "Telegram bot updates",
  "Сотрудники могут отправлять новые продукты и обновления через Telegram. Все отправленные карточки попадают сюда на проверку перед публикацией в каталог.": "Employees can submit new products and updates through Telegram. All submitted cards appear here for review before publication in the catalog.",
  "На модерации:": "Pending review:",
  "Все позиции": "All items",
  "На модерации": "Pending review",
  "Активные": "Active",
  "Архив": "Archive",
  "Из Telegram-бота": "From Telegram bot",
  "Источник": "Source",
  "Поиск": "Search",
  "Обновлено:": "Updated:",
  "Нет новых отправок из бота": "No new bot submissions",
  "Когда сотрудник отправит продукт через Telegram-бот, он появится здесь на проверку.": "When an employee submits a product through the Telegram bot, it will appear here for review.",
  "Каталог пока пуст": "Catalog is empty",
  "Добавьте позицию вручную или примите первую отправку из Telegram-бота.": "Add an item manually or approve the first Telegram bot submission.",
  "Выберите позицию для редактирования или создайте новую.": "Select an item to edit or create a new one.",
  "Редактор позиции": "Item editor",
  "Новая позиция": "New item",
  "Название": "Name",
  "Краткое описание": "Short description",
  "Полное описание": "Full description",
  "Цена": "Price",
  "Единица цены": "Price unit",
  "Доступность": "Availability",
  "Теги": "Tags",
  "Изображение": "Image",
  "Комментарий администратора": "Admin comment",
  "Сохранить": "Save",
  "Опубликовать": "Publish",
  "В архив": "Archive",
  "Одобрить": "Approve",
  "Вернуть на доработку": "Request changes",
  "Отклонить": "Reject",
  "Комментарий для сотрудника": "Comment for employee",
  "Причина отклонения": "Rejection reason"
});

Object.assign(translations.ro, {
  "Каталог продуктов и сервисов": "Catalog de produse și servicii",
  "Управляйте кофе, оборудованием, расходниками и сервисами, которые используются на сайте, в пакетах, заявках и коммерческих предложениях.": "Gestionează cafeaua, echipamentele, consumabilele și serviciile folosite pe site, în pachete, cereri și oferte comerciale.",
  "+ Добавить позицию": "+ Adaugă poziție",
  "Открыть модерацию": "Deschide moderarea",
  "Активные позиции": "Poziții active",
  "На модерации из бота": "Din bot la moderare",
  "Черновики": "Ciorne",
  "Требуют обновления": "Necesită actualizare",
  "Обновления из Telegram-бота": "Actualizări din botul Telegram",
  "Сотрудники могут отправлять новые продукты и обновления через Telegram. Все отправленные карточки попадают сюда на проверку перед публикацией в каталог.": "Angajații pot trimite produse noi și actualizări prin Telegram. Toate cardurile trimise apar aici pentru verificare înainte de publicarea în catalog.",
  "На модерации:": "La moderare:",
  "Все позиции": "Toate pozițiile",
  "На модерации": "La moderare",
  "Активные": "Active",
  "Архив": "Arhivă",
  "Из Telegram-бота": "Din botul Telegram",
  "Источник": "Sursă",
  "Поиск": "Căutare",
  "Обновлено:": "Actualizat:",
  "Нет новых отправок из бота": "Nu există trimiteri noi din bot",
  "Когда сотрудник отправит продукт через Telegram-бот, он появится здесь на проверку.": "Când un angajat trimite un produs prin botul Telegram, acesta va apărea aici pentru verificare.",
  "Каталог пока пуст": "Catalogul este gol",
  "Добавьте позицию вручную или примите первую отправку из Telegram-бота.": "Adaugă o poziție manual sau aprobă prima trimitere din botul Telegram.",
  "Выберите позицию для редактирования или создайте новую.": "Selectează o poziție pentru editare sau creează una nouă.",
  "Редактор позиции": "Editor poziție",
  "Новая позиция": "Poziție nouă",
  "Название": "Denumire",
  "Краткое описание": "Descriere scurtă",
  "Полное описание": "Descriere completă",
  "Цена": "Preț",
  "Единица цены": "Unitate preț",
  "Доступность": "Disponibilitate",
  "Теги": "Taguri",
  "Изображение": "Imagine",
  "Комментарий администратора": "Comentariu admin",
  "Сохранить": "Salvează",
  "Опубликовать": "Publică",
  "В архив": "În arhivă",
  "Одобрить": "Aprobă",
  "Вернуть на доработку": "Cere modificări",
  "Отклонить": "Respinge",
  "Комментарий для сотрудника": "Comentariu pentru angajat",
  "Причина отклонения": "Motivul respingerii"
});

Object.assign(translations.ru, {
  "Managed coffee and beverage systems for business": "Управляемые системы кофе и напитков для бизнеса",
  "How Binova works": "Как работает Binova",
  "One partner from first brief to daily operation": "Один партнёр от первого запроса до ежедневной работы",
  "Four clear stages turn a fragmented supply task into a managed beverage system.": "Четыре понятных этапа превращают разрозненные поставки в управляемую beverage-систему.",
  "Understand the operation": "Понимаем вашу операционку",
  "Segment, team size, locations, guest flow and current setup.": "Сегмент, размер команды, локации, поток гостей и текущая конфигурация.",
  "Design the system": "Проектируем систему",
  "Products, equipment and service level selected around real demand.": "Подбираем продукты, оборудование и уровень сервиса под реальную нагрузку.",
  "Launch with control": "Запускаем под контролем",
  "Installation, calibration and team onboarding in one coordinated start.": "Установка, настройка и обучение команды в рамках одного согласованного запуска.",
  "Manage and improve": "Поддерживаем и улучшаем",
  "Replenishment, maintenance and support keep the system working.": "Пополнение, обслуживание и поддержка обеспечивают стабильную работу системы.",
  "Build your solution": "Собрать своё решение",
  "One operating model, adapted to your business": "Одна операционная модель, адаптированная под ваш бизнес",
  "Every project starts with understanding the operation, continues with a tailored system design, and becomes a managed service with clear ownership.": "Каждый проект начинается с понимания операционки, продолжается индивидуальной конфигурацией и превращается в управляемый сервис с понятной ответственностью.",
  "Office, Retail and HoReCa clients receive different configurations, while Binova remains the single partner responsible for continuity.": "Клиенты Office, Retail и HoReCa получают разные конфигурации, а Binova остаётся единым партнёром, отвечающим за стабильную работу.",
  "Privacy and business request data": "Конфиденциальность и данные бизнес-заявок",
  "This website is intended for B2B enquiries. Information is processed to understand your request, prepare a relevant solution and contact you about the next commercial step.": "Сайт предназначен для B2B-запросов. Данные обрабатываются, чтобы понять вашу задачу, подготовить подходящее решение и связаться с вами по следующему коммерческому шагу.",
  "Information you submit": "Информация, которую вы отправляете",
  "Company and contact details, business segment, company scale, locations, selected services and additional request notes.": "Данные компании и контакта, сегмент бизнеса, размер, локации, выбранные услуги и дополнительные детали заявки.",
  "Technical visit data": "Технические данные посещения",
  "Basic technical data such as IP address, approximate country or city, visited page, language and device type may be recorded for security and usage analysis.": "Для безопасности и анализа использования могут сохраняться IP-адрес, примерная страна или город, посещённая страница, язык и тип устройства.",
  "How information is used": "Как используются данные",
  "Data is used to respond to enquiries, prepare commercial proposals, improve service flows and protect the website from automated abuse.": "Данные используются для ответа на запросы, подготовки коммерческих предложений, улучшения сервисных сценариев и защиты сайта от автоматических атак.",
  "Access and deletion": "Доступ и удаление",
  "Access is limited to people and providers involved in handling the request. You may request correction or deletion through the same Binova contact channel used for your enquiry.": "Доступ ограничен сотрудниками и поставщиками, участвующими в обработке заявки. Запросить исправление или удаление можно через тот же канал связи Binova, который использовался для обращения.",
  "Website terms of use": "Условия использования сайта",
  "The website helps business clients explore Binova solutions and submit a structured request. Website content is informational and does not by itself create a contractual commitment.": "Сайт помогает бизнес-клиентам изучить решения Binova и отправить структурированную заявку. Материалы сайта носят информационный характер и сами по себе не создают договорных обязательств.",
  "Commercial proposals": "Коммерческие предложения",
  "Final scope, pricing, delivery schedule, service levels and payment conditions are confirmed in a separate commercial proposal or agreement.": "Финальный состав, цены, график поставок, уровни сервиса и условия оплаты фиксируются в отдельном коммерческом предложении или договоре.",
  "Product and service information": "Информация о продуктах и сервисах",
  "Availability, specifications and service configurations may change as Binova adapts the solution to the client and location.": "Доступность, характеристики и конфигурация сервиса могут меняться при адаптации решения под клиента и локацию.",
  "Website content": "Материалы сайта",
  "Text, visual materials, configurations and brand elements may not be reused commercially without permission.": "Тексты, визуальные материалы, конфигурации и элементы бренда нельзя использовать в коммерческих целях без разрешения.",
  "Service availability": "Доступность сайта",
  "Binova may update the website and temporarily restrict access for maintenance, security or operational reasons.": "Binova может обновлять сайт и временно ограничивать доступ для обслуживания, безопасности или по операционным причинам."
});

Object.assign(translations.ro, {
  "Managed coffee and beverage systems for business": "Sisteme gestionate de cafea și băuturi pentru companii",
  "How Binova works": "Cum lucrează Binova",
  "One partner from first brief to daily operation": "Un singur partener, de la prima cerere la operarea zilnică",
  "Four clear stages turn a fragmented supply task into a managed beverage system.": "Patru etape clare transformă aprovizionarea fragmentată într-un sistem de băuturi gestionat.",
  "Understand the operation": "Înțelegem operațiunile",
  "Segment, team size, locations, guest flow and current setup.": "Segmentul, dimensiunea echipei, locațiile, fluxul de oaspeți și configurația actuală.",
  "Design the system": "Proiectăm sistemul",
  "Products, equipment and service level selected around real demand.": "Produse, echipamente și nivel de service selectate în jurul cererii reale.",
  "Launch with control": "Lansăm controlat",
  "Installation, calibration and team onboarding in one coordinated start.": "Instalare, calibrare și instruirea echipei într-o singură lansare coordonată.",
  "Manage and improve": "Gestionăm și îmbunătățim",
  "Replenishment, maintenance and support keep the system working.": "Reaprovizionarea, mentenanța și suportul mențin sistemul funcțional.",
  "Build your solution": "Construiește soluția",
  "One operating model, adapted to your business": "Un singur model operațional, adaptat afacerii tale",
  "Every project starts with understanding the operation, continues with a tailored system design, and becomes a managed service with clear ownership.": "Fiecare proiect începe prin înțelegerea operațiunilor, continuă cu proiectarea unei configurații personalizate și devine un serviciu gestionat cu responsabilitate clară.",
  "Office, Retail and HoReCa clients receive different configurations, while Binova remains the single partner responsible for continuity.": "Clienții Office, Retail și HoReCa primesc configurații diferite, iar Binova rămâne partenerul unic responsabil pentru continuitate.",
  "Privacy and business request data": "Confidențialitate și datele cererilor comerciale",
  "This website is intended for B2B enquiries. Information is processed to understand your request, prepare a relevant solution and contact you about the next commercial step.": "Site-ul este destinat cererilor B2B. Informațiile sunt prelucrate pentru a înțelege solicitarea, a pregăti o soluție relevantă și a vă contacta pentru următorul pas comercial.",
  "Information you submit": "Informațiile transmise",
  "Company and contact details, business segment, company scale, locations, selected services and additional request notes.": "Date despre companie și contact, segmentul de business, dimensiunea companiei, locațiile, serviciile selectate și detaliile suplimentare.",
  "Technical visit data": "Date tehnice despre vizită",
  "Basic technical data such as IP address, approximate country or city, visited page, language and device type may be recorded for security and usage analysis.": "Pentru securitate și analiza utilizării pot fi înregistrate adresa IP, țara sau orașul aproximativ, pagina vizitată, limba și tipul dispozitivului.",
  "How information is used": "Cum sunt utilizate informațiile",
  "Data is used to respond to enquiries, prepare commercial proposals, improve service flows and protect the website from automated abuse.": "Datele sunt utilizate pentru răspunsul la cereri, pregătirea ofertelor comerciale, îmbunătățirea fluxurilor și protejarea site-ului împotriva abuzului automatizat.",
  "Access and deletion": "Acces și ștergere",
  "Access is limited to people and providers involved in handling the request. You may request correction or deletion through the same Binova contact channel used for your enquiry.": "Accesul este limitat la persoanele și furnizorii implicați în procesarea cererii. Corectarea sau ștergerea poate fi solicitată prin același canal Binova folosit pentru cerere.",
  "Website terms of use": "Condiții de utilizare a site-ului",
  "The website helps business clients explore Binova solutions and submit a structured request. Website content is informational and does not by itself create a contractual commitment.": "Site-ul ajută clienții business să exploreze soluțiile Binova și să trimită o cerere structurată. Conținutul este informativ și nu creează de unul singur obligații contractuale.",
  "Commercial proposals": "Oferte comerciale",
  "Final scope, pricing, delivery schedule, service levels and payment conditions are confirmed in a separate commercial proposal or agreement.": "Structura finală, prețurile, calendarul livrărilor, nivelurile de service și condițiile de plată sunt confirmate într-o ofertă comercială sau într-un acord separat.",
  "Product and service information": "Informații despre produse și servicii",
  "Availability, specifications and service configurations may change as Binova adapts the solution to the client and location.": "Disponibilitatea, specificațiile și configurațiile serviciilor se pot modifica pe măsură ce Binova adaptează soluția clientului și locației.",
  "Website content": "Conținutul site-ului",
  "Text, visual materials, configurations and brand elements may not be reused commercially without permission.": "Textele, materialele vizuale, configurațiile și elementele de brand nu pot fi reutilizate comercial fără permisiune.",
  "Service availability": "Disponibilitatea site-ului",
  "Binova may update the website and temporarily restrict access for maintenance, security or operational reasons.": "Binova poate actualiza site-ul și poate restricționa temporar accesul pentru mentenanță, securitate sau motive operaționale."
});

type PageOptions = {
  admin?: boolean;
  plain?: boolean;
  description?: string;
  canonicalPath?: string;
  noIndex?: boolean;
  jsonLd?: Record<string, unknown> | Array<Record<string, unknown>>;
};

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${siteBaseUrl}/#organization`,
  name: "Binova Group",
  url: siteBaseUrl,
  description: "Managed coffee and beverage systems for offices, retail and HoReCa.",
  areaServed: "Moldova",
  knowsAbout: ["Business coffee systems", "Beverage equipment", "Equipment maintenance", "B2B replenishment"]
};

const page = (title: string, body: string, options: PageOptions = {}) => {
  const description = options.description || "Binova Group builds managed coffee and beverage systems for offices, retail and HoReCa.";
  const canonicalUrl = options.canonicalPath ? new URL(options.canonicalPath, `${siteBaseUrl}/`).toString() : "";
  const noIndex = options.noIndex || options.admin || options.plain;
  const extraSchemas = options.jsonLd ? (Array.isArray(options.jsonLd) ? options.jsonLd : [options.jsonLd]) : [];
  const schemas = noIndex ? extraSchemas : [organizationSchema, ...extraSchemas];
  const alternateLinks = canonicalUrl
    ? ["en", "ru", "ro"].map((lang) => `<link rel="alternate" hreflang="${lang}" href="${escapeHtml(`${canonicalUrl}?lang=${lang}`)}">`).join("\n  ")
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | Binova Group</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="${noIndex ? "noindex, nofollow" : "index, follow"}">
  ${canonicalUrl ? `<link rel="canonical" href="${escapeHtml(canonicalUrl)}">` : ""}
  ${alternateLinks}
  <link rel="icon" type="image/webp" href="/assets/coffee-bean.webp">
  <meta property="og:site_name" content="Binova Group">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(title)} | Binova Group">
  <meta property="og:description" content="${escapeHtml(description)}">
  ${canonicalUrl ? `<meta property="og:url" content="${escapeHtml(canonicalUrl)}">` : ""}
  <meta property="og:image" content="${escapeHtml(`${siteBaseUrl}/assets/coffee-bean.png`)}">
  <meta name="twitter:card" content="summary">
  ${schemas.map((schema) => `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, "\\u003c")}</script>`).join("\n  ")}
  <style>
    :root {
      --ink: #151713;
      --muted: #676b62;
      --paper: #f4f1ea;
      --panel: #fffdfa;
      --line: #ded7ca;
      --dark: #18201d;
      --green: #0f7a53;
      --blue: #9f6b3f;
      --red: #b42318;
      --gold: #b7791f;
      --copper: #9f5d32;
      --cream-text: #f3eadb;
      --cream-soft: #eadfce;
      --cream-muted: rgba(232, 222, 205, .78);
      --cream-subtle: rgba(232, 222, 205, .62);
      --shadow: 0 24px 70px rgba(38, 31, 22, .14);
      --soft-shadow: 0 10px 32px rgba(38, 31, 22, .08);
      --bean-photo: url("/assets/coffee-bean.webp");
    }
    @keyframes beanDrift {
      0% { transform: translate3d(0, 0, 0) rotate(0deg); opacity: .18; }
      50% { transform: translate3d(14px, -18px, 0) rotate(18deg); opacity: .34; }
      100% { transform: translate3d(0, 0, 0) rotate(0deg); opacity: .18; }
    }
    @keyframes beanPulse {
      0%, 100% { transform: rotate(-24deg) scale(1); }
      50% { transform: rotate(-24deg) scale(1.08); }
    }
    @keyframes beanWiggle {
      0%, 100% { transform: rotate(-24deg) translateY(0) scale(1); }
      35% { transform: rotate(12deg) translateY(-6px) scale(1.12); }
      70% { transform: rotate(-36deg) translateY(-2px) scale(1.06); }
    }
    @keyframes stackIn {
      from { transform: translateY(10px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    * { box-sizing: border-box; }
    html {
      overflow-x: hidden;
      max-width: 100%;
    }
    body {
      margin: 0;
      font-family: "Aptos", "Manrope", "Inter", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      overflow-x: hidden;
      background:
        linear-gradient(180deg, rgba(250,245,237,.58), rgba(250,245,237,0) 360px),
        var(--paper);
    }
    a { color: inherit; }
    .skip-link {
      position: fixed;
      top: 8px;
      left: 12px;
      z-index: 100;
      padding: 10px 14px;
      border-radius: 6px;
      background: var(--dark);
      color: var(--cream-text);
      font-weight: 800;
      text-decoration: none;
      transform: translateY(-160%);
      transition: transform .16s ease;
    }
    .skip-link:focus { transform: translateY(0); }
    :where(a, button, [role="button"], input, select, textarea):focus-visible {
      outline: 3px solid #b8733f;
      outline-offset: 3px;
    }
    .nav {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 20;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      padding: 14px max(28px, calc((100vw - 1320px) / 2));
      background: rgba(248, 243, 235, .9);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid rgba(221, 212, 199, .82);
    }
    body:not(.plain-page) { padding-top: 66px; }
    .logo {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      font-weight: 900;
      font-size: 20px;
      text-decoration: none;
      position: relative;
    }
    .logo::before {
      content: "";
      width: 28px;
      height: 36px;
      background-image: var(--bean-photo);
      background-repeat: no-repeat;
      background-position: center;
      background-size: contain;
      filter: drop-shadow(0 7px 10px rgba(72, 39, 20, .24));
      transform: rotate(-24deg);
      animation: beanPulse 4s ease-in-out infinite;
    }
    .logo::after {
      display: none;
    }
    .navlinks { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
    .navlinks a { text-decoration: none; color: #38332c; font-weight: 700; font-size: 14px; }
    .navlinks .admin-link { color: var(--copper); }
    .nav-toggle {
      display: none;
      width: 42px;
      height: 42px;
      align-items: center;
      justify-content: center;
      padding: 0;
      border-color: var(--line);
      background: rgba(255,255,255,.72);
      color: var(--dark);
      box-shadow: none;
      font-size: 22px;
      line-height: 1;
    }
    .lang-switch {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: rgba(255,255,255,.72);
    }
    .lang-switch a {
      min-width: 34px;
      padding: 6px 9px;
      border-radius: 999px;
      text-align: center;
      font-size: 12px;
      line-height: 1;
    }
    .lang-switch a.active {
      background: var(--dark);
      color: var(--cream-text);
    }
    .hero {
      min-height: min(760px, calc(100vh - 58px));
      display: grid;
      align-items: center;
      color: var(--cream-text);
      position: relative;
      overflow: hidden;
      background:
        linear-gradient(135deg, #101713 0%, #18221e 48%, #2a2a22 100%);
      padding: 54px 28px 52px;
    }
    .hero::before {
      content: "";
      position: absolute;
      inset: 0;
      background-image:
        linear-gradient(rgba(243,234,219,.045) 1px, transparent 1px),
        linear-gradient(90deg, rgba(243,234,219,.045) 1px, transparent 1px);
      background-size: 44px 44px;
      mask-image: linear-gradient(90deg, rgba(0,0,0,.9), rgba(0,0,0,.28));
      pointer-events: none;
    }
    .hero::after {
      content: "";
      position: absolute;
      inset: auto 0 0 0;
      height: 38%;
      background: linear-gradient(0deg, rgba(16,23,19,.86), rgba(16,23,19,0));
      pointer-events: none;
    }
    .hero-inner, main, .footer-inner { max-width: 1320px; margin: 0 auto; width: 100%; }
    .hero-inner { position: relative; z-index: 1; }
    .eyebrow {
      margin: 0 0 10px;
      color: var(--copper);
      text-transform: uppercase;
      font-size: 12px;
      font-weight: 850;
      letter-spacing: .08em;
    }
    .hero .eyebrow { color: #d7a76b; }
    h1 {
      max-width: 920px;
      margin: 0;
      font-size: clamp(40px, 5.65vw, 78px);
      line-height: .94;
      letter-spacing: 0;
      overflow-wrap: anywhere;
      color: var(--cream-text);
    }
    h1[style] { font-size: clamp(38px, 4.7vw, 54px) !important; line-height: 1 !important; }
    .hero p {
      max-width: 730px;
      margin: 22px 0 0;
      font-size: 20px;
      line-height: 1.55;
      color: var(--cream-muted);
    }
    .hero-actions, .actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 28px; }
    .btn, button {
      border: 1px solid var(--dark);
      background: var(--dark);
      color: var(--cream-text);
      border-radius: 999px;
      padding: 12px 16px;
      font-weight: 800;
      text-decoration: none;
      cursor: pointer;
      font-size: 14px;
      box-shadow: 0 10px 26px rgba(24, 32, 29, .18);
      transition: transform .16s ease, box-shadow .16s ease, background .16s ease;
    }
    .btn:hover, button:hover { transform: translateY(-1px); box-shadow: 0 16px 34px rgba(24, 32, 29, .24); }
    .btn.secondary, button.secondary { background: transparent; color: var(--dark); border-color: var(--line); }
    .hero .btn.secondary { color: var(--cream-text); border-color: rgba(243,234,219,.44); }
    .hero-panel {
      display: grid;
      grid-template-columns: minmax(0, 1.08fr) minmax(360px, .92fr);
      gap: 58px;
      align-items: center;
    }
    .hero-panel > div:only-child { grid-column: 1 / -1; }
    .hero-visual {
      justify-self: end;
      width: min(520px, 100%);
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      align-items: stretch;
    }
    .visual-tile, .proof-card {
      border: 1px solid rgba(243,234,219,.18);
      background: rgba(232,222,205,.11);
      backdrop-filter: blur(14px);
      border-radius: 8px;
      box-shadow: 0 18px 60px rgba(0,0,0,.2);
      overflow: hidden;
    }
    .visual-tile img {
      width: 100%;
      height: 100%;
      min-height: 180px;
      object-fit: cover;
      display: block;
      filter: saturate(.92) contrast(1.06);
    }
    .visual-tile.large { grid-row: span 2; }
    .visual-tile.large img { min-height: 330px; }
    .proof-card {
      padding: 18px;
      min-height: 138px;
      display: grid;
      align-content: end;
    }
    .proof-card span { display: block; color: var(--cream-subtle); font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; }
    .proof-card b { display: block; margin-top: 8px; font-size: 24px; color: var(--cream-text); }
    .bean-field {
      position: absolute;
      inset: 0;
      overflow: hidden;
      pointer-events: none;
      z-index: 0;
    }
    .bean {
      position: absolute;
      width: 54px;
      height: 70px;
      background-image: var(--bean-photo);
      background-repeat: no-repeat;
      background-position: center;
      background-size: contain;
      filter: drop-shadow(0 18px 20px rgba(0,0,0,.28));
      animation: beanDrift 7s ease-in-out infinite;
    }
    .bean::after {
      display: none;
    }
    .bean.b1 { left: 8%; top: 18%; animation-delay: -.8s; }
    .bean.b2 { right: 13%; top: 15%; transform: rotate(22deg); animation-delay: -2.4s; }
    .bean.b3 { left: 48%; bottom: 16%; transform: rotate(-38deg); animation-delay: -4.1s; }
    .bean.b4 { right: 6%; bottom: 20%; transform: rotate(42deg); animation-delay: -1.6s; }
    .bean.b5 { left: 18%; bottom: 24%; width: 38px; height: 50px; transform: rotate(31deg); animation-delay: -5.2s; opacity: .82; }
    .bean.b6 { left: 31%; top: 12%; width: 42px; height: 56px; transform: rotate(-17deg); animation-delay: -3.6s; opacity: .76; }
    .bean.b7 { right: 28%; top: 24%; width: 44px; height: 58px; transform: rotate(58deg); animation-delay: -6.4s; opacity: .88; }
    .bean.b8 { right: 21%; bottom: 12%; width: 36px; height: 48px; transform: rotate(-52deg); animation-delay: -1.1s; opacity: .72; }
    .bean.b9 { left: 4%; bottom: 42%; width: 34px; height: 46px; transform: rotate(72deg); animation-delay: -4.8s; opacity: .66; }
    .bean.b10 { right: 42%; bottom: 30%; width: 40px; height: 54px; transform: rotate(-8deg); animation-delay: -2.9s; opacity: .78; }
    .bean.b11 { left: 62%; top: 10%; width: 32px; height: 44px; transform: rotate(18deg); animation-delay: -7.1s; opacity: .6; }
    .bean.b12 { right: 3%; top: 44%; width: 46px; height: 60px; transform: rotate(-32deg); animation-delay: -3.1s; opacity: .84; }
    .home-choice-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
      margin-top: 34px;
      max-width: 980px;
    }
    .segment-choice {
      position: relative;
      min-height: 176px;
      display: grid;
      grid-template-rows: auto 1fr auto;
      align-content: start;
      gap: 10px;
      padding: 22px;
      border: 1px solid rgba(243,234,219,.16);
      border-radius: 12px;
      color: var(--cream-text);
      text-decoration: none;
      background: rgba(232,222,205,.1);
      backdrop-filter: blur(14px);
      overflow: hidden;
      transition: transform .22s ease, background .22s ease, border-color .22s ease, box-shadow .22s ease;
    }
    .segment-choice::before {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(135deg, rgba(243,234,219,.16), rgba(243,234,219,0));
      opacity: .7;
      pointer-events: none;
    }
    .segment-choice::after {
      content: "";
      position: absolute;
      right: 16px;
      top: 14px;
      width: 48px;
      height: 62px;
      background-image: var(--bean-photo);
      background-repeat: no-repeat;
      background-position: center;
      background-size: contain;
      filter: drop-shadow(0 12px 18px rgba(0,0,0,.28));
      transform: rotate(-26deg);
      transition: transform .22s ease;
      opacity: .94;
    }
    .segment-choice:hover {
      transform: translateY(-8px);
      background: rgba(232,222,205,.16);
      border-color: rgba(243,234,219,.34);
      box-shadow: 0 28px 70px rgba(0,0,0,.28);
    }
    .segment-choice:hover::after { transform: rotate(18deg) scale(1.12); }
    .segment-choice strong { position: relative; max-width: 82%; font-size: 28px; line-height: 1.08; }
    .segment-choice span { position: relative; color: var(--cream-muted); line-height: 1.4; }
    .segment-choice em {
      position: relative;
      width: fit-content;
      align-self: end;
      margin-top: 6px;
      padding: 8px 11px;
      border: 1px solid rgba(243,234,219,.24);
      border-radius: 999px;
      color: var(--cream-text);
      font-style: normal;
      font-size: 12px;
      font-weight: 900;
      background: rgba(232,222,205,.08);
    }
    main { padding: 26px 28px 82px; }
    .band { padding: 72px 0; border-top: 1px solid var(--line); }
    .section-head {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 24px;
      margin-bottom: 28px;
    }
    .section-head h2, h2 { margin: 0; font-size: 38px; letter-spacing: 0; line-height: 1.06; }
    .section-head p, .copy { color: var(--muted); line-height: 1.55; max-width: 640px; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
    .grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
      box-shadow: var(--soft-shadow);
      transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
    }
    .card:hover { transform: translateY(-3px); box-shadow: var(--shadow); border-color: #cdbda9; }
    .card-body { padding: 18px; }
    .card h2, .card h3 { margin: 0 0 10px; font-size: 24px; line-height: 1.12; }
    .card p { color: var(--muted); line-height: 1.5; }
    .card img, .tile-image { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block; background: #e3dbce; }
    .metric-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 24px; position: relative; }
    .metric { background: rgba(255,253,249,.92); border: 1px solid var(--line); border-radius: 8px; padding: 18px; box-shadow: var(--soft-shadow); }
    .metric span { display: block; color: var(--muted); font-size: 13px; margin-bottom: 8px; }
    .metric b { font-size: 32px; }
    .metric small { display: block; color: var(--muted); font-size: 12px; line-height: 1.45; margin-top: 8px; }
    form { display: grid; gap: 14px; }
    label { display: grid; gap: 7px; font-weight: 750; color: #2a2a2a; }
    input, select, textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      padding: 12px 13px;
      font: inherit;
      color: var(--ink);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.8);
    }
    input:focus, select:focus, textarea:focus {
      outline: 2px solid rgba(159, 93, 50, .18);
      border-color: var(--copper);
    }
    input[type="hidden"] { display: none; }
    textarea { min-height: 112px; resize: vertical; }
    .check-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .check {
      display: flex;
      align-items: center;
      gap: 8px;
      border: 1px solid var(--line);
      background: #fff;
      border-radius: 6px;
      padding: 10px;
      font-weight: 700;
    }
    .check input { width: auto; }
    .service-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .service-card { display: block; cursor: pointer; }
    .service-card > input[type="checkbox"] {
      position: absolute;
      left: 0;
      top: 0;
      width: 1px !important;
      height: 1px !important;
      margin: 0;
      opacity: 0;
      pointer-events: none;
    }
    .service-shell {
      min-height: 118px;
      display: grid;
      align-content: space-between;
      gap: 12px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #fff;
      padding: 14px;
      transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease, background .18s ease;
    }
    .service-shell::before {
      content: "";
      width: 30px;
      height: 38px;
      background-image: var(--bean-photo);
      background-repeat: no-repeat;
      background-position: center;
      background-size: contain;
      transform: rotate(-24deg);
      filter: drop-shadow(0 8px 12px rgba(0,0,0,.24));
      transition: transform .22s ease, filter .22s ease;
    }
    .service-card:hover .service-shell::before {
      animation: beanWiggle .72s ease both;
      filter: drop-shadow(0 14px 20px rgba(0,0,0,.3));
    }
    .service-card:hover .service-shell {
      transform: translateY(-4px);
      box-shadow: var(--soft-shadow);
      border-color: #c7b8a4;
    }
    .service-card input:checked + .service-shell {
      background: #18201d;
      color: #fff;
      border-color: #18201d;
      box-shadow: var(--shadow);
    }
    .service-card input:checked + .service-shell::before {
      transform: rotate(18deg) scale(1.12);
      filter: drop-shadow(0 14px 20px rgba(0,0,0,.36));
    }
    .service-card input:checked + .service-shell span { color: rgba(255,255,255,.72); }
    .service-shell em {
      align-self: end;
      width: fit-content;
      color: var(--muted);
      font-style: normal;
      font-size: 13px;
      font-weight: 900;
    }
    .service-card input:checked + .service-shell em { color: rgba(255,255,255,.9); }
    .service-card > input:focus-visible + .service-shell {
      outline: 3px solid #b8733f;
      outline-offset: 3px;
    }
    .service-builder, .service-selection { display: contents; }
    .mobile-cup-preview { display: none; }
    .request-form-wrap {
      display: grid;
      grid-template-columns: minmax(0, .92fr) minmax(360px, .78fr);
      gap: 18px;
      align-items: stretch;
    }
    .cup-lab {
      display: grid;
      grid-template-columns: minmax(260px, .7fr) minmax(360px, 1fr);
      gap: 28px;
      align-items: stretch;
    }
    .cup-lab-stage {
      min-height: 620px;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,.1);
      background:
        radial-gradient(circle at 72% 12%, rgba(205,155,93,.2), transparent 25%),
        #111713;
      display: grid;
      place-items: center;
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .cup-preview-card {
      min-height: 100%;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,.1);
      background:
        radial-gradient(circle at 72% 12%, rgba(205,155,93,.2), transparent 25%),
        #111713;
      display: grid;
      place-items: center;
      box-shadow: var(--shadow);
      overflow: hidden;
      position: sticky;
      top: 86px;
    }
    .cup-preview {
      position: relative;
      width: min(520px, 94%);
      aspect-ratio: 1 / 1.26;
      border-radius: 14px;
      overflow: hidden;
    }
    .cup-frame {
      position: absolute;
      inset: 0;
      background-image: url("/assets/latte-stages-v2-aligned.webp");
      background-repeat: no-repeat;
      background-size: 600% 100%;
      opacity: 0;
      transition: opacity .48s ease;
    }
    .cup-frame.stage-1 { background-position: 0% 50%; }
    .cup-frame.stage-2 { background-position: 20% 50%; }
    .cup-frame.stage-3 { background-position: 40% 50%; }
    .cup-frame.stage-4 { background-position: 60% 50%; }
    .cup-frame.stage-5 { background-position: 80% 50%; }
    .cup-frame.stage-6 { background-position: 100% 50%; }
    .cup-preview[data-stage="1"] .stage-1,
    .cup-preview[data-stage="2"] .stage-2,
    .cup-preview[data-stage="3"] .stage-3,
    .cup-preview[data-stage="4"] .stage-4,
    .cup-preview[data-stage="5"] .stage-5,
    .cup-preview[data-stage="6"] .stage-6 {
      opacity: 1;
    }
    .cup-lab-controls {
      display: grid;
      gap: 10px;
      align-content: start;
    }
    .cup-stage-button {
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--ink);
      border-radius: 10px;
      padding: 14px;
      text-align: left;
      box-shadow: none;
    }
    .cup-stage-button.active,
    .cup-stage-button:hover {
      background: #18201d;
      color: #fff;
      border-color: #18201d;
    }
    .table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; box-shadow: var(--soft-shadow); }
    .table th, .table td { text-align: left; padding: 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
    .table th { background: #ebe3d7; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
    .badge { display: inline-flex; border-radius: 999px; padding: 5px 8px; font-size: 12px; font-weight: 850; background: #e9f3ee; color: var(--green); }
    .badge.new { background: #f5eadc; color: var(--copper); }
    .badge.hot { background: #fff4de; color: var(--gold); }
    .admin-shell { display: grid; grid-template-columns: 230px 1fr; min-height: calc(100vh - 58px); }
    .admin-side { background: linear-gradient(180deg, #18201d, #27352e); color: #fff; padding: 22px; }
    .admin-side a { display: block; color: rgba(255,255,255,.82); text-decoration: none; padding: 11px 10px; border-radius: 6px; font-weight: 750; }
    .admin-side a:hover { background: rgba(255,255,255,.1); color: #fff; }
    .admin-main { padding: 32px; background: #f7f4ee; }
    .trust-strip {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 1px;
      background: var(--line);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
      margin-top: 18px;
    }
    .trust-item { background: var(--panel); padding: 18px; }
    .trust-item b { display: block; font-size: 20px; margin-bottom: 4px; }
    .trust-item span { color: var(--muted); font-size: 13px; line-height: 1.4; }
    .process-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      counter-reset: process;
    }
    .process-step {
      min-height: 230px;
      display: grid;
      align-content: space-between;
      gap: 22px;
      padding: 22px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: var(--soft-shadow);
      counter-increment: process;
    }
    .process-step::before {
      content: "0" counter(process);
      width: 42px;
      height: 42px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      background: var(--dark);
      color: var(--cream-text);
      font-size: 12px;
      font-weight: 900;
    }
    .process-step h3 { margin: 0 0 10px; font-size: 23px; line-height: 1.1; }
    .process-step p { margin: 0; color: var(--muted); line-height: 1.5; }
    .summary-shell { max-width: 980px; margin: 0 auto; }
    .summary-hero {
      padding: 42px;
      border-radius: 12px;
      background: linear-gradient(145deg, #101713, #253029);
      color: var(--cream-text);
      box-shadow: var(--shadow);
    }
    .summary-hero h1 { max-width: 760px; font-size: clamp(40px, 6vw, 68px); }
    .summary-hero p { max-width: 700px; color: var(--cream-muted); font-size: 18px; line-height: 1.55; }
    .summary-meta { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 24px; }
    .summary-meta span { padding: 8px 11px; border: 1px solid rgba(243,234,219,.2); border-radius: 999px; color: var(--cream-soft); font-weight: 800; font-size: 12px; }
    .summary-grid { display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); gap: 16px; }
    .summary-list { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
    .summary-list li { padding: 13px 14px; border: 1px solid var(--line); border-radius: 8px; background: #fff; font-weight: 800; }
    .summary-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .summary-fact { padding: 14px; border-top: 1px solid var(--line); }
    .summary-fact span { display: block; color: var(--muted); font-size: 12px; margin-bottom: 5px; }
    .summary-fact b { display: block; overflow-wrap: anywhere; }
    .summary-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 24px; }
    .print-note { color: var(--muted); font-size: 13px; line-height: 1.45; }
    .feature-band {
      background: var(--dark);
      color: #fff;
      border-radius: 8px;
      padding: 28px;
      box-shadow: var(--shadow);
    }
    .feature-band p { color: rgba(255,255,255,.74); }
    .solution-card img { aspect-ratio: 16 / 10; }
    .solution-card .card-body { min-height: 270px; display: flex; flex-direction: column; }
    .solution-card .btn { margin-top: auto; width: fit-content; }
    .package-preset {
      cursor: pointer;
      transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease;
    }
    .package-preset:hover,
    .package-preset:focus-visible {
      transform: translateY(-4px);
      border-color: #c7b8a4;
      box-shadow: var(--soft-shadow);
      outline: none;
    }
    .btn.ghost, button.ghost { background: transparent; color: var(--green); border: 1px solid var(--line); box-shadow: none; }
    .btn.danger, button.danger { background: #7a2b22; color: #fff; }
    .package-toolbar { display: flex; gap: 10px; flex-wrap: wrap; margin: 18px 0 24px; }
    .segment-tab { border: 1px solid var(--line); background: rgba(255,253,249,.9); color: var(--ink); box-shadow: none; padding: 10px 14px; }
    .segment-tab.active { background: var(--green); color: #fff; border-color: var(--green); }
    .package-builder { display: grid; grid-template-columns: minmax(0, 1.04fr) minmax(360px, .96fr); gap: 18px; align-items: start; }
    .builder-panel { display: grid; gap: 14px; }
    .builder-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .item-picker { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; max-height: 250px; overflow: auto; padding-right: 4px; }
    .catalog-pick { border: 1px solid var(--line); border-radius: 8px; background: #fffdfa; padding: 10px; text-align: left; color: var(--ink); box-shadow: none; justify-content: flex-start; align-items: flex-start; display: grid; gap: 4px; }
    .catalog-pick:hover { border-color: #cdbda9; transform: translateY(-1px); }
    .catalog-pick small { color: var(--muted); font-weight: 800; }
    .selected-items { display: grid; gap: 8px; }
    .item-row { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 8px; border: 1px solid var(--line); border-radius: 8px; background: #fff; padding: 9px 10px; }
    .item-row button { padding: 7px 9px; font-size: 12px; box-shadow: none; }
    .package-list { display: grid; gap: 12px; }
    .package-card { text-align: left; display: block; width: 100%; border: 1px solid var(--line); background: var(--panel); color: var(--ink); border-radius: 8px; padding: 16px; box-shadow: var(--soft-shadow); cursor: pointer; }
    .package-card.active { border-color: var(--green); box-shadow: 0 0 0 2px rgba(16,37,29,.18), var(--shadow); }
    .package-card h3 { margin: 8px 0; font-size: 22px; }
    .package-card p { color: var(--muted); line-height: 1.45; margin: 0 0 10px; }
    .package-meta { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; }
    .package-preview { position: sticky; top: 18px; background: linear-gradient(145deg, #12251d, #0d1712); color: #fff; border-radius: 12px; padding: 22px; box-shadow: var(--shadow); min-height: 300px; }
    .package-preview p, .package-preview li { color: rgba(255,255,255,.72); }
    .package-preview h3 { color: #fff; font-size: 30px; margin: 12px 0; }
    .preview-items { margin: 14px 0; padding-left: 20px; display: grid; gap: 6px; }
    .builder-actions { display: flex; flex-wrap: wrap; gap: 10px; }
    .builder-error { color: #8b2c21; font-weight: 900; min-height: 20px; }
    .empty-state { border: 1px dashed #cdbda9; border-radius: 8px; padding: 22px; color: var(--muted); background: rgba(255,253,249,.7); }
    .pricing-engine .card { overflow: visible; }
    .layer-list { display: grid; gap: 10px; }
    .layer-row { display: grid; grid-template-columns: 1.2fr .9fr .9fr .65fr .75fr auto; gap: 8px; align-items: center; border: 1px solid var(--line); border-radius: 8px; background: #fffdfa; padding: 10px; }
    .layer-row input, .layer-row select { min-height: 38px; padding: 8px 10px; }
    .sim-layer-list { display: grid; gap: 8px; margin: 14px 0; max-height: 250px; overflow: auto; }
    .sim-layer { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: center; padding: 9px 10px; border: 1px solid rgba(255,255,255,.14); border-radius: 8px; background: rgba(255,255,255,.05); }
    .sim-layer small { color: rgba(255,255,255,.58); font-weight: 800; }
    .calc-result { display: grid; gap: 10px; margin-top: 16px; }
    .calc-total, .calc-mini { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; border-top: 1px solid rgba(255,255,255,.14); padding-top: 12px; }
    .calc-total b { color: #fff; font-size: 34px; }
    .calc-mini b { color: #fff; font-size: 18px; }
    .calc-result ul { margin: 6px 0 0; padding-left: 18px; color: rgba(255,255,255,.72); display: grid; gap: 5px; }
    .calc-preview input, .calc-preview select { background: rgba(255,255,255,.92); }
    .calc-filters select, .calc-filters input { width: auto; min-width: 170px; }
    .table-wrap { overflow-x: auto; border-radius: 8px; }
    .table { min-width: 760px; }
    .footer {
      border-top: 1px solid rgba(221, 212, 199, .86);
      padding: 26px max(28px, calc((100vw - 1320px) / 2));
      color: var(--muted);
      background: rgba(248, 243, 235, .96);
      backdrop-filter: blur(14px);
    }
    .footer-inner { display: flex; align-items: center; justify-content: space-between; gap: 18px; flex-wrap: wrap; }
    @media (min-width: 901px) and (max-width: 1180px) {
      .nav { gap: 16px; padding: 12px 20px; }
      .logo { font-size: 18px; }
      .logo::before { width: 23px; height: 31px; }
      .navlinks { gap: 10px; flex-wrap: nowrap; }
      .navlinks a { font-size: 12px; white-space: nowrap; }
      .lang-switch a { min-width: 29px; padding: 6px 7px; }
      .hero { padding-inline: 20px; }
      .hero-panel { grid-template-columns: minmax(0, 1.1fr) minmax(300px, .76fr); gap: 32px; }
      .hero h1 { max-width: 820px; font-size: clamp(48px, 6vw, 68px); }
      .hero p { max-width: 680px; font-size: 18px; }
      .hero-visual { width: min(440px, 100%); }
      .home-choice-grid { max-width: 100%; }
      .segment-choice { padding: 18px; }
      .segment-choice strong { font-size: 24px; }
      main { padding-inline: 20px; }
    }
    @media (max-width: 900px) {
      .section-head, .footer-inner { align-items: flex-start; flex-direction: column; }
      body:not(.plain-page) { padding-top: 64px; }
      .nav { min-height: 64px; gap: 12px; padding: 10px 16px; }
      .nav-toggle { display: inline-flex; margin-left: auto; flex: 0 0 auto; }
      .navlinks {
        display: none;
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        width: 100%;
        max-height: calc(100vh - 64px);
        overflow-y: auto;
        padding: 10px 16px 14px;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
        background: rgba(248,243,235,.98);
        border-bottom: 1px solid var(--line);
        box-shadow: 0 18px 40px rgba(38,31,22,.14);
      }
      .nav.is-open .navlinks { display: grid; }
      .navlinks a { min-height: 42px; display: flex; align-items: center; justify-content: center; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: rgba(255,255,255,.72); font-size: 12px; text-align: center; }
      .lang-switch { grid-column: 1 / -1; width: 100%; justify-content: center; }
      .hero { min-height: auto; padding: 42px 18px 46px; }
      .hero-panel { gap: 28px; }
      .hero p { font-size: 17px; max-width: 100%; }
      .hero-actions, .actions { margin-top: 22px; }
      main { padding: 24px 16px 56px; }
      .band { padding: 46px 0; }
      .grid-3, .grid-2, .metric-row, .admin-shell, .hero-panel, .package-builder, .builder-grid, .item-picker, .layer-row { grid-template-columns: 1fr; }
      .request-form-wrap { grid-template-columns: 1fr; }
      .cup-lab { grid-template-columns: 1fr; }
      .cup-lab-stage { min-height: 420px; }
      .cup-preview-card { min-height: 420px; }
      .hero-visual { justify-self: stretch; width: 100%; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .home-choice-grid { max-width: 100%; }
      .visual-tile.large img { min-height: 220px; }
      .metric-row { margin-top: 0; }
      .check-grid { grid-template-columns: 1fr; }
      .trust-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .process-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .summary-grid { grid-template-columns: 1fr; }
      .admin-shell { display: block; }
      .admin-side { position: sticky; top: 64px; z-index: 18; padding: 14px 16px; overflow-x: auto; white-space: nowrap; }
      .admin-side h2 { display: inline-block; margin: 0 14px 0 0; vertical-align: middle; font-size: 18px !important; }
      .admin-side a { display: inline-block; padding: 9px 10px; margin-right: 4px; }
      .admin-main { padding: 22px 16px 48px; }
      .package-preview { position: static; min-height: auto; }
      .table-wrap, .band:has(.table), .admin-main > .table { overflow-x: auto; }
      h1, .hero h1, .section-head h1, h1[style] { font-size: clamp(38px, 8vw, 52px) !important; line-height: .98 !important; }
      .section-head h2, h2 { font-size: 32px; }
    }
    @media (max-width: 640px) {
      body { background: var(--paper); }
      body:not(.plain-page) { padding-top: 64px; }
      .nav {
        min-height: 64px;
        padding: 10px 12px;
        align-items: center;
        flex-direction: row;
        gap: 10px;
      }
      .logo { font-size: 17px; }
      .logo::before { width: 22px; height: 30px; }
      .nav-toggle { display: inline-flex; margin-left: auto; flex: 0 0 auto; }
      .navlinks {
        display: none;
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        width: 100%;
        max-height: calc(100vh - 64px);
        overflow-y: auto;
        padding: 10px 12px 14px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
        background: rgba(248,243,235,.98);
        border-bottom: 1px solid var(--line);
        box-shadow: 0 18px 40px rgba(38,31,22,.14);
      }
      .nav.is-open .navlinks { display: grid; }
      .navlinks a { min-height: 42px; display: flex; align-items: center; justify-content: center; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: rgba(255,255,255,.72); font-size: 12px; text-align: center; }
      .navlinks .admin-link { color: var(--dark); }
      .lang-switch { grid-column: 1 / -1; width: 100%; justify-content: center; }
      .lang-switch a { min-width: 30px; padding: 6px 8px; }
      .hero { padding: 34px 14px 38px; }
      .hero::before { background-size: 34px 34px; }
      .hero-panel { gap: 22px; }
      h1, .hero h1, .section-head h1, h1[style] { font-size: clamp(32px, 10.5vw, 42px) !important; line-height: 1 !important; }
      .hero p { margin-top: 16px; font-size: 16px; line-height: 1.48; }
      .hero-actions, .actions, .builder-actions { gap: 8px; }
      .hero-actions .btn, .actions .btn, .hero-actions button, .actions button { width: 100%; justify-content: center; text-align: center; }
      .bean { width: 34px; height: 46px; opacity: .72; }
      .hero-visual { grid-template-columns: 1fr 1fr; gap: 8px; }
      .visual-tile img { min-height: 120px; }
      .visual-tile.large img { min-height: 220px; }
      .proof-card { min-height: 110px; padding: 14px; }
      .proof-card b { font-size: 18px; }
      .home-choice-grid { grid-template-columns: 1fr; gap: 10px; margin-top: 24px; }
      .segment-choice { min-height: 148px; padding: 18px; }
      .segment-choice strong { font-size: 24px; max-width: 78%; }
      .segment-choice span { font-size: 14px; }
      main { padding: 18px 12px 48px; }
      .band { padding: 34px 0; }
      .section-head { gap: 12px; margin-bottom: 20px; }
      .section-head h2, h2 { font-size: 28px; line-height: 1.08; }
      .section-head p, .copy { font-size: 15px; max-width: 100%; }
      .card-body { padding: 15px; }
      .card h2, .card h3 { font-size: 21px; }
      .metric { padding: 15px; }
      .metric b { font-size: 28px; }
      input, select, textarea { min-height: 44px; font-size: 16px; padding: 11px 12px; }
      textarea { min-height: 104px; }
      .service-grid { gap: 8px; }
      .service-shell { min-height: 110px; padding: 13px; }
      .request-form-wrap { gap: 14px; }
      .request-form-wrap { display: flex; flex-direction: column; align-items: stretch; }
      .request-form-wrap > .cup-preview-card { display: none; }
      .service-builder {
        display: grid;
        grid-template-columns: 88px minmax(0, 1fr);
        gap: 10px;
        align-items: start;
      }
      .service-selection { display: grid; gap: 8px; min-width: 0; }
      .mobile-cup-preview {
        display: grid;
        place-items: center;
        position: sticky;
        top: 74px;
        height: 150px;
        min-height: 150px;
        overflow: hidden;
        z-index: 4;
        border: 1px solid rgba(255,255,255,.1);
        border-radius: 12px;
        background: radial-gradient(circle at 72% 12%, rgba(205,155,93,.2), transparent 25%), #111713;
        box-shadow: 0 12px 32px rgba(24,32,29,.2);
      }
      .mobile-cup-preview .cup-preview { width: 112px; max-width: none; }
      .service-builder .service-grid { grid-template-columns: 1fr; }
      .service-builder .service-shell { min-height: 128px; padding: 12px; }
      .service-builder .service-shell::before { width: 24px; height: 30px; }
      .service-builder .service-shell span { font-size: 13px; line-height: 1.35; }
      .service-builder .service-shell em { font-size: 12px; }
      .trust-strip { grid-template-columns: 1fr; }
      .process-grid { grid-template-columns: 1fr; }
      .process-step { min-height: auto; }
      .summary-hero { padding: 28px 20px; }
      .summary-facts { grid-template-columns: 1fr; }
      .summary-actions .btn { width: 100%; text-align: center; }
      .feature-band { padding: 20px; }
      .admin-main { padding: 18px 12px 40px; }
      .admin-side { top: 64px; padding: 10px 12px; }
      .admin-side h2 { display: block; margin: 0 0 8px; }
      .admin-side a { font-size: 13px; padding: 8px 9px; }
      .package-toolbar { gap: 8px; overflow-x: auto; flex-wrap: nowrap; padding-bottom: 4px; margin: 14px 0 18px; }
      .package-toolbar > * { flex: 0 0 auto; }
      .segment-tab { padding: 9px 11px; font-size: 13px; }
      .package-card { padding: 14px; }
      .package-card h3 { font-size: 20px; }
      .package-preview { padding: 18px; border-radius: 10px; }
      .package-preview h3 { font-size: 25px; }
      .builder-grid { gap: 10px; }
      .item-row { grid-template-columns: 1fr; }
      .item-row button { width: 100%; }
      .layer-row { gap: 9px; }
      .sim-layer { grid-template-columns: auto 1fr; }
      .sim-layer small { grid-column: 2; }
      .calc-total, .calc-mini { align-items: flex-start; flex-direction: column; }
      .calc-total b { font-size: 28px; }
      .calc-filters select, .calc-filters input { min-width: 78vw; }
      .table { min-width: 720px; font-size: 13px; }
      .table th, .table td { padding: 10px; }
      .footer { padding: 22px 12px; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        scroll-behavior: auto !important;
        animation-duration: .01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: .01ms !important;
      }
    }
    @media print {
      @page { size: A4; margin: 14mm; }
      body { padding: 0 !important; background: #fff !important; color: #151713; }
      .nav, .footer, .summary-actions, .print-note { display: none !important; }
      main { max-width: none; padding: 0 !important; }
      .summary-shell { max-width: none; }
      .summary-hero { padding: 24px; border-radius: 0; box-shadow: none; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .summary-hero h1 { font-size: 38px !important; }
      .summary-hero p { font-size: 14px; }
      .band { padding: 24px 0; break-inside: avoid; }
      .card, .process-step { box-shadow: none; break-inside: avoid; }
      .summary-list li { break-inside: avoid; }
    }
  </style>
</head>
<body class="${options.plain ? "plain-page" : options.admin ? "admin-page" : "public-page"}">
  ${options.plain ? "" : `<a class="skip-link" href="#page-content">Skip to content</a>`}
  ${options.plain ? "" : options.admin ? adminNav() : publicNav()}
  <div id="page-content" tabindex="-1">${body}</div>
  ${options.plain || options.admin ? "" : footer()}
  <script>
    (() => {
      const dictionaries = ${JSON.stringify(translations)};
      const supported = ["en", "ru", "ro"];
      const params = new URLSearchParams(window.location.search);
      const requested = params.get("lang");
      if (requested && supported.includes(requested)) localStorage.setItem("binova_lang", requested);
      const lang = localStorage.getItem("binova_lang") || "en";
      document.documentElement.lang = lang;
      document.querySelectorAll(".lang-switch a").forEach((link) => {
        link.classList.toggle("active", link.getAttribute("data-lang") === lang);
      });
      window.binovaTranslate = (value) => value;
      const dict = dictionaries[lang] || {};
      const entries = Object.entries(dict).sort((a, b) => b[0].length - a[0].length);
      const normalize = (value) => value.replace(/\\s+/g, " ").trim();
      const translate = (value) => {
        const normalized = normalize(value);
        if (!normalized) return value;
        if (dict[normalized]) {
          const leading = value.match(/^\\s*/)?.[0] || "";
          const trailing = value.match(/\\s*$/)?.[0] || "";
          return leading + dict[normalized] + trailing;
        }
        let next = value;
        for (const [source, translated] of entries) {
          if (source.length > 12 && next.includes(source)) next = next.split(source).join(translated);
        }
        return next;
      };
      window.binovaTranslate = translate;
      const applyTranslations = (root) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            const text = node.nodeValue || "";
            const parent = node.parentElement;
            if (!normalize(text) || !parent || ["SCRIPT", "STYLE"].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
        });
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach((node) => {
          node.nodeValue = translate(node.nodeValue || "");
        });
        root.querySelectorAll?.("[placeholder]").forEach((node) => {
          const value = node.getAttribute("placeholder") || "";
          node.setAttribute("placeholder", translate(value));
        });
        root.querySelectorAll?.("[aria-label]").forEach((node) => {
          const value = node.getAttribute("aria-label") || "";
          node.setAttribute("aria-label", translate(value));
        });
        root.querySelectorAll?.("option").forEach((node) => {
          node.textContent = translate(node.textContent || "");
        });
      };
      applyTranslations(document.body);
      document.title = translate(document.title);
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.TEXT_NODE) {
              node.nodeValue = translate(node.nodeValue || "");
            } else if (node.nodeType === Node.ELEMENT_NODE) {
              applyTranslations(node);
            }
          });
        });
      });
      observer.observe(document.body, { childList: true, subtree: true });
    })();

    document.querySelectorAll(".nav-toggle").forEach((toggle) => {
      toggle.addEventListener("click", () => {
        const nav = toggle.closest(".nav");
        if (!nav) return;
        const open = nav.classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", String(open));
        toggle.setAttribute("aria-label", window.binovaTranslate(open ? "Close menu" : "Open menu"));
      });
    });

    const setCupStage = (root, stage) => {
      const previews = root?.querySelectorAll?.(".cup-preview") || document.querySelectorAll(".cup-preview");
      previews.forEach((preview) => preview.setAttribute("data-stage", String(stage)));
    };

    const updateRequestCup = (input) => {
      const wrapper = input.closest(".request-form-wrap");
      if (!wrapper) return;
      const form = input.closest("form");
      const count = form ? form.querySelectorAll(".service-card input:checked").length : 0;
      const stage = count === 0 ? 1 : Math.min(6, count + 1);
      setCupStage(wrapper, stage);
    };

    document.querySelectorAll(".service-card").forEach((card) => {
      const input = card.querySelector("input");
      if (!input) return;
      card.addEventListener("click", (event) => {
        event.preventDefault();
        input.checked = !input.checked;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      input.addEventListener("change", () => updateRequestCup(input));
    });

    document.querySelectorAll(".package-preset").forEach((card) => {
      const applyPreset = () => {
        const services = String(card.getAttribute("data-services") || "").split("|").filter(Boolean);
        const form = document.querySelector("#request form");
        if (!form || !services.length) return;
        form.querySelectorAll(".service-card input").forEach((input) => {
          input.checked = services.includes(input.value);
          input.dispatchEvent(new Event("change", { bubbles: true }));
        });
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        document.querySelector("#request")?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      };
      card.addEventListener("click", applyPreset);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          applyPreset();
        }
      });
    });

    const defaultLayerPrices = {
      "Coffee program": 180, "Coffee machines": 120, "Water service": 90, "Cleaning supplies": 70, "Office consumables": 2, "Preventive maintenance": 70,
      "Store consumables": 80, "Shelf equipment": 350, "Coffee corner": 350, "POS supplies": 40, "Scheduled replenishment": 90,
      "Coffee beans": 180, "Professional machines": 260, "Machine service": 120, "Table consumables": 80, "Kitchen hygiene": 70, "Emergency replenishment": 90
    };

    const calculatePublicOffer = (form) => {
      const rules = JSON.parse(localStorage.getItem("binova_pricing_rules_v1") || "[]");
      const layers = JSON.parse(localStorage.getItem("binova_service_layers_v1") || "[]");
      const segment = form.querySelector('[name="segment"]')?.value || "office";
      const size = form.querySelector('[name="companySize"]')?.value || "small";
      const employees = Number(form.querySelector('[name="employeeCount"]')?.value || 0);
      const locations = Math.max(1, Number(form.querySelector('[name="locationsCount"]')?.value || 1));
      const selectedServices = Array.from(form.querySelectorAll('[name="services"]:checked')).map((input) => input.value);
      const rule = rules.find((item) => item.status === "active" && (item.segment === segment || item.segment === "all") && item.clientSize === size)
        || rules.find((item) => item.status === "active" && (item.segment === segment || item.segment === "all"))
        || { id:"server-fallback", name:"Fallback estimate", baseMonthlyPrice:500, minimumMonthlyPrice:500, setupFee:0, perEmployee:5, perLocation:100, serviceLevelMultiplier:1, packageMultiplier:1, discountType:"none", discountValue:0, markupType:"none", markupValue:0 };
      const matchingLayers = selectedServices.map((service) => layers.find((layer) => layer.segment === segment && String(layer.name).toLowerCase() === String(service).toLowerCase())).filter(Boolean);
      const serviceTotal = selectedServices.reduce((sum, service) => {
        const layer = matchingLayers.find((item) => String(item.name).toLowerCase() === String(service).toLowerCase());
        if (layer) {
          if (layer.pricingType === "per_employee") return sum + Number(layer.price || 0) * employees;
          if (layer.pricingType === "per_location") return sum + Number(layer.price || 0) * locations;
          if (layer.pricingType === "one_time" || layer.pricingType === "custom_quote") return sum;
          return sum + Number(layer.price || 0);
        }
        return sum + (defaultLayerPrices[service] || 100);
      }, 0);
      let subtotal = Number(rule.baseMonthlyPrice || 0) + employees * Number(rule.perEmployee || 0) + locations * Number(rule.perLocation || 0) + serviceTotal;
      subtotal = subtotal * Number(rule.serviceLevelMultiplier || 1) * Number(rule.packageMultiplier || 1);
      const markup = rule.markupType === "percent" ? subtotal * Number(rule.markupValue || 0) / 100 : rule.markupType === "fixed" ? Number(rule.markupValue || 0) : 0;
      subtotal += markup;
      const discount = rule.discountType === "percent" ? subtotal * Number(rule.discountValue || 0) / 100 : rule.discountType === "fixed" ? Number(rule.discountValue || 0) : 0;
      subtotal -= discount;
      const monthly = Math.max(Number(rule.minimumMonthlyPrice || 0), Math.round(subtotal));
      const setupLayerFee = matchingLayers.filter((layer) => layer.pricingType === "one_time").reduce((sum, layer) => sum + Number(layer.price || 0), 0);
      const setup = Math.round(Number(rule.setupFee || 0) + setupLayerFee);
      const yearly = monthly * 12 + setup;
      const breakdown = [
        "Rule: " + (rule.name || rule.id),
        "Base: " + Number(rule.baseMonthlyPrice || 0) + " EUR",
        "Employees: " + employees + " x " + Number(rule.perEmployee || 0) + " EUR",
        "Locations: " + locations + " x " + Number(rule.perLocation || 0) + " EUR",
        "Service layers: " + Math.round(serviceTotal) + " EUR",
        "Markup: " + Math.round(markup) + " EUR",
        "Discount: " + Math.round(discount) + " EUR"
      ];
      form.querySelector('[name="estimatedMonthlyPrice"]').value = String(monthly);
      form.querySelector('[name="setupFee"]').value = String(setup);
      form.querySelector('[name="yearlyValue"]').value = String(yearly);
      form.querySelector('[name="pricingRuleId"]').value = rule.id || "";
      form.querySelector('[name="selectedServiceLayers"]').value = JSON.stringify(matchingLayers.map((layer) => layer.id));
      form.querySelector('[name="priceBreakdown"]').value = JSON.stringify(breakdown);
    };

    document.querySelectorAll('form[action="/lead"]').forEach((form) => {
      form.addEventListener("submit", () => {
        const language = form.querySelector('[name="language"]');
        if (language) language.value = document.documentElement.lang || "en";
        calculatePublicOffer(form);
      });
    });

    document.querySelectorAll(".cup-stage-button").forEach((button) => {
      button.addEventListener("click", () => {
        const stage = button.getAttribute("data-cup-stage") || "1";
        setCupStage(button.closest(".cup-lab"), stage);
        document.querySelectorAll(".cup-stage-button").forEach((node) => {
          node.classList.toggle("active", node === button);
        });
      });
    });
  </script>
</body>
</html>`;
};

const publicNav = () => `
  <nav class="nav" aria-label="Primary navigation">
    <a class="logo" href="/">Binova Group</a>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-label="Open menu">&#9776;</button>
    <div class="navlinks">
      <a href="/solutions/office">Office Solutions</a>
      <a href="/solutions/retail">Retail Solutions</a>
      <a href="/solutions/horeca">HoReCa Solutions</a>
      <a href="/about">About</a>
      <a class="admin-link" href="/#segments">Get Offer</a>
      <span class="lang-switch" role="group" aria-label="Language">
        <a href="?lang=en" data-lang="en">EN</a>
        <a href="?lang=ru" data-lang="ru">RU</a>
        <a href="?lang=ro" data-lang="ro">RO</a>
      </span>
    </div>
  </nav>`;

const adminNav = () => `
  <nav class="nav" aria-label="Admin navigation">
    <a class="logo" href="/admin">Binova Admin</a>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-label="Open menu">&#9776;</button>
    <div class="navlinks">
      <a href="/">Public site</a>
      <span class="lang-switch" role="group" aria-label="Language">
        <a href="?lang=en" data-lang="en">EN</a>
        <a href="?lang=ru" data-lang="ru">RU</a>
        <a href="?lang=ro" data-lang="ro">RO</a>
      </span>
    </div>
  </nav>`;

const footer = () => `
  <footer class="footer">
    <div class="footer-inner">
      <span>Binova Group | Managed coffee and beverage systems for business</span>
      <span><a href="/solutions/office">Office</a> · <a href="/solutions/retail">Retail</a> · <a href="/solutions/horeca">HoReCa</a> · <a href="/about">About us</a> · <a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms</a></span>
    </div>
  </footer>`;

const beanField = () => `
  <div class="bean-field">
    ${Array.from({ length: 12 }, (_, index) => `<span class="bean b${index + 1}"></span>`).join("")}
  </div>`;

const cupPreview = (stage = 1) => `
  <div class="cup-preview" data-stage="${stage}" aria-hidden="true">
    ${[1, 2, 3, 4, 5, 6].map((item) => `<span class="cup-frame stage-${item}"></span>`).join("")}
  </div>`;

const homePage = () => {
  return page("Coffee and beverage systems for business", `
    <header class="hero">
      ${beanField()}
      <div class="hero-inner hero-panel">
        <div>
          <p class="eyebrow">Binova Group</p>
          <h1>Coffee & beverage systems built around your business.</h1>
          <p>Choose your business type and get a tailored solution for products, equipment, supply, service and long-term support.</p>
          <div class="hero-actions">
            <a class="btn" href="#segments">Get a tailored offer</a>
            <a class="btn secondary" href="/about">Why Binova</a>
          </div>
          <div id="segments" class="home-choice-grid" aria-label="Choose business line">
            <a class="segment-choice" href="/solutions/office"><strong>Office Coffee Solutions</strong><span>Predictable coffee, tea, equipment and service for teams of any size.</span><em>Build office package</em></a>
            <a class="segment-choice" href="/solutions/retail"><strong>Retail & Multi-location Solutions</strong><span>Standardized beverage systems for stores, networks and high-traffic locations.</span><em>Configure retail solution</em></a>
            <a class="segment-choice" href="/solutions/horeca"><strong>HoReCa Beverage Systems</strong><span>Professional coffee, equipment, training and service for cafes, hotels and restaurants.</span><em>Request HoReCa setup</em></a>
          </div>
        </div>
      </div>
    </header>
    <main>
      <section class="band">
        <div class="section-head">
          <div>
            <p class="eyebrow">Why Binova</p>
            <h2>Less hassle. Better coffee. One managed system.</h2>
          </div>
          <p>Tell us how your business works. We’ll shape the right setup: products, equipment, supply, service and support.</p>
        </div>
        <div class="grid-3">
          <article class="card"><div class="card-body"><span class="badge">Continuity</span><h3>Everything works, every day</h3><p>Equipment, supply and service are managed together, so your team does not have to coordinate separate suppliers.</p></div></article>
          <article class="card"><div class="card-body"><span class="badge">Quality</span><h3>The right setup for every cup</h3><p>Coffee, equipment and service are selected around your business type, volume and customer experience.</p></div></article>
          <article class="card"><div class="card-body"><span class="badge">Control</span><h3>One partner, one clear process</h3><p>Every Office, HoReCa or Retail request starts structured and continues with a dedicated Binova team.</p></div></article>
        </div>
      </section>
      <section class="band" id="process">
        <div class="section-head">
          <div>
            <p class="eyebrow">How Binova works</p>
            <h2>One partner from first brief to daily operation</h2>
          </div>
          <p>Four clear stages turn a fragmented supply task into a managed beverage system.</p>
        </div>
        <div class="process-grid">
          <article class="process-step"><div><h3>Understand the operation</h3><p>Segment, team size, locations, guest flow and current setup.</p></div></article>
          <article class="process-step"><div><h3>Design the system</h3><p>Products, equipment and service level selected around real demand.</p></div></article>
          <article class="process-step"><div><h3>Launch with control</h3><p>Installation, calibration and team onboarding in one coordinated start.</p></div></article>
          <article class="process-step"><div><h3>Manage and improve</h3><p>Replenishment, maintenance and support keep the system working.</p></div></article>
        </div>
        <div class="actions"><a class="btn" href="#segments">Build your solution</a></div>
      </section>
    </main>
  `, {
    canonicalPath: "/",
    description: "Binova Group designs and manages coffee and beverage systems for offices, retail networks and HoReCa businesses.",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Binova Group",
      url: siteBaseUrl
    }
  });
};

const solutionPage = (segment: keyof typeof businessLines) => {
  const line = businessLines[segment];
  const copy = solutionCopy[segment];
  const packages = activePackages(segment);
  const items = copy.catalogItems.length ? copy.catalogItems : catalogItems(segment);
  const serviceDescriptions: Record<string, string> = copy.serviceDescriptions;
  const companySizeControl = copy.companySizeOptions.length
    ? `<select name="companySize">${copy.companySizeOptions.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join("")}</select>`
    : `<select name="companySize">
                  ${companySizes.map((size) => `<option value="${size.value}">${size.label} - ${size.hint}</option>`).join("")}
                </select>`;
  const employeeInputType = copy.employeePlaceholder ? "text" : "number";
  const employeeInputAttrs = copy.employeePlaceholder
    ? `name="employeeCount" placeholder="${escapeHtml(copy.employeePlaceholder)}"`
    : `type="number" min="1" name="employeeCount" value="25"`;
  const packageCards = copy.presets.length
    ? copy.presets.map((preset) => `
            <article class="card package-preset" role="button" tabindex="0" data-services="${escapeHtml(preset.services.join("|"))}">
              <div class="card-body">
                <span class="badge">${escapeHtml(line.label)}</span>
                <h3>${escapeHtml(preset.name)}</h3>
                <p>${escapeHtml(preset.description)}</p>
                <p>${escapeHtml(preset.items)}</p>
              </div>
            </article>
          `).join("")
    : packages.map((pkg) => `
            <article class="card">
              <div class="card-body">
                <span class="badge">${escapeHtml(line.label)}</span>
                <h3>${escapeHtml(pkg.name)}</h3>
                <p>${escapeHtml(pkg.description)}</p>
                <p>${escapeHtml(String(pkg.items).split("\n").join(" · "))}</p>
              </div>
            </article>
          `).join("");
  const fillerCards = copy.presets.length
    ? ""
    : line.services.slice(0, Math.max(0, 3 - packages.length)).map((service) => `
            <article class="card">
              <div class="card-body">
                <span class="badge">Layer</span>
                <h3>${escapeHtml(service)}</h3>
                <p>Can be combined with catalog items, equipment, replenishment rhythm and service support.</p>
              </div>
            </article>
          `).join("");

  return page(`${line.label} solution`, `
    <header class="hero">
      ${beanField()}
      <div class="hero-inner hero-panel">
        <div>
        <p class="eyebrow">${escapeHtml(line.label)} solution</p>
        <h1>${escapeHtml(line.title)}</h1>
        <p>${escapeHtml(copy.heroDescription)}</p>
        <div class="hero-actions">
          <a class="btn" href="#request">${escapeHtml(copy.primaryCta)}</a>
          <a class="btn secondary" href="/">Back to segments</a>
        </div>
        </div>
        <div class="hero-visual" aria-label="${escapeHtml(line.label)} visual">
          <div class="visual-tile large"><img src="${line.hero}" alt="${escapeHtml(line.label)}" width="900" height="600" decoding="async" fetchpriority="high"></div>
          <div class="proof-card"><span>${escapeHtml(line.label)}</span><b>${escapeHtml(copy.proofTitle)}</b></div>
        </div>
      </div>
    </header>
    <main>
      <section class="band">
        <div class="section-head">
          <div><p class="eyebrow">Service direction</p><h2>Choose a starting package</h2></div>
          <p>${escapeHtml(copy.packageIntro)}</p>
        </div>
        <div class="grid-3">
          ${packageCards || `<div class="card"><div class="card-body"><h3>Packages are being prepared</h3><p>Send a request and the Binova team will recommend the right service setup.</p></div></div>`}
          ${fillerCards}
        </div>
      </section>
      <section id="request" class="band">
        <div class="section-head">
          <div><p class="eyebrow">${escapeHtml(copy.requestEyebrow)}</p><h2>${escapeHtml(copy.requestTitle)}</h2></div>
          <p>${escapeHtml(copy.requestIntro)}</p>
        </div>
        <div class="request-form-wrap">
          <form class="card card-body" method="post" action="/lead">
            <input type="hidden" name="segment" value="${segment}">
            <input type="hidden" name="estimatedMonthlyPrice">
            <input type="hidden" name="setupFee">
            <input type="hidden" name="yearlyValue">
            <input type="hidden" name="pricingRuleId">
            <input type="hidden" name="selectedServiceLayers">
            <input type="hidden" name="priceBreakdown">
            <input type="hidden" name="language" value="en">
            <label>Company name<input required name="companyName" placeholder="Example SRL"></label>
            <label>Contact name<input required name="contactName" placeholder="Decision maker"></label>
            <label>Email<input required type="email" name="email" placeholder="name@company.com"></label>
            <label>Phone<input name="phone" placeholder="+373 ..."></label>
            <div class="grid-2">
              <label>${escapeHtml(copy.companySizeLabel)}
                ${companySizeControl}
              </label>
              <label>${escapeHtml(copy.employeeLabel)}<input required type="${employeeInputType}" ${employeeInputAttrs}></label>
            </div>
            <label>Locations<input required type="number" min="1" name="locationsCount" value="1"></label>
            <div class="service-builder">
              <div class="mobile-cup-preview" aria-hidden="true">
                ${cupPreview(1)}
              </div>
              <div class="service-selection">
                <label>${escapeHtml(copy.servicesTitle)}</label>
                <div class="service-grid">
                  ${line.services.map((service) => `<label class="service-card"><input type="checkbox" name="services" value="${escapeHtml(service)}"><span class="service-shell"><strong>${escapeHtml(service)}</strong><span>${escapeHtml(serviceDescriptions[service] ?? "Tap to add this layer to the request.")}</span><em>${escapeHtml(copy.serviceCta)}</em></span></label>`).join("")}
                </div>
              </div>
            </div>
            <label>${escapeHtml(copy.contextLabel)}<textarea name="message" placeholder="${escapeHtml(copy.contextPlaceholder)}"></textarea></label>
            <button type="submit">${escapeHtml(copy.submitLabel)}</button>
          </form>
          <div class="cup-preview-card">
            ${cupPreview(1)}
          </div>
        </div>
      </section>
      <section class="band">
        <div class="section-head">
          <div><p class="eyebrow">${escapeHtml(copy.catalogEyebrow)}</p><h2>${escapeHtml(copy.catalogTitle)}</h2></div>
          <p>${escapeHtml(copy.catalogIntro)}</p>
        </div>
        <div class="grid-3">
          ${items.map((item) => `
            <article class="card">
              ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}" width="700" height="525" loading="lazy" decoding="async">` : ""}
              <div class="card-body">
                <span class="badge">${escapeHtml(item.category)}</span>
                <h3>${escapeHtml(item.name)}</h3>
                <p>${escapeHtml(item.description)}</p>
              </div>
            </article>
          `).join("")}
        </div>
      </section>
    </main>
  `, {
    canonicalPath: `/solutions/${segment}`,
    description: `${line.title}. ${copy.heroDescription}`,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Service",
      name: line.title,
      description: copy.heroDescription,
      provider: { "@id": `${siteBaseUrl}/#organization` },
      areaServed: "Moldova",
      serviceType: `${line.label} beverage system`
    }
  });
};

const aboutPage = () => page("About us", `
  <main>
    <section class="band">
      <p class="eyebrow">About Binova Group</p>
      <h1 style="color:var(--ink); font-size:64px;">Operator of coffee, beverage and service systems</h1>
      <p class="copy">Binova Group is the evolution of Binonic Lux and 15 years of experience with business clients. We do not simply supply coffee or equipment. We build and maintain a system that helps offices, HoReCa and retail operate more reliably: product, equipment, replenishment, service, training and support in one process.</p>
    </section>
    <section class="band">
      <div class="grid-3">
        <article class="card"><img src="https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=700&q=78" alt="Business meeting" width="700" height="525" loading="lazy" decoding="async"><div class="card-body"><h2>A system instead of fragmented supply</h2><p>Binova combines product, equipment, replenishment and service into one managed process. The client gets one partner responsible for the result, not a list of disconnected suppliers.</p></div></article>
        <article class="card"><img src="https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=700&q=78" alt="Coffee service" width="700" height="525" loading="lazy" decoding="async"><div class="card-body"><h2>Service as part of the product</h2><p>Coffee works only when the equipment works. Maintenance, prevention, calibration and replacement are not extras, but part of the Binova system itself.</p></div></article>
        <article class="card"><img src="https://images.unsplash.com/photo-1556740738-b6a63e27c4df?auto=format&fit=crop&w=700&q=78" alt="Retail operations" width="700" height="525" loading="lazy" decoding="async"><div class="card-body"><h2>Three segments, three growth logics</h2><p>Offices need team comfort and predictable budgets. HoReCa needs stable quality and no downtime. Retail needs one standard across points and additional sales. That is why each segment gets its own flow and offer.</p></div></article>
      </div>
    </section>
    <section class="band grid-2">
      <div>
        <p class="eyebrow">Strategic promise</p>
        <h2>Operational calm that works for growth</h2>
        <p class="copy">For offices, coffee becomes part of culture and care for the team. For HoReCa, it becomes a product that affects repeat visits and average check. For retail, it becomes a point of additional sales and a way to turn traffic into revenue. Binova takes responsibility for the system behind the cup: equipment, supply, maintenance, training and support.</p>
      </div>
      <div class="card"><div class="card-body">
        <h3>One operating model, adapted to your business</h3>
        <p>Every project starts with understanding the operation, continues with a tailored system design, and becomes a managed service with clear ownership.</p>
        <p>Office, Retail and HoReCa clients receive different configurations, while Binova remains the single partner responsible for continuity.</p>
      </div></div>
    </section>
  </main>
`, {
  canonicalPath: "/about",
  description: "Meet Binova Group, an operator of managed coffee, beverage, equipment, replenishment and service systems for B2B clients."
});

const cupLabPage = () => page("Cup lab", `
  <main>
    <section class="band">
      <p class="eyebrow">Service configurator</p>
      <h1 style="color:var(--ink); font-size:64px;">AI cup stages</h1>
      <p class="copy">Separate visual test. If this direction works, the same staged image logic can be connected back to service selection.</p>
    </section>
    <section class="band cup-lab">
      <div class="cup-lab-controls">
        ${[1, 2, 3, 4, 5, 6].map((stage) => `
          <button class="cup-stage-button${stage === 1 ? " active" : ""}" type="button" data-cup-stage="${stage}">
            Stage ${stage}
          </button>
        `).join("")}
      </div>
      <div class="cup-lab-stage">
        ${cupPreview(1)}
      </div>
    </section>
  </main>
`, { noIndex: true });

const privacyPage = () => page("Privacy Policy", `
  <main>
    <section class="band">
      <p class="eyebrow">Privacy Policy</p>
      <h1 style="color:var(--ink); font-size:58px;">Privacy and business request data</h1>
      <p class="copy">This website is intended for B2B enquiries. Information is processed to understand your request, prepare a relevant solution and contact you about the next commercial step.</p>
    </section>
    <section class="band grid-2">
      <div class="card"><div class="card-body"><h2>Information you submit</h2><p>Company and contact details, business segment, company scale, locations, selected services and additional request notes.</p></div></div>
      <div class="card"><div class="card-body"><h2>Technical visit data</h2><p>Basic technical data such as IP address, approximate country or city, visited page, language and device type may be recorded for security and usage analysis.</p></div></div>
      <div class="card"><div class="card-body"><h2>How information is used</h2><p>Data is used to respond to enquiries, prepare commercial proposals, improve service flows and protect the website from automated abuse.</p></div></div>
      <div class="card"><div class="card-body"><h2>Access and deletion</h2><p>Access is limited to people and providers involved in handling the request. You may request correction or deletion through the same Binova contact channel used for your enquiry.</p></div></div>
    </section>
  </main>
`, {
  canonicalPath: "/privacy",
  description: "How Binova Group processes business enquiry and technical website data."
});

const termsPage = () => page("Terms", `
  <main>
    <section class="band">
      <p class="eyebrow">Terms</p>
      <h1 style="color:var(--ink); font-size:58px;">Website terms of use</h1>
      <p class="copy">The website helps business clients explore Binova solutions and submit a structured request. Website content is informational and does not by itself create a contractual commitment.</p>
    </section>
    <section class="band grid-2">
      <div class="card"><div class="card-body"><h2>Commercial proposals</h2><p>Final scope, pricing, delivery schedule, service levels and payment conditions are confirmed in a separate commercial proposal or agreement.</p></div></div>
      <div class="card"><div class="card-body"><h2>Product and service information</h2><p>Availability, specifications and service configurations may change as Binova adapts the solution to the client and location.</p></div></div>
      <div class="card"><div class="card-body"><h2>Website content</h2><p>Text, visual materials, configurations and brand elements may not be reused commercially without permission.</p></div></div>
      <div class="card"><div class="card-body"><h2>Service availability</h2><p>Binova may update the website and temporarily restrict access for maintenance, security or operational reasons.</p></div></div>
    </section>
  </main>
`, {
  canonicalPath: "/terms",
  description: "Terms for using the Binova Group website and submitting a business solution request."
});

type SupportedLanguage = "en" | "ru" | "ro";

const normalizeLanguage = (value: unknown): SupportedLanguage =>
  value === "ru" || value === "ro" ? value : "en";

const summaryCopy: Record<SupportedLanguage, Record<string, string>> = {
  en: {
    eyebrow: "Request received",
    title: "Your Binova solution brief is ready",
    intro: "We captured the operating context and selected services. A Binova manager can now turn this brief into a tailored commercial proposal.",
    request: "Request",
    company: "Company",
    segment: "Business segment",
    profile: "Company profile",
    locations: "Locations",
    contact: "Contact",
    services: "Selected services",
    details: "Additional details",
    noDetails: "No additional details were provided.",
    next: "What happens next",
    step1: "Binova reviews the request and validates the operating context.",
    step2: "Products, equipment and service levels are matched to the real demand.",
    step3: "A manager prepares the commercial scope and implementation plan.",
    step4: "The final configuration is aligned directly with your team.",
    save: "Save as PDF",
    back: "Back to site",
    print: "Use the browser print dialog and choose Save as PDF."
  },
  ru: {
    eyebrow: "Заявка получена",
    title: "Краткое описание вашего решения Binova готово",
    intro: "Мы сохранили параметры бизнеса и выбранные сервисы. Теперь менеджер Binova сможет превратить этот brief в персональное коммерческое предложение.",
    request: "Заявка",
    company: "Компания",
    segment: "Направление бизнеса",
    profile: "Профиль компании",
    locations: "Локации",
    contact: "Контакт",
    services: "Выбранные услуги",
    details: "Дополнительные детали",
    noDetails: "Дополнительные детали не указаны.",
    next: "Что произойдёт дальше",
    step1: "Binova проверит заявку и уточнит операционный контекст.",
    step2: "Продукты, оборудование и уровень сервиса будут подобраны под реальную нагрузку.",
    step3: "Менеджер подготовит коммерческий состав и план запуска.",
    step4: "Финальная конфигурация будет согласована напрямую с вашей командой.",
    save: "Сохранить PDF",
    back: "Вернуться на сайт",
    print: "В окне печати браузера выберите Сохранить как PDF."
  },
  ro: {
    eyebrow: "Cerere primită",
    title: "Rezumatul soluției Binova este pregătit",
    intro: "Am salvat contextul operațional și serviciile selectate. Un manager Binova poate transforma acum acest rezumat într-o ofertă comercială personalizată.",
    request: "Cerere",
    company: "Companie",
    segment: "Segment de business",
    profile: "Profilul companiei",
    locations: "Locații",
    contact: "Contact",
    services: "Servicii selectate",
    details: "Detalii suplimentare",
    noDetails: "Nu au fost oferite detalii suplimentare.",
    next: "Ce urmează",
    step1: "Binova verifică cererea și validează contextul operațional.",
    step2: "Produsele, echipamentele și nivelul de service sunt adaptate cererii reale.",
    step3: "Managerul pregătește structura comercială și planul de implementare.",
    step4: "Configurația finală este coordonată direct cu echipa dumneavoastră.",
    save: "Salvează PDF",
    back: "Înapoi la site",
    print: "În fereastra de imprimare selectați Salvare ca PDF."
  }
};

const summaryPage = (token: string, requestedLanguage?: string | null, autoPrint = false) => {
  const lead = statementGet(`SELECT * FROM "ClientLead" WHERE "summaryToken" = ?`, token);
  if (!lead) {
    return page("Summary not found", `<main><section class="band"><h1 style="color:var(--ink);">Summary not found</h1></section></main>`, { noIndex: true });
  }

  const lang = normalizeLanguage(requestedLanguage || lead.language);
  const copy = summaryCopy[lang];
  const services = String(lead.services || "").split(",").map((item) => item.trim()).filter(Boolean);
  const translatedServices = services.map((service) => translations[lang]?.[service] || service);
  const profile = companySizes.find((size) => size.value === lead.companySize);
  const profileLabel = profile ? `${profile.label} - ${profile.hint}` : String(lead.companySize || "-");
  const contact = [lead.contactName, lead.email, lead.phone].filter(Boolean).join(" · ");
  const printUrl = `/summary/${token}/print?lang=${lang}`;

  return page(copy.title, `
    <main>
      <div class="summary-shell">
        <section class="band">
          <div class="summary-hero">
            <p class="eyebrow">${escapeHtml(copy.eyebrow)}</p>
            <h1>${escapeHtml(copy.title)}</h1>
            <p>${escapeHtml(copy.intro)}</p>
            <div class="summary-meta">
              <span>${escapeHtml(copy.request)} #${escapeHtml(lead.id)}</span>
              <span>${escapeHtml(formatDate(lead.createdAt))}</span>
              <span>${escapeHtml(slugLabel(lead.segment))}</span>
            </div>
          </div>
        </section>
        <section class="band summary-grid">
          <article class="card"><div class="card-body">
            <h2>${escapeHtml(copy.company)}</h2>
            <div class="summary-facts">
              <div class="summary-fact"><span>${escapeHtml(copy.company)}</span><b>${escapeHtml(lead.companyName)}</b></div>
              <div class="summary-fact"><span>${escapeHtml(copy.segment)}</span><b>${escapeHtml(slugLabel(lead.segment))}</b></div>
              <div class="summary-fact"><span>${escapeHtml(copy.profile)}</span><b>${escapeHtml(profileLabel)}</b></div>
              <div class="summary-fact"><span>${escapeHtml(copy.locations)}</span><b>${escapeHtml(lead.locationsCount)}</b></div>
              <div class="summary-fact" style="grid-column:1/-1"><span>${escapeHtml(copy.contact)}</span><b>${escapeHtml(contact)}</b></div>
            </div>
          </div></article>
          <article class="card"><div class="card-body">
            <h2>${escapeHtml(copy.services)}</h2>
            <ul class="summary-list">${translatedServices.length ? translatedServices.map((service) => `<li>${escapeHtml(service)}</li>`).join("") : `<li>-</li>`}</ul>
          </div></article>
        </section>
        <section class="band grid-2">
          <article class="card"><div class="card-body"><h2>${escapeHtml(copy.details)}</h2><p>${escapeHtml(lead.message || copy.noDetails)}</p></div></article>
          <article class="card"><div class="card-body"><h2>${escapeHtml(copy.next)}</h2><ol><li>${escapeHtml(copy.step1)}</li><li>${escapeHtml(copy.step2)}</li><li>${escapeHtml(copy.step3)}</li><li>${escapeHtml(copy.step4)}</li></ol></div></article>
        </section>
        <div class="summary-actions">
          <a class="btn" href="${escapeHtml(printUrl)}" target="_blank" rel="noopener">${escapeHtml(copy.save)}</a>
          <a class="btn secondary" href="/?lang=${lang}">${escapeHtml(copy.back)}</a>
        </div>
        <p class="print-note">${escapeHtml(copy.print)}</p>
      </div>
    </main>
    ${autoPrint ? `<script>window.addEventListener("load", () => setTimeout(() => window.print(), 250));</script>` : ""}
  `, { noIndex: true, description: copy.intro });
};

const adminLayout = (ctx: RequestContext, title: string, content: string) => page(title, `
  <div class="admin-shell">
    <aside class="admin-side">
      <h2 style="font-size:24px;">Центр управления</h2>
      <a href="/admin">Обзор</a>
      <a href="/admin/leads">Заявки</a>
      <a href="/admin/proposals">Коммерческие предложения</a>
      <a href="/admin/calculator">Калькулятор</a>
      <a href="/admin/packages">Пакеты</a>
      <a href="/admin/catalog">Каталог</a>
      <a href="/admin/bot-updates">Обновления из бота</a>
      <a href="/admin/bitrix24">Bitrix24</a>
      <a href="/">Настройки сайта</a>
    </aside>
    <main class="admin-main">${content}</main>
  </div>
`, { admin: true });

const getAdmin = (request: http.IncomingMessage): Row | null => {
  const token = parseCookies(request).admin_session;
  if (!token) return null;
  return statementGet(`SELECT * FROM "AdminAccount" WHERE "sessionToken" = ?`, token) ?? null;
};

const requireAdmin = (ctx: RequestContext): boolean => {
  ctx.admin ??= { id: 0, email: "demo@binova.local", name: "Demo Admin", role: "DEMO" };
  return true;
};

const adminDashboard = (ctx: RequestContext) => {
  if (!requireAdmin(ctx)) return "";
  const leads = statementGet(`SELECT COUNT(*) as count FROM "ClientLead"`)?.count ?? 0;
  const newLeads = statementGet(`SELECT COUNT(*) as count FROM "ClientLead" WHERE "status" = 'NEW'`)?.count ?? 0;
  const proposals = statementGet(`SELECT COUNT(*) as count FROM "CommercialProposal"`)?.count ?? 0;
  const catalogUpdates = (() => {
    try {
      return statementGet(`SELECT COUNT(*) as count FROM "ProductSubmission" WHERE "status" IN ('SUBMITTED', 'RESUBMITTED', 'CHANGES_REQUESTED')`)?.count ?? 0;
    } catch {
      return 0;
    }
  })();
  const proposalsInWork = Math.max(0, Number(leads) - Number(newLeads) - Number(proposals));
  return adminLayout(ctx, "Dashboard", `
    <section class="feature-band" style="margin-bottom:24px;">
      <div class="section-head" style="border:0; padding:0; margin:0; align-items:flex-start;">
        <div>
          <p class="eyebrow">Admin dashboard</p>
          <h1 style="color:#fff; font-size:54px;">Центр коммерческого управления</h1>
          <p>Заявки, калькулятор, каталог, пакеты, Bitrix24 и коммерческие предложения в одной рабочей панели.</p>
        </div>
        <a class="btn" href="/admin/leads">Открыть новые заявки</a>
      </div>
    </section>
    <section class="metric-row" style="margin-top:24px;">
      <div class="metric"><span>Новые заявки</span><b>${newLeads}</b><small>Запросы, которые ещё не обработаны.</small></div>
      <div class="metric"><span>КП в работе</span><b>${proposalsInWork}</b><small>Предложения, которые готовятся менеджером.</small></div>
      <div class="metric"><span>Готовые КП</span><b>${proposals}</b><small>Предложения, готовые к отправке клиенту.</small></div>
      <div class="metric"><span>Обновления каталога</span><b>${catalogUpdates}</b><small>Позиции из бота, ожидающие проверки.</small></div>
    </section>
    <section class="band">
      <div class="grid-3">
        <div class="card"><div class="card-body"><span class="badge">Заявки</span><h3>Входящие заявки</h3><p>Все запросы с сайта по Office, HoReCa и Retail попадают сюда со статусом, сегментом и выбранными сервисами.</p><a class="btn" href="/admin/leads">Открыть заявки</a></div></div>
        <div class="card"><div class="card-body"><span class="badge">Расчёт</span><h3>Калькулятор предложений</h3><p>Настройте правила расчёта: базовые цены, пакеты, сервисные слои и коэффициенты по сегментам.</p><a class="btn" href="/admin/calculator">Настроить расчёт</a></div></div>
        <div class="card"><div class="card-body"><span class="badge">Пакеты</span><h3>Пакеты услуг</h3><p>Собирайте стартовые решения для Office, HoReCa и Retail: что входит, для кого подходит и как считается.</p><a class="btn" href="/admin/packages">Управлять пакетами</a></div></div>
        <div class="card"><div class="card-body"><span class="badge">Каталог</span><h3>Каталог продуктов и сервисов</h3><p>Управляйте кофе, оборудованием, расходниками, сервисами и товарами, которые используются в предложениях.</p><a class="btn" href="/admin/catalog">Открыть каталог</a></div></div>
        <div class="card"><div class="card-body"><span class="badge">КП</span><h3>Коммерческие предложения</h3><p>Собирайте КП из заявки, выбранных пакетов, товаров и сервисов. Готовьте версию для отправки клиенту.</p><a class="btn" href="/admin/proposals">Собрать КП</a></div></div>
        <div class="card"><div class="card-body"><span class="badge">CRM</span><h3>Bitrix24 интеграция</h3><p>Передавайте заявки с сайта в Bitrix24 как лиды или сделки с сегментом, услугами, бюджетом и ответственным менеджером.</p><a class="btn" href="/admin/bitrix24">Настроить интеграцию</a></div></div>
      </div>
    </section>
  `);
};

const adminLeads = (ctx: RequestContext) => {
  if (!requireAdmin(ctx)) return "";
  const leads = statementAll(`SELECT * FROM "ClientLead" ORDER BY "createdAt" DESC`);
  const statusLabel = (status: string) => ({
    NEW: "Новая",
    IN_PROGRESS: "В обработке",
    PROPOSAL_DRAFT: "КП готовится",
    PROPOSAL_SENT: "КП отправлено",
    WON: "Выиграна",
    LOST: "Потеряна"
  }[status] ?? status);
  return adminLayout(ctx, "Leads", `
    <div class="section-head">
      <div><p class="eyebrow">Входящие заявки</p><h1 style="color:var(--ink); font-size:52px;">Заявки</h1></div>
      <a class="btn" href="/admin/proposals">Создать КП</a>
    </div>
    <table class="table">
      <thead><tr><th>ID</th><th>Клиент</th><th>Сегмент и параметры</th><th>Выбранные сервисы</th><th>Статус</th><th>Действия</th></tr></thead>
      <tbody>
        ${leads.map((lead) => `
          <tr>
            <td>#${lead.id}<br><span class="badge new">${escapeHtml(statusLabel(lead.status))}</span><br>${formatDate(lead.createdAt)}</td>
            <td><b>${escapeHtml(lead.companyName)}</b><br>${escapeHtml(lead.contactName)}<br>${escapeHtml(lead.email)}<br>${escapeHtml(lead.phone)}</td>
            <td>${escapeHtml(slugLabel(lead.segment))}<br>${escapeHtml(lead.companySize)} · ${lead.employeeCount} people · ${lead.locationsCount} loc.</td>
            <td>${escapeHtml(String(lead.services).split(",").join(", "))}<br><span style="color:var(--muted);">${escapeHtml(lead.message)}</span></td>
            <td><b>${money(lead.estimatedMonthlyPrice)}</b><br><a href="/admin/proposals?leadId=${lead.id}">Create proposal</a></td>
            <td>${formatDate(lead.createdAt)}</td>
          </tr>
        `).join("") || `<tr><td colspan="6">No leads yet.</td></tr>`}
      </tbody>
    </table>
  `);
};

const adminLeadsEnhanced = (ctx: RequestContext) => {
  if (!requireAdmin(ctx)) return "";
  const leads = statementAll(`SELECT * FROM "ClientLead" ORDER BY "createdAt" DESC`);
  const statusLabel = (status: string) => ({
    NEW: "Новая",
    IN_PROGRESS: "В обработке",
    PROPOSAL_DRAFT: "КП готовится",
    PROPOSAL_SENT: "КП отправлено",
    WON: "Выиграна",
    LOST: "Потеряна"
  }[status] ?? status);

  return adminLayout(ctx, "Leads", `
    <div class="section-head">
      <div><p class="eyebrow">Входящие заявки</p><h1 style="color:var(--ink); font-size:52px;">Заявки</h1></div>
      <a class="btn" href="/admin/proposals">Создать КП</a>
    </div>
    <table class="table">
      <thead><tr><th>ID</th><th>Клиент</th><th>Сегмент и параметры</th><th>Выбранные сервисы</th><th>Статус</th><th>Действия</th></tr></thead>
      <tbody>
        ${leads.map((lead) => `
          <tr>
            <td>#${lead.id}<br><span class="badge new">${escapeHtml(statusLabel(lead.status))}</span><br>${formatDate(lead.createdAt)}</td>
            <td><b>${escapeHtml(lead.companyName)}</b><br>${escapeHtml(lead.contactName)}<br>${escapeHtml(lead.email)}<br>${escapeHtml(lead.phone)}</td>
            <td><b>${escapeHtml(slugLabel(lead.segment))}</b><br>${escapeHtml(lead.businessFormat || lead.companySize)}<br>${lead.employeesCount ?? lead.employeeCount} / ${lead.locationsCount} локац.<br><span style="color:var(--muted);">Ответственный: ${escapeHtml(lead.assignedManager || "не назначен")}</span></td>
            <td>${escapeHtml(String(lead.selectedServices || lead.services).split(",").filter(Boolean).join(", "))}<br><span style="color:var(--muted);">${escapeHtml(lead.additionalDetails || lead.message)}</span></td>
            <td><b>${money(lead.estimatedDealValue ?? lead.estimatedMonthlyPrice)}</b><br><span style="color:var(--muted);">Bitrix24: не отправлено</span></td>
            <td><a href="/admin/proposals?leadId=${lead.id}">Создать КП</a><br><a href="/admin/bitrix24">Отправить в Bitrix24</a></td>
          </tr>
        `).join("") || `<tr><td colspan="6">Заявок пока нет.</td></tr>`}
      </tbody>
    </table>
  `);
};

const adminCatalog = (ctx: RequestContext) => {
  if (!requireAdmin(ctx)) return "";
  const defaults = [
    { id: "cat-horeca-espresso", source: "manual", status: "active", segment: "horeca", category: "Coffee", name: "HoReCa Signature Espresso Beans", shortDescription: "Кофейные зёрна для ресторанов, кафе и отелей, рассчитанные на стабильный вкус и интенсивную ежедневную работу.", fullDescription: "Стабильный espresso blend для интенсивной HoReCa эксплуатации.", price: 31, priceUnit: "EUR/kg", availability: "in_stock", imageUrl: "https://images.unsplash.com/photo-1447933601403-0c6688de566e?auto=format&fit=crop&w=900&q=82", tags: ["espresso", "horeca"], updatedAt: new Date().toISOString() },
    { id: "cat-barista-training", source: "manual", status: "active", segment: "horeca", category: "Training", name: "Barista Launch Training", shortDescription: "Стартовое обучение команды для стабильного качества напитков, настройки оборудования и повторяемого сервиса.", fullDescription: "Обучение команды перед запуском или обновлением кофейной зоны.", price: 260, priceUnit: "EUR/session", availability: "on_request", imageUrl: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=900&q=82", tags: ["training", "barista"], updatedAt: new Date().toISOString() },
    { id: "cat-office-machine", source: "manual", status: "active", segment: "office", category: "Equipment", name: "Office Coffee Machine", shortDescription: "Кофемашина для офиса с установкой, настройкой и плановым обслуживанием.", fullDescription: "Офисное оборудование под размер команды и регулярное потребление.", price: 120, priceUnit: "EUR/mo", availability: "on_request", imageUrl: "https://images.unsplash.com/photo-1517668808822-9ebb02f2a0e6?auto=format&fit=crop&w=900&q=82", tags: ["machine", "office"], updatedAt: new Date().toISOString() },
    { id: "cat-office-consumables", source: "manual", status: "active", segment: "office", category: "Consumables", name: "Office Consumables Pack", shortDescription: "Стаканы, сахар, мешалки, салфетки и другие позиции для ежедневного офисного потребления.", fullDescription: "Регулярно пополняемый набор расходников для кухни и переговорных.", price: 45, priceUnit: "EUR/mo", availability: "in_stock", imageUrl: "https://images.unsplash.com/photo-1522992319-0365e5f11656?auto=format&fit=crop&w=900&q=82", tags: ["office", "consumables"], updatedAt: new Date().toISOString() },
    { id: "cat-retail-corner", source: "manual", status: "active", segment: "retail", category: "Equipment", name: "Self-Service Coffee Corner Kit", shortDescription: "Готовое решение для магазинов, АЗС и локаций с трафиком: оборудование, напитки, расходники и пополнение.", fullDescription: "Self-service кофейная точка для дополнительной продажи в retail.", price: null, priceUnit: "custom", availability: "on_request", imageUrl: "https://images.unsplash.com/photo-1604719312566-8912e9227c6a?auto=format&fit=crop&w=900&q=82", tags: ["retail", "self-service"], updatedAt: new Date().toISOString() },
    { id: "bot-tea-selection", source: "telegram_bot", status: "pending_review", segment: "office", category: "Consumables", name: "Premium Tea Selection", shortDescription: "Чайный набор для офисов и переговорных комнат.", fullDescription: "Отправлено сотрудником через Telegram-бот.", price: 18, priceUnit: "EUR/box", availability: "in_stock", imageUrl: "https://images.unsplash.com/photo-1544787219-7f47ccb76574?auto=format&fit=crop&w=900&q=82", tags: ["tea", "office"], submittedBy: "Maria", submittedAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: "bot-retail-cups", source: "telegram_bot", status: "pending_review", segment: "retail", category: "Consumables", name: "Retail Cups & Lids Pack", shortDescription: "Стаканы и крышки для ежедневной продажи напитков в retail-точках.", fullDescription: "Отправлено сотрудником через Telegram-бот.", price: 0.08, priceUnit: "EUR/unit", availability: "in_stock", imageUrl: "https://images.unsplash.com/photo-1522992319-0365e5f11656?auto=format&fit=crop&w=900&q=82", tags: ["cups", "retail"], submittedBy: "Andrei", submittedAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: "bot-urgent-service", source: "telegram_bot", status: "needs_changes", segment: "horeca", category: "Service", name: "Urgent Machine Service", shortDescription: "Срочный сервис кофейного оборудования для HoReCa.", fullDescription: "Нужно уточнить SLA и условия выезда.", price: null, priceUnit: "custom", availability: "on_request", imageUrl: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=900&q=82", tags: ["service", "horeca"], submittedBy: "Service team", submittedAt: new Date().toISOString(), adminComment: "Уточнить SLA и условия выезда.", updatedAt: new Date().toISOString() }
  ];
  return adminLayout(ctx, "Catalog", `
    <div class="section-head">
      <div><p class="eyebrow">Catalog management</p><h1 style="color:var(--ink); font-size:52px;">Каталог продуктов и сервисов</h1><p>Управляйте кофе, оборудованием, расходниками и сервисами, которые используются на сайте, в пакетах, заявках и коммерческих предложениях.</p></div>
      <div class="builder-actions"><button type="button" id="catNew">+ Добавить позицию</button><button type="button" class="ghost" id="openModeration">Открыть модерацию</button></div>
    </div>
    <section class="metric-row"><div class="metric"><span>Активные позиции</span><b id="metricActive">0</b></div><div class="metric"><span>На модерации из бота</span><b id="metricPending">0</b></div><div class="metric"><span>Черновики</span><b id="metricDraft">0</b></div><div class="metric"><span>Требуют обновления</span><b id="metricNeeds">0</b></div></section>
    <section class="band" style="padding-bottom:28px;"><div class="card card-body"><div class="section-head" style="margin:0;"><div><h3>Обновления из Telegram-бота</h3><p>Сотрудники могут отправлять новые продукты и обновления через Telegram. Все отправленные карточки попадают сюда на проверку перед публикацией в каталог.</p></div><span class="badge hot">На модерации: <b id="botCounter">0</b></span></div></div></section>
    <div class="package-toolbar" id="catTabs"><button type="button" class="segment-tab active" data-tab="all">Все позиции</button><button type="button" class="segment-tab" data-tab="pending_review">На модерации</button><button type="button" class="segment-tab" data-tab="active">Активные</button><button type="button" class="segment-tab" data-tab="draft">Черновики</button><button type="button" class="segment-tab" data-tab="archived">Архив</button><button type="button" class="segment-tab" data-tab="telegram_bot">Из Telegram-бота</button></div>
    <div class="card card-body" style="margin-bottom:16px;"><div class="builder-grid"><label>Сегмент<select id="filterSegment"><option value="all">All</option><option value="office">Office</option><option value="horeca">HoReCa</option><option value="retail">Retail</option></select></label><label>Категория<select id="filterCategory"><option value="all">All</option><option>Coffee</option><option>Equipment</option><option>Consumables</option><option>Service</option><option>Training</option><option>Water</option><option>Cleaning</option><option>Retail POS</option><option>Other</option></select></label><label>Источник<select id="filterSource"><option value="all">All</option><option value="manual">Manual</option><option value="telegram_bot">Telegram bot</option><option value="imported">Imported</option></select></label><label>Поиск<input id="filterSearch" placeholder="Search by name"></label></div></div>
    <div class="package-builder"><section class="package-list" id="catList"></section><aside class="card card-body" id="catEditor"></aside></div>
    <script>
      (() => {
        const defaults = ${JSON.stringify(defaults)};
        const key = "binova_catalog_items_v1";
        let items = JSON.parse(localStorage.getItem(key) || "null") || defaults;
        let selectedId = items[0]?.id || "";
        let tab = "all";
        const q = (id) => document.getElementById(id);
        const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
        const labels = { active:"Активен", draft:"Черновик", pending_review:"На модерации", rejected:"Отклонён", archived:"Архив", needs_changes:"На доработку", manual:"Manual", telegram_bot:"Из Telegram-бота", imported:"Imported", in_stock:"In stock", limited:"Limited", on_request:"On request", unavailable:"Unavailable", office:"Office", horeca:"HoReCa", retail:"Retail", all:"All" };
        const save = () => localStorage.setItem(key, JSON.stringify(items));
        const price = (item) => item.price === null || item.price === undefined || item.priceUnit === "custom" ? "Custom" : Number(item.price).toLocaleString("en-US") + " " + item.priceUnit;
        const current = () => items.find((item) => item.id === selectedId) || null;
        const filtered = () => items.filter((item) => {
          const search = q("filterSearch").value.toLowerCase();
          if (tab !== "all" && tab !== item.status && tab !== item.source) return false;
          if (q("filterSegment").value !== "all" && item.segment !== q("filterSegment").value) return false;
          if (q("filterCategory").value !== "all" && item.category !== q("filterCategory").value) return false;
          if (q("filterSource").value !== "all" && item.source !== q("filterSource").value) return false;
          return !search || item.name.toLowerCase().includes(search);
        });
        const metrics = () => { q("metricActive").textContent = items.filter((i) => i.status === "active").length; q("metricPending").textContent = items.filter((i) => i.source === "telegram_bot" && i.status === "pending_review").length; q("metricDraft").textContent = items.filter((i) => i.status === "draft").length; q("metricNeeds").textContent = items.filter((i) => i.status === "needs_changes").length; q("botCounter").textContent = items.filter((i) => i.source === "telegram_bot" && i.status === "pending_review").length; };
        const renderList = () => {
          const data = filtered();
          q("catList").innerHTML = data.length ? data.map((item) => '<button type="button" class="package-card '+(item.id===selectedId?'active':'')+'" data-id="'+item.id+'"><div class="package-meta"><span class="badge">'+esc(labels[item.segment])+'</span><span class="badge">'+esc(item.category)+'</span><span class="badge hot">'+esc(labels[item.status])+'</span><span class="badge">'+esc(labels[item.source])+'</span></div>'+(item.imageUrl?'<img class="tile-image" style="margin:12px 0;border-radius:8px;" src="'+esc(item.imageUrl)+'" alt="'+esc(item.name)+'">':'')+'<h3>'+esc(item.name)+'</h3><p>'+esc(item.shortDescription)+'</p><p><b>'+esc(price(item))+'</b> · '+esc(labels[item.availability])+'</p><small>Обновлено: '+new Date(item.updatedAt).toLocaleDateString("ru-RU")+'</small><div class="builder-actions" style="margin-top:12px;"><span class="btn ghost">Edit</span><span class="btn ghost">Use in package</span></div></button>').join("") : '<div class="empty-state"><h3>'+(tab==="telegram_bot"||tab==="pending_review"?"Нет новых отправок из бота":"Каталог пока пуст")+'</h3><p>'+(tab==="telegram_bot"||tab==="pending_review"?"Когда сотрудник отправит продукт через Telegram-бот, он появится здесь на проверку.":"Добавьте позицию вручную или примите первую отправку из Telegram-бота.")+'</p></div>';
          q("catList").querySelectorAll("[data-id]").forEach((node) => node.addEventListener("click", () => { selectedId = node.getAttribute("data-id"); render(); }));
        };
        const renderEditor = () => {
          const item = current();
          if (!item) { q("catEditor").innerHTML = '<div class="empty-state">Выберите позицию для редактирования или создайте новую.</div>'; return; }
          q("catEditor").innerHTML = '<p class="eyebrow">Редактор позиции</p><h3>'+esc(item.name||"Новая позиция")+'</h3><form id="catForm"><div class="builder-grid"><label>Название<input id="editName" value="'+esc(item.name)+'"></label><label>Сегмент<select id="editSegment"><option value="office">Office</option><option value="horeca">HoReCa</option><option value="retail">Retail</option><option value="all">All</option></select></label></div><div class="builder-grid"><label>Категория<select id="editCategory"><option>Coffee</option><option>Equipment</option><option>Consumables</option><option>Service</option><option>Training</option><option>Water</option><option>Cleaning</option><option>Retail POS</option><option>Other</option></select></label><label>Статус<select id="editStatus"><option value="draft">Draft</option><option value="pending_review">Pending review</option><option value="active">Active</option><option value="rejected">Rejected</option><option value="archived">Archived</option><option value="needs_changes">Needs changes</option></select></label></div><label>Краткое описание<textarea id="editShort">'+esc(item.shortDescription)+'</textarea></label><label>Полное описание<textarea id="editFull">'+esc(item.fullDescription||"")+'</textarea></label><div class="builder-grid"><label>Цена<input id="editPrice" type="number" step="0.01" value="'+esc(item.price??"")+'"></label><label>Единица цены<select id="editUnit"><option>EUR/mo</option><option>EUR/unit</option><option>EUR/kg</option><option>EUR/session</option><option>EUR/box</option><option>custom</option></select></label></div><div class="builder-grid"><label>Доступность<select id="editAvailability"><option value="in_stock">In stock</option><option value="limited">Limited</option><option value="on_request">On request</option><option value="unavailable">Unavailable</option></select></label><label>Источник<select id="editSource"><option value="manual">Manual</option><option value="telegram_bot">Telegram bot</option><option value="imported">Imported</option></select></label></div><label>Теги<input id="editTags" value="'+esc((item.tags||[]).join(", "))+'"></label><label>Изображение<input id="editImage" value="'+esc(item.imageUrl||"")+'"></label>'+(item.source==="telegram_bot"?'<p><b>Submitted by:</b> '+esc(item.submittedBy||"-")+'</p><label>Комментарий администратора<textarea id="editComment">'+esc(item.adminComment||item.rejectionReason||"")+'</textarea></label>':'<input type="hidden" id="editComment" value="">')+'<div class="builder-actions"><button type="submit">Сохранить</button><button type="button" id="publishItem" class="ghost">Опубликовать</button><button type="button" id="archiveItem" class="ghost">В архив</button><button type="button" id="deleteItem" class="danger">Удалить</button></div>'+(item.source==="telegram_bot"&&item.status==="pending_review"?'<div class="builder-actions"><button type="button" id="approveBot">Одобрить</button><button type="button" id="changesBot" class="ghost">Вернуть на доработку</button><button type="button" id="rejectBot" class="danger">Отклонить</button></div>':'')+'</form>';
          q("editSegment").value=item.segment; q("editCategory").value=item.category; q("editStatus").value=item.status; q("editUnit").value=item.priceUnit||"custom"; q("editAvailability").value=item.availability; q("editSource").value=item.source;
          q("catForm").addEventListener("submit",(e)=>{e.preventDefault(); Object.assign(item,{name:q("editName").value.trim(),segment:q("editSegment").value,category:q("editCategory").value,status:q("editStatus").value,shortDescription:q("editShort").value.trim(),fullDescription:q("editFull").value.trim(),price:q("editUnit").value==="custom"?null:Number(q("editPrice").value||0),priceUnit:q("editUnit").value,availability:q("editAvailability").value,source:q("editSource").value,tags:q("editTags").value.split(",").map(t=>t.trim()).filter(Boolean),imageUrl:q("editImage").value.trim(),adminComment:q("editComment").value.trim(),updatedAt:new Date().toISOString()}); save(); render();});
          q("publishItem").addEventListener("click",()=>{item.status="active";item.updatedAt=new Date().toISOString();save();render();});
          q("archiveItem").addEventListener("click",()=>{item.status="archived";item.updatedAt=new Date().toISOString();save();render();});
          q("deleteItem").addEventListener("click",()=>{if(!confirm("Удалить позицию "+item.name+"?"))return;items=items.filter(e=>e.id!==item.id);selectedId=items[0]?.id||"";save();render();});
          q("approveBot")?.addEventListener("click",()=>{item.status="active";item.reviewedBy="Admin";item.reviewedAt=new Date().toISOString();item.updatedAt=new Date().toISOString();save();render();});
          q("changesBot")?.addEventListener("click",()=>{const c=prompt("Комментарий для сотрудника",item.adminComment||"");if(c===null)return;item.status="needs_changes";item.adminComment=c;item.updatedAt=new Date().toISOString();save();render();});
          q("rejectBot")?.addEventListener("click",()=>{const r=prompt("Причина отклонения");if(!r)return;item.status="rejected";item.rejectionReason=r;item.updatedAt=new Date().toISOString();save();render();});
        };
        const render = () => { metrics(); renderList(); renderEditor(); };
        q("catNew").addEventListener("click",()=>{const item={id:"cat-"+Date.now(),source:"manual",status:"draft",segment:"office",category:"Coffee",name:"Новая позиция",shortDescription:"",fullDescription:"",price:null,priceUnit:"custom",availability:"on_request",imageUrl:"",tags:[],updatedAt:new Date().toISOString()};items.unshift(item);selectedId=item.id;save();render();});
        q("openModeration").addEventListener("click",()=>{tab="pending_review";q("catTabs").querySelectorAll("[data-tab]").forEach(n=>n.classList.toggle("active",n.getAttribute("data-tab")===tab));render();});
        q("catTabs").querySelectorAll("[data-tab]").forEach((b)=>b.addEventListener("click",()=>{tab=b.getAttribute("data-tab");q("catTabs").querySelectorAll("[data-tab]").forEach(n=>n.classList.toggle("active",n===b));render();}));
        ["filterSegment","filterCategory","filterSource","filterSearch"].forEach((id)=>q(id).addEventListener("input",render));
        render();
      })();
    </script>
  `);
};

const adminProposals = (ctx: RequestContext) => {
  if (!requireAdmin(ctx)) return "";
  const leads = statementAll(`SELECT * FROM "ClientLead" ORDER BY "createdAt" DESC`);
  const packages = activePackages();
  const items = catalogItems();
  const proposals = statementAll(`SELECT * FROM "CommercialProposal" ORDER BY "createdAt" DESC`);
  const selectedLeadId = Number(ctx.url.searchParams.get("leadId") ?? leads[0]?.id ?? 0);
  const selectedLead = leads.find((lead) => Number(lead.id) === selectedLeadId);
  const selectedBreakdown = selectedLead?.priceBreakdown ? (() => {
    try {
      return JSON.parse(String(selectedLead.priceBreakdown)) as string[];
    } catch {
      return [];
    }
  })() : [];

  return adminLayout(ctx, "Commercial proposals", `
    <div class="section-head"><div><p class="eyebrow">Offer desk</p><h1 style="color:var(--ink); font-size:52px;">Commercial proposals</h1></div></div>
    <div class="grid-2">
      <form method="post" action="/admin/proposals" class="card card-body">
        <label>Lead
          <select name="leadId">
            ${leads.map((lead) => `<option value="${lead.id}" ${lead.id === selectedLeadId ? "selected" : ""}>#${lead.id} ${escapeHtml(lead.companyName)} · ${escapeHtml(slugLabel(lead.segment))}</option>`).join("")}
          </select>
        </label>
        <label>Proposal title<input required name="title" value="Binova operating beverage system proposal"></label>
        <label>Packages</label>
        <div class="check-grid">
          ${packages.map((pkg) => `<label class="check"><input type="checkbox" name="packageIds" value="${pkg.id}"> ${escapeHtml(pkg.name)} · ${money(pkg.monthlyPrice)}</label>`).join("")}
        </div>
        <label>Catalog items</label>
        <div class="check-grid">
          ${items.map((item) => `<label class="check"><input type="checkbox" name="catalogItemIds" value="${item.id}"> ${escapeHtml(item.name)} · ${money(item.unitPrice)}</label>`).join("")}
        </div>
        <label>Discount percent<input type="number" min="0" max="60" name="discountPercent" value="0"></label>
        ${selectedLead ? `<div class="empty-state"><h3>Расчёт из заявки</h3><p><b>${money(selectedLead.estimatedDealValue ?? selectedLead.estimatedMonthlyPrice)}</b> monthly · setup ${Number(selectedLead.setupFee ?? 0).toLocaleString("en-US")} EUR · yearly ${Number(selectedLead.yearlyValue ?? 0).toLocaleString("en-US")} EUR</p><p>Rule: ${escapeHtml(selectedLead.pricingRuleId || "server estimate")}</p>${selectedBreakdown.length ? `<ul>${selectedBreakdown.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` : ""}</div>` : ""}
        <label>Commercial notes<textarea name="notes" placeholder="Delivery rhythm, service SLA, equipment replacement, next step...">${selectedLead ? `Calculated monthly: ${money(selectedLead.estimatedDealValue ?? selectedLead.estimatedMonthlyPrice)}. Setup fee: ${Number(selectedLead.setupFee ?? 0).toLocaleString("en-US")} EUR. Yearly value: ${Number(selectedLead.yearlyValue ?? 0).toLocaleString("en-US")} EUR.` : ""}</textarea></label>
        <button>Create commercial proposal</button>
      </form>
      <div>
        ${proposals.map((proposal) => `
          <article class="card" style="margin-bottom:12px;">
            <div class="card-body">
              <span class="badge">${escapeHtml(slugLabel(proposal.segment))}</span>
              <h3>${escapeHtml(proposal.title)}</h3>
              <p>${escapeHtml(proposal.clientName)}</p>
              <p><b>${money(proposal.total)}</b> after ${proposal.discountPercent}% discount</p>
              <a class="btn" href="/proposal/${proposal.publicToken}" target="_blank">Open proposal</a>
            </div>
          </article>
        `).join("") || `<div class="card"><div class="card-body"><h3>No proposals yet</h3><p>Create one from a lead.</p></div></div>`}
      </div>
    </div>
  `);
};

const adminCalculator = (ctx: RequestContext) => {
  if (!requireAdmin(ctx)) return "";
  return adminLayout(ctx, "Calculator", `
    <div class="section-head">
      <div>
        <p class="eyebrow" data-calc-i18n="pricingEngine">PRICING ENGINE</p>
        <h1 style="color:var(--ink); font-size:52px;" data-calc-i18n="title">Калькулятор предложений</h1>
        <p data-calc-i18n="subtitle">Настраивайте правила расчёта для Office, HoReCa и Retail: базовая цена, размер клиента, локации, сервисные слои, скидки и доплаты.</p>
      </div>
      <div class="builder-actions">
        <button type="button" id="calcNew" data-calc-i18n="newRule">+ Новое правило</button>
        <button type="button" id="calcExport" class="ghost" data-calc-i18n="exportRules">Экспорт правил</button>
        <button type="button" id="calcReset" class="ghost" data-calc-i18n="resetDemo">Сбросить демо-данные</button>
      </div>
    </div>
    <div class="package-builder pricing-engine">
      <section class="builder-panel">
        <form class="card card-body" id="calcForm">
          <input type="hidden" id="calcId">
          <div class="builder-grid">
            <label><span data-calc-i18n="status">Статус</span><select id="calcStatus"><option value="active">Active</option><option value="draft">Draft</option><option value="archived">Archived</option></select></label>
            <label><span data-calc-i18n="segment">Сегмент</span><select id="calcSegment"><option value="office">Office</option><option value="horeca">HoReCa</option><option value="retail">Retail</option><option value="all">All segments</option></select></label>
            <label><span data-calc-i18n="clientSize">Размер клиента</span><select id="calcSize"><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option><option value="custom">Custom</option></select></label>
            <label><span data-calc-i18n="ruleName">Название правила</span><input id="calcName" placeholder="Office Small Monthly Package"></label>
          </div>
          <div class="builder-grid">
            <label><span data-calc-i18n="baseMonthly">Базовая цена в месяц EUR</span><input id="calcBase" type="number" min="0" value="790"></label>
            <label><span data-calc-i18n="minMonthly">Минимальная цена в месяц EUR</span><input id="calcMin" type="number" min="0" value="790"></label>
            <label><span data-calc-i18n="setupFee">Разовый setup fee EUR</span><input id="calcSetup" type="number" min="0" value="180"></label>
            <label><span data-calc-i18n="perEmployee">Цена за сотрудника EUR</span><input id="calcEmployee" type="number" min="0" step="0.01" value="6"></label>
            <label><span data-calc-i18n="perLocation">Цена за локацию EUR</span><input id="calcLocation" type="number" min="0" step="0.01" value="150"></label>
            <label><span data-calc-i18n="billingModel">Модель оплаты</span><select id="calcBilling"><option value="monthly">Monthly</option><option value="one_time">One-time</option><option value="custom_quote">Custom quote</option><option value="from_price">From price</option></select></label>
            <label><span data-calc-i18n="deliveryFrequency">Частота поставок</span><select id="calcDelivery"><option value="weekly">Weekly</option><option value="twice_month">Twice per month</option><option value="monthly">Monthly</option><option value="custom">Custom</option></select></label>
            <label><span data-calc-i18n="serviceLevel">Уровень сервиса</span><select id="calcServiceLevel"><option value="standard">Standard</option><option value="priority">Priority</option><option value="urgent">Urgent</option><option value="custom">Custom</option></select></label>
            <label><span data-calc-i18n="serviceMultiplier">Множитель сервиса</span><input id="calcServiceMultiplier" type="number" min="0" step="0.01" value="1"></label>
            <label><span data-calc-i18n="packageMultiplier">Множитель пакета</span><input id="calcPackageMultiplier" type="number" min="0" step="0.01" value="1"></label>
          </div>
          <div class="builder-grid">
            <label><span data-calc-i18n="discount">Скидка</span><select id="calcDiscountType"><option value="none">none</option><option value="fixed">fixed EUR</option><option value="percent">percentage</option></select></label>
            <label><span data-calc-i18n="discountValue">Значение скидки</span><input id="calcDiscountValue" type="number" min="0" step="0.01" value="0"></label>
            <label><span data-calc-i18n="markup">Наценка</span><select id="calcMarkupType"><option value="none">none</option><option value="fixed">fixed EUR</option><option value="percent">percentage</option></select></label>
            <label><span data-calc-i18n="markupValue">Значение наценки</span><input id="calcMarkupValue" type="number" min="0" step="0.01" value="0"></label>
          </div>
          <label><span data-calc-i18n="internalNote">Внутренняя заметка</span><textarea id="calcNotes" placeholder="Internal note explaining when this rule should be used."></textarea></label>
          <div class="builder-actions">
            <button type="submit" data-calc-i18n="saveRule">Сохранить правило</button>
            <button type="button" id="calcDuplicate" class="ghost" data-calc-i18n="duplicate">Дублировать</button>
            <button type="button" id="calcArchive" class="ghost" data-calc-i18n="archive">Архивировать</button>
            <button type="button" id="calcDelete" class="danger" data-calc-i18n="delete">Удалить</button>
          </div>
          <div class="builder-error" id="calcError"></div>
        </form>
        <section class="card card-body">
          <div class="section-head" style="margin-bottom:12px;">
            <div><p class="eyebrow" data-calc-i18n="serviceLayers">Сервисные слои</p><h3 data-calc-i18n="serviceLayerPrices">Цены по сервисным слоям</h3></div>
            <button type="button" id="layerAdd" class="ghost" data-calc-i18n="addLayer">Добавить сервисный слой</button>
          </div>
          <div class="layer-list" id="layerEditor"></div>
        </section>
      </section>
      <aside class="package-preview calc-preview">
        <p class="eyebrow" data-calc-i18n="livePreview">Предпросмотр расчёта</p>
        <div class="builder-grid">
          <label><span data-calc-i18n="employeesCount">Сотрудники</span><input id="simEmployees" type="number" min="0" value="25"></label>
          <label><span data-calc-i18n="locationsCount">Локации</span><input id="simLocations" type="number" min="1" value="1"></label>
          <label><span data-calc-i18n="selectedPackage">Выбранный пакет</span><select id="simPackage"><option value="starter">Starter</option><option value="complex">Complex package</option><option value="lean">Lean starter</option></select></label>
          <label><span data-calc-i18n="simServiceLevel">Уровень сервиса</span><select id="simServiceLevel"><option value="standard">Standard</option><option value="priority">Priority</option><option value="urgent">Urgent</option></select></label>
        </div>
        <div id="simLayers" class="sim-layer-list"></div>
        <button type="button" id="calcRun" data-calc-i18n="calculateExample">Рассчитать пример</button>
        <div id="calcResult" class="calc-result"></div>
      </aside>
    </div>
    <section class="band">
      <div class="section-head">
        <div><p class="eyebrow" data-calc-i18n="rulesTable">Таблица правил</p><h2 data-calc-i18n="savedRules">Сохранённые правила</h2></div>
        <p data-calc-i18n="rulesHint">Фильтруйте правила, открывайте строку для редактирования, дублируйте или архивируйте устаревшую логику.</p>
      </div>
      <div class="package-toolbar calc-filters">
        <select id="filterSegment"><option value="all">All segments</option><option value="office">Office</option><option value="horeca">HoReCa</option><option value="retail">Retail</option></select>
        <select id="filterStatus"><option value="all">All statuses</option><option value="active">Active</option><option value="draft">Draft</option><option value="archived">Archived</option></select>
        <select id="filterSize"><option value="all">All sizes</option><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option><option value="custom">Custom</option></select>
        <select id="filterBilling"><option value="all">All billing models</option><option value="monthly">Monthly</option><option value="one_time">One-time</option><option value="custom_quote">Custom quote</option><option value="from_price">From price</option></select>
        <input id="filterSearch" placeholder="Search">
      </div>
      <div class="table-wrap"><table class="table" id="rulesTable"></table></div>
    </section>
    <section class="band grid-2">
      <div class="card"><div class="card-body">
        <span class="badge">Offer Builder</span>
        <h3 data-calc-i18n="offerBuilderLink">Связь с заявками и КП</h3>
        <p data-calc-i18n="offerBuilderText">Публичная форма читает эти правила в браузере, считает предварительную цену и сохраняет breakdown в заявку. При создании КП менеджер видит расчёт как стартовую точку и может вручную скорректировать финальную цену.</p>
      </div></div>
      <div class="card"><div class="card-body">
        <span class="badge">Bitrix24</span>
        <h3 data-calc-i18n="bitrixPayload">Поля для CRM</h3>
        <p>estimatedMonthlyPrice, setupFee, yearlyValue, segment, clientSize, employeesCount, locationsCount, selectedServices, pricingRuleName, priceBreakdown.</p>
      </div></div>
    </section>
    <script>
      (() => {
        const lang = localStorage.getItem("binova_lang") || "ru";
        const i18n = {
          ru: {
            pricingEngine:"PRICING ENGINE", title:"Калькулятор предложений", subtitle:"Настраивайте правила расчёта для Office, HoReCa и Retail: базовая цена, размер клиента, локации, сервисные слои, скидки и доплаты.", newRule:"+ Новое правило", exportRules:"Экспорт правил", resetDemo:"Сбросить демо-данные", status:"Статус", segment:"Сегмент", clientSize:"Размер клиента", ruleName:"Название правила", baseMonthly:"Базовая цена в месяц EUR", minMonthly:"Минимальная цена в месяц EUR", setupFee:"Разовый setup fee EUR", perEmployee:"Цена за сотрудника EUR", perLocation:"Цена за локацию EUR", billingModel:"Модель оплаты", deliveryFrequency:"Частота поставок", serviceLevel:"Уровень сервиса", serviceMultiplier:"Множитель сервиса", packageMultiplier:"Множитель пакета", discount:"Скидка", discountValue:"Значение скидки", markup:"Наценка", markupValue:"Значение наценки", internalNote:"Внутренняя заметка", saveRule:"Сохранить правило", duplicate:"Дублировать", archive:"Архивировать", delete:"Удалить", serviceLayers:"Сервисные слои", serviceLayerPrices:"Цены по сервисным слоям", addLayer:"Добавить сервисный слой", livePreview:"Предпросмотр расчёта", employeesCount:"Сотрудники", locationsCount:"Локации", selectedPackage:"Выбранный пакет", simServiceLevel:"Уровень сервиса", calculateExample:"Рассчитать пример", rulesTable:"Таблица правил", savedRules:"Сохранённые правила", rulesHint:"Фильтруйте правила, открывайте строку для редактирования, дублируйте или архивируйте устаревшую логику.", offerBuilderLink:"Связь с заявками и КП", offerBuilderText:"Публичная форма читает эти правила в браузере, считает предварительную цену и сохраняет breakdown в заявку. При создании КП менеджер видит расчёт как стартовую точку и может вручную скорректировать финальную цену.", bitrixPayload:"Поля для CRM", affected:"Что повлияло на цену", monthly:"Месячная цена", yearly:"Годовая оценка", oneTime:"Разовый setup fee", noRules:"Правил по фильтру нет.", validation:"Заполните сегмент, размер клиента, название, базовую цену и модель оплаты.", layerName:"Название слоя", category:"Категория", pricingType:"Тип цены", price:"Цена", enabled:"Включён", remove:"Убрать"
          },
          en: {
            pricingEngine:"PRICING ENGINE", title:"Offer calculator", subtitle:"Configure pricing rules for Office, HoReCa and Retail: base price, client size, locations, service layers, discounts and markups.", newRule:"+ New rule", exportRules:"Export rules", resetDemo:"Reset demo data", status:"Status", segment:"Segment", clientSize:"Client size", ruleName:"Rule name", baseMonthly:"Base monthly price EUR", minMonthly:"Minimum monthly price EUR", setupFee:"One-time setup fee EUR", perEmployee:"Per employee EUR", perLocation:"Per location EUR", billingModel:"Billing model", deliveryFrequency:"Delivery frequency", serviceLevel:"Service level", serviceMultiplier:"Service multiplier", packageMultiplier:"Package multiplier", discount:"Discount", discountValue:"Discount value", markup:"Markup", markupValue:"Markup value", internalNote:"Internal note", saveRule:"Save rule", duplicate:"Duplicate", archive:"Archive", delete:"Delete", serviceLayers:"Service layers", serviceLayerPrices:"Service layer prices", addLayer:"Add service layer", livePreview:"Calculation preview", employeesCount:"Employees", locationsCount:"Locations", selectedPackage:"Selected package", simServiceLevel:"Service level", calculateExample:"Calculate example", rulesTable:"Rules table", savedRules:"Saved rules", rulesHint:"Filter rules, open a row to edit, duplicate or archive old logic.", offerBuilderLink:"Connection with requests and proposals", offerBuilderText:"The public form reads these rules in the browser, calculates a preliminary price and saves the breakdown into the request. When creating a proposal, the manager sees the calculation as a starting point and can adjust the final price manually.", bitrixPayload:"CRM fields", affected:"What affected the price", monthly:"Monthly price", yearly:"Estimated yearly value", oneTime:"One-time setup fee", noRules:"No rules match the filters.", validation:"Fill segment, client size, rule name, base price and billing model.", layerName:"Layer name", category:"Category", pricingType:"Pricing type", price:"Price", enabled:"Enabled", remove:"Remove"
          },
          ro: {
            pricingEngine:"PRICING ENGINE", title:"Calculator de oferte", subtitle:"Configurează regulile de calcul pentru Office, HoReCa și Retail: preț de bază, dimensiunea clientului, locații, straturi de servicii, reduceri și adaosuri.", newRule:"+ Regulă nouă", exportRules:"Export reguli", resetDemo:"Resetează date demo", status:"Status", segment:"Segment", clientSize:"Dimensiune client", ruleName:"Numele regulii", baseMonthly:"Preț lunar de bază EUR", minMonthly:"Preț lunar minim EUR", setupFee:"Taxă setup unică EUR", perEmployee:"Preț per angajat EUR", perLocation:"Preț per locație EUR", billingModel:"Model de plată", deliveryFrequency:"Frecvență livrări", serviceLevel:"Nivel service", serviceMultiplier:"Multiplicator service", packageMultiplier:"Multiplicator pachet", discount:"Reducere", discountValue:"Valoare reducere", markup:"Adaos", markupValue:"Valoare adaos", internalNote:"Notă internă", saveRule:"Salvează regula", duplicate:"Duplică", archive:"Arhivează", delete:"Șterge", serviceLayers:"Straturi de servicii", serviceLayerPrices:"Prețuri pe straturi de servicii", addLayer:"Adaugă strat de serviciu", livePreview:"Previzualizare calcul", employeesCount:"Angajați", locationsCount:"Locații", selectedPackage:"Pachet selectat", simServiceLevel:"Nivel service", calculateExample:"Calculează exemplu", rulesTable:"Tabel reguli", savedRules:"Reguli salvate", rulesHint:"Filtrează regulile, deschide o linie pentru editare, duplică sau arhivează logica veche.", offerBuilderLink:"Conexiune cu cereri și oferte", offerBuilderText:"Formularul public citește aceste reguli în browser, calculează un preț preliminar și salvează breakdown-ul în cerere. La crearea ofertei, managerul vede calculul ca punct de pornire și poate ajusta manual prețul final.", bitrixPayload:"Câmpuri CRM", affected:"Ce a influențat prețul", monthly:"Preț lunar", yearly:"Valoare anuală estimată", oneTime:"Taxă setup unică", noRules:"Nu există reguli pentru filtre.", validation:"Completează segmentul, dimensiunea clientului, numele regulii, prețul de bază și modelul de plată.", layerName:"Nume strat", category:"Categorie", pricingType:"Tip preț", price:"Preț", enabled:"Activ", remove:"Elimină"
          }
        };
        const t = (key) => (i18n[lang] && i18n[lang][key]) || i18n.ru[key] || key;
        document.querySelectorAll("[data-calc-i18n]").forEach((node) => { node.textContent = t(node.getAttribute("data-calc-i18n")); });
        const q = (id) => document.getElementById(id);
        const key = "binova_pricing_rules_v1";
        const layerKey = "binova_service_layers_v1";
        const eur = (value) => Math.round(Number(value || 0)).toLocaleString("en-US") + " EUR";
        const defaults = [
          {id:"office-small",status:"active",segment:"office",clientSize:"small",name:"Office Small Monthly Package",baseMonthlyPrice:390,minimumMonthlyPrice:390,setupFee:120,perEmployee:8,perLocation:90,billingModel:"monthly",deliveryFrequency:"monthly",serviceLevel:"standard",serviceLevelMultiplier:1,packageMultiplier:1,discountType:"none",discountValue:0,markupType:"none",markupValue:0,notes:"Small office starter rule.",updatedAt:new Date().toISOString()},
          {id:"office-medium",status:"active",segment:"office",clientSize:"medium",name:"Office Medium Monthly Package",baseMonthlyPrice:790,minimumMonthlyPrice:790,setupFee:180,perEmployee:6,perLocation:150,billingModel:"monthly",deliveryFrequency:"monthly",serviceLevel:"standard",serviceLevelMultiplier:1,packageMultiplier:1,discountType:"none",discountValue:0,markupType:"none",markupValue:0,notes:"Growing office rule.",updatedAt:new Date().toISOString()},
          {id:"office-large",status:"active",segment:"office",clientSize:"large",name:"Office Large Managed System",baseMonthlyPrice:1490,minimumMonthlyPrice:1490,setupFee:300,perEmployee:4,perLocation:240,billingModel:"monthly",deliveryFrequency:"weekly",serviceLevel:"priority",serviceLevelMultiplier:1.15,packageMultiplier:1,discountType:"none",discountValue:0,markupType:"none",markupValue:0,notes:"Enterprise office rule.",updatedAt:new Date().toISOString()},
          {id:"horeca-small",status:"active",segment:"horeca",clientSize:"small",name:"HoReCa Small Venue",baseMonthlyPrice:590,minimumMonthlyPrice:590,setupFee:250,perEmployee:0,perLocation:120,billingModel:"monthly",deliveryFrequency:"weekly",serviceLevel:"standard",serviceLevelMultiplier:1,packageMultiplier:1,discountType:"none",discountValue:0,markupType:"none",markupValue:0,notes:"Cafe or small venue.",updatedAt:new Date().toISOString()},
          {id:"horeca-medium",status:"active",segment:"horeca",clientSize:"medium",name:"HoReCa Medium Operation",baseMonthlyPrice:1290,minimumMonthlyPrice:1290,setupFee:400,perEmployee:0,perLocation:220,billingModel:"monthly",deliveryFrequency:"weekly",serviceLevel:"priority",serviceLevelMultiplier:1.15,packageMultiplier:1,discountType:"none",discountValue:0,markupType:"none",markupValue:0,notes:"Restaurant or hotel setup.",updatedAt:new Date().toISOString()},
          {id:"horeca-large",status:"active",segment:"horeca",clientSize:"large",name:"HoReCa Large Managed System",baseMonthlyPrice:1990,minimumMonthlyPrice:1990,setupFee:600,perEmployee:0,perLocation:350,billingModel:"monthly",deliveryFrequency:"weekly",serviceLevel:"urgent",serviceLevelMultiplier:1.3,packageMultiplier:1,discountType:"none",discountValue:0,markupType:"none",markupValue:0,notes:"Heavy service load.",updatedAt:new Date().toISOString()},
          {id:"retail-small",status:"active",segment:"retail",clientSize:"small",name:"Retail Small Location",baseMonthlyPrice:690,minimumMonthlyPrice:690,setupFee:300,perEmployee:0,perLocation:150,billingModel:"monthly",deliveryFrequency:"monthly",serviceLevel:"standard",serviceLevelMultiplier:1,packageMultiplier:1,discountType:"none",discountValue:0,markupType:"none",markupValue:0,notes:"Single traffic point.",updatedAt:new Date().toISOString()},
          {id:"retail-medium",status:"active",segment:"retail",clientSize:"medium",name:"Retail Medium Network",baseMonthlyPrice:1490,minimumMonthlyPrice:1490,setupFee:500,perEmployee:0,perLocation:260,billingModel:"monthly",deliveryFrequency:"twice_month",serviceLevel:"priority",serviceLevelMultiplier:1.15,packageMultiplier:1,discountType:"none",discountValue:0,markupType:"none",markupValue:0,notes:"Several locations.",updatedAt:new Date().toISOString()},
          {id:"retail-large",status:"active",segment:"retail",clientSize:"large",name:"Retail Large Network",baseMonthlyPrice:2490,minimumMonthlyPrice:2490,setupFee:800,perEmployee:0,perLocation:420,billingModel:"monthly",deliveryFrequency:"weekly",serviceLevel:"priority",serviceLevelMultiplier:1.15,packageMultiplier:1,discountType:"none",discountValue:0,markupType:"none",markupValue:0,notes:"Network standard.",updatedAt:new Date().toISOString()}
        ];
        const defaultLayers = [
          {id:"office-coffee-program",segment:"office",name:"Coffee program",category:"Coffee",pricingType:"fixed_monthly",price:180,enabledByDefault:true},{id:"office-machine",segment:"office",name:"Coffee machine",category:"Equipment",pricingType:"fixed_monthly",price:120,enabledByDefault:true},{id:"office-consumables",segment:"office",name:"Tea and consumables",category:"Consumables",pricingType:"per_employee",price:2,enabledByDefault:true},{id:"office-water",segment:"office",name:"Water supply",category:"Water",pricingType:"fixed_monthly",price:90,enabledByDefault:false},{id:"office-maintenance",segment:"office",name:"Monthly maintenance",category:"Service",pricingType:"fixed_monthly",price:70,enabledByDefault:true},
          {id:"horeca-beans",segment:"horeca",name:"Coffee beans",category:"Coffee",pricingType:"custom_quote",price:0,enabledByDefault:true},{id:"horeca-machine",segment:"horeca",name:"Professional machine",category:"Equipment",pricingType:"fixed_monthly",price:260,enabledByDefault:true},{id:"horeca-grinder",segment:"horeca",name:"Grinder",category:"Equipment",pricingType:"fixed_monthly",price:90,enabledByDefault:true},{id:"horeca-training",segment:"horeca",name:"Barista training",category:"Training",pricingType:"one_time",price:260,enabledByDefault:false},{id:"horeca-priority",segment:"horeca",name:"Priority service",category:"Service",pricingType:"fixed_monthly",price:180,enabledByDefault:true},{id:"horeca-preventive",segment:"horeca",name:"Preventive maintenance",category:"Service",pricingType:"fixed_monthly",price:120,enabledByDefault:true},
          {id:"retail-corner",segment:"retail",name:"Self-service corner",category:"Equipment",pricingType:"fixed_monthly",price:350,enabledByDefault:true},{id:"retail-cups",segment:"retail",name:"Cups and lids",category:"Consumables",pricingType:"per_location",price:80,enabledByDefault:true},{id:"retail-pos",segment:"retail",name:"POS consumables",category:"Retail POS",pricingType:"per_location",price:40,enabledByDefault:true},{id:"retail-replenishment",segment:"retail",name:"Planned replenishment",category:"Delivery",pricingType:"per_location",price:90,enabledByDefault:true},{id:"retail-maintenance",segment:"retail",name:"Centralized maintenance",category:"Service",pricingType:"per_location",price:120,enabledByDefault:true},{id:"retail-reporting",segment:"retail",name:"Reporting by location",category:"Reporting",pricingType:"fixed_monthly",price:150,enabledByDefault:false}
        ];
        let rules = JSON.parse(localStorage.getItem(key) || "null") || defaults;
        let layers = JSON.parse(localStorage.getItem(layerKey) || "null") || defaultLayers;
        let selectedId = rules[0]?.id;
        const save = () => { localStorage.setItem(key, JSON.stringify(rules)); localStorage.setItem(layerKey, JSON.stringify(layers)); };
        const current = () => rules.find((rule) => rule.id === selectedId) || rules[0];
        const readNumber = (id) => Number(q(id).value || 0);
        const fill = (rule) => {
          selectedId = rule.id; q("calcId").value = rule.id; q("calcStatus").value = rule.status; q("calcSegment").value = rule.segment; q("calcSize").value = rule.clientSize; q("calcName").value = rule.name; q("calcBase").value = rule.baseMonthlyPrice; q("calcMin").value = rule.minimumMonthlyPrice; q("calcSetup").value = rule.setupFee; q("calcEmployee").value = rule.perEmployee; q("calcLocation").value = rule.perLocation; q("calcBilling").value = rule.billingModel; q("calcDelivery").value = rule.deliveryFrequency; q("calcServiceLevel").value = rule.serviceLevel; q("calcServiceMultiplier").value = rule.serviceLevelMultiplier; q("calcPackageMultiplier").value = rule.packageMultiplier; q("calcDiscountType").value = rule.discountType; q("calcDiscountValue").value = rule.discountValue; q("calcMarkupType").value = rule.markupType; q("calcMarkupValue").value = rule.markupValue; q("calcNotes").value = rule.notes || ""; renderLayers(); renderTable(); renderPreview();
        };
        const readRule = () => ({ id:q("calcId").value || "rule-" + Date.now(), status:q("calcStatus").value, segment:q("calcSegment").value, clientSize:q("calcSize").value, name:q("calcName").value.trim(), baseMonthlyPrice:readNumber("calcBase"), minimumMonthlyPrice:readNumber("calcMin"), setupFee:readNumber("calcSetup"), perEmployee:readNumber("calcEmployee"), perLocation:readNumber("calcLocation"), billingModel:q("calcBilling").value, deliveryFrequency:q("calcDelivery").value, serviceLevel:q("calcServiceLevel").value, serviceLevelMultiplier:readNumber("calcServiceMultiplier") || 1, packageMultiplier:readNumber("calcPackageMultiplier") || 1, discountType:q("calcDiscountType").value, discountValue:readNumber("calcDiscountValue"), markupType:q("calcMarkupType").value, markupValue:readNumber("calcMarkupValue"), notes:q("calcNotes").value, updatedAt:new Date().toISOString() });
        const layerPrice = (layer, employees, locations) => layer.pricingType === "per_employee" ? layer.price * employees : layer.pricingType === "per_location" ? layer.price * locations : layer.pricingType === "one_time" || layer.pricingType === "custom_quote" ? 0 : Number(layer.price || 0);
        const calculate = (rule, selectedLayers, employees, locations) => {
          const layerMonthly = selectedLayers.reduce((sum, layer) => sum + layerPrice(layer, employees, locations), 0);
          const oneTimeLayers = selectedLayers.filter((layer) => layer.pricingType === "one_time").reduce((sum, layer) => sum + Number(layer.price || 0), 0);
          let subtotal = rule.baseMonthlyPrice + employees * rule.perEmployee + locations * rule.perLocation + layerMonthly;
          subtotal = subtotal * (rule.serviceLevelMultiplier || 1) * (rule.packageMultiplier || 1);
          const markup = rule.markupType === "percent" ? subtotal * rule.markupValue / 100 : rule.markupType === "fixed" ? rule.markupValue : 0;
          subtotal += markup;
          const discount = rule.discountType === "percent" ? subtotal * rule.discountValue / 100 : rule.discountType === "fixed" ? rule.discountValue : 0;
          subtotal -= discount;
          const monthlyPrice = Math.max(rule.minimumMonthlyPrice || 0, Math.round(subtotal));
          return { monthlyPrice, setupFee: Math.round((rule.setupFee || 0) + oneTimeLayers), yearlyValue: Math.round(monthlyPrice * 12 + (rule.setupFee || 0) + oneTimeLayers), layerMonthly: Math.round(layerMonthly), markup: Math.round(markup), discount: Math.round(discount), breakdown:["Base price: " + eur(rule.baseMonthlyPrice), "Employees: " + employees + " × " + eur(rule.perEmployee) + " = " + eur(employees * rule.perEmployee), "Locations: " + locations + " × " + eur(rule.perLocation) + " = " + eur(locations * rule.perLocation), "Service layers: " + eur(layerMonthly), "Service level multiplier: × " + rule.serviceLevelMultiplier, "Package multiplier: × " + rule.packageMultiplier, "Markup: " + eur(markup), "Discount: " + eur(discount), "Minimum monthly price: " + eur(rule.minimumMonthlyPrice)] };
        };
        const segmentLayers = () => layers.filter((layer) => layer.segment === q("calcSegment").value || q("calcSegment").value === "all");
        const selectedLayers = () => Array.from(document.querySelectorAll(".sim-layer input:checked")).map((input) => layers.find((layer) => layer.id === input.value)).filter(Boolean);
        const renderLayers = () => {
          q("layerEditor").innerHTML = segmentLayers().map((layer) => '<div class="layer-row" data-layer-id="' + layer.id + '"><input value="' + layer.name + '" data-field="name" placeholder="' + t("layerName") + '"><input value="' + layer.category + '" data-field="category" placeholder="' + t("category") + '"><select data-field="pricingType"><option value="fixed_monthly">fixed monthly</option><option value="per_employee">per employee</option><option value="per_location">per location</option><option value="one_time">one-time</option><option value="custom_quote">custom quote</option></select><input type="number" value="' + layer.price + '" data-field="price" placeholder="' + t("price") + '"><label class="check"><input type="checkbox" data-field="enabledByDefault" ' + (layer.enabledByDefault ? "checked" : "") + '> ' + t("enabled") + '</label><button type="button" class="danger layer-remove">' + t("remove") + '</button></div>').join("") || '<div class="empty-state">No layers for this segment.</div>';
          document.querySelectorAll(".layer-row").forEach((row) => { const layer = layers.find((item) => item.id === row.dataset.layerId); if (!layer) return; row.querySelector('[data-field="pricingType"]').value = layer.pricingType; row.querySelectorAll("input,select").forEach((input) => input.addEventListener("change", () => { const field = input.dataset.field; layer[field] = field === "price" ? Number(input.value || 0) : field === "enabledByDefault" ? input.checked : input.value; save(); renderPreview(); })); row.querySelector(".layer-remove").addEventListener("click", () => { layers = layers.filter((item) => item.id !== layer.id); save(); renderLayers(); renderPreview(); }); });
          renderPreview();
        };
        const renderPreview = () => {
          const rule = readRule();
          const employees = readNumber("simEmployees");
          const locations = Math.max(1, readNumber("simLocations"));
          const pack = q("simPackage").value;
          rule.packageMultiplier = pack === "complex" ? 1.1 : pack === "lean" ? .9 : rule.packageMultiplier || 1;
          rule.serviceLevelMultiplier = q("simServiceLevel").value === "urgent" ? 1.3 : q("simServiceLevel").value === "priority" ? 1.15 : rule.serviceLevelMultiplier || 1;
          const available = segmentLayers();
          q("simLayers").innerHTML = available.map((layer) => '<label class="sim-layer"><input type="checkbox" value="' + layer.id + '" ' + (layer.enabledByDefault ? "checked" : "") + '> <span>' + layer.name + '</span><small>' + layer.pricingType.replace("_"," ") + " · " + eur(layer.price) + '</small></label>').join("");
          q("simLayers").querySelectorAll("input").forEach((input) => input.addEventListener("change", renderResult));
          renderResult();
        };
        const renderResult = () => {
          const rule = readRule();
          const employees = readNumber("simEmployees");
          const locations = Math.max(1, readNumber("simLocations"));
          const pack = q("simPackage").value;
          rule.packageMultiplier = pack === "complex" ? 1.1 : pack === "lean" ? .9 : rule.packageMultiplier || 1;
          rule.serviceLevelMultiplier = q("simServiceLevel").value === "urgent" ? 1.3 : q("simServiceLevel").value === "priority" ? 1.15 : rule.serviceLevelMultiplier || 1;
          const result = calculate(rule, selectedLayers(), employees, locations);
          q("calcResult").innerHTML = '<div class="calc-total"><span>' + t("monthly") + '</span><b>' + eur(result.monthlyPrice) + '/mo</b></div><div class="calc-mini"><span>' + t("oneTime") + '</span><b>' + eur(result.setupFee) + '</b></div><div class="calc-mini"><span>' + t("yearly") + '</span><b>' + eur(result.yearlyValue) + '</b></div><h4>' + t("affected") + '</h4><ul>' + result.breakdown.map((line) => '<li>' + line + '</li>').join("") + '</ul>';
        };
        const renderTable = () => {
          const fs = q("filterSegment").value, st = q("filterStatus").value, sz = q("filterSize").value, bill = q("filterBilling").value, search = q("filterSearch").value.toLowerCase();
          const list = rules.filter((rule) => (fs === "all" || rule.segment === fs || rule.segment === "all") && (st === "all" || rule.status === st) && (sz === "all" || rule.clientSize === sz) && (bill === "all" || rule.billingModel === bill) && (!search || rule.name.toLowerCase().includes(search)));
          q("rulesTable").innerHTML = '<thead><tr><th>Status</th><th>Segment</th><th>Size</th><th>Rule name</th><th>Base price</th><th>Min price</th><th>Per employee</th><th>Per location</th><th>Service level</th><th>Billing model</th><th>Updated</th><th>Actions</th></tr></thead><tbody>' + (list.length ? list.map((rule) => '<tr data-rule-id="' + rule.id + '"><td><span class="badge">' + rule.status + '</span></td><td>' + rule.segment + '</td><td>' + rule.clientSize + '</td><td><b>' + rule.name + '</b></td><td>' + eur(rule.baseMonthlyPrice) + '</td><td>' + eur(rule.minimumMonthlyPrice) + '</td><td>' + eur(rule.perEmployee) + '</td><td>' + eur(rule.perLocation) + '</td><td>' + rule.serviceLevel + '</td><td>' + rule.billingModel + '</td><td>' + new Date(rule.updatedAt).toLocaleDateString() + '</td><td><button type="button" data-action="edit">' + t("saveRule").replace("Сохранить правило","Edit") + '</button><button type="button" data-action="dup">' + t("duplicate") + '</button><button type="button" data-action="archive">' + t("archive") + '</button><button type="button" data-action="del" class="danger">' + t("delete") + '</button></td></tr>').join("") : '<tr><td colspan="12">' + t("noRules") + '</td></tr>') + '</tbody>';
          q("rulesTable").querySelectorAll("tr[data-rule-id]").forEach((row) => row.addEventListener("click", (event) => { const rule = rules.find((item) => item.id === row.dataset.ruleId); if (!rule) return; const action = event.target.dataset.action; if (action === "dup") { rules.unshift({...rule,id:"rule-"+Date.now(),name:rule.name+" copy",status:"draft",updatedAt:new Date().toISOString()}); save(); renderTable(); return; } if (action === "archive") { rule.status = "archived"; rule.updatedAt = new Date().toISOString(); save(); renderTable(); return; } if (action === "del") { rules = rules.filter((item) => item.id !== rule.id); selectedId = rules[0]?.id; save(); fill(current()); return; } fill(rule); }));
        };
        q("calcForm").addEventListener("submit", (event) => { event.preventDefault(); const rule = readRule(); if (!rule.segment || !rule.clientSize || !rule.name || !rule.baseMonthlyPrice || !rule.billingModel) { q("calcError").textContent = t("validation"); return; } q("calcError").textContent = ""; const index = rules.findIndex((item) => item.id === rule.id); if (index >= 0) rules[index] = rule; else rules.unshift(rule); selectedId = rule.id; save(); fill(rule); });
        q("calcNew").addEventListener("click", () => fill({id:"rule-"+Date.now(),status:"draft",segment:"office",clientSize:"small",name:"Новое правило",baseMonthlyPrice:390,minimumMonthlyPrice:390,setupFee:120,perEmployee:8,perLocation:90,billingModel:"monthly",deliveryFrequency:"monthly",serviceLevel:"standard",serviceLevelMultiplier:1,packageMultiplier:1,discountType:"none",discountValue:0,markupType:"none",markupValue:0,notes:"",updatedAt:new Date().toISOString()}));
        q("calcDuplicate").addEventListener("click", () => { const rule = readRule(); rule.id = "rule-" + Date.now(); rule.name += " copy"; rule.status = "draft"; rules.unshift(rule); save(); fill(rule); });
        q("calcArchive").addEventListener("click", () => { const rule = readRule(); rule.status = "archived"; const index = rules.findIndex((item) => item.id === rule.id); if (index >= 0) rules[index] = rule; save(); fill(rule); });
        q("calcDelete").addEventListener("click", () => { rules = rules.filter((item) => item.id !== selectedId); selectedId = rules[0]?.id; save(); fill(current()); });
        q("layerAdd").addEventListener("click", () => { layers.push({id:"layer-"+Date.now(),segment:q("calcSegment").value === "all" ? "office" : q("calcSegment").value,name:"New service layer",category:"Service",pricingType:"fixed_monthly",price:100,enabledByDefault:false}); save(); renderLayers(); });
        q("calcReset").addEventListener("click", () => { rules = defaults; layers = defaultLayers; selectedId = rules[0].id; save(); fill(rules[0]); });
        q("calcExport").addEventListener("click", () => { const blob = new Blob([JSON.stringify({rules,layers}, null, 2)], {type:"application/json"}); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "binova-pricing-rules.json"; a.click(); URL.revokeObjectURL(a.href); });
        ["calcSegment","calcSize","calcBase","calcMin","calcSetup","calcEmployee","calcLocation","calcBilling","calcServiceLevel","calcServiceMultiplier","calcPackageMultiplier","calcDiscountType","calcDiscountValue","calcMarkupType","calcMarkupValue","simEmployees","simLocations","simPackage","simServiceLevel"].forEach((id) => q(id).addEventListener("change", () => { if (id === "calcSegment") renderLayers(); else renderResult(); }));
        ["filterSegment","filterStatus","filterSize","filterBilling","filterSearch"].forEach((id) => q(id).addEventListener("input", renderTable));
        window.binovaPricingEngine = { rules, layers, calculate };
        fill(current());
      })();
    </script>
  `);
};

const adminBotUpdates = (ctx: RequestContext) => {
  if (!requireAdmin(ctx)) return "";
  const submissions = (() => {
    try {
      return statementAll(`SELECT * FROM "ProductSubmission" WHERE "status" IN ('SUBMITTED', 'RESUBMITTED', 'CHANGES_REQUESTED') ORDER BY "createdAt" DESC LIMIT 20`);
    } catch {
      return [];
    }
  })();

  return adminLayout(ctx, "Bot catalog updates", `
    <div class="section-head">
      <div><p class="eyebrow">Обновления из бота</p><h1 style="color:var(--ink); font-size:52px;">Каталог на проверке</h1></div>
      <a class="btn" href="/admin/catalog">Открыть каталог</a>
    </div>
    <div class="grid-2">
      ${submissions.map((item) => `
        <article class="card"><div class="card-body">
          <span class="badge">${escapeHtml(item.status)}</span>
          <h3>${escapeHtml(item.productName)}</h3>
          <p>${escapeHtml(item.category)} · ${escapeHtml(item.availability)} · ${escapeHtml(item.segment)}</p>
          <p>${escapeHtml(item.description)}</p>
        </div></article>
      `).join("") || `<article class="card"><div class="card-body"><h3>Нет обновлений на проверке</h3><p>Когда бот отправит новые товары или пакеты, они появятся здесь.</p></div></article>`}
    </div>
  `);
};

const adminBitrix = (ctx: RequestContext) => {
  if (!requireAdmin(ctx)) return "";
  return adminLayout(ctx, "Bitrix24 integration", `
    <div class="section-head">
      <div><p class="eyebrow">CRM интеграция</p><h1 style="color:var(--ink); font-size:52px;">Bitrix24</h1></div>
      <a class="btn" href="/admin/leads">Открыть заявки</a>
    </div>
    <section class="band grid-2">
      <div class="card"><div class="card-body">
        <h3>Что будет передаваться</h3>
        <p>companyName, contactPerson, email, phone, businessSegment, businessFormat, companySize, employeesCount, locationsCount, city, currentSupplier, currentEquipment, desiredStartDate, budgetRange, deliveryFrequency, selectedServices, additionalDetails, estimatedDealValue, assignedManager и followUpDate.</p>
      </div></div>
      <div class="card"><div class="card-body">
        <h3>Следующий шаг</h3>
        <p>Подключить webhook Bitrix24 и выбрать режим: создавать лиды или сделки. После этого кнопка в заявке сможет отправлять данные менеджеру в CRM.</p>
      </div></div>
    </section>
  `);
};

const adminPackages = (ctx: RequestContext) => {
  if (!requireAdmin(ctx)) return "";
  const packages = statementAll(`SELECT * FROM "ServicePackage" ORDER BY "createdAt" DESC`);
  return adminLayout(ctx, "Packages", `
    <div class="section-head"><div><p class="eyebrow">Offer builder</p><h1 style="color:var(--ink); font-size:52px;">Service packages</h1></div></div>
    <div class="grid-2">
      <form method="post" action="/admin/packages" class="card card-body">
        <label>Segment<select name="segment">${Object.entries(businessLines).map(([key, line]) => `<option value="${key}">${line.label}</option>`).join("")}</select></label>
        <label>Package name<input required name="name" placeholder="Coffee + machine + service"></label>
        <label>Description<textarea required name="description" placeholder="Commercial positioning"></textarea></label>
        <label>Items<textarea required name="items" placeholder="Coffee beans&#10;Coffee machine&#10;Maintenance"></textarea></label>
        <label>Monthly price EUR<input required type="number" name="monthlyPrice" value="990"></label>
        <button>Create package</button>
      </form>
      <div>
        ${packages.map((pkg) => `
          <article class="card" style="margin-bottom:12px;">
            <div class="card-body">
              <span class="badge">${escapeHtml(slugLabel(pkg.segment))}</span>
              <span class="badge hot">${escapeHtml(pkg.source)}</span>
              <h3>${escapeHtml(pkg.name)}</h3>
              <p>${escapeHtml(pkg.description)}</p>
              <p><b>${money(pkg.monthlyPrice)}</b></p>
              <p>${escapeHtml(String(pkg.items).split("\n").join(" · "))}</p>
            </div>
          </article>
        `).join("")}
      </div>
    </div>
  `);
};

const adminPackageBuilder = (ctx: RequestContext) => {
  if (!requireAdmin(ctx)) return "";
  const defaultPackages = [
    { id: "office-core", segment: "office", status: "active", name: "Office Coffee Core", positioning: "Предсказуемый месячный пакет для офисов без лишней операционной нагрузки.", recommendedFor: "Growing office", shortDescription: "Coffee, equipment and scheduled maintenance for stable daily office consumption.", monthlyPrice: 890, billingModel: "monthly", items: [{ id: "coffee-beans", name: "Coffee beans", category: "Coffee", basePrice: 220 }, { id: "coffee-machine", name: "Coffee machine", category: "Equipment", basePrice: 420 }, { id: "monthly-service", name: "Monthly service", category: "Service", basePrice: 160 }, { id: "water-starter", name: "Water starter pack", category: "Water", basePrice: 90 }], updatedAt: new Date().toISOString() },
    { id: "office-comfort", segment: "office", status: "active", name: "Office Comfort Plus", positioning: "Полный beverage-набор для команды: напитки, расходники и сервис в одном процессе.", recommendedFor: "Corporate", shortDescription: "Coffee, tea, consumables and service for teams that need a complete office beverage setup.", monthlyPrice: 1240, billingModel: "monthly", items: [{ id: "coffee-beans", name: "Coffee beans", category: "Coffee", basePrice: 220 }, { id: "tea", name: "Tea", category: "Coffee", basePrice: 80 }, { id: "sugar", name: "Sugar", category: "Consumables", basePrice: 35 }, { id: "cups", name: "Cups", category: "Consumables", basePrice: 65 }, { id: "coffee-machine", name: "Coffee machine", category: "Equipment", basePrice: 420 }, { id: "monthly-service", name: "Monthly service", category: "Service", basePrice: 160 }], updatedAt: new Date().toISOString() },
    { id: "horeca-ready", segment: "horeca", status: "active", name: "HoReCa Bar Ready", positioning: "Система для заведений, где качество чашки и отсутствие простоев влияют на выручку.", recommendedFor: "Restaurant", shortDescription: "Professional coffee setup for cafés, restaurants and hotels with equipment, training and service.", monthlyPrice: 1760, billingModel: "monthly", items: [{ id: "coffee-beans", name: "Coffee beans", category: "Coffee", basePrice: 220 }, { id: "pro-machine", name: "Professional machine", category: "Equipment", basePrice: 520 }, { id: "grinder", name: "Grinder", category: "Equipment", basePrice: 180 }, { id: "barista-training", name: "Barista training", category: "Training", basePrice: 260 }, { id: "priority-service", name: "Priority service", category: "Service", basePrice: 240 }], updatedAt: new Date().toISOString() },
    { id: "horeca-service", segment: "horeca", status: "draft", name: "HoReCa Service Plus", positioning: "Сервисный пакет для заведений, где простой оборудования означает потерянную выручку.", recommendedFor: "Hotel", shortDescription: "Maintenance, urgent support and replenishment logic for venues where downtime means lost revenue.", monthlyPrice: null, billingModel: "custom_quote", items: [{ id: "preventive-maintenance", name: "Preventive maintenance", category: "Service", basePrice: 190 }, { id: "urgent-service", name: "Urgent service", category: "Service", basePrice: 240 }, { id: "replacement-machine", name: "Replacement machine", category: "Equipment", basePrice: 300 }, { id: "coffee-supply", name: "Coffee supply", category: "Delivery", basePrice: 220 }], updatedAt: new Date().toISOString() },
    { id: "retail-daily", segment: "retail", status: "active", name: "Retail Daily Ops", positioning: "Операционный пакет для точки с трафиком: self-service, расходники и регулярное пополнение.", recommendedFor: "Store", shortDescription: "Self-service coffee corner and replenishment routine for stores and high-traffic locations.", monthlyPrice: 1240, billingModel: "monthly", items: [{ id: "self-service", name: "Self-service equipment", category: "Equipment", basePrice: 380 }, { id: "coffee", name: "Coffee", category: "Coffee", basePrice: 220 }, { id: "cups", name: "Cups", category: "Consumables", basePrice: 65 }, { id: "pos-supplies", name: "POS supplies", category: "Retail POS", basePrice: 90 }, { id: "delivery-route", name: "Monthly delivery route", category: "Delivery", basePrice: 130 }], updatedAt: new Date().toISOString() },
    { id: "retail-network", segment: "retail", status: "draft", name: "Retail Network Standard", positioning: "Единый стандарт напитков, поставок и сервиса для сети локаций.", recommendedFor: "Retail chain", shortDescription: "Standardized beverage solution for several locations with centralized supply and service.", monthlyPrice: null, billingModel: "custom_quote", items: [{ id: "multi-location", name: "Multi-location setup", category: "Retail POS", basePrice: 500 }, { id: "central-maintenance", name: "Centralized maintenance", category: "Service", basePrice: 360 }, { id: "replenishment-plan", name: "Replenishment plan", category: "Delivery", basePrice: 220 }, { id: "location-reporting", name: "Reporting by location", category: "Other", basePrice: 140 }], updatedAt: new Date().toISOString() }
  ];
  const catalog = [
    { id: "coffee-beans", name: "Coffee beans", category: "Coffee", basePrice: 220, segments: ["office", "horeca", "retail"] },
    { id: "tea", name: "Tea", category: "Coffee", basePrice: 80, segments: ["office"] },
    { id: "coffee-machine", name: "Coffee machine", category: "Equipment", basePrice: 420, segments: ["office"] },
    { id: "pro-machine", name: "Professional machine", category: "Equipment", basePrice: 520, segments: ["horeca"] },
    { id: "grinder", name: "Grinder", category: "Equipment", basePrice: 180, segments: ["horeca"] },
    { id: "self-service", name: "Self-service equipment", category: "Equipment", basePrice: 380, segments: ["retail"] },
    { id: "cups", name: "Cups", category: "Consumables", basePrice: 65, segments: ["office", "horeca", "retail"] },
    { id: "sugar", name: "Sugar", category: "Consumables", basePrice: 35, segments: ["office", "horeca", "retail"] },
    { id: "monthly-service", name: "Monthly service", category: "Service", basePrice: 160, segments: ["office"] },
    { id: "priority-service", name: "Priority service", category: "Service", basePrice: 240, segments: ["horeca"] },
    { id: "barista-training", name: "Barista training", category: "Training", basePrice: 260, segments: ["horeca"] },
    { id: "delivery-route", name: "Monthly delivery route", category: "Delivery", basePrice: 130, segments: ["office", "retail"] },
    { id: "water-starter", name: "Water starter pack", category: "Water", basePrice: 90, segments: ["office"] },
    { id: "kitchen-hygiene", name: "Kitchen hygiene starter", category: "Cleaning", basePrice: 120, segments: ["horeca"] },
    { id: "pos-supplies", name: "POS supplies", category: "Retail POS", basePrice: 90, segments: ["retail"] }
  ];
  return adminLayout(ctx, "Packages", `
    <div class="section-head">
      <div>
        <p class="eyebrow">Offer builder</p>
        <h1 style="color:var(--ink); font-size:52px;">Конструктор пакетов</h1>
        <p>Создавайте коммерческие пакеты для Office, HoReCa и Retail: продукты, оборудование, сервис и регулярную поддержку в одном предложении.</p>
      </div>
      <button type="button" id="pkgNew">+ Новый пакет</button>
    </div>
    <div class="package-toolbar" id="pkgTabs">
      <button type="button" class="segment-tab active" data-filter="all">Все пакеты</button>
      <button type="button" class="segment-tab" data-filter="office">Office</button>
      <button type="button" class="segment-tab" data-filter="horeca">HoReCa</button>
      <button type="button" class="segment-tab" data-filter="retail">Retail</button>
    </div>
    <div class="package-builder">
      <section class="builder-panel">
        <form class="card card-body" id="pkgForm">
          <input type="hidden" id="pkgId">
          <div class="builder-grid">
            <label>Сегмент<select id="pkgSegment"><option value="office">Office</option><option value="horeca">HoReCa</option><option value="retail">Retail</option></select></label>
            <label>Статус<select id="pkgStatus"><option value="draft">Черновик</option><option value="active">Активен</option></select></label>
          </div>
          <label>Название пакета<input id="pkgName" placeholder="Office Coffee Core"></label>
          <label>Коммерческое позиционирование<textarea id="pkgPositioning" placeholder="Например: предсказуемый месячный пакет для офисов без лишней операционной нагрузки."></textarea></label>
          <div class="builder-grid">
            <label>Кому подходит<input id="pkgRecommended" list="recommendedOptions" placeholder="Growing office"></label>
            <label>Модель оплаты<select id="pkgBilling"><option value="monthly">Monthly</option><option value="one_time">One-time</option><option value="custom_quote">Custom quote</option><option value="from_price">From price</option></select></label>
          </div>
          <datalist id="recommendedOptions"><option>Small office</option><option>Growing office</option><option>Corporate</option><option>Café</option><option>Restaurant</option><option>Hotel</option><option>Store</option><option>Gas station</option><option>Retail chain</option></datalist>
          <label>Цена в месяц, EUR<input id="pkgPrice" type="number" min="0" placeholder="890"></label>
          <label>Краткое описание<textarea id="pkgShort" placeholder="Coffee, equipment and scheduled maintenance for stable daily office consumption."></textarea></label>
          <div class="section-head" style="margin:0 0 10px;"><div><h3 style="font-size:22px;">Что входит в пакет</h3><p style="margin:4px 0 0;">Выберите позиции из каталога или добавьте вручную.</p></div><button type="button" class="ghost" id="pkgCustomToggle">+ Добавить вручную</button></div>
          <div class="item-picker" id="pkgCatalog"></div>
          <div class="card-body" id="pkgCustomBox" style="display:none; border:1px solid var(--line); border-radius:8px; background:#fffdfa;">
            <div class="builder-grid">
              <label>Позиция<input id="customName" placeholder="Replacement machine"></label>
              <label>Категория<select id="customCategory"><option>Coffee</option><option>Equipment</option><option>Consumables</option><option>Service</option><option>Training</option><option>Delivery</option><option>Water</option><option>Cleaning</option><option>Retail POS</option><option>Other</option></select></label>
            </div>
            <label>Опциональная цена<input id="customPrice" type="number" min="0" placeholder="120"></label>
            <button type="button" id="customAdd">Добавить позицию</button>
          </div>
          <div class="selected-items" id="pkgItems"></div>
          <div class="builder-error" id="pkgError"></div>
          <div class="builder-actions">
            <button type="submit" id="pkgSave">Создать пакет</button>
            <button type="button" class="ghost" id="pkgDuplicate" style="display:none;">Дублировать</button>
            <button type="button" class="danger" id="pkgDelete" style="display:none;">Удалить</button>
          </div>
        </form>
        <div class="package-preview" id="pkgPreview"></div>
      </section>
      <aside class="package-list" id="pkgList"></aside>
    </div>
    <script>
      (() => {
        const defaults = ${JSON.stringify(defaultPackages)};
        let catalog = ${JSON.stringify(catalog)};
        const adminCatalogItems = JSON.parse(localStorage.getItem("binova_catalog_items_v1") || "[]")
          .filter((item) => item.status === "active")
          .map((item) => ({
            id: "catalog-" + item.id,
            name: item.name,
            category: item.category,
            basePrice: item.price || 0,
            segments: item.segment === "all" ? ["office", "horeca", "retail"] : [item.segment]
          }));
        catalog = [...catalog, ...adminCatalogItems.filter((item) => !catalog.some((base) => base.id === item.id || base.name === item.name))];
        const key = "binova_admin_packages_v2";
        const segmentLabels = { office: "Офис", horeca: "HoReCa", retail: "Ритейл" };
        const statusLabels = { draft: "Черновик", active: "Активен" };
        const billingLabels = { monthly: "EUR/mo", one_time: "one-time", custom_quote: "Custom quote", from_price: "from" };
        let packages = JSON.parse(localStorage.getItem(key) || "null") || defaults;
        let selectedId = packages[0]?.id || "";
        let filter = "all";
        let draftItems = [];
        const q = (id) => document.getElementById(id);
        const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
        const saveStore = () => localStorage.setItem(key, JSON.stringify(packages));
        const activePackage = () => packages.find((item) => item.id === selectedId) || null;
        const priceText = (pkg) => pkg.billingModel === "custom_quote" || pkg.monthlyPrice === null || pkg.monthlyPrice === "" ? "Custom quote" : (pkg.billingModel === "from_price" ? "from " : "") + Number(pkg.monthlyPrice || 0).toLocaleString("en-US") + " " + billingLabels[pkg.billingModel];
        const currentFormPackage = () => ({ id: q("pkgId").value || "pkg-" + Date.now(), segment: q("pkgSegment").value, status: q("pkgStatus").value, name: q("pkgName").value.trim(), positioning: q("pkgPositioning").value.trim(), recommendedFor: q("pkgRecommended").value.trim(), billingModel: q("pkgBilling").value, monthlyPrice: q("pkgBilling").value === "custom_quote" ? null : Number(q("pkgPrice").value || 0), shortDescription: q("pkgShort").value.trim(), items: draftItems, updatedAt: new Date().toISOString() });
        const setForm = (pkg) => {
          q("pkgId").value = pkg?.id || "";
          q("pkgSegment").value = pkg?.segment || (filter === "all" ? "office" : filter);
          q("pkgStatus").value = pkg?.status || "draft";
          q("pkgName").value = pkg?.name || "";
          q("pkgPositioning").value = pkg?.positioning || "";
          q("pkgRecommended").value = pkg?.recommendedFor || "";
          q("pkgBilling").value = pkg?.billingModel || "monthly";
          q("pkgPrice").value = pkg?.monthlyPrice ?? "";
          q("pkgShort").value = pkg?.shortDescription || "";
          draftItems = [...(pkg?.items || [])];
          q("pkgSave").textContent = pkg ? "Сохранить изменения" : "Создать пакет";
          q("pkgDuplicate").style.display = pkg ? "inline-flex" : "none";
          q("pkgDelete").style.display = pkg ? "inline-flex" : "none";
          q("pkgError").textContent = pkg ? "Выбран пакет для редактирования." : "Select a package to edit or create a new one.";
          renderAll();
        };
        const renderCatalog = () => {
          const segment = q("pkgSegment").value;
          q("pkgCatalog").innerHTML = catalog.filter((item) => item.segments.includes(segment)).map((item) => '<button type="button" class="catalog-pick" data-item="' + item.id + '"><b>' + escape(item.name) + '</b><small>' + escape(item.category) + ' · ' + (item.basePrice ? item.basePrice + ' EUR' : 'no price') + '</small></button>').join("");
          q("pkgCatalog").querySelectorAll("[data-item]").forEach((button) => button.addEventListener("click", () => { const item = catalog.find((entry) => entry.id === button.getAttribute("data-item")); if (!item || draftItems.some((entry) => entry.id === item.id)) return; draftItems.push({ id: item.id, name: item.name, category: item.category, basePrice: item.basePrice }); renderAll(); }));
        };
        const renderItems = () => {
          q("pkgItems").innerHTML = draftItems.length ? draftItems.map((item, index) => '<div class="item-row"><span><b>' + escape(item.name) + '</b><br><small>' + escape(item.category) + (item.basePrice ? ' · ' + item.basePrice + ' EUR' : '') + '</small></span><button type="button" class="ghost" data-up="' + index + '">↑</button><button type="button" class="ghost" data-remove="' + index + '">Remove</button></div>').join("") : '<div class="empty-state">Позиции ещё не выбраны.</div>';
          q("pkgItems").querySelectorAll("[data-remove]").forEach((button) => button.addEventListener("click", () => { draftItems.splice(Number(button.getAttribute("data-remove")), 1); renderAll(); }));
          q("pkgItems").querySelectorAll("[data-up]").forEach((button) => button.addEventListener("click", () => { const index = Number(button.getAttribute("data-up")); if (index <= 0) return; [draftItems[index - 1], draftItems[index]] = [draftItems[index], draftItems[index - 1]]; renderAll(); }));
        };
        const renderPreview = () => {
          const pkg = currentFormPackage();
          q("pkgPreview").innerHTML = '<div class="package-meta"><span class="badge">' + escape(segmentLabels[pkg.segment]) + '</span><span class="badge hot">' + escape(statusLabels[pkg.status]) + '</span></div><h3>' + escape(pkg.name || "Новый пакет") + '</h3><p>' + escape(pkg.shortDescription || "Краткое описание появится здесь.") + '</p><p><b style="font-size:26px;color:#fff;">' + escape(priceText(pkg)) + '</b></p><p>Кому подходит: <b style="color:#fff;">' + escape(pkg.recommendedFor || "не указано") + '</b></p><ul class="preview-items">' + (pkg.items.length ? pkg.items.map((item) => '<li>' + escape(item.name) + '</li>').join("") : '<li>Добавьте позиции в пакет</li>') + '</ul><a class="btn" href="/admin/proposals">Use in offer</a>';
        };
        const renderList = () => {
          const visible = packages.filter((pkg) => filter === "all" || pkg.segment === filter);
          q("pkgList").innerHTML = visible.length ? visible.map((pkg) => '<button type="button" class="package-card ' + (pkg.id === selectedId ? 'active' : '') + '" data-package="' + pkg.id + '"><div class="package-meta"><span class="badge">' + escape(segmentLabels[pkg.segment]) + '</span><span class="badge hot">' + escape(statusLabels[pkg.status]) + '</span></div><h3>' + escape(pkg.name) + '</h3><p>' + escape(pkg.shortDescription) + '</p><p><b>' + escape(priceText(pkg)) + '</b></p><p>' + escape(pkg.items.map((item) => item.name).join(" · ")) + '</p><small>Обновлено: ' + new Date(pkg.updatedAt).toLocaleDateString("ru-RU") + '</small></button>').join("") : '<div class="empty-state"><h3>No packages for this segment yet.</h3><p>Создайте первый пакет для выбранного направления.</p><button type="button" id="emptyCreate">Create first package</button></div>';
          q("pkgList").querySelectorAll("[data-package]").forEach((button) => button.addEventListener("click", () => { selectedId = button.getAttribute("data-package"); setForm(activePackage()); }));
          q("emptyCreate")?.addEventListener("click", () => setForm(null));
        };
        const renderAll = () => { renderCatalog(); renderItems(); renderPreview(); renderList(); };
        const validate = (pkg) => !pkg.segment ? "Выберите сегмент." : !pkg.name ? "Введите название пакета." : !pkg.shortDescription ? "Добавьте краткое описание." : !pkg.items.length ? "Добавьте минимум одну позицию." : "";
        q("pkgForm").addEventListener("submit", (event) => { event.preventDefault(); const pkg = currentFormPackage(); const error = validate(pkg); if (error) { q("pkgError").textContent = error; return; } const index = packages.findIndex((item) => item.id === pkg.id); if (index >= 0) packages[index] = pkg; else packages.unshift(pkg); selectedId = pkg.id; saveStore(); q("pkgError").textContent = "Пакет сохранён."; setForm(pkg); });
        q("pkgNew").addEventListener("click", () => setForm(null));
        q("pkgDuplicate").addEventListener("click", () => { const pkg = currentFormPackage(); pkg.id = "pkg-" + Date.now(); pkg.name = pkg.name + " copy"; pkg.status = "draft"; packages.unshift(pkg); selectedId = pkg.id; saveStore(); setForm(pkg); });
        q("pkgDelete").addEventListener("click", () => { const pkg = activePackage(); if (!pkg || !confirm("Удалить пакет " + pkg.name + "?")) return; packages = packages.filter((item) => item.id !== pkg.id); selectedId = packages[0]?.id || ""; saveStore(); setForm(activePackage()); });
        q("pkgCustomToggle").addEventListener("click", () => { q("pkgCustomBox").style.display = q("pkgCustomBox").style.display === "none" ? "block" : "none"; });
        q("customAdd").addEventListener("click", () => { const name = q("customName").value.trim(); if (!name) { q("pkgError").textContent = "Введите название позиции."; return; } draftItems.push({ id: "custom-" + Date.now(), name, category: q("customCategory").value, basePrice: Number(q("customPrice").value || 0) || undefined }); q("customName").value = ""; q("customPrice").value = ""; renderAll(); });
        ["pkgSegment", "pkgStatus", "pkgName", "pkgPositioning", "pkgRecommended", "pkgBilling", "pkgPrice", "pkgShort"].forEach((id) => q(id).addEventListener("input", renderAll));
        q("pkgTabs").querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => { filter = button.getAttribute("data-filter"); q("pkgTabs").querySelectorAll("[data-filter]").forEach((node) => node.classList.toggle("active", node === button)); const visible = packages.filter((pkg) => filter === "all" || pkg.segment === filter); selectedId = visible[0]?.id || ""; setForm(activePackage()); }));
        setForm(activePackage());
      })();
    </script>
  `);
};

const loginPage = (message = "") => page("Admin login", `
  <main>
    <section class="band" style="max-width:520px; margin:0 auto;">
      <p class="eyebrow">Admin access</p>
      <h1 style="color:var(--ink); font-size:52px;">Login</h1>
      ${message ? `<p class="copy">${escapeHtml(message)}</p>` : ""}
      <form method="post" action="/admin/login" class="card card-body">
        <label>Email<input required type="email" name="email"></label>
        <label>Password<input required type="password" name="password"></label>
        <button>Login</button>
        <a href="/admin/register">Create first admin</a>
      </form>
    </section>
  </main>
`);

const registerPage = (message = "") => page("Admin registration", `
  <main>
    <section class="band" style="max-width:560px; margin:0 auto;">
      <p class="eyebrow">Admin setup</p>
      <h1 style="color:var(--ink); font-size:52px;">Create admin</h1>
      <p class="copy">For demo use. First admin can be created directly. After that use setup code <b>binova-demo</b> unless changed in env.</p>
      ${message ? `<p class="copy">${escapeHtml(message)}</p>` : ""}
      <form method="post" action="/admin/register" class="card card-body">
        <label>Name<input required name="name"></label>
        <label>Email<input required type="email" name="email"></label>
        <label>Password<input required type="password" name="password" minlength="6"></label>
        <label>Setup code<input name="setupCode" placeholder="Required after first admin"></label>
        <button>Create admin</button>
      </form>
    </section>
  </main>
`);

const proposalPage = (token: string) => {
  const proposal = statementGet(`SELECT * FROM "CommercialProposal" WHERE "publicToken" = ?`, token);
  if (!proposal) {
    return page("Proposal not found", `<main><section class="band"><h1 style="color:var(--ink);">Proposal not found</h1></section></main>`);
  }
  const items = JSON.parse(proposal.items || "[]") as Array<{ type: string; name: string; description: string; price: number }>;

  return page("Commercial proposal", `
    <header class="hero" style="min-height:58vh;">
      <div class="hero-inner">
        <p class="eyebrow">Commercial proposal</p>
        <h1>${escapeHtml(proposal.title)}</h1>
        <p>Prepared for ${escapeHtml(proposal.clientName)} · ${escapeHtml(slugLabel(proposal.segment))}</p>
      </div>
    </header>
    <main>
      <section class="trust-strip">
        <div class="trust-item"><b>Scope</b><span>Services selected around the client's operating context.</span></div>
        <div class="trust-item"><b>Service</b><span>Equipment, replenishment and response logic in one proposal.</span></div>
        <div class="trust-item"><b>Next step</b><span>Binova manager aligns commercial terms directly with the client.</span></div>
        <div class="trust-item"><b>Validity</b><span>Proposal scope is confirmed during the commercial review.</span></div>
      </section>
      <section class="band">
        <div class="section-head">
          <div><p class="eyebrow">Included scope</p><h2>Selected services and items</h2></div>
        </div>
        <div class="grid-3">
          ${items.map((item) => `
            <article class="card"><div class="card-body">
              <span class="badge">${escapeHtml(item.type)}</span>
              <h3>${escapeHtml(item.name)}</h3>
              <p>${escapeHtml(item.description)}</p>
            </div></article>
          `).join("")}
        </div>
      </section>
      <section class="band grid-2">
        <div class="card"><div class="card-body"><h3>Operational promise</h3><p>Binova does not only deliver coffee products. The offer covers continuity: equipment readiness, replenishment rhythm, maintenance and account ownership.</p></div></div>
        <div class="card"><div class="card-body"><h3>Commercial notes</h3><p>${escapeHtml(proposal.notes || "Final scope, delivery calendar and SLA are aligned after the discovery call.")}</p></div></div>
      </section>
    </main>
  `, { noIndex: true });
};

const send = (response: http.ServerResponse, statusCode: number, body: string, contentType = "text/html") => {
  response.writeHead(statusCode, { "Content-Type": `${contentType}; charset=utf-8` });
  response.end(body);
};

const redirect = (response: http.ServerResponse, location: string, headers: Record<string, string> = {}) => {
  response.writeHead(302, { Location: location, ...headers });
  response.end();
};

const servePhoto = (response: http.ServerResponse, id: string) => {
  const photoId = Number(id);
  if (!Number.isInteger(photoId)) return send(response, 400, "Invalid photo id", "text/plain");
  const photo = statementGet(`SELECT * FROM "ProductPhoto" WHERE "id" = ?`, photoId);
  if (!photo || !fs.existsSync(photo.localPath)) return send(response, 404, "Photo not found", "text/plain");
  const extension = path.extname(photo.localPath).toLowerCase();
  const contentType = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
  response.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
  fs.createReadStream(photo.localPath).pipe(response);
};

const serveAsset = (response: http.ServerResponse, fileName: string) => {
  const decoded = decodeURIComponent(fileName);
  const assetPath = path.resolve(assetsDir, decoded);
  if (!assetPath.startsWith(`${assetsDir}${path.sep}`)) return send(response, 403, "Forbidden", "text/plain");
  if (!fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) return send(response, 404, "Asset not found", "text/plain");
  const extension = path.extname(assetPath).toLowerCase();
  const contentTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml"
  };
  response.writeHead(200, { "Content-Type": contentTypes[extension] ?? "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable" });
  fs.createReadStream(assetPath).pipe(response);
};

const getClientIp = (request: http.IncomingMessage) => {
  const forwarded = request.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const firstForwardedIp = raw?.split(",")[0]?.trim();
  const ip = firstForwardedIp || request.socket.remoteAddress || "";
  return ip.replace(/^::ffff:/, "");
};

const isPublicPageVisit = (ctx: RequestContext) => {
  const pathname = ctx.url.pathname;
  if (ctx.request.method !== "GET") return false;
  if (pathname.startsWith("/admin")) return false;
  if (pathname.startsWith("/assets/")) return false;
  if (pathname.startsWith("/media/")) return false;
  return pathname === "/" ||
    pathname === "/about" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname === "/cup-lab" ||
    pathname.startsWith("/solutions/") ||
    pathname.startsWith("/proposal/");
};

const deviceFromUserAgent = (userAgent: string) => {
  if (/mobile|android|iphone|ipod/i.test(userAgent)) return "mobile";
  if (/ipad|tablet/i.test(userAgent)) return "tablet";
  if (userAgent) return "desktop";
  return "";
};

const lookupGeo = async (ip: string): Promise<{ country: string; city: string }> => {
  if (!ip || ip === "::1" || ip === "127.0.0.1" || ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("172.16.")) {
    return { country: "", city: "" };
  }

  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country,city`);
    if (!response.ok) return { country: "", city: "" };
    const data = await response.json() as { success?: boolean; country?: string; city?: string };
    if (data.success === false) return { country: "", city: "" };
    return { country: data.country ?? "", city: data.city ?? "" };
  } catch (error) {
    console.warn("Visit geo lookup failed:", error);
    return { country: "", city: "" };
  }
};

const pruneVisitKeys = (now: number) => {
  const ttl = 24 * 60 * 60 * 1000;
  for (const [key, timestamp] of recentVisitKeys.entries()) {
    if (now - timestamp > ttl) recentVisitKeys.delete(key);
  }
};

const trackPublicVisit = (ctx: RequestContext) => {
  if (!visitsWebhookUrl || !isPublicPageVisit(ctx)) return;

  const ip = getClientIp(ctx.request);
  if (!ip || ignoredVisitIps.has(ip)) return;

  const userAgent = ctx.request.headers["user-agent"] ?? "";
  const userAgentText = Array.isArray(userAgent) ? userAgent.join(" ") : userAgent;
  const day = new Date().toISOString().slice(0, 10);
  const visitKey = `${day}:${ip}:${crypto.createHash("sha1").update(userAgentText).digest("hex")}`;
  const now = Date.now();
  pruneVisitKeys(now);
  if (recentVisitKeys.has(visitKey)) return;
  recentVisitKeys.set(visitKey, now);

  void (async () => {
    const geo = await lookupGeo(ip);
    const referrer = ctx.request.headers.referer ?? ctx.request.headers.referrer ?? "";
    const referrerText = Array.isArray(referrer) ? referrer[0] : referrer;
    const acceptLanguage = ctx.request.headers["accept-language"] ?? "";
    const lang = ctx.url.searchParams.get("lang") || (Array.isArray(acceptLanguage) ? acceptLanguage[0] : acceptLanguage).split(",")[0] || "";

    const response = await fetch(visitsWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ip,
        country: geo.country,
        city: geo.city,
        page: ctx.url.pathname,
        referrer: referrerText,
        lang,
        userAgent: userAgentText,
        device: deviceFromUserAgent(userAgentText),
        isNewVisitor: true
      })
    });

    if (!response.ok) console.warn(`Visit webhook failed: ${response.status} ${response.statusText}`);
  })().catch((error) => console.warn("Visit tracking failed:", error));
};

const handlePost = async (ctx: RequestContext) => {
  const body = await getBody(ctx.request);

  if (ctx.url.pathname === "/lead") {
    const segment = asString(body.segment);
    const companySize = asString(body.companySize);
    const employeeCount = asNumber(body.employeeCount, 0);
    const locationsCount = asNumber(body.locationsCount, 1);
    const services = asArray(body.services);
    const browserEstimate = asNumber(body.estimatedMonthlyPrice, 0);
    const estimate = browserEstimate > 0 ? browserEstimate : calculateEstimate(segment, companySize, employeeCount, locationsCount, services);
    const setupFee = asNumber(body.setupFee, 0);
    const yearlyValue = asNumber(body.yearlyValue, estimate * 12 + setupFee);
    const servicesPayload = services.join(",");
    const language = normalizeLanguage(asString(body.language));
    const summaryToken = crypto.randomBytes(16).toString("hex");
    const result = db.prepare(`
      INSERT INTO "ClientLead" (
        "segment",
        "companyName",
        "contactName",
        "email",
        "phone",
        "companySize",
        "employeeCount",
        "locationsCount",
        "services",
        "message",
        "estimatedMonthlyPrice",
        "businessSegment",
        "businessFormat",
        "contactPerson",
        "employeesCount",
        "city",
        "currentSupplier",
        "currentEquipment",
        "desiredStartDate",
        "budgetRange",
        "deliveryFrequency",
        "selectedServices",
        "additionalDetails",
        "estimatedDealValue",
        "setupFee",
        "yearlyValue",
        "pricingRuleId",
        "selectedServiceLayers",
        "priceBreakdown",
        "assignedManager",
        "followUpDate"
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      segment,
      asString(body.companyName),
      asString(body.contactName),
      asString(body.email),
      asString(body.phone),
      companySize,
      employeeCount,
      locationsCount,
      servicesPayload,
      asString(body.message),
      estimate,
      segment,
      companySize,
      asString(body.contactName),
      employeeCount,
      asString(body.city),
      asString(body.currentSupplier),
      asString(body.currentEquipment),
      asString(body.desiredStartDate),
      asString(body.budgetRange),
      asString(body.deliveryFrequency),
      servicesPayload,
      asString(body.message),
      estimate,
      setupFee,
      yearlyValue,
      asString(body.pricingRuleId),
      asString(body.selectedServiceLayers),
      asString(body.priceBreakdown),
      asString(body.assignedManager),
      asString(body.followUpDate)
    );
    const leadId = Number(result.lastInsertRowid);
    db.prepare(`UPDATE "ClientLead" SET "language" = ?, "summaryToken" = ? WHERE "id" = ?`).run(language, summaryToken, leadId);
    redirect(ctx.response, `/summary/${summaryToken}?lang=${language}`);
    return;
  }

  if (ctx.url.pathname === "/admin/register") {
    redirect(ctx.response, "/admin");
    return;
  }

  if (ctx.url.pathname === "/admin/login") {
    redirect(ctx.response, "/admin");
    return;
  }

  if (ctx.url.pathname === "/admin/calculator") {
    if (!requireAdmin(ctx)) return;
    db.prepare(`
      INSERT INTO "CalculatorRule" ("segment", "companySize", "basePrice", "perEmployeePrice", "perLocationPrice")
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT("segment", "companySize") DO UPDATE SET
        "basePrice" = excluded."basePrice",
        "perEmployeePrice" = excluded."perEmployeePrice",
        "perLocationPrice" = excluded."perLocationPrice",
        "active" = 1
    `).run(asString(body.segment), asString(body.companySize), Number(asString(body.basePrice)), Number(asString(body.perEmployeePrice)), Number(asString(body.perLocationPrice)));
    redirect(ctx.response, "/admin/calculator");
    return;
  }

  if (ctx.url.pathname === "/admin/packages") {
    if (!requireAdmin(ctx)) return;
    db.prepare(`
      INSERT INTO "ServicePackage" ("segment", "name", "description", "items", "monthlyPrice", "source")
      VALUES (?, ?, ?, ?, ?, 'ADMIN')
    `).run(asString(body.segment), asString(body.name), asString(body.description), asString(body.items), Number(asString(body.monthlyPrice)));
    redirect(ctx.response, "/admin/packages");
    return;
  }

  if (ctx.url.pathname === "/admin/catalog") {
    if (!requireAdmin(ctx)) return;
    db.prepare(`
      INSERT INTO "CatalogItem" ("segment", "category", "name", "description", "unitPrice", "imageUrl")
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(asString(body.segment), asString(body.category), asString(body.name), asString(body.description), Number(asString(body.unitPrice)), asString(body.imageUrl) || null);
    redirect(ctx.response, "/admin/catalog");
    return;
  }

  if (ctx.url.pathname === "/admin/proposals") {
    if (!requireAdmin(ctx)) return;
    const lead = statementGet(`SELECT * FROM "ClientLead" WHERE "id" = ?`, Number(asString(body.leadId)));
    if (!lead) {
      send(ctx.response, 404, "Lead not found", "text/plain");
      return;
    }

    const packageIds = asArray(body.packageIds).map(Number).filter(Number.isFinite);
    const catalogItemIds = asArray(body.catalogItemIds).map(Number).filter(Number.isFinite);
    const proposalItems: Array<{ type: string; name: string; description: string; price: number }> = [];

    for (const id of packageIds) {
      const pkg = statementGet(`SELECT * FROM "ServicePackage" WHERE "id" = ?`, id);
      if (pkg) proposalItems.push({ type: "Package", name: pkg.name, description: pkg.description, price: Number(pkg.monthlyPrice) });
    }
    for (const id of catalogItemIds) {
      const item = statementGet(`SELECT * FROM "CatalogItem" WHERE "id" = ?`, id);
      if (item) proposalItems.push({ type: item.category, name: item.name, description: item.description, price: Number(item.unitPrice) });
    }

    const subtotal = proposalItems.reduce((sum, item) => sum + item.price, 0);
    const discountPercent = Math.max(0, Math.min(60, Number(asString(body.discountPercent) || 0)));
    const total = Math.round(subtotal * (1 - discountPercent / 100));
    const token = crypto.randomBytes(16).toString("hex");
    db.prepare(`
      INSERT INTO "CommercialProposal" ("leadId", "clientName", "title", "segment", "items", "subtotal", "discountPercent", "total", "notes", "publicToken")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(lead.id, lead.companyName, asString(body.title), lead.segment, JSON.stringify(proposalItems), subtotal, discountPercent, total, asString(body.notes), token);
    redirect(ctx.response, `/proposal/${token}`);
    return;
  }

  send(ctx.response, 404, "Not found", "text/plain");
};

const sitemapPaths = ["/", "/solutions/office", "/solutions/retail", "/solutions/horeca", "/about", "/privacy", "/terms"];

const sitemapXml = () => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${sitemapPaths.map((pathname) => {
  const url = new URL(pathname, `${siteBaseUrl}/`).toString();
  const alternates = ["en", "ru", "ro"].map((lang) => `    <xhtml:link rel="alternate" hreflang="${lang}" href="${escapeHtml(`${url}?lang=${lang}`)}" />`).join("\n");
  return `  <url>\n    <loc>${escapeHtml(url)}</loc>\n${alternates}\n  </url>`;
}).join("\n")}
</urlset>`;

const robotsTxt = () => `User-agent: *
Allow: /
Disallow: /admin
Disallow: /proposal/
Disallow: /summary/
Disallow: /cup-lab

Sitemap: ${siteBaseUrl}/sitemap.xml
`;

const handleGet = (ctx: RequestContext) => {
  const pathname = ctx.url.pathname;
  if (pathname === "/robots.txt") return send(ctx.response, 200, robotsTxt(), "text/plain");
  if (pathname === "/sitemap.xml") return send(ctx.response, 200, sitemapXml(), "application/xml");

  trackPublicVisit(ctx);

  if (pathname === "/") return send(ctx.response, 200, homePage());
  if (pathname === "/about") return send(ctx.response, 200, aboutPage());
  if (pathname === "/cup-lab") return send(ctx.response, 200, cupLabPage());
  if (pathname === "/privacy") return send(ctx.response, 200, privacyPage());
  if (pathname === "/terms") return send(ctx.response, 200, termsPage());
  if (pathname === "/admin/login") return redirect(ctx.response, "/admin");
  if (pathname === "/admin/register") return redirect(ctx.response, "/admin");
  if (pathname === "/admin/logout") return redirect(ctx.response, "/admin", { "Set-Cookie": "admin_session=; Path=/; Max-Age=0" });
  if (pathname === "/admin") return send(ctx.response, 200, adminDashboard(ctx));
  if (pathname === "/admin/leads") {
    const html = adminLeadsEnhanced(ctx);
    if (!ctx.response.headersSent) return send(ctx.response, 200, html);
    return;
  }
  if (pathname === "/admin/calculator") {
    const html = adminCalculator(ctx);
    if (!ctx.response.headersSent) return send(ctx.response, 200, html);
    return;
  }
  if (pathname === "/admin/catalog") {
    const html = adminCatalog(ctx);
    if (!ctx.response.headersSent) return send(ctx.response, 200, html);
    return;
  }
  if (pathname === "/admin/packages") {
    const html = adminPackageBuilder(ctx);
    if (!ctx.response.headersSent) return send(ctx.response, 200, html);
    return;
  }
  if (pathname === "/admin/proposals") {
    const html = adminProposals(ctx);
    if (!ctx.response.headersSent) return send(ctx.response, 200, html);
    return;
  }
  if (pathname === "/admin/bot-updates") {
    const html = adminBotUpdates(ctx);
    if (!ctx.response.headersSent) return send(ctx.response, 200, html);
    return;
  }
  if (pathname === "/admin/bitrix24") {
    const html = adminBitrix(ctx);
    if (!ctx.response.headersSent) return send(ctx.response, 200, html);
    return;
  }
  if (pathname.startsWith("/assets/")) return serveAsset(ctx.response, pathname.replace("/assets/", ""));
  if (pathname.startsWith("/media/")) return servePhoto(ctx.response, pathname.replace("/media/", ""));
  const summaryMatch = pathname.match(/^\/summary\/([a-f0-9]{32})(\/print)?$/);
  if (summaryMatch) {
    const summaryExists = Boolean(statementGet(`SELECT "id" FROM "ClientLead" WHERE "summaryToken" = ?`, summaryMatch[1]));
    return send(ctx.response, summaryExists ? 200 : 404, summaryPage(summaryMatch[1], ctx.url.searchParams.get("lang"), Boolean(summaryMatch[2])));
  }
  const proposalMatch = pathname.match(/^\/proposal\/([a-f0-9]{32})$/);
  if (proposalMatch) return send(ctx.response, 200, proposalPage(proposalMatch[1]));

  const solutionMatch = pathname.match(/^\/solutions\/(office|retail|horeca)$/);
  if (solutionMatch) return send(ctx.response, 200, solutionPage(solutionMatch[1] as keyof typeof businessLines));

  return send(ctx.response, 404, page("Not found", `<main><section class="band"><h1 style="color:var(--ink);">Page not found</h1><a class="btn" href="/">Back home</a></section></main>`, { noIndex: true }));
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const ctx: RequestContext = { request, response, url, admin: getAdmin(request) };
    if (request.method === "POST") {
      await handlePost(ctx);
      return;
    }
    handleGet(ctx);
  } catch (error) {
    console.error("Site error:", error);
    send(response, 500, "Internal server error", "text/plain");
  }
});

server.listen(port, () => {
  console.log(`Binova demo site: http://localhost:${port}`);
});

const shutdown = () => {
  server.close();
  db.close();
  process.exit(0);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
