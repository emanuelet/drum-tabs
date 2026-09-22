export function getStaveProfile(scoreStyle, StaveProfile) {
    if (scoreStyle === "tab" || scoreStyle === "horizontal-tab") return StaveProfile.Tab;
    if (scoreStyle === "score") return StaveProfile.Score;
    if (scoreStyle === "score-tab") return StaveProfile.ScoreTab;
    return StaveProfile.Default;
}

export function overrideHiddenStaves(score, scoreStyle) {
    for (const track of score.tracks) {
        for (const staff of track.staves) {
            staff.showTablature = scoreStyle === "tab" || scoreStyle === "horizontal-tab" || scoreStyle === "score-tab";
            staff.showStandardNotation = scoreStyle === "score" || scoreStyle === "score-tab";
        }
    }
}

export function applyScoreColors(score, setting, alphaTab) {
    const stringColors = {
        1: alphaTab.model.Color.fromJson("#bf3732"),
        2: alphaTab.model.Color.fromJson("#fff800"),
        3: alphaTab.model.Color.fromJson("#0080ff"),
        4: alphaTab.model.Color.fromJson("#e07b39"),
        5: alphaTab.model.Color.fromJson("#2A8E08"),
        6: alphaTab.model.Color.fromJson("#A349A4"),
    };
    if (setting.scoreColor === "light") stringColors[2] = alphaTab.model.Color.fromJson("#b5a33a");
    let bassColors;
    let tupletColor;

    for (const track of score.tracks) {
        for (const staff of track.staves) {
            const usesBassColors = setting.noteColor === "louis-bass-v" && staff.stringTuning.tunings.length === 5;
            if (usesBassColors && !bassColors) {
                bassColors = {
                    1: alphaTab.model.Color.fromJson("#b1da68"),
                    2: alphaTab.model.Color.fromJson("#bf3732"),
                    3: alphaTab.model.Color.fromJson("#fff800"),
                    4: alphaTab.model.Color.fromJson("#0080ff"),
                    5: alphaTab.model.Color.fromJson("#e07b39"),
                };
            }
            const colors = usesBassColors ? bassColors : stringColors;
            for (const bar of staff.bars) {
                for (const voice of bar.voices) {
                    for (const beat of voice.beats) {
                        if (beat.hasTuplet) {
                            tupletColor ??= alphaTab.model.Color.fromJson("#00DD00");
                            beat.style = new alphaTab.model.BeatStyle();
                            beat.style.colors.set(alphaTab.model.BeatSubElement.StandardNotationTuplet, tupletColor);
                            beat.style.colors.set(alphaTab.model.BeatSubElement.StandardNotationBeams, tupletColor);
                        }
                        if (setting.noteColor !== "none") {
                            for (const note of beat.notes) {
                                note.style = new alphaTab.model.NoteStyle();
                                note.style.colors.set(alphaTab.model.NoteSubElement.GuitarTabFretNumber, colors[note.string]);
                            }
                        }
                    }
                }
            }
        }
    }
}
