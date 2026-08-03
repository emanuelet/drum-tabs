import { Hono } from "hono";
import { z } from "zod";
import { createAuth, isSignUpDisabled } from "./auth.ts";
import type { Env } from "./env.ts";
import {
    type IdentityRouteApp,
    mountIdentityRoutes,
    registrationBody,
} from "../shared/api/identity-routes.ts";
import { mountTeachingRoutes } from "../shared/api/teaching-routes.ts";
import { mountExerciseRoutes } from "../shared/api/exercise-routes.ts";
import { mountTabListRoutes } from "../shared/api/tab-list-routes.ts";
import { mountSettingsRoutes } from "../shared/api/settings-routes.ts";
import { mountTabDetailRoutes } from "../shared/api/tab-detail-routes.ts";
import { mountTabMutationRoutes } from "../shared/api/tab-mutation-routes.ts";
import type {
    ExerciseRouteDependencies,
    SettingsRouteDependencies,
    TabDetailRouteDependencies,
    TabListRouteDependencies,
    TabMutationRouteDependencies,
    TeachingRouteDependencies,
} from "../shared/api/ports.ts";
import { parseDrumTab } from "../backend/drum_parser.ts";
import { toMusicXml } from "../backend/drum_musicxml.ts";
import {
    downloadUltimateGuitarFile,
    getUltimateGuitarTab,
    searchUltimateGuitar,
    UltimateGuitarError,
} from "../backend/ultimate-guitar.ts";
import { audioContentTypes, extension, safeFilename, sourceFormats } from "../shared/api/file-rules.ts";

export { registrationBody } from "../shared/api/identity-routes.ts";

type AppEnv = { Bindings: Env };

type TabRow = {
    id: string;
    title: string;
    artist: string;
    filename: string;
    original_filename: string;
    created_at: string;
    is_public: number;
    is_fav: number;
    object_key: string;
    deleted_at: string | null;
};

const syncSchema = z.object({
    syncMethod: z.enum(["simple", "advanced"]),
    simpleSync: z.number(),
    advancedSync: z.string(),
});

function error(message: string, status = 400) {
    return Response.json(
        { ok: false, error: message, msg: message },
        { status },
    );
}

export { safeFilename } from "../shared/api/file-rules.ts";

export function tabValue(row: TabRow) {
    return {
        id: row.id,
        title: row.title,
        artist: row.artist,
        filename: row.filename,
        originalFilename: row.original_filename,
        createdAt: row.created_at,
        public: Boolean(row.is_public),
        fav: Boolean(row.is_fav),
    };
}

async function currentSession(env: Env, request: Request) {
    return await createAuth(env, new URL(request.url).origin).api.getSession({
        headers: request.headers,
    });
}

async function requireSession(env: Env, request: Request) {
    const session = await currentSession(env, request);
    if (!session) throw new Error("Not logged in");
    return session;
}

async function getTab(db: D1Database, id: string, includeDeleted = false) {
    const statement = includeDeleted
        ? "SELECT * FROM tab WHERE id = ?"
        : "SELECT * FROM tab WHERE id = ? AND deleted_at IS NULL";
    const row = await db.prepare(statement).bind(id).first<TabRow>();
    if (!row) throw new Error("Tab not found");
    return row;
}

async function requireTabAccess(env: Env, request: Request, id: string) {
    const tab = await getTab(env.DB, id);
    if (!tab.is_public) await requireSession(env, request);
    return tab;
}

async function streamObject(
    bucket: R2Bucket,
    key: string,
    fallbackType: string,
    downloadName: string,
) {
    const object = await bucket.get(key);
    if (!object || !object.body) return error("File not found", 404);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Content-Type", headers.get("Content-Type") || fallbackType);
    headers.set(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(downloadName)}"`,
    );
    headers.set("ETag", object.httpEtag);
    return new Response(object.body, { headers });
}

async function moveObject(bucket: R2Bucket, from: string, to: string) {
    const object = await bucket.get(from);
    if (!object?.body) throw new Error("Object not found during deletion");
    await bucket.put(to, object.body, { httpMetadata: object.httpMetadata });
    await bucket.delete(from);
}

const app = new Hono<AppEnv>();

type CloudDependencies = TeachingRouteDependencies &
    ExerciseRouteDependencies &
    TabListRouteDependencies &
    SettingsRouteDependencies &
    TabDetailRouteDependencies &
    TabMutationRouteDependencies;

