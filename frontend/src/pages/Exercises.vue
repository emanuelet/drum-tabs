<script>
import { defineComponent } from "vue";
import { baseURL, getSetting } from "../app.js";
import { notify } from "@kyvg/vue3-notification";
import AssignButton from "../components/AssignButton.vue";
import { confirmAction } from "../confirm.ts";
import { fetchMe } from "../me.ts";

const alphaTab = await import("@coderline/alphatab");

function splitExerciseTracks(alphaTex, title) {
    const lines = alphaTex.split("\n");
    const marker = /^\s*%\s*---\s*(.*?)\s*---\s*$/;
    const lineComment = /^\s*\/\/\s*(.*?)\s*$/;
    const header = [];
    const tracks = [];
    let current;

    for (const line of lines) {
        const match = line.match(marker);
        if (match) {
            current = { title: match[1], lines: [] };
            tracks.push(current);
        } else if (lineComment.test(line)) {
            const comment = line.match(lineComment)[1];
            const startsTrack = /^(Pattern|Variation|Exercise)\s+\d+:/i.test(comment);
            if (startsTrack) {
                current = { title: comment, lines: [] };
                tracks.push(current);
            } else if (current) {
                current.lines.push(line);
            } else {
                header.push(line);
            }
        } else if (current) {
            current.lines.push(line);
        } else {
            header.push(line);
        }
    }

    if (tracks.length === 0) return [{ title, alphaTex }];
    return tracks.map((track) => ({ title: track.title, alphaTex: [...header, ...track.lines].join("\n") }));
}

