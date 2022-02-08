import { Context, Next } from "koa";
declare type VerifyRequestOptions = {
    accessMode?: "online" | "offline";
    returnHeader?: boolean;
    authRoute?: string;
};
export default function verifyRequest(options?: VerifyRequestOptions): (ctx: Context, next: Next) => Promise<void>;
export {};
