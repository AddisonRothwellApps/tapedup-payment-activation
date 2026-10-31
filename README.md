# tapedup-payment-activation

One-time static admin page for activating the `hide-terms-payment` Shopify
Function shipped from the `tapedup-payment-rules` app. No backend — uses
Shopify's [direct API access](https://shopify.dev/docs/api/app-home/apis/authentication-and-data/resource-fetching-api)
(`shopify:admin/api/graphql.json` via App Bridge) to call
`paymentCustomizationCreate`/`paymentCustomizationUpdate` straight from the
browser, authenticated by the embedded session — no client secret anywhere
in this repo.

Hosted on GitHub Pages and set as this Shopify app's `application_url`, so
it's what merchants land on from **Settings → Payments → Payment
customizations → Hide trade-account payment method**.

Besides the one-time activation panels it has two settings panels:
**B2B shipping amounts** (saved on that discount's config metafield) and
**Starter orders** — give a specific customer a one-time starter order
(products + a % or £ off the whole order, optional expiry). That offer is
saved as JSON on the customer (metafield `tapedup.starter_offer`, plus a
`starter-order` tag so the panel can list them); the
`starter-order-discount` function and the theme's
`snippets/starter-offer.liquid` both read it.