export default defineComponent({
    components: { AssignButton },
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
            editingExercise: null,
            alphaTexAnalysis: null,
            selectedTrackIndex: 0,
            saving: false,
            ready: false,
            loading: true,
            loadError: "",
            addOpener: null,
            assignmentsByExercise: {},
            user: null,
            fullscreen: false,
        };
    },
    computed: {
        favoriteExercises() {
            return this.exercises.filter((exercise) => exercise.fav);
        },
        exerciseTracks() {
            if (!this.selected) return [];
            return splitExerciseTracks(this.selected.alphaTex, this.selected.title);
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
            display: { staveProfile: alphaTab.StaveProfile.ScoreTab, scale: this.setting.scale, resources, padding: [10, 35] },
        });
        this.api.playerStateChanged.on((event) => this.playing = event.state === alphaTab.synth.PlayerState.Playing);
        document.addEventListener("fullscreenchange", this.updateFullscreenState);
        await this.loadData();
    },
    beforeUnmount() {
        document.removeEventListener("fullscreenchange", this.updateFullscreenState);
        this.api?.destroy();
    },
    methods: {
        async loadData() {
            this.loading = true;
            this.loadError = "";
            try {
                const [exerciseRes, assignmentRes, user] = await Promise.all([
                    fetch(baseURL + "/api/exercises", { credentials: "include" }),
                    fetch(baseURL + "/api/assignments", { credentials: "include" }),
                    fetchMe(),
                ]);
                const data = await exerciseRes.json();
                const assignmentData = await assignmentRes.json();
                if (!exerciseRes.ok) throw new Error(data.msg || "Failed to load exercises");
                if (!assignmentRes.ok) throw new Error(assignmentData.msg || "Failed to load assignments");
                this.exercises = data.exercises;
                this.assignmentsByExercise = Object.fromEntries(
                    assignmentData.assignments.filter((assignment) => assignment.resourceType === "exercise").map((assignment) => [assignment.resourceId, assignment]),
                );
                this.user = user;
                this.selected = this.exercises[0] || null;
                this.loadExercise();
                this.ready = true;
            } catch (error) {
                this.loadError = error.message || "Failed to load exercises";
            } finally {
                this.loading = false;
            }
        },
        loadExercise() {
            if (!this.selected || !this.api) return;
            this.tempo = this.selected.tempo;
            this.loadSelectedTrack();
        },
        loadSelectedTrack() {
            if (!this.selected || !this.api) return;
            this.playing = false;
            const isSectionedExercise = this.exerciseTracks.length > 1;
            this.api.settings.display.barsPerRow = isSectionedExercise ? 2 : -1;
            this.api.settings.display.stretchForce = isSectionedExercise ? 1.35 : 1;
            this.api.updateSettings();
            this.api.tex(this.exerciseTracks[this.selectedTrackIndex].alphaTex);
        },
        selectExercise(exercise) {
            this.selected = exercise;
            this.selectedTrackIndex = 0;
            this.loadExercise();
        },
        playPause() {
            if (!this.api || !this.selected) return;
            if (this.playing) this.api.pause();
            else this.api.play();
        },
        async toggleFullscreen() {
            if (document.fullscreenElement === this.$refs.player) {
                await document.exitFullscreen();
            } else {
                await this.$refs.player.requestFullscreen();
            }
        },
        updateFullscreenState() {
            this.fullscreen = document.fullscreenElement === this.$refs.player;
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
                const url = this.editingExercise ? `/api/exercises/${this.editingExercise.id}` : "/api/exercises";
                const res = await fetch(baseURL + url, {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ alphaTex: this.alphaTex }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.msg || "Failed to save exercise");
                this.exercises = this.editingExercise ? this.exercises.map((exercise) => exercise.id === data.exercise.id ? data.exercise : exercise) : [...this.exercises, data.exercise];
                this.alphaTex = "";
                this.editingExercise = null;
                this.alphaTexAnalysis = null;
                this.selectExercise(data.exercise);
                this.closeAddDialog();
                notify({ text: "Exercise saved", type: "success" });
            } catch (error) {
                notify({ text: error.message || "Failed to save exercise", type: "error" });
            } finally {
                this.saving = false;
            }
        },
        async importGuitarPro(event) {
            const file = event.target.files?.[0];
            if (!file) return;

            try {
                const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(
                    new Uint8Array(await file.arrayBuffer()),
                    new alphaTab.Settings(),
                );
                const alphaTex = new alphaTab.exporter.AlphaTexExporter().exportToString(score);
                const parser = new alphaTab.importer.alphaTex.AlphaTexParser(alphaTex);
                parser.read();
                this.alphaTex = alphaTex;
                this.analyzeAlphaTex();
                notify({ text: `Imported ${score.title || file.name}`, type: "success" });
            } catch (error) {
                notify({ text: error.message || "Unable to import Guitar Pro file", type: "error" });
            } finally {
                event.target.value = "";
            }
        },
        openAddDialog(event) {
            this.addOpener = event?.currentTarget || null;
            this.editingExercise = null;
            this.alphaTex = "";
            this.alphaTexAnalysis = null;
            this.$refs.addDialog.showModal();
        },
        openEditDialog(exercise, event) {
            this.addOpener = event?.currentTarget || null;
            this.editingExercise = exercise;
            this.alphaTex = exercise.alphaTex;
            this.$refs.addDialog.showModal();
            this.analyzeAlphaTex();
        },
        closeAddDialog() {
            this.$refs.addDialog.close();
        },
        onAddDialogClosed() {
            if (this.addOpener && document.contains(this.addOpener)) this.addOpener.focus();
            this.addOpener = null;
        },
        analyzeAlphaTex() {
            if (!this.alphaTex.trim()) {
                this.alphaTexAnalysis = null;
                return;
            }
            try {
                const parser = new alphaTab.importer.alphaTex.AlphaTexParser(this.alphaTex);
                parser.read();
                const diagnostics = [
                    ...(parser.lexerDiagnostics?.items || parser.lexerDiagnostics || []),
                    ...(parser.parserDiagnostics?.items || parser.parserDiagnostics || []),
                ];
                const errorSeverity = alphaTab.importer.alphaTex.AlphaTexDiagnosticsSeverity.Error;
                const errors = diagnostics.filter((diagnostic) => diagnostic.severity === errorSeverity);
                this.alphaTexAnalysis = {
                    valid: errors.length === 0,
                    diagnostics: errors.map((diagnostic) => diagnostic.message),
                    title: this.alphaTex.match(/^\\title\s+"([^"\r\n]+)"/m)?.[1] || "Untitled",
                    subtitle: this.alphaTex.match(/^\\subtitle\s+"([^"\r\n]+)"/m)?.[1] || "",
                    tempo: this.alphaTex.match(/^\\tempo\s+(\d+)/m)?.[1] || "Not set",
                };
            } catch (error) {
                this.alphaTexAnalysis = { valid: false, diagnostics: [error.message || "Unable to parse AlphaTex"] };
            }
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
        async deleteExercise(exercise) {
            const ok = await confirmAction({
                title: "Delete exercise?",
                message: `Delete "${exercise.title}"? This cannot be undone.`,
                confirmText: "Delete",
            });
            if (!ok) return;
            try {
                const res = await fetch(baseURL + `/api/exercises/${exercise.id}`, {
                    method: "DELETE",
                    credentials: "include",
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.msg || "Failed to delete exercise");
                this.exercises = this.exercises.filter((item) => item.id !== exercise.id);
                if (this.selected?.id === exercise.id) this.selectExercise(this.exercises[0] || null);
                notify({ text: "Exercise deleted", type: "success" });
            } catch (error) {
                notify({ text: error.message || "Failed to delete exercise", type: "error" });
            }
        },
    },
    watch: {
        tempo: "updatePlayback",
        metronome: "updatePlayback",
        looping: "updatePlayback",
        selectedTrackIndex: "loadSelectedTrack",
    },
});
</script>

