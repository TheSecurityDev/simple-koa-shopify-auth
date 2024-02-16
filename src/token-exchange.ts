import Shopify, { DataType, OnlineAccessResponse } from "@shopify/shopify-api";
import { HttpResponseError } from "@shopify/shopify-api/dist/error";

import { createSession } from "./session";

/** Given the shop, encoded JWT session token, and token type, return a session object with an access token.
    https://shopify.dev/docs/apps/auth/get-access-tokens/token-exchange */
export async function exchangeSessionTokenForAccessTokenSession(
  shop: string,
  encodedSessionToken: string,
  tokenType: "online" | "offline"
) {
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
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": DataType.JSON, Accept: DataType.JSON },
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
  const sessionResponse: OnlineAccessResponse = await response.json(); // The returned session is missing the id, so we'll need to add it

  // Create and return the session
  return createSession(sessionResponse, shop);
}
