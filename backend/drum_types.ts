export type DrumInstrument = "bass-drum" | "snare" | "snare-rim" | "closed-hi-hat" | "open-hi-hat" | "pedal-hi-hat" | "crash" | "ride" | "high-tom" | "mid-tom" | "low-tom" | "floor-tom";
export type Notehead = "normal" | "x" | "circle-x";

export interface DrumHit {
    instrument: DrumInstrument;
    symbol: string;
    slot: number;
    durationSlots: number;
    voice: 1 | 2;
    notehead: Notehead;
    articulation?: "ghost" | "accent" | "rim";
    tuplet?: "double" | "triplet";
}

export interface DrumMeasure {
    section?: string;
    slotCount: number;
    hits: DrumHit[];
}

export interface ParsedDrumTab {
    title?: string;
    artist?: string;
    tempo?: number;
    measures: DrumMeasure[];
    warnings: string[];
}
