import { betterAuth } from "better-auth";
import { db, getUserRole, hasUser } from "./db.ts";
import * as fs from "@std/fs";
import { randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";
import { devOriginList } from "./util.ts";
import * as path from "@std/path";
import { dataDir } from "./util.ts";
import { Context } from "@hono/hono";
import { UserRole } from "./zod.ts";

const configJSONPath = path.join(dataDir, "config.json");

export const auth = betterAuth({
    database: db,
    secret: await getSecretKey(),
    // Hono take care of this
    trustedOrigins: ["*"],
    emailAndPassword: {
        enabled: true,
        minPasswordLength: 6,
        disableSignUp: isDisableSignUp(),
    },
});

async function getSecretKey() {
    // Read AUTH_SECRET
    let secret = Deno.env.get("AUTH_SECRET");

    if (secret) {
        return secret;
    }

    // Read config.json
    if (await fs.exists(configJSONPath)) {
        const configText = await Deno.readTextFile(configJSONPath);
        const config = JSON.parse(configText);
        if (config.authSecret) {
            return config.authSecret;
        }
    }

    // Generate a random secret
    secret = await generateRandomSecret();

    // Save to config.json
    let config = {
        authSecret: secret,
    };
    await Deno.writeTextFile(configJSONPath, JSON.stringify(config, null, 4));

    return secret;
}

export function isFinishSetup() {
    return hasUser();
}

export function isDisableSignUp() {
    return Deno.env.get("MYTABS_DISABLE_SIGN_UP") === "true";
}

export function disableSignUp() {
    auth.options.emailAndPassword.disableSignUp = true;
}

export async function checkLogin(c: Context) {
    await getCurrentSession(c);
}

export async function isLoggedIn(c: Context) {
    const session = await auth.api.getSession(c.req.raw);
    return !!session;
}

/**
 * Get current session, throw error if not logged in
 * @param c
 */
export async function getCurrentSession(c: Context) {
    const session = await auth.api.getSession(c.req.raw);
    if (!session) {
        throw new Error("Not logged in");
    }
    return session;
}

export async function getCurrentUser(c: Context) {
    const session = await getCurrentSession(c);
    return { ...session.user, role: getUserRole(session.user.id) as UserRole };
}

export async function requireTeacher(c: Context) {
    const user = await getCurrentUser(c);
    if (user.role !== "teacher") throw new Error("Teacher access required");
    return user;
}

async function generateRandomSecret() {
    return Buffer.from(randomBytes(54)).toString("hex");
}
