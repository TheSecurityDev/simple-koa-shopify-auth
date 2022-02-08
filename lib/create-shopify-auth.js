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
const shopify_api_1 = require("@shopify/shopify-api");
const top_level_oauth_redirect_1 = require("./top-level-oauth-redirect");
function shouldPerformInlineOAuth({ cookies }) {
    return Boolean(cookies.get(top_level_oauth_redirect_1.TOP_LEVEL_OAUTH_COOKIE_NAME));
}
function createShopifyAuth(options) {
    const config = Object.assign({ accessMode: "online", authPath: "/auth" }, options);
    const { authPath: oAuthStartPath } = config;
    if (!oAuthStartPath.startsWith("/") || oAuthStartPath.endsWith("/")) {
        throw new Error(`Invalid auth path: '${oAuthStartPath}'. Must be a relative path without a trailing slash (eg. '/auth').`);
    }
    const oAuthCallbackPath = `${oAuthStartPath}/callback`;
    const inlineOAuthPath = `${oAuthStartPath}/inline`;
    const topLevelOAuthRedirect = (0, top_level_oauth_redirect_1.createTopLevelOAuthRedirect)(shopify_api_1.default.Context.API_KEY, inlineOAuthPath, options.host);
    // This executes for every request
    return function shopifyAuthMiddleware(ctx, next) {
        return __awaiter(this, void 0, void 0, function* () {
            const { cookies, query, path } = ctx;
            const shop = query.shop ? query.shop.toString() : "";
            cookies.secure = true;
            if (path === inlineOAuthPath || (path === oAuthStartPath && shouldPerformInlineOAuth(ctx))) {
                // Auth started
                if (!shopify_api_1.default.Utils.validateShop(shop)) {
                    // Invalid shop
                    ctx.response.status = 400;
                    ctx.response.body = shop ? "Invalid shop parameter" : "Missing shop parameter";
                    return;
                }
                // Begin auth process (redirect to Shopify for inline auth)
                (0, top_level_oauth_redirect_1.setTopLevelOAuthCookieValue)(ctx, "");
                const redirectUrl = yield shopify_api_1.default.Auth.beginAuth(ctx.req, ctx.res, shop, oAuthCallbackPath, config.accessMode === "online");
                ctx.redirect(redirectUrl);
                return;
            }
            if (path === oAuthStartPath) {
                yield topLevelOAuthRedirect(ctx);
                return;
            }
            if (path === oAuthCallbackPath) {
                // Auth callback
                try {
                    const session = yield shopify_api_1.default.Auth.validateAuthCallback(ctx.req, ctx.res, query);
                    ctx.state.shopify = session;
                    if (config.afterAuth) {
                        yield config.afterAuth(ctx);
                    }
                }
                catch (err) {
                    switch (true) {
                        case err instanceof shopify_api_1.default.Errors.InvalidOAuthError:
                            ctx.throw(400, err.message);
                            break;
                        case err instanceof shopify_api_1.default.Errors.CookieNotFound:
                        case err instanceof shopify_api_1.default.Errors.SessionNotFound:
                            // This is likely because the OAuth session cookie expired before the merchant approved the request
                            ctx.redirect(`${oAuthStartPath}?shop=${shop}`);
                            break;
                        default:
                            ctx.throw(500, err.message);
                            break;
                    }
                }
                return;
            }
            yield next();
        });
    };
}
exports.default = createShopifyAuth;
//# sourceMappingURL=create-shopify-auth.js.map