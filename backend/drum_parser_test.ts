import { assert, assertEquals, assertThrows } from "jsr:@std/assert@^1.0.17";
import { parseDrumTab } from "./drum_parser.ts";
import { toMusicXml } from "./drum_musicxml.ts";

const sample =
    `[Verse 1]\nCC|x---------------|----------------|\nHH|--x-x-x-x-x-x-x-|--x-x-x-x-x-x-o-|\nSR|----------------|----o-----------|\nSN|----o-------g---|----o-------o---|\nT2|--------------d-|----------------|\nF |----------------|------------o---|\nB |o-------o-------|o-------o-------|`;

Deno.test("parses Ultimate Guitar drum labels and sections", () => {
    const tab = parseDrumTab(sample);
    assertEquals(tab.measures.length, 2);
    assertEquals(tab.measures[0].section, "Verse 1");
    assert(tab.measures.flatMap((measure) => measure.hits).some((hit) => hit.instrument === "closed-hi-hat"));
    assert(tab.measures.flatMap((measure) => measure.hits).some((hit) => hit.instrument === "snare-rim"));
    assert(tab.measures.flatMap((measure) => measure.hits).some((hit) => hit.tuplet === "double"));
});

Deno.test("expands repeat markers", () => {
    const tab = parseDrumTab("Repeat-2-Times\nC|x---|\nB|o---|");
    assertEquals(tab.measures.length, 2);
    assert(tab.warnings.some((warning) => warning.includes("Expanded repeat x2")));
});

Deno.test("rejects non-drum text", () => {
    assertThrows(() => parseDrumTab("These are lyrics, not a drum tab"));
});

Deno.test("emits percussion MusicXML", () => {
    const xml = toMusicXml(parseDrumTab(sample));
    assert(xml.includes("<score-partwise"));
    assert(xml.includes("<unpitched>"));
    assert(xml.includes("closed-hi-hat"));
});

Deno.test("handles the Ultimate Guitar edge-case fixture", async () => {
    const input = await Deno.readTextFile(new URL("./fixtures/ultimate-guitar-edge-cases.txt", import.meta.url));
    const tab = parseDrumTab(input);
    const hits = tab.measures.flatMap((measure) => measure.hits);
    assert(hits.some((hit) => hit.instrument === "high-tom"));
    assert(hits.some((hit) => hit.instrument === "low-tom"));
    assert(hits.some((hit) => hit.instrument === "crash"));
    assertEquals(hits.filter((hit) => hit.symbol.toLowerCase() === "f").length, 3);
    assertEquals(hits.filter((hit) => hit.symbol.toLowerCase() === "c").length, 1);
    assert(tab.warnings.length === 0 || tab.warnings.every((warning) => !warning.includes("Unsupported drum label")));
});
