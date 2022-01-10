import { readFile } from "fs/promises";
import { resolve as resolvePath } from "path";
import { Context } from "koa";

export const TOP_LEVEL_OAUTH_COOKIE_NAME = "shopifyTopLevelOAuth"; // If this is set, then it knows to perform inline oauth
const RELATIVE_APP_BRIDGE_PATH = "../app-bridge/app-bridge@2.0.5.js";
const APP_BRIDGE_FILE_PATH = resolvePath(__dirname, RELATIVE_APP_BRIDGE_PATH); // Get global path from relative path to this module

export function setTopLevelOAuthCookieValue(ctx: Context, value: string) {
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

export function createTopLevelOAuthRedirect(apiKey: string, path: string) {
  const redirect = createTopLevelRedirect(apiKey, path);
  return async function topLevelOAuthRedirect(ctx: Context) {
    setTopLevelOAuthCookieValue(ctx, "1");
    await redirect(ctx);
  };
}

export function createTopLevelRedirect(apiKey: string, path: string) {
  return async function topLevelRedirect(ctx: Context) {
    const { host, query } = ctx;
    const shop = query.shop ? query.shop.toString() : "";
    const params = { shop };
    const queryString = new URLSearchParams(params).toString(); // Use this instead of ctx.queryString, because it sanitizes the query parameters we are using
    ctx.body = await getTopLevelRedirectScript(
      shop,
      `https://${host}${path}?${queryString}`,
      apiKey
    );
  };
}

async function getTopLevelRedirectScript(origin: string, redirectTo: string, apiKey: string) {
  // We used to load the script from unpkg.com, but that sometimes was too slow, so we are now loading the script file directly and injecting the code.
  const appBridgeScript = await readFile(APP_BRIDGE_FILE_PATH);
  return `
    <!-- Shopify App Bridge -->
    <!-- <script src="https://unpkg.com/@shopify/app-bridge@^2"></script> -->
    <script type="text/javascript">${appBridgeScript}</script>
    <script type="text/javascript">
      document.addEventListener('DOMContentLoaded', function() {
        if (window.top === window.self) {
          // If the current window is the 'parent', change the URL by setting location.href
          window.location.href = "${redirectTo}";
        } else {
          // If the current window is the 'child', change the parent's URL with postMessage
          var AppBridge = window['app-bridge'];
          var createApp = AppBridge.default;
          var Redirect = AppBridge.actions.Redirect;
          var app = createApp({
            apiKey: "${apiKey}",
            shopOrigin: "${encodeURI(origin)}",
          });
          var redirect = Redirect.create(app);
          redirect.dispatch(Redirect.Action.REMOTE, "${redirectTo}");
        }
      });
    </script>
  `;
}
