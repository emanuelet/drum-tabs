// @deno-types="npm:@coderline/alphatab@1.8.4"
import { exporter, importer, Settings } from "@coderline/alphatab-core";
import { DrumHit, DrumInstrument, ParsedDrumTab } from "./drum_types.ts";

const articulations: Record<DrumInstrument, string> = {
    "bass-drum": "KickHit",
    snare: "SnareHit",
    "snare-rim": "SnareRimShot",
    "closed-hi-hat": "HiHatClosed",
    "open-hi-hat": "HiHatOpen",
    "pedal-hi-hat": "PedalHiHatHit",
    crash: "CrashHighHit",
    ride: "RideMiddle",
    "high-tom": "HighTomHit",
    "mid-tom": "MidTomHit",
    "low-tom": "LowTomHit",
    "floor-tom": "LowFloorTomHit",
};

function escapeAlphaTex(value: string): string {
    return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function gridFor(slotCount: number): number {
    const grids = [1, 2, 4, 8, 16, 32, 64];
    return grids.reduce((nearest, grid) => Math.abs(grid - slotCount) < Math.abs(nearest - slotCount) ? grid : nearest);
}

function quantizedHits(hits: DrumHit[], slotCount: number, grid: number): Map<number, DrumHit[]> {
    const beats = new Map<number, DrumHit[]>();
    for (const hit of hits) {
        const position = Math.min(grid - 1, Math.max(0, Math.round(hit.slot * grid / slotCount)));
        const beat = beats.get(position) ?? [];
        beat.push(hit);
        beats.set(position, beat);
    }
    return beats;
}

function measureToAlphaTex({ hits, slotCount }: ParsedDrumTab["measures"][number]): string {
    const grid = gridFor(slotCount);
    const duration = grid;
    const beats = quantizedHits(hits, slotCount, grid);
    return Array.from({ length: grid }, (_, position) => {
        const notes = beats.get(position);
        if (!notes) return `r.${duration}`;
        const articulationsAtBeat = [...new Set(notes.map((hit) => articulations[hit.instrument]))];
        const note = articulationsAtBeat.length === 1 ? articulationsAtBeat[0] : `(${articulationsAtBeat.join(" ")})`;
        return `${note}.${duration}`;
    }).join(" ");
}

export function toDrumAlphaTex(tab: ParsedDrumTab): string {
    const metadata = [
        `\\title "${escapeAlphaTex(tab.title ?? "Drum Tab")}"`,
        tab.artist ? `\\artist "${escapeAlphaTex(tab.artist)}"` : "",
        `\\tempo ${tab.tempo ?? 120}`,
    ].filter(Boolean).join(" ");
    const measures = tab.measures.map(measureToAlphaTex).join(" | ");
    return `${metadata} \\track "Drums" \\instrument percussion \\clef neutral \\articulation defaults ${measures}`;
}

export function toGp7(tab: ParsedDrumTab): Uint8Array {
    const scoreImporter = new importer.AlphaTexImporter();
    scoreImporter.initFromString(toDrumAlphaTex(tab), new Settings());
    return new exporter.Gp7Exporter().export(scoreImporter.readScore());
}
