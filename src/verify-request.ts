import Shopify from "@shopify/shopify-api";
import { Session } from "@shopify/shopify-api/dist/auth/session";
import { Context, Next } from "koa";

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

      if (session && session.isActive()) {
        // There's no need to check the access token by calling the API, because the JWT token expires after 1 minute, so the only way we can be here is if Shopify gave the user a valid JWT token.
        setTopLevelOAuthCookieValue(ctx, null); // Clear the cookie
        try {
          await next();
          return;
        } catch (err) {
          // If there's an error handling the request, we will check if it's a 401 http response error, and if so, we will re-authorize
          const code = err?.code || err?.response?.code;
          if (code === 401) {
            // We need to re-authorize
          } else {
            throw err;
          }
        }
      }

      // ! If we get here then the session was not valid and we need to re-authorize
      if (returnHeader) {
        // Return a header to the client so they can re-authorize
        ctx.response.status = 401;
        ctx.response.set(REAUTH_HEADER, "1"); // Tell the client to re-authorize by setting the reauth header
        // Get the shop from the session, or the auth header (we can't get it from the query if we're making a post request)
        let reauthUrl = authRoute;
        if (Shopify.Context.IS_EMBEDDED_APP) {
          reauthUrl += `?${getShopAndHostQueryStringFromAuthHeader(ctx)}`;
        } else {
          reauthUrl += `?${new URL(ctx.header.referer).search}`; // Get parameters from the referer header (not completely sure if this will work)
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

function getShopAndHostQueryStringFromAuthHeader(ctx: Context): string {
  const authHeader: string = ctx.req.headers.authorization;
  const matches = authHeader?.match(/Bearer (.*)/);
  if (matches) {
    const payload = Shopify.Utils.decodeSessionToken(matches[1]);
    const shop = payload.dest.replace("https://", "");
    const host = Buffer.from(payload.iss.replace("https://", "")).toString("base64");
    return new URLSearchParams({ shop, host }).toString();
  }
  return null;
}
