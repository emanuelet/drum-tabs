import { baseURL } from "./app.ts";

export type Me = { role?: string; name?: string; email?: string; [key: string]: unknown };

let cached: Promise<Me | null> | null = null;

/** Current user from /api/me, shared between components so the page does one request. Resolves null when not logged in. */
export function fetchMe(): Promise<Me | null> {
    if (!cached) {
        cached = fetch(baseURL + "/api/me", { credentials: "include" })
            .then(async (res) => (res.ok ? (await res.json()).user ?? null : null))
            .catch(() => null);
        // Never keep a failed/empty result around
        cached.then((user) => {
            if (!user) cached = null;
        });
    }
    return cached;
}

/** Call after log in / log out. */
export function clearMe() {
    cached = null;
}
