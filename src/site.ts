import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import querystring from "node:querystring";

const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: any };

const port = Number(process.env.SITE_PORT ?? 3000);
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
    title: "Office Coffee Solutions",
    short: "Predictable coffee, tea, equipment and service for teams of any size.",
    hero:
      "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1800&q=82",
    services: ["Coffee program", "Coffee machines", "Water service", "Cleaning supplies", "Office consumables", "Preventive maintenance"]
  },
  retail: {
    label: "Retail",
    title: "Retail & Multi-location Solutions",
    short: "Standardized beverage systems for stores, networks and high-traffic locations.",
    hero:
      "https://images.unsplash.com/photo-1604719312566-8912e9227c6a?auto=format&fit=crop&w=1800&q=82",
    services: ["Store consumables", "Shelf equipment", "Coffee corner", "POS supplies", "Cleaning supplies", "Scheduled replenishment"]
  },
  horeca: {
    label: "HoReCa",
    title: "HoReCa Beverage Systems",
    short: "Professional coffee, equipment, training and service for cafes, hotels and restaurants.",
    hero:
      "https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&w=1800&q=82",
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
    "Office Coffee Solutions": "Офисные кофейные решения",
    "Predictable coffee, tea, equipment and service for teams of any size.": "Предсказуемые кофе, чай, оборудование и сервис для команд любого размера.",
    "Build office package": "Собрать офисный пакет",
    "Retail & Multi-location Solutions": "Решения для ритейла и сетей",
    "Standardized beverage systems for stores, networks and high-traffic locations.": "Стандартизированные beverage-системы для магазинов, сетей и точек с высоким трафиком.",
    "Configure retail solution": "Настроить решение для ритейла",
    "HoReCa Beverage Systems": "Beverage-системы для HoReCa",
    "Professional coffee, equipment, training and service for cafes, hotels and restaurants.": "Профессиональный кофе, оборудование, обучение и сервис для кафе, отелей и ресторанов.",
    "Request HoReCa setup": "Запросить HoReCa setup",
    "Coffee systems for the way your business works.": "Кофейные системы под то, как работает ваш бизнес.",
    "Choose your business line. We will shape the right beverage service experience around your team, locations and customers.": "Выберите направление бизнеса. Мы соберем сервис напитков под вашу команду, точки и клиентов.",
    "Why Binova": "Почему Binova",
    "For teams, kitchens, meeting rooms and employee experience.": "Для команд, кухонь, переговорных и employee experience.",
    "For stores, networks, traffic points and standardized service.": "Для магазинов, сетей, точек трафика и стандартизированного сервиса.",
    "For cafes, hotels, restaurants and hospitality operations.": "Для кафе, отелей, ресторанов и hospitality-операций.",
    "Less procurement noise. Better beverage experience.": "Меньше закупочного шума. Лучше опыт напитков.",
    "No public price tables and no catalog maze. Pick the environment, select services, send context.": "Без публичных прайсов и лабиринта каталога. Выберите среду, отметьте сервисы и отправьте контекст.",
    "Pick the environment, choose the service layers and send a structured request to the Binova team.": "Выберите направление, отметьте сервисы и отправьте структурированную заявку команде Binova.",
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
    "Retail solution": "Решение для ритейла",
    "HoReCa solution": "Решение для HoReCa",
    "Office operations without daily procurement noise": "Офис без ежедневного закупочного шума",
    "Retail supply packages for stores and networks": "Пакеты снабжения для магазинов и сетей",
    "HoReCa service bundles for hospitality teams": "Сервисные пакеты для HoReCa-команд",
    "Coffee, water, hygiene, consumables, equipment and planned replenishment for offices.": "Кофе, вода, гигиена, расходники, оборудование и плановое пополнение для офисов.",
    "Shelf-ready assortment, replenishment rhythm, store equipment and commercial operations support.": "Готовый ассортимент, ритм пополнения, оборудование точки и поддержка коммерческих операций.",
    "Coffee, equipment, maintenance, hygiene and operational products for hotels, restaurants and cafes.": "Кофе, оборудование, сервис, гигиена и операционные продукты для отелей, ресторанов и кафе.",
    "Select services": "Выбрать сервисы",
    "Back to segments": "Назад к направлениям",
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
    "Company size": "Размер компании",
    "Employees": "Сотрудники",
    "Locations": "Локации",
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
    "No public price table. Just a clear view of what can be included in the service.": "Без публичного прайса. Только понятный обзор того, что может войти в сервис.",
    "Core products and service components that can be combined for this business line.": "Ключевые продукты и сервисные компоненты, которые можно комбинировать для этого направления.",
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
    "Office Coffee Solutions": "Soluții de cafea pentru birouri",
    "Predictable coffee, tea, equipment and service for teams of any size.": "Cafea, ceai, echipamente și service predictibil pentru echipe de orice dimensiune.",
    "Build office package": "Construiește pachetul office",
    "Retail & Multi-location Solutions": "Soluții pentru retail și rețele",
    "Standardized beverage systems for stores, networks and high-traffic locations.": "Sisteme standardizate de băuturi pentru magazine, rețele și locații cu trafic ridicat.",
    "Configure retail solution": "Configurează soluția retail",
    "HoReCa Beverage Systems": "Sisteme de băuturi HoReCa",
    "Professional coffee, equipment, training and service for cafes, hotels and restaurants.": "Cafea profesională, echipamente, training și service pentru cafenele, hoteluri și restaurante.",
    "Request HoReCa setup": "Cere setup HoReCa",
    "Coffee systems for the way your business works.": "Sisteme de cafea pentru felul în care funcționează afacerea ta.",
    "Choose your business line. We will shape the right beverage service experience around your team, locations and customers.": "Alege direcția de business. Construim experiența potrivită de beverage service în jurul echipei, locațiilor și clienților tăi.",
    "Why Binova": "De ce Binova",
    "For teams, kitchens, meeting rooms and employee experience.": "Pentru echipe, bucătării, săli de meeting și experiența angajaților.",
    "For stores, networks, traffic points and standardized service.": "Pentru magazine, rețele, puncte cu trafic și servicii standardizate.",
    "For cafes, hotels, restaurants and hospitality operations.": "Pentru cafenele, hoteluri, restaurante și operațiuni de ospitalitate.",
    "Less procurement noise. Better beverage experience.": "Mai puțin zgomot în achiziții. O experiență mai bună a băuturilor.",
    "No public price tables and no catalog maze. Pick the environment, select services, send context.": "Fără tabele publice de prețuri și fără labirint de catalog. Alege mediul, selectează serviciile și trimite contextul.",
    "Pick the environment, choose the service layers and send a structured request to the Binova team.": "Alege direcția, selectează straturile de servicii și trimite o cerere structurată echipei Binova.",
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
    "Retail solution": "Soluție pentru retail",
    "HoReCa solution": "Soluție pentru HoReCa",
    "Office operations without daily procurement noise": "Operațiuni de birou fără zgomot zilnic în achiziții",
    "Retail supply packages for stores and networks": "Pachete de aprovizionare pentru magazine și rețele",
    "HoReCa service bundles for hospitality teams": "Pachete de servicii pentru echipe HoReCa",
    "Coffee, water, hygiene, consumables, equipment and planned replenishment for offices.": "Cafea, apă, igienă, consumabile, echipamente și reaprovizionare planificată pentru birouri.",
    "Shelf-ready assortment, replenishment rhythm, store equipment and commercial operations support.": "Asortiment gata de raft, ritm de reaprovizionare, echipament de magazin și suport operațional comercial.",
    "Coffee, equipment, maintenance, hygiene and operational products for hotels, restaurants and cafes.": "Cafea, echipamente, mentenanță, igienă și produse operaționale pentru hoteluri, restaurante și cafenele.",
    "Select services": "Selectează servicii",
    "Back to segments": "Înapoi la segmente",
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
    "Company size": "Mărimea companiei",
    "Employees": "Angajați",
    "Locations": "Locații",
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
    "No public price table. Just a clear view of what can be included in the service.": "Fără tabel public de prețuri. Doar o imagine clară a ceea ce poate fi inclus în serviciu.",
    "Core products and service components that can be combined for this business line.": "Produse cheie și componente de servicii care pot fi combinate pentru această direcție de business.",
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

const page = (title: string, body: string, options: { admin?: boolean; plain?: boolean } = {}) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · Binova Group</title>
  <style>
    :root {
      --ink: #151713;
      --muted: #676b62;
      --paper: #f4f1ea;
      --panel: #fffdfa;
      --line: #ded7ca;
      --dark: #18201d;
      --green: #0f7a53;
      --blue: #174f8f;
      --red: #b42318;
      --gold: #b7791f;
      --copper: #9f5d32;
      --shadow: 0 24px 70px rgba(38, 31, 22, .14);
      --soft-shadow: 0 10px 32px rgba(38, 31, 22, .08);
      --bean-photo: url("/assets/coffee-bean.png");
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
        linear-gradient(180deg, rgba(255,255,255,.52), rgba(255,255,255,0) 360px),
        var(--paper);
    }
    a { color: inherit; }
    .nav {
      position: sticky;
      top: 0;
      z-index: 20;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      padding: 14px 28px;
      background: rgba(255, 253, 249, .88);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid rgba(221, 212, 199, .82);
    }
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
    .navlinks a { text-decoration: none; color: #303030; font-weight: 700; font-size: 14px; }
    .navlinks .admin-link { color: var(--blue); }
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
      color: #fff;
    }
    .hero {
      min-height: min(760px, calc(100vh - 58px));
      display: grid;
      align-items: center;
      color: #fff;
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
        linear-gradient(rgba(255,255,255,.045) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,.045) 1px, transparent 1px);
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
      color: var(--blue);
      text-transform: uppercase;
      font-size: 12px;
      font-weight: 850;
      letter-spacing: .08em;
    }
    .hero .eyebrow { color: #8bc0ff; }
    h1 {
      max-width: 920px;
      margin: 0;
      font-size: clamp(46px, 6.5vw, 92px);
      line-height: .9;
      letter-spacing: 0;
      overflow-wrap: anywhere;
    }
    .hero p {
      max-width: 730px;
      margin: 22px 0 0;
      font-size: 20px;
      line-height: 1.55;
      color: rgba(255,255,255,.82);
    }
    .hero-actions, .actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 28px; }
    .btn, button {
      border: 1px solid var(--dark);
      background: var(--dark);
      color: #fff;
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
    .hero .btn.secondary { color: #fff; border-color: rgba(255,255,255,.42); }
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
      border: 1px solid rgba(255,255,255,.18);
      background: rgba(255,255,255,.12);
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
    .proof-card span { display: block; color: rgba(255,255,255,.68); font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; }
    .proof-card b { display: block; margin-top: 8px; font-size: 24px; }
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
      align-content: end;
      gap: 10px;
      padding: 22px;
      border: 1px solid rgba(255,255,255,.16);
      border-radius: 12px;
      color: #fff;
      text-decoration: none;
      background: rgba(255,255,255,.1);
      backdrop-filter: blur(14px);
      overflow: hidden;
      transition: transform .22s ease, background .22s ease, border-color .22s ease, box-shadow .22s ease;
    }
    .segment-choice::before {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(135deg, rgba(255,255,255,.18), rgba(255,255,255,0));
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
      background: rgba(255,255,255,.16);
      border-color: rgba(255,255,255,.38);
      box-shadow: 0 28px 70px rgba(0,0,0,.28);
    }
    .segment-choice:hover::after { transform: rotate(18deg) scale(1.12); }
    .segment-choice strong { position: relative; max-width: 82%; font-size: 28px; line-height: 1.08; }
    .segment-choice span { position: relative; color: rgba(255,255,255,.72); line-height: 1.4; }
    .segment-choice em {
      position: relative;
      width: fit-content;
      margin-top: 6px;
      padding: 8px 11px;
      border: 1px solid rgba(255,255,255,.22);
      border-radius: 999px;
      color: #fff;
      font-style: normal;
      font-size: 12px;
      font-weight: 900;
      background: rgba(255,255,255,.08);
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
    .card h3 { margin: 0 0 10px; font-size: 24px; line-height: 1.12; }
    .card p { color: var(--muted); line-height: 1.5; }
    .card img, .tile-image { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block; background: #e3dbce; }
    .metric-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 24px; position: relative; }
    .metric { background: rgba(255,253,249,.92); border: 1px solid var(--line); border-radius: 8px; padding: 18px; box-shadow: var(--soft-shadow); }
    .metric span { display: block; color: var(--muted); font-size: 13px; margin-bottom: 8px; }
    .metric b { font-size: 32px; }
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
      outline: 2px solid rgba(23, 79, 143, .18);
      border-color: var(--blue);
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
      background-image: url("/assets/latte-stages-v2-aligned.png");
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
    .badge.new { background: #eaf1ff; color: var(--blue); }
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
    .footer { border-top: 1px solid var(--line); padding: 26px 28px; color: var(--muted); }
    .footer-inner { display: flex; justify-content: space-between; gap: 18px; flex-wrap: wrap; }
    @media (max-width: 900px) {
      .nav, .section-head, .footer-inner { align-items: flex-start; flex-direction: column; }
      .hero { min-height: 68vh; padding: 28px 18px; }
      main { padding: 24px 16px 56px; }
      .grid-3, .grid-2, .metric-row, .admin-shell, .hero-panel, .trust-strip, .hero-visual, .home-choice-grid, .service-grid { grid-template-columns: 1fr; }
      .request-form-wrap { grid-template-columns: 1fr; }
      .cup-lab { grid-template-columns: 1fr; }
      .cup-lab-stage { min-height: 420px; }
      .cup-preview-card { min-height: 420px; }
      .hero-visual { justify-self: stretch; }
      .visual-tile.large img { min-height: 220px; }
      .metric-row { margin-top: 0; }
      .check-grid { grid-template-columns: 1fr; }
      h1 { font-size: 46px; }
    }
  </style>
</head>
<body>
  ${options.plain ? "" : options.admin ? adminNav() : publicNav()}
  ${body}
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
      if (lang === "en") return;
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
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
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
      document.querySelectorAll("[placeholder]").forEach((node) => {
        const value = node.getAttribute("placeholder") || "";
        node.setAttribute("placeholder", translate(value));
      });
      document.querySelectorAll("option").forEach((node) => {
        node.textContent = translate(node.textContent || "");
      });
      document.title = translate(document.title);
    })();

    const setCupStage = (root, stage) => {
      const preview = root?.querySelector?.(".cup-preview") || document.querySelector(".cup-preview");
      if (preview) preview.setAttribute("data-stage", String(stage));
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

const publicNav = () => `
  <nav class="nav">
    <a class="logo" href="/">Binova Group</a>
    <div class="navlinks">
      <a href="/solutions/office">Office Solutions</a>
      <a href="/solutions/retail">Retail Solutions</a>
      <a href="/solutions/horeca">HoReCa Solutions</a>
      <a href="/about">About</a>
      <a class="admin-link" href="/#segments">Get Offer</a>
      <span class="lang-switch" aria-label="Language">
        <a href="?lang=en" data-lang="en">EN</a>
        <a href="?lang=ru" data-lang="ru">RU</a>
        <a href="?lang=ro" data-lang="ro">RO</a>
      </span>
    </div>
  </nav>`;

const adminNav = () => `
  <nav class="nav">
    <a class="logo" href="/admin">Binova Admin</a>
    <div class="navlinks">
      <a href="/">Public site</a>
      <a href="/admin/logout">Logout</a>
      <span class="lang-switch" aria-label="Language">
        <a href="?lang=en" data-lang="en">EN</a>
        <a href="?lang=ru" data-lang="ru">RU</a>
        <a href="?lang=ro" data-lang="ro">RO</a>
      </span>
    </div>
  </nav>`;

const footer = () => `
  <footer class="footer">
    <div class="footer-inner">
      <span>Binova Group demo · local MVP</span>
      <span><a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms</a> · <a href="/about">About us</a> · <a href="/admin">Admin</a></span>
    </div>
  </footer>`;

const cupPreview = (stage = 1) => `
  <div class="cup-preview" data-stage="${stage}" aria-label="AI generated latte stage preview">
    ${[1, 2, 3, 4, 5, 6].map((item) => `<span class="cup-frame stage-${item}"></span>`).join("")}
  </div>`;

const homePage = () => {
  return page("Business supply platform", `
    <header class="hero">
      <div class="bean-field"><span class="bean b1"></span><span class="bean b2"></span><span class="bean b3"></span><span class="bean b4"></span></div>
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
            <h2>Less procurement noise. Better beverage experience.</h2>
          </div>
          <p>Pick the environment, choose the service layers and send a structured request to the Binova team.</p>
        </div>
        <div class="grid-3">
          <article class="card"><div class="card-body"><span class="badge">Continuity</span><h3>Reliable daily service</h3><p>Equipment, replenishment and support are treated as one operating experience.</p></div></article>
          <article class="card"><div class="card-body"><span class="badge">Taste</span><h3>Coffee people remember</h3><p>Products and service setup are selected for the business context, not sold as isolated SKUs.</p></div></article>
          <article class="card"><div class="card-body"><span class="badge">Care</span><h3>One partner owns the flow</h3><p>Office, Retail and HoReCa requests start clean and continue with a dedicated Binova conversation.</p></div></article>
        </div>
      </section>
    </main>
  `);
};

const solutionPage = (segment: keyof typeof businessLines) => {
  const line = businessLines[segment];
  const packages = activePackages(segment);
  const items = catalogItems(segment);

  return page(`${line.label} solution`, `
    <header class="hero">
      <div class="bean-field"><span class="bean b1"></span><span class="bean b2"></span><span class="bean b3"></span><span class="bean b4"></span></div>
      <div class="hero-inner hero-panel">
        <div>
        <p class="eyebrow">${escapeHtml(line.label)} solution</p>
        <h1>${escapeHtml(line.title)}</h1>
        <p>${escapeHtml(line.short)} Select what you need and send the request. The Binova team shapes the service around your real operation.</p>
        <div class="hero-actions">
          <a class="btn" href="#request">Select services</a>
          <a class="btn secondary" href="/">Back to segments</a>
        </div>
        </div>
        <div class="hero-visual" aria-label="${escapeHtml(line.label)} visual">
          <div class="visual-tile large"><img src="${line.hero}" alt="${escapeHtml(line.label)}"></div>
          <div class="proof-card"><span>${escapeHtml(line.label)}</span><b>Pick the service layers. We build the system.</b></div>
        </div>
      </div>
    </header>
    <main>
      <section class="band">
        <div class="section-head">
          <div><p class="eyebrow">Service direction</p><h2>Choose a starting package</h2></div>
          <p>A clean starting point for the conversation with Binova.</p>
        </div>
        <div class="grid-3">
          ${packages.map((pkg) => `
            <article class="card">
              <div class="card-body">
                <span class="badge">${escapeHtml(line.label)}</span>
                <h3>${escapeHtml(pkg.name)}</h3>
                <p>${escapeHtml(pkg.description)}</p>
                <p>${escapeHtml(String(pkg.items).split("\n").join(" · "))}</p>
              </div>
            </article>
          `).join("") || `<div class="card"><div class="card-body"><h3>Packages are being prepared</h3><p>Send a request and the Binova team will recommend the right service setup.</p></div></div>`}
          ${line.services.slice(0, Math.max(0, 3 - packages.length)).map((service) => `
            <article class="card">
              <div class="card-body">
                <span class="badge">Layer</span>
                <h3>${escapeHtml(service)}</h3>
                <p>Can be combined with catalog items, equipment, replenishment rhythm and service support.</p>
              </div>
            </article>
          `).join("")}
        </div>
      </section>
      <section id="request" class="band">
        <div class="section-head">
          <div><p class="eyebrow">Your request</p><h2>Select services and send context</h2></div>
          <p>Select services below and the preview updates immediately.</p>
        </div>
        <div class="request-form-wrap">
          <form class="card card-body" method="post" action="/lead">
            <input type="hidden" name="segment" value="${segment}">
            <label>Company name<input required name="companyName" placeholder="Example SRL"></label>
            <label>Contact name<input required name="contactName" placeholder="Decision maker"></label>
            <label>Email<input required type="email" name="email" placeholder="name@company.com"></label>
            <label>Phone<input name="phone" placeholder="+373 ..."></label>
            <div class="grid-2">
              <label>Company size
                <select name="companySize">
                  ${companySizes.map((size) => `<option value="${size.value}">${size.label} - ${size.hint}</option>`).join("")}
                </select>
              </label>
              <label>Employees<input required type="number" min="1" name="employeeCount" value="25"></label>
            </div>
            <label>Locations<input required type="number" min="1" name="locationsCount" value="1"></label>
            <label>Services</label>
            <div class="service-grid">
              ${line.services.map((service) => `<label class="service-card"><input type="checkbox" name="services" value="${escapeHtml(service)}"><span class="service-shell"><strong>${escapeHtml(service)}</strong><span>Tap to add this layer to the request.</span></span></label>`).join("")}
            </div>
            <label>Context / request<textarea name="message" placeholder="Current supplier, delivery rhythm, expected start date, decision criteria..."></textarea></label>
            <button type="submit">Send request</button>
          </form>
          <div class="cup-preview-card">
            ${cupPreview(1)}
          </div>
        </div>
      </section>
      <section class="band">
        <div class="section-head">
          <div><p class="eyebrow">Catalog feel</p><h2>Products and services behind the experience</h2></div>
          <p>Core products and service components that can be combined for this business line.</p>
        </div>
        <div class="grid-3">
          ${items.map((item) => `
            <article class="card">
              ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}">` : ""}
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
  `);
};

const aboutPage = () => page("About us", `
  <main>
    <section class="band">
      <p class="eyebrow">About Binova Group</p>
      <h1 style="color:var(--ink); font-size:64px;">The operator behind business coffee systems.</h1>
      <p class="copy">Binova Group is positioned as the next evolution of fifteen years of Binonic Lux experience: not just a supplier of coffee, but an operator of beverage systems for business. The visible product is coffee. The value is continuity: calibrated equipment, predictable replenishment, service response, replacement logic and a partner who owns the operating complexity.</p>
    </section>
    <section class="band">
      <div class="grid-3">
        <article class="card"><img src="https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=900&q=82" alt="Business meeting"><div class="card-body"><h3>Leadership through systems</h3><p>Binova moves the conversation from product price to business reliability: uptime, planned deliveries, service standards and clear commercial ownership.</p></div></article>
        <article class="card"><img src="https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=900&q=82" alt="Coffee service"><div class="card-body"><h3>Service as the differentiator</h3><p>Fast intervention, preventive maintenance and replacement equipment become visible sales arguments instead of invisible back-office work.</p></div></article>
        <article class="card"><img src="https://images.unsplash.com/photo-1556740738-b6a63e27c4df?auto=format&fit=crop&w=900&q=82" alt="Retail operations"><div class="card-body"><h3>Segment-specific growth</h3><p>Office, Retail and HoReCa each get a different logic of offer, because a 10-person office, a cafe and a multi-location chain do not buy the same system.</p></div></article>
      </div>
    </section>
    <section class="band grid-2">
      <div>
        <p class="eyebrow">Strategic promise</p>
        <h2>Operational peace becomes business growth.</h2>
        <p class="copy">For offices, coffee becomes part of culture and retention. For HoReCa, it becomes differentiation, menu quality and repeat visits. For retail, it becomes a profit point with standardized execution across locations.</p>
      </div>
      <div class="card"><div class="card-body">
        <h3>Why this digital demo matters</h3>
        <p>The website identifies the client segment, captures relevant operating context and gives the commercial team a structured request instead of a vague message.</p>
        <p>Telegram keeps the catalog alive: products, photos, packages and availability can be added by the team without a developer.</p>
      </div></div>
    </section>
  </main>
`);

const cupLabPage = () => page("Cup lab", `
  <main>
    <section class="band">
      <p class="eyebrow">Prototype lab</p>
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
`);

const privacyPage = () => page("Privacy Policy", `
  <main>
    <section class="band">
      <p class="eyebrow">Privacy Policy</p>
      <h1 style="color:var(--ink); font-size:58px;">Local demo privacy statement</h1>
      <p class="copy">This MVP stores demo request data locally on this machine in SQLite. It is not connected to a production CRM, payment provider or public hosting environment.</p>
    </section>
    <section class="band grid-2">
      <div class="card"><div class="card-body"><h3>Data collected</h3><p>Company name, contact name, email, phone, company size, selected services and request notes.</p></div></div>
      <div class="card"><div class="card-body"><h3>Storage</h3><p>Data is stored in <b>prisma/dev.db</b> and product photos are stored in <b>uploads/products</b>.</p></div></div>
      <div class="card"><div class="card-body"><h3>Usage</h3><p>Data is used only to demonstrate request capture, admin review, calculator rules and package preparation.</p></div></div>
      <div class="card"><div class="card-body"><h3>Deletion</h3><p>For the demo, records can be removed directly from SQLite or reset by replacing the local database.</p></div></div>
    </section>
  </main>
`);

const termsPage = () => page("Terms", `
  <main>
    <section class="band">
      <p class="eyebrow">Terms</p>
      <h1 style="color:var(--ink); font-size:58px;">Demo terms of use</h1>
      <p class="copy">This local site is a clickable commercial MVP for meetings and internal validation. Prices, packages and calculations are configurable demo values, not final contractual offers.</p>
    </section>
    <section class="band grid-2">
      <div class="card"><div class="card-body"><h3>Commercial terms</h3><p>Commercial conditions are prepared by a Binova manager after reviewing the request.</p></div></div>
      <div class="card"><div class="card-body"><h3>Local operation</h3><p>The demo runs locally on this machine through Telegram long polling and a localhost website.</p></div></div>
      <div class="card"><div class="card-body"><h3>Admin responsibility</h3><p>Admins manage calculator rules, packages and lead review in the private admin area.</p></div></div>
      <div class="card"><div class="card-body"><h3>Phase 2</h3><p>Production deployment should add real authentication, hosting, backups, audit logs and CRM integration.</p></div></div>
    </section>
  </main>
`);

const thankYouPage = (leadId: number, estimate: number) => page("Request received", `
  <main>
    <section class="band">
      <p class="eyebrow">Request created</p>
      <h1 style="color:var(--ink); font-size:64px;">Proposal request #${leadId} is in the admin pipeline.</h1>
      <p class="copy">The Binova team has enough context to prepare the next step. Commercial details stay inside the admin workspace.</p>
      <div class="actions">
        <a class="btn" href="/">Back to site</a>
        <a class="btn secondary" href="/admin/leads">Open admin leads</a>
      </div>
    </section>
  </main>
`);

const adminLayout = (ctx: RequestContext, title: string, content: string) => page(title, `
  <div class="admin-shell">
    <aside class="admin-side">
      <h2 style="font-size:24px;">Control room</h2>
      <a href="/admin">Dashboard</a>
      <a href="/admin/leads">Leads</a>
      <a href="/admin/calculator">Calculator</a>
      <a href="/admin/catalog">Catalog</a>
      <a href="/admin/packages">Packages</a>
      <a href="/admin/proposals">Proposals</a>
      <a href="/">Public site</a>
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
  if (ctx.admin) return true;
  redirect(ctx.response, "/admin/login");
  return false;
};

const adminDashboard = (ctx: RequestContext) => {
  if (!requireAdmin(ctx)) return "";
  const leads = statementGet(`SELECT COUNT(*) as count FROM "ClientLead"`)?.count ?? 0;
  const newLeads = statementGet(`SELECT COUNT(*) as count FROM "ClientLead" WHERE "status" = 'NEW'`)?.count ?? 0;
  const packages = statementGet(`SELECT COUNT(*) as count FROM "ServicePackage"`)?.count ?? 0;
  const catalog = approvedProducts().length;
  return adminLayout(ctx, "Dashboard", `
    <section class="feature-band" style="margin-bottom:24px;">
      <p class="eyebrow">Admin dashboard</p>
      <h1 style="color:#fff; font-size:54px;">Commercial cockpit</h1>
      <p>Lead intake, pricing logic, managed catalog, service packages and commercial proposal links in one local control room.</p>
    </section>
    <section class="metric-row" style="margin-top:24px;">
      <div class="metric"><span>Total leads</span><b>${leads}</b></div>
      <div class="metric"><span>New leads</span><b>${newLeads}</b></div>
      <div class="metric"><span>Packages</span><b>${packages}</b></div>
      <div class="metric"><span>Bot catalog offers</span><b>${catalog}</b></div>
    </section>
    <section class="band">
      <div class="grid-3">
        <div class="card"><div class="card-body"><span class="badge">Intake</span><h3>Lead intake</h3><p>Every public business flow writes a request here.</p><a class="btn" href="/admin/leads">View leads</a></div></div>
        <div class="card"><div class="card-body"><span class="badge">Pricing</span><h3>Calculator</h3><p>Change base prices by segment and company size.</p><a class="btn" href="/admin/calculator">Tune rules</a></div></div>
        <div class="card"><div class="card-body"><span class="badge">Bundles</span><h3>Packages</h3><p>Build offer bundles for sales conversations.</p><a class="btn" href="/admin/packages">Manage packages</a></div></div>
        <div class="card"><div class="card-body"><span class="badge">Catalog</span><h3>Product depth</h3><p>Manage coffee, tea, equipment, services and consumables.</p><a class="btn" href="/admin/catalog">Manage catalog</a></div></div>
        <div class="card"><div class="card-body"><span class="badge">Proposal</span><h3>Commercial proposals</h3><p>Turn a lead into a priced offer with selected packages and catalog items.</p><a class="btn" href="/admin/proposals">Build proposal</a></div></div>
      </div>
    </section>
  `);
};

const adminLeads = (ctx: RequestContext) => {
  if (!requireAdmin(ctx)) return "";
  const leads = statementAll(`SELECT * FROM "ClientLead" ORDER BY "createdAt" DESC`);
  return adminLayout(ctx, "Leads", `
    <div class="section-head"><div><p class="eyebrow">Client requests</p><h1 style="color:var(--ink); font-size:52px;">Leads</h1></div></div>
    <table class="table">
      <thead><tr><th>ID</th><th>Company</th><th>Segment</th><th>Need</th><th>Estimate</th><th>Created</th></tr></thead>
      <tbody>
        ${leads.map((lead) => `
          <tr>
            <td>#${lead.id}<br><span class="badge new">${escapeHtml(lead.status)}</span></td>
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

const adminCatalog = (ctx: RequestContext) => {
  if (!requireAdmin(ctx)) return "";
  const items = catalogItems();
  return adminLayout(ctx, "Catalog", `
    <div class="section-head"><div><p class="eyebrow">Product depth</p><h1 style="color:var(--ink); font-size:52px;">Catalog items</h1></div></div>
    <div class="grid-2">
      <form method="post" action="/admin/catalog" class="card card-body">
        <label>Segment<select name="segment">${Object.entries(businessLines).map(([key, line]) => `<option value="${key}">${line.label}</option>`).join("")}</select></label>
        <label>Category<select name="category"><option>Coffee</option><option>Tea</option><option>Equipment</option><option>Service</option><option>Consumables</option><option>Retail</option></select></label>
        <label>Name<input required name="name" placeholder="Kimbo Espresso Office Blend"></label>
        <label>Description<textarea required name="description" placeholder="Short sales-ready description"></textarea></label>
        <label>Unit / monthly price EUR<input required type="number" name="unitPrice" value="120"></label>
        <label>Image URL<input name="imageUrl" placeholder="https://..."></label>
        <button>Add catalog item</button>
      </form>
      <div>
        ${items.map((item) => `
          <article class="card" style="margin-bottom:12px;">
            ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}">` : ""}
            <div class="card-body">
              <span class="badge">${escapeHtml(slugLabel(item.segment))}</span>
              <span class="badge hot">${escapeHtml(item.category)}</span>
              <h3>${escapeHtml(item.name)}</h3>
              <p>${escapeHtml(item.description)}</p>
              <p><b>${money(item.unitPrice)}</b></p>
            </div>
          </article>
        `).join("")}
      </div>
    </div>
  `);
};

const adminProposals = (ctx: RequestContext) => {
  if (!requireAdmin(ctx)) return "";
  const leads = statementAll(`SELECT * FROM "ClientLead" ORDER BY "createdAt" DESC`);
  const packages = activePackages();
  const items = catalogItems();
  const proposals = statementAll(`SELECT * FROM "CommercialProposal" ORDER BY "createdAt" DESC`);
  const selectedLeadId = Number(ctx.url.searchParams.get("leadId") ?? leads[0]?.id ?? 0);

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
        <label>Commercial notes<textarea name="notes" placeholder="Delivery rhythm, service SLA, equipment replacement, next step..."></textarea></label>
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
  const rules = statementAll(`SELECT * FROM "CalculatorRule" ORDER BY "segment", "companySize"`);
  return adminLayout(ctx, "Calculator", `
    <div class="section-head"><div><p class="eyebrow">Pricing engine</p><h1 style="color:var(--ink); font-size:52px;">Calculator rules</h1></div></div>
    <form method="post" action="/admin/calculator" class="card card-body">
      <div class="grid-3">
        <label>Segment<select name="segment">${Object.entries(businessLines).map(([key, line]) => `<option value="${key}">${line.label}</option>`).join("")}</select></label>
        <label>Company size<select name="companySize">${companySizes.map((size) => `<option value="${size.value}">${size.label}</option>`).join("")}</select></label>
        <label>Base price<input name="basePrice" type="number" value="790"></label>
      </div>
      <div class="grid-2">
        <label>Per employee<input name="perEmployeePrice" type="number" value="6"></label>
        <label>Per location<input name="perLocationPrice" type="number" value="150"></label>
      </div>
      <button>Save rule</button>
    </form>
    <section class="band">
      <table class="table">
        <thead><tr><th>Segment</th><th>Size</th><th>Base</th><th>Per employee</th><th>Per location</th></tr></thead>
        <tbody>${rules.map((rule) => `<tr><td>${escapeHtml(slugLabel(rule.segment))}</td><td>${escapeHtml(rule.companySize)}</td><td>${money(rule.basePrice)}</td><td>${money(rule.perEmployeePrice)}</td><td>${money(rule.perLocationPrice)}</td></tr>`).join("")}</tbody>
      </table>
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
        <div class="trust-item"><b>Validity</b><span>Demo proposal prepared for discussion.</span></div>
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
  `);
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

const handlePost = async (ctx: RequestContext) => {
  const body = await getBody(ctx.request);

  if (ctx.url.pathname === "/lead") {
    const segment = asString(body.segment);
    const companySize = asString(body.companySize);
    const employeeCount = Number(asString(body.employeeCount) || 0);
    const locationsCount = Number(asString(body.locationsCount) || 1);
    const services = asArray(body.services);
    const estimate = calculateEstimate(segment, companySize, employeeCount, locationsCount, services);
    const result = db.prepare(`
      INSERT INTO "ClientLead" ("segment", "companyName", "contactName", "email", "phone", "companySize", "employeeCount", "locationsCount", "services", "message", "estimatedMonthlyPrice")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      segment,
      asString(body.companyName),
      asString(body.contactName),
      asString(body.email),
      asString(body.phone),
      companySize,
      employeeCount,
      locationsCount,
      services.join(","),
      asString(body.message),
      estimate
    );
    send(ctx.response, 200, thankYouPage(Number(result.lastInsertRowid), estimate));
    return;
  }

  if (ctx.url.pathname === "/admin/register") {
    const adminCount = statementGet(`SELECT COUNT(*) as count FROM "AdminAccount"`)?.count ?? 0;
    const requiredCode = process.env.ADMIN_SETUP_CODE ?? "binova-demo";
    if (adminCount > 0 && asString(body.setupCode) !== requiredCode) {
      send(ctx.response, 403, registerPage("Invalid setup code."));
      return;
    }
    const token = crypto.randomBytes(32).toString("hex");
    db.prepare(`INSERT INTO "AdminAccount" ("email", "name", "passwordHash", "sessionToken") VALUES (?, ?, ?, ?)`)
      .run(asString(body.email).toLowerCase(), asString(body.name), hashPassword(asString(body.password)), token);
    redirect(ctx.response, "/admin", { "Set-Cookie": `admin_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax` });
    return;
  }

  if (ctx.url.pathname === "/admin/login") {
    const admin = statementGet(`SELECT * FROM "AdminAccount" WHERE "email" = ?`, asString(body.email).toLowerCase());
    if (!admin || !verifyPassword(asString(body.password), admin.passwordHash)) {
      send(ctx.response, 401, loginPage("Invalid email or password."));
      return;
    }
    const token = crypto.randomBytes(32).toString("hex");
    db.prepare(`UPDATE "AdminAccount" SET "sessionToken" = ? WHERE "id" = ?`).run(token, admin.id);
    redirect(ctx.response, "/admin", { "Set-Cookie": `admin_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax` });
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

const handleGet = (ctx: RequestContext) => {
  const pathname = ctx.url.pathname;
  if (pathname === "/") return send(ctx.response, 200, homePage());
  if (pathname === "/about") return send(ctx.response, 200, aboutPage());
  if (pathname === "/cup-lab") return send(ctx.response, 200, cupLabPage());
  if (pathname === "/privacy") return send(ctx.response, 200, privacyPage());
  if (pathname === "/terms") return send(ctx.response, 200, termsPage());
  if (pathname === "/admin/login") return send(ctx.response, 200, loginPage());
  if (pathname === "/admin/register") return send(ctx.response, 200, registerPage());
  if (pathname === "/admin/logout") return redirect(ctx.response, "/admin/login", { "Set-Cookie": "admin_session=; Path=/; Max-Age=0" });
  if (pathname === "/admin") return send(ctx.response, 200, ctx.admin ? adminDashboard(ctx) : loginPage("Login or create the first admin account."));
  if (pathname === "/admin/leads") {
    const html = adminLeads(ctx);
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
    const html = adminPackages(ctx);
    if (!ctx.response.headersSent) return send(ctx.response, 200, html);
    return;
  }
  if (pathname === "/admin/proposals") {
    const html = adminProposals(ctx);
    if (!ctx.response.headersSent) return send(ctx.response, 200, html);
    return;
  }
  if (pathname.startsWith("/assets/")) return serveAsset(ctx.response, pathname.replace("/assets/", ""));
  if (pathname.startsWith("/media/")) return servePhoto(ctx.response, pathname.replace("/media/", ""));
  const proposalMatch = pathname.match(/^\/proposal\/([a-f0-9]{32})$/);
  if (proposalMatch) return send(ctx.response, 200, proposalPage(proposalMatch[1]));

  const solutionMatch = pathname.match(/^\/solutions\/(office|retail|horeca)$/);
  if (solutionMatch) return send(ctx.response, 200, solutionPage(solutionMatch[1] as keyof typeof businessLines));

  return send(ctx.response, 404, page("Not found", `<main><section class="band"><h1 style="color:var(--ink);">Page not found</h1><a class="btn" href="/">Back home</a></section></main>`));
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