<template>
    <div class="container exercises">
        <header>
            <p class="eyebrow">Practice library</p>
            <h1>Drum exercises</h1>
            <p>Practice patterns stored separately from your tab library.</p>
        </header>
        <div v-if="loading" class="state-block" role="status">
            <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Loading exercises...
        </div>
        <div v-else-if="loadError" class="state-block" role="alert">
            <p class="mb-3">{{ loadError }}</p>
            <button class="btn btn-outline-primary" type="button" @click="loadData">Retry</button>
        </div>
        <div class="exercise-layout">
            <div class="exercise-library">
                <section v-if="ready && favoriteExercises.length" class="favorites">
                    <div class="preset-heading">
                        <h2>Favorites</h2>
                    </div>
                    <div class="exercise-grid">
                        <article v-for="exercise in favoriteExercises" :key="exercise.id" class="exercise-card" :class="{ active: selected?.id === exercise.id }">
                            <button class="exercise-select"
                                @click="selectExercise(exercise)"><strong>{{ exercise.title }}</strong><small>{{ exercise.tempo }} BPM</small><em v-if="user?.role === 'learner' && assignmentsByExercise[exercise.id]">From {{ assignmentsByExercise[exercise.id].teacherName }}</em></button>
                            <button class="fav-star active" type="button" :title="`Remove ${exercise.title} from favorites`" :aria-label="`Remove ${exercise.title} from favorites`" aria-pressed="true"
                                @click="toggleFav(exercise)"><font-awesome-icon icon="star" /></button>
                        </article>
                    </div>
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
                            <button class="btn btn-primary touch-target" type="button" @click="openAddDialog">Add</button>
                        </div>
                    </div>
                    <div class="exercise-list">
                        <article v-for="exercise in filteredExercises" :key="exercise.id" class="exercise-row" :class="{ active: selected?.id === exercise.id }">
                            <button class="exercise-select" @click="selectExercise(exercise)">
                                <strong>{{ exercise.title }}</strong><span v-if="exercise.subtitle">{{ exercise.subtitle }}</span><small>{{ exercise.tempo }} BPM</small><em v-if="user?.role === 'learner' && assignmentsByExercise[exercise.id]">From {{ assignmentsByExercise[exercise.id].teacherName }}</em>
                            </button>
                            <button class="fav-star" :class="{ active: exercise.fav }" type="button"
                                :title="exercise.fav ? `Remove ${exercise.title} from favorites` : `Add ${exercise.title} to favorites`"
                                :aria-label="exercise.fav ? `Remove ${exercise.title} from favorites` : `Add ${exercise.title} to favorites`" :aria-pressed="!!exercise.fav"
                                @click="toggleFav(exercise)"><font-awesome-icon :icon="exercise.fav ? 'star' : ['far', 'star']" /></button>
                            <AssignButton v-if="user?.role === 'teacher'" resource-type="exercise" :resource-id="exercise.id" :resource-title="exercise.title" />
                            <button class="btn btn-sm btn-outline-secondary icon-btn" type="button" :title="`Edit ${exercise.title}`" :aria-label="`Edit ${exercise.title}`"
                                @click="openEditDialog(exercise, $event)"><font-awesome-icon icon="pen" /></button>
                            <button class="btn btn-sm btn-outline-danger icon-btn" type="button" :title="`Delete ${exercise.title}`" :aria-label="`Delete ${exercise.title}`"
                                @click="deleteExercise(exercise)"><font-awesome-icon icon="trash-can" /></button>
                        </article>
                    </div>
                    <p v-if="exercises.length === 0" class="text-dt-muted mt-3">No exercises yet. Use Add to paste AlphaTex or import a Guitar Pro file.</p>
                    <p v-else-if="filteredExercises.length === 0" class="text-dt-muted mt-3">No exercises match "{{ searchQuery }}".</p>
                </section>
            </div>
            <section ref="player" class="player" :class="{ light: setting.scoreColor === 'light' }">
                <button class="btn btn-outline-secondary fullscreen-button" type="button" :title="fullscreen ? 'Exit full screen' : 'Full screen'"
                    :aria-label="fullscreen ? 'Exit full screen' : 'Full screen'" @click="toggleFullscreen"><font-awesome-icon :icon="fullscreen ? 'compress' : 'expand'" /></button>
                <div class="controls">
                    <button class="btn play-button" :class="playing ? 'btn-success' : 'btn-primary'" type="button" :disabled="!selected" @click="playPause">
                        <font-awesome-icon :icon="playing ? 'pause' : 'play'" />
                        {{ playing ? "Pause" : "Play" }}
                    </button>
                    <div class="tempo-control">
                        <label for="tempo-range">Tempo</label>
                        <input id="tempo-range" v-model.number="tempo" :disabled="!selected" type="range" min="30" max="240" aria-label="Tempo slider" />
                        <input id="tempo-number" v-model.number="tempo" class="form-control form-control-sm" :disabled="!selected" type="number" min="30" max="240" step="1"
                            aria-label="Tempo in BPM" />
                        <span class="bpm-unit" aria-hidden="true">BPM</span>
                    </div>
                    <div class="toggle-chips">
                        <button class="chip" :class="{ active: metronome }" type="button" :aria-pressed="metronome" @click="metronome = !metronome">
                            <font-awesome-icon :icon="metronome ? 'check' : 'stopwatch'" /> Metronome
                        </button>
                        <button class="chip" :class="{ active: looping }" type="button" :aria-pressed="looping" @click="looping = !looping">
                            <font-awesome-icon :icon="looping ? 'check' : 'repeat'" /> Loop
                        </button>
                    </div>
                    <label v-if="exerciseTracks.length > 1"
                        class="track-control">Exercise <select v-model.number="selectedTrackIndex" class="form-select form-select-sm"><option v-for="(track, index) in exerciseTracks" :key="track.title" :value="index">{{ track.title }}</option></select></label>
                </div>
                <header class="score-header">
                    <h2 class="score-title">{{ selected?.title || (ready ? "No exercise selected" : "Loading exercise...") }}</h2>
                    <p v-if="ready && !selected" class="text-dt-muted mb-0">Add an exercise to start practising.</p>
                    <p v-if="selected?.subtitle" class="score-subtitle">{{ selected.subtitle }}</p>
                </header>
                <div ref="score" class="score" :class="{ light: setting.scoreColor === 'light', empty: !selected }"></div>
            </section>
        </div>
        <dialog ref="addDialog" class="dt-dialog add-dialog" style="--dt-dialog-width: 720px" aria-labelledby="exercise-dialog-title" @close="onAddDialogClosed">
            <form @submit.prevent="saveExercise">
                <div class="dt-dialog-heading">
                    <h2 id="exercise-dialog-title">{{ editingExercise ? "Edit exercise" : "Add exercise" }}</h2>
                    <button class="btn-close" type="button" aria-label="Close" @click="closeAddDialog"></button>
                </div>
                <p class="text-dt-muted">Paste AlphaTex containing at least <code>\title</code> and <code>\tempo</code>, or import a Guitar Pro file. The subtitle is optional.</p>
                <label
                    class="btn btn-outline-secondary import-guitar-pro">Import Guitar Pro<input type="file" class="visually-hidden" accept=".gp,.gpx,.gp3,.gp4,.gp5" @change="importGuitarPro" /></label>
                <label for="alphaTexInput" class="form-label">AlphaTex</label>
                <textarea id="alphaTexInput" v-model="alphaTex" class="form-control" rows="14" placeholder="Paste AlphaTex here" @input="analyzeAlphaTex"></textarea>
                <div v-if="alphaTexAnalysis" class="alphatex-analysis" :class="alphaTexAnalysis.valid ? 'valid' : 'invalid'">
                    <strong>{{ alphaTexAnalysis.valid ? "Syntax valid" : "Syntax invalid" }}</strong>
                    <span
                        v-if="alphaTexAnalysis.valid">{{ alphaTexAnalysis.title }}<template v-if="alphaTexAnalysis.subtitle"> - {{ alphaTexAnalysis.subtitle }}</template> · {{ alphaTexAnalysis.tempo }} BPM</span>
                    <ul v-else>
                        <li v-for="diagnostic in alphaTexAnalysis.diagnostics" :key="diagnostic">{{ diagnostic }}</li>
                    </ul>
                </div>
                <div class="dt-dialog-actions">
                    <button class="btn btn-outline-secondary" type="button" @click="closeAddDialog">Cancel</button>
                    <button class="btn btn-success" type="submit" :disabled="saving">{{ saving ? "Saving..." : "Save exercise" }}</button>
                </div>
            </form>
        </dialog>
    </div>
