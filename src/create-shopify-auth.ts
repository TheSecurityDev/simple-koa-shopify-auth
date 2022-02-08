import Shopify, { AuthQuery } from "@shopify/shopify-api";
import { Context, Next } from "koa";

import {
  createTopLevelOAuthRedirect,
  TOP_LEVEL_OAUTH_COOKIE_NAME,
  setTopLevelOAuthCookieValue,
} from "./top-level-oauth-redirect";

type OAuthBeginConfig = {
  accessMode?: "online" | "offline";
  authPath?: string;
  afterAuth(ctx: Context): Promise<void>;
};

function shouldPerformInlineOAuth({ cookies }: Context) {
  return Boolean(cookies.get(TOP_LEVEL_OAUTH_COOKIE_NAME));
}

export default function createShopifyAuth(options: OAuthBeginConfig) {
  const config: OAuthBeginConfig = {
    accessMode: "online",
    authPath: "/auth",
    ...options,
  };

  const { authPath: oAuthStartPath } = config;
  if (!oAuthStartPath.startsWith("/") || oAuthStartPath.endsWith("/")) {
    throw new Error(
      `Invalid auth path: '${oAuthStartPath}'. Must be a relative path without a trailing slash (eg. '/auth').`
    );
  }

  const oAuthCallbackPath = `${oAuthStartPath}/callback`;
  const inlineOAuthPath = `${oAuthStartPath}/inline`;

  const topLevelOAuthRedirect = createTopLevelOAuthRedirect(
    Shopify.Context.API_KEY,
    inlineOAuthPath
  );

  // This executes for every request
  return async function shopifyAuthMiddleware(ctx: Context, next: Next) {
    const { cookies, query, path } = ctx;
    const shop = query.shop ? query.shop.toString() : "";

    cookies.secure = true;

    if (path === inlineOAuthPath || (path === oAuthStartPath && shouldPerformInlineOAuth(ctx))) {
      // Auth started
      if (!Shopify.Utils.validateShop(shop)) {
        // Invalid shop
        ctx.response.status = 400;
        ctx.response.body = shop ? "Invalid shop parameter" : "Missing shop parameter";
        return;
      }

      // Begin auth process (redirect to Shopify for inline auth)
      setTopLevelOAuthCookieValue(ctx, "");
      const redirectUrl = await Shopify.Auth.beginAuth(
        ctx.req,
        ctx.res,
        shop,
        oAuthCallbackPath,
        config.accessMode === "online"
      );
      ctx.redirect(redirectUrl);
      return;
    }

    if (path === oAuthStartPath) {
      await topLevelOAuthRedirect(ctx);
      return;
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
        switch (true) {
          case err instanceof Shopify.Errors.InvalidOAuthError:
            ctx.throw(400, err.message);
            break;
          case err instanceof Shopify.Errors.CookieNotFound:
          case err instanceof Shopify.Errors.SessionNotFound:
            // This is likely because the OAuth session cookie expired before the merchant approved the request
            ctx.redirect(`${oAuthStartPath}?shop=${shop}`);
            break;
          default:
            ctx.throw(500, err.message);
            break;
        }
      }
      return;
    }

    await next();
  };
}
