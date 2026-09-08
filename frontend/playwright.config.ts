import { defineConfig } from "@playwright/test";

const port = process.env.MYTABS_E2E_PORT ?? "47779";

export default defineConfig({
    testDir: "./e2e",
    fullyParallel: false,
    workers: 1,
    timeout: 90_000,
    expect: { timeout: 15_000 },
    use: {
        baseURL: `http://127.0.0.1:${port}`,
        headless: true,
        viewport: { width: 1280, height: 720 },
        launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
    },
    webServer: {
        command: "deno task build-frontend && deno run -A --config=deno.jsonc frontend/e2e/start-server.ts",
        cwd: "..",
        url: `http://127.0.0.1:${port}`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
    },
});
