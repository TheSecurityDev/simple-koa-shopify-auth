import { Context } from "koa";

export const TOP_LEVEL_OAUTH_COOKIE_NAME = "shopifyTopLevelOAuth"; // If this is set, then it knows to perform inline oauth

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
  return function topLevelOAuthRedirect(ctx: Context) {
    setTopLevelOAuthCookieValue(ctx, "1");
    redirect(ctx);
  };
}

export function createTopLevelRedirect(apiKey: string, path: string) {
  return function topLevelRedirect(ctx: Context) {
    const { host, query } = ctx;
    const shop = query.shop ? query.shop.toString() : "";
    const params = { shop };
    const queryString = new URLSearchParams(params).toString(); // Use this instead of ctx.queryString, because it sanitizes the query parameters we are using
    ctx.body = getTopLevelRedirectScript(shop, `https://${host}${path}?${queryString}`, apiKey);
  };
}

// TODO: Can we not use unpkg.com? (because sometimes it's very slow)
function getTopLevelRedirectScript(origin: string, redirectTo: string, apiKey: string): string {
  return `
    <script src="https://unpkg.com/@shopify/app-bridge@^1"></script> <script type="text/javascript">
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
