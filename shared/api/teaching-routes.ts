import { z } from "zod";
import type { IdentityRouteApp, IdentityRouteContext } from "./identity-routes.ts";
import type { TeachingRouteDependencies, UserRole } from "./ports.ts";

const assignmentSchema = z.object({
    learnerId: z.string().min(1),
    resourceType: z.enum(["exercise", "tab"]),
    resourceId: z.string().min(1),
});

function error(message: string, status = 400) {
    return Response.json({ ok: false, error: message, msg: message }, { status });
}

async function currentUser(context: IdentityRouteContext, deps: TeachingRouteDependencies) {
    const session = await deps.auth.getSession(context.req.raw);
    if (!session) throw new Error("Not logged in");
    return { ...session.user, role: await deps.identity.getRole(session.user.id) };
}

async function requireTeacher(context: IdentityRouteContext, deps: TeachingRouteDependencies) {
    const user = await currentUser(context, deps);
    if (user.role !== "teacher") throw new Error("Teacher access required");
    return user as typeof user & { role: Extract<UserRole, "teacher"> };
}

export function mountTeachingRoutes(app: IdentityRouteApp, dependencies: (context: IdentityRouteContext) => TeachingRouteDependencies) {
    app.get("/api/learners", async (c) => {
        try {
            const deps = dependencies(c);
            await requireTeacher(c, deps);
            return c.json({ ok: true, learners: await deps.teaching.searchLearners(new URL(c.req.raw.url).searchParams.get("query") || "") });
        } catch (cause) {
            return error(cause instanceof Error ? cause.message : "Failed to search learners");
        }
    });

    app.get("/api/students", async (c) => {
        try {
            const deps = dependencies(c);
            const teacher = await requireTeacher(c, deps);
            return c.json({ ok: true, ...await deps.teaching.listStudents(teacher.id) });
        } catch (cause) {
            return error(cause instanceof Error ? cause.message : "Failed to load students");
        }
    });

    app.post("/api/students/:learnerId", async (c) => {
        try {
            const deps = dependencies(c);
            const teacher = await requireTeacher(c, deps);
            await deps.teaching.connectStudent(teacher.id, c.req.param("learnerId"));
            return c.json({ ok: true });
        } catch (cause) {
            return error(cause instanceof Error ? cause.message : "Failed to connect learner", 400);
        }
    });

    app.delete("/api/students/:learnerId", async (c) => {
        try {
            const deps = dependencies(c);
            const teacher = await requireTeacher(c, deps);
            await deps.teaching.disconnectStudent(teacher.id, c.req.param("learnerId"));
            return c.json({ ok: true });
        } catch (cause) {
            return error(cause instanceof Error ? cause.message : "Failed to disconnect learner", 400);
        }
    });

    app.post("/api/assignments", async (c) => {
        try {
            const deps = dependencies(c);
            const teacher = await requireTeacher(c, deps);
            const input = assignmentSchema.parse(await c.req.json());
            const exists = input.resourceType === "exercise" ? await deps.resources.hasExercise(input.resourceId) : await deps.resources.hasTab(input.resourceId);
            if (!exists) throw new Error(`${input.resourceType === "exercise" ? "Exercise" : "Tab"} not found`);
            return c.json({ ok: true, id: await deps.teaching.createAssignment(teacher.id, input.learnerId, input.resourceType, input.resourceId) });
        } catch (cause) {
            return error(cause instanceof Error ? cause.message : "Failed to create assignment");
        }
    });

    app.delete("/api/assignments/:id", async (c) => {
        try {
            const deps = dependencies(c);
            const teacher = await requireTeacher(c, deps);
            await deps.teaching.deleteAssignment(teacher.id, c.req.param("id"));
            return c.json({ ok: true });
        } catch (cause) {
            return error(cause instanceof Error ? cause.message : "Failed to delete assignment");
        }
    });

    app.get("/api/assignments", async (c) => {
        try {
            const deps = dependencies(c);
            const user = await currentUser(c, deps);
            return c.json({ ok: true, assignments: await deps.teaching.listAssignments(user.id, user.role) });
        } catch (cause) {
            return error(cause instanceof Error ? cause.message : "Failed to load assignments");
        }
    });
}
