import { Context } from "koa";
export declare const TOP_LEVEL_OAUTH_COOKIE_NAME = "shopifyTopLevelOAuth";
export declare function setTopLevelOAuthCookieValue(ctx: Context, value: string): void;
export declare function createTopLevelOAuthRedirect(apiKey: string, path: string, host: string | undefined): (ctx: Context) => Promise<void>;
export declare function createTopLevelRedirect(apiKey: string, path: string, hostname: string | undefined): (ctx: Context) => Promise<void>;
