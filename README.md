# tapedup-payment-activation

The TapedUp admin: the embedded Shopify app screen for `tapedup-payment-rules`,
styled on the TapedUp design system. A small CRM plus the setup for the
app's checkout rules. No backend — it's static files on GitHub Pages (set as
the app's `application_url`) that call the Admin API straight from the
browser through Shopify's
[direct API access](https://shopify.dev/docs/api/app-home/apis/authentication-and-data/resource-fetching-api)
(`fetch('shopify:admin/api/graphql.json')` via App Bridge), authenticated by
the embedded session. No client secret anywhere in this repo.

## Screens (hash routes, since GitHub Pages can't serve /customers)

- **Dashboard** `#/` — revenue, orders, customers ordering and average order vs
  the previous period; revenue chart; best tapes; best dealers; who's ordering
  more / less; follow-ups due; who's past their usual reorder time. One filter
  row (30 days / 90 days / 12 months × all / trade / retail) scopes it all.
- **Customers** `#/customers` and `#/customers/<id>` — the CRM list (search,
  filters, sort, CSV export, bulk "give starter offer", add customer) and
  each customer's page: stats, spend by month, best tapes, orders, starter
  offer, trade / terms switches, relationship stage, Shopify note, and the
  activity log (calls, emails, visits, samples, notes, with follow-up dates).
- **Orders** `#/orders` — every synced order, filterable, linking to Shopify.
- **Starter offers** `#/offers` — reusable templates (one is the default) and
  everyone who has an offer.
- **Follow-ups** `#/follow-ups` — open follow-ups (overdue / today / coming
  up) and the latest activity across all customers.
- **Setup** `#/setup` — switch on each checkout rule, B2B shipping amounts,
  and which permissions the app has.

## Where the data lives (all in Shopify)

- `tapedup.starter_offer` (customer, JSON) — the live starter order. Read by
  the `starter-order-discount` function and the theme's
  `snippets/starter-offer.liquid`; keep the shape in step with both. Customers
  with one are also tagged `starter-order`.
- `tapedup.crm` (customer, JSON) — `{ stage, log: [...] }`, this app's CRM
  record.
- `tapedup_admin.starter_templates` (app-data metafield on the app
  installation, JSON) — the offer templates.
- Orders are synced into memory and cached in `localStorage` (compact: ids,
  dates, totals, line items — no names or emails), so reopening the app only
  fetches orders updated since the last sync.

Without the `read_all_orders` scope Shopify only returns the last 60 days of
orders; the app says so and limits the dashboard to 30 days.

## Code

`index.html` (shell) · `app.css` (design tokens + components) ·
`js/api.js` (GraphQL with cost-based pacing) · `js/store.js` (data, sync,
insights) · `js/ui.js` (templating, formatters, drawer, charts) ·
`js/views/*.js` (one per screen).
