import Shopify, { DataType, OnlineAccessResponse } from "@shopify/shopify-api";
import { HttpResponseError } from "@shopify/shopify-api/dist/error";
import { Session } from "@shopify/shopify-api/dist/auth/session";

import { createSession } from "./session";

// Cache object with current requests so we can avoid making the same request multiple times.
// This is useful when multiple API requests are made with an invalid session token, and we don't want to call the callback multiple times.
// The key is in the format `[tokenType]:[encodedSessionToken]` and the value is the promise of the request.
const currentTokenExchangeRequests = new Map<string, Promise<Session>>();

/** Given the shop, encoded JWT session token, and token type, return a session object with an access token.
    https://shopify.dev/docs/apps/auth/get-access-tokens/token-exchange

    The request will be de-duplicated, so if multiple requests are made at once with the same shop, token and token type, only one request will be made.

    @param shop The shop's myshopify domain
    @param encodedSessionToken The encoded JWT session token
    @param tokenType The type of access token to exchange for ('online' or 'offline')
    @param saveSession If true, the new session will be saved to storage (default)

    @returns The new session object
    */
export async function exchangeSessionTokenForAccessTokenSession(
  shop: string,
  encodedSessionToken: string,
  tokenType: "online" | "offline",
  saveSession = true // If true, the new session will be saved to storage
) {
  // Check if we already have a request in progress
  const key = `${shop}:${tokenType}:${encodedSessionToken}:${saveSession}`;
  const existingRequest = currentTokenExchangeRequests.get(key);
  if (existingRequest) return existingRequest; // If we already have a request in progress, use it

  // Otherwise make the request with a timeout
  const requestOrTimeout = Promise.race([
    makeTokenExchangeRequest({ shop, encodedSessionToken, tokenType, saveSession }),
    new Promise<Session>((resolve, reject) =>
      setTimeout(() => reject(new Error("Request timed out")), 10000)
    ),
  ]);

  // Save the request to the cache
  currentTokenExchangeRequests.set(key, requestOrTimeout);

  // When the request is done, remove it from the cache
  requestOrTimeout.finally(() => {
    currentTokenExchangeRequests.delete(key);
  });

  return requestOrTimeout;
}

// Internal function that makes the request to Shopify to exchange the session token for an access token. The main function is a wrapper around this one that implements de-duplicating the requests.
async function makeTokenExchangeRequest(params: {
  shop: string;
  encodedSessionToken: string;
  tokenType: "online" | "offline";
  saveSession: boolean;
}) {
  const { shop, encodedSessionToken, tokenType, saveSession } = params;

  const sanitizedShop = Shopify.Utils.sanitizeShop(shop, true);

  // Construct the request body
  const body = {
    client_id: Shopify.Context.API_KEY,
    client_secret: Shopify.Context.API_SECRET_KEY,
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: encodedSessionToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
    requested_token_type: `urn:shopify:params:oauth:token-type:${tokenType}-access-token`,
  };

  // Make the request
  const response = await fetch(`https://${sanitizedShop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": DataType.JSON, Accept: DataType.JSON },
    body: JSON.stringify(body),
  });

  // Check the response for errors
  if (!response.ok) {
    const { status, statusText, headers } = response;
    throw new HttpResponseError({
      message: `Failed to exchange session token for access token: ${status} ${statusText}`,
      code: status,
      statusText,
      body,
      headers: headers as any,
    });
  }

  // Parse the response
  const sessionResponse: OnlineAccessResponse = await response.json();

  // Create the session
  const session = createSession(sessionResponse, shop);

  // Make sure the session is active
  if (!session.isActive()) {
    throw new Error(
      `The session '${session?.id}' we just got from Shopify is not active for shop '${shop}'`
    );
  }

  // Save the session to storage if requested
  if (saveSession) await Shopify.Utils.storeSession(session);

  return session;
}
