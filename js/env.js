// Where Trade Hub is running.
//   embedded:   inside Shopify admin (an iframe served from GitHub Pages).
//               App Bridge authenticates fetch('shopify:admin/...').
//   standalone: at trade.tapedup.co.uk, signed in with Microsoft 365.
//               The trade server forwards Admin API calls with the app's
//               own token, so both copies read and write the same data.
export const EMBEDDED = window.self !== window.top;

// The trade server, which the embedded copy links to from Setup.
export const TRADE_SERVER = 'https://trade.tapedup.co.uk';
