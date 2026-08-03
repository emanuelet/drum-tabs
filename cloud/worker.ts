import { Hono } from "hono";
import { z } from "zod";
import { createAuth } from "./auth.ts";
import type { Env } from "./env.ts";

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

const sourceFormats = new Set(["gp", "gpx", "gp3", "gp4", "gp5", "musicxml", "capx", "txt"]);
const audioFormats = new Map([["mp3", "audio/mpeg"], ["ogg", "audio/ogg"]]);
const syncSchema = z.object({ syncMethod: z.enum(["simple", "advanced"]), simpleSync: z.number(), advancedSync: z.string() });
const registrationSchema = z.object({
    email: z.email(),
    name: z.string().trim().min(1).max(100),
    pin: z.string().regex(/^\d{6}$/, "PIN must be exactly 6 digits"),
    role: z.enum(["teacher", "learner"]),
});

function error(message: string, status = 400) {
    return Response.json({ ok: false, error: message, msg: message }, { status });
}

function extension(filename: string) {
    const value = filename.split(".").pop()?.toLowerCase();
    if (!value) throw new Error("File has no extension");
    return value;
}

export function safeFilename(filename: string) {
    if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes("..")) throw new Error("Invalid filename");
    return filename.replace(/[^A-Za-z0-9._ -]/g, "_");
}

export function registrationBody(input: unknown) {
    const { email, name, pin } = registrationSchema.parse(input);
    return { email, name, password: pin };
}

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
    return await createAuth(env, new URL(request.url).origin).api.getSession({ headers: request.headers });
}

async function requireSession(env: Env, request: Request) {
    const session = await currentSession(env, request);
    if (!session) throw new Error("Not logged in");
    return session;
}

async function getTab(db: D1Database, id: string, includeDeleted = false) {
    const statement = includeDeleted ? "SELECT * FROM tab WHERE id = ?" : "SELECT * FROM tab WHERE id = ? AND deleted_at IS NULL";
    const row = await db.prepare(statement).bind(id).first<TabRow>();
    if (!row) throw new Error("Tab not found");
    return row;
}

async function requireTabAccess(env: Env, request: Request, id: string) {
    const tab = await getTab(env.DB, id);
    if (!tab.is_public) await requireSession(env, request);
    return tab;
}

