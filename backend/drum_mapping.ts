import { DrumInstrument, Notehead } from "./drum_types.ts";

export interface DrumMapping {
    instrument: DrumInstrument;
    step: string;
    octave: number;
    voice: 1 | 2;
    stem: "up" | "down";
    notehead: Notehead;
}

const map: Record<DrumInstrument, DrumMapping> = {
    "bass-drum": { instrument: "bass-drum", step: "F", octave: 4, voice: 2, stem: "down", notehead: "normal" },
    "snare": { instrument: "snare", step: "C", octave: 5, voice: 1, stem: "up", notehead: "normal" },
    "snare-rim": { instrument: "snare-rim", step: "C", octave: 5, voice: 1, stem: "up", notehead: "normal" },
    "closed-hi-hat": { instrument: "closed-hi-hat", step: "G", octave: 5, voice: 1, stem: "up", notehead: "x" },
    "open-hi-hat": { instrument: "open-hi-hat", step: "G", octave: 5, voice: 1, stem: "up", notehead: "circle-x" },
    "pedal-hi-hat": { instrument: "pedal-hi-hat", step: "G", octave: 4, voice: 2, stem: "down", notehead: "x" },
    crash: { instrument: "crash", step: "A", octave: 5, voice: 1, stem: "up", notehead: "x" },
    ride: { instrument: "ride", step: "F", octave: 5, voice: 1, stem: "up", notehead: "x" },
    "high-tom": { instrument: "high-tom", step: "F", octave: 5, voice: 1, stem: "up", notehead: "normal" },
    "mid-tom": { instrument: "mid-tom", step: "D", octave: 5, voice: 1, stem: "up", notehead: "normal" },
    "low-tom": { instrument: "low-tom", step: "B", octave: 4, voice: 1, stem: "up", notehead: "normal" },
    "floor-tom": { instrument: "floor-tom", step: "F", octave: 4, voice: 1, stem: "up", notehead: "normal" },
};

export const drumMappings = map;

export function resolveDrumLabel(label: string, symbol = "o"): DrumMapping | undefined {
    const normalized = label.trim().toUpperCase();
    let instrument: DrumInstrument | undefined;
    if (["B", "BD", "KD"].includes(normalized)) instrument = "bass-drum";
    else if (["S", "SD", "SN"].includes(normalized)) instrument = "snare";
    else if (normalized === "SR") instrument = "snare-rim";
    else if (["H", "HH"].includes(normalized)) instrument = symbol.toLowerCase() === "f" ? "pedal-hi-hat" : symbol.toLowerCase() === "o" ? "open-hi-hat" : "closed-hi-hat";
    else if (normalized === "HF") instrument = "pedal-hi-hat";
    else if (["C", "C1", "C2", "CC"].includes(normalized)) instrument = "crash";
    else if (["R", "RC", "RD", "RD"].includes(normalized)) instrument = "ride";
    else if (["T", "T1", "1T", "HT"].includes(normalized)) instrument = "high-tom";
    else if (["T2", "2T", "MT"].includes(normalized)) instrument = "mid-tom";
    else if (["T3", "3T", "LT"].includes(normalized)) instrument = "low-tom";
    else if (["F", "FT"].includes(normalized)) instrument = "floor-tom";
    return instrument ? map[instrument] : undefined;
}
