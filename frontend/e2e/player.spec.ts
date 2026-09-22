// deno-lint-ignore-file no-explicit-any no-window no-window-prefix -- browser-context test helpers mimic YouTube's untyped iframe API.
import { expect, type Locator, type Page, test } from "@playwright/test";
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
            volume = 100;
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
                return this.volume;
            }

            setVolume(volume: number) {
                this.volume = volume;
            }

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

async function setRangeValue(locator: Locator, value: string) {
    await locator.evaluate((input, newValue) => {
        (input as HTMLInputElement).value = newValue;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
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

test("formats BPM with two decimal places", async ({ page }) => {
    await openTab(page);
    await page.getByRole("button", { name: /Speed:/ }).click();

    const bpmInput = page.getByRole("spinbutton", { name: "BPM" });
    await bpmInput.fill("96.127");
    await bpmInput.press("Tab");
    await expect(bpmInput).toHaveValue("96.13");
});

test("persists master and per-track volumes", async ({ page }) => {
    await openTab(page);
    await page.locator(".track-selector .button").click();

    const masterVolume = page.locator(".track-list .master-volume input");
    const trackVolumes = page.locator(".track-list .track .select-percentage input");
    const trackCount = await trackVolumes.count();
    const volumeBoost = page.getByLabel("Allow volume boost");
    await expect(volumeBoost).not.toBeChecked();
    await expect(masterVolume).toHaveAttribute("max", "100");
    await expect(trackVolumes.first()).toHaveAttribute("max", "100");
    await expect(masterVolume).not.toHaveClass(/boost-enabled/);
    await volumeBoost.check();
    await expect(masterVolume).toHaveAttribute("max", "200");
    await expect(trackVolumes.first()).toHaveAttribute("max", "200");
    await expect(masterVolume).toHaveClass(/boost-enabled/);

    await setRangeValue(masterVolume, "44");
    await expect(masterVolume).toHaveValue("44");
    for (let index = 0; index < trackCount; index++) {
        await expect(trackVolumes.nth(index)).toHaveValue("44");
    }

    await setRangeValue(trackVolumes.first(), "80");
    await expect(trackVolumes.first()).toHaveValue("80");
    await page.locator(".track-list .mute").first().click();
    await expect(trackVolumes.first()).toBeDisabled();
    await page.locator(".track-list .mute").first().click();
    await expect(trackVolumes.first()).toBeEnabled();

    await openTab(page);
    await page.locator(".track-selector .button").click();
    await expect(page.getByLabel("Allow volume boost")).toBeChecked();
    await expect(page.locator(".track-list .master-volume input")).toHaveValue("44");
    await expect(page.locator(".track-list .track .select-percentage input").first()).toHaveValue("80");
    for (let index = 1; index < trackCount; index++) {
        await expect(page.locator(".track-list .track .select-percentage input").nth(index)).toHaveValue("44");
    }
});

test("uses master volume for YouTube and disables track mixing", async ({ page }) => {
    await installYoutubeStub(page);
    await openTab(page, `youtube-${YOUTUBE_VIDEO_ID}`);
    await page.waitForFunction(() => (window as any).__youtubeTest.players.length === 1);
    await page.locator(".track-selector .button").click();

    const masterVolume = page.locator(".track-list .master-volume input");
    const trackVolumes = page.locator(".track-list .track .select-percentage input");
    await expect(masterVolume).toHaveValue("100");
    await expect(trackVolumes.first()).toBeDisabled();
    await expect(page.locator(".track-list .solo").first()).toBeDisabled();
    await expect(page.locator(".track-list .mute").first()).toBeDisabled();

    await setRangeValue(masterVolume, "44");
    await expect.poll(() => page.evaluate(() => (window as any).__youtubeTest.players[0].volume)).toBe(44);
});

test("reenables track controls after switching from YouTube to Synth", async ({ page }) => {
    await installYoutubeStub(page);
    await openTab(page, `youtube-${YOUTUBE_VIDEO_ID}`);
    await page.waitForFunction(() => (window as any).__youtubeTest.players.length === 1);

    await page.locator(".audio-selector .button").click();
    await page.locator(".audio-list .audio.item", { hasText: "Synth" }).click();
    await page.locator(".track-selector .button").click();

    await expect(page.locator(".track-list .track .select-percentage input").first()).toBeEnabled();
    await expect(page.locator(".track-list .solo").first()).toBeEnabled();
    await expect(page.locator(".track-list .mute").first()).toBeEnabled();
});

test("keeps one YouTube sync timer across buffering", async ({ page }) => {
    await installYoutubeStub(page);
    await openTab(page, `youtube-${YOUTUBE_VIDEO_ID}`);
    await page.waitForFunction(() => (window as any).__youtubeTest.players.length === 1);
    // AlphaTab may cue the new player after its constructor runs.
    await page.waitForTimeout(100);

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

test("edits advanced YouTube sync points from the player", async ({ page }) => {
    await installYoutubeStub(page);
    await page.route("**/api/auth/get-session", async (route) => {
        await route.fulfill({ json: { session: { id: "e2e-session" }, user: { id: "e2e-user" } } });
    });
    await page.route(`**/api/tab/${TAB_ID}`, async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        const youtube = body.youtubeList.find((item: { videoID: string }) => item.videoID === YOUTUBE_VIDEO_ID);
        youtube.syncMethod = "advanced";
        youtube.simpleSync = 0;
        youtube.advancedSync = "\\sync 0 0 0";
        await route.fulfill({ response, json: body });
    });
    await openTab(page, `youtube-${YOUTUBE_VIDEO_ID}`);
    await page.waitForFunction(() => (window as any).__youtubeTest.players.length === 1);

    const player = page.locator(".youtube-player");
    await expect(player.getByRole("button", { name: "Fix Audio Sync" })).toBeVisible();
    await page.evaluate(() => (window as any).__youtubeTest.players[0].currentTime = 12.345);
    await player.getByRole("button", { name: "Fix Audio Sync" }).click();
    await expect(player.getByRole("button", { name: "Close audio sync editor" })).toBeVisible();
    await expect(player.getByRole("button", { name: "Fix Audio Sync" })).toBeHidden();
    await expect(player.locator(".youtube-sync-point-marker")).toHaveCount(1);
    await expect(page.locator(".youtube-sync-tab-marker")).toHaveCount(1);

    await player.getByRole("button", { name: "Bar 1: 0.000s" }).click();
    await expect(player.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
    await expect(player.getByRole("button", { name: "Delete", exact: true })).toBeVisible();
    await expect(page.locator(".youtube-sync-tab-marker.selected")).toHaveCount(1);

    await page.evaluate(() => {
        const beat = (window as any).api.score.tracks[0].staves[0].bars[5].voices[0].beats[0];
        (window as any).api.beatMouseDown.trigger(beat);
    });

    const inputs = player.locator(".youtube-sync-fields input");
    await expect(inputs.nth(0)).toHaveValue("6");
    await expect(inputs.nth(1)).toHaveValue("12.345");
    await expect(player.getByRole("button", { name: "Add", exact: true })).toBeVisible();

    await inputs.nth(0).fill("5");
    await inputs.nth(1).fill("12.5");
    await player.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Added sync point for bar 5.")).toBeVisible();
    await expect(player.locator(".youtube-sync-point-marker")).toHaveCount(2);
    await expect(page.locator(".youtube-sync-tab-marker")).toHaveCount(2);
    await expect(page.locator(".youtube-sync-tab-marker.selected")).toHaveCount(1);

    await inputs.nth(1).fill("13");
    await player.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByText("Updated sync point for bar 5.")).toBeVisible();

    await player.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText("Deleted sync point for bar 5.")).toBeVisible();
    await expect(player.getByRole("button", { name: "Add", exact: true })).toBeVisible();
    await expect(page.locator(".youtube-sync-tab-marker")).toHaveCount(1);

    let savedSync: string | undefined;
    await page.route(`**/api/tab/${TAB_ID}/youtube/${YOUTUBE_VIDEO_ID}`, async (route) => {
        if (route.request().method() !== "POST") {
            await route.continue();
            return;
        }
        savedSync = route.request().postDataJSON().advancedSync;
        await route.fulfill({ json: {} });
    });
    await player.getByRole("button", { name: "Save Sync" }).click();
    await expect.poll(() => savedSync).toBe("\\sync 0 0 0");
    await expect(page.getByText("Audio sync saved.")).toBeVisible();
    await expect(player.getByRole("button", { name: "Fix Audio Sync" })).toBeVisible();
    await expect(player.getByRole("button", { name: "Close audio sync editor" })).toBeHidden();
});

test("disposes YouTube when switching sources", async ({ page }) => {
    await installYoutubeStub(page);
    await openTab(page, `youtube-${YOUTUBE_VIDEO_ID}`);
    await page.waitForFunction(() => (window as any).__youtubeTest.players.length === 1);

    await page.locator(".audio-selector .button").click();
    await page.locator(".audio-list .audio.item", { hasText: "Synth" }).click();

    await expect.poll(() => page.evaluate(() => (window as any).__youtubeTest.destroyed)).toBe(1);
});

test("switches from playing YouTube to Synth without using a destroyed player", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await installYoutubeStub(page);
    await openTab(page, `youtube-${YOUTUBE_VIDEO_ID}`);
    await page.waitForFunction(() => (window as any).__youtubeTest.players.length === 1);

    await page.getByRole("button", { name: "Play" }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__youtubeTest.players[0].state)).toBe(1);
    await page.locator(".audio-selector .button").click();
    await page.locator(".audio-list .audio.item", { hasText: "Synth" }).click();

    await expect.poll(() => page.evaluate(() => (window as any).__youtubeTest.destroyed)).toBe(1);
    expect(errors).toEqual([]);
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
