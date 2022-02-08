import { Context, Next } from "koa";
declare type OAuthBeginConfig = {
    accessMode: "online" | "offline";
    authPath: string;
    afterAuth(ctx: Context): Promise<void>;
    host?: string;
};
export default function createShopifyAuth(options: OAuthBeginConfig): (ctx: Context, next: Next) => Promise<void>;
export {};
