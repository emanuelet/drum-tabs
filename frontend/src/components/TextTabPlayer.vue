<script>
import { defineComponent } from "vue";
import { baseURL } from "../app.js";

export default defineComponent({
    props: { id: { type: String, required: true } },
    data() {
        return { tab: {}, text: "", sources: [], source: "none", playing: false, duration: 180, fullscreen: false, scrollTimer: 0, manualUntil: 0, youtube: null, startedAt: 0 };
    },
    async mounted() {
        const metadata = await fetch(baseURL + `/api/tab/${this.id}`, { credentials: "include" }).then((res) => res.json());
        this.tab = metadata.tab;
        this.sources = [
            ...metadata.audioList.map((audio) => ({ value: `audio-${audio.filename}`, label: audio.filename, offset: audio.simpleSync || 0 })),
            ...metadata.youtubeList.map((youtube) => ({ value: `youtube-${youtube.videoID}`, label: `YouTube: ${youtube.videoID}`, offset: youtube.simpleSync || 0 })),
        ];
        const token = await fetch(baseURL + `/api/tab/${this.id}/temp-token`, { credentials: "include" }).then((res) => res.json());
        this.text = await fetch(baseURL + `/api/tab/${this.id}/file?tempToken=${token.token}`).then((res) => res.text());
        this.$refs.sheet.addEventListener("scroll", this.onManualScroll, { passive: true });
    },
    beforeUnmount() {
        clearInterval(this.scrollTimer);
        this.$refs.sheet?.removeEventListener("scroll", this.onManualScroll);
    },
    methods: {
        async togglePlay() {
            this.playing = !this.playing;
            if (this.playing && this.source === "none") this.startedAt = performance.now();
            if (this.source.startsWith("audio-")) {
                this.playing ? await this.$refs.audio.play() : this.$refs.audio.pause();
            } else if (this.source.startsWith("youtube-")) {
                await this.ensureYoutube();
                this.playing ? this.youtube.playVideo() : this.youtube.pauseVideo();
            }
            this.playing ? this.startScroll() : clearInterval(this.scrollTimer);
        },
        async selectSource() {
            this.playing = false;
            clearInterval(this.scrollTimer);
            if (this.source.startsWith("audio-")) this.$refs.audio.src = `${baseURL}/api/tab/${this.id}/audio/${encodeURIComponent(this.source.slice(6))}`;
            if (this.source.startsWith("youtube-")) await this.ensureYoutube();
        },
        async ensureYoutube() {
            if (this.youtube) {
                this.youtube.cueVideoById(this.source.slice(8));
                return;
            }
            if (!window.YT) {
                await new Promise((resolve) => {
                    window.onYouTubeIframeAPIReady = resolve;
                    const script = document.createElement("script");
                    script.src = "https://www.youtube.com/iframe_api";
                    document.head.appendChild(script);
                });
            }
            this.youtube = new window.YT.Player(this.$refs.youtube, {
                height: "180",
                width: "320",
                videoId: this.source.slice(8),
                events: {
                    onStateChange: (event) => {
                        if (event.data === window.YT.PlayerState.ENDED) {
                            this.playing = false;
                            clearInterval(this.scrollTimer);
                        }
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
                if (!this.playing || Date.now() < this.manualUntil) return;
                let time = this.source === "none" ? (performance.now() - this.startedAt) / 1000 : 0;
                let total = this.duration;
                if (this.source.startsWith("audio-")) {
                    time = this.$refs.audio.currentTime;
                    total = this.$refs.audio.duration || total;
                }
                if (this.source.startsWith("youtube-") && this.youtube) {
                    time = this.youtube.getCurrentTime();
                    total = this.youtube.getDuration() || total;
                }
                const offset = (this.sources.find((source) => source.value === this.source)?.offset || 0) / 1000;
                const progress = Math.min(1, Math.max(0, (time - offset) / Math.max(1, total - offset)));
                this.$refs.sheet.scrollTop = progress * (this.$refs.sheet.scrollHeight - this.$refs.sheet.clientHeight);
            }, 50);
        },
        async toggleFullscreen() {
            this.fullscreen = !this.fullscreen;
            if (this.fullscreen) await this.$el.requestFullscreen?.().catch(() => {});
            else if (document.fullscreenElement) await document.exitFullscreen?.();
        },
    },
});
</script>

<template>
    <section class="text-tab" :class="{ fullscreen }">
        <header><div><h1>{{ tab.title }}</h1><h2>{{ tab.artist }}</h2></div><button class="btn btn-secondary" @click="toggleFullscreen">{{ fullscreen ? "Exit" : "Focus" }}</button></header>
        <pre ref="sheet">{{ text }}</pre>
        <footer>
            <select class="form-select" v-model="source"
                @change="selectSource"><option value="none">Timer only</option><option v-for="item in sources" :key="item.value" :value="item.value">{{ item.label }}</option></select>
            <input v-if="source === 'none'" class="form-control" type="number" min="1" v-model.number="duration" aria-label="Duration in seconds" />
            <button class="btn btn-primary" @click="togglePlay">{{ playing ? "Pause" : "Play" }}</button>
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
footer .form-select {
    max-width: 280px;
}
footer .form-control {
    width: 90px;
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
