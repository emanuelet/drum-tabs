import { expect, test } from "@playwright/test";
import { AUDIO_FILENAME, openTab, waitForDemoTab } from "./helpers.ts";

test.beforeEach(async ({ request }) => {
    await waitForDemoTab(request);
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
