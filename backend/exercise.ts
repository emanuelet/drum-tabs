import * as fs from "@std/fs";
import * as path from "@std/path";
import * as z from "zod";
import { db } from "./db.ts";
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

function exerciseFromRow(row: Record<string, unknown>): Exercise {
    return ExerciseSchema.parse({
        id: row.id,
        title: row.title,
        subtitle: row.subtitle,
        tempo: row.tempo,
        alphaTex: row.alpha_tex,
        fav: Boolean(row.is_fav),
        createdAt: row.created_at,
    });
}

async function initializeExerciseStore() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS exercise (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            subtitle TEXT NOT NULL DEFAULT '',
            tempo INTEGER NOT NULL,
            alpha_tex TEXT NOT NULL,
            is_fav INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            position INTEGER NOT NULL
        );
    `);

    const row = db.prepare("SELECT COUNT(*) AS count FROM exercise").get() as { count: number };
    if (row.count > 0) return;

    const exercises = await fs.exists(exerciseFilePath) ? ExerciseListSchema.parse(JSON.parse(await Deno.readTextFile(exerciseFilePath))) : starterExercises;
    const insert = db.prepare(
        "INSERT INTO exercise (id, title, subtitle, tempo, alpha_tex, is_fav, created_at, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    db.exec("BEGIN");
    try {
        exercises.forEach((exercise, position) => {
            insert.run(exercise.id, exercise.title, exercise.subtitle, exercise.tempo, exercise.alphaTex, Number(exercise.fav), exercise.createdAt, position);
        });
        db.exec("COMMIT");
    } catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
}

const exerciseStoreReady = initializeExerciseStore();

export async function getAllExercises(): Promise<Exercise[]> {
    await exerciseStoreReady;
    return db.prepare("SELECT id, title, subtitle, tempo, alpha_tex, is_fav, created_at FROM exercise ORDER BY position ASC").all().map((row) => exerciseFromRow(row as Record<string, unknown>));
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

    await exerciseStoreReady;
    db.prepare(
        "INSERT INTO exercise (id, title, subtitle, tempo, alpha_tex, is_fav, created_at, position) VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT MAX(position) + 1 FROM exercise), 0))",
    ).run(exercise.id, exercise.title, exercise.subtitle, exercise.tempo, exercise.alphaTex, Number(exercise.fav), exercise.createdAt);

    return exercise;
}

export async function updateExerciseFav(id: string, fav: boolean): Promise<Exercise> {
    await exerciseStoreReady;
    const result = db.prepare("UPDATE exercise SET is_fav = ? WHERE id = ?").run(Number(fav), id);
    if (result.changes === 0) throw new Error("Exercise not found");
    const row = db.prepare("SELECT id, title, subtitle, tempo, alpha_tex, is_fav, created_at FROM exercise WHERE id = ?").get(id);
    return exerciseFromRow(row as Record<string, unknown>);
}

export async function updateExercise(id: string, alphaTex: string): Promise<Exercise> {
    const metadata = parseExerciseAlphaTex(alphaTex);
    const normalizedAlphaTex = normalizeExerciseAlphaTex(alphaTex);
    await exerciseStoreReady;
    const result = db.prepare("UPDATE exercise SET title = ?, subtitle = ?, tempo = ?, alpha_tex = ? WHERE id = ?").run(
        metadata.title,
        metadata.subtitle,
        metadata.tempo,
        normalizedAlphaTex,
        id,
    );
    if (result.changes === 0) throw new Error("Exercise not found");
    const row = db.prepare("SELECT id, title, subtitle, tempo, alpha_tex, is_fav, created_at FROM exercise WHERE id = ?").get(id);
    return exerciseFromRow(row as Record<string, unknown>);
}

export async function deleteExercise(id: string): Promise<void> {
    await exerciseStoreReady;
    const result = db.prepare("DELETE FROM exercise WHERE id = ?").run(id);
    if (result.changes === 0) throw new Error("Exercise not found");
}
