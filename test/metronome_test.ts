import { createMetronome } from "../frontend/src/metronome.ts";

Deno.test("metronome plays timing events only while enabled", () => {
    const accents: boolean[] = [];
    const metronome = createMetronome((accent) => accents.push(accent));
    const events = [
        { isMetronome: true, metronomeNumerator: 0 },
        { isMetronome: false },
        { isMetronome: true, metronomeNumerator: 1 },
    ];

    metronome.handleEvents(events);
    if (accents.length !== 0) {
        throw new Error("disabled metronome must stay silent");
    }

    metronome.setEnabled(true);
    metronome.handleEvents(events);
    if (accents.join(",") !== "true,false") {
        throw new Error("metronome must accent only the downbeat");
    }

    metronome.setEnabled(false);
    metronome.handleEvents(events);
    if (accents.join(",") !== "true,false") {
        throw new Error("disabling the metronome must stop later clicks");
    }
});

Deno.test("metronome audio failures do not interrupt later timing events", () => {
    let attempts = 0;
    const metronome = createMetronome(() => {
        attempts++;
        throw new Error("audio unavailable");
    });
    metronome.setEnabled(true);
    metronome.handleEvents([
        { isMetronome: true, metronomeNumerator: 0 },
        { isMetronome: true, metronomeNumerator: 1 },
    ]);

    if (attempts !== 2) {
        throw new Error(`expected both clicks to be attempted, got ${attempts}`);
    }
});
