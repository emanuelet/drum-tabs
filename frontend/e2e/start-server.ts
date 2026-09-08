import { createOggEncoder } from "npm:wasm-media-encoders";

Deno.env.set("MYTABS_DEMO_MODE", "true");
Deno.env.set("MYTABS_LAUNCH_BROWSER", "false");
Deno.env.set("MYTABS_PORT", Deno.env.get("MYTABS_E2E_PORT") ?? "47779");
Deno.env.set("DATA_DIR", await Deno.makeTempDir({ prefix: "drum-tabs-e2e-" }));

const { main } = await import("../../backend/main.ts");
const { addAudio, addYoutube, getConfigJSON, getTab, updateConfigJSON } = await import("../../backend/tab.ts");

await main();

let tab;
for (let attempt = 0; attempt < 100; attempt++) {
    tab = await getTab("1").catch(() => null);
    if (tab) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
}
if (!tab) {
    throw new Error("Demo tab not found");
}

const samples = new Float32Array(44100 * 90);
const encoder = await createOggEncoder();
encoder.configure({ sampleRate: 44100, channels: 1, vbrQuality: 0 });
const chunks = [encoder.encode([samples]), encoder.finalize()].filter((chunk) => chunk.length > 0).map((chunk) => new Uint8Array(chunk));
const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
const audio = new Uint8Array(length);
let offset = 0;
for (const chunk of chunks) {
    audio.set(chunk, offset);
    offset += chunk.length;
}

await addAudio(tab, audio, "e2e-silence.ogg");
await addYoutube("1", "e2e-youtube");
const config = await getConfigJSON("1");
const audioMeta = config?.audio.find((item) => item.filename === "e2e-silence.ogg");
if (!audioMeta) {
    throw new Error("E2E audio metadata not found");
}
await updateConfigJSON("1", async (current) => {
    current.audio = current.audio.filter((item) => item.filename !== audioMeta.filename);
    current.audio.push({
        ...audioMeta,
        syncMethod: "advanced",
        simpleSync: 0,
        advancedSync: "\\sync 0 0 0\n\\sync 28 0 70000\n\\sync 93 0 272000",
    });
});
