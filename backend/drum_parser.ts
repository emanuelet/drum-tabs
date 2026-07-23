import { resolveDrumLabel } from "./drum_mapping.ts";
import { DrumHit, DrumInstrument, DrumMeasure, ParsedDrumTab } from "./drum_types.ts";

interface StaffLine {
    label: string;
    body: string;
}
const staffPattern = /^\s*([A-Za-z0-9][A-Za-z0-9]{0,2})\s*\|\s*(.*)$/;
const sectionPattern = /^\s*(?:>>\s*)?(?:\[([^\]]+)\]|([A-Za-z][A-Za-z0-9 /_-]{1,40}):?)\s*$/;
const playable = /[xXoOfFcCgGdD]/;

function metadata(input: string) {
    const title = input.match(/^\s*(?:Song|Title)\s*:\s*(.+)$/im)?.[1]?.trim();
    const artist = input.match(/^\s*Artist\s*:\s*(.+)$/im)?.[1]?.trim();
    const tempo = Number(input.match(/^\s*Tempo\s*:\s*(\d+)/im)?.[1]);
    return { title, artist, tempo: Number.isFinite(tempo) && tempo > 0 ? tempo : undefined };
}

function sectionFor(line: string): string | undefined {
    const match = line.match(sectionPattern);
    if (!match || line.includes("|") || /^[-<>]+$/.test(line.trim())) return undefined;
    const value = (match[1] ?? match[2] ?? "").trim();
    if (/^(artist|song|title|tempo|tabbed by|key|album)$/i.test(value) || /^(repeat|play)\b/i.test(value)) return undefined;
    if (/^(before|when|you're|your|what|here|introductory)$/i.test(value)) return undefined;
    return value;
}

function repeatCount(lines: string[]): number | undefined {
    const text = lines.join(" ");
    const match = text.match(/(?:repeat|play)\s*-?\s*(\d+)\s*(?:times|x)?|(?:repeat|play)\s*(\d+)\s*x|x(\d+)/i);
    return match ? Number(match[1] ?? match[2] ?? match[3]) : undefined;
}

function symbolHits(line: StaffLine, width: number, warnings: string[]): DrumHit[] {
    const hits: DrumHit[] = [];
    const body = line.body.padEnd(width, "-");
    for (let slot = 0; slot < body.length; slot++) {
        const symbol = body[slot];
        if (!playable.test(symbol)) continue;
        if (symbol.toLowerCase() === "f" && body[slot - 1]?.toLowerCase() === "f") continue;
        if (symbol.toLowerCase() === "g" && body[slot - 1]?.toLowerCase() === "c") continue;
        const mapping = resolveDrumLabel(line.label, symbol);
        if (!mapping) {
            warnings.push(`Unsupported drum label ${line.label}`);
            continue;
        }
        if (symbol.toLowerCase() === "d") {
            hits.push({ instrument: mapping.instrument, symbol, slot, durationSlots: 1, voice: mapping.voice, notehead: mapping.notehead, tuplet: "double" });
            hits.push({ instrument: mapping.instrument, symbol, slot: slot + 0.5, durationSlots: 1, voice: mapping.voice, notehead: mapping.notehead, tuplet: "double" });
            continue;
        }
        const isGrab = symbol.toLowerCase() === "c" && body[slot + 1]?.toLowerCase() === "g";
        const articulation = symbol.toLowerCase() === "g" ? "ghost" : isGrab ? "accent" : symbol === symbol.toUpperCase() && /[XOFG]/.test(symbol) ? "accent" : undefined;
        let durationSlots = 1;
        while (slot + durationSlots < body.length && !playable.test(body[slot + durationSlots])) durationSlots++;
        hits.push({ instrument: mapping.instrument, symbol, slot, durationSlots, voice: mapping.voice, notehead: mapping.notehead, articulation });
    }
    return hits;
}

function parseBlock(lines: StaffLine[], section: string | undefined, warnings: string[]): DrumMeasure[] {
    const columns = lines.map((line) => line.body.split("|"));
    const count = Math.max(...columns.map((parts) => parts.length));
    const measures: DrumMeasure[] = [];
    for (let index = 0; index < count; index++) {
        const cells = lines.map((line, lineIndex) => ({ ...line, body: columns[lineIndex][index] ?? "" }));
        const width = Math.max(...cells.map((cell) => cell.body.length));
        if (!width) continue;
        const hits = cells.flatMap((cell) => symbolHits(cell, width, warnings));
        if (hits.length) measures.push({ section, slotCount: width, hits });
    }
    return measures;
}

export function parseDrumTab(input: string): ParsedDrumTab {
    const warnings: string[] = [];
    const result: ParsedDrumTab = { ...metadata(input), measures: [], warnings };
    let section: string | undefined;
    let block: StaffLine[] = [];
    let markerLines: string[] = [];
    const flush = () => {
        if (block.length) {
            const supported = block.some((line) => resolveDrumLabel(line.label));
            if (supported) {
                const parsed = parseBlock(block, section, warnings);
                const repeat = repeatCount(markerLines);
                if (repeat && repeat > 1 && repeat <= 64 && parsed.length) {
                    for (let i = 0; i < repeat; i++) result.measures.push(...parsed.map((measure) => ({ ...measure, hits: measure.hits.map((hit) => ({ ...hit })) })));
                    warnings.push(`Expanded repeat x${repeat}`);
                } else {
                    result.measures.push(...parsed);
                    if (repeat && repeat > 64) warnings.push(`Repeat x${repeat} was not expanded (limit 64)`);
                }
            }
            block = [];
            markerLines = [];
        }
    };
    for (const raw of input.replace(/\r/g, "").split("\n")) {
        const staff = raw.match(staffPattern);
        if (staff) {
            block.push({ label: staff[1], body: staff[2] });
            continue;
        }
        if (raw.trim() && /(repeat|play\s*x|times)/i.test(raw)) markerLines.push(raw);
        const nextSection = sectionFor(raw);
        if (nextSection) {
            flush();
            section = nextSection;
            continue;
        }
        if (!raw.trim() || /^[-<>]+$/.test(raw.trim()) || /^\s*[|+0-9 ]+$/.test(raw)) continue;
        if (block.length) flush();
    }
    flush();
    if (!result.measures.length) throw new Error("No recognizable drum tab hits found");
    return result;
}