async function streamObject(bucket: R2Bucket, key: string, fallbackType: string, downloadName: string) {
    const object = await bucket.get(key);
    if (!object || !object.body) return error("File not found", 404);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Content-Type", headers.get("Content-Type") || fallbackType);
    headers.set("Content-Disposition", `attachment; filename="${encodeURIComponent(downloadName)}"`);
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

// Registration must go through /api/register so only the initial user can be created.
app.post("/api/auth/sign-up/email", () => error("Use /api/register", 404));
app.all("/api/auth/*", (c) => createAuth(c.env, new URL(c.req.url).origin).handler(c.req.raw));

app.get("/api/is-finish-setup", async (c) => {
    const user = await c.env.DB.prepare("SELECT id FROM user LIMIT 1").first();
    return c.json(Boolean(user));
});

app.post("/api/register", async (c) => {
    try {
        const existing = await c.env.DB.prepare("SELECT id FROM user LIMIT 1").first();
        if (existing) return error("User already exists");
        const body = registrationBody(await c.req.json());
        const auth = createAuth(c.env, new URL(c.req.url).origin);
        const result = await auth.api.signUpEmail({ body });
        return c.json(result);
    } catch (cause) {
        return error(cause instanceof Error ? cause.message : "Registration failed");
    }
});

app.get("/api/tabs", async (c) => {
    try {
        await requireSession(c.env, c.req.raw);
        const rows = await c.env.DB.prepare("SELECT * FROM tab WHERE deleted_at IS NULL ORDER BY created_at DESC").all<TabRow>();
        return c.json({ ok: true, tabs: rows.results.map(tabValue) });
    } catch (cause) {
        return error(cause instanceof Error ? cause.message : "Failed to load tabs", 401);
    }
});

app.post("/api/new-tab", async (c) => {
    try {
        await requireSession(c.env, c.req.raw);
        const form = await c.req.formData();
        const file = form.get("file");
        if (!(file instanceof File)) throw new Error("No file uploaded");
        const ext = extension(file.name);
        if (!sourceFormats.has(ext)) throw new Error(`Unsupported file format: ${ext}`);
        const id = crypto.randomUUID();
        const filename = `tab.${ext}`;
        const objectKey = `tabs/${id}/${filename}`;
        await c.env.TABS_BUCKET.put(objectKey, file.stream(), { httpMetadata: { contentType: "application/octet-stream" } });
        await c.env.DB.prepare("INSERT INTO tab (id, title, artist, filename, original_filename, created_at, object_key) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(id, String(form.get("title") || file.name).trim(), String(form.get("artist") || "").trim(), filename, safeFilename(file.name), new Date().toISOString(), objectKey).run();
        return c.json({ ok: true, id });
    } catch (cause) {
        return error(cause instanceof Error ? cause.message : "Failed to create tab");
    }
});

app.get("/api/tab/:id", async (c) => {
    try {
        const tab = await requireTabAccess(c.env, c.req.raw, c.req.param("id"));
        const [audio, youtube] = await Promise.all([
            c.env.DB.prepare("SELECT filename, sync_method, simple_sync, advanced_sync FROM tab_audio WHERE tab_id = ?").bind(tab.id).all<
                { filename: string; sync_method: string; simple_sync: number; advanced_sync: string }
            >(),
            c.env.DB.prepare("SELECT video_id, sync_method, simple_sync, advanced_sync FROM tab_youtube WHERE tab_id = ?").bind(tab.id).all<
                { video_id: string; sync_method: string; simple_sync: number; advanced_sync: string }
            >(),
        ]);
        return c.json({
            ok: true,
            showOpenButtons: false,
            tab: tabValue(tab),
            audioList: audio.results.map((item) => ({ filename: item.filename, syncMethod: item.sync_method, simpleSync: item.simple_sync, advancedSync: item.advanced_sync })),
            youtubeList: youtube.results.map((item) => ({ videoID: item.video_id, syncMethod: item.sync_method, simpleSync: item.simple_sync, advancedSync: item.advanced_sync })),
        });
    } catch (cause) {
        return error(cause instanceof Error ? cause.message : "Tab not found", 404);
    }
});

app.post("/api/tab/:id", async (c) => {
    try {
        await requireSession(c.env, c.req.raw);
        const body = z.object({ title: z.string().min(1), artist: z.string(), public: z.boolean() }).parse(await c.req.json());
        const result = await c.env.DB.prepare("UPDATE tab SET title = ?, artist = ?, is_public = ? WHERE id = ? AND deleted_at IS NULL").bind(
            body.title,
            body.artist,
            Number(body.public),
            c.req.param("id"),
        ).run();
        if (!result.meta.changes) throw new Error("Tab not found");
        return c.json({ ok: true });
    } catch (cause) {
        return error(cause instanceof Error ? cause.message : "Failed to update tab");
    }
});

app.post("/api/tab/:id/fav", async (c) => {
    try {
        await requireSession(c.env, c.req.raw);
        const { fav } = z.object({ fav: z.boolean() }).parse(await c.req.json());
        await c.env.DB.prepare("UPDATE tab SET is_fav = ? WHERE id = ? AND deleted_at IS NULL").bind(Number(fav), c.req.param("id")).run();
        return c.json({ ok: true });
    } catch (cause) {
        return error(cause instanceof Error ? cause.message : "Failed to update favorite");
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
        if (!sourceFormats.has(ext)) throw new Error(`Unsupported file format: ${ext}`);
        const filename = `tab.${ext}`;
        const key = `tabs/${tab.id}/${filename}`;
        await c.env.TABS_BUCKET.put(key, file.stream(), { httpMetadata: { contentType: "application/octet-stream" } });
        if (tab.object_key !== key) await c.env.TABS_BUCKET.delete(tab.object_key);
        await c.env.DB.prepare("UPDATE tab SET filename = ?, original_filename = ?, object_key = ? WHERE id = ?").bind(filename, safeFilename(file.name), key, tab.id).run();
        return c.json({ ok: true });
    } catch (cause) {
        return error(cause instanceof Error ? cause.message : "Failed to replace tab");
    }
});

app.post("/api/tab/:id/audio", async (c) => {
    try {
        await requireSession(c.env, c.req.raw);
        const tab = await getTab(c.env.DB, c.req.param("id"));
        const file = (await c.req.formData()).get("file");
        if (!(file instanceof File)) throw new Error("No file uploaded");
        const filename = safeFilename(file.name);
        const contentType = audioFormats.get(extension(filename));
        if (!contentType) throw new Error("Unsupported audio format");
        const key = `tabs/${tab.id}/audio/${filename}`;
        const existing = await c.env.DB.prepare("SELECT filename FROM tab_audio WHERE tab_id = ? AND filename = ?").bind(tab.id, filename).first();
        if (existing) throw new Error("Audio file with the same name already exists");
        await c.env.TABS_BUCKET.put(key, file.stream(), { httpMetadata: { contentType } });
        await c.env.DB.prepare("INSERT INTO tab_audio (tab_id, filename, object_key, content_type) VALUES (?, ?, ?, ?)").bind(tab.id, filename, key, contentType).run();
        return c.json({ ok: true });
    } catch (cause) {
        return error(cause instanceof Error ? cause.message : "Failed to add audio");
    }
});

app.get("/api/tab/:id/audio/:filename", async (c) => {
    try {
        const tab = await requireTabAccess(c.env, c.req.raw, c.req.param("id"));
        const audio = await c.env.DB.prepare("SELECT object_key, content_type FROM tab_audio WHERE tab_id = ? AND filename = ?").bind(tab.id, safeFilename(c.req.param("filename"))).first<
            { object_key: string; content_type: string }
        >();
        if (!audio) return error("Audio file not found", 404);
        return await streamObject(c.env.TABS_BUCKET, audio.object_key, audio.content_type, c.req.param("filename"));
    } catch (cause) {
        return error(cause instanceof Error ? cause.message : "Audio file not found", 404);
    }
});

app.post("/api/tab/:id/audio/:filename", async (c) => {
    try {
        await requireSession(c.env, c.req.raw);
        const tab = await getTab(c.env.DB, c.req.param("id"));
        const filename = safeFilename(c.req.param("filename"));
        const data = syncSchema.parse(await c.req.json());
        const result = await c.env.DB.prepare("UPDATE tab_audio SET sync_method = ?, simple_sync = ?, advanced_sync = ? WHERE tab_id = ? AND filename = ?")
            .bind(data.syncMethod, data.simpleSync, data.advancedSync, tab.id, filename).run();
        if (!result.meta.changes) throw new Error("Audio file not found");
        return c.json({ ok: true });
    } catch (cause) {
        return error(cause instanceof Error ? cause.message : "Failed to update audio");
    }
});

app.delete("/api/tab/:id/audio/:filename", async (c) => {
    try {
        await requireSession(c.env, c.req.raw);
        const tab = await getTab(c.env.DB, c.req.param("id"));
        const filename = safeFilename(c.req.param("filename"));
        const audio = await c.env.DB.prepare("SELECT object_key FROM tab_audio WHERE tab_id = ? AND filename = ?").bind(tab.id, filename).first<{ object_key: string }>();
        if (!audio) throw new Error("Audio file not found");
        await c.env.TABS_BUCKET.delete(audio.object_key);
        await c.env.DB.prepare("DELETE FROM tab_audio WHERE tab_id = ? AND filename = ?").bind(tab.id, filename).run();
        return c.json({ ok: true });
    } catch (cause) {
        return error(cause instanceof Error ? cause.message : "Failed to remove audio");
    }
});

app.post("/api/tab/:id/youtube", async (c) => {
    try {
        await requireSession(c.env, c.req.raw);
        const tab = await getTab(c.env.DB, c.req.param("id"));
        const { videoID } = z.object({ videoID: z.string().min(1) }).parse(await c.req.json());
        await c.env.DB.prepare("INSERT INTO tab_youtube (tab_id, video_id) VALUES (?, ?)").bind(tab.id, videoID).run();
        return c.json({ ok: true });
    } catch (cause) {
        return error(cause instanceof Error ? cause.message : "Failed to add YouTube video");
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
            .bind(tab.id, c.req.param("videoID"), data.syncMethod, data.simpleSync, data.advancedSync).run();
        return c.json({ ok: true });
    } catch (cause) {
        return error(cause instanceof Error ? cause.message : "Failed to update YouTube video");
    }
});

app.delete("/api/tab/:id/youtube/:videoID", async (c) => {
    try {
        await requireSession(c.env, c.req.raw);
        const tab = await getTab(c.env.DB, c.req.param("id"));
        await c.env.DB.prepare("DELETE FROM tab_youtube WHERE tab_id = ? AND video_id = ?").bind(tab.id, c.req.param("videoID")).run();
        return c.json({ ok: true });
    } catch (cause) {
        return error(cause instanceof Error ? cause.message : "Failed to remove YouTube video");
    }
});

app.get("/api/tab/:id/file", async (c) => {
    try {
        const id = c.req.param("id");
        const token = c.req.query("tempToken");
        if (token) {
            const tokenData = await c.env.DB.prepare("SELECT tab_id FROM file_token WHERE token = ? AND expires_at > ?").bind(token, new Date().toISOString()).first<{ tab_id: string }>();
            if (!tokenData || tokenData.tab_id !== id) throw new Error("Invalid or expired temp token");
            await c.env.DB.prepare("DELETE FROM file_token WHERE token = ?").bind(token).run();
        }
        const tab = token ? await getTab(c.env.DB, id) : await requireTabAccess(c.env, c.req.raw, id);
        return await streamObject(c.env.TABS_BUCKET, tab.object_key, "application/octet-stream", tab.original_filename);
    } catch (cause) {
        return error(cause instanceof Error ? cause.message : "Tab file not found", 404);
    }
});

app.get("/api/tab/:id/temp-token", async (c) => {
    try {
        const tab = await requireTabAccess(c.env, c.req.raw, c.req.param("id"));
        const token = crypto.randomUUID();
        await c.env.DB.prepare("INSERT INTO file_token (token, tab_id, expires_at) VALUES (?, ?, ?)").bind(token, tab.id, new Date(Date.now() + 20_000).toISOString()).run();
        return c.json({ ok: true, token });
    } catch (cause) {
        return error(cause instanceof Error ? cause.message : "Failed to create temp token", 401);
    }
});

app.get("/api/settings", async (c) => {
    try {
        const session = await requireSession(c.env, c.req.raw);
        const value = await c.env.DB.prepare("SELECT value_json FROM user_setting WHERE user_id = ?").bind(session.user.id).first<{ value_json: string }>();
        if (!value) throw new Error("Settings not found on server");
        return c.json({ ok: true, setting: JSON.parse(value.value_json) });
    } catch (cause) {
        return error(cause instanceof Error ? cause.message : "Failed to get settings", 404);
    }
});

app.post("/api/settings", async (c) => {
    try {
        const session = await requireSession(c.env, c.req.raw);
        const value = await c.req.json();
        await c.env.DB.prepare(
            "INSERT INTO user_setting (user_id, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
        )
            .bind(session.user.id, JSON.stringify(value), new Date().toISOString()).run();
        return c.json({ ok: true });
    } catch (cause) {
        return error(cause instanceof Error ? cause.message : "Failed to save settings");
    }
});

app.delete("/api/tab/:id", async (c) => {
    try {
        await requireSession(c.env, c.req.raw);
        const tab = await getTab(c.env.DB, c.req.param("id"));
        const audio = await c.env.DB.prepare("SELECT object_key FROM tab_audio WHERE tab_id = ?").bind(tab.id).all<{ object_key: string }>();
        const keys = [tab.object_key, ...audio.results.map((item) => item.object_key)];
        for (const key of keys) await moveObject(c.env.TABS_BUCKET, key, `deleted/${key}`);
        await c.env.DB.prepare("UPDATE tab SET deleted_at = ? WHERE id = ?").bind(new Date().toISOString(), tab.id).run();
        return c.json({ ok: true });
    } catch (cause) {
        return error(cause instanceof Error ? cause.message : "Failed to delete tab");
    }
});

app.post("/api/tab/:id/restore", async (c) => {
    try {
        await requireSession(c.env, c.req.raw);
        const tab = await getTab(c.env.DB, c.req.param("id"), true);
        if (!tab.deleted_at) throw new Error("Tab is not deleted");
        const audio = await c.env.DB.prepare("SELECT object_key FROM tab_audio WHERE tab_id = ?").bind(tab.id).all<{ object_key: string }>();
        for (const key of [tab.object_key, ...audio.results.map((item) => item.object_key)]) await moveObject(c.env.TABS_BUCKET, `deleted/${key}`, key);
        await c.env.DB.prepare("UPDATE tab SET deleted_at = NULL WHERE id = ?").bind(tab.id).run();
        return c.json({ ok: true });
    } catch (cause) {
        return error(cause instanceof Error ? cause.message : "Failed to restore tab");
    }
});

app.get("/api/health", (c) => c.json({ ok: true }));
app.all("/api/*", () => error("Page Not found", 404));
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

async function cleanupDeleted(env: Env) {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare("DELETE FROM tab_audio WHERE tab_id IN (SELECT id FROM tab WHERE deleted_at < ?)").bind(cutoff).run();
    await env.DB.prepare("DELETE FROM tab_youtube WHERE tab_id IN (SELECT id FROM tab WHERE deleted_at < ?)").bind(cutoff).run();
    await env.DB.prepare("DELETE FROM file_token WHERE expires_at < ?").bind(new Date().toISOString()).run();
    await env.DB.prepare("DELETE FROM tab WHERE deleted_at < ?").bind(cutoff).run();
}

export default {
    fetch: app.fetch,
    scheduled: async (_event: unknown, env: Env, _context: unknown) => {
        await cleanupDeleted(env);
    },
};
