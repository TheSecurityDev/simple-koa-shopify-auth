"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTopLevelRedirect = exports.createTopLevelOAuthRedirect = exports.setTopLevelOAuthCookieValue = exports.TOP_LEVEL_OAUTH_COOKIE_NAME = void 0;
const promises_1 = require("fs/promises");
const path_1 = require("path");
exports.TOP_LEVEL_OAUTH_COOKIE_NAME = "shopifyTopLevelOAuth"; // If this is set, then it knows to perform inline oauth
const RELATIVE_APP_BRIDGE_PATH = "../app-bridge/app-bridge@2.0.5.js";
const APP_BRIDGE_FILE_PATH = (0, path_1.resolve)(__dirname, RELATIVE_APP_BRIDGE_PATH); // Get global path from relative path to this module
function setTopLevelOAuthCookieValue(ctx, value) {
    ctx.cookies.set(exports.TOP_LEVEL_OAUTH_COOKIE_NAME, value, value != null ? getCookieOptions(ctx) : undefined);
}
exports.setTopLevelOAuthCookieValue = setTopLevelOAuthCookieValue;
function getCookieOptions(ctx) {
    const { header } = ctx;
    const userAgent = header["user-agent"];
    const isChrome = userAgent && userAgent.match(/chrome|crios/i);
    let cookieOptions = {};
    if (isChrome) {
        cookieOptions = { secure: true };
    }
    return cookieOptions;
}
function createTopLevelOAuthRedirect(apiKey, path, host) {
    const redirect = createTopLevelRedirect(apiKey, path, host);
    return function topLevelOAuthRedirect(ctx) {
        return __awaiter(this, void 0, void 0, function* () {
            setTopLevelOAuthCookieValue(ctx, "1");
            yield redirect(ctx);
        });
    };
}
exports.createTopLevelOAuthRedirect = createTopLevelOAuthRedirect;
function createTopLevelRedirect(apiKey, path, hostname) {
    return function topLevelRedirect(ctx) {
        return __awaiter(this, void 0, void 0, function* () {
            let { host, query } = ctx;
            if (typeof hostname === 'string') {
                host = hostname;
            }
            const shop = query.shop ? query.shop.toString() : "";
            const params = { shop };
            const queryString = new URLSearchParams(params).toString(); // Use this instead of ctx.queryString, because it sanitizes the query parameters we are using
            ctx.body = yield getTopLevelRedirectScript(shop, `https://${host}${path}?${queryString}`, apiKey);
        });
    };
}
exports.createTopLevelRedirect = createTopLevelRedirect;
function getTopLevelRedirectScript(origin, redirectTo, apiKey) {
    return __awaiter(this, void 0, void 0, function* () {
        // We used to load the script from unpkg.com, but that sometimes was too slow, so we are now loading the script file directly and injecting the code.
        const appBridgeScript = yield (0, promises_1.readFile)(APP_BRIDGE_FILE_PATH);
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
    });
}
//# sourceMappingURL=top-level-oauth-redirect.js.map