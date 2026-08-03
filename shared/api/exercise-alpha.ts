export interface ExerciseMetadata {
    title: string;
    subtitle: string;
    tempo: number;
}

const drumArticulations: Record<string, string> = {
    "36": "KickHit2", "38": "SnareHit", "42": "HiHatClosed", "43": "VeryLowTomHit", "45": "LowTomHit", "48": "HighTomHit", "49": "CrashHighHit",
};

function extractDirective(alphaTex: string, directive: string): string | undefined {
    return alphaTex.match(new RegExp(`^\\\\${directive}\\s+"([^"\\r\\n]+)"`, "m"))?.[1]?.trim();
}

export function parseExerciseAlphaTex(alphaTex: string): ExerciseMetadata {
    const title = extractDirective(alphaTex, "title");
    const tempo = alphaTex.match(/^\\tempo\s+(\d+)/m)?.[1];
    if (!title) throw new Error("AlphaTex must include a \\title directive");
    if (!tempo) throw new Error("AlphaTex must include a \\tempo directive");
    return { title, subtitle: extractDirective(alphaTex, "subtitle") || "", tempo: Number(tempo) };
}

function normalizeDrumChord(source: string): string {
    const tokens = source.trim().split(/\s+/);
    if (!tokens.some((token) => /^\d+(\.\d+)*$/.test(token))) return source;
    const notes = tokens.flatMap((token) => token.split(".")).map((note) => drumArticulations[note] || note);
    if (!notes.every((note) => !/^\d+$/.test(note))) return source;
    return notes.length === 1 ? notes[0] : `(${notes.join(" ")})`;
}

export function normalizeExerciseAlphaTex(alphaTex: string): string {
    return alphaTex.replace(/(\S):(\d+)/g, "$1 :$2").split("\n").flatMap((line) => {
        if (line.trim() === ".music") return [];
        if (/^\s*\\track\s+"[^"]+"\s+"drums"\s*$/.test(line)) return [line.replace(/"drums"\s*$/, "\\instrument percussion \\clef neutral \\articulation defaults")];
        if (/^\s*(\\|%|$)/.test(line)) return [line];
        return [line.replace(/:(\d+)\s+([^:|]+)/g, (_match, duration: string, beat: string) => {
            const rest = beat.match(/^\s*r\s+/);
            const notes = rest ? beat.slice(rest[0].length) : beat;
            const normalized = normalizeDrumChord(notes);
            return rest ? `:${duration} r :${duration} ${normalized}` : `:${duration} ${normalized}`;
        })];
    }).join("\n");
}
