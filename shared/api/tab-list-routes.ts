import type { IdentityRouteApp, IdentityRouteContext } from "./identity-routes.ts";
import type { TabListRouteDependencies } from "./ports.ts";

function error(message: string) {
    return Response.json({ ok: false, error: message, msg: message }, { status: 400 });
}

export function mountTabListRoutes(app: IdentityRouteApp, dependencies: (context: IdentityRouteContext) => TabListRouteDependencies) {
    app.get("/api/tabs", async (c) => {
        try {
            const deps = dependencies(c);
            const session = await deps.auth.getSession(c.req.raw);
            if (!session) throw new Error("Not logged in");
            const role = await deps.identity.getRole(session.user.id);
            const assignments = role === "learner" ? await deps.teaching.listAssignments(session.user.id, role) : [];
            const assignmentsByTab = new Map(assignments.filter((assignment) => assignment.resourceType === "tab").map((assignment) => [assignment.resourceId, assignment]));
            return c.json({ ok: true, tabs: (await deps.tabs.list()).map((tab) => ({ ...tab, teacherAssignment: assignmentsByTab.get(tab.id) || null })) });
        } catch (cause) {
            return error(cause instanceof Error ? cause.message : "Failed to load tabs");
        }
    });
}
