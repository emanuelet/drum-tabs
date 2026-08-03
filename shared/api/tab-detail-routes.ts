import type { IdentityRouteApp, IdentityRouteContext } from "./identity-routes.ts";
import type { TabDetailRouteDependencies } from "./ports.ts";

function error(message: string) {
    return Response.json({ ok: false, error: message, msg: message }, { status: 400 });
}

export function mountTabDetailRoutes(app: IdentityRouteApp, dependencies: (context: IdentityRouteContext) => TabDetailRouteDependencies) {
    app.get("/api/tab/:id", async (c) => {
        try {
            const deps = dependencies(c);
            const detail = await deps.tabDetail.get(c.req.param("id"));
            const session = await deps.auth.getSession(c.req.raw);
            if (!detail.tab.public && !session) throw new Error("Not logged in");
            const filePath = session && deps.tabDetail.getLocalPath ? await deps.tabDetail.getLocalPath(detail.tab.id) : "";
            return c.json({ ok: true, showOpenButtons: deps.tabDetail.showOpenButtons, tab: detail.tab, audioList: detail.audioList, youtubeList: detail.youtubeList, filePath });
        } catch (cause) {
            return error(cause instanceof Error ? cause.message : "Tab not found");
        }
    });
}
