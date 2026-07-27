import * as fs from "@std/fs";
import * as path from "@std/path";
import * as z from "zod";
import { dataDir } from "./util.ts";

const ExerciseSchema = z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    subtitle: z.string().default(""),
    tempo: z.number().int().min(1),
    alphaTex: z.string().min(1),
    fav: z.boolean().default(false),
    createdAt: z.iso.datetime(),
});

const ExerciseListSchema = z.array(ExerciseSchema);

export type Exercise = z.infer<typeof ExerciseSchema>;

const exerciseFilePath = path.join(dataDir, "exercises.json");
let writeQueue = Promise.resolve();

const starterExercises: Exercise[] = [
    {
        id: "quarter-notes",
        title: "Quarter-note pulse",
        subtitle: "Lock the bass drum to a steady quarter-note pulse.",
        tempo: 70,
        alphaTex:
            '\\title "Quarter-note pulse" \\tempo 70 \\track "Drums" \\instrument percussion \\clef neutral \\articulation defaults :4 KickHit KickHit KickHit KickHit | KickHit KickHit KickHit KickHit',
        fav: true,
        createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
        id: "eighth-notes",
        title: "Eighth-note hi-hat",
        subtitle: "Keep even eighth notes while the kick anchors beats one and three.",
        tempo: 80,
        alphaTex:
            '\\title "Eighth-note hi-hat" \\tempo 80 \\track "Drums" \\instrument percussion \\clef neutral \\articulation defaults :8 (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed | (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed',
        fav: true,
        createdAt: "2026-01-01T00:00:01.000Z",
    },
    {
        id: "sixteenth-notes",
        title: "Sixteenth-note control",
        subtitle: "Build clean, relaxed control at a slower tempo before increasing speed.",
        tempo: 60,
        alphaTex:
            '\\title "Sixteenth-note control" \\tempo 60 \\track "Drums" \\instrument percussion \\clef neutral \\articulation defaults :16 (KickHit HiHatClosed) HiHatClosed HiHatClosed HiHatClosed (SnareHit HiHatClosed) HiHatClosed HiHatClosed HiHatClosed (KickHit HiHatClosed) HiHatClosed HiHatClosed HiHatClosed (SnareHit HiHatClosed) HiHatClosed HiHatClosed HiHatClosed',
        fav: true,
        createdAt: "2026-01-01T00:00:02.000Z",
    },
];

const drumArticulations: Record<string, string> = {
    "36": "KickHit2",
    "38": "SnareHit",
    "42": "HiHatClosed",
    "43": "VeryLowTomHit",
    "45": "LowTomHit",
    "48": "HighTomHit",
    "49": "CrashHighHit",
};

function extractDirective(alphaTex: string, directive: string): string | undefined {
    return alphaTex.match(new RegExp(`^\\\\${directive}\\s+"([^"\\r\\n]+)"`, "m"))?.[1]?.trim();
}

export function parseExerciseAlphaTex(alphaTex: string): Pick<Exercise, "title" | "subtitle" | "tempo"> {
    const title = extractDirective(alphaTex, "title");
    const tempo = alphaTex.match(/^\\tempo\s+(\d+)/m)?.[1];

    if (!title) throw new Error("AlphaTex must include a \\title directive");
    if (!tempo) throw new Error("AlphaTex must include a \\tempo directive");

    return {
        title,
        subtitle: extractDirective(alphaTex, "subtitle") || "",
        tempo: Number(tempo),
    };
}

function normalizeDrumChord(source: string): string {
    const tokens = source.trim().split(/\s+/);
    if (!tokens.some((token) => /^\d+(\.\d+)*$/.test(token))) return source;
    const notes = tokens.flatMap((token) => token.split(".")).map((note) => drumArticulations[note] || note);
    if (!notes.every((note) => !/^\d+$/.test(note))) return source;
    return notes.length === 1 ? notes[0] : `(${notes.join(" ")})`;
}

