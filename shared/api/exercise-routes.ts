import { z } from "zod";
import { normalizeExerciseAlphaTex, parseExerciseAlphaTex } from "./exercise-alpha.ts";
import type { IdentityRouteApp, IdentityRouteContext } from "./identity-routes.ts";
import type { ExerciseRouteDependencies } from "./ports.ts";

const alphaTexSchema = z.object({ alphaTex: z.string().trim().min(1) });
const favoriteSchema = z.object({ fav: z.boolean() });

function error(message: string) {
    return Response.json({ ok: false, error: message, msg: message }, { status: 400 });
}

async function requireSession(context: IdentityRouteContext, deps: ExerciseRouteDependencies) {
    if (!await deps.auth.getSession(context.req.raw)) throw new Error("Not logged in");
}

function parsedExercise(alphaTex: string) {
    return { ...parseExerciseAlphaTex(alphaTex), alphaTex: normalizeExerciseAlphaTex(alphaTex) };
}

export function mountExerciseRoutes(app: IdentityRouteApp, dependencies: (context: IdentityRouteContext) => ExerciseRouteDependencies) {
    app.get("/api/exercises", async (c) => {
        try {
            const deps = dependencies(c);
            await requireSession(c, deps);
            return c.json({ ok: true, exercises: await deps.exercises.list() });
        } catch (cause) {
            return error(cause instanceof Error ? cause.message : "Failed to load exercises");
        }
    });
    app.post("/api/exercises", async (c) => {
        try {
            const deps = dependencies(c);
            await requireSession(c, deps);
            return c.json({ ok: true, exercise: await deps.exercises.create(parsedExercise(alphaTexSchema.parse(await c.req.json()).alphaTex)) });
        } catch (cause) {
            return error(cause instanceof Error ? cause.message : "Failed to create exercise");
        }
    });
    app.post("/api/exercises/:id", async (c) => {
        try {
            const deps = dependencies(c);
            await requireSession(c, deps);
            return c.json({ ok: true, exercise: await deps.exercises.update(c.req.param("id"), parsedExercise(alphaTexSchema.parse(await c.req.json()).alphaTex)) });
        } catch (cause) {
            return error(cause instanceof Error ? cause.message : "Failed to update exercise");
        }
    });
    app.post("/api/exercises/:id/fav", async (c) => {
        try {
            const deps = dependencies(c);
            await requireSession(c, deps);
            return c.json({ ok: true, exercise: await deps.exercises.setFavorite(c.req.param("id"), favoriteSchema.parse(await c.req.json()).fav) });
        } catch (cause) {
            return error(cause instanceof Error ? cause.message : "Failed to update exercise");
        }
    });
    app.delete("/api/exercises/:id", async (c) => {
        try {
            const deps = dependencies(c);
            await requireSession(c, deps);
            await deps.exercises.delete(c.req.param("id"));
            return c.json({ ok: true });
        } catch (cause) {
            return error(cause instanceof Error ? cause.message : "Failed to delete exercise");
        }
    });
}