</template>

<style scoped lang="scss">
.exercises {
    max-width: 1440px;
}
header {
    padding: 2rem 0 1rem;
}
.favorites,
.all-exercises {
    margin-bottom: 24px;
}
.exercise-layout {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
    gap: 24px;
    align-items: start;
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
.exercise-select {
    border: 0;
    padding: 0;
    min-height: 44px;
    width: 100%;
    color: inherit;
    background: transparent;
    text-align: left;
}
.exercise-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
}
.exercise-card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    color: inherit;
    background: transparent;
    border: 1px solid var(--dt-divider);
    border-radius: 8px;
}
.exercise-card.active {
    border-color: var(--dt-accent);
    box-shadow: inset 0 0 0 1px var(--dt-accent);
}
.exercise-card span,
.exercise-card small {
    display: block;
    margin-top: 8px;
}
.exercise-card small {
    opacity: .7;
}
.exercise-list {
    border: 1px solid var(--dt-divider);
    border-radius: 8px;
    overflow: hidden;
}
.exercise-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--dt-divider);
}
.exercise-row:last-child {
    border-bottom: 0;
}
.exercise-row.active {
    box-shadow: inset 3px 0 0 var(--dt-accent);
}
.exercise-row .exercise-select {
    flex: 1 1 160px;
    min-width: 0;
}
.exercise-row span,
.exercise-row small {
    display: block;
    margin-top: 4px;
    margin-left: 0;
    opacity: .7;
}
.exercise-row em {
    color: var(--dt-accent);
    font-style: normal;
    font-weight: 700;
}
.exercise-card .fav-star {
    align-self: flex-start;
}
.exercise-row .fav-star {
    align-self: center;
}
.player {
    position: relative;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--dt-divider);
    border-radius: 8px;
    overflow: hidden;
}
.player:fullscreen {
    width: 100%;
    height: 100%;
    border: 0;
    border-radius: 0;
    background: var(--bs-body-bg);
}
.player:fullscreen .score {
    flex: 1;
    overflow: auto;
}
.fullscreen-button {
    position: absolute;
    z-index: 1;
    top: 8px;
    right: 8px;
}
.controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 20px;
    padding: 14px 64px 14px 16px;
    background: rgba(128, 128, 128, .12);
    border-bottom: 1px solid var(--dt-divider);
}
.play-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-width: 104px;
    min-height: 44px;
    font-weight: 600;
}
.bpm-unit {
    font-size: .85rem;
    color: var(--dt-muted, #9aa5ae);
}
.tempo-control label {
    margin: 0;
    font-size: .85rem;
    font-weight: 600;
    letter-spacing: .02em;
    text-transform: uppercase;
    color: var(--dt-muted, #9aa5ae);
}
.toggle-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}
.chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 40px;
    padding: 0 14px;
    color: inherit;
    font-size: .9rem;
    background: transparent;
    border: 1px solid var(--dt-divider);
    border-radius: 999px;
    transition: background-color .15s, border-color .15s;

    &:hover {
        background: rgba(128, 128, 128, .18);
    }

    &.active {
        color: #fff;
        background: var(--bs-primary);
        border-color: var(--bs-primary);
    }
}
.controls input[type="number"] {
    width: 70px;
}
.tempo-control {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    min-width: 0;
}
.tempo-control input[type="range"] {
    width: min(220px, 42vw);
    min-width: 0;
    accent-color: var(--bs-primary);
}
.controls .tempo-control input[type="number"] {
    width: 76px;
}
.track-control {
    display: flex;
    align-items: center;
    gap: 8px;
}
.score.empty {
    visibility: hidden;
}
.score {
    min-height: 260px;
    overflow-x: auto;
    padding: 12px 20px 20px;

    &.light {
        background: #f1f1f1;
    }
}
.score-header {
    padding: 18px 20px 0;
}
.score-subtitle {
    margin: 4px 0 0;
    color: var(--dt-muted, #9aa5ae);

    .player.light & {
        color: #555;
    }
}
.score-title {
    margin: 0;
    font-size: 1.35rem;
    font-weight: 600;

    .player.light & {
        color: #333;
    }
}
.add-dialog textarea {
    font-family: var(--bs-font-monospace);
}
.alphatex-analysis {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
    padding: 10px 12px;
    border-radius: 4px;
}
.import-guitar-pro {
    display: inline-flex;
    margin-bottom: 12px;
}
.import-guitar-pro:focus-within {
    outline: 2px solid var(--dt-focus);
    outline-offset: 2px;
}
.alphatex-analysis.valid {
    color: #9dd37c;
    background: rgba(58, 120, 44, .2);
}
.alphatex-analysis.invalid {
    color: #f1a1a1;
    background: rgba(130, 45, 45, .2);
}
.alphatex-analysis ul {
    width: 100%;
    margin: 0;
    padding-left: 20px;
}
@media (max-width: 991px) {
    .exercise-layout {
        grid-template-columns: 1fr;
    }
}
@media (max-width: 575px) {
    .tempo-control {
        flex: 1 1 100%;
    }
    .tempo-control input[type="range"] {
        flex: 1 1 120px;
    }
    .search {
        max-width: none;
        flex: 1;
    }
    .exercise-actions {
        width: 100%;
    }
}
</style>
