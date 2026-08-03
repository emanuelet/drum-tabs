import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "./env.ts";

export function isSignUpDisabled(env: Pick<Env, "MYTABS_DISABLE_SIGN_UP">) {
    return env.MYTABS_DISABLE_SIGN_UP === "true";
}

export function createAuth(env: Env, origin: string) {
    return betterAuth({
        baseURL: origin,
        database: drizzleAdapter(drizzle(env.DB), { provider: "sqlite" }),
        secret: env.AUTH_SECRET,
        trustedOrigins: [env.APP_ORIGIN, origin],
        emailAndPassword: {
            enabled: true,
            minPasswordLength: 6,
            disableSignUp: isSignUpDisabled(env),
        },
    });
}
