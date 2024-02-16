import Shopify from "@shopify/shopify-api";
import { MissingJwtTokenError, HttpResponseError } from "@shopify/shopify-api/dist/error";
import { JwtPayload } from "@shopify/shopify-api/dist/utils/decode-session-token";
import { Context } from "koa";

/** Throw the error, unless it's an `HttpResponseError` with status `401`. */
export function throwUnlessAuthError(err: HttpResponseError | Error | unknown) {
  if (err instanceof HttpResponseError) {
    // NOTE: Shopify API v3+ uses 'response.code' instead of 'code'
    const code = (err as any)?.code ?? err.response?.code;
    if (code === 401 || code === 403) {
      return; // Catch the 401 and 403 errors so we can re-authorize
    }
  }
  throw err; // Throw any other errors
}

////////////////////////////
// Session token utils
////////////////////////////

/** Find and return the base64 encoded JWT session token from the request authorization header in the given context. Throws an error if it wasn't found. */
export function getEncodedSessionToken(ctx: Context) {
  if (Shopify.Context.IS_EMBEDDED_APP) {
    const authHeader = ctx.req.headers.authorization ?? "";
    const matches = authHeader?.match(/Bearer (.*)/);
    if (!matches) throw new MissingJwtTokenError("Missing Bearer token in authorization header");
    return matches[1];
  } else {
    throw new Error("Session tokens are only available in embedded apps");
  }
}

// /** Parse and decode the JWT session token from the request context. */
// function parseAndDecodeSessionToken(ctx: Context) {
//   const encodedToken = getEncodedSessionToken(ctx);
//   return Shopify.Utils.decodeSessionToken(encodedToken);
// }

/** Get the shop from the JWT session token. */
export function getShopFromSessionToken(sessionToken: JwtPayload) {
  return sessionToken.dest.replace("https://", "");
}

/** Get the base64 encoded host from the JWT session token. */
function getHostFromSessionToken(sessionToken: JwtPayload) {
  return Buffer.from(sessionToken.iss.replace("https://", "")).toString("base64");
}

/** Parse given decoded session token and return the shop and host query string params. */
export function getShopAndHostQueryStringFromSessionToken(sessionToken: JwtPayload) {
  const shop = getShopFromSessionToken(sessionToken);
  const host = getHostFromSessionToken(sessionToken);
  return new URLSearchParams({ shop, host }).toString();
}
