import { z } from "zod";
import type { IdentityRouteApp, IdentityRouteContext } from "./identity-routes.ts";
import type { TabMutationRouteDependencies } from "./ports.ts";

const tabSchema = z.object({ title: z.string().trim().min(1), artist: z.string(), public: z.boolean() });
const favoriteSchema = z.object({ fav: z.boolean() });

function error(message: string) {
    return Response.json({ ok: false, error: message, msg: message }, { status: 400 });
}

async function requireSession(context: IdentityRouteContext, deps: TabMutationRouteDependencies) {
    if (!await deps.auth.getSession(context.req.raw)) throw new Error("Not logged in");
}

export function mountTabMutationRoutes(app: IdentityRouteApp, dependencies: (context: IdentityRouteContext) => TabMutationRouteDependencies) {
    app.post("/api/tab/:id", async (c) => {
        try {
            const deps = dependencies(c);
            await requireSession(c, deps);
            await deps.tabMutations.update(c.req.param("id"), tabSchema.parse(await c.req.json()));
            return c.json({ ok: true });
        } catch (cause) {
            return error(cause instanceof Error ? cause.message : "Failed to update tab");
        }
    });
    app.post("/api/tab/:id/fav", async (c) => {
        try {
            const deps = dependencies(c);
            await requireSession(c, deps);
            await deps.tabMutations.setFavorite(c.req.param("id"), favoriteSchema.parse(await c.req.json()).fav);
            return c.json({ ok: true });
        } catch (cause) {
            return error(cause instanceof Error ? cause.message : "Failed to update favorite");
        }
    });
}
