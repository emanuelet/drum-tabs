// deno-lint-ignore-file no-explicit-any no-window no-window-prefix -- browser-context test helpers mimic YouTube's untyped iframe API.
import { expect, type Page, test } from "@playwright/test";
import { AUDIO_FILENAME, openTab, TAB_ID, waitForDemoTab, YOUTUBE_VIDEO_ID } from "./helpers.ts";

async function installYoutubeStub(page: Page) {
    await page.addInitScript(() => {
        const activeIntervals = new Map<number, number>();
        const setInterval = window.setInterval.bind(window);
        const clearInterval = window.clearInterval.bind(window);

        window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: any[]) => {
            const id = setInterval(handler, timeout, ...args) as unknown as number;
            activeIntervals.set(id, timeout ?? 0);
            return id;
        }) as typeof window.setInterval;
        window.clearInterval = ((id?: number) => {
            activeIntervals.delete(id as number);
            clearInterval(id);
        }) as typeof window.clearInterval;

        class Player {
            config: any;
            state = 5;
            currentTime = 0;
            seeks: number[] = [];
            destroyed = false;

            constructor(_element: Element, config: any) {
                this.config = config;
                (window as any).__youtubeTest.players.push(this);
                queueMicrotask(() => config.events.onReady({ target: this }));
            }

            emit(state: number) {
                this.state = state;
                this.config.events.onStateChange({ data: state, target: this });
            }

            cueVideoById() {
                this.emit((window as any).YT.PlayerState.CUED);
            }

            playVideo() {
                this.emit((window as any).YT.PlayerState.PLAYING);
            }

            pauseVideo() {
                this.emit((window as any).YT.PlayerState.PAUSED);
            }

            destroy() {
                this.destroyed = true;
                (window as any).__youtubeTest.destroyed++;
            }

            pauseVideo() {
                if (this.destroyed) throw new Error("YouTube player was used after destroy");
                this.emit((window as any).YT.PlayerState.PAUSED);
            }

            getCurrentTime() {
                return this.currentTime;
            }

            getDuration() {
                return 300;
            }

            getPlayerState() {
                return this.state;
            }

            getPlaybackRate() {
                return 1;
            }

            setPlaybackRate() {}

            getVolume() {
                return 100;
            }

            setVolume() {}

            seekTo(time: number) {
                this.currentTime = time;
                this.seeks.push(time);
            }
        }

        (window as any).__youtubeTest = { activeIntervals, destroyed: 0, players: [] };
        (window as any).YT = {
            Player,
            PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
        };
    });
}

test.beforeEach(async ({ request }) => {
    await waitForDemoTab(request);
});

test("loads tab metadata once during initial player setup", async ({ page }) => {
    let metadataRequests = 0;
    await page.route(`**/api/tab/${TAB_ID}`, async (route) => {
        metadataRequests++;
        await route.continue();
    });

    await openTab(page);
    expect(metadataRequests).toBe(1);
});

test("keeps advanced sync points after loading an audio source", async ({ page }) => {
    await openTab(page, `audio-${AUDIO_FILENAME}`);
    await page.waitForTimeout(250);
    const syncPoints = await page.evaluate(() => (window as any).api.score.exportFlatSyncPoints());
    expect(syncPoints).toContainEqual(expect.objectContaining({ barIndex: 28, millisecondOffset: 70000 }));
});

test("keeps the selected playback range when switching audio", async ({ page }) => {
    await openTab(page);
    const selected = await page.evaluate(() => {
        const api = (window as any).api;
        const bars = api.score.tracks[0].staves[0].bars;
        const firstBeat = bars[0].voices[0].beats[0];
        const lastBeat = bars[2].voices[0].beats.at(-1);
        return api.playbackRange = {
            startTick: firstBeat.absolutePlaybackStart,
            endTick: lastBeat.absolutePlaybackStart + lastBeat.playbackDuration,
        };
    });
    await page.locator(".audio-selector .button").click();
    await page.locator(".audio-list .audio.item", { hasText: AUDIO_FILENAME }).click();
    await expect.poll(() => page.evaluate(() => (window as any).api.playbackRange)).toEqual(selected);
});

test("delays external-audio playback for the count-in", async ({ page }) => {
    await page.addInitScript(() => {
        const originalPlay = HTMLMediaElement.prototype.play;
        (window as any).__audioPlayTimes = [];
        HTMLMediaElement.prototype.play = function () {
            (window as any).__audioPlayTimes.push(performance.now());
            return originalPlay.call(this);
        };
    });
    await openTab(page, `audio-${AUDIO_FILENAME}`);
    await page.getByRole("button", { name: "Count in" }).click();
    const startedAt = await page.evaluate(() => performance.now());
    await page.getByRole("button", { name: "Play" }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__audioPlayTimes.length), { timeout: 12_000 }).toBeGreaterThan(0);
    const playedAt = await page.evaluate(() => (window as any).__audioPlayTimes[0]);
    expect(playedAt - startedAt).toBeGreaterThanOrEqual(1500);
});

