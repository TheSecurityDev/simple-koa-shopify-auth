import { readFile } from "fs/promises";
import { resolve as resolvePath } from "path";

import Shopify from "@shopify/shopify-api";
import { Context } from "koa";

export const TOP_LEVEL_OAUTH_COOKIE_NAME = "shopifyTopLevelOAuth"; // If this is set, then it knows to perform inline oauth
const RELATIVE_APP_BRIDGE_PATH = "../app-bridge/app-bridge@3.2.6.js";
const APP_BRIDGE_FILE_PATH = resolvePath(__dirname, RELATIVE_APP_BRIDGE_PATH); // Get global path from relative path to this module

export function shouldPerformTopLevelOAuth({ cookies }: Context) {
  return Boolean(cookies.get(TOP_LEVEL_OAUTH_COOKIE_NAME));
}

export function setTopLevelOAuthCookieValue(ctx: Context, value: string | null) {
  ctx.cookies.set(
    TOP_LEVEL_OAUTH_COOKIE_NAME,
    value,
    value != null ? getCookieOptions(ctx) : undefined
  );
}

function getCookieOptions(ctx: Context) {
  const { header } = ctx;
  const userAgent = header["user-agent"];
  const isChrome = userAgent && userAgent.match(/chrome|crios/i);
  let cookieOptions = {};
  if (isChrome) {
    cookieOptions = { secure: true };
  }
  return cookieOptions;
}

export async function startTopLevelOauthRedirect(ctx: Context, apiKey: string, path: string) {
  setTopLevelOAuthCookieValue(ctx, "1");
  let { query } = ctx;
  const hostName = Shopify.Context.HOST_NAME; // Use this instead of ctx.host to prevent issues when behind a proxy
  const shop = query.shop ? query.shop.toString() : "";
  const host = query.host ? query.host.toString() : "";
  const params = { shop, host };
  const queryString = new URLSearchParams(params).toString(); // Use this instead of ctx.querystring, because it sanitizes the query parameters we are using
  ctx.body = await getTopLevelRedirectScript(
    host,
    `https://${hostName}${path}?${queryString}`,
    apiKey
  );
}

async function getTopLevelRedirectScript(host: string, redirectTo: string, apiKey: string) {
  let shopName = "";
  try {
    const decodedHost = Buffer.from(host, "base64").toString("utf8");
    const shopFromOldHost = decodedHost.match(/([\w-]*).myshopify.com\/admin/);
    const shopFromNewHost = decodedHost.match(/admin.shopify.com\/store\/([\w-]*)/);
    shopName = shopFromNewHost ? shopFromNewHost[1] : shopFromOldHost ? shopFromOldHost[1] : "";
  } catch (error) {
    console.error("Error decoding host", error);
  }
  // We used to load the script from unpkg.com, but that sometimes was too slow, so we are now loading the script file directly and injecting the code.
  const appBridgeScript = await readFile(APP_BRIDGE_FILE_PATH);
  return `
    <!-- Shopify App Bridge -->
    <script type="text/javascript">${appBridgeScript}</script>
    <script type="text/javascript">
      document.addEventListener('DOMContentLoaded', function() {
        const apiKey = '${apiKey}';
        const redirectUrl = '${redirectTo}';
        const host = '${encodeURI(host)}';
        const hostManual = '${encodeURI(
          Buffer.from(`admin.shopify.com/store/${shopName}`, "utf8").toString("base64")
        )}'; // This is the manual host that we use to redirect to the new admin
        if (window.top === window.self) {
          // If the current window is the 'parent', change the URL by setting location.href
          window.location.href = redirectUrl;
        } else {
          // If the current window is the 'child', change the parent's URL with postMessage
          var AppBridge = window['app-bridge'];
          var createApp = AppBridge.default;
          var Redirect = AppBridge.actions.Redirect;
          try {
            var app = createApp({ 
              apiKey,
              host
            });
            var redirect = Redirect.create(app);
            redirect.dispatch(Redirect.Action.REMOTE, redirectUrl);
          } catch (e) {
            console.error(e);
          }
          try {
            if (atob(host) !== atob(hostManual)) {
              // For some reason, we get the old host parameter sometimes when using the new admin.shopify.com domain, and this causes issues with the redirect.
              // So we will create a second redirect using the new host, just in case.
              var app = createApp({
                apiKey,
                host: hostManual
              });
              var redirect = Redirect.create(app);
              redirect.dispatch(Redirect.Action.REMOTE, redirectUrl);
            }
          } catch (e) {
            console.error(e);
          }
        }
      });
    </script>
  `;
}
