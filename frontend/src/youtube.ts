const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "music.youtube.com", "www.music.youtube.com"]);
const YOUTUBE_SHORT_HOSTS = new Set(["youtu.be", "www.youtu.be"]);

export function parseYoutubeVideoID(value: string): string | null {
    let url: URL;
    try {
        url = new URL(value.trim());
    } catch {
        return null;
    }

    const host = url.hostname.toLowerCase();
    if (YOUTUBE_SHORT_HOSTS.has(host)) {
        return url.pathname.split("/").filter(Boolean)[0] || null;
    }

    if (!YOUTUBE_HOSTS.has(host)) {
        return null;
    }

    if (url.pathname === "/watch") {
        return url.searchParams.get("v");
    }

    const [kind, videoID] = url.pathname.split("/").filter(Boolean);
    return (kind === "shorts" || kind === "embed") && videoID ? videoID : null;
}
