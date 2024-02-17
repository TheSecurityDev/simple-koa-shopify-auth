import Shopify from "@shopify/shopify-api";
import { MissingJwtTokenError, HttpResponseError } from "@shopify/shopify-api/dist/error";
import { JwtPayload } from "@shopify/shopify-api/dist/utils/decode-session-token";
import { Context } from "koa";

export enum ReauthHeader {
  Reauthorize = "X-Shopify-API-Request-Failure-Reauthorize",
  ReauthorizeUrl = "X-Shopify-API-Request-Failure-Reauthorize-Url",
}

/** Throw the error, unless it's an `HttpResponseError` with status `401`. */
export function throwUnlessAuthError(err: HttpResponseError | Error | unknown) {
  if (err instanceof HttpResponseError) {
    // NOTE: Shopify API v3+ uses 'response.code' instead of 'code'
    const code = (err as any)?.code ?? err.response?.code;
    if (code === 401) return; // Catch the 401 error so we can re-authorize
  }
  throw err; // Throw any other errors
}

/** Set the response status to 401 and add the appropriate headers to tell the client to reauthorize. */
export function setReauthResponse(ctx: Context, reauthUrl: string) {
  ctx.response.status = 401;
  ctx.response.set(ReauthHeader.Reauthorize, "1"); // Tell the client to re-authorize by setting the reauth header
  ctx.response.set(ReauthHeader.ReauthorizeUrl, reauthUrl); // Tell the client where to re-authorize
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
