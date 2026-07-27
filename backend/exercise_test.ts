import { assertEquals, assertThrows } from "jsr:@std/assert@^1.0.17";
import * as fs from "@std/fs";
import * as path from "@std/path";
// @ts-types="https://cdn.jsdelivr.net/npm/@coderline/alphatab@1.8.4/dist/alphaTab.d.ts"
import { importer, Settings } from "@coderline/alphatab";

const tempDir = await Deno.makeTempDir();
Deno.env.set("DATA_DIR", tempDir);

const { createExercise, deleteExercise, getAllExercises, normalizeExerciseAlphaTex, parseExerciseAlphaTex, updateExercise, updateExerciseFav } = await import("./exercise.ts");

const fillExercise = `\\title "Fill Value Permutation Exercise"
\\subtitle "Shifting 16th Notes Through 8th Notes - Quarter Bar Fills"
\\tempo 100
\\ts 4 4

.music
\\track "Drums" "drums"

:8 49.36 42 :8 38 42 :8 36 42 :8 38 48 |
:8 42.36 42 :8 38 42 :8 36 42 :8 45 43 |`;

Deno.test("exercise storage seeds the built-in presets", async () => {
    const exercises = await getAllExercises();
    assertEquals(exercises.length, 3);
    assertEquals(exercises[0].title, "Quarter-note pulse");
    assertEquals(exercises.every((exercise) => exercise.fav), true);
    assertEquals(await fs.exists(path.join(tempDir, "exercises.json")), true);
});

Deno.test("updateExerciseFav persists favorite status", async () => {
    const exercise = (await getAllExercises())[0];
    assertEquals((await updateExerciseFav(exercise.id, false)).fav, false);
    assertEquals((await getAllExercises()).find((item) => item.id === exercise.id)?.fav, false);
    assertEquals((await updateExerciseFav(exercise.id, true)).fav, true);
});

Deno.test("createExercise persists AlphaTex metadata and content", async () => {
    const exercise = await createExercise(fillExercise);
    assertEquals(exercise.title, "Fill Value Permutation Exercise");
    assertEquals(exercise.subtitle, "Shifting 16th Notes Through 8th Notes - Quarter Bar Fills");
    assertEquals(exercise.tempo, 100);

    const exercises = await getAllExercises();
    assertEquals(exercises.some((item) => item.id === exercise.id && item.alphaTex.includes("\\instrument percussion")), true);
});

Deno.test("numeric drum AlphaTex normalizes to a score AlphaTab can load", () => {
    const alphaTex = new importer.AlphaTexImporter();
    alphaTex.initFromString(normalizeExerciseAlphaTex(fillExercise), new Settings());
    const score = alphaTex.readScore();
    assertEquals(score.title, "Fill Value Permutation Exercise");
    assertEquals(score.tempo, 100);
    assertEquals(score.tracks[0].staves[0].isPercussion, true);
});

Deno.test("normalization restores separators between compact duration groups", () => {
    const alphaTex = '\\title "Compact"\\tempo 100\\track "Drums" \\instrument percussion\\n:8 (KickHit HiHatClosed):8 (SnareHit HiHatClosed)|';
    assertEquals(normalizeExerciseAlphaTex(alphaTex).includes(") :8"), true);
});

Deno.test("updateExercise persists edited AlphaTex metadata", async () => {
    const exercise = (await getAllExercises())[0];
    const updated = await updateExercise(
        exercise.id,
        `\\title "Edited"
\\tempo 120
\\track "Drums" \\instrument percussion
:4 KickHit`,
    );
    assertEquals(updated.title, "Edited");
    assertEquals(updated.tempo, 120);
});

Deno.test("deleteExercise removes an exercise", async () => {
    const exercise = (await getAllExercises())[0];
    await deleteExercise(exercise.id);
    assertEquals((await getAllExercises()).some((item) => item.id === exercise.id), false);
});

Deno.test("named AlphaTex is not changed during exercise import", () => {
    const alphaTex = '\\title "Named" \\tempo 90 \\track "Drums" \\instrument percussion :8 (KickHit HiHatClosed)';
    assertEquals(normalizeExerciseAlphaTex(alphaTex), alphaTex);
});

Deno.test("exercise AlphaTex requires title and tempo directives", async () => {
    assertThrows(() => parseExerciseAlphaTex("\\tempo 100"), Error, "\\title");
    assertThrows(() => parseExerciseAlphaTex('\\title "No tempo"'), Error, "\\tempo");
});

Deno.test.afterAll(async () => {
    await fs.emptyDir(tempDir);
    await Deno.remove(tempDir);
});
