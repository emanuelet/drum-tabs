import { parseYoutubeVideoID } from "../frontend/src/youtube.ts";

Deno.test("parseYoutubeVideoID accepts supported YouTube URL formats", () => {
    const urls = [
        ["https://www.youtube.com/watch?v=video-123", "video-123"],
        ["https://music.youtube.com/watch?v=video-123", "video-123"],
        ["https://youtu.be/video-123?t=10", "video-123"],
        ["https://www.youtube.com/shorts/video-123?feature=share", "video-123"],
        ["https://www.youtube.com/embed/video-123", "video-123"],
    ];

    for (const [url, expected] of urls) {
        if (parseYoutubeVideoID(url) !== expected) {
            throw new Error(`expected ${url} to return ${expected}`);
        }
    }
});

Deno.test("parseYoutubeVideoID rejects malformed and unsupported URLs", () => {
    for (const url of ["", "video-123", "https://example.com/watch?v=video-123", "https://youtube.com/shorts/", "https://youtube.com/watch"]) {
        if (parseYoutubeVideoID(url) !== null) {
            throw new Error(`expected ${url} to be rejected`);
        }
    }
});
