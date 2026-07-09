# Binova Catalog Flow Demo

Local MVP demo for Binova Group:

- public sales website;
- separate admin area;
- client request flows for `Office`, `Retail`, and `HoReCa`;
- lead capture into SQLite;
- configurable offer calculator;
- service packages for commercial proposals;
- Telegram bot for internal product/package catalog updates and moderation.

## Tech stack

- Node.js + TypeScript
- Telegraf long polling
- SQLite
- Prisma ORM
- Local product photos in `uploads/products`
- Local public site and admin panel on `http://localhost:3000`

## Setup

On this machine, open Windows PowerShell and go to the project folder:

```powershell
cd "C:\Users\C.O.A.T\Documents\Codex\2026-07-09\senior-full-stack-developer-mvp-catalog\catalog-flow-bot"
```

If PowerShell starts in `C:\WINDOWS\system32`, do not run `cd catalog-flow-bot` from there. Use the full path above.

```bash
cd catalog-flow-bot
npm install
```

On Windows PowerShell, prefer `npm.cmd` if `npm` is blocked by script execution policy:

```powershell
npm.cmd install
```

Create a Telegram bot:

1. Open Telegram and message `@BotFather`.
2. Run `/newbot`.
3. Choose a bot name and username.
4. Copy the token from BotFather.

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

Fill the values:

```env
BOT_TOKEN=your_botfather_token
ADMIN_TELEGRAM_IDS=494676886
MODERATOR_TELEGRAM_IDS=494676886
DATABASE_URL="file:./dev.db"
SITE_PORT=3000
ADMIN_SETUP_CODE=binova-demo
```

`ADMIN_TELEGRAM_IDS` and `MODERATOR_TELEGRAM_IDS` are comma-separated Telegram numeric IDs. Initial access is allowed for those IDs. Admins can add more users with `/add_user`.

## Database

Run the initial Prisma migration:

```bash
npx prisma migrate dev --name init
```

Or use the package script:

```bash
npm run prisma:migrate
```

Windows PowerShell:

```powershell
npm.cmd run prisma:migrate
```

If Prisma's schema engine fails on your local Windows/Node combination, the MVP includes a fallback initializer that creates the same SQLite tables:

```bash
npm run db:init
```

Windows PowerShell:

```powershell
npm.cmd run db:init
```

## Run locally

Run the Telegram bot:

```bash
npm run dev
```

Windows PowerShell:

```powershell
npm.cmd run dev
```

When the terminal shows `ts-node-dev ...`, leave that PowerShell window open. The bot is running through Telegram long polling. To stop it, press `Ctrl+C`.

Run the local Binova website and admin area in a second PowerShell window:

```powershell
cd "C:\Users\C.O.A.T\Documents\Codex\2026-07-09\senior-full-stack-developer-mvp-catalog\catalog-flow-bot"
npm.cmd run site
```

Open the public website:

```text
http://localhost:3000
```

Open the admin area:

```text
http://localhost:3000/admin
```

The site has:

- `/` - public landing page;
- `/about` - about us page;
- `/privacy` - privacy policy;
- `/terms` - terms page;
- `/solutions/office` - Office client request flow;
- `/solutions/retail` - Retail client request flow;
- `/solutions/horeca` - HoReCa client request flow;
- `/admin` - separate admin dashboard;
- `/admin/leads` - submitted client requests;
- `/admin/calculator` - pricing rules;
- `/admin/catalog` - detailed product/service catalog;
- `/admin/packages` - service package builder.
- `/admin/proposals` - commercial proposal builder.

The three public business flows are:

- `Office`
- `Retail`
- `HoReCa`

Each flow asks for company registration details, company size, locations, selected services, and request context. The request is saved to SQLite and appears in admin leads.

The Telegram bot still reads/writes the same local data. Approved bot products appear as supporting catalog offers on the relevant business pages. Bot-added service packages appear in the public site and admin packages.

The bot runs with Telegram long polling. No webhook or public URL is required.

For production-style local run:

