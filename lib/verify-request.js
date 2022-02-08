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
const session_1 = require("@shopify/shopify-api/dist/auth/session");
const error_1 = require("@shopify/shopify-api/dist/error");
const top_level_oauth_redirect_1 = require("./top-level-oauth-redirect");
const defaultOptions = {
    accessMode: "online",
    authRoute: "/auth",
    returnHeader: false,
};
const REAUTH_HEADER = "X-Shopify-API-Request-Failure-Reauthorize";
const REAUTH_URL_HEADER = "X-Shopify-API-Request-Failure-Reauthorize-Url";
function getAuthUrl(authRoute, shop) {
    return `${authRoute}?shop=${shop}`;
}
function verifyRequest(options) {
    const { accessMode, returnHeader, authRoute } = Object.assign(Object.assign({}, defaultOptions), options);
    return function verifyTokenMiddleware(ctx, next) {
        return __awaiter(this, void 0, void 0, function* () {
            const sessionData = yield shopify_api_1.default.Utils.loadCurrentSession(ctx.req, ctx.res, accessMode === "online");
            // Create session instance from loaded session data (if available), so we can call isActive() method on it
            const session = sessionData ? session_1.Session.cloneSession(sessionData, sessionData.id) : null;
            const { query } = ctx;
            const shop = query.shop ? query.shop.toString() : "";
            // Login again if the shops don't match
            if (session && shop && session.shop !== shop) {
                yield clearSession(ctx, accessMode);
                const redirectUrl = getAuthUrl(authRoute, shop);
                ctx.redirect(redirectUrl);
                return;
            }
            if (session) {
                // Verify session is valid
                if (session.isActive()) {
                    try {
                        // I think we need to verify on Shopify's side that the access token is valid, because otherwise anyone could just make their own 'valid' token and use it.
                        //   Of course if we're making requests to Shopify's API afterwords it will fail with an error, but we still need this check since we aren't always making a Shopify request when verifying this token (it might be an API request for our server, and we need to be sure it's the correct user).
                        // Make a request to make sure the token is valid on Shopify's end. If not, we'll get a 401 and have to re-authorize.
                        const client = new shopify_api_1.default.Clients.Rest(session.shop, session.accessToken);
                        yield client.get({ path: "shop" }); // Fetch /shop route on Shopify to verify the token is valid
                        (0, top_level_oauth_redirect_1.setTopLevelOAuthCookieValue)(ctx, null); // Clear the cookie
                        yield next();
                        return;
                    }
                    catch (err) {
                        if (err instanceof error_1.HttpResponseError && err.code == 401) {
                            // Session not valid, we will re-authorize
                        }
                        else {
                            throw err;
                        }
                    }
                }
            }
            // If we get here, either the session is invalid or we need to re-authorize
            // We need to re-authenticate
            if (returnHeader) {
                // Return a header to the client so they can re-authorize
                ctx.response.status = 401;
                ctx.response.set(REAUTH_HEADER, "1"); // Tell the client to re-authorize by setting the reauth header
                // Get the shop from the session, or the auth header (we can't get it from the query if we're making a post request)
                let shop;
                if (session) {
                    shop = session.shop; // Get shop from the session token
                }
                else if (shopify_api_1.default.Context.IS_EMBEDDED_APP) {
                    shop = getShopFromAuthHeader(ctx); // Get shop from auth header
                }
                const reauthUrl = getAuthUrl(authRoute, shop);
                ctx.response.set(REAUTH_URL_HEADER, reauthUrl); // Set the reauth url header
            }
            else {
                // Otherwise redirect to the auth page
                const redirectUrl = getAuthUrl(authRoute, shop);
                ctx.redirect(redirectUrl);
            }
        });
    };
}
exports.default = verifyRequest;
function clearSession(ctx, accessMode = defaultOptions.accessMode) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield shopify_api_1.default.Utils.deleteCurrentSession(ctx.req, ctx.res, accessMode === "online");
        }
        catch (error) {
            if (error instanceof shopify_api_1.default.Errors.SessionNotFound) {
                // We can just move on if no sessions were cleared
            }
            else {
                throw error;
            }
        }
    });
}
function getShopFromAuthHeader(ctx) {
    const authHeader = ctx.req.headers.authorization;
    const matches = authHeader === null || authHeader === void 0 ? void 0 : authHeader.match(/Bearer (.*)/);
    if (matches) {
        const payload = shopify_api_1.default.Utils.decodeSessionToken(matches[1]);
        const shop = payload.dest.replace("https://", "");
        return shop;
    }
    return null;
}
//# sourceMappingURL=verify-request.js.map