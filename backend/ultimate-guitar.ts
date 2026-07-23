import * as cheerio from "cheerio";

export const ULTIMATE_GUITAR_BASE = "https://www.ultimate-guitar.com";
const MAX_COOKIE_LENGTH = 16_384;

export type UltimateGuitarMode = "guitar-pro" | "ascii-drums";

export interface UltimateGuitarResult {
    id: string;
    title: string;
    artist: string;
    rating: number | null;
    type: string;
    url: string;
}

export class UltimateGuitarError extends Error {
    code: string;
    status: number;

    constructor(code: string, message: string, status = 400) {
        super(message);
        this.name = "UltimateGuitarError";
        this.code = code;
        this.status = status;
    }
}

export function buildUltimateGuitarSearchUrl(query: string, mode: UltimateGuitarMode, page = 1): string {
    const params = new URLSearchParams({ title: query.trim(), page: String(Math.max(1, page)), order: "myweight" });
    if (mode === "guitar-pro") {
        params.set("type[0]", "500");
    } else {
        params.set("type", "700");
    }
    params.set("rating[0]", "4");
    params.set("rating[1]", "5");
    return `${ULTIMATE_GUITAR_BASE}/search.php?${params.toString()}`;
}

export function validateUltimateGuitarCookie(cookie: string | null): string {
    const value = cookie?.trim() || "";
    if (!value) throw new UltimateGuitarError("missing_cookie", "Paste an Ultimate Guitar Cookie header first.");
    if (value.length > MAX_COOKIE_LENGTH || /[\r\n]/.test(value)) {
        throw new UltimateGuitarError("invalid_cookie", "The Ultimate Guitar cookie is invalid.");
    }
    return value;
}

function parseRating(value: string | undefined): number | null {
    if (!value) return null;
    const rating = Number.parseFloat(value.replace(",", "."));
    return Number.isFinite(rating) ? rating : null;
}

export function parseUltimateGuitarSearch(html: string): UltimateGuitarResult[] {
    const $ = cheerio.load(html);
    const results: UltimateGuitarResult[] = [];
    $("a[href*='/tab/'], a[href*='/pro/']").each((_, element) => {
        const link = $(element);
        const href = link.attr("href");
        if (!href) return;
        const url = new URL(href, ULTIMATE_GUITAR_BASE).toString();
        const match = url.match(/\/(?:tab|pro)\/([^/?#]+)/);
        if (!match) return;
        const text = link.text().replace(/\s+/g, " ").trim();
        if (!text || results.some((result) => result.url === url)) return;
        const parentText = link.parent().text().replace(/\s+/g, " ").trim();
        const ratingMatch = parentText.match(/(?:rating|score)?\s*([45](?:\.\d+)?)/i);
        results.push({ id: match[1], title: text, artist: "", rating: parseRating(ratingMatch?.[1]), type: "", url });
    });
    return results;
}

export function extractUltimateGuitarText(html: string): string {
    const $ = cheerio.load(html);
    const candidates = ["pre", "[class*='tab-text']", "[class*='js-store']"];
    for (const selector of candidates) {
        const text = $(selector).first().text().trim();
        if (text && (selector === "pre" || text.includes("\n") || text.length > 100)) return text;
    }
    return "";
}

async function fetchUltimateGuitar(url: string, cookie: string, accept = "text/html") {
    const response = await fetch(url, {
        headers: { Cookie: validateUltimateGuitarCookie(cookie), Accept: accept, "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 401 || response.status === 403) throw new UltimateGuitarError("unauthorized", "Ultimate Guitar rejected the cookie.", response.status);
    if (response.status === 429) throw new UltimateGuitarError("rate_limited", "Ultimate Guitar rate limited the request.", 429);
    if (!response.ok) throw new UltimateGuitarError("upstream_error", `Ultimate Guitar returned HTTP ${response.status}.`, 502);
    return response;
}

export async function searchUltimateGuitar(query: string, mode: UltimateGuitarMode, cookie: string, page = 1) {
    if (!query.trim()) throw new UltimateGuitarError("missing_query", "Enter an artist or song to search for.");
    const response = await fetchUltimateGuitar(buildUltimateGuitarSearchUrl(query, mode, page), cookie);
    const results = parseUltimateGuitarSearch(await response.text());
    return results.filter((result) => result.rating === null || result.rating >= 4);
}

export async function getUltimateGuitarTab(url: string, cookie: string) {
    const parsed = new URL(url);
    if (parsed.origin !== ULTIMATE_GUITAR_BASE) throw new UltimateGuitarError("invalid_url", "Invalid Ultimate Guitar tab URL.");
    const response = await fetchUltimateGuitar(parsed.toString(), cookie);
    const html = await response.text();
    const $ = cheerio.load(html);
    const title = $("h1").first().text().trim();
    const download = $("a[href*='download'], a[download]").map((_, element) => $(element).attr("href")).get().find(Boolean);
    return { title, text: extractUltimateGuitarText(html), downloadUrl: download ? new URL(download, ULTIMATE_GUITAR_BASE).toString() : null };
}

export async function downloadUltimateGuitarFile(url: string, cookie: string) {
    const parsed = new URL(url);
    if (parsed.origin !== ULTIMATE_GUITAR_BASE) throw new UltimateGuitarError("invalid_url", "Invalid Ultimate Guitar download URL.");
    return fetchUltimateGuitar(parsed.toString(), cookie, "application/octet-stream");
}
