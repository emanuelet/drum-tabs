<script>
import { defineComponent } from "vue";
import { baseURL } from "../app.js";

export default defineComponent({
    props: { id: { type: String, required: true } },
    data() {
        return {
            tab: {},
            text: "",
            sources: [],
            source: "none",
            playing: false,
            duration: 180,
            fullscreen: false,
            nativeFullscreen: false,
            scrollTimer: 0,
            manualUntil: 0,
            youtube: null,
            startedAt: 0,
            loadState: "loading", // loading | error | empty | ready
            loadError: "",
            playerError: "",
            unmounted: false,
        };
    },
    async mounted() {
        document.addEventListener("fullscreenchange", this.onFullscreenChange);
        await this.load();
    },
    beforeUnmount() {
        this.unmounted = true;
        clearInterval(this.scrollTimer);
        document.removeEventListener("fullscreenchange", this.onFullscreenChange);
        if (document.fullscreenElement === this.$el) document.exitFullscreen?.().catch(() => {});
        this.youtube?.destroy();
        this.youtube = null;
    },
    methods: {
        async fetchJson(url) {
            const res = await fetch(url, { credentials: "include" });
            if (!res.ok) throw new Error(`Request failed (${res.status})`);
            return res.json();
        },
        async load() {
            this.loadState = "loading";
            this.loadError = "";
            try {
                const metadata = await this.fetchJson(baseURL + `/api/tab/${this.id}`);
                const token = await this.fetchJson(baseURL + `/api/tab/${this.id}/temp-token`);
                const res = await fetch(baseURL + `/api/tab/${this.id}/file?tempToken=${token.token}`);
                if (!res.ok) throw new Error(`Could not download the tab file (${res.status})`);
                const text = await res.text();
                if (this.unmounted) return;

                this.tab = metadata.tab ?? {};
                this.sources = [
                    ...(metadata.audioList ?? []).map((audio) => ({ value: `audio-${audio.filename}`, label: audio.filename, offset: audio.simpleSync || 0 })),
                    ...(metadata.youtubeList ?? []).map((youtube) => ({ value: `youtube-${youtube.videoID}`, label: `YouTube: ${youtube.videoID}`, offset: youtube.simpleSync || 0 })),
                ];
                this.text = text;
                this.loadState = text.trim() ? "ready" : "empty";
            } catch (error) {
                if (this.unmounted) return;
                this.loadError = error?.message || "Unknown error";
                this.loadState = "error";
            }
        },
        async togglePlay() {
            const wasPlaying = this.playing;
            this.playing = !wasPlaying;
            this.playerError = "";
            if (this.playing && this.source === "none") this.startedAt = performance.now();
            try {
                if (this.source.startsWith("audio-")) {
                    const audio = this.$refs.audio;
                    if (!audio) return;
                    if (this.playing) await audio.play();
                    else audio.pause();
                } else if (this.source.startsWith("youtube-")) {
                    await this.ensureYoutube();
                    if (!this.youtube) return;
                    this.playing ? this.youtube.playVideo() : this.youtube.pauseVideo();
                }
            } catch (error) {
                this.playing = false;
                clearInterval(this.scrollTimer);
                this.playerError = "Could not play this audio source.";
                console.error(error);
                return;
            }
            this.playing ? this.startScroll() : clearInterval(this.scrollTimer);
        },
        async selectSource() {
            this.playing = false;
            this.playerError = "";
            clearInterval(this.scrollTimer);
            try {
                if (this.source.startsWith("audio-") && this.$refs.audio) this.$refs.audio.src = `${baseURL}/api/tab/${this.id}/audio/${encodeURIComponent(this.source.slice(6))}`;
                if (this.source.startsWith("youtube-")) await this.ensureYoutube();
            } catch (error) {
                this.playerError = "Could not load this audio source.";
                console.error(error);
            }
        },
        async ensureYoutube() {
            if (this.youtube) {
                this.youtube.cueVideoById(this.source.slice(8));
                return;
            }
            if (!window.YT) {
                await new Promise((resolve, reject) => {
                    window.onYouTubeIframeAPIReady = resolve;
                    const script = document.createElement("script");
                    script.src = "https://www.youtube.com/iframe_api";
                    script.onerror = () => reject(new Error("YouTube API failed to load"));
                    document.head.appendChild(script);
                });
            }
            if (this.unmounted || !this.$refs.youtube) return;
            this.youtube = new window.YT.Player(this.$refs.youtube, {
                height: "180",
                width: "320",
                videoId: this.source.slice(8),
                events: {
                    onStateChange: (event) => {
                        if (event.data === window.YT.PlayerState.PLAYING) {
                            this.playing = true;
                            this.startScroll();
                        } else if (event.data === window.YT.PlayerState.PAUSED || event.data === window.YT.PlayerState.ENDED) {
                            this.playing = false;
                            clearInterval(this.scrollTimer);
                        }
                    },
                    onError: () => {
                        this.playing = false;
                        clearInterval(this.scrollTimer);
                        this.playerError = "This YouTube video could not be played.";
                    },
                },
            });
        },
        onManualScroll() {
            this.manualUntil = Date.now() + 3000;
        },
        startScroll() {
            clearInterval(this.scrollTimer);
            this.scrollTimer = setInterval(() => {
                const sheet = this.$refs.sheet;
                if (!sheet || !this.playing || Date.now() < this.manualUntil) return;
                let time = this.source === "none" ? (performance.now() - this.startedAt) / 1000 : 0;
                let total = this.duration;
                if (this.source.startsWith("audio-") && this.$refs.audio) {
                    time = this.$refs.audio.currentTime;
                    total = this.$refs.audio.duration || total;
                }
                if (this.source.startsWith("youtube-") && this.youtube) {
                    time = this.youtube.getCurrentTime();
                    total = this.youtube.getDuration() || total;
                }
                const offset = (this.sources.find((source) => source.value === this.source)?.offset || 0) / 1000;
                const progress = Math.min(1, Math.max(0, (time - offset) / Math.max(1, total - offset)));
                sheet.scrollTop = progress * (sheet.scrollHeight - sheet.clientHeight);
            }, 50);
        },
        async toggleFullscreen() {
            this.fullscreen = !this.fullscreen;
            if (this.fullscreen) {
                // Falls back to the fixed-position layout when the Fullscreen API is unavailable (e.g. iOS Safari)
                try {
                    await this.$el.requestFullscreen?.();
                    this.nativeFullscreen = document.fullscreenElement === this.$el;
                } catch {
                    this.nativeFullscreen = false;
                }
            } else if (document.fullscreenElement) {
                await document.exitFullscreen?.().catch(() => {});
            }
        },
        onFullscreenChange() {
            // Keep state in sync when the user leaves fullscreen with Escape / browser UI
            if (this.nativeFullscreen && document.fullscreenElement !== this.$el) {
                this.nativeFullscreen = false;
                this.fullscreen = false;
            }
        },
    },
});
</script>

