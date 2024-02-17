import Shopify from "@shopify/shopify-api";
import { Session } from "@shopify/shopify-api/dist/auth/session";
import { Context, Next } from "koa";
import { LRUCache } from "lru-cache";

import { exchangeSessionTokenForAccessTokenSession } from "./token-exchange";
import { setTopLevelOAuthCookieValue } from "./top-level-oauth-redirect";
import {
  getEncodedSessionToken,
  getShopFromSessionToken,
  getShopAndHostQueryStringFromSessionToken,
  setReauthResponse,
  throwUnlessAuthError,
} from "./utils";

type VerifyRequestOptions = {
  accessMode?: "online" | "offline";
  returnHeader?: boolean;
  authRoute?: string;
  afterSessionRefresh?: (ctx: Context, session: Session) => Promise<void>;
};

const defaultOptions: Omit<Required<VerifyRequestOptions>, "afterSessionRefresh"> = {
  accessMode: "online",
  authRoute: "/auth",
  returnHeader: false,
};

export default function verifyRequest(options?: VerifyRequestOptions) {
  const { accessMode, returnHeader, authRoute, afterSessionRefresh } = {
    ...defaultOptions,
    ...options,
  };

  return async function verifyTokenMiddleware(ctx: Context, next: Next) {
    try {
      const { query, querystring } = ctx;

      // Load the user's access token session (this will validate the JWT signature of the request session token, so we know that it was signed by Shopify)
      const sessionData = await Shopify.Utils.loadCurrentSession(
        ctx.req,
        ctx.res,
        accessMode === "online"
      );

      if (sessionData) {
        // Create session instance from loaded session data so we can call isActive() method on it
        const session = Session.cloneSession(sessionData, sessionData.id);

        // Login again if the shops don't match (not every request will have a shop query parameter, so only check if it's present)
        const shopParam = query.shop?.toString() ?? "";
        if (shopParam && session.shop !== shopParam) {
          console.warn(
            `Shop '${shopParam}' does not match session shop '${session.shop}'. Redirecting to auth route...`
          );
          await clearSession(ctx, accessMode);
          ctx.redirect(`${authRoute}?${querystring}`);
          return;
        }

        // Verify session is valid
        try {
          if (session.isActive()) {
            await checkAccessTokenOnShopifyAPI(session); // Check access token and throw a 401 error if it's invalid
            setTopLevelOAuthCookieValue(ctx, null); // Clear the top level oauth cookie since we have a valid session
            return next(); // Continue to the next middleware since the session is valid
          }
        } catch (err) {
          throwUnlessAuthError(err);
        }
      }

      // ! The session is missing or invalid, so we need to get a new one.

      // Get the session token from the authorization header (only if it's an embedded app)
      const isEmbeddedApp = Shopify.Context.IS_EMBEDDED_APP;
      const encodedSessionToken = isEmbeddedApp ? getEncodedSessionToken(ctx) : null;
      const sessionToken = encodedSessionToken
        ? Shopify.Utils.decodeSessionToken(encodedSessionToken)
        : null;

      if (encodedSessionToken && sessionToken) {
        const shop = getShopFromSessionToken(sessionToken);
        // Exchange the session token for a session with an access token
        const session = await exchangeSessionTokenForAccessTokenSession(
          shop,
          encodedSessionToken,
          accessMode
        );
        // Check if the session is valid before saving it
        if (session.isActive()) {
          // Save the new session
          await Shopify.Utils.storeSession(session);
          // Call the afterSessionRefresh callback if provided
          await afterSessionRefresh?.(ctx, session);
          // Clear the top level oauth cookie since we have a valid session (maybe not necessary, but just in case)
          setTopLevelOAuthCookieValue(ctx, null);
          // Continue to the next middleware since the session is valid
          return next();
        } else {
          console.warn(
            `The session '${session.id}' we just got from Shopify is not active for shop '${shop}'`
          );
        }
      }

      // ! Exchanging the session token for an access token failed, so we have to reauthenticate using the auth route.

      // We need to redirect to the auth route to get a new session
      if (returnHeader && sessionToken) {
        // Set the reauth headers and status code
        const reauthUrl = `${authRoute ?? ""}?${getShopAndHostQueryStringFromSessionToken(
          sessionToken
        )}`;
        setReauthResponse(ctx, reauthUrl);
      } else {
        // Otherwise redirect to the auth page
        ctx.redirect(`${authRoute}?${querystring}`);
      }

      // Catch JWT session token errors
    } catch (err: any) {
      if (err instanceof Shopify.Errors.InvalidJwtError) {
        ctx.throw(401, `Invalid JWT token: ${err.message}`);
      } else if (err instanceof Shopify.Errors.MissingJwtTokenError) {
        ctx.throw(401, `Missing JWT token: ${err.message}`);
      }
      ctx.throw(500, err instanceof Error ? err.message : "Unknown error");
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

// Cache the results of the verify access token request
const VERIFY_TOKEN_REQUEST_CACHE = new LRUCache({
  max: 1000,
  ttl: 1000 * 60 * 60, // 1 hour
});

async function checkAccessTokenOnShopifyAPI(session: Session) {
  const { shop, accessToken } = session;
  // Theoretically there's no need to check the access token by calling the API, because the JWT token expires after 1 minute, so the only way we can be here is if Shopify gave the user a valid JWT token.
  // However, in case the access token has been corrupted in the database or something, we should check it at least once by calling the API.
  // We can cache the result of this call so we don't have to call it every time, since it's really only needed once.
  const cacheKey = `${shop}:${accessToken}`;
  if (!VERIFY_TOKEN_REQUEST_CACHE.get(cacheKey)) {
    // We haven't verified this access token yet, so make a request to make sure the token is valid on Shopify's end.
    // If it's not valid, it will throw a 401 error and have to re-authorize.
    const client = new Shopify.Clients.Rest(shop, accessToken);
    await client.get({ path: "shop" }); // Fetch /shop route on Shopify to verify the token is valid
    VERIFY_TOKEN_REQUEST_CACHE.set(cacheKey, true); // Cache the result
  }
}
