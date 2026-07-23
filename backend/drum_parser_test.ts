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
    assert(xml.includes("<divisions>16</divisions>"));
    assert(xml.includes("<backup><duration>64</duration></backup>"));
});

Deno.test("normalizes slots, groups chords, completes voices, and emits tempo", () => {
    const tab = parseDrumTab("Title: Pulse\nTempo: 140\nHH|x-------x-------|\nSN|x---------------|\nB |--------o-------|");
    const xml = toMusicXml(tab);
    assert(xml.includes("<per-minute>140</per-minute>"));
    assert(xml.includes('<sound tempo="140"/>'));
    assert(xml.includes("<duration>32</duration>"));
    assert(xml.includes("<note><chord/><unpitched>"));
    assert(xml.includes("<backup><duration>64</duration></backup>"));
    assert(xml.includes("<note><rest/><duration>32</duration><voice>2</voice>"));
    assert(xml.indexOf("<unpitched>") < xml.indexOf("<duration>"));
    assert(xml.indexOf("<duration>") < xml.indexOf("<instrument id="));
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
