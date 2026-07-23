import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from "jsr:@std/assert@^1.0.17";
import { buildUltimateGuitarSearchUrl, downloadUltimateGuitarFile, extractUltimateGuitarText, parseUltimateGuitarSearch, validateUltimateGuitarCookie } from "./ultimate-guitar.ts";

Deno.test("builds filtered Ultimate Guitar search URLs", () => {
    const url = buildUltimateGuitarSearchUrl("led zeppelin", "ascii-drums");
    assertStringIncludes(url, "title=led+zeppelin");
    assertStringIncludes(url, "type=700");
    assertStringIncludes(url, "rating%5B0%5D=4");
    assertStringIncludes(url, "rating%5B1%5D=5");
});

Deno.test("parses and deduplicates search results", () => {
    const results = parseUltimateGuitarSearch(`
        <a href="/tab/led-zeppelin/stairway-to-heaven-tabs-123">Stairway to Heaven</a><span>Rating 4.8</span>
        <a href="/tab/led-zeppelin/stairway-to-heaven-tabs-123">Duplicate</a>
        <a href="/tab/led-zeppelin/kashmir-tabs-456">Kashmir</a>
    `);
    assertEquals(results.length, 2);
    assertEquals(results[0].id, "led-zeppelin");
    assertEquals(results[0].title, "Stairway to Heaven");
});

Deno.test("validates cookie input", () => {
    assertThrows(() => validateUltimateGuitarCookie(""));
    assertThrows(() => validateUltimateGuitarCookie("sid=abc\nmalicious=value"));
    assertEquals(validateUltimateGuitarCookie("sid=abc"), "sid=abc");
});

Deno.test("extracts the complete ASCII tab without collapsing lines", () => {
    const tab = "HH|x-x-x-x-|\nSD|----o---|\nBD|o-------|";
    assertEquals(extractUltimateGuitarText(`<html><pre>${tab}</pre></html>`), tab);
});

Deno.test("does not request non-Ultimate Guitar download URLs", async () => {
    await assertRejects(() => downloadUltimateGuitarFile("https://example.com/file.gp", "sid=abc"), Error, "Invalid Ultimate Guitar download URL");
});