function cloudDependencies(env: Env, request: Request): CloudDependencies {
    const auth = createAuth(env, new URL(request.url).origin);
    return {
        auth: {
            handle: (request) => auth.handler(request),
            getSession: (request) =>
                auth.api.getSession({ headers: request.headers }),
            signUpEmail: ({ email, name, password }) =>
                auth.api.signUpEmail({ body: { email, name, password } }),
            isSignUpDisabled: () => isSignUpDisabled(env),
            isSetupComplete: async () =>
                Boolean(
                    await env.DB.prepare("SELECT id FROM user LIMIT 1").first(),
                ),
        },
        identity: {
            getRole: async (userId) =>
                (
                    await env.DB.prepare(
                        "SELECT role FROM user_role WHERE user_id = ?",
                    )
                        .bind(userId)
                        .first<{ role: "teacher" | "learner" }>()
                )?.role || "learner",
            setRole: async (userId, role) => {
                await env.DB.prepare(
                    "INSERT INTO user_role (user_id, role) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET role = excluded.role",
                )
                    .bind(userId, role)
                    .run();
            },
        },
        teaching: {
            searchLearners: async (query) => {
                const term = query.trim();
                if (term.length < 2) return [];
                const match = `%${term}%`;
                const rows = await env.DB.prepare(
                    "SELECT user.id, user.name, user.email FROM user INNER JOIN user_role ON user_role.user_id = user.id WHERE user_role.role = 'learner' AND (user.name LIKE ? COLLATE NOCASE OR user.email LIKE ? COLLATE NOCASE) ORDER BY user.name COLLATE NOCASE LIMIT 20",
                )
                    .bind(match, match)
                    .all<{ id: string; name: string; email: string }>();
                return rows.results;
            },
            listStudents: async (teacherId) => {
                const [students, assignments] = await Promise.all([
                    env.DB.prepare(
                        "SELECT user.id, user.name, user.email FROM teacher_student INNER JOIN user ON user.id = teacher_student.learner_id WHERE teacher_student.teacher_id = ? ORDER BY user.name COLLATE NOCASE",
                    )
                        .bind(teacherId)
                        .all<{ id: string; name: string; email: string }>(),
                    env.DB.prepare(
                        "SELECT assignment.id, assignment.teacher_id AS teacherId, user.name AS teacherName, assignment.learner_id AS learnerId, assignment.resource_type AS resourceType, assignment.resource_id AS resourceId, assignment.created_at AS createdAt FROM assignment INNER JOIN user ON user.id = assignment.teacher_id WHERE assignment.teacher_id = ? ORDER BY assignment.created_at DESC",
                    )
                        .bind(teacherId)
                        .all<{
                            id: string;
                            teacherId: string;
                            teacherName: string;
                            learnerId: string;
                            resourceType: "exercise" | "tab";
                            resourceId: string;
                            createdAt: string;
                        }>(),
                ]);
                return {
                    students: students.results,
                    assignments: assignments.results,
                };
            },
            connectStudent: async (teacherId, learnerId) => {
                const learner = await env.DB.prepare(
                    "SELECT role FROM user_role WHERE user_id = ?",
                )
                    .bind(learnerId)
                    .first<{ role: string }>();
                if (learner?.role !== "learner")
                    throw new Error("Learner not found");
                await env.DB.prepare(
                    "INSERT OR IGNORE INTO teacher_student (teacher_id, learner_id, created_at) VALUES (?, ?, ?)",
                )
                    .bind(teacherId, learnerId, new Date().toISOString())
                    .run();
            },
            disconnectStudent: async (teacherId, learnerId) => {
                await env.DB.prepare(
                    "DELETE FROM teacher_student WHERE teacher_id = ? AND learner_id = ?",
                )
                    .bind(teacherId, learnerId)
                    .run();
                await env.DB.prepare(
                    "DELETE FROM assignment WHERE teacher_id = ? AND learner_id = ?",
                )
                    .bind(teacherId, learnerId)
                    .run();
            },
            createAssignment: async (
                teacherId,
                learnerId,
                resourceType,
                resourceId,
            ) => {
                const connection = await env.DB.prepare(
                    "SELECT 1 FROM teacher_student WHERE teacher_id = ? AND learner_id = ?",
                )
                    .bind(teacherId, learnerId)
                    .first();
                if (!connection)
                    throw new Error("Learner is not connected to this teacher");
                const id = crypto.randomUUID();
                await env.DB.prepare(
                    "INSERT INTO assignment (id, teacher_id, learner_id, resource_type, resource_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                )
                    .bind(
                        id,
                        teacherId,
                        learnerId,
                        resourceType,
                        resourceId,
                        new Date().toISOString(),
                    )
                    .run();
                return id;
            },
            deleteAssignment: async (teacherId, assignmentId) => {
                await env.DB.prepare(
                    "DELETE FROM assignment WHERE id = ? AND teacher_id = ?",
                )
                    .bind(assignmentId, teacherId)
                    .run();
            },
            listAssignments: async (userId, role) => {
                const column = role === "teacher" ? "teacher_id" : "learner_id";
                const rows = await env.DB.prepare(
                    `SELECT assignment.id, assignment.teacher_id AS teacherId, user.name AS teacherName, assignment.learner_id AS learnerId, assignment.resource_type AS resourceType, assignment.resource_id AS resourceId, assignment.created_at AS createdAt FROM assignment INNER JOIN user ON user.id = assignment.teacher_id WHERE assignment.${column} = ? ORDER BY assignment.created_at DESC`,
                )
                    .bind(userId)
                    .all<{
                        id: string;
                        teacherId: string;
                        teacherName: string;
                        learnerId: string;
                        resourceType: "exercise" | "tab";
                        resourceId: string;
                        createdAt: string;
                    }>();
                return rows.results;
            },
        },
        resources: {
            hasExercise: async (id) =>
                Boolean(
                    await env.DB.prepare("SELECT id FROM exercise WHERE id = ?")
                        .bind(id)
                        .first(),
                ),
            hasTab: async (id) =>
                Boolean(
                    await env.DB.prepare(
                        "SELECT id FROM tab WHERE id = ? AND deleted_at IS NULL",
                    )
                        .bind(id)
                        .first(),
                ),
        },
        exercises: {
            list: async () =>
                (
                    await env.DB.prepare(
                        "SELECT id, title, subtitle, tempo, alpha_tex AS alphaTex, is_fav AS fav, created_at AS createdAt FROM exercise ORDER BY created_at",
                    ).all<{
                        id: string;
                        title: string;
                        subtitle: string;
                        tempo: number;
                        alphaTex: string;
                        fav: number;
                        createdAt: string;
                    }>()
                ).results.map((exercise) => ({
                    ...exercise,
                    fav: Boolean(exercise.fav),
                })),
            create: async (input) => {
                const exercise = {
                    id: crypto.randomUUID(),
                    ...input,
                    fav: false,
                    createdAt: new Date().toISOString(),
                };
                await env.DB.prepare(
                    "INSERT INTO exercise (id, title, subtitle, tempo, alpha_tex, is_fav, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                )
                    .bind(
                        exercise.id,
                        exercise.title,
                        exercise.subtitle,
                        exercise.tempo,
                        exercise.alphaTex,
                        0,
                        exercise.createdAt,
                    )
                    .run();
                return exercise;
            },
            update: async (id, input) => {
                const result = await env.DB.prepare(
                    "UPDATE exercise SET title = ?, subtitle = ?, tempo = ?, alpha_tex = ? WHERE id = ?",
                )
                    .bind(
                        input.title,
                        input.subtitle,
                        input.tempo,
                        input.alphaTex,
                        id,
                    )
                    .run();
                if (!result.meta.changes) throw new Error("Exercise not found");
                const exercise = await env.DB.prepare(
                    "SELECT id, title, subtitle, tempo, alpha_tex AS alphaTex, is_fav AS fav, created_at AS createdAt FROM exercise WHERE id = ?",
                )
                    .bind(id)
                    .first<{
                        id: string;
                        title: string;
                        subtitle: string;
                        tempo: number;
                        alphaTex: string;
                        fav: number;
                        createdAt: string;
                    }>();
                return { ...exercise!, fav: Boolean(exercise!.fav) };
            },
            setFavorite: async (id, fav) => {
                const result = await env.DB.prepare(
                    "UPDATE exercise SET is_fav = ? WHERE id = ?",
                )
                    .bind(Number(fav), id)
                    .run();
                if (!result.meta.changes) throw new Error("Exercise not found");
                const exercise = await env.DB.prepare(
                    "SELECT id, title, subtitle, tempo, alpha_tex AS alphaTex, is_fav AS fav, created_at AS createdAt FROM exercise WHERE id = ?",
                )
                    .bind(id)
                    .first<{
                        id: string;
                        title: string;
                        subtitle: string;
                        tempo: number;
                        alphaTex: string;
                        fav: number;
                        createdAt: string;
                    }>();
                return { ...exercise!, fav: Boolean(exercise!.fav) };
            },
            delete: async (id) => {
                const result = await env.DB.prepare(
                    "DELETE FROM exercise WHERE id = ?",
                )
                    .bind(id)
                    .run();
                if (!result.meta.changes) throw new Error("Exercise not found");
            },
        },
        tabs: {
            list: async () =>
                (
                    await env.DB.prepare(
                        "SELECT * FROM tab WHERE deleted_at IS NULL ORDER BY created_at DESC",
                    ).all<TabRow>()
                ).results.map(tabValue),
        },
        tabDetail: {
            showOpenButtons: false,
            showYoutubeSuggestions: Boolean(env.YATTEE_USERNAME && env.YATTEE_PASSWORD),
            get: async (id) => {
                const tab = await getTab(env.DB, id);
                const [audio, youtube] = await Promise.all([
                    env.DB.prepare(
                        "SELECT filename, sync_method, simple_sync, advanced_sync FROM tab_audio WHERE tab_id = ?",
                    )
                        .bind(tab.id)
                        .all<{
                            filename: string;
                            sync_method: string;
                            simple_sync: number;
                            advanced_sync: string;
                        }>(),
                    env.DB.prepare(
                        "SELECT video_id, sync_method, simple_sync, advanced_sync FROM tab_youtube WHERE tab_id = ?",
                    )
                        .bind(tab.id)
                        .all<{
                            video_id: string;
                            sync_method: string;
                            simple_sync: number;
                            advanced_sync: string;
                        }>(),
                ]);
                return {
                    tab: tabValue(tab),
                    audioList: audio.results.map((item) => ({
                        filename: item.filename,
                        syncMethod: item.sync_method,
                        simpleSync: item.simple_sync,
                        advancedSync: item.advanced_sync,
                    })),
                    youtubeList: youtube.results.map((item) => ({
                        videoID: item.video_id,
                        syncMethod: item.sync_method,
                        simpleSync: item.simple_sync,
                        advancedSync: item.advanced_sync,
                    })),
                };
            },
            getLocalPath: async (id) => (await getTab(env.DB, id)).object_key,
        },
        tabMutations: {
            update: async (id, input) => {
                const result = await env.DB.prepare(
                    "UPDATE tab SET title = ?, artist = ?, is_public = ? WHERE id = ? AND deleted_at IS NULL",
                )
                    .bind(input.title, input.artist, Number(input.public), id)
                    .run();
                if (!result.meta.changes) throw new Error("Tab not found");
            },
            setFavorite: async (id, fav) => {
                const result = await env.DB.prepare(
                    "UPDATE tab SET is_fav = ? WHERE id = ? AND deleted_at IS NULL",
                )
                    .bind(Number(fav), id)
                    .run();
                if (!result.meta.changes) throw new Error("Tab not found");
            },
        },
        settings: {
            get: async (userId) => {
                const row = await env.DB.prepare(
                    "SELECT value_json FROM user_setting WHERE user_id = ?",
                )
                    .bind(userId)
                    .first<{ value_json: string }>();
                return row ? JSON.parse(row.value_json) : undefined;
            },
            set: async (userId, value) => {
                await env.DB.prepare(
                    "INSERT INTO user_setting (user_id, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
                )
                    .bind(
                        userId,
                        JSON.stringify(value),
                        new Date().toISOString(),
                    )
                    .run();
            },
        },
    };
}

mountIdentityRoutes(app as unknown as IdentityRouteApp, (c) =>
    cloudDependencies(c.env as Env, c.req.raw),
);
mountTeachingRoutes(app as unknown as IdentityRouteApp, (c) =>
    cloudDependencies(c.env as Env, c.req.raw),
);
mountExerciseRoutes(app as unknown as IdentityRouteApp, (c) =>
    cloudDependencies(c.env as Env, c.req.raw),
);
mountTabListRoutes(app as unknown as IdentityRouteApp, (c) =>
    cloudDependencies(c.env as Env, c.req.raw),
);
mountSettingsRoutes(app as unknown as IdentityRouteApp, (c) =>
    cloudDependencies(c.env as Env, c.req.raw),
);
mountTabDetailRoutes(app as unknown as IdentityRouteApp, (c) =>
    cloudDependencies(c.env as Env, c.req.raw),
);
mountTabMutationRoutes(app as unknown as IdentityRouteApp, (c) =>
    cloudDependencies(c.env as Env, c.req.raw),
);

app.post("/api/new-tab", async (c) => {
    try {
        await requireSession(c.env, c.req.raw);
        const form = await c.req.formData();
        const file = form.get("file");
        if (!(file instanceof File)) throw new Error("No file uploaded");
        const ext = extension(file.name);
        if (!sourceFormats.has(ext))
            throw new Error(`Unsupported file format: ${ext}`);
        const id = crypto.randomUUID();
        const filename = `tab.${ext}`;
        const objectKey = `tabs/${id}/${filename}`;
        await c.env.TABS_BUCKET.put(objectKey, file.stream(), {
            httpMetadata: { contentType: "application/octet-stream" },
        });
        await c.env.DB.prepare(
            "INSERT INTO tab (id, title, artist, filename, original_filename, created_at, object_key) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
            .bind(
                id,
                String(form.get("title") || file.name).trim(),
                String(form.get("artist") || "").trim(),
                filename,
                safeFilename(file.name),
                new Date().toISOString(),
                objectKey,
            )
            .run();
        return c.json({ ok: true, id });
    } catch (cause) {
        return error(
            cause instanceof Error ? cause.message : "Failed to create tab",
        );
    }
});

app.post("/api/new-drum-tab", async (c) => {
    try {
        await requireSession(c.env, c.req.raw);
        const form = await c.req.formData();
        const file = form.get("file");
        const text = form.get("text");
        const content =
            file instanceof File
                ? await file.text()
                : typeof text === "string" && text.trim()
                  ? text
                  : (() => {
                        throw new Error("No drum tab uploaded or pasted");
                    })();
        const parsed = parseDrumTab(content);
        const titleValue = form.get("title");
        const artistValue = form.get("artist");
        const title =
            typeof titleValue === "string" && titleValue.trim()
                ? titleValue.trim()
                : parsed.title ||
                  (file instanceof File
                      ? file.name.replace(/\.txt$/i, "")
                      : "Untitled drum tab");
        const artist =
            typeof artistValue === "string"
                ? artistValue.trim()
                : parsed.artist || "";
        const id = crypto.randomUUID();
        const filename = "tab.musicxml";
        const objectKey = `tabs/${id}/${filename}`;
        await c.env.TABS_BUCKET.put(
            objectKey,
            toMusicXml({ ...parsed, title, artist }),
            {
                httpMetadata: {
                    contentType: "application/vnd.recordare.musicxml+xml",
                },
            },
        );
        await c.env.DB.prepare(
            "INSERT INTO tab (id, title, artist, filename, original_filename, created_at, object_key) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
            .bind(
                id,
                title,
                artist,
                filename,
                safeFilename(
                    `${file instanceof File ? file.name.replace(/\.[^.]+$/, "") : "drum-tab"}.musicxml`,
                ),
                new Date().toISOString(),
                objectKey,
            )
            .run();
        return c.json({ ok: true, id, warnings: parsed.warnings });
    } catch (cause) {
        return error(
            cause instanceof Error
                ? cause.message
                : "Failed to create drum tab",
        );
    }
});

app.post("/api/new-tab/template/:type", async (c) => {
    try {
        await requireSession(c.env, c.req.raw);
        const type = c.req.param("type");
        if (!new Set(["bass", "guitar", "drum"]).has(type))
            throw new Error("Template not found");
        const id = crypto.randomUUID();
        const filename = "tab.musicxml";
        const objectKey = `tabs/${id}/${filename}`;
        await c.env.TABS_BUCKET.put(
            objectKey,
            emptyTemplate(type, id),
            {
                httpMetadata: {
                    contentType: "application/vnd.recordare.musicxml+xml",
                },
            },
        );
        await c.env.DB.prepare(
            "INSERT INTO tab (id, title, artist, filename, original_filename, created_at, object_key) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
            .bind(
                id,
                `Empty Tab #${id}`,
                "",
                filename,
                filename,
                new Date().toISOString(),
                objectKey,
            )
            .run();
        return c.json({ ok: true, id });
    } catch (cause) {
        return error(
            cause instanceof Error
                ? cause.message
                : "Failed to create template",
        );
    }
});

app.get("/api/ultimate-guitar/search", async (c) => {
    try {
        await requireSession(c.env, c.req.raw);
        const results = await searchUltimateGuitar(
            c.req.query("query") || "",
            c.req.query("mode") === "ascii-drums"
                ? "ascii-drums"
                : "guitar-pro",
            c.req.header("x-ultimate-guitar-cookie") || "",
            Number.parseInt(c.req.query("page") || "1", 10),
        );
        return c.json({ ok: true, results });
    } catch (cause) {
        return ultimateGuitarError(cause);
    }
});

app.get("/api/ultimate-guitar/tab", async (c) => {
    try {
        await requireSession(c.env, c.req.raw);
        return c.json({
            ok: true,
            tab: await getUltimateGuitarTab(
                c.req.query("url") || "",
                c.req.header("x-ultimate-guitar-cookie") || "",
            ),
        });
    } catch (cause) {
        return ultimateGuitarError(cause);
    }
});

app.get("/api/ultimate-guitar/download", async (c) => {
    try {
        await requireSession(c.env, c.req.raw);
        const response = await downloadUltimateGuitarFile(
            c.req.query("url") || "",
            c.req.header("x-ultimate-guitar-cookie") || "",
        );
        return new Response(response.body, {
            headers: {
                "Content-Type":
                    response.headers.get("content-type") ||
                    "application/octet-stream",
            },
        });
    } catch (cause) {
        return ultimateGuitarError(cause);
    }
});

app.get("/api/youtube-suggestions", async (c) => {
    try {
        await requireSession(c.env, c.req.raw);
        const query = c.req.query("q")?.trim();
        if (!query || query.length > 200)
            throw new Error(
                "Search query must be between 1 and 200 characters",
            );
        if (!c.env.YATTEE_USERNAME || !c.env.YATTEE_PASSWORD)
            throw new Error("Yattee search is not configured");
        const url = new URL(
            "/api/v1/search",
            c.env.YATTEE_BASE_URL || "https://yattee.etonello.work",
        );
        url.searchParams.set("q", query);
        url.searchParams.set("type", "video");
        const response = await fetch(url, {
            headers: {
                Authorization: `Basic ${btoa(`${c.env.YATTEE_USERNAME}:${c.env.YATTEE_PASSWORD}`)}`,
            },
        });
        if (!response.ok)
            throw new Error(`Yattee search failed (${response.status})`);
        const results = (await response.json()) as { videoId?: string }[];
        return c.json({
            ok: true,
            videos: results.filter((video) => video.videoId).slice(0, 10),
        });
    } catch (cause) {
        return error(
            cause instanceof Error
                ? cause.message
                : "Failed to load suggestions",
        );
    }
});

app.post("/api/tab/:id/replace", async (c) => {
    try {
        await requireSession(c.env, c.req.raw);
        const tab = await getTab(c.env.DB, c.req.param("id"));
        const form = await c.req.formData();
        const file = form.get("file");
        if (!(file instanceof File)) throw new Error("No file uploaded");
        const ext = extension(file.name);
        if (!sourceFormats.has(ext))
            throw new Error(`Unsupported file format: ${ext}`);
        const filename = `tab.${ext}`;
        const key = `tabs/${tab.id}/${filename}`;
        await c.env.TABS_BUCKET.put(key, file.stream(), {
            httpMetadata: { contentType: "application/octet-stream" },
        });
        if (tab.object_key !== key)
            await c.env.TABS_BUCKET.delete(tab.object_key);
        await c.env.DB.prepare(
            "UPDATE tab SET filename = ?, original_filename = ?, object_key = ? WHERE id = ?",
        )
            .bind(filename, safeFilename(file.name), key, tab.id)
            .run();
        return c.json({ ok: true });
    } catch (cause) {
        return error(
            cause instanceof Error ? cause.message : "Failed to replace tab",
        );
    }
});

app.post("/api/tab/:id/audio", async (c) => {
    try {
        await requireSession(c.env, c.req.raw);
        const tab = await getTab(c.env.DB, c.req.param("id"));
        const file = (await c.req.formData()).get("file");
        if (!(file instanceof File)) throw new Error("No file uploaded");
        const filename = safeFilename(file.name);
        const contentType = audioContentTypes.get(extension(filename));
        if (!contentType) throw new Error("Unsupported audio format");
        const key = `tabs/${tab.id}/audio/${filename}`;
        const existing = await c.env.DB.prepare(
            "SELECT filename FROM tab_audio WHERE tab_id = ? AND filename = ?",
        )
            .bind(tab.id, filename)
            .first();
        if (existing)
            throw new Error("Audio file with the same name already exists");
        await c.env.TABS_BUCKET.put(key, file.stream(), {
            httpMetadata: { contentType },
        });
        await c.env.DB.prepare(
            "INSERT INTO tab_audio (tab_id, filename, object_key, content_type) VALUES (?, ?, ?, ?)",
        )
            .bind(tab.id, filename, key, contentType)
            .run();
        return c.json({ ok: true });
    } catch (cause) {
        return error(
            cause instanceof Error ? cause.message : "Failed to add audio",
        );
    }
});

app.get("/api/tab/:id/audio/:filename", async (c) => {
    try {
        const tab = await requireTabAccess(c.env, c.req.raw, c.req.param("id"));
        const audio = await c.env.DB.prepare(
            "SELECT object_key, content_type FROM tab_audio WHERE tab_id = ? AND filename = ?",
        )
            .bind(tab.id, safeFilename(c.req.param("filename")))
            .first<{ object_key: string; content_type: string }>();
        if (!audio) return error("Audio file not found", 404);
        return await streamObject(
            c.env.TABS_BUCKET,
            audio.object_key,
            audio.content_type,
            c.req.param("filename"),
        );
    } catch (cause) {
        return error(
            cause instanceof Error ? cause.message : "Audio file not found",
            404,
        );
    }
});

app.post("/api/tab/:id/audio/:filename", async (c) => {
    try {
        await requireSession(c.env, c.req.raw);
        const tab = await getTab(c.env.DB, c.req.param("id"));
        const filename = safeFilename(c.req.param("filename"));
        const data = syncSchema.parse(await c.req.json());
        const result = await c.env.DB.prepare(
            "UPDATE tab_audio SET sync_method = ?, simple_sync = ?, advanced_sync = ? WHERE tab_id = ? AND filename = ?",
        )
            .bind(
                data.syncMethod,
                data.simpleSync,
                data.advancedSync,
                tab.id,
                filename,
            )
            .run();
        if (!result.meta.changes) throw new Error("Audio file not found");
        return c.json({ ok: true });
    } catch (cause) {
        return error(
            cause instanceof Error ? cause.message : "Failed to update audio",
        );
    }
});

app.delete("/api/tab/:id/audio/:filename", async (c) => {
    try {
        await requireSession(c.env, c.req.raw);
        const tab = await getTab(c.env.DB, c.req.param("id"));
        const filename = safeFilename(c.req.param("filename"));
        const audio = await c.env.DB.prepare(
            "SELECT object_key FROM tab_audio WHERE tab_id = ? AND filename = ?",
        )
            .bind(tab.id, filename)
            .first<{ object_key: string }>();
        if (!audio) throw new Error("Audio file not found");
        await c.env.TABS_BUCKET.delete(audio.object_key);
        await c.env.DB.prepare(
            "DELETE FROM tab_audio WHERE tab_id = ? AND filename = ?",
        )
            .bind(tab.id, filename)
            .run();
        return c.json({ ok: true });
    } catch (cause) {
        return error(
            cause instanceof Error ? cause.message : "Failed to remove audio",
        );
    }
});

app.post("/api/tab/:id/youtube", async (c) => {
    try {
        await requireSession(c.env, c.req.raw);
        const tab = await getTab(c.env.DB, c.req.param("id"));
        const { videoID } = z
            .object({ videoID: z.string().min(1) })
            .parse(await c.req.json());
        await c.env.DB.prepare(
            "INSERT INTO tab_youtube (tab_id, video_id) VALUES (?, ?)",
        )
            .bind(tab.id, videoID)
            .run();
        return c.json({ ok: true });
    } catch (cause) {
        return error(
            cause instanceof Error
                ? cause.message
                : "Failed to add YouTube video",
        );
    }
});

app.post("/api/tab/:id/youtube/:videoID", async (c) => {
    try {
        await requireSession(c.env, c.req.raw);
        const tab = await getTab(c.env.DB, c.req.param("id"));
        const data = syncSchema.parse(await c.req.json());
        await c.env.DB.prepare(
            "INSERT INTO tab_youtube (tab_id, video_id, sync_method, simple_sync, advanced_sync) VALUES (?, ?, ?, ?, ?) ON CONFLICT(tab_id, video_id) DO UPDATE SET sync_method = excluded.sync_method, simple_sync = excluded.simple_sync, advanced_sync = excluded.advanced_sync",
        )
            .bind(
                tab.id,
                c.req.param("videoID"),
                data.syncMethod,
                data.simpleSync,
                data.advancedSync,
            )
            .run();
        return c.json({ ok: true });
    } catch (cause) {
        return error(
            cause instanceof Error
                ? cause.message
                : "Failed to update YouTube video",
        );
    }
});

app.delete("/api/tab/:id/youtube/:videoID", async (c) => {
    try {
        await requireSession(c.env, c.req.raw);
        const tab = await getTab(c.env.DB, c.req.param("id"));
        await c.env.DB.prepare(
            "DELETE FROM tab_youtube WHERE tab_id = ? AND video_id = ?",
        )
            .bind(tab.id, c.req.param("videoID"))
            .run();
        return c.json({ ok: true });
    } catch (cause) {
        return error(
            cause instanceof Error
                ? cause.message
                : "Failed to remove YouTube video",
        );
    }
});

app.get("/api/tab/:id/file", async (c) => {
    try {
        const id = c.req.param("id");
        const token = c.req.query("tempToken");
        if (token) {
            const tokenData = await c.env.DB.prepare(
                "SELECT tab_id FROM file_token WHERE token = ? AND expires_at > ?",
            )
                .bind(token, new Date().toISOString())
                .first<{ tab_id: string }>();
            if (!tokenData || tokenData.tab_id !== id)
                throw new Error("Invalid or expired temp token");
            await c.env.DB.prepare("DELETE FROM file_token WHERE token = ?")
                .bind(token)
                .run();
        }
        const tab = token
            ? await getTab(c.env.DB, id)
            : await requireTabAccess(c.env, c.req.raw, id);
        return await streamObject(
            c.env.TABS_BUCKET,
            tab.object_key,
            "application/octet-stream",
            tab.original_filename,
        );
    } catch (cause) {
        return error(
            cause instanceof Error ? cause.message : "Tab file not found",
            404,
        );
    }
});

app.get("/api/tab/:id/temp-token", async (c) => {
    try {
        const tab = await requireTabAccess(c.env, c.req.raw, c.req.param("id"));
        const token = crypto.randomUUID();
        await c.env.DB.prepare(
            "INSERT INTO file_token (token, tab_id, expires_at) VALUES (?, ?, ?)",
        )
            .bind(token, tab.id, new Date(Date.now() + 20_000).toISOString())
            .run();
        return c.json({ ok: true, token });
    } catch (cause) {
        return error(
            cause instanceof Error
                ? cause.message
                : "Failed to create temp token",
            401,
        );
    }
});

app.delete("/api/tab/:id", async (c) => {
    try {
        await requireSession(c.env, c.req.raw);
        const tab = await getTab(c.env.DB, c.req.param("id"));
        const audio = await c.env.DB.prepare(
            "SELECT object_key FROM tab_audio WHERE tab_id = ?",
        )
            .bind(tab.id)
            .all<{ object_key: string }>();
        const keys = [
            tab.object_key,
            ...audio.results.map((item) => item.object_key),
        ];
        for (const key of keys)
            await moveObject(c.env.TABS_BUCKET, key, `deleted/${key}`);
        await c.env.DB.prepare("UPDATE tab SET deleted_at = ? WHERE id = ?")
            .bind(new Date().toISOString(), tab.id)
            .run();
        return c.json({ ok: true });
    } catch (cause) {
        return error(
            cause instanceof Error ? cause.message : "Failed to delete tab",
        );
    }
});

app.post("/api/tab/:id/restore", async (c) => {
    try {
        await requireSession(c.env, c.req.raw);
        const tab = await getTab(c.env.DB, c.req.param("id"), true);
        if (!tab.deleted_at) throw new Error("Tab is not deleted");
        const audio = await c.env.DB.prepare(
            "SELECT object_key FROM tab_audio WHERE tab_id = ?",
        )
            .bind(tab.id)
            .all<{ object_key: string }>();
        for (const key of [
            tab.object_key,
            ...audio.results.map((item) => item.object_key),
        ])
            await moveObject(c.env.TABS_BUCKET, `deleted/${key}`, key);
        await c.env.DB.prepare("UPDATE tab SET deleted_at = NULL WHERE id = ?")
            .bind(tab.id)
            .run();
        return c.json({ ok: true });
    } catch (cause) {
        return error(
            cause instanceof Error ? cause.message : "Failed to restore tab",
        );
    }
});

app.get("/api/health", (c) => c.json({ ok: true }));
app.all("/api/*", () => error("Page Not found", 404));
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

function ultimateGuitarError(cause: unknown) {
    if (cause instanceof UltimateGuitarError)
        return Response.json(
            { ok: false, code: cause.code, msg: cause.message },
            { status: cause.status },
        );
    return Response.json(
        {
            ok: false,
            code: "upstream_error",
            msg:
                cause instanceof Error
                    ? cause.message
                    : "Ultimate Guitar request failed",
        },
        { status: 502 },
    );
}

function emptyTemplate(type: string, id: string) {
    const instruments: Record<string, { name: string; clef: string; line: string }> = {
        bass: { name: "Bass", clef: "F", line: "4" },
        guitar: { name: "Guitar", clef: "G", line: "2" },
        drum: { name: "Drums", clef: "percussion", line: "2" },
    };
    const instrument = instruments[type]!;
    const title = `Empty ${instrument.name} Tab #${id}`;
    return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><work><work-title>${title}</work-title></work><part-list><score-part id="P1"><part-name>${instrument.name}</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>${instrument.clef}</sign><line>${instrument.line}</line></clef></attributes><note><rest measure="yes"/><duration>4</duration><voice>1</voice><type>whole</type></note></measure></part></score-partwise>`;
}

async function cleanupDeleted(env: Env) {
    const cutoff = new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    await env.DB.prepare(
        "DELETE FROM tab_audio WHERE tab_id IN (SELECT id FROM tab WHERE deleted_at < ?)",
    )
        .bind(cutoff)
        .run();
    await env.DB.prepare(
        "DELETE FROM tab_youtube WHERE tab_id IN (SELECT id FROM tab WHERE deleted_at < ?)",
    )
        .bind(cutoff)
        .run();
    await env.DB.prepare("DELETE FROM file_token WHERE expires_at < ?")
        .bind(new Date().toISOString())
        .run();
    await env.DB.prepare("DELETE FROM tab WHERE deleted_at < ?")
        .bind(cutoff)
        .run();
}

export default {
    fetch: app.fetch,
    scheduled: async (_event: unknown, env: Env, _context: unknown) => {
        await cleanupDeleted(env);
    },
};
