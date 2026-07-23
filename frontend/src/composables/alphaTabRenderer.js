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
    let stringColors = {
        1: alphaTab.model.Color.fromJson("#bf3732"),
        2: alphaTab.model.Color.fromJson("#fff800"),
        3: alphaTab.model.Color.fromJson("#0080ff"),
        4: alphaTab.model.Color.fromJson("#e07b39"),
        5: alphaTab.model.Color.fromJson("#2A8E08"),
        6: alphaTab.model.Color.fromJson("#A349A4"),
    };
    if (setting.scoreColor === "light") stringColors[2] = alphaTab.model.Color.fromJson("#b5a33a");

    for (const track of score.tracks) {
        for (const staff of track.staves) {
            if (setting.noteColor === "louis-bass-v" && staff.stringTuning.tunings.length === 5) {
                stringColors = {
                    1: alphaTab.model.Color.fromJson("#b1da68"),
                    2: alphaTab.model.Color.fromJson("#bf3732"),
                    3: alphaTab.model.Color.fromJson("#fff800"),
                    4: alphaTab.model.Color.fromJson("#0080ff"),
                    5: alphaTab.model.Color.fromJson("#e07b39"),
                };
            }
            for (const bar of staff.bars) {
                for (const voice of bar.voices) {
                    for (const beat of voice.beats) {
                        if (beat.hasTuplet) {
                            beat.style = new alphaTab.model.BeatStyle();
                            const color = alphaTab.model.Color.fromJson("#00DD00");
                            beat.style.colors.set(alphaTab.model.BeatSubElement.StandardNotationTuplet, color);
                            beat.style.colors.set(alphaTab.model.BeatSubElement.StandardNotationBeams, color);
                        }
                        if (setting.noteColor !== "none") {
                            for (const note of beat.notes) {
                                note.style = new alphaTab.model.NoteStyle();
                                note.style.colors.set(alphaTab.model.NoteSubElement.GuitarTabFretNumber, stringColors[note.string]);
                            }
                        }
                    }
                }
            }
        }
    }
}