```bash
npm run build
npm start
```

Windows PowerShell:

```powershell
npm.cmd run build
npm.cmd start
```

## Employee test flow

1. Send `/start`.
2. Press `Add product`.
3. Send 1 to 5 product photos.
4. Press `Done after photos`.
5. Enter product name, category, description, price.
6. Choose currency, availability, and segment.
7. Enter or skip SKU.
8. Enter or skip internal comment.
9. Review the preview.
10. Press `Submit for moderation`.
11. Use `My submissions` or `/my` to check status.

For updates, press `Update product`, enter the product name or SKU to update, choose the update scope, then complete the same full product card flow.

## Moderator test flow

1. Use a Telegram ID listed in `MODERATOR_TELEGRAM_IDS` or `ADMIN_TELEGRAM_IDS`.
2. New submissions are sent to moderators automatically.
3. Use inline buttons:
   - `Approve`
   - `Request changes`
   - `Reject`
4. For request changes or reject, enter the moderation comment when the bot asks.
5. The employee receives the result. For changes requested, the employee gets an `Edit submission` button.
6. Use `/pending` to list pending submissions.

## Admin commands

```text
/users
/add_user TELEGRAM_ID ROLE
/set_role TELEGRAM_ID ROLE
/export
/packages
/add_package segment | name | items | price | description
```

Roles:

```text
EMPLOYEE
MODERATOR
ADMIN
```

Service package command example:

```text
/add_package office | Coffee + machine + service | Coffee beans, Coffee machine, Monthly service | 990 | Office coffee bundle for 30 people
```

Supported package segments:

```text
office
retail
horeca
```

## Web admin flow

1. Open `http://localhost:3000/admin`.
2. Click `Create first admin`.
3. Create an admin account.
4. After the first admin, use setup code:

```text
binova-demo
```

5. Open:
   - `Dashboard` for overview;
   - `Leads` for submitted client requests;
   - `Calculator` to tune prices by segment and company size;
   - `Catalog` to manage exact coffee, tea, equipment, service and consumable items;
   - `Packages` to create commercial bundles;
   - `Proposals` to generate client-facing commercial offers from leads, packages and catalog items.

## Public demo flow for meetings

1. Open `http://localhost:3000`.
2. Show the three main blocks: `Office`, `Retail`, `HoReCa`.
3. Click one business line.
4. Show recommended packages and approved Telegram catalog items.
5. Fill the client request form.
6. Submit it and show the calculated monthly estimate.
7. Open `/admin/leads` and show the new lead.
8. Open `/admin/calculator` and change a rule.
9. Open `/admin/catalog` and show concrete items such as coffee, tea, machines, service and consumables.
10. Open `/admin/packages` and create a package.
11. Open `/admin/proposals`, select a lead, choose packages/items, apply discount and generate a proposal link.
12. Add another package from Telegram with `/add_package`.

## Export

Run:

```text
/export
```

The bot exports approved products to:

```text
exports/approved-products.csv
exports/approved-products.json
```

After export, products are marked as `EXPORTED` and `exportStatus` is set to `EXPORTED`.

The local site treats both `APPROVED` and `EXPORTED` records as approved catalog items.

## Project structure

```text
catalog-flow-bot/
  src/
    bot.ts
    index.ts
    site.ts
    config.ts
    db/prisma.ts
    flows/productFlow.ts
    flows/moderationFlow.ts
    services/productService.ts
    services/userService.ts
    services/exportService.ts
    services/fileService.ts
    services/packageService.ts
    utils/formatProductPreview.ts
    utils/validators.ts
  prisma/schema.prisma
  scripts/init-sqlite.mjs
  uploads/products/
  exports/
  .env.example
  package.json
  tsconfig.json
  README.md
```

## Phase 2 ideas

- Admin web panel.
- Product matching and duplicate detection.
- Partial update forms instead of always collecting the full card.
- Website publishing integration.
- Google Sheets import/export.
- Role management UI.
- Audit dashboard and advanced filters.
- Photo replacement/removal controls during editing.
