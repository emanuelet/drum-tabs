import { drumMappings } from "./drum_mapping.ts";
import { DrumHit, ParsedDrumTab } from "./drum_types.ts";

const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const typeFor = (slots: number) => slots >= 8 ? "half" : slots >= 4 ? "quarter" : slots >= 2 ? "eighth" : "16th";

function note(hit: DrumHit) {
    const mapping = [...Object.values(drumMappings)].find((item) => item.instrument === hit.instrument)!;
    const articulation = hit.articulation === "ghost"
        ? '<notehead parentheses="yes">normal</notehead>'
        : hit.articulation === "rim"
        ? "<notehead>slash</notehead>"
        : hit.notehead !== "normal"
        ? `<notehead>${hit.notehead}</notehead>`
        : "";
    return `<note><unpitched><display-step>${mapping.step}</display-step><display-octave>${mapping.octave}</display-octave></unpitched><instrument id="P1-${hit.instrument}"/><duration>${
        Math.max(1, hit.durationSlots)
    }</duration><voice>${mapping.voice}</voice><type>${typeFor(hit.durationSlots)}</type><stem>${mapping.stem}</stem>${articulation}</note>`;
}

export function toMusicXml(tab: ParsedDrumTab): string {
    const used = new Set(tab.measures.flatMap((measure) => measure.hits.map((hit) => hit.instrument)));
    const instruments = [...used].map((instrument) => `<score-instrument id="P1-${instrument}"><instrument-name>${esc(instrument)}</instrument-name></score-instrument>`).join("");
    const measures = tab.measures.map((measure, index) => {
        const notes = measure.hits.sort((a, b) => a.slot - b.slot || a.voice - b.voice).map(note).join("");
        const attributes = index === 0
            ? `<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>percussion</sign><line>2</line></clef></attributes>`
            : "";
        return `<measure number="${index + 1}">${attributes}${notes}</measure>`;
    }).join("");
    return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><work><work-title>${esc(tab.title ?? "Drum Tab")}</work-title></work><identification><creator type="composer">${
        esc(tab.artist ?? "")
    }</creator></identification><part-list><score-part id="P1"><part-name>Drums</part-name>${instruments}</score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
}
