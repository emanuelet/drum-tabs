import { z } from "zod";
import type { IdentityRouteDependencies } from "./ports.ts";

export type { IdentityRouteDependencies, UserRole } from "./ports.ts";

export interface IdentityRouteContext {
    env?: unknown;
    req: { raw: Request; json(): Promise<unknown>; param(name: string): string };
    json(value: unknown, status?: number): Response;
}

export interface IdentityRouteApp {
    post(path: string, handler: (context: IdentityRouteContext) => Response | Promise<Response>): unknown;
    get(path: string, handler: (context: IdentityRouteContext) => Response | Promise<Response>): unknown;
    delete(path: string, handler: (context: IdentityRouteContext) => Response | Promise<Response>): unknown;
    all(path: string, handler: (context: IdentityRouteContext) => Response | Promise<Response>): unknown;
}

const registrationSchema = z.object({
    email: z.email(),
    name: z.string().trim().min(1).max(100),
    pin: z.string().regex(/^\d{6}$/, "PIN must be exactly 6 digits"),
    role: z.enum(["teacher", "learner"]),
});

const pinSchema = z.string().regex(/^\d{6}$/, "PIN must be exactly 6 digits");

export function registrationBody(input: unknown) {
    const { email, name, pin } = registrationSchema.parse(input);
    return { email, name, password: pin };
}

function error(message: string, status = 400) {
    return Response.json({ ok: false, error: message, msg: message }, { status });
}

export function mountIdentityRoutes(app: IdentityRouteApp, dependencies: (context: IdentityRouteContext) => IdentityRouteDependencies) {
    app.post("/api/auth/sign-up/email", () => error("Use /api/register", 404));
    app.post("/api/auth/sign-in/email", async (c) => {
        try {
            const body = await c.req.raw.clone().json() as { password?: unknown };
            pinSchema.parse(body.password);
            const deps = dependencies(c);
            return await deps.auth.handle(c.req.raw);
        } catch (cause) {
            return error(cause instanceof Error ? cause.message : "Invalid PIN");
        }
    });
    app.all("/api/auth/*", (c) => dependencies(c).auth.handle(c.req.raw));

    app.get("/api/is-finish-setup", async (c) => c.json(await dependencies(c).auth.isSetupComplete()));

    app.post("/api/register", async (c) => {
        try {
            const deps = dependencies(c);
            if (deps.auth.isSignUpDisabled()) return error("Sign up is disabled", 403);
            const input = registrationSchema.parse(await c.req.json());
            const result = await deps.auth.signUpEmail({ email: input.email, name: input.name, password: input.pin });
            await deps.identity.setRole(result.user.id, input.role);
            return c.json(result);
        } catch (cause) {
            return error(cause instanceof Error ? cause.message : "Registration failed");
        }
    });

    app.get("/api/me", async (c) => {
        try {
            const deps = dependencies(c);
            const session = await deps.auth.getSession(c.req.raw);
            if (!session) return error("Not logged in", 401);
            return c.json({ ok: true, user: { ...session.user, role: await deps.identity.getRole(session.user.id) } });
        } catch (cause) {
            return error(cause instanceof Error ? cause.message : "Failed to get current user");
        }
    });
}
