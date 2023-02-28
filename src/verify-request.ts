import Shopify from "@shopify/shopify-api";
import { Session } from "@shopify/shopify-api/dist/auth/session";
import { HttpResponseError } from "@shopify/shopify-api/dist/error";
import { Context, Next } from "koa";
import LRUCache from "lru-cache";

import { setTopLevelOAuthCookieValue } from "./top-level-oauth-redirect";

type VerifyRequestOptions = {
  accessMode?: "online" | "offline";
  returnHeader?: boolean;
  authRoute?: string;
};

const defaultOptions: VerifyRequestOptions = {
  accessMode: "online",
  authRoute: "/auth",
  returnHeader: false,
};

const REAUTH_HEADER = "X-Shopify-API-Request-Failure-Reauthorize";
const REAUTH_URL_HEADER = "X-Shopify-API-Request-Failure-Reauthorize-Url";

export default function verifyRequest(options?: VerifyRequestOptions) {
  const { accessMode, returnHeader, authRoute } = {
    ...defaultOptions,
    ...options,
  };

  return async function verifyTokenMiddleware(ctx: Context, next: Next) {
    try {
      // Load the current session (this will validate the JWT signature, so we know that the token was signed by Shopify)
      const sessionData = await Shopify.Utils.loadCurrentSession(
        ctx.req,
        ctx.res,
        accessMode === "online"
      );
      // Create session instance from loaded session data (if available), so we can call isActive() method on it
      const session = sessionData ? Session.cloneSession(sessionData, sessionData.id) : null;

      const { query, querystring } = ctx;
      const shop = query.shop ? query.shop.toString() : "";

      // Login again if the shops don't match
      if (session && shop && session.shop !== shop) {
        await clearSession(ctx, accessMode);
        ctx.redirect(`${authRoute}?${querystring}`);
        return;
      }

      if (session) {
        // Verify session is valid
        try {
          if (session.isActive()) {
            checkSessionOnShopifyAPI(session); // Throws a 401 error if the access token is invalid
            // If we get here, the session is valid
            setTopLevelOAuthCookieValue(ctx, null); // Clear the cookie
            await next();
            return;
          }
        } catch (err) {
          if (
            err instanceof HttpResponseError &&
            ((err as any)?.code === 401 || err.response?.code === 401) // Shopify API v3+ uses 'response.code' instead of 'code'
          ) {
            // Session not valid, we will re-authorize
          } else {
            throw err;
          }
        }
      }

      // ! If we get here, either the session is invalid or we need to re-authorize

      // We need to re-authenticate
      if (returnHeader) {
        // Return a header to the client so they can re-authorize
        ctx.response.status = 401;
        ctx.response.set(REAUTH_HEADER, "1"); // Tell the client to re-authorize by setting the reauth header
        // Get the shop from the session, or the auth header (we can't get it from the query if we're making a post request)
        let reauthUrl = authRoute ?? "";
        if (Shopify.Context.IS_EMBEDDED_APP) {
          reauthUrl += `?${getShopAndHostQueryStringFromAuthHeader(ctx)}`;
        } else {
          reauthUrl += `?${new URL(ctx.header.referer ?? "").search}`; // Get parameters from the referer header (not completely sure if this will work)
        }
        ctx.response.set(REAUTH_URL_HEADER, reauthUrl); // Set the reauth url header
      } else {
        // Otherwise redirect to the auth page
        ctx.redirect(`${authRoute}?${querystring}`);
      }

      // Catch session errors and redirect to auth page
    } catch (err) {
      if (
        err instanceof Shopify.Errors.InvalidJwtError ||
        err instanceof Shopify.Errors.MissingJwtTokenError ||
        err instanceof Shopify.Errors.SessionNotFound
      ) {
        console.warn(err.message);
        // If the session is invalid, clear the session and redirect to the auth route
        await clearSession(ctx, accessMode);
        ctx.redirect(`${authRoute}?${getShopAndHostQueryStringFromAuthHeader(ctx)}`);
        return;
      } else {
        throw err;
      }
    }
  };
}

async function clearSession(ctx: Context, accessMode = defaultOptions.accessMode) {
  try {
    await Shopify.Utils.deleteCurrentSession(ctx.req, ctx.res, accessMode === "online");
  } catch (error) {
    if (error instanceof Shopify.Errors.SessionNotFound) {
      // We can just move on if no sessions were cleared
    } else {
      throw error;
    }
  }
}

const VERIFY_TOKEN_REQUEST_CACHE = new LRUCache({
  max: 1000,
  maxAge: 1000 * 60 * 60, // 1 hour
}); // Cache the results of the verify access token request

async function checkSessionOnShopifyAPI(session: Session) {
  const { shop, accessToken } = session;
  // Theoretically there's no need to check the access token by calling the API, because the JWT token expires after 1 minute, so the only way we can be here is if Shopify gave the user a valid JWT token.
  // However, in case the access token has been corrupted in the database or something, we should check it at least once by calling the API.
  // We can cache the result of this call so we don't have to call it every time, since it's really only needed once.
  const cacheKey = `${shop}:${accessToken}`;
  if (!VERIFY_TOKEN_REQUEST_CACHE.get(cacheKey)) {
    // We haven't verified this access token yet, so make a request to make sure the token is valid on Shopify's end.
    // If it's not valid, we'll get a 401 and have to re-authorize.
    const client = new Shopify.Clients.Rest(shop, accessToken);
    await client.get({ path: "shop" }); // Fetch /shop route on Shopify to verify the token is valid
    VERIFY_TOKEN_REQUEST_CACHE.set(cacheKey, true); // Cache the result
  }
}

function getShopAndHostQueryStringFromAuthHeader(ctx: Context): string | null {
  const authHeader: string = ctx.req.headers.authorization ?? "";
  const matches = authHeader?.match(/Bearer (.*)/);
  if (matches) {
    const payload = Shopify.Utils.decodeSessionToken(matches[1]);
    const shop = payload.dest.replace("https://", "");
    const host = Buffer.from(payload.iss.replace("https://", "")).toString("base64");
    return new URLSearchParams({ shop, host }).toString();
  }
  return null;
}
