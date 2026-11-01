# tapedup-payment-activation

**Trade Hub**: TapedUp's embedded Shopify app screen (the app is
`tapedup-payment-rules`), styled on the TapedUp design system. A CRM for
trade accounts, the customers tagged `b2b`, plus the setup for the app's
checkout rules. Retail customers and their orders stay in Shopify's own
screens. No backend — it's static files on GitHub Pages (set as the app's
`application_url`) that call the Admin API straight from the browser through
Shopify's
[direct API access](https://shopify.dev/docs/api/app-home/apis/authentication-and-data/resource-fetching-api)
(`fetch('shopify:admin/api/graphql.json')` via App Bridge), authenticated by
the embedded session (offline mode, see the app's `shopify.app.toml`). No
client secret anywhere in this repo.

## Two places it runs

- **Inside Shopify admin** (embedded, GitHub Pages): as above, App Bridge
  authenticates every Admin API call. Nothing here changes.
- **At trade.tapedup.co.uk** (standalone): the same files, served by the
  private `tapedup-trade-server` behind Microsoft 365 sign-in, without App
  Bridge. `js/api.js` sends the same GraphQL to the server's
  `/api/shopify/graphql`, which forwards it with this app's own offline
  token, so both copies read and write the same metafields. `js/env.js`
  decides which mode it's in. Setup → **Connect trade.tapedup.co.uk**
  (embedded only) gives the server that token. Shopify's product picker is
  App Bridge-only, so picking offer products still happens inside admin.

## Screens (hash routes, since GitHub Pages can't serve /customers)

- **Pipeline** `#/pipeline` — every trade account as a card in its sales
  stage (Prospect → Contacted → Replied → Sample sent → Account opened →
  Active dealer, plus Lapsed, Not now, Lost). Drag a card or use its menu to
  move it; overdue follow-ups sort to the top. Stages saved by older
  versions (Lead, Prospect, Customer, Key account, Inactive) are read as
  their new stage and only rewritten when moved; key accounts keep a
  `key-account` label. Accounts with no stage are placed from their orders
  and marked Suggested. At trade.tapedup.co.uk, cold prospects from the
  trade server appear too (badged Prospect; their menu only offers
  Prospect / Contacted / Not now / Lost).

- **Prospects** `#/prospects` (trade.tapedup.co.uk) — gyms and shops not yet
  in Shopify, stored on the trade server. Import the prospects CSV, add
  missing emails, select up to 50 and draft their first email (intro or
  re-introduction, as chosen per prospect) into the Outbox. When one replies
  they become a Shopify customer tagged `trade-lead` (no trade pricing) and
  leave this list.

- **Dashboard** `#/` — revenue, orders, customers ordering and average order vs
  the previous period; revenue chart; best tapes; best dealers; who's ordering
  more / less; follow-ups due; who's past their usual reorder time. The period
  (30 days / 90 days / 12 months) scopes it all.
- **Outbox** `#/outbox` (trade.tapedup.co.uk) — dealer emails waiting for
  approval, queued, sent, failed or rejected, each shown as the dealer will
  see it. Approve and send, edit (fields are re-filled on save) or reject.
  Shows today's sends against the server's warm-up limits.
- **Email templates** `#/templates` — one email per pipeline step plus the
  signature, saved to the app-data metafield `tapedup_admin.email_templates`
  so every copy and the trade server share them. Plain text with {fields};
  at trade.tapedup.co.uk the editor previews the real email for any dealer
  and sends you a test. `js/email-templates.js` holds the starting set,
  written in the storefront's voice.
- **Agent** `#/agent` (trade.tapedup.co.uk) — whether the agent is reading
  replies and allowed to send, AI spend against the monthly limit, the last
  follow-up run (and "Run follow-ups now"), results per email template
  (sent, replied, opted out, samples and accounts after), and what the agent
  may say: product facts, reply tone and whether simple replies may send
  without approval (saved with the templates as `set.agent`).
- **Customers** `#/customers` and `#/customers/<id>` — the trade-account list
  (search, filters, sort incl. longest since contact, CSV export, bulk "give
  starter offer", add trade account) and each one's page: stats, spend by
  month, best tapes, orders, details (company, contact, emails, phone,
  address, last contact), starter offer, trade / terms switches,
  pipeline stage, Shopify note, samples and account (send a free sample
  pack as a £0 order tagged `trade-sample`, or a one-use code; open their
  trade account, which tags `b2b` and drafts the walkthrough email), their emails with trade@ (draft from a template, see the thread), and the activity log (calls, emails,
  visits, samples, notes, with follow-up dates).
- **Trade orders** `#/orders` — every synced trade order, filterable, linking
  to Shopify.
- **Starter offers** `#/offers` — reusable templates (one is the default) and
  everyone who has an offer.
- **Follow-ups** `#/follow-ups` — open follow-ups (overdue / today / coming
  up) and the latest activity across all customers.
- **Setup** `#/setup` — switch on each checkout rule, B2B shipping amounts,
  the trade sample pack (products, monthly cap; saved to
  `tapedup_admin.trade_settings`),
  which permissions the app has, and the Notion import.
- **Import from Notion** `#/import` — one-off move from the old Notion dealer
  tracker (see below).

## Where the data lives (all in Shopify)

- `tapedup.starter_offer` (customer, JSON) — the live starter order. Read by
  the `starter-order-discount` function and the theme's
  `snippets/starter-offer.liquid`; keep the shape in step with both. Customers
  with one are also tagged `starter-order`.
- `tapedup.crm` (customer, JSON) — `{ stage, profile, log: [...] }`, this
  app's CRM record. `profile` holds company, contact, financeEmail,
  otherEmails, phone, address, labels, lastContacted and (if imported)
  notionId. Its company name is the one Trade Hub shows.
- `tapedup_admin.starter_templates` (app-data metafield on the app
  installation, JSON) — the offer templates.
- Orders of trade accounts only are synced into memory and cached in
  `localStorage` (compact: ids, dates, totals, line items — no names or
  emails), so reopening the app only fetches orders updated since the last
  sync. Dates use `processedAt`, so back-dated imported orders land on the
  day they were placed.

Without the `read_all_orders` scope Shopify only returns the last 60 days of
orders; the app says so and limits the dashboard to 30 days.

## Importing from Notion

`js/importer.js` + `js/views/import.js`. You pick a JSON export of the Notion
dealer tracker in the browser. It's customer data, so it is never committed
here (this repo is public). For each dealer you confirm the matching
Shopify customer (same Notion id, email or name is picked for you; a shared
email domain is only suggested) or create a new trade account. Then:

- the customer is tagged `b2b` and given the Notion address if they have none;
- the CRM profile, call notes and last-contacted date are saved;
- each invoice becomes a Shopify order: back-dated, archived, one line at the
  invoice value, no tax, no receipt emails, no stock, tagged `notion-import`
  with the Notion page id as `sourceIdentifier`. Prizes go in at £0, unpaid /
  terms invoices as payment pending, and anything not fulfilled in Notion as
  unfulfilled. Invoices already in Shopify by name (e.g. `TUP1329`) are
  skipped. A waiting starter offer is moved along so the back-dated orders
  don't use it up.

Running it again only adds what's missing. Creating orders needs the
`write_orders` scope.

## Code

`index.html` (shell) · `app.css` (design tokens + components) ·
`js/api.js` (GraphQL with cost-based pacing) · `js/store.js` (data, sync,
insights) · `js/importer.js` (Notion import) · `js/ui.js` (templating,
formatters, drawer, charts) · `js/views/*.js` (one per screen).
