import Shopify, { OnlineAccessResponse } from "@shopify/shopify-api";

/* Creates a new session from the response from the access token request. */
export function createSession(responseBody: OnlineAccessResponse, shop: string, state = "") {
  const { access_token, scope, ...rest } = responseBody;
  const isOnline = !!rest.associated_user; // If there's an associated user, then it's an online access token

  // Get the session ID
  const sessionId = isOnline
    ? Shopify.Auth.getJwtSessionId(shop, `${rest.associated_user.id}`)
    : Shopify.Auth.getOfflineSessionId(shop);

  // Initialize the session object
  const session = new Shopify.Session.Session(sessionId, shop, state, isOnline);
  session.accessToken = access_token;
  session.scope = scope;

  if (isOnline) {
    // Add the online access info
    const sessionExpiration = new Date(Date.now() + responseBody.expires_in * 1000);
    session.expires = sessionExpiration;
    session.onlineAccessInfo = rest;
  }

  return session;
}