/**
 * Convert the compact numeric drum form used by pasted exercises to the
 * articulation-based form AlphaTab 1.8 can render.
 */
export function normalizeExerciseAlphaTex(alphaTex: string): string {
    return alphaTex.replace(/(\S):(\d+)/g, "$1 :$2").split("\n").flatMap((line) => {
        if (line.trim() === ".music") return [];
        if (/^\s*\\track\s+"[^"]+"\s+"drums"\s*$/.test(line)) {
            return [line.replace(/"drums"\s*$/, "\\instrument percussion \\clef neutral \\articulation defaults")];
        }
        if (/^\s*(\\|%|$)/.test(line)) return [line];

        return [line.replace(/:(\d+)\s+([^:|]+)/g, (_match, duration: string, beat: string) => {
            const rest = beat.match(/^\s*r\s+/);
            const notes = rest ? beat.slice(rest[0].length) : beat;
            const normalized = normalizeDrumChord(notes);
            return rest ? `:${duration} r :${duration} ${normalized}` : `:${duration} ${normalized}`;
        })];
    }).join("\n");
}

async function writeExercises(exercises: Exercise[]): Promise<void> {
    await Deno.writeTextFile(exerciseFilePath, JSON.stringify(exercises, null, 2) + "\n");
}

async function ensureExerciseFile(): Promise<void> {
    if (!await fs.exists(exerciseFilePath)) await writeExercises(starterExercises);
}

export async function getAllExercises(): Promise<Exercise[]> {
    await ensureExerciseFile();
    return ExerciseListSchema.parse(JSON.parse(await Deno.readTextFile(exerciseFilePath)));
}

export async function createExercise(alphaTex: string): Promise<Exercise> {
    const metadata = parseExerciseAlphaTex(alphaTex);
    const normalizedAlphaTex = normalizeExerciseAlphaTex(alphaTex);
    const exercise = ExerciseSchema.parse({
        id: crypto.randomUUID(),
        alphaTex: normalizedAlphaTex,
        createdAt: new Date().toISOString(),
        ...metadata,
    });

    const write = writeQueue.then(async () => {
        const exercises = await getAllExercises();
        exercises.push(exercise);
        await writeExercises(exercises);
    });
    writeQueue = write.catch(() => {});
    await write;

    return exercise;
}

export async function updateExerciseFav(id: string, fav: boolean): Promise<Exercise> {
    let updatedExercise: Exercise | undefined;
    const write = writeQueue.then(async () => {
        const exercises = await getAllExercises();
        const exercise = exercises.find((item) => item.id === id);
        if (!exercise) throw new Error("Exercise not found");
        exercise.fav = fav;
        updatedExercise = exercise;
        await writeExercises(exercises);
    });
    writeQueue = write.catch(() => {});
    await write;

    return updatedExercise!;
}

export async function updateExercise(id: string, alphaTex: string): Promise<Exercise> {
    const metadata = parseExerciseAlphaTex(alphaTex);
    const normalizedAlphaTex = normalizeExerciseAlphaTex(alphaTex);
    let updatedExercise: Exercise | undefined;
    const write = writeQueue.then(async () => {
        const exercises = await getAllExercises();
        const exercise = exercises.find((item) => item.id === id);
        if (!exercise) throw new Error("Exercise not found");
        Object.assign(exercise, metadata, { alphaTex: normalizedAlphaTex });
        updatedExercise = exercise;
        await writeExercises(exercises);
    });
    writeQueue = write.catch(() => {});
    await write;

    return updatedExercise!;
}

export async function deleteExercise(id: string): Promise<void> {
    const write = writeQueue.then(async () => {
        const exercises = await getAllExercises();
        const remainingExercises = exercises.filter((exercise) => exercise.id !== id);
        if (remainingExercises.length === exercises.length) throw new Error("Exercise not found");
        await writeExercises(remainingExercises);
    });
    writeQueue = write.catch(() => {});
    await write;
}
