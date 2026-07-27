<script>
import { defineComponent } from "vue";
import { baseURL, getSetting } from "../app.js";
import { notify } from "@kyvg/vue3-notification";

const alphaTab = await import("@coderline/alphatab");

export default defineComponent({
    data() {
        return {
            exercises: [],
            selected: null,
            api: null,
            playing: false,
            tempo: 120,
            metronome: false,
            looping: true,
            setting: getSetting(),
            searchQuery: "",
            alphaTex: "",
            saving: false,
            ready: false,
        };
    },
    computed: {
        favoriteExercises() {
            return this.exercises.filter((exercise) => exercise.fav);
        },
        filteredExercises() {
            const query = this.searchQuery.trim().toLowerCase();
            if (!query) return this.exercises;
            return this.exercises.filter((exercise) => [exercise.title, exercise.subtitle, exercise.alphaTex].some((value) => value.toLowerCase().includes(query)));
        },
    },
    async mounted() {
        let resources = { tablatureFont: "bold 14px Arial", barNumberColor: "#6D6D6D" };
        if (this.setting.scoreColor === "dark") {
            resources = { ...resources, staffLineColor: "#6D6D6D", barSeparatorColor: "#6D6D6D", mainGlyphColor: "#A4A4A4", secondaryGlyphColor: "#A4A4A4", scoreInfoColor: "#A3A3A3" };
        }
        this.api = new alphaTab.AlphaTabApi(this.$refs.score, {
            core: { fontDirectory: "/font/", engine: "html5" },
            player: { enablePlayer: true, enableCursor: true, soundFont: "/soundfont/sonivox.sf2", playerMode: alphaTab.PlayerMode.EnabledSynthesizer },
            notation: { elements: { scoreTitle: false, scoreSubTitle: false, scoreArtist: false } },
            display: { staveProfile: alphaTab.StaveProfile.ScoreTab, scale: this.setting.scale, resources },
        });
        this.api.playerStateChanged.on((event) => this.playing = event.state === alphaTab.synth.PlayerState.Playing);
        try {
            const res = await fetch(baseURL + "/api/exercises", { credentials: "include" });
            const data = await res.json();
            if (!res.ok) throw new Error(data.msg || "Failed to load exercises");
            this.exercises = data.exercises;
            this.selected = this.exercises[0] || null;
            this.loadExercise();
            this.ready = true;
        } catch (error) {
            notify({ text: error.message || "Failed to load exercises", type: "error" });
        }
    },
    beforeUnmount() {
        this.api?.destroy();
    },
    methods: {
        loadExercise() {
            if (!this.selected || !this.api) return;
            this.playing = false;
            this.tempo = this.selected.tempo;
            this.api.tex(this.selected.alphaTex);
        },
        selectExercise(exercise) {
            this.selected = exercise;
            this.loadExercise();
        },
        playPause() {
            if (!this.api || !this.selected) return;
            if (this.playing) this.api.pause();
            else this.api.play();
        },
        updatePlayback() {
            if (!this.api || !this.selected) return;
            this.api.playbackSpeed = this.tempo / this.selected.tempo;
            this.api.metronomeVolume = this.metronome ? 1 : 0;
            this.api.isLooping = this.looping;
        },
        async saveExercise() {
            if (!this.alphaTex.trim()) {
                notify({ text: "Paste AlphaTex before saving", type: "error" });
                return;
            }
            this.saving = true;
            try {
                const res = await fetch(baseURL + "/api/exercises", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ alphaTex: this.alphaTex }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.msg || "Failed to save exercise");
                this.exercises = [...this.exercises, data.exercise];
                this.alphaTex = "";
                this.selectExercise(data.exercise);
                this.$refs.addDialog.close();
                notify({ text: "Exercise saved", type: "success" });
            } catch (error) {
                notify({ text: error.message || "Failed to save exercise", type: "error" });
            } finally {
                this.saving = false;
            }
        },
        openAddDialog() {
            this.$refs.addDialog.showModal();
        },
        closeAddDialog() {
            this.$refs.addDialog.close();
        },
        async toggleFav(exercise) {
            try {
                const res = await fetch(baseURL + `/api/exercises/${exercise.id}/fav`, {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ fav: !exercise.fav }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.msg || "Failed to update favorite");
                this.exercises = this.exercises.map((item) => item.id === exercise.id ? data.exercise : item);
            } catch (error) {
                notify({ text: error.message || "Failed to update favorite", type: "error" });
            }
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
            <p>Practice patterns stored separately from your tab library.</p>
        </header>
        <section class="player" :class="{ light: setting.scoreColor === 'light' }">
            <div class="controls">
                <button class="btn btn-primary" :disabled="!selected" @click="playPause">{{ playing ? "Pause" : "Play" }}</button>
                <label>Tempo <input v-model.number="tempo" :disabled="!selected" type="number" min="30" max="240" /> BPM</label>
                <label><input v-model="metronome" type="checkbox" /> Metronome</label>
                <label><input v-model="looping" type="checkbox" /> Loop</label>
            </div>
            <h2 class="score-title">{{ selected?.title || "Loading exercise..." }}</h2>
            <div ref="score" class="score" :class="{ light: setting.scoreColor === 'light' }"></div>
        </section>
        <section v-if="ready" class="favorites">
            <div class="preset-heading">
                <h2>Favorites</h2>
            </div>
            <div class="exercise-grid">
                <article v-for="exercise in favoriteExercises" :key="exercise.id" class="exercise-card" :class="{ active: selected.id === exercise.id }">
                    <button class="exercise-select" @click="selectExercise(exercise)">
                        <strong>{{ exercise.title }}</strong><span v-if="exercise.subtitle">{{ exercise.subtitle }}</span><small>{{ exercise.tempo }} BPM</small>
                    </button>
                    <button class="btn btn-sm btn-outline-warning" type="button" @click="toggleFav(exercise)">Unfavorite</button>
                </article>
            </div>
            <p v-if="favoriteExercises.length === 0" class="text-muted mt-3">Favorite exercises to keep them here.</p>
        </section>
        <section v-if="ready" class="all-exercises">
            <div class="preset-heading">
                <h2>All exercises</h2>
                <div class="exercise-actions">
                    <div class="input-group search">
                        <span class="input-group-text"><font-awesome-icon icon="magnifying-glass" /></span>
                        <input v-model="searchQuery" class="form-control" type="search" placeholder="Search exercises" aria-label="Search exercises" />
                        <button v-if="searchQuery" class="btn btn-outline-secondary" type="button" @click="searchQuery = ''">Clear</button>
                    </div>
                    <button class="btn btn-primary" type="button" @click="openAddDialog">Add exercise</button>
                </div>
            </div>
            <div class="exercise-list">
                <article v-for="exercise in filteredExercises" :key="exercise.id" class="exercise-row" :class="{ active: selected.id === exercise.id }">
                    <button class="exercise-select" @click="selectExercise(exercise)">
                        <strong>{{ exercise.title }}</strong><span v-if="exercise.subtitle">{{ exercise.subtitle }}</span><small>{{ exercise.tempo }} BPM</small>
                    </button>
                    <button class="btn btn-sm" :class="exercise.fav ? 'btn-outline-warning' : 'btn-outline-secondary'" type="button" @click="toggleFav(exercise)">{{ exercise.fav ? "Unfavorite" : "Favorite" }}</button>
                </article>
            </div>
            <p v-if="filteredExercises.length === 0" class="text-muted mt-3">No exercises match "{{ searchQuery }}".</p>
        </section>
        <dialog ref="addDialog" class="add-dialog">
            <form @submit.prevent="saveExercise">
                <div class="dialog-heading"><h2>Add exercise</h2><button class="btn-close" type="button" aria-label="Close" @click="closeAddDialog"></button></div>
                <p class="text-muted">Paste AlphaTex containing at least <code>\title</code> and <code>\tempo</code>. The subtitle is optional.</p>
                <textarea v-model="alphaTex" class="form-control" rows="14" placeholder="Paste AlphaTex here"></textarea>
                <div class="dialog-actions"><button class="btn btn-outline-secondary" type="button" @click="closeAddDialog">Cancel</button><button class="btn btn-primary" type="submit" :disabled="saving">{{ saving ? "Saving..." : "Save exercise" }}</button></div>
            </form>
        </dialog>
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
.favorites,
.all-exercises {
    margin-top: 24px;
}
.preset-heading {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
}
.preset-heading h2,
.import-exercise h2 {
    margin: 0;
    font-size: 1.4rem;
}
.search {
    max-width: 360px;
}
.exercise-actions {
    display: flex;
    gap: 8px;
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
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
}
.exercise-select {
    border: 0;
    padding: 0;
    width: 100%;
    color: inherit;
    background: transparent;
    text-align: left;
}
.exercise-list {
    border: 1px solid #555;
    border-radius: 8px;
    overflow: hidden;
}
.exercise-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid #555;
}
.exercise-row:last-child {
    border-bottom: 0;
}
.exercise-row.active {
    box-shadow: inset 3px 0 0 #d87d30;
}
.exercise-row .exercise-select {
    flex: 1;
}
.exercise-row span,
.exercise-row small {
    display: inline;
    margin-left: 8px;
    opacity: .7;
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

    &.light {
        background: #f1f1f1;
    }
}
.score-title {
    margin: 0;
    padding: 18px 16px 0;
    font-size: 1.25rem;

    .player.light & {
        color: #333;
    }
}
.add-dialog {
    width: min(720px, calc(100vw - 32px));
    color: inherit;
    background: var(--bs-body-bg);
    border: 1px solid #555;
    border-radius: 8px;
    padding: 20px;
}
.add-dialog::backdrop {
    background: rgba(0, 0, 0, .65);
}
.dialog-heading,
.dialog-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}
.dialog-heading h2 {
    margin: 0;
    font-size: 1.4rem;
}
.dialog-actions {
    justify-content: flex-end;
    margin-top: 16px;
}
@media (max-width: 575px) {
    .search {
        max-width: none;
        flex: 1;
    }
    .exercise-actions {
        width: 100%;
    }
}
</style>