test("shows a long or short track name before its MIDI fallback", async ({ page }) => {
    await openTab(page);
    const expected = await page.evaluate(() => (window as any).api.score.tracks.map((track: any) => (track.name ?? "").trim() || (track.shortName ?? "").trim()));
    await page.locator(".track-selector .button").click();
    const names = await page.locator(".track-list .track .name").allTextContents();
    expected.forEach((name, index) => {
        if (name) expect(names[index].trim()).toBe(name);
    });
});

test("persists master and per-track volumes", async ({ page }) => {
    await openTab(page);
    await page.locator(".track-selector .button").click();

    const masterVolume = page.locator(".track-list .master-volume input");
    const trackVolumes = page.locator(".track-list .track .select-percentage input");
    const trackCount = await trackVolumes.count();

    await masterVolume.fill("44");
    await expect(masterVolume).toHaveValue("44");
    for (let index = 0; index < trackCount; index++) {
        await expect(trackVolumes.nth(index)).toHaveValue("44");
    }

    await trackVolumes.first().fill("80");
    await expect(trackVolumes.first()).toHaveValue("80");

    await openTab(page);
    await page.locator(".track-selector .button").click();
    await expect(page.locator(".track-list .master-volume input")).toHaveValue("44");
    await expect(page.locator(".track-list .track .select-percentage input").first()).toHaveValue("80");
    for (let index = 1; index < trackCount; index++) {
        await expect(page.locator(".track-list .track .select-percentage input").nth(index)).toHaveValue("44");
    }
});

test("keeps one YouTube sync timer across buffering", async ({ page }) => {
    await installYoutubeStub(page);
    await openTab(page, `youtube-${YOUTUBE_VIDEO_ID}`);
    await page.waitForFunction(() => (window as any).__youtubeTest.players.length === 1);

    const baseline = await page.evaluate(() => (window as any).__youtubeTest.activeIntervals.size);
    await page.evaluate(() => (window as any).__youtubeTest.players[0].emit((window as any).YT.PlayerState.PLAYING));
    await expect.poll(() => page.evaluate(() => (window as any).__youtubeTest.activeIntervals.size)).toBe(baseline + 1);
    expect(await page.evaluate(() => [...(window as any).__youtubeTest.activeIntervals.values()])).toContain(100);

    await page.evaluate(() => (window as any).__youtubeTest.players[0].emit((window as any).YT.PlayerState.BUFFERING));
    await expect.poll(() => page.evaluate(() => (window as any).__youtubeTest.activeIntervals.size)).toBe(baseline);

    await page.evaluate(() => (window as any).__youtubeTest.players[0].emit((window as any).YT.PlayerState.PLAYING));
    await expect.poll(() => page.evaluate(() => (window as any).__youtubeTest.activeIntervals.size)).toBe(baseline + 1);

    await page.evaluate(() => (window as any).__youtubeTest.players[0].emit((window as any).YT.PlayerState.PLAYING));
    await expect.poll(() => page.evaluate(() => (window as any).__youtubeTest.activeIntervals.size)).toBe(baseline + 1);
});

test("disposes YouTube when switching sources", async ({ page }) => {
    await installYoutubeStub(page);
    await openTab(page, `youtube-${YOUTUBE_VIDEO_ID}`);
    await page.waitForFunction(() => (window as any).__youtubeTest.players.length === 1);

    await page.locator(".audio-selector .button").click();
    await page.locator(".audio-list .audio.item", { hasText: "Synth" }).click();

    await expect.poll(() => page.evaluate(() => (window as any).__youtubeTest.destroyed)).toBe(1);
});

test("allows AlphaTab to stop before its YouTube player is destroyed", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await installYoutubeStub(page);
    await openTab(page, `youtube-${YOUTUBE_VIDEO_ID}`);
    await page.waitForFunction(() => (window as any).__youtubeTest.players.length === 1);

    await page.evaluate(() => (window as any).api.destroy());

    expect(errors).toEqual([]);
});

test("applies deferred YouTube seeks after cueing", async ({ page }) => {
    await installYoutubeStub(page);
    await openTab(page, `youtube-${YOUTUBE_VIDEO_ID}`);
    await page.waitForFunction(() => (window as any).__youtubeTest.players.length === 1);

    await page.evaluate(() => {
        const player = (window as any).__youtubeTest.players[0];
        player.state = -1;
        (window as any).api.player.output.handler.seekTo(12_000);
        player.emit((window as any).YT.PlayerState.CUED);
    });

    await expect.poll(() => page.evaluate(() => (window as any).__youtubeTest.players[0].seeks.at(-1))).toBe(12);
});
