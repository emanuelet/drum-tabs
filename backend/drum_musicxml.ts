import { drumMappings } from "./drum_mapping.ts";
import { DrumHit, ParsedDrumTab } from "./drum_types.ts";

const divisions = 16;
const measureDuration = divisions * 4;
const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function typeFor(duration: number) {
    if (duration >= 64) return "whole";
    if (duration >= 32) return "half";
    if (duration >= 16) return "quarter";
    if (duration >= 8) return "eighth";
    if (duration >= 4) return "16th";
    if (duration >= 2) return "32nd";
    return "64th";
}

function note(hit: DrumHit, duration: number, chord = false) {
    const mapping = drumMappings[hit.instrument];
    const notehead = hit.articulation === "ghost"
        ? '<notehead parentheses="yes">normal</notehead>'
        : hit.articulation === "rim"
        ? "<notehead>slash</notehead>"
        : hit.notehead !== "normal"
        ? `<notehead>${hit.notehead}</notehead>`
        : "";
    return `<note>${
        chord ? "<chord/>" : ""
    }<unpitched><display-step>${mapping.step}</display-step><display-octave>${mapping.octave}</display-octave></unpitched><duration>${duration}</duration><instrument id="P1-${hit.instrument}"/><voice>${mapping.voice}</voice><type>${
        typeFor(duration)
    }</type><stem>${mapping.stem}</stem>${notehead}</note>`;
}

function rest(voice: number, duration: number) {
    return `<note><rest/><duration>${duration}</duration><voice>${voice}</voice><type>${typeFor(duration)}</type></note>`;
}

function voiceNotes(hits: DrumHit[], voice: 1 | 2, slotCount: number) {
    const at = (hit: DrumHit) => Math.max(0, Math.min(measureDuration, Math.round(hit.slot * measureDuration / slotCount)));
    const groups = new Map<number, DrumHit[]>();
    for (const hit of hits.filter((hit) => hit.voice === voice)) {
        const position = at(hit);
        groups.set(position, [...(groups.get(position) ?? []), hit]);
    }
    let cursor = 0;
    let xml = "";
    const positions = [...groups.keys()].sort((a, b) => a - b);
    for (let index = 0; index < positions.length; index++) {
        const position = positions[index];
        if (position > cursor) xml += rest(voice, position - cursor);
        const duration = Math.max(1, (positions[index + 1] ?? measureDuration) - position);
        groups.get(position)!.forEach((hit, hitIndex) => xml += note(hit, duration, hitIndex > 0));
        cursor = Math.max(cursor, position + duration);
    }
    if (cursor < measureDuration) xml += rest(voice, measureDuration - cursor);
    return xml;
}

export function toMusicXml(tab: ParsedDrumTab): string {
    const used = new Set(tab.measures.flatMap((measure) => measure.hits.map((hit) => hit.instrument)));
    const instruments = [...used].map((instrument) => `<score-instrument id="P1-${instrument}"><instrument-name>${esc(instrument)}</instrument-name></score-instrument>`).join("");
    const tempo = tab.tempo ?? 120;
    const measures = tab.measures.map((measure, index) => {
        const attributes = index === 0
            ? `<attributes><divisions>${divisions}</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>percussion</sign><line>2</line></clef></attributes>`
            : "";
        const direction = index === 0
            ? `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${tempo}</per-minute></metronome></direction-type><sound tempo="${tempo}"/></direction>`
            : "";
        const voices = ([1, 2] as const).map((voice, voiceIndex) =>
            `${voiceIndex ? `<backup><duration>${measureDuration}</duration></backup>` : ""}${voiceNotes(measure.hits, voice, Math.max(1, measure.slotCount))}`
        ).join("");
        return `<measure number="${index + 1}">${attributes}${direction}${voices}</measure>`;
    }).join("");
    return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><work><work-title>${esc(tab.title ?? "Drum Tab")}</work-title></work><identification><creator type="composer">${
        esc(tab.artist ?? "")
    }</creator></identification><part-list><score-part id="P1"><part-name>Drums</part-name>${instruments}</score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
}
