export const exercises = [
    {
        id: "quarter-notes",
        title: "Quarter-note pulse",
        description: "Lock the bass drum to a steady quarter-note pulse.",
        tempo: 70,
        alphaTex:
            '\\title "Quarter-note pulse" \\track "Drums" \\instrument percussion \\clef neutral \\articulation defaults \\tempo 70 :4 KickHit KickHit KickHit KickHit | KickHit KickHit KickHit KickHit',
    },
    {
        id: "eighth-notes",
        title: "Eighth-note hi-hat",
        description: "Keep even eighth notes while the kick anchors beats one and three.",
        tempo: 80,
        alphaTex:
            '\\title "Eighth-note hi-hat" \\track "Drums" \\instrument percussion \\clef neutral \\articulation defaults \\tempo 80 :8 (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed | (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed',
    },
    {
        id: "sixteenth-notes",
        title: "Sixteenth-note control",
        description: "Build clean, relaxed control at a slower tempo before increasing speed.",
        tempo: 60,
        alphaTex:
            '\\title "Sixteenth-note control" \\track "Drums" \\instrument percussion \\clef neutral \\articulation defaults \\tempo 60 :16 (KickHit HiHatClosed) HiHatClosed HiHatClosed HiHatClosed (SnareHit HiHatClosed) HiHatClosed HiHatClosed HiHatClosed (KickHit HiHatClosed) HiHatClosed HiHatClosed HiHatClosed (SnareHit HiHatClosed) HiHatClosed HiHatClosed HiHatClosed',
    },
];
