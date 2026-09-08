import { type APIRequestContext, expect, type Page } from "@playwright/test";

export const TAB_ID = "1";
export const AUDIO_FILENAME = "e2e-silence.ogg";

export async function openTab(page: Page, source = "synth"): Promise<void> {
    await page.goto(`/tab/${TAB_ID}?audio=${source}`);
    await page.waitForFunction(() => {
        const api = (window as any).api;
        return api?.score?.masterBars?.length > 0 && api.player?.isReadyForPlayback;
    });
}

export async function waitForDemoTab(request: APIRequestContext): Promise<void> {
    await expect.poll(async () => {
        const response = await request.get(`/api/tab/${TAB_ID}`);
        if (!response.ok()) return false;
        const body = await response.json();
        return body.audioList?.some((audio: { filename: string }) => audio.filename === AUDIO_FILENAME);
    }, { timeout: 60_000 }).toBe(true);
}
