import Shopify, { AuthQuery } from "@shopify/shopify-api";
import { Context, Next } from "koa";

import {
  setTopLevelOAuthCookieValue,
  shouldPerformTopLevelOAuth,
  startTopLevelOauthRedirect,
} from "./top-level-oauth-redirect";

type OAuthBeginConfig = {
  accessMode?: "online" | "offline";
  authPath?: string;
  afterAuth(ctx: Context): Promise<void>;
};

export default function createShopifyAuth(options: OAuthBeginConfig) {
  const config: OAuthBeginConfig = {
    accessMode: "online",
    authPath: "/auth",
    ...options,
  };

  const { authPath: oAuthStartPath } = config;
  if (!oAuthStartPath?.startsWith("/") || oAuthStartPath?.endsWith("/")) {
    throw new Error(
      `Invalid auth path: '${oAuthStartPath}'. Must be a relative path without a trailing slash (eg. '/auth').`
    );
  }

  const oAuthCallbackPath = `${oAuthStartPath}/callback`;
  const topLevelOAuthPath = `${oAuthStartPath}/toplevel`;

  // This executes for every request
  return async function shopifyAuthMiddleware(ctx: Context, next: Next) {
    const { cookies, query, querystring, path } = ctx;
    const shop = query.shop ? query.shop.toString() : "";

    cookies.secure = true;

    if (
      path === topLevelOAuthPath ||
      (path === oAuthStartPath && shouldPerformTopLevelOAuth(ctx))
    ) {
      // Auth started
      if (!Shopify.Utils.sanitizeShop(shop)) {
        // Invalid shop
        ctx.response.status = 400;
        ctx.response.body = shop ? "Invalid shop parameter" : "Missing shop parameter";
        return;
      }

      // Begin auth process (redirect to Shopify auth page)
      setTopLevelOAuthCookieValue(ctx, "");
      const redirectUrl = await Shopify.Auth.beginAuth(
        ctx.req,
        ctx.res,
        shop,
        oAuthCallbackPath,
        config.accessMode === "online"
      );
      return ctx.redirect(redirectUrl);
    }

    if (path === oAuthStartPath) {
      return startTopLevelOauthRedirect(ctx, Shopify.Context.API_KEY, topLevelOAuthPath);
    }

    if (path === oAuthCallbackPath) {
      // Auth callback
      try {
        const session = await Shopify.Auth.validateAuthCallback(
          ctx.req,
          ctx.res,
          query as unknown as AuthQuery
        );
        ctx.state.shopify = session;
        if (config.afterAuth) {
          await config.afterAuth(ctx);
        }
      } catch (err) {
        const message = (err as Error).message;
        switch (true) {
          case err instanceof Shopify.Errors.InvalidOAuthError:
            ctx.throw(400, message);
          case err instanceof Shopify.Errors.CookieNotFound:
          case err instanceof Shopify.Errors.SessionNotFound:
            // This is likely because the OAuth session cookie expired before the merchant approved the request
            ctx.redirect(`${oAuthStartPath}?${querystring}`);
            break;
          default:
            ctx.throw(500, message);
        }
      }
      return;
    }

    await next();
  };
}
