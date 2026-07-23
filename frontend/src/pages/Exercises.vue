<script>
import { defineComponent } from "vue";
import { exercises } from "../exercises.js";

const alphaTab = await import("@coderline/alphatab");

export default defineComponent({
    data() {
        return { exercises, selected: exercises[0], api: null, playing: false, tempo: exercises[0].tempo, metronome: false, looping: true };
    },
    async mounted() {
        this.api = new alphaTab.AlphaTabApi(this.$refs.score, {
            core: { fontDirectory: "/font/", engine: "html5" },
            player: { enablePlayer: true, enableCursor: true, soundFont: "/soundfont/sonivox.sf2", playerMode: alphaTab.PlayerMode.EnabledSynthesizer },
            display: { staveProfile: alphaTab.StaveProfile.ScoreTab, scale: 1.1 },
        });
        this.api.playerStateChanged.on((event) => this.playing = event.state === alphaTab.synth.PlayerState.Playing);
        this.loadExercise();
    },
    beforeUnmount() {
        this.api?.destroy();
    },
    methods: {
        loadExercise() {
            this.playing = false;
            this.tempo = this.selected.tempo;
            this.api.tex(this.selected.alphaTex);
        },
        playPause() {
            if (this.playing) this.api.pause();
            else this.api.play();
        },
        updatePlayback() {
            this.api.playbackSpeed = this.tempo / this.selected.tempo;
            this.api.metronomeVolume = this.metronome ? 1 : 0;
            this.api.isLooping = this.looping;
        },
    },
    watch: {
        tempo: "updatePlayback",
        metronome: "updatePlayback",
        looping: "updatePlayback",
    },
});
</script>

<template>
    <main class="container exercises">
        <header>
            <p class="eyebrow">Practice library</p>
            <h1>Drum exercises</h1>
            <p>Built-in patterns, ready to practice without adding files to your library.</p>
        </header>
        <div class="exercise-grid">
            <button v-for="exercise in exercises" :key="exercise.id" class="exercise-card" :class="{ active: selected.id === exercise.id }" @click="selected = exercise; loadExercise()">
                <strong>{{ exercise.title }}</strong><span>{{ exercise.description }}</span><small>{{ exercise.tempo }} BPM</small>
            </button>
        </div>
        <section class="player">
            <div class="controls">
                <button class="btn btn-primary" @click="playPause">{{ playing ? "Pause" : "Play" }}</button>
                <label>Tempo <input v-model.number="tempo" type="number" min="30" max="240" /> BPM</label>
                <label><input v-model="metronome" type="checkbox" /> Metronome</label>
                <label><input v-model="looping" type="checkbox" /> Loop</label>
            </div>
            <div ref="score" class="score"></div>
        </section>
    </main>
</template>

<style scoped lang="scss">
.exercises {
    max-width: 1100px;
}
header {
    padding: 2rem 0 1rem;
}
.eyebrow {
    color: #d87d30;
    font-weight: 700;
    letter-spacing: .08em;
    text-transform: uppercase;
}
.exercise-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
}
.exercise-card {
    text-align: left;
    padding: 16px;
    border: 1px solid #555;
    background: transparent;
    color: inherit;
    border-radius: 8px;
}
.exercise-card.active {
    border-color: #d87d30;
    box-shadow: inset 0 0 0 1px #d87d30;
}
.exercise-card span,
.exercise-card small {
    display: block;
    margin-top: 8px;
}
.exercise-card small {
    opacity: .7;
}
.player {
    margin-top: 24px;
    border: 1px solid #555;
    border-radius: 8px;
    overflow: hidden;
}
.controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px;
    padding: 12px;
    background: rgba(128, 128, 128, .12);
}
.controls input[type="number"] {
    width: 70px;
}
.score {
    min-height: 260px;
    overflow-x: auto;
    padding: 16px;
}
</style>
