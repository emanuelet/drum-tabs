import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { isSignUpDisabled } from "./auth.ts";
import { registrationBody, safeFilename, tabValue } from "./worker.ts";
import { type IdentityRouteApp, mountIdentityRoutes } from "../shared/api/identity-routes.ts";
import { mountTeachingRoutes } from "../shared/api/teaching-routes.ts";
import { mountExerciseRoutes } from "../shared/api/exercise-routes.ts";
import { mountSettingsRoutes } from "../shared/api/settings-routes.ts";

describe("cloud worker helpers", () => {
    it("rejects object-key traversal", () => {
        expect(() => safeFilename("../private.mp3")).toThrow("Invalid filename");
        expect(() => safeFilename("folder/song.mp3")).toThrow("Invalid filename");
    });

    it("preserves the API tab shape", () => {
        expect(tabValue({
            id: "tab-1",
            title: "Song",
            artist: "Artist",
            filename: "tab.gp",
            original_filename: "song.gp",
            created_at: "2026-01-01T00:00:00.000Z",
            is_public: 1,
            is_fav: 0,
            object_key: "tabs/tab-1/tab.gp",
            deleted_at: null,
        })).toEqual({
            id: "tab-1",
            title: "Song",
            artist: "Artist",
            filename: "tab.gp",
            originalFilename: "song.gp",
            createdAt: "2026-01-01T00:00:00.000Z",
            public: true,
            fav: false,
        });
    });

    it("maps the registration PIN to Better Auth's password field", () => {
        expect(registrationBody({ email: "drummer@example.com", name: "Drummer", pin: "123456", role: "learner" })).toEqual({
            email: "drummer@example.com",
            name: "Drummer",
            password: "123456",
        });
    });

    it("respects the Cloud signup-disable binding", () => {
        expect(isSignUpDisabled({ MYTABS_DISABLE_SIGN_UP: "true" })).toBe(true);
        expect(isSignUpDisabled({ MYTABS_DISABLE_SIGN_UP: "false" })).toBe(false);
        expect(isSignUpDisabled({})).toBe(false);
    });

    it("serves the same role-aware /api/me response through shared routes", async () => {
        const app = new Hono();
        mountIdentityRoutes(app as unknown as IdentityRouteApp, () => ({
            auth: {
                handle: async () => new Response("not used"),
                getSession: async () => ({ user: { id: "user-1", name: "Drummer", email: "drummer@example.com" } }),
                signUpEmail: async () => ({ user: { id: "user-1" } }),
                isSignUpDisabled: () => false,
                isSetupComplete: async () => true,
            },
            identity: {
                getRole: async () => "teacher",
                setRole: async () => {},
            },
        }));

        const response = await app.request("http://example.test/api/me");
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ ok: true, user: { id: "user-1", name: "Drummer", email: "drummer@example.com", role: "teacher" } });
    });

    it("serves teacher learner search through shared routes", async () => {
        const app = new Hono();
        mountTeachingRoutes(app as unknown as IdentityRouteApp, () => ({
            auth: {
                handle: async () => new Response("not used"),
                getSession: async () => ({ user: { id: "teacher-1" } }),
                signUpEmail: async () => ({ user: { id: "teacher-1" } }),
                isSignUpDisabled: () => false,
                isSetupComplete: async () => true,
            },
            identity: { getRole: async () => "teacher", setRole: async () => {} },
            teaching: {
                searchLearners: async () => [{ id: "learner-1", name: "Student", email: "student@example.com" }],
                listStudents: async () => [],
                connectStudent: async () => {},
                disconnectStudent: async () => {},
                createAssignment: async () => "assignment-1",
                deleteAssignment: async () => {},
                listAssignments: async () => [],
            },
            resources: { hasExercise: async () => true, hasTab: async () => true },
        }));

        const response = await app.request("http://example.test/api/learners?query=st");
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ ok: true, learners: [{ id: "learner-1", name: "Student", email: "student@example.com" }] });
    });

    it("normalizes AlphaTex before creating an exercise through shared routes", async () => {
        const app = new Hono();
        mountExerciseRoutes(app as unknown as IdentityRouteApp, () => ({
            auth: {
                handle: async () => new Response("not used"),
                getSession: async () => ({ user: { id: "user-1" } }),
                signUpEmail: async () => ({ user: { id: "user-1" } }),
                isSignUpDisabled: () => false,
                isSetupComplete: async () => true,
            },
            identity: { getRole: async () => "teacher", setRole: async () => {} },
            exercises: {
                list: async () => [],
                create: async (input) => ({ id: "exercise-1", ...input, fav: false, createdAt: "2026-01-01T00:00:00.000Z" }),
                update: async () => { throw new Error("not used"); },
                setFavorite: async () => { throw new Error("not used"); },
                delete: async () => {},
            },
        }));

        const response = await app.request("http://example.test/api/exercises", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ alphaTex: '\\title "Exercise"\n\\tempo 80\n\\track "Drums" "drums"\n:8 36.42' }),
        });
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({ ok: true, exercise: { title: "Exercise", tempo: 80, alphaTex: expect.stringContaining("KickHit2 HiHatClosed") } });
    });

    it("persists settings through shared routes", async () => {
        const app = new Hono();
        let stored: unknown;
        mountSettingsRoutes(app as unknown as IdentityRouteApp, () => ({
            auth: {
                handle: async () => new Response("not used"),
                getSession: async () => ({ user: { id: "user-1" } }),
                signUpEmail: async () => ({ user: { id: "user-1" } }),
                isSignUpDisabled: () => false,
                isSetupComplete: async () => true,
            },
            identity: { getRole: async () => "teacher", setRole: async () => {} },
            settings: {
                get: async () => stored,
                set: async (_userId, value) => { stored = value; },
            },
        }));

        const saved = await app.request("http://example.test/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ theme: "dark" }) });
        expect(saved.status).toBe(200);
        const loaded = await app.request("http://example.test/api/settings");
        await expect(loaded.json()).resolves.toEqual({ ok: true, setting: { theme: "dark" } });
    });
});
