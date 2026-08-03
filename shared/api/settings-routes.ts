import type { IdentityRouteApp, IdentityRouteContext } from "./identity-routes.ts";
import type { SettingsRouteDependencies } from "./ports.ts";

function error(message: string) {
    return Response.json({ ok: false, error: message, msg: message }, { status: 400 });
}

export function mountSettingsRoutes(app: IdentityRouteApp, dependencies: (context: IdentityRouteContext) => SettingsRouteDependencies) {
    app.get("/api/settings", async (c) => {
        try {
            const deps = dependencies(c);
            const session = await deps.auth.getSession(c.req.raw);
            if (!session) throw new Error("Not logged in");
            const setting = await deps.settings.get(session.user.id);
            if (setting === undefined) throw new Error("Settings not found on server");
            return c.json({ ok: true, setting });
        } catch (cause) {
            return error(cause instanceof Error ? cause.message : "Failed to get settings");
        }
    });

    app.post("/api/settings", async (c) => {
        try {
            const deps = dependencies(c);
            const session = await deps.auth.getSession(c.req.raw);
            if (!session) throw new Error("Not logged in");
            await deps.settings.set(session.user.id, await c.req.json());
            return c.json({ ok: true });
        } catch (cause) {
            return error(cause instanceof Error ? cause.message : "Failed to save settings");
        }
    });
}