<template>
    <section class="text-tab" :class="{ fullscreen }" :aria-busy="loadState === 'loading'">
        <header>
            <div>
                <h1>{{ tab.title }}</h1>
                <h2>{{ tab.artist }}</h2>
            </div>
            <button class="btn btn-secondary" type="button" :aria-pressed="fullscreen" @click="toggleFullscreen">{{ fullscreen ? "Exit" : "Focus" }}</button>
        </header>
        <pre v-if="loadState === 'ready'" ref="sheet" tabindex="0" aria-label="Tab text" @scroll.passive="onManualScroll">{{ text }}</pre>
        <div v-else class="state" :role="loadState === 'error' ? 'alert' : 'status'">
            <template v-if="loadState === 'loading'">Loading tab...</template>
            <template v-else-if="loadState === 'empty'">
                <span>This tab file is empty.</span>
                <button class="btn btn-secondary" type="button" @click="load">Reload</button>
            </template>
            <template v-else>
                <strong>Could not load this tab.</strong>
                <span class="detail">{{ loadError }}</span>
                <button class="btn btn-primary" type="button" @click="load">Retry</button>
            </template>
        </div>
        <footer>
            <select class="form-select" v-model="source" aria-label="Playback source" :disabled="loadState !== 'ready'"
                @change="selectSource"><option value="none">Timer only</option><option v-for="item in sources" :key="item.value" :value="item.value">{{ item.label }}</option></select>
            <input v-if="source === 'none'" class="form-control" type="number" min="1" v-model.number="duration" aria-label="Duration in seconds" :disabled="loadState !== 'ready'" />
            <button class="btn btn-primary" type="button" :disabled="loadState !== 'ready'" @click="togglePlay">{{ playing ? "Pause" : "Play" }}</button>
            <span v-if="playerError" class="player-error" role="alert">{{ playerError }}</span>
            <audio ref="audio" @ended="playing = false" @pause="playing = false" hidden></audio>
            <div ref="youtube"></div>
        </footer>
    </section>
</template>

<style scoped lang="scss">
.text-tab {
    min-height: 100dvh;
    background: #101217;
    color: #eee;
    display: flex;
    flex-direction: column;
}
header,
footer {
    padding: 12px 16px;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
    background: #1b2029;
}
h1 {
    font-size: 1.25rem;
    margin: 0;
}
h2 {
    font-size: 1rem;
    color: #aaa;
    margin: 0;
}
pre {
    flex: 1;
    overflow: auto;
    margin: 0;
    padding: 24px 16px 96px;
    font: 16px/1.6 "Courier New", monospace;
    white-space: pre;
    -webkit-overflow-scrolling: touch;
}
footer {
    position: sticky;
    bottom: 0;
    justify-content: flex-start;
}
header .btn,
footer .btn,
footer .form-select,
footer .form-control {
    min-height: 44px;
}
footer .form-select {
    flex: 1 1 160px;
    max-width: 280px;
}
footer .form-control {
    width: 90px;
}
.state {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 32px 16px;
    text-align: center;
}
.detail {
    max-width: 60ch;
    overflow-wrap: anywhere;
    color: #aaa;
}
.player-error {
    color: #ffb4a8;
}
.fullscreen {
    position: fixed;
    inset: 0;
    z-index: 2000;
}
@media (min-width: 768px) {
    pre {
        font-size: 18px;
        padding: 32px 48px 104px;
    }
}
</style>
