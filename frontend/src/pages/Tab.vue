<script>
import { ActionBuffer, baseURL, checkFetch, convertAlphaTexSyncPoint, generalError, getInstrumentName, getSetting, releaseWakeLock, requestWakeLock } from "../app.js";
import { defineComponent } from "vue";
import { BDropdown, BDropdownDivider, BDropdownItem } from "bootstrap-vue-next";
import { notify } from "@kyvg/vue3-notification";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import { isLoggedIn } from "../auth-client.js";
import { getKeySignature } from "../util.ts";
import TextTabPlayer from "../components/TextTabPlayer.vue";
import { applyScoreColors, getStaveProfile, overrideHiddenStaves } from "../composables/alphaTabRenderer.js";
import { countIn } from "../count-in.ts";
import { metronome } from "../metronome.ts";

const alphaTab = await import("@coderline/alphatab");
const { ScrollMode, StaveProfile } = alphaTab;

const speedActionBuffer = new ActionBuffer(1000);
const syncOffsetYoutubeActionBuffer = new ActionBuffer(200);
const syncOffsetAudioActionBuffer = new ActionBuffer(200);
const externalPositionSyncMs = 100;

export default defineComponent({
    components: { FontAwesomeIcon, BDropdownDivider, BDropdownItem, BDropdown, TextTabPlayer },
    emits: ["setFixedHeader"],
    data() {
        return {
            api: null,
            audioHandler: null,
            alphaTabYoutubeHandler: null,
            youtubePlayer: null,
            youtubeSyncTimer: undefined,
            isLoggedIn: false,
            youtubeSyncPointMarkers: [],
            selectedYoutubeSyncBarIndex: null,
            title: "",
            artist: "",
            youtube: {},
            tabID: -1,
            tracks: [],
            showTrackList: false,
            showAudioList: false,
            tab: {},
            playing: false,
            enableCountIn: false,
            enableMetronome: false,
            enableBackingTrack: true,
            isLooping: false,
            speed: 100,
            speedMarks: [25, 50, 75, 100, 125, 150, 175],
            tempo: 120,
            tabScale: 1,
            showSpeedSelector: false,
            ready: false,
            selectedTrack: 0,
            soloTrackID: -1,
            muteTrackList: {},
            masterVolume: 100,
            trackVolumeList: {},
            allowVolumeBoost: false,
            currentAudio: "synth",
            youtubeList: [],
            audioList: [],
            audio: {},
            scrollMode: ScrollMode.Continuous,
            keySignature: "",
            playbackRange: null,
            savedPlaybackRange: null,
            playbackRangeRestoreTimer: undefined,
            isInitializingAudio: false,
            isCountingIn: false,
            seekDownBeat: null,
            isYoutubeSyncEditing: false,
            youtubeSyncBarIndex: 1,
            youtubeSyncOffsetSeconds: 0,

            keyEvents: (e) => {
                if (e.key === "Escape") {
                    this.closeOverlays(true);
                    return;
                }

                if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) {
                    return;
                }

                // Never hijack keys from form controls, sliders or editable content (e.g. Space in a sync input).
                const target = e.target instanceof Element ? e.target : null;
                if (target?.closest('input, select, textarea, [role="slider"], [contenteditable=""], [contenteditable="true"]')) {
                    return;
                }
                // Focused buttons/links keep their native Space/Enter activation; other shortcuts still work.
                if (target?.closest("button, a[href]") && (e.code === "Space" || e.code === "Enter")) {
                    return;
                }

                if (e.code === "Space") {
                    e.preventDefault();
                    this.playPause();
                } else if (e.code === "ArrowLeft") {
                    e.preventDefault();
                    this.moveToBar(-1);
                } else if (e.code === "ArrowRight") {
                    e.preventDefault();
                    this.moveToBar(1);
                } else if (e.code === "ArrowUp") {
                    e.preventDefault();
                    const result = this.playFromHighlightedRange();

                    // Also act as the key S if not highlighted
                    if (!result) {
                        this.playFromFirstBarContainingNotes(-2);
                    }
                } else if (e.code === "KeyS") {
                    e.preventDefault();
                    this.playFromFirstBarContainingNotes(-2);
                }
            },
            setting: {},
            simpleSyncSecond: -1,
            toolbarAutoHide: false,
            isTextTab: false,
            showDrumNotation: false,
            showSecondaryControls: false,
            isYoutubeVideoMinimized: false,
            toolbarRevealed: false,
            loadState: "loading",
            loadError: "",
        };
    },
    computed: {
        animatedCursor() {
            return this.setting.cursor === "animated" || this.setting.scrollMode === ScrollMode.Smooth;
        },

        syncMethod() {
            if (this.currentAudio.startsWith("youtube-")) {
                return this.youtube.syncMethod;
            } else if (this.currentAudio.startsWith("audio-")) {
                return this.audio.syncMethod;
            } else {
                return undefined;
            }
        },

        bpm() {
            return Math.round(this.tempo * this.speed) / 100;
        },

        formattedBpm() {
            return this.bpm.toFixed(2);
        },

        isYoutubeAudio() {
            return this.currentAudio.startsWith("youtube-");
        },

        audioIcon() {
            if (this.currentAudio === "none") return "volume-xmark";
            if (this.currentAudio === "backingTrack" || this.currentAudio.startsWith("audio-")) return "headphones";
            return "volume-high";
        },

        audioSelectionLabel() {
            if (this.currentAudio === "synth") return "Synth";
            if (this.currentAudio === "none") return "Mute";
            if (this.currentAudio === "backingTrack") return "Backing Track";
            if (this.currentAudio.startsWith("youtube-")) return "YouTube";
            if (this.currentAudio.startsWith("audio-")) return "Audio";
            return "Audio";
        },

        youtubeSyncActionLabel() {
            return this.selectedYoutubeSyncBarIndex === null ? "Add" : "Update";
        },

        trackControlsUnavailable() {
            return this.currentAudio.startsWith("youtube-");
        },

        youtubeSyncPoints() {
            return convertAlphaTexSyncPoint(this.youtube?.advancedSync ?? "")
                .map((point) => ({
                    ...point,
                    offsetSeconds: point.millisecondOffset / 1000,
                }))
                .sort((a, b) => a.barIndex - b.barIndex || a.barOccurence - b.barOccurence);
        },

        youtubeSuggestedSyncBars() {
            const barCount = this.api?.score?.masterBars?.length ?? 0;
            const anchoredBars = new Set(this.youtubeSyncPoints.map((point) => point.barIndex));
            const suggestedBars = [];

            for (let barIndex = 16; barIndex < barCount - 1; barIndex += 16) {
                if (!anchoredBars.has(barIndex)) {
                    suggestedBars.push(barIndex);
                }
            }

            return suggestedBars;
        },

        youtubeSyncEndWarning() {
            const barCount = this.api?.score?.masterBars?.length ?? 0;
            if (!barCount) {
                return null;
            }

            const lastAnchor = this.youtubeSyncPoints.at(-1)?.barIndex ?? -1;
            const finalBar = barCount - 1;
            if (finalBar - lastAnchor <= 8) {
                return null;
            }

            return `Last anchor is bar ${lastAnchor + 1}. Add one near final bar ${finalBar + 1} to prevent end-of-song drift.`;
        },

        youtubeSyncDriftPreview() {
            const expectedOffsetSeconds = this.getExpectedYoutubeOffsetSeconds(this.youtubeSyncBarIndex - 1);
            if (expectedOffsetSeconds === null) {
                return null;
            }

            const currentOffsetSeconds = this.getYoutubeSyncOffsetSeconds();
            return {
                expectedOffsetSeconds,
                currentOffsetSeconds,
                driftSeconds: currentOffsetSeconds - expectedOffsetSeconds,
            };
        },
    },

    watch: {
        simpleSyncSecond(newVal, oldVal) {
            if (!this.api) {
                return;
            }

            if (this.isInitializingAudio) {
                return;
            }

            let obj;

            if (this.currentAudio.startsWith("youtube-")) {
                if (!this.youtube) {
                    return;
                }
                obj = this.youtube;
            } else if (this.currentAudio.startsWith("audio-")) {
                if (!this.audio) {
                    return;
                }
                obj = this.audio;
            }

            this.pause();

            obj.simpleSync = this.simpleSyncSecond * 1000;

            // Bug? If change to EnabledExternalMedia, andthis.api.updateSettings(), this sync point can not be applied correctly.
            // So it must change to EnabledSynthesizer first, then change to EnabledExternalMedia
            this.api.settings.player.playerMode = alphaTab.PlayerMode.EnabledSynthesizer;
            this.api.updateSettings();

            this.simpleSync(obj.simpleSync);

            // Restore
            this.api.settings.player.playerMode = alphaTab.PlayerMode.EnabledExternalMedia;
            this.api.updateSettings();

            // Save
            if (this.currentAudio.startsWith("youtube-")) {
                this.api.player.output.handler = this.alphaTabYoutubeHandler;
                syncOffsetYoutubeActionBuffer.run(() => {
                    if (oldVal !== -1) {
                        this.saveYoutube();
                    }
                });
            } else {
                this.api.player.output.handler = this.audioHandler;
                syncOffsetAudioActionBuffer.run(() => {
                    if (oldVal !== -1) {
                        this.saveAudio();
                    }
                });
            }
        },

        "youtube.simpleSync"() {
            if (!this.api || !this.youtube) {
                return;
            }
            this.simpleSyncSecond = parseFloat((this.youtube.simpleSync / 1000).toFixed(2));
        },

        "audio.simpleSync"() {
            if (!this.api || !this.audio) {
                return;
            }
            this.simpleSyncSecond = parseFloat((this.audio.simpleSync / 1000).toFixed(2));
        },

        playing() {
            if (!this.api) {
                return;
            }

            if (this.playing) {
                this.api.settings.player.scrollMode = this.scrollMode;
                this.api.updateSettings();
                if (this.enableCountIn && this.needsCustomCountIn()) {
                    this.startExternalCountIn();
                } else {
                    this.api.play();
                }
                requestWakeLock();
            } else {
                countIn.cancel();
                this.isCountingIn = false;
                this.api.pause();
                releaseWakeLock();
            }

            // Hide the cursor when playing
            if (this.setting.cursor === "invisible" || this.setting.cursor === "bar") {
                const cursor = document.querySelector(".at-cursor-beat");
                if (cursor) {
                    if (this.playing) {
                        console.log("Hide cursor");
                        cursor.classList.add("invisible");
                    } else {
                        console.log("Show cursor");
                        cursor.classList.remove("invisible");
                    }
                }
            }
        },

        enableCountIn() {
            if (!this.api) {
                return;
            }
            if (this.enableCountIn) {
                this.api.countInVolume = 1;
            } else {
                this.api.countInVolume = 0;
            }
            this.setConfig("enableCountIn", this.enableCountIn);
        },

        enableMetronome() {
            if (!this.api) {
                return;
            }
            this.applyMetronome();
            this.setConfig("enableMetronome", this.enableMetronome);
        },

        isLooping() {
            if (!this.api) {
                return;
            }
            this.api.isLooping = this.isLooping;
            this.setConfig("isLooping", this.isLooping);
        },

        speed(newVal) {
            if (!this.api) {
                return;
            }
            console.log("Speed changed to:", newVal);

            let speed = newVal;

            if (typeof speed !== "number" || isNaN(speed)) {
                speed = 100;
            } else if (speed < 20) {
                speed = 20;
            } else if (speed > 1000) {
                speed = 1000;
            }

            // Rate limit the speed change action
            speedActionBuffer.run(() => {
                this.api.playbackSpeed = speed / 100;
                this.setConfig("speed", speed);
            });
        },

        // Switch Audio Source
        async currentAudio() {
            console.log("Switching audio to:", this.currentAudio);

            if (!this.api) {
                return;
            }

            this.api.player.masterVolume = 1;
            this.applyCountInVolume();
            this.applyMetronome();

            if (!this.currentAudio.startsWith("youtube-")) {
                // AlphaTab pauses its current backing-track handler while updateSettings
                // replaces it. Keep the YouTube iframe alive until that teardown completes.
                this.stopYoutubeSync();
                this.isYoutubeSyncEditing = false;
                this.youtubeSyncPointMarkers = [];
                this.selectedYoutubeSyncBarIndex = null;
            }

            const range = this.api.playbackRange;
            if (range) {
                this.savedPlaybackRange = { startTick: range.startTick, endTick: range.endTick };
            }

            if (this.currentAudio === "synth") {
                await this.initSynth();
            } else if (this.currentAudio === "backingTrack") {
                this.api.settings.player.playerMode = alphaTab.PlayerMode.EnabledBackingTrack;
                this.api.updateSettings();
                this.pause();
            } else if (this.currentAudio.startsWith("youtube-")) {
                const videoID = this.currentAudio.substring(8);
                try {
                    await this.initYoutube(videoID);
                } catch (e) {
                    console.error("YouTube load failed:", e);
                    this.isInitializingAudio = false;
                    this.destroyYoutubePlayer();
                    notify({
                        type: "error",
                        title: "YouTube",
                        text: "Could not load the YouTube video, falling back to synth.",
                    });
                    this.currentAudio = "synth";
                    return;
                }
            } else if (this.currentAudio.startsWith("audio-")) {
                const filename = this.currentAudio.substring(6);
                await this.initAudio(filename);
            } else if (this.currentAudio === "none") {
                // Workaround: alphaTab.PlayerMode.Disabled is not working, so just mute the volume
                this.api.player.masterVolume = 0;
                this.pause();
            } else {
                // Unknown audio source, fallback to synth
                await this.initSynth();
                this.destroyYoutubePlayer();
                notify({
                    type: "error",
                    title: "Error",
                    text: "Unknown audio source, fallback to synth.",
                });
                return;
            }

            if (!this.currentAudio.startsWith("youtube-")) {
                this.destroyYoutubePlayer();
            }
            this.setConfig("audio", this.currentAudio);
        },
    },

    // Mounted
    async mounted() {
        this.isLoggedIn = await isLoggedIn();
        this.setting = getSetting();
        this.tabID = this.$route.params.id;
        this.tabScale = this.getConfig("scale", this.setting.scale);

        window.addEventListener("keydown", this.keyEvents);

        // Close open lists/popovers when clicking outside
        this._onDocumentClick = (e) => {
            try {
                const outside = (ref) => {
                    const el = this.$refs[ref];
                    return !el || !el.contains(e.target);
                };

                if (this.showTrackList && outside("trackSelector") && outside("trackList")) {
                    this.showTrackList = false;
                }
                if (this.showAudioList && outside("audioSelector") && outside("audioList")) {
                    this.showAudioList = false;
                }
                if (this.showSpeedSelector && outside("speedSelector")) {
                    this.showSpeedSelector = false;
                }
                if (this.showDrumNotation && outside("drumNotation")) {
                    this.showDrumNotation = false;
                }
                if (this.showSecondaryControls && outside("secondaryControls") && outside("secondaryToggle")) {
                    this.showSecondaryControls = false;
                }
                if (this.toolbarRevealed && outside("toolbar")) {
                    this.toolbarRevealed = false;
                }
            } catch (err) {
                console.error(err);
            }
        };
        window.addEventListener("click", this._onDocumentClick);

        await this.initTab();
    },
    beforeUnmount() {
        console.log("Before unmount");
        this.destroyContainer();
        window.removeEventListener("keydown", this.keyEvents);

        if (this._onDocumentClick) {
            window.removeEventListener("click", this._onDocumentClick);
            this._onDocumentClick = undefined;
        }
    },
    methods: {
        async initTab() {
            this.loadState = "loading";
            this.loadError = "";
            const urlParams = new URLSearchParams(window.location.search);

            try {
                const response = await fetch(baseURL + `/api/tab/${this.tabID}`, { credentials: "include" });
                try {
                    await checkFetch(response);
                } catch (e) {
                    if (e.message === "Not logged in") {
                        this.$router.push("/login");
                        return;
                    }
                    throw e;
                }
                const metadata = await response.json();
                if (metadata.tab?.filename?.toLowerCase().endsWith(".txt")) {
                    this.isTextTab = true;
                    return;
                }

                // Override trackID if provided in URL
                const trackParam = urlParams.get("track");
                if (trackParam) {
                    const id = parseInt(trackParam);
                    if (!isNaN(id)) {
                        this.setConfig("trackID", id);
                    }
                }

                // Override audio source if provided in URL
                const audioParam = urlParams.get("audio");
                if (audioParam) {
                    this.setConfig("audio", audioParam);
                }

                const trackID = this.getConfig("trackID", 0);

                // Load the AlphaTab
                await this.load(trackID, metadata);
                this.loadState = "ready";
            } catch (e) {
                this.loadState = "error";
                this.loadError = e?.message || "Unknown error";
                notify({
                    type: "error",
                    title: "Error",
                    text: this.loadError,
                });
            }
        },

        /**
         * Close open popovers/lists. Returns true if something was open.
         * @param {boolean} restoreFocus Move focus back to the trigger when focus was inside the closed element.
         */
        closeOverlays(restoreFocus = false) {
            const items = [
                ["showTrackList", ["trackList"], "trackSelector"],
                ["showAudioList", ["audioList"], "audioSelector"],
                ["showSpeedSelector", ["speedSelector"], "speedSelector"],
                ["showDrumNotation", ["drumNotation"], "drumNotation"],
                ["showSecondaryControls", ["secondaryControls"], "secondaryToggle"],
                ["toolbarRevealed", [], null],
            ];
            let closed = false;
            for (const [flag, containers, trigger] of items) {
                if (!this[flag]) continue;
                if (flag === "toolbarRevealed" && closed) continue;
                const hadFocus = containers.some((ref) => this.$refs[ref]?.contains(document.activeElement));
                this[flag] = false;
                closed = true;
                if (flag === "toolbarRevealed" && this.$refs.toolbar?.contains(document.activeElement)) {
                    // Otherwise :focus-visible would keep the auto-hide toolbar open
                    document.activeElement.blur();
                }
                if (restoreFocus && hadFocus && trigger) {
                    const el = this.$refs[trigger];
                    (el?.matches?.("button") ? el : el?.querySelector("button"))?.focus();
                }
            }
            return closed;
        },

        adjustBpm(amount) {
            this.setBpm(this.bpm + amount);
        },

        adjustTabScale(amount) {
            this.setTabScale(this.tabScale + amount);
        },

        setTabScale(value) {
            const scale = Math.round(Number(value) * 10) / 10;
            if (!Number.isFinite(scale)) return;
            this.tabScale = Math.max(0.5, Math.min(3, scale));
            if (this.api) {
                this.api.settings.display.scale = this.tabScale;
                this.api.updateSettings();
                const track = this.api.score?.tracks[this.selectedTrack];
                if (track) this.api.renderTracks([track]);
            }
            this.setConfig("scale", this.tabScale);
        },

        setBpm(value) {
            const bpm = Math.round(Number(value) * 100) / 100;
            if (!Number.isFinite(bpm) || this.tempo <= 0) return;
            const nextBpm = Math.max(this.tempo * 0.2, Math.min(this.tempo * 2, bpm));
            this.speed = nextBpm / this.tempo * 100;
        },

        speedMarkPosition(mark) {
            return `${(mark - 20) / 180 * 100}%`;
        },

        async load(trackID, metadata) {
            if (this.api) {
                this.destroyContainer();
            }

            let data = metadata;
            if (!data) {
                const res = await fetch(baseURL + `/api/tab/${this.tabID}`, {
                    credentials: "include",
                });

                try {
                    await checkFetch(res);
                } catch (e) {
                    if (e.message === "Not logged in") {
                        this.$router.push("/login");
                        return;
                    } else {
                        throw e;
                    }
                }

                data = await res.json();
            }
            if (data.tab) {
                this.tab = data.tab;
                this.youtubeList = data.youtubeList;
                this.audioList = data.audioList;
            }

            const tempToken = await this.getTempToken();

            // Requested trackID may be invalid, so we need to get the actual trackID used
            trackID = await this.initContainer(tempToken, trackID);

            this.setConfig("trackID", trackID);
        },

        countIn() {
            this.enableCountIn = !this.enableCountIn;
            this.applyCountInVolume();
        },

        metronome() {
            this.enableMetronome = !this.enableMetronome;
        },

        loop() {
            this.isLooping = !this.isLooping;
        },

        playPause() {
            if (!this.api || !this.ready) {
                return;
            }

            this.playing = !this.playing;
        },

        play() {
            if (!this.api || !this.ready) {
                return;
            }
            this.playing = true;
        },

        startPlayback() {
            if (this.playing && this.enableCountIn) {
                this.api.pause();
                if (this.needsCustomCountIn()) {
                    this.startExternalCountIn();
                } else {
                    this.api.play();
                }
                return;
            }
            this.play();
        },

        pause() {
            if (!this.api || !this.ready) {
                return;
            }
            this.playing = false;
        },

        /**
         * Play from the beginning of highlighted range
         * Do nothing if no bar is highlighted
         */
        playFromHighlightedRange() {
            if (!this.api || !this.ready) {
                return;
            }

            const playbackRange = this.api.playbackRange;
            if (!playbackRange) {
                return false;
            }

            this.api.tickPosition = playbackRange.startTick;
            this.startPlayback();
            return true;
        },

        /**
         * Play from the first bar containing notes in the current track
         * If offset is provided, play from the first bar containing notes after the offset bar
         */
        playFromFirstBarContainingNotes(offset = 0) {
            if (!this.api || !this.ready) {
                return;
            }

            // Find the first bar containing notes in the current track
            const track = this.api.score.tracks[this.selectedTrack];

            let targetBar = null;

            // Check the first staff only
            for (let i = 0; i < track.staves[0].bars.length; i++) {
                const bar = track.staves[0].bars[i];

                // See if bar contains any notes by scanning voices -> beats -> notes
                let hasNotes = false;
                if (bar && bar.voices) {
                    for (const voice of bar.voices) {
                        if (!voice || !voice.beats) continue;
                        for (const beat of voice.beats) {
                            if (beat && beat.notes && beat.notes.length > 0) {
                                hasNotes = true;
                                break;
                            }
                        }
                        if (hasNotes) break;
                    }
                }

                // Apply offset
                if (hasNotes) {
                    const bars = track.staves[0].bars;
                    // clamp target index between 0 and last bar index
                    const targetIndex = Math.max(0, Math.min(i + offset, bars.length - 1));
                    targetBar = bars[targetIndex];
                    break;
                }
            }

            if (targetBar) {
                const firstBeat = targetBar.voices[0].beats[0];
                this.api.tickPosition = firstBeat.absoluteDisplayStart;
            }

            this.startPlayback();
        },

        getFileURL(tempToken) {
            return baseURL + `/api/tab/${this.tabID}/file?tempToken=${tempToken}`;
        },

        async getTempToken() {
            const fileURL = baseURL + `/api/tab/${this.tabID}/temp-token`;

            // fetch the file as array buffer
            const response = await fetch(fileURL, {
                credentials: "include",
            });

            if (!response.ok) {
                throw new Error("Failed to get get temp token");
            }
            return (await response.json()).token;
        },

        /**
         * @param tempToken
         * @param trackID
         * @returns {Promise<number>} The actual trackID used
         */
        initContainer(tempToken, trackID) {
            return new Promise((resolve, reject) => {
                if (this.api) {
                    this.destroyContainer();
                }

                if (!(this.$refs.bassTabContainer instanceof HTMLElement)) {
                    reject(new Error("Container element not found"));
                    return;
                }

                trackID = Number.isInteger(trackID) && trackID >= 0 ? trackID : 0;

                let displayResources = {
                    tablatureFont: "bold 14px Arial",
                    barNumberColor: "#6D6D6D",
                };

                if (this.setting.scoreColor === "dark") {
                    displayResources = {
                        ...displayResources,
                        staffLineColor: "#6D6D6D",
                        barSeparatorColor: "#6D6D6D",
                        mainGlyphColor: "#A4A4A4",
                        secondaryGlyphColor: "#A4A4A4",
                        scoreInfoColor: "#A3A3A3",
                        barNumberColor: "#6D6D6D",
                    };
                }

                let layoutMode = undefined;

                if (this.setting.scoreStyle === "horizontal-tab") {
                    layoutMode = alphaTab.LayoutMode.Horizontal;
                    this.$emit("setFixedHeader", true);
                }

                this.api = new alphaTab.AlphaTabApi(this.$refs.bassTabContainer, {
                    notation: {
                        rhythmMode: alphaTab.TabRhythmMode.ShowWithBars,
                        //rhythmHeight: 30,
                        elements: {
                            scoreTitle: false,
                            scoreSubTitle: false,
                            scoreArtist: false,
                            scoreAlbum: false,
                            scoreWords: false,
                            scoreMusic: false,
                            scoreWordsAndMusic: false,
                            scoreCopyright: false,
                        },
                    },
                    core: {
                        file: this.getFileURL(tempToken),
                        // Deno's Vite dev server does not provide a MIME type for alphaTab's module worker.
                        useWorkers: !import.meta.env.DEV,
                        tracks: [trackID],
                        fontDirectory: "/font/",
                        engine: "html5",
                    },
                    player: {
                        enablePlayer: true,

                        // Always enable, so we can navigate to any position
                        enableCursor: true,
                        enableAnimatedBeatCursor: this.animatedCursor,
                        enableUserInteraction: true,
                        soundFont: "/soundfont/sonivox.sf2",
                        // Avoid initial scroll jump in scroll mode, which make it unable to see the title
                        scrollMode: ScrollMode.Off,
                        scrollOffsetY: -50,
                        playerMode: alphaTab.PlayerMode.EnabledSynthesizer,
                    },
                    display: {
                        staveProfile: getStaveProfile(this.setting.scoreStyle, StaveProfile),
                        resources: displayResources,
                        layoutMode,
                        scale: this.tabScale,
                        // [left-right, top-bottom]; alphaTab default is [35, 35]
                        padding: [10, 35],
                    },
                });

                // Exposing api to window for debugging
                window.api = this.api;

                // MIDI metronome events survive loop restarts; alphaTab's native
                // Web Audio click can become silent while playback continues.
                this.api.midiEventsPlayedFilter = [alphaTab.midi.MidiEventType.AlphaTabMetronome];
                this.api.midiEventsPlayed.on((args) => metronome.handleEvents(args.events));

                // Surface load/render failures instead of waiting forever
                this.api.error.on((error) => {
                    console.error("alphaTab error:", error);
                    reject(new Error(error?.message ? `Could not load the tab file: ${error.message}` : "Could not load the tab file."));
                });

                // Used for showing/hiding the "Restart" button
                this.api.playbackRangeChanged.on(() => {
                    this.playbackRange = this.api.playbackRange;
                });

                this.api.playerReady.on(() => {
                    this.applyTrackVolumes();
                    this.restorePlaybackRange();
                });

                this.api.beatMouseDown.on((beat) => {
                    this.seekDownBeat = this.getBeatKey(beat);
                    this.selectYoutubeSyncBar(beat);
                });
                this.api.beatMouseUp.on((beat) => {
                    const downBeat = this.seekDownBeat;
                    this.seekDownBeat = null;
                    if (downBeat && downBeat === this.getBeatKey(beat) && this.playing && this.enableCountIn) {
                        this.startPlayback();
                    }
                });
                this.api.renderFinished.on(() => this.updateYoutubeSyncPointMarkers());

                // iOS 16.4+: Enable audio playback even when silent switch is ON
                if ("audioSession" in navigator) {
                    try {
                        navigator.audioSession.type = "playback";
                    } catch (error) {
                        console.error("Failed to set navigator.audioSession.type to 'playback':", error);
                    }
                }

                // Score Loaded
                this.api.scoreLoaded.on(async (score) => {
                    applyScoreColors(score, this.setting, alphaTab);

                    // Track
                    if (trackID < 0 || trackID >= score.tracks.length) {
                        trackID = 0;
                    }

                    // Always show tempo automation on the master bar
                    if (this.api.score.masterBars.length > 0 && this.api.score.masterBars[0].tempoAutomations.length > 0) {
                        this.api.score.masterBars[0].tempoAutomations[0].isVisible = true;
                    }

                    // Get key signature
                    const firstBar = this.api.score.tracks[trackID].staves[0].bars[0];
                    this.keySignature = getKeySignature(firstBar);

                    // Set Audio source
                    this.currentAudio = this.getConfig("audio", "synth");

                    // Metronome
                    this.enableMetronome = this.getConfig("enableMetronome", false);

                    // Count in
                    this.enableCountIn = this.getConfig("enableCountIn", false);
                    this.applyCountInVolume();

                    // Looping
                    this.isLooping = this.getConfig("isLooping", false);

                    // Speed
                    this.tempo = score.masterBars[0]?.tempoAutomations[0]?.value ?? 120;
                    this.speed = 100;
                    this.speed = this.getConfig("speed", 100);
                    this.allowVolumeBoost = this.getConfig("allowVolumeBoost", false);

                    // Scroll Mode
                    // Force Smooth from horizontal tab
                    if (this.setting.scoreStyle === "horizontal-tab") {
                        this.scrollMode = ScrollMode.Smooth;
                    } else {
                        this.scrollMode = this.setting.scrollMode;
                    }

                    this.tracks = [];

                    // List all tracks
                    score.tracks.forEach((track) => {
                        const name = (track.name ?? "").trim() || (track.shortName ?? "").trim() || getInstrumentName(track.playbackInfo.program);
                        this.tracks.push({
                            id: track.index,
                            name,
                            program: track.playbackInfo.program,
                        });
                    });
                    this.initializeTrackVolumes(score.tracks);
                    this.applyTrackVolumes();

                    this.selectedTrack = trackID;

                    // Force score+tab if the current track program = 0 (probably drums)
                    if (this.isDrum()) {
                        this.api.settings.display.staveProfile = StaveProfile.ScoreTab;
                        this.api.updateSettings();
                    } else {
                        // This will break drum score
                        overrideHiddenStaves(score, this.setting.scoreStyle);
                    }

                    this.enableBackingTrack = this.hasBackingTrack();

                    this.ready = true;
                    resolve(trackID);
                });

                this.api.playerFinished.on(() => {
                    if (!this.isLooping) {
                        this.playing = false;
                    } else if (this.enableCountIn) {
                        const range = this.api.playbackRange;
                        if (range) {
                            this.api.tickPosition = range.startTick;
                        }
                        this.startPlayback();
                    }
                });
            });
        },

        destroyContainer() {
            this.api?.destroy();
            this.api = undefined;
            this.destroyYoutubePlayer();

            // Reset states
            this.ready = false;
            this.playing = false;
            this.currentAudio = "synth";
            this.enableMetronome = false;
            this.enableCountIn = false;
            this.isLooping = false;
            this.speed = 100;
            this.scrollMode = ScrollMode.Continuous;
            this.soloTrackID = -1;
            this.youtube = {};
            this.simpleSyncSecond = -1;
            this.isYoutubeSyncEditing = false;
            this.youtubeSyncBarIndex = 1;
            this.youtubeSyncOffsetSeconds = 0;
            this.muteTrackList = {};
            this.playbackRange = null;
            this.savedPlaybackRange = null;
            clearTimeout(this.playbackRangeRestoreTimer);
            this.playbackRangeRestoreTimer = undefined;
            countIn.cancel();
            this.isCountingIn = false;
            metronome.setEnabled(false);
            this.seekDownBeat = null;
        },

        simpleSync(offset) {
            // Apply sync points
            const syncPoints = [
                { "barIndex": 0, "barOccurence": 0, "barPosition": 0, "millisecondOffset": offset },
            ];
            this.api.score.applyFlatSyncPoints(syncPoints);
        },

        advancedSync(syncPointsText) {
            const syncPoints = convertAlphaTexSyncPoint(syncPointsText);
            this.api.score.applyFlatSyncPoints(syncPoints);
            console.log("Applying advanced sync points:", syncPoints);
        },

        startYoutubeSyncEdit() {
            this.isYoutubeSyncEditing = !this.isYoutubeSyncEditing;
            if (this.isYoutubeSyncEditing) {
                this.youtubeSyncOffsetSeconds = this.getYoutubeSyncOffsetSeconds();
            } else {
                this.selectedYoutubeSyncBarIndex = null;
            }
            this.$nextTick(() => this.updateYoutubeSyncPointMarkers());
        },

        getYoutubeSyncOffsetSeconds() {
            const offset = this.youtubePlayer?.getCurrentTime?.();
            return Number.isFinite(offset) ? Number(offset.toFixed(3)) : 0;
        },

        getBarPlaybackStart(barIndex) {
            for (const track of this.api?.score?.tracks ?? []) {
                for (const stave of track.staves ?? []) {
                    const bar = stave.bars?.find((candidate) => candidate.masterBar?.index === barIndex);
                    const beat = bar?.voices?.flatMap((voice) => voice.beats ?? []).find((candidate) => Number.isFinite(candidate.absolutePlaybackStart));
                    if (beat) {
                        return beat.absolutePlaybackStart;
                    }
                }
            }
            return null;
        },

        getExpectedYoutubeOffsetSeconds(barIndex) {
            const barPlaybackStart = this.getBarPlaybackStart(barIndex);
            const anchors = this.youtubeSyncPoints
                .map((anchor) => ({ ...anchor, playbackStart: this.getBarPlaybackStart(anchor.barIndex) }))
                .filter((anchor) => anchor.playbackStart !== null);
            if (barPlaybackStart === null || anchors.length === 0) {
                return null;
            }

            const exactAnchor = anchors.find((anchor) => anchor.barIndex === barIndex);
            if (exactAnchor) {
                return exactAnchor.offsetSeconds;
            }

            const before = [...anchors].reverse().find((anchor) => anchor.barIndex < barIndex);
            const after = anchors.find((anchor) => anchor.barIndex > barIndex);
            const [firstAnchor, secondAnchor] = before && after ? [before, after] : anchors.length > 1 ? (before ? anchors.slice(-2) : anchors.slice(0, 2)) : [anchors[0], null];
            if (!secondAnchor || firstAnchor.playbackStart === secondAnchor.playbackStart) {
                return firstAnchor.offsetSeconds + (barPlaybackStart - firstAnchor.playbackStart) / 1000;
            }

            const slope = (secondAnchor.offsetSeconds - firstAnchor.offsetSeconds) / (secondAnchor.playbackStart - firstAnchor.playbackStart);
            return firstAnchor.offsetSeconds + (barPlaybackStart - firstAnchor.playbackStart) * slope;
        },

        captureYoutubeSyncPoint() {
            this.youtubeSyncOffsetSeconds = this.getYoutubeSyncOffsetSeconds();
            this.addYoutubeSyncPoint();
        },

        selectSuggestedYoutubeSyncBar(barIndex) {
            this.youtubeSyncBarIndex = barIndex + 1;
            this.youtubeSyncOffsetSeconds = this.getYoutubeSyncOffsetSeconds();
            this.selectedYoutubeSyncBarIndex = null;
        },

        selectYoutubeSyncBar(beat) {
            if (!this.isYoutubeSyncEditing) {
                return;
            }

            const modelBeat = beat?.beat ?? beat;
            const barIndex = modelBeat?.voice?.bar?.masterBar?.index;
            if (!Number.isInteger(barIndex)) {
                return;
            }

            this.youtubeSyncBarIndex = barIndex + 1;
            const existingSyncPoint = this.youtubeSyncPoints.find((syncPoint) => syncPoint.barIndex === barIndex && syncPoint.barOccurence === 0);
            this.selectedYoutubeSyncBarIndex = existingSyncPoint ? barIndex : null;
            this.youtubeSyncOffsetSeconds = existingSyncPoint?.offsetSeconds ?? this.getYoutubeSyncOffsetSeconds();
            this.$nextTick(() => this.scrollToSelectedYoutubeSyncMarker());
        },

        addYoutubeSyncPoint() {
            const displayedBarIndex = Number(this.youtubeSyncBarIndex);
            const offsetSeconds = Number(this.youtubeSyncOffsetSeconds);
            if (!Number.isInteger(displayedBarIndex) || displayedBarIndex < 1 || !Number.isFinite(offsetSeconds) || offsetSeconds < 0) {
                notify({ type: "error", title: "Error", text: "Enter a valid bar and video offset." });
                return;
            }
            const barIndex = displayedBarIndex - 1;

            const syncPoint = `\\sync ${barIndex} 0 ${Math.round(offsetSeconds * 1000)}`;
            const lines = (this.youtube.advancedSync ?? "").split("\n");
            const existingPoint = lines.findIndex((line) => {
                const parts = line.trim().split(/\s+/);
                return parts[0] === "\\sync" && Number(parts[1]) === barIndex && Number(parts[2]) === 0;
            });

            if (existingPoint === -1) {
                lines.push(syncPoint);
            } else {
                lines[existingPoint] = syncPoint;
            }

            this.youtube.advancedSync = lines.filter((line) => line.trim()).join("\n");
            this.advancedSync(this.youtube.advancedSync);
            this.selectedYoutubeSyncBarIndex = barIndex;
            this.updateYoutubeSyncPointMarkers();
            this.$nextTick(() => this.scrollToSelectedYoutubeSyncMarker());
            notify({
                type: "success",
                text: existingPoint === -1 ? `Added sync point for bar ${displayedBarIndex}.` : `Updated sync point for bar ${displayedBarIndex}.`,
            });
        },

        selectExistingYoutubeSyncPoint(syncPoint) {
            this.youtubeSyncBarIndex = syncPoint.barIndex + 1;
            this.youtubeSyncOffsetSeconds = syncPoint.offsetSeconds;
            this.selectedYoutubeSyncBarIndex = syncPoint.barIndex;
            this.updateYoutubeSyncPointMarkers();
            this.$nextTick(() => this.scrollToSelectedYoutubeSyncMarker());
        },

        deleteYoutubeSyncPoint() {
            if (!Number.isInteger(this.selectedYoutubeSyncBarIndex)) {
                return;
            }

            const barIndex = this.selectedYoutubeSyncBarIndex;
            this.youtube.advancedSync = (this.youtube.advancedSync ?? "")
                .split("\n")
                .filter((line) => {
                    const parts = line.trim().split(/\s+/);
                    return parts[0] !== "\\sync" || Number(parts[1]) !== barIndex || Number(parts[2]) !== 0;
                })
                .filter((line) => line.trim())
                .join("\n");
            this.advancedSync(this.youtube.advancedSync);
            this.selectedYoutubeSyncBarIndex = null;
            this.updateYoutubeSyncPointMarkers();
            notify({ type: "success", text: `Deleted sync point for bar ${barIndex + 1}.` });
        },

        scrollToSelectedYoutubeSyncMarker() {
            if (!Number.isInteger(this.selectedYoutubeSyncBarIndex)) {
                return;
            }

            const marker = this.$refs.bassTabContainer?.parentElement?.querySelector(`[data-sync-bar-index="${this.selectedYoutubeSyncBarIndex}"]`);
            marker?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
        },

        async saveYoutubeSyncPoints() {
            if (await this.saveYoutube()) {
                notify({ type: "success", text: "Audio sync saved." });
                this.isYoutubeSyncEditing = false;
                this.youtubeSyncPointMarkers = [];
                this.selectedYoutubeSyncBarIndex = null;
            }
        },

        updateYoutubeSyncPointMarkers() {
            if (!this.isYoutubeSyncEditing || !this.api?.boundsLookup) {
                this.youtubeSyncPointMarkers = [];
                return;
            }

            this.youtubeSyncPointMarkers = this.youtubeSyncPoints.flatMap((syncPoint) => {
                const bounds = this.api.boundsLookup.findMasterBarByIndex(syncPoint.barIndex);
                if (!bounds) {
                    return [];
                }

                const { x, y, h } = bounds.lineAlignedBounds;
                return [{
                    barIndex: syncPoint.barIndex,
                    isSelected: syncPoint.barIndex === this.selectedYoutubeSyncBarIndex,
                    style: { left: `${x}px`, top: `${y}px`, height: `${h}px` },
                }];
            });
        },

        getBeatKey(beat) {
            const modelBeat = beat?.beat ?? beat;
            const bar = modelBeat?.voice?.bar;
            return bar ? `${bar.index}:${modelBeat.index}:${modelBeat.absolutePlaybackStart}` : null;
        },

        needsCustomCountIn() {
            return this.currentAudio.startsWith("audio-") || this.currentAudio.startsWith("youtube-") || this.currentAudio === "backingTrack";
        },

        applyCountInVolume() {
            if (this.api) {
                this.api.countInVolume = this.enableCountIn && this.currentAudio === "synth" ? 1 : 0;
            }
        },

        applyMetronome() {
            if (!this.api) {
                return;
            }
            this.api.metronomeVolume = 0;
            metronome.setEnabled(this.enableMetronome && this.currentAudio === "synth");
        },

        getCountInInfo() {
            const tick = this.api.tickPosition ?? 0;
            let bar = this.api.score.masterBars[0];
            for (const masterBar of this.api.score.masterBars) {
                if (masterBar.start <= tick) {
                    bar = masterBar;
                } else {
                    break;
                }
            }
            const bpm = bar.tempoAutomations?.[0]?.value ?? 120;
            return { bpm: bpm * (this.api.playbackSpeed ?? 1), beats: bar.timeSignatureNumerator ?? 4 };
        },

        startExternalCountIn() {
            countIn.cancel();
            this.isCountingIn = true;
            countIn.start({
                ...this.getCountInInfo(),
                onFinished: () => {
                    this.isCountingIn = false;
                    if (this.playing) {
                        const handler = this.api.player.output?.handler;
                        if (handler?.play) {
                            handler.play();
                        } else {
                            this.api.play();
                        }
                    }
                },
            });
        },

        restorePlaybackRange() {
            if (!this.savedPlaybackRange || !this.api) {
                return;
            }
            this.api.playbackRange = this.savedPlaybackRange;
            clearTimeout(this.playbackRangeRestoreTimer);
            this.playbackRangeRestoreTimer = setTimeout(() => {
                this.savedPlaybackRange = null;
                this.playbackRangeRestoreTimer = undefined;
            }, 1500);
        },

        async audioYoutube(videoID) {
            this.currentAudio = "youtube-" + videoID;
            this.closeAllList();
        },

        async audioFile(filename) {
            this.currentAudio = "audio-" + filename;
            this.closeAllList();
        },

        async initAudio(filename) {
            if (!this.api) {
                return;
            }

            this.isInitializingAudio = true;
            this.closeAllList();

            const audioPlayer = this.$refs.audioPlayer;

            // Init the audio handler if not exists
            if (!this.audioHandler) {
                const onPlayRejected = () => {
                    this.playing = false;
                };
                this.audioHandler = {
                    get backingTrackDuration() {
                        const duration = audioPlayer.duration;
                        return Number.isFinite(duration) ? duration * 1000 : 0;
                    },
                    get playbackRate() {
                        return audioPlayer.playbackRate;
                    },
                    set playbackRate(value) {
                        audioPlayer.playbackRate = value;
                    },
                    get masterVolume() {
                        return audioPlayer.volume;
                    },
                    set masterVolume(value) {
                        audioPlayer.volume = value;
                    },
                    seekTo(time) {
                        audioPlayer.currentTime = time / 1000;
                    },
                    play() {
                        audioPlayer.play().catch((error) => {
                            console.error("audio.play() rejected:", error);
                            onPlayRejected();
                        });
                    },
                    pause() {
                        audioPlayer.pause();
                    },
                };

                let updateTimer = 0;
                const onTimeUpdate = () => {
                    this.api?.player?.output?.updatePosition?.(
                        audioPlayer.currentTime * 1000,
                    );
                };

                audioPlayer.addEventListener("timeupdate", onTimeUpdate);
                audioPlayer.addEventListener("seeked", onTimeUpdate);
                audioPlayer.addEventListener("play", () => {
                    window.clearInterval(updateTimer);
                    this.playing = true;
                    this.api?.play();
                    onTimeUpdate();
                    updateTimer = window.setInterval(onTimeUpdate, externalPositionSyncMs);
                });

                // state updates
                audioPlayer.addEventListener("pause", () => {
                    // If the audio ended, the "pause" event will also be triggered
                    // Ignore this, because we have "ended" event to handle it
                    if (audioPlayer.ended) {
                        return;
                    }

                    if (this.isCountingIn) {
                        return;
                    }

                    console.log("[audioPlayer] paused");
                    this.playing = false;
                    this.api.pause();
                    window.clearInterval(updateTimer);
                });
                audioPlayer.addEventListener("ended", () => {
                    console.log("[audioPlayer] ended");

                    // If isLooping is true, seek to the beginning and play again
                    // Else just pause
                    if (this.isLooping) {
                        audioPlayer.currentTime = 0;
                        audioPlayer.play().catch(() => {});
                    } else {
                        this.playing = false;
                        this.api.pause();
                        window.clearInterval(updateTimer);
                    }
                });
                audioPlayer.addEventListener("error", () => {
                    // Ignore the empty-src error fired before any file is chosen
                    if (!audioPlayer.getAttribute("src")) {
                        return;
                    }
                    this.playing = false;
                    notify({
                        type: "error",
                        title: "Audio",
                        text: "Could not load the audio file.",
                    });
                });
                audioPlayer.addEventListener("volumechange", () => {
                    this.api.masterVolume = audioPlayer.volume;
                });
                audioPlayer.addEventListener("ratechange", () => {
                    this.api.playbackSpeed = audioPlayer.playbackRate;
                });
            }

            // Bug? If change to EnabledExternalMedia, and this.api.updateSettings(), this sync point can not be applied correctly.
            // So it must change to EnabledSynthesizer first, then change to EnabledExternalMedia
            this.api.settings.player.playerMode = alphaTab.PlayerMode.EnabledSynthesizer;
            this.api.updateSettings();

            let found = false;
            let syncMethod;
            let syncData;

            // Get offset from youtubeList
            for (const audio of this.audioList) {
                if (audio.filename === filename) {
                    this.audio = audio;
                    syncMethod = audio.syncMethod;
                    syncData = audio.syncMethod === "advanced" ? audio.advancedSync : audio.simpleSync;
                    if (audio.syncMethod === "advanced") {
                        this.advancedSync(audio.advancedSync);
                    } else {
                        this.simpleSync(audio.simpleSync);
                    }
                    found = true;
                    break;
                }
            }

            // Probably provided an audio file not in the list, switch to synth
            if (!found) {
                this.isInitializingAudio = false;
                notify({
                    type: "error",
                    title: "Error",
                    text: "Audio file not found, fallback to synth.",
                });
                this.currentAudio = "synth";
                return;
            }

            this.api.settings.player.playerMode = alphaTab.PlayerMode.EnabledExternalMedia;
            this.api.updateSettings();

            this.api.player.output.handler = this.audioHandler;

            const path = baseURL + `/api/tab/${this.tabID}/audio/${encodeURIComponent(filename)}`;

            audioPlayer.src = path;
            audioPlayer.load();
            audioPlayer.playbackRate = this.api.playbackSpeed;

            this.pause();
            await this.$nextTick();
            if (syncMethod === "advanced") {
                this.advancedSync(syncData);
            } else {
                this.simpleSync(syncData);
            }
            this.isInitializingAudio = false;
        },

        async initYoutube(videoID) {
            this.isInitializingAudio = true;
            this.closeAllList();

            this.stopYoutubeSync();

            if (!this.youtubePlayer) {
                await this.initYoutubePlayer();
            }

            // Bug? If change to EnabledExternalMedia, and this.api.updateSettings(), this sync point can not be applied correctly.
            // So it must change to EnabledSynthesizer first, then change to EnabledExternalMedia
            this.api.settings.player.playerMode = alphaTab.PlayerMode.EnabledSynthesizer;
            this.api.updateSettings();

            let found = false;
            let syncMethod;
            let syncData;

            // Get offset from youtubeList
            for (const yt of this.youtubeList) {
                if (yt.videoID === videoID) {
                    this.youtube = yt;
                    syncMethod = yt.syncMethod;
                    syncData = yt.syncMethod === "advanced" ? yt.advancedSync : yt.simpleSync;
                    if (yt.syncMethod === "advanced") {
                        this.advancedSync(yt.advancedSync);
                    } else {
                        this.simpleSync(yt.simpleSync);
                    }
                    found = true;
                    break;
                }
            }

            // Probably provided a video ID not in the list, switch to synth
            if (!found) {
                this.isInitializingAudio = false;
                notify({
                    type: "error",
                    title: "Error",
                    text: "YouTube video not found, fallback to synth.",
                });
                this.currentAudio = "synth";
                return;
            }

            this.api.settings.player.playerMode = alphaTab.PlayerMode.EnabledExternalMedia;
            this.api.updateSettings();

            this.api.player.output.handler = this.alphaTabYoutubeHandler;
            this.youtubePlayer.cueVideoById(videoID);
            this.youtubePlayer.setPlaybackRate(this.api.playbackSpeed);
            this.pause();
            await this.$nextTick();
            if (syncMethod === "advanced") {
                this.advancedSync(syncData);
            } else {
                this.simpleSync(syncData);
            }
            this.isInitializingAudio = false;
        },

        async initYoutubePlayer() {
            const ytWarning = setTimeout(() => {
                notify({
                    type: "warning",
                    title: "Warning",
                    text: "If YouTube is taking too long to load, please refresh the page.",
                });
            }, 5000);

            this.$refs.youtube.innerHTML = "";

            const isScriptLoaded = typeof YT !== "undefined";
            console.log("isScriptLoaded:", isScriptLoaded);

            // Create playerElement inside this.$refs.youtube
            const playerElement = document.createElement("div");
            this.$refs.youtube.appendChild(playerElement);

            if (!isScriptLoaded) {
                const tag = document.createElement("script");
                tag.src = "https://www.youtube.com/player_api";
                const firstScriptTag = document.getElementsByTagName("script")[0];
                firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
                console.log("Loading YouTube API");

                const youtubeApiReady = Promise.withResolvers();
                window.onYouTubePlayerAPIReady = youtubeApiReady.resolve;
                await youtubeApiReady.promise;
                console.log("YouTube API ready");

                // Now Youtube Script is loaded
                // The YT object is now available globally, even if vue route changed. Be careful.
            } else {
                console.log("YouTube API already loaded");
            }

            const youtubePlayerReady = Promise.withResolvers();
            let isPlayerReady = false;
            let initialSeek = -1;
            const applyInitialSeek = () => {
                if (initialSeek < 0) {
                    return;
                }

                player.seekTo(initialSeek);
                initialSeek = -1;
            };
            const player = new YT.Player(playerElement, {
                height: "180",
                width: "320",
                //videoId: videoID,
                playerVars: { "autoplay": 0, "controls": 0 }, // Playback is controlled by the app.
                events: {
                    "onReady": (e) => {
                        isPlayerReady = true;
                        youtubePlayerReady.resolve();
                    },

                    // when the player state changes we update alphatab accordingly.
                    "onStateChange": (e) => {
                        //
                        switch (e.data) {
                            case YT.PlayerState.PLAYING:
                                this.stopYoutubeSync();
                                const syncPosition = () => {
                                    this.api?.player?.output?.updatePosition?.(player.getCurrentTime() * 1000);
                                };
                                syncPosition();
                                this.youtubeSyncTimer = window.setInterval(syncPosition, externalPositionSyncMs);
                                this.playing = true;
                                applyInitialSeek();
                                break;
                            case YT.PlayerState.ENDED:
                                this.stopYoutubeSync();
                                this.playing = false;
                                this.api?.stop();
                                break;
                            case YT.PlayerState.PAUSED:
                                this.stopYoutubeSync();
                                if (this.isCountingIn) {
                                    break;
                                }
                                this.playing = false;
                                break;
                            case YT.PlayerState.BUFFERING:
                                this.stopYoutubeSync();
                                break;
                            case YT.PlayerState.CUED:
                                applyInitialSeek();
                                break;
                            default:
                                break;
                        }
                    },
                    "onPlaybackRateChange": (e) => {
                        this.api.playbackSpeed = e.data;
                    },
                    "onError": (e) => {
                        youtubePlayerReady.reject(e);
                        if (isPlayerReady) {
                            this.playing = false;
                            notify({
                                type: "error",
                                title: "YouTube",
                                text: "This video could not be played.",
                            });
                        }
                    },
                },
            });

            try {
                await youtubePlayerReady.promise;
            } finally {
                clearTimeout(ytWarning);
            }
            console.log("YouTube Player ready");

            const alphaTabYoutubeHandler = {
                get backingTrackDuration() {
                    return player.getDuration() * 1000;
                },
                get playbackRate() {
                    console.log("Get playback rate:", player.getPlaybackRate());
                    return player.getPlaybackRate();
                },
                set playbackRate(value) {
                    console.log("Set playback rate:", value);
                    player.setPlaybackRate(value);
                },
                get masterVolume() {
                    return player.getVolume() / 100;
                },
                set masterVolume(value) {
                    player.setVolume(value * 100);
                },
                seekTo(time) {
                    if (
                        player.getPlayerState() !== YT.PlayerState.PAUSED &&
                        player.getPlayerState() !== YT.PlayerState.PLAYING
                    ) {
                        initialSeek = time / 1000;
                    } else {
                        player.seekTo(time / 1000);
                    }
                },
                play() {
                    player.playVideo();
                    applyInitialSeek();
                },
                pause() {
                    player.pauseVideo();
                },
            };

            this.youtubePlayer = player;
            this.alphaTabYoutubeHandler = alphaTabYoutubeHandler;
            this.youtubePlayer.setVolume(Math.min(100, this.masterVolume));
        },

        stopYoutubeSync() {
            if (this.youtubeSyncTimer !== undefined) {
                window.clearInterval(this.youtubeSyncTimer);
                this.youtubeSyncTimer = undefined;
            }
        },

        destroyYoutubePlayer() {
            this.stopYoutubeSync();
            this.youtubePlayer?.destroy();
            this.youtubePlayer = null;
            this.alphaTabYoutubeHandler = null;
        },

        audioNone() {
            this.currentAudio = "none";
            this.closeAllList();
        },

        async audioSynth() {
            this.currentAudio = "synth";
            this.closeAllList();
        },

        async initSynth() {
            this.api.settings.player.playerMode = alphaTab.PlayerMode.EnabledSynthesizer;
            this.api.updateSettings();
            this.pause();
        },

        async audioBackingTrack() {
            if (!this.hasBackingTrack()) {
                notify({
                    type: "error",
                    title: "Error",
                    text: "No backing track found in this tab.",
                });
                return;
            }
            this.currentAudio = "backingTrack";
            this.closeAllList();
        },

        /**
         * Check if the current track is a drum track (program 0).
         * this.selectedTrack must be set before calling this function.
         * @returns {boolean}
         */
        isDrum() {
            if (!this.api || !this.api.score || !this.api.score.tracks) {
                return false;
            }
            const track = this.api.score.tracks[this.selectedTrack];
            return track.playbackInfo.program === 0;
        },

        /**
         * Change the displayed track.
         * @param trackID
         * @returns {Promise<void>}
         */
        async changeTrack(trackID) {
            const fromDrum = this.isDrum();
            this.selectedTrack = trackID;
            const isDrum = this.isDrum();

            // If switching from/to drum track, need to re-render the whole score
            // Due to the bug that Drum is not able to render in Tab View
            if (fromDrum || isDrum) {
                await this.load(trackID);
            } else {
                this.api.renderTracks([this.api.score.tracks[trackID]]);
                this.setConfig("trackID", trackID);
            }

            this.closeAllList();
        },

        showList(type) {
            if (type === "track") {
                this.showTrackList = !this.showTrackList;
                this.showAudioList = false;
            } else if (type === "audio") {
                this.showAudioList = !this.showAudioList;
                this.showTrackList = false;
            }
        },

        closeAllList() {
            this.showTrackList = false;
            this.showAudioList = false;
        },

        toggleSolo(trackID) {
            if (!this.api) {
                return;
            }

            if (this.soloTrackID === trackID) {
                this.api.changeTrackMute(this.api.score.tracks, false);
                this.soloTrackID = -1;
                this.muteTrackList = {};
            } else {
                const muteList = [];
                const soloList = [];

                for (const track of this.api.score.tracks) {
                    if (track.index !== trackID) {
                        muteList.push(track);
                        this.muteTrackList[track.index] = true;
                    } else {
                        soloList.push(track);
                        this.muteTrackList[track.index] = false;
                    }
                }

                this.api.changeTrackMute(muteList, true);
                this.api.changeTrackMute(soloList, false);

                this.soloTrackID = trackID;
            }
        },

        toggleMute(trackID) {
            this.soloTrackID = -1;

            this.muteTrackList[trackID] = !this.muteTrackList[trackID];

            const mute = this.muteTrackList[trackID];

            this.api.changeTrackMute([
                this.api.score.tracks[trackID],
            ], mute);
        },

        normalizeVolume(volume, fallback = 100) {
            const parsedVolume = typeof volume === "string" && volume.trim() === "" ? Number.NaN : Number(volume);
            if (!Number.isFinite(parsedVolume)) {
                return fallback;
            }
            return Math.min(this.allowVolumeBoost ? 200 : 100, Math.max(0, parsedVolume));
        },

        /**
         * With boost enabled, 100% sits in the middle of a ~120px slider (about 1.7 units per pixel),
         * so releasing the thumb "on" it often lands on 98-99%. Snap to 100% when released close to it.
         * Pointer-only, so keyboard steps (+/-1) still work.
         */
        snapToFull(input, apply) {
            const value = Number(input.value);
            if (this.allowVolumeBoost && value !== 100 && Math.abs(value - 100) <= 3) {
                input.value = 100;
                apply(100);
            }
        },

        setAllowVolumeBoost(allowVolumeBoost) {
            this.allowVolumeBoost = allowVolumeBoost;
            if (!allowVolumeBoost) {
                this.masterVolume = this.normalizeVolume(this.masterVolume);
                this.trackVolumeList = Object.fromEntries(Object.entries(this.trackVolumeList).map(([trackID, volume]) => [trackID, this.normalizeVolume(volume)]));
                this.applyTrackVolumes();
                this.youtubePlayer?.setVolume(this.masterVolume);
                this.setConfig("masterVolume", this.masterVolume);
                this.setConfig("trackVolumeList", this.trackVolumeList);
            }
            this.setConfig("allowVolumeBoost", allowVolumeBoost);
        },

        initializeTrackVolumes(tracks) {
            const masterVolume = this.normalizeVolume(this.getConfig("masterVolume", 100));
            const savedTrackVolumeList = this.getConfig("trackVolumeList", {});
            const validTrackVolumeList = savedTrackVolumeList && typeof savedTrackVolumeList === "object" && !Array.isArray(savedTrackVolumeList) ? savedTrackVolumeList : {};
            const trackVolumeList = {};

            for (const track of tracks) {
                trackVolumeList[track.index] = this.normalizeVolume(validTrackVolumeList[track.index], masterVolume);
            }

            this.masterVolume = masterVolume;
            this.trackVolumeList = trackVolumeList;
        },

        applyTrackVolumes() {
            if (!this.api?.score?.tracks) {
                return;
            }

            for (const track of this.api.score.tracks) {
                const volume = this.normalizeVolume(this.trackVolumeList[track.index], this.masterVolume);
                this.api.changeTrackVolume([track], volume / 100);
            }
        },

        setMasterVolume(volume) {
            if (!this.api?.score?.tracks) {
                return;
            }

            const normalizedVolume = this.normalizeVolume(volume, this.masterVolume);
            const trackVolumeList = {};
            for (const track of this.api.score.tracks) {
                trackVolumeList[track.index] = normalizedVolume;
            }

            this.masterVolume = normalizedVolume;
            this.trackVolumeList = trackVolumeList;
            this.api.changeTrackVolume(this.api.score.tracks, normalizedVolume / 100);
            this.youtubePlayer?.setVolume(Math.min(100, normalizedVolume));
            this.setConfig("masterVolume", normalizedVolume);
            this.setConfig("trackVolumeList", trackVolumeList);
        },

        setTrackVolume(trackID, volume) {
            if (!this.api?.score?.tracks) {
                return;
            }

            const track = this.api.score.tracks.find(({ index }) => index === trackID);
            if (!track) {
                return;
            }

            const normalizedVolume = this.normalizeVolume(volume, this.trackVolumeList[trackID] ?? this.masterVolume);
            this.trackVolumeList = {
                ...this.trackVolumeList,
                [trackID]: normalizedVolume,
            };
            this.api.changeTrackVolume([track], normalizedVolume / 100);
            this.setConfig("trackVolumeList", this.trackVolumeList);
        },

        edit() {
            this.$router.push(`/tab/${this.tabID}/edit/info`);
        },

        hasBackingTrack() {
            return !!this.api.score.backingTrack;
        },

        setConfig(key, value) {
            localStorage.setItem(`tab-${this.tabID}-${key}`, JSON.stringify(value));
        },

        getConfig(key, defaultValue) {
            const value = localStorage.getItem(`tab-${this.tabID}-${key}`);
            if (value === null) {
                return defaultValue;
            }
            return JSON.parse(value);
        },

        async saveYoutube() {
            let res;
            try {
                res = await fetch(baseURL + `/api/tab/${this.tabID}/youtube/${this.youtube.videoID}`, {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        syncMethod: this.youtube.syncMethod,
                        simpleSync: this.youtube.simpleSync,
                        advancedSync: this.youtube.advancedSync,
                    }),
                });

                await checkFetch(res);
                return true;
            } catch (e) {
                generalError(e);
                return false;
            }
        },

        async saveAudio() {
            let res;
            try {
                res = await fetch(baseURL + `/api/tab/${this.tabID}/audio/${this.audio.filename}`, {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        syncMethod: this.audio.syncMethod,
                        simpleSync: this.audio.simpleSync,
                        advancedSync: this.audio.advancedSync,
                    }),
                });

                await checkFetch(res);
            } catch (e) {
                generalError(e);
            }
        },

        /**
         * Move the cursor to the previous/next bar.
         * @param steps Number of bars to move. Negative for previous bars.
         */
        moveToBar(steps) {
            try {
                if (!this.api || !this.api.score || !this.api.score.masterBars || this.api.score.masterBars.length === 0) {
                    return;
                }

                const masterBars = this.api.score.masterBars;
                const currentTick = Number(this.api.tickPosition ?? 0);
                let index = 0;
                for (let i = 0; i < masterBars.length; i++) {
                    const masterBarStart = masterBars[i].start ?? 0;
                    if (masterBarStart <= currentTick) {
                        index = i;
                    } else {
                        break;
                    }
                }

                let target = index + steps;
                if (target < 0) target = 0;
                if (target >= masterBars.length) target = masterBars.length - 1;

                const targetTick = masterBars[target].start ?? 0;
                this.api.tickPosition = targetTick;
            } catch (err) {
                console.error("moveToBar error:", err);
            }
        },
    },
});
</script>

<template>
    <TextTabPlayer v-if="isTextTab" :id="String(tabID)" />
    <div v-else class="main" :class='{ "light": setting.scoreColor === "light" }' :aria-busy="loadState === 'loading'">
        <h1>{{ tab.title }}</h1>
        <div class="artist-row">
            <div class="key-signature badge bg-secondary" v-if="keySignature && setting.showKeySignature" title="Key signature">
                {{ keySignature }}
            </div>
            <h2>{{ tab.artist }}</h2>
            <div class="drum-notation-selector" v-if="loadState === 'ready' && isDrum()" ref="drumNotation">
                <button class="btn btn-outline-secondary" type="button" aria-label="Drum notation" title="Drum notation" @click="showDrumNotation = !showDrumNotation"
                    aria-controls="drum-notation-tooltip" :aria-expanded="showDrumNotation">
                    <font-awesome-icon :icon='["fas", "drum"]' />
                    <span class="drum-notation-label">Notation</span>
                </button>
                <div id="drum-notation-tooltip" class="drum-notation-tooltip" v-if="showDrumNotation" role="group" aria-label="Drum notation key">
                    <div class="drum-notation-heading">
                        <strong class="drum-notation-title">DRUMSET</strong>
                        <button class="notation-close" type="button" aria-label="Close drum notation key" @click="showDrumNotation = false">
                            <font-awesome-icon :icon='["fas", "xmark"]' />
                        </button>
                    </div>
                    <div class="drum-notation-groups">
                        <div
                            class="drum-notation-group bass"><span>Bass drum</span><small>Normal</small><svg viewBox="0 0 28 60"><path class="drum-note" d="M20 38c1 2-1 4-4 5s-6 1-7-1c-1-2 1-4 4-5s6-1 7 1Z" /></svg></div>
                        <div
                            class="drum-notation-group snare"><span>Snare</span><small>Normal</small><svg viewBox="0 0 28 60"><path class="drum-note" d="M20 26c1 2-1 4-4 5s-6 1-7-1c-1-2 1-4 4-5s6-1 7 1Z" /></svg></div>
                        <div
                            class="drum-notation-group hihat"><span>Hi Hat</span><small>Closed</small><small>Open</small><small>Foot</small><svg viewBox="0 0 28 60"><path class="drum-glyph" d="m14 1-4-4 1-1 4 4 4-4 1 1-4 4 4 4-1 1-4-4-4 4-1-1z" /></svg><svg viewBox="0 0 28 60"><circle class="drum-glyph" cx="14" cy="1" r="6" /><path class="drum-glyph" d="m10-3 8 8m0-8-8 8" /></svg><svg viewBox="0 0 28 60"><path class="drum-glyph" d="m14 55-4-4 1-1 4 4 4-4 1 1-4 4 4 4-1 1-4-4-4 4-1-1z" /></svg></div>
                        <div
                            class="drum-notation-group tom"><span>Tom</span><small>Floor</small><small>Very low</small><small>High</small><svg viewBox="0 0 28 60"><path class="drum-note" d="M20 32c1 2-1 4-4 5s-6 1-7-1c-1-2 1-4 4-5s6-1 7 1Z" /></svg><svg viewBox="0 0 28 60"><path class="drum-note" d="M20 32c1 2-1 4-4 5s-6 1-7-1c-1-2 1-4 4-5s6-1 7 1Z" /></svg><svg viewBox="0 0 28 60"><path class="drum-note" d="M20 8c1 2-1 4-4 5s-6 1-7-1c-1-2 1-4 4-5s6-1 7 1Z" /></svg></div>
                        <div
                            class="drum-notation-group crash"><span>Crash</span><small>High</small><svg viewBox="0 0 28 60"><path class="drum-ledger" d="M6-11h16" /><path class="drum-glyph" d="m14-11-5-4 2-2 4 4 4-4 2 2-5 4 5 4-2 2-4-4-4 4-2-2z" /></svg></div>
                        <div
                            class="drum-notation-group ride"><span>Ride</span><small>Cymbal</small><svg viewBox="0 0 28 60"><path class="drum-glyph" d="m14 7-4-4 1-1 4 4 4-4 1 1-4 4 4 4-1 1-4-4-4 4-1-1z" /></svg></div>
                    </div>
                </div>
            </div>
        </div>
        <div v-if="loadState === 'loading'" class="load-state" role="status">
            <span class="load-spinner" aria-hidden="true"></span>
            <span>Loading tab...</span>
            <div class="load-skeleton" aria-hidden="true"><i></i><i></i><i></i></div>
        </div>
        <div v-else-if="loadState === 'error'" class="load-state error" role="alert">
            <strong>Could not load this tab.</strong>
            <span class="load-detail">{{ loadError }}</span>
            <button class="btn btn-primary" type="button" @click="initTab">
                <font-awesome-icon :icon='["fas", "rotate-left"]' />
                Retry
            </button>
        </div>
        <div class="score-container">
            <div ref="bassTabContainer" v-pre></div>
            <div class="youtube-sync-tab-markers" v-if="isYoutubeSyncEditing">
                <span class="youtube-sync-tab-marker" :class="{ selected: marker.isSelected }" v-for="marker in youtubeSyncPointMarkers" :key="marker.barIndex" :data-sync-bar-index="marker.barIndex"
                    :style="marker.style" :title="`Sync point: bar ${marker.barIndex + 1}`"></span>
            </div>
        </div>

        <!-- Just add a margin, don't let youtube player overlay the tab -->
        <div :class='{ "yt-margin": currentAudio.startsWith(`youtube-`) }'></div>

        <div class="toolbar" ref="toolbar" :class='{ "auto-hide": setting.toolbarAutoHide, revealed: toolbarRevealed }'>
            <button class="toolbar-handle" type="button" v-if="setting.toolbarAutoHide" :aria-expanded="toolbarRevealed" aria-label="Toolbar" title="Show or hide toolbar"
                @click="toolbarRevealed = !toolbarRevealed">
                <font-awesome-icon :icon='["fas", "caret-down"]' class="toolbar-handle-icon" :class="{ flipped: !toolbarRevealed }" />
            </button>
            <div class="scroll">
                <button class="btn" type="button" @click="playPause" :class="playing ? 'btn-success active' : 'btn-primary'" :disabled="!ready">
                    <span v-if="!playing">
                        <font-awesome-icon :icon='["fas", "play"]' />
                        Play
                    </span>
                    <span v-else>
                        <font-awesome-icon :icon='["fas", "pause"]' />
                        Pause
                    </span>
                </button>

                <button class="btn btn-warning restart-button" type="button" v-if="playbackRange" title="Restart from the selection" aria-label="Restart from the selection"
                    @click="playFromHighlightedRange()">
                    <font-awesome-icon :icon='["fas", "backward-step"]' />
                    <span class="label">Restart</span>
                </button>

                <div class="track-selector selector" ref="trackSelector">
                    <button class="button" type="button" @click='showList("track")' aria-controls="track-list" :aria-expanded="showTrackList"
                        :title="tracks.length > 0 ? `Tracks: ${tracks[selectedTrack]?.name}` : 'Tracks'">
                        <font-awesome-icon :icon='["fas", "music"]' />
                        <span class="label" v-if="tracks.length > 0">Tracks: {{ tracks[selectedTrack]?.name }}</span>
                        <span class="label" v-else>Loading...</span>
                        <font-awesome-icon class="caret" :icon='["fas", "caret-down"]' />
                    </button>
                </div>

                <div class="audio-selector selector" ref="audioSelector">
                    <button class="button" type="button" @click='showList("audio")' aria-controls="audio-list" :aria-expanded="showAudioList" :title="audioSelectionLabel">
                        <font-awesome-icon v-if="isYoutubeAudio" :icon='["fab", "youtube"]' />
                        <font-awesome-icon v-else :icon='["fas", audioIcon]' />
                        <span class="label">{{ audioSelectionLabel }}</span>
                        <font-awesome-icon class="caret" :icon='["fas", "caret-down"]' />
                    </button>
                </div>

                <div id="secondary-controls" class="secondary-controls" ref="secondaryControls" :class="{ open: showSecondaryControls }">
                    <div class="extra-controls">
                        <button class="btn btn-secondary" type="button" @click="loop()" :class="{ active: isLooping }" :aria-pressed="isLooping">
                    <font-awesome-icon :icon='["fas", "check"]' v-if="isLooping" />
                    <font-awesome-icon :icon='["fas", "repeat"]' v-else />
                    Loop
                </button>
                        <button class="btn btn-secondary" type="button" @click="countIn()" :class='{ active: enableCountIn }' :aria-pressed="enableCountIn">
                    <font-awesome-icon :icon='["fas", "check"]' v-if="enableCountIn" />
                    <font-awesome-icon :icon='["fas", "list-ol"]' v-else />
                    Count in
                </button>
                        <button class="btn btn-secondary" type="button" @click="metronome()" :class='{ active: enableMetronome }' :aria-pressed="enableMetronome" :disabled='currentAudio !== "synth"'
                            :title='currentAudio !== "synth" ? "Metronome is only available with the Synth audio source" : undefined'>
                    <font-awesome-icon :icon='["fas", "check"]' v-if="enableMetronome" />
                    <font-awesome-icon :icon='["fas", "stopwatch"]' v-else />
                    Metronome
                </button>
                    </div>

                    <div class="speed-selector" ref="speedSelector">
                        <button class="btn btn-secondary" type="button" @click="showSpeedSelector = !showSpeedSelector" aria-controls="speed-popover" :aria-expanded="showSpeedSelector"
                            :title="`Speed: ${formattedBpm} BPM`">
                            <font-awesome-icon :icon='["fas", "gauge-high"]' />
                            <span class="label"><span class="prefix">Speed: </span>{{ formattedBpm }} BPM</span>
                        </button>
                        <div id="speed-popover" class="speed-selector-popover" v-if="showSpeedSelector" role="group" aria-label="Playback speed">
                            <div class="speed-selector-header">
                                <div class="speed-selector-bpm">
                                    <button type="button" aria-label="Decrease tempo" @click="adjustBpm(-1)">−</button>
                                    <label class="visually-hidden" for="bpm-input">BPM</label>
                                    <input id="bpm-input" :value="formattedBpm" type="number" :min="tempo * 0.2" :max="tempo * 2" step="0.01" inputmode="decimal" aria-label="BPM"
                                        @change="setBpm($event.target.value)" />
                                    <button type="button" aria-label="Increase tempo" @click="adjustBpm(1)">+</button>
                                    <span>BPM</span>
                                </div>
                                <button class="speed-reset" type="button" :disabled="speed === 100" :title="`Reset to ${tempo} BPM`" @click="speed = 100">
                                <font-awesome-icon icon="rotate-left" /> Reset
                            </button>
                            </div>
                            <div class="speed-scale">
                                <button v-for="mark in speedMarks" :key="mark" class="speed-mark" type="button" :class="{ active: speed === mark }" :style="{ left: speedMarkPosition(mark) }"
                                    :aria-label="`Set playback speed to ${mark}%`" @click="speed = mark">{{ mark }}</button>
                                <div class="speed-ticks" aria-hidden="true">
                                    <i v-for="tick in 37" :key="tick" :class="{ major: (tick - 1) % 5 === 0 }"></i>
                                </div>
                                <input v-model.number="speed" type="range" min="20" max="200" step="5" aria-label="Playback speed" :aria-valuetext="`${speed}% (${formattedBpm} BPM)`" />
                                <span class="speed-unit">%</span>
                            </div>
                        </div>
                    </div>

                    <div class="zoom-selector">
                        <button class="btn btn-secondary" type="button" aria-label="Zoom out" :disabled="tabScale <= 0.5" @click="adjustTabScale(-0.1)">
                            <font-awesome-icon :icon='["fas", "magnifying-glass-minus"]' />
                        </button>
                        <span class="zoom-value"><span class="prefix">Zoom </span>{{ Math.round(tabScale * 100) }}%</span>
                        <button class="btn btn-secondary" type="button" aria-label="Zoom in" :disabled="tabScale >= 3" @click="adjustTabScale(0.1)">
                            <font-awesome-icon :icon='["fas", "magnifying-glass-plus"]' />
                        </button>
                    </div>
                </div>

                <div class="btn-edit" v-if="isLoggedIn">
                    <button class="btn btn-info" type="button" title="Edit tab" @click="edit()">
                        <font-awesome-icon :icon='["fas", "pen"]' />
                        <span class="label">Edit</span>
                    </button>
                </div>

                <button class="btn btn-secondary secondary-controls-toggle" type="button" ref="secondaryToggle" aria-controls="secondary-controls" :aria-expanded="showSecondaryControls"
                    aria-label="More controls" title="More controls"
                    @click="showSecondaryControls = !showSecondaryControls">
                    <font-awesome-icon :icon='["fas", "ellipsis"]' />
                </button>
            </div>

            <div id="track-list" class="track-list list" v-if="showTrackList" ref="trackList" role="group" aria-label="Tracks and volume">
                <div class="list-header">
                    <h2 class="list-title">Tracks &amp; volume</h2>
                    <button class="list-close" type="button" aria-label="Close" @click="showTrackList = false">
                        <font-awesome-icon :icon='["fas", "xmark"]' />
                    </button>
                </div>
                <label class="volume-boost-toggle">
                    <span class="boost-text">
                        <strong>Allow volume boost</strong>
                        <small>Raise the volume up to 200%</small>
                    </span>
                    <span class="volume-boost-switch">
                        <input type="checkbox" :checked="allowVolumeBoost" @change="setAllowVolumeBoost($event.target.checked)" />
                        <span aria-hidden="true"></span>
                    </span>
                </label>
                <div class="volume-column-header">Volume</div>

                <div class="master-volume item">
                    <div class="name">
                        <font-awesome-icon :icon='["fas", "volume-high"]' class="row-icon" />
                        Master
                    </div>
                    <div class="list-button select-percentage">
                        <input :class="{ 'boost-enabled': allowVolumeBoost }" :style="{ '--fill': `${masterVolume / (allowVolumeBoost ? 2 : 1)}%` }" type="range" min="0"
                            :max="allowVolumeBoost ? 200 : 100" step="1" :value="masterVolume"
                            aria-label="Master volume" :aria-valuetext="`${masterVolume}%`" @input="setMasterVolume($event.target.value)" @pointerup="snapToFull($event.target, setMasterVolume)" />
                        <output>{{ masterVolume }}%</output>
                    </div>
                </div>

                <div class="track item" v-for="track in tracks" :key="track.id" :class="{ active: selectedTrack === track.id }">
                    <button class="name" type="button" :aria-current="selectedTrack === track.id ? 'true' : undefined" @click="changeTrack(track.id)">{{ track.name }}</button>
                    <button class="list-button solo" type="button" @click="toggleSolo(track.id)" :class="{ active: soloTrackID === track.id }" :aria-pressed="soloTrackID === track.id"
                        :disabled="trackControlsUnavailable" :title="trackControlsUnavailable ? 'Not available with YouTube audio' : undefined">
                        <font-awesome-icon :icon='["fas", "headphones"]' />
                        Solo
                    </button>
                    <button class="list-button mute" type="button" @click="toggleMute(track.id)" :class="{ active: muteTrackList[track.id] }" :aria-pressed="!!muteTrackList[track.id]"
                        :disabled="trackControlsUnavailable" :title="trackControlsUnavailable ? 'Not available with YouTube audio' : undefined">
                        <font-awesome-icon :icon='["fas", "volume-xmark"]' />
                        Mute
                    </button>
                    <div class="list-button select-percentage" :class="{ disabled: trackControlsUnavailable || muteTrackList[track.id] }">
                        <input :class="{ 'boost-enabled': allowVolumeBoost }" :style="{ '--fill': `${(trackVolumeList[track.id] ?? masterVolume) / (allowVolumeBoost ? 2 : 1)}%` }" type="range" min="0"
                            :max="allowVolumeBoost ? 200 : 100" step="1" :value="trackVolumeList[track.id] ?? masterVolume"
                            :aria-label="`Volume for ${track.name}`" :aria-valuetext="`${trackVolumeList[track.id] ?? masterVolume}%`"
                            @input="setTrackVolume(track.id, $event.target.value)" @pointerup="snapToFull($event.target, (value) => setTrackVolume(track.id, value))"
                            :disabled="trackControlsUnavailable || muteTrackList[track.id]" />
                        <output>{{ trackVolumeList[track.id] ?? masterVolume }}%</output>
                    </div>
                </div>
            </div>

            <div id="audio-list" class="audio-list list" v-if="showAudioList" ref="audioList" role="group" aria-label="Audio source">
                <div class="list-header">
                    <h2 class="list-title">Audio source</h2>
                    <button class="list-close" type="button" aria-label="Close" @click="showAudioList = false">
                        <font-awesome-icon :icon='["fas", "xmark"]' />
                    </button>
                </div>

                <button class="audio item" type="button" @click="audioSynth" :class='{ active: currentAudio === "synth" }' :aria-current='currentAudio === "synth" ? "true" : undefined'>
                    <span class="name">
                        <font-awesome-icon :icon='["fas", "music"]' class="row-icon" />
                        <span class="row-label">Synth</span>
                        <font-awesome-icon :icon='["fas", "check"]' class="active-check" aria-hidden="true" />
                    </span>
                </button>

                <button class="audio item" type="button" @click="audioBackingTrack" :class='{ active: currentAudio === "backingTrack" }'
                    :aria-current='currentAudio === "backingTrack" ? "true" : undefined'
                    v-if="enableBackingTrack">
                    <span class="name">
                        <font-awesome-icon :icon='["fas", "headphones"]' class="row-icon" />
                        <span class="row-label">Embedded Backing Track</span>
                        <font-awesome-icon :icon='["fas", "check"]' class="active-check" aria-hidden="true" />
                    </span>
                </button>

                <button class="audio item" type="button" @click="audioYoutube(youtube.videoID)" v-for="youtube in youtubeList" :key="youtube.id"
                    :class='{ active: currentAudio === "youtube-" + youtube.videoID }'
                    :aria-current='currentAudio === "youtube-" + youtube.videoID ? "true" : undefined'>
                    <span class="name">
                        <font-awesome-icon :icon='["fab", "youtube"]' class="row-icon youtube" />
                        <span class="row-label">YouTube: {{ youtube.videoID }}</span>
                        <font-awesome-icon :icon='["fas", "check"]' class="active-check" aria-hidden="true" />
                    </span>
                </button>

                <button class="audio item" type="button" @click="audioFile(audio.filename)" v-for="audio in audioList" :key="audio.filename"
                    :class='{ active: currentAudio === "audio-" + audio.filename }'
                    :aria-current='currentAudio === "audio-" + audio.filename ? "true" : undefined'>
                    <span class="name">
                        <font-awesome-icon :icon='["fas", "file"]' class="row-icon" />
                        <span class="row-label">{{ audio.filename }}</span>
                        <font-awesome-icon :icon='["fas", "check"]' class="active-check" aria-hidden="true" />
                    </span>
                </button>

                <!-- No Audio -->
                <button class="audio item" type="button" @click="audioNone" :class='{ active: currentAudio === "none" }' :aria-current='currentAudio === "none" ? "true" : undefined'>
                    <span class="name">
                        <font-awesome-icon :icon='["fas", "volume-xmark"]' class="row-icon" />
                        <span class="row-label">No Audio (Mute)</span>
                        <font-awesome-icon :icon='["fas", "check"]' class="active-check" aria-hidden="true" />
                    </span>
                </button>

                <router-link v-if="isLoggedIn" class="list-add" :to="`/tab/${tab.id}/edit/audio`">
                    <font-awesome-icon :icon='["fas", "plus"]' class="row-icon" />
                    Add YouTube or Audio File…
                </router-link>
            </div>

            <!-- USE v-show, because youtube player is not vue  -->
            <div v-show='currentAudio.startsWith("youtube-") || currentAudio.startsWith("audio-")' class="player-container">
                <!-- Simple sync edit -->
                <div class="sync-offset ps-3 pe-3 p-2" v-if='syncMethod === "simple" && isLoggedIn'>
                    <label for="sync-offset-input">Sync Offset:</label>
                    <input id="sync-offset-input" type="number" class="form-control" min="-100000" max="100000" step="0.1" inputmode="decimal" v-model="simpleSyncSecond" />
                    <span aria-hidden="true">s</span>
                </div>

                <!-- Youtube Player -->
                <div v-show='currentAudio.startsWith("youtube-")' class="youtube-player">
                    <button class="btn btn-secondary" type="button" @click="startYoutubeSyncEdit" v-if='syncMethod === "advanced" && isLoggedIn && !isYoutubeSyncEditing'>
                            <font-awesome-icon :icon='["fas", "gear"]' />
                            Fix Audio Sync
                    </button>
                    <div class="youtube-sync-editor" v-if='syncMethod === "advanced" && isLoggedIn && isYoutubeSyncEditing'>
                        <button class="youtube-sync-close" type="button" aria-label="Close audio sync editor" title="Close audio sync editor" @click="startYoutubeSyncEdit">
                            <font-awesome-icon :icon='["fas", "xmark"]' />
                        </button>
                        <div class="youtube-sync-fields">
                            <label>
                                Bar
                                <input v-model.number="youtubeSyncBarIndex" type="number" min="1" step="1" />
                            </label>
                            <label>
                                Offset (s)
                                <input v-model.number="youtubeSyncOffsetSeconds" type="number" min="0" step="0.001" />
                            </label>
                            <button class="btn btn-primary" type="button" @click="addYoutubeSyncPoint">
                                <font-awesome-icon :icon='["fas", selectedYoutubeSyncBarIndex === null ? "plus" : "pen"]' />
                                {{ youtubeSyncActionLabel }}
                            </button>
                            <button class="btn btn-outline-primary" type="button" @click="captureYoutubeSyncPoint" title="Use the current video time as the offset">
                                Capture &amp; {{ youtubeSyncActionLabel }}
                            </button>
                            <button class="btn btn-danger" type="button" @click="deleteYoutubeSyncPoint" v-if="selectedYoutubeSyncBarIndex !== null">
                                <font-awesome-icon :icon='["fas", "trash-can"]' />
                                Delete
                            </button>
                        </div>
                        <div class="youtube-sync-diagnostics" v-if="youtubeSyncDriftPreview">
                            <span>Expected: {{ youtubeSyncDriftPreview.expectedOffsetSeconds.toFixed(3) }}s</span>
                            <span>Current video: {{ youtubeSyncDriftPreview.currentOffsetSeconds.toFixed(3) }}s</span>
                            <strong
                                :class="{ warning: Math.abs(youtubeSyncDriftPreview.driftSeconds) >= 0.1 }">Drift: {{ youtubeSyncDriftPreview.driftSeconds >= 0 ? "+" : "" }}{{ youtubeSyncDriftPreview.driftSeconds.toFixed(3) }}s</strong>
                            <span class="warning" v-if="youtubeSyncEndWarning">{{ youtubeSyncEndWarning }}</span>
                        </div>
                        <div class="youtube-sync-suggestions" v-if="youtubeSuggestedSyncBars.length">
                            <span>Suggested anchors:</span>
                            <button v-for="barIndex in youtubeSuggestedSyncBars" :key="barIndex" type="button" @click="selectSuggestedYoutubeSyncBar(barIndex)">Bar {{ barIndex + 1 }}</button>
                        </div>
                        <div class="youtube-sync-points" v-if="youtubeSyncPoints.length">
                            <button class="youtube-sync-point" :class="{ active: syncPoint.barIndex === selectedYoutubeSyncBarIndex }" type="button" v-for="syncPoint in youtubeSyncPoints"
                                :key="`${syncPoint.barIndex}:${syncPoint.barOccurence}:${syncPoint.barPosition}`"
                                @click="selectExistingYoutubeSyncPoint(syncPoint)">
                                <span class="youtube-sync-point-marker" aria-hidden="true"></span>
                                Bar {{ syncPoint.barIndex + 1 }}: {{ syncPoint.offsetSeconds.toFixed(3) }}s
                            </button>
                        </div>
                        <button class="btn btn-success youtube-sync-save" type="button" @click="saveYoutubeSyncPoints">Save Sync</button>
                    </div>
                    <div class="youtube-video" :class="{ minimized: isYoutubeVideoMinimized }">
                        <button class="youtube-video-toggle" type="button" :aria-expanded="!isYoutubeVideoMinimized" :title="isYoutubeVideoMinimized ? 'Show video' : 'Minimize video'"
                            @click="isYoutubeVideoMinimized = !isYoutubeVideoMinimized">
                            <font-awesome-icon :icon='["fas", isYoutubeVideoMinimized ? "up-right-and-down-left-from-center" : "down-left-and-up-right-to-center"]' />
                            {{ isYoutubeVideoMinimized ? "Show video" : "Minimize video" }}
                        </button>
                        <div v-show="!isYoutubeVideoMinimized" ref="youtube" class="player"></div>
                    </div>
                </div>

                <!-- Audio Player -->
                <audio ref="audioPlayer" class="player" hidden></audio>
            </div>
        </div>
    </div>
</template>

<style scoped lang="scss">
@use "sass:color";
@use "../styles/vars.scss" as *;

$toolbar-height: 60px;
$youtube-height: 200px;
$handle-height: 24px;
$touch-target: 44px;
$padding: 20px;
$volume-column-width: 207px; // select-percentage cell: 2 * padding + slider + gap + output + border

// Palette (kept local to this page)
$color: #32393e; // panels, lists and chips
$ink: #d6d6d6;
$ink-strong: #fff;
$toolbar-border: #3c3b40;
$panel-dark: #212529;
$field-border: #555b60;
$chip-hover: #41494f;
$popover-bg: #262d35;
$popover-ink: #d9e0e8;
$popover-bg-light: #fff;
$popover-ink-light: #465467;
$notation-ink-dark: #d8d8dc;
$notation-line-dark: #7d7d86;
$notation-ink-light: #465467;
$notation-line-light: #8b95a1;
$warning: #f8d84d;
$marker-selected: #ff9f1a;
$accent-dark: #65d52f;
$accent-light: #1b7a24;
$tick-dark: #aab4bf;
$tick-light: #5d6978;
$slider-track: #5f6b78;
$slider-boost: #f0c674;
$slider-boost-high: #a64040;
$thumb: #f1f4f7;
$thumb-ring: #344253;
$focus-ring-dark: #f1f4f7;
$focus-ring-light: #1b4fd1;
$active-bar: #7aa2ff;
$error-dark: #ffb4a8;
$error-light: #b3261e;
$title-light: #333;
$page-light: #f1f1f1;

@mixin focus-ring($offset: 2px) {
    &:focus-visible {
        outline: 2px solid var(--focus-ring, #{$focus-ring-dark});
        outline-offset: $offset;
    }
}

@mixin button-reset {
    padding: 0;
    margin: 0;
    color: inherit;
    font: inherit;
    text-align: inherit;
    cursor: pointer;
    background: none;
    border: 0;
}

.main {
    --notation-ink: #{$notation-ink-dark};
    --notation-line: #{$notation-line-dark};
    --accent: #{$accent-dark};
    --tick: #{$tick-dark};

    width: 95%;
    color: $ink;
    margin: 0 auto $toolbar-height auto;

    &.light {
        --notation-ink: #{$notation-ink-light};
        --notation-line: #{$notation-line-light};
        --accent: #{$accent-light};
        --tick: #{$tick-light};

        background-color: $page-light;
        padding-top: 30px;

        h1,
        h2 {
            color: $title-light;
        }
    }
}

.yt-margin {
    width: 1px;
    height: $youtube-height !important;
}

// Loading / error state

.load-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 32px 16px;
    text-align: center;

    &.error {
        color: $error-dark;
    }

    .load-detail {
        max-width: 60ch;
        overflow-wrap: anywhere;
        opacity: 0.85;
    }
}

.main.light .load-state {
    color: $title-light;

    &.error {
        color: $error-light;
    }
}

.load-spinner {
    width: 28px;
    height: 28px;
    border: 3px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: tab-spin 0.8s linear infinite;
}

.load-skeleton {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: min(640px, 100%);
    margin-top: 12px;

    i {
        display: block;
        height: 14px;
        background: currentColor;
        border-radius: 4px;
        opacity: 0.15;
        animation: tab-pulse 1.4s ease-in-out infinite;

        &:nth-child(2) {
            width: 80%;
        }

        &:nth-child(3) {
            width: 60%;
        }
    }
}

@keyframes tab-spin {
    to {
        transform: rotate(360deg);
    }
}

@keyframes tab-pulse {
    50% {
        opacity: 0.3;
    }
}

@media (prefers-reduced-motion: reduce) {
    .load-spinner,
    .load-skeleton i {
        animation: none;
    }
}

// Toolbar

.toolbar {
    backdrop-filter: blur(10px);
    border-bottom: 1px solid $toolbar-border;
    position: fixed;
    bottom: 0;
    left: 0;
    width: 100%;
    z-index: 1000;

    .light & {
        background-color: rgba(33, 37, 41, 0.8);
    }

    .toolbar-handle {
        position: absolute;
        bottom: 100%;
        left: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 72px;
        height: $handle-height;
        padding: 0;
        color: $ink-strong;
        cursor: pointer;
        background: rgba($panel-dark, 0.92);
        border: 1px solid $toolbar-border;
        border-bottom: 0;
        border-radius: 8px 8px 0 0;
        transform: translateX(-50%);

        .toolbar-handle-icon.flipped {
            transform: rotate(180deg);
        }

        // Larger invisible touch area
        &::before {
            position: absolute;
            inset: (-$touch-target + $handle-height) -12px 0;
            content: "";
        }

        @include focus-ring(-4px);
    }

    // Auto-hide: only the handle stays visible. Hidden controls are visibility:hidden so
    // they cannot be focused or clicked; the toolbar reveals on hover, keyboard focus on
    // the handle/controls, or by tapping the handle.
    &.auto-hide {
        transition: transform 0.3s;
        transform: translateY(100%);

        .scroll {
            visibility: hidden;
            transition: visibility 0s linear 0.3s;
        }

        &.revealed {
            transform: translateY(0);

            .scroll {
                visibility: visible;
                transition-delay: 0s;
            }
        }

        @media (hover: hover) {
            &:hover {
                transform: translateY(0);

                .scroll {
                    visibility: visible;
                    transition-delay: 0s;
                }
            }
        }
    }

    // Separate rule: unsupported :has() must not invalidate the rules above
    &.auto-hide:has(:focus-visible) {
        transform: translateY(0);

        .scroll {
            visibility: visible;
            transition-delay: 0s;
        }
    }

    // Allow horizontal scroll
    .scroll {
        padding: 8px 15px;
        display: flex;
        align-items: center;
        flex-grow: 4;
        column-gap: 16px;

        .btn-edit {
            flex-grow: 1;
            text-align: right;
        }

        .button,
        .btn {
            height: $touch-target;
            white-space: nowrap;
        }

        .secondary-controls-toggle {
            display: none;
        }

        .secondary-controls {
            display: contents;
        }
    }

    .player-container {
        position: absolute;
        bottom: 100%;
        right: 0;
        display: flex;

        // align bottom
        align-items: flex-end;

        white-space: nowrap;

        .player {
            height: $youtube-height;
        }

        .sync-offset {
            color: $ink-strong;
            display: flex;
            align-items: center;
            gap: 6px;
            background-color: $dark1;

            input {
                width: 110px;
                height: $touch-target;
                margin: 0;
                background-color: $color;
                border: 1px solid $field-border;
                color: $ink-strong;
            }
        }

        .youtube-sync-editor {
            position: relative;
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 8px;
            box-sizing: border-box;
            width: min(560px, calc(100vw - 352px));
            min-height: 180px;
            max-height: calc(100vh - 120px);
            max-height: calc(100dvh - 120px);
            padding: 8px 56px 8px 8px;
            color: $ink-strong;
            background-color: $dark1;
            overflow-y: auto;
        }

        .youtube-sync-close {
            @include button-reset;
            position: absolute;
            top: 2px;
            right: 2px;
            display: grid;
            place-items: center;
            width: $touch-target;
            height: $touch-target;
            color: $ink-strong;
            border-radius: 4px;

            &:hover {
                background-color: $color;
            }

            @include focus-ring;
        }

        .youtube-sync-fields {
            display: flex;
            align-items: end;
            gap: 8px;

            label {
                display: flex;
                flex-direction: column;
                gap: 2px;
                font-size: 12px;
            }

            input {
                width: 90px;
                height: $touch-target;
                padding: 6px 8px;
                color: $ink-strong;
                font-size: 16px;
                background-color: $color;
                border: 1px solid $field-border;
            }
        }

        .youtube-sync-points {
            display: flex;
            flex-wrap: wrap;
            max-width: 100%;
            gap: 4px;
        }

        .youtube-sync-diagnostics,
        .youtube-sync-suggestions {
            max-width: 100%;
            font-size: 12px;
        }

        .youtube-sync-diagnostics {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;

            .warning {
                color: $warning;
            }
        }

        .youtube-sync-suggestions {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 4px;

            button {
                min-height: $touch-target;
                padding: 2px 12px;
                color: $ink-strong;
                font-size: 12px;
                background: $color;
                border: 1px solid $field-border;
                border-radius: 3px;

                &:hover {
                    background: $chip-hover;
                }

                @include focus-ring;
            }
        }

        .youtube-sync-save {
            align-self: stretch;
            margin-top: auto;
        }

        .youtube-sync-point {
            display: flex;
            flex: 0 0 auto;
            align-items: center;
            gap: 6px;
            min-height: $touch-target;
            padding: 3px 12px;
            color: $ink-strong;
            font-size: 12px;
            background: $color;
            border: 1px solid $field-border;
            border-radius: 3px;

            &:hover {
                background: $chip-hover;
            }

            &.active {
                border-color: $marker-selected;
                box-shadow: inset 0 0 0 1px $marker-selected;
            }

            @include focus-ring;
        }

        .youtube-sync-point-marker {
            width: 4px;
            height: 20px;
            background: $warning;
            border-radius: 2px;
        }

        .youtube-player {
            display: flex;
            align-items: end;

            .youtube-video {
                position: relative;
                display: flex;
                flex-direction: column;
                align-items: flex-end;
            }

            .youtube-video-toggle {
                position: absolute;
                top: 8px;
                left: 8px;
                z-index: 1;
                min-height: $touch-target;
                padding: 5px 12px;
                color: $ink-strong;
                font-size: 13px;
                background: rgb(33 37 41 / 85%);
                border: 1px solid rgb(255 255 255 / 45%);
                border-radius: 4px;

                @include focus-ring;
            }

            .youtube-video.minimized {
                width: 320px;
                height: $touch-target + 16px;
                background: $panel-dark;
            }
        }
    }
}

@media (max-width: 1280px) {
    .toolbar {
        .scroll {
            position: static;

            > .btn {
                flex-shrink: 0;
            }

            overflow: visible;
            justify-content: flex-start;
            gap: 8px;

            .track-selector,
            .audio-selector {
                flex: 0 1 180px;
                min-width: 0;

                .button {
                    width: 100%;
                    max-width: 180px;
                }
            }

            .secondary-controls {
                position: absolute;
                right: 0;
                bottom: 100%;
                left: 0;
                display: none;
                flex-wrap: wrap;
                gap: 8px;
                padding: 12px 16px;
                background: $panel-dark;
                border-top: 1px solid $toolbar-border;
                box-shadow: 0 -8px 16px rgb(0 0 0 / 18%);

                &.open {
                    display: flex;
                }
            }

            // Edit stays visible, pushed right next to the More toggle
            .btn-edit {
                flex-grow: 0;
                margin-left: auto;
            }

            .secondary-controls-toggle {
                display: inline-flex;
                justify-content: center;
                min-width: $touch-target;
                align-items: center;
                gap: 6px;
            }
        }
    }
}

// Tablet: keep Speed and Zoom inline (compact), the rest stays behind More
@media (min-width: 701px) and (max-width: 1280px) {
    .toolbar .scroll {
        .secondary-controls,
        .secondary-controls.open {
            position: static;
            display: contents;
            padding: 0;
            background: none;
            border: 0;
            box-shadow: none;
        }

        .extra-controls {
            position: absolute;
            right: 0;
            bottom: 100%;
            left: 0;
            display: none;
            flex-wrap: wrap;
            gap: 8px;
            padding: 12px 16px;
            background: $panel-dark;
            border-top: 1px solid $toolbar-border;
            box-shadow: 0 -8px 16px rgb(0 0 0 / 18%);
        }

        .secondary-controls.open .extra-controls {
            display: flex;
        }

        .track-selector,
        .audio-selector {
            flex-basis: 150px;
        }

        .speed-selector > .btn {
            min-width: 0;
            padding-inline: 10px;

            .prefix {
                display: none;
            }
        }

        .zoom-selector {
            gap: 2px;

            .btn {
                min-width: 36px;
                padding-inline: 6px;
            }

            .zoom-value {
                min-width: 0;

                .prefix {
                    display: none;
                }
            }
        }
    }
}

@media (max-width: 900px) {
    .toolbar .scroll .btn-edit .label,
    .toolbar .scroll .restart-button .label {
        display: none;
    }
}

// Phone: icon-only selectors sized to their content
@media (max-width: 700px) {
    .toolbar .scroll {
        .track-selector,
        .audio-selector {
            flex: 0 0 auto;

            .button {
                width: auto;
                min-width: $touch-target;
                justify-content: center;
                padding-inline: 12px;

                .label,
                .caret {
                    display: none;
                }
            }
        }
    }
}

.score-container {
    position: relative;
}

.youtube-sync-tab-markers {
    position: absolute;
    inset: 0;
    pointer-events: none;
}

.youtube-sync-tab-marker {
    position: absolute;
    z-index: 1;
    width: 4px;
    background: $warning;
    border-radius: 2px;
    transform: translateX(-2px);

    &.selected {
        width: 6px;
        background: $marker-selected;
        box-shadow: 0 0 8px $marker-selected;
        transform: translateX(-3px);
    }
}

h1 {
    text-align: center;
    font-size: 45px;
    font-weight: 300;
    line-height: 1.15;
    word-break: break-word;
}

.artist-row {
    display: grid;
    align-items: center;
    grid-template-columns: minmax(min-content, 1fr) minmax(0, auto) minmax(min-content, 1fr);

    h2 {
        grid-column: 2;
        grid-row: 1;
        overflow-wrap: anywhere;
    }

    .key-signature {
        grid-column: 1;
        grid-row: 1;
        justify-self: start;
    }

    .drum-notation-selector {
        grid-column: 3;
        grid-row: 1;
        justify-self: start;
        margin-left: 12px;

        > .btn {
            min-height: $touch-target;
            border-radius: 999px;
        }
    }
}

h2 {
    text-align: center;
    margin-bottom: 0;
}

.selector {
    position: relative;

    .button {
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        max-width: 280px;
        padding: 10px 15px;
        border-radius: 3px;
        background-color: $color;
        color: inherit;
        border: 0;
        user-select: none;
        transition: background-color 0.2s;
        white-space: nowrap;

        // Truncate the label, keep icons visible
        > span {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        > svg {
            flex-shrink: 0;
        }

        &:hover {
            background-color: color.adjust($color, $lightness: 10%);
        }

        @include focus-ring;
    }
}

.list {
    position: absolute;
    background-color: $color;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
    backdrop-filter: blur(10px);
    border-radius: 3px;
    bottom: $toolbar-height;
    left: 15px;
    min-width: min(400px, 100%);
    max-width: 100%;
    overflow: auto;
    max-height: calc(100vh - 90px);
    max-height: calc(100dvh - 90px);

    // TODO: No matter how big it is, the tab cursor (z-index: 1000) is always on top of it for unknown reason.
    z-index: 1;

    .list-title {
        margin: 0 auto 0 8px;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        opacity: 0.7;
    }

    .list-add {
        display: flex;
        align-items: center;
        min-height: $touch-target;
        padding: $padding;
        font-weight: 600;
        text-decoration: none;

        &:hover {
            background-color: color.adjust($color, $lightness: 4%);
        }

        .row-icon {
            width: 24px;
            margin-right: 12px;
        }

        @include focus-ring(-3px);
    }

    .item .name {
        display: flex;
        align-items: center;
        min-height: $touch-target;

        .row-icon {
            flex-shrink: 0;
            width: 24px;
            margin-right: 12px;
            text-align: center;
            opacity: 0.85;

            &.youtube {
                color: #ff4e45;
                opacity: 1;
            }
        }

        .row-label {
            min-width: 0;
            overflow-wrap: anywhere;
        }

        .active-check {
            display: none;
            flex-shrink: 0;
            margin-left: auto;
            padding-left: 12px;
            color: $active-bar;
        }
    }

    .item.active .name .active-check {
        display: block;
    }

    .list-header {
        position: sticky;
        top: 0;
        z-index: 1;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        padding: 4px 8px;
        background-color: $color;
        border-bottom: 1px solid color.adjust($color, $lightness: -5%);
    }

    .list-close {
        @include button-reset;
        display: grid;
        place-items: center;
        width: $touch-target;
        height: $touch-target;
        border-radius: 4px;

        &:hover {
            color: $ink-strong;
            background-color: color.adjust($color, $lightness: 8%);
        }

        @include focus-ring;
    }

    .item {
        cursor: pointer;
        display: flex;
        align-items: center;
        border-bottom: 1px solid color.adjust($color, $lightness: -5%);

        &.active {
            background-color: color.adjust($color, $lightness: 8%);
            box-shadow: inset 4px 0 0 $active-bar;
        }

        .name {
            flex-grow: 1;
            font-weight: bold;
            padding: $padding;
            height: 100%;
            border-right: 1px solid color.adjust($color, $lightness: -5%);
        }

        button.name {
            @include button-reset;
            align-self: stretch;
            min-width: 0;
            padding: $padding;
            font-weight: bold;
            overflow-wrap: anywhere;

            @include focus-ring(-3px);
        }

        .name:hover,
        &:hover > .name {
            background-color: color.adjust($color, $lightness: 2%);
        }
    }

    // Audio rows are real buttons
    button.item {
        @include button-reset;
        width: 100%;
        border-bottom: 1px solid color.adjust($color, $lightness: -5%);

        @include focus-ring(-3px);
    }
}

.track-list {
    .boost-text {
        display: flex;
        flex-direction: column;
        gap: 2px;

        strong {
            font-weight: 600;
        }

        small {
            opacity: 0.65;
        }
    }

    .item .name .row-icon {
        flex-shrink: 0;
        width: 24px;
        margin-right: 10px;
        text-align: center;
        opacity: 0.85;
    }

    .master-volume .name {
        display: flex;
        align-items: center;
    }

    .volume-boost-toggle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-height: $touch-target;
        padding: $padding;
        font-size: 13px;
        background-color: color.adjust($color, $lightness: 5%);
        border-bottom: 1px solid color.adjust($color, $lightness: -5%);
        cursor: pointer;
    }

    .volume-boost-switch {
        position: relative;
        display: inline-block;
        flex-shrink: 0;
        width: 36px;
        height: 20px;

        input {
            position: absolute;
            width: 100%;
            height: 100%;
            margin: 0;
            opacity: 0;
            cursor: pointer;

            &:checked + span {
                background-color: $primary;

                &::after {
                    transform: translate(16px, 10%);
                }
            }

            &:focus-visible + span {
                outline: 2px solid $focus-ring-dark;
                outline-offset: 2px;
            }
        }

        > span {
            display: block;
            height: 100%;
            background-color: color.adjust($color, $lightness: -15%);
            border-radius: 999px;
            pointer-events: none;

            &::after {
                display: block;
                width: 16px;
                height: 16px;
                margin: 2px;
                content: "";
                transform: translate(0px, 10%);
                background-color: $thumb;
                border-radius: 50%;
                transition: transform 0.2s;
            }
        }
    }

    .volume-column-header {
        width: $volume-column-width;
        padding: 8px $padding;
        margin-left: auto;
        font-size: 12px;
        font-weight: bold;
        text-align: center;
        border-bottom: 1px solid color.adjust($color, $lightness: -5%);
    }

    .track,
    .master-volume {
        .list-button {
            background-color: color.adjust($color, $lightness: 10%);
            border-right: 1px solid color.adjust($color, $lightness: -5%);
            padding: $padding;
            height: 100%;

            &.solo,
            &.mute {
                color: inherit;
                font: inherit;
                border-top: 0;
                border-bottom: 0;
                border-left: 0;
                cursor: pointer;

                @include focus-ring(-3px);
            }

            &.select-percentage {
                flex: 0 0 $volume-column-width;
                padding-top: 6px;
                padding-bottom: 6px;
            }

            &.solo:hover:not(:disabled),
            &.mute:hover:not(:disabled) {
                background-color: color.adjust($color, $lightness: 18%);
            }

            // Solo = amber, Mute = red, so the state reads at a glance
            &.solo.active {
                color: #1f1f1f;
                background-color: #f0b429;
            }

            &.mute.active {
                color: #fff;
                background-color: #c9444d;
            }

            &:disabled,
            &.disabled {
                cursor: not-allowed;
                opacity: .5;
            }
        }
    }
}

// Narrow screens: stack each track row (name on its own line, controls below)
@media (max-width: 600px) {
    .track-list {
        .volume-column-header {
            display: none;
        }

        .track,
        .master-volume {
            flex-wrap: wrap;

            .name {
                flex: 1 0 100%;
                border-right: 0;
                border-bottom: 1px solid color.adjust($color, $lightness: -5%);
            }

            .list-button {
                &.solo,
                &.mute {
                    flex: 0 0 auto;
                    min-height: $touch-target;
                    padding: 10px 16px;
                }

                &.select-percentage {
                    flex: 1 1 0;
                    min-width: 0;
                    padding-right: 12px;
                    padding-left: 12px;

                    input {
                        flex: 1 1 auto;
                        width: auto;
                        min-width: 60px;
                    }
                }
            }
        }

        .master-volume .select-percentage {
            border-right: 0;
        }
    }
}

.drum-notation-selector {
    position: relative;
}

.main.light .artist-row .drum-notation-selector > .btn {
    --bs-btn-color: #{$popover-ink-light};
    --bs-btn-border-color: #{$notation-line-light};

    color: $popover-ink-light;
}

.drum-notation-tooltip {
    --focus-ring: #{$focus-ring-dark};

    position: absolute;
    top: calc(100% + 10px);
    right: 0;
    z-index: 2;
    width: min(650px, calc(100vw - 32px));
    padding: 14px 20px 20px;
    color: var(--notation-ink);
    background: $popover-bg;
    border-radius: 8px 8px 0 0;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}

.main.light .drum-notation-tooltip {
    --focus-ring: #{$focus-ring-light};

    background: $popover-bg-light;
}

.drum-notation-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 7px;
    border-bottom: 1px solid var(--notation-ink);
}

.drum-notation-title {
    display: block;
    font-size: 12px;
    letter-spacing: 1px;
}

.notation-close {
    @include button-reset;
    display: grid;
    place-items: center;
    width: $touch-target;
    height: $touch-target;
    margin: -14px -14px -14px 0;
    border-radius: 4px;

    @include focus-ring;
}

.drum-notation-groups {
    display: grid;
    grid-template-columns: 1fr 1fr 2.2fr 2.2fr 1fr 1fr;
    gap: 20px;
    margin-top: 7px;
}

.drum-notation-group {
    position: relative;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    align-items: start;
    min-width: 0;
    padding-top: 20px;
    background: repeating-linear-gradient(to bottom, transparent 0 10px, var(--notation-line) 10px 11px);
    background-position: 0 42px;
    background-repeat: no-repeat;
    background-size: 100% 56px;

    > span {
        position: absolute;
        top: 0;
        left: 50%;
        width: max-content;
        transform: translateX(-50%);
        font-size: 13px;
    }

    > small {
        position: relative;
        height: 22px;
        font-size: 11px;
        text-align: center;
    }

    svg {
        display: block;
        width: 28px;
        height: 60px;
        justify-self: center;
        overflow: visible;
        fill: var(--notation-ink);
        stroke: var(--notation-ink);
        stroke-width: 1.2;
    }

    .drum-note {
        stroke: none;
    }
    .drum-glyph {
        fill: none;
    }
    .drum-ledger {
        fill: none;
        stroke-width: 1;
    }
}

.drum-notation-group.bass,
.drum-notation-group.snare,
.drum-notation-group.ride,
.drum-notation-group.crash {
    grid-template-columns: 1fr;
}
.drum-notation-group.hihat,
.drum-notation-group.tom {
    grid-template-columns: repeat(3, 1fr);
}

// Narrow screens: centered dialog with a dimmed backdrop and a 2-column key
@media (max-width: 700px) {
    .drum-notation-tooltip {
        position: fixed;
        top: 50%;
        right: auto;
        left: 50%;
        z-index: 1100;
        box-sizing: border-box;
        width: min(650px, calc(100vw - 24px));
        max-height: calc(100vh - 24px);
        max-height: calc(100dvh - 24px);
        overflow-y: auto;
        border-radius: 8px;
        box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.5), 0 8px 24px rgba(0, 0, 0, 0.3);
        transform: translate(-50%, -50%);
    }

    .drum-notation-groups {
        grid-template-columns: repeat(2, 1fr);
        row-gap: 24px;
    }

    .drum-notation-group.hihat,
    .drum-notation-group.tom {
        grid-column: 1 / -1;
    }
}

.select-percentage {
    display: flex;
    align-items: center;
    gap: 4px;

    input {
        width: 120px;
        height: $touch-target;
        margin: 0;
        appearance: none;
        cursor: pointer;
        background: transparent;

        &::-webkit-slider-runnable-track {
            height: 6px;
            background: linear-gradient(to right, $primary-text-dark var(--fill, 0%), $slider-track var(--fill, 0%));
            border-radius: 999px;
        }

        &::-moz-range-track {
            height: 6px;
            background: linear-gradient(to right, $primary-text-dark var(--fill, 0%), $slider-track var(--fill, 0%));
            border-radius: 999px;
        }

        &.boost-enabled::-webkit-slider-runnable-track {
            background: linear-gradient(to right, $slider-track 0 49%, $slider-boost 49% 51%, $slider-boost-high 51% 100%);
        }

        &.boost-enabled::-moz-range-track {
            background: linear-gradient(to right, $slider-track 0 49%, $slider-boost 49% 51%, $slider-boost-high 51% 100%);
        }

        &::-webkit-slider-thumb {
            width: 24px;
            height: 24px;
            margin-top: -9px;
            appearance: none;
            cursor: grab;
            background: $thumb;
            border: 2px solid $color;
            border-radius: 50%;
        }

        &::-moz-range-thumb {
            width: 20px;
            height: 20px;
            cursor: grab;
            background: $thumb;
            border: 2px solid $color;
            border-radius: 50%;
        }

        @include focus-ring(0);

        &:disabled {
            cursor: not-allowed;
            opacity: .45;
        }
    }

    output {
        min-width: 42px;
        text-align: right;
    }
}

.speed-selector {
    position: relative;

    > .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-width: 180px;
        max-width: 100%;

        .label {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        > svg {
            flex-shrink: 0;
        }
    }
}

.zoom-selector {
    display: flex;
    align-items: center;
    gap: 8px;

    .zoom-value {
        min-width: 76px;
        text-align: center;
    }
}

.toolbar .extra-controls {
    display: contents;
}

.speed-selector-popover {
    --focus-ring: #{$focus-ring-dark};

    position: absolute;
    bottom: calc(100% + 10px);
    left: 50%;
    z-index: 2;
    box-sizing: border-box;
    width: 420px;
    padding: 12px 18px 22px;
    color: $popover-ink;
    background: $popover-bg;
    box-shadow: 0 12px 28px rgba(32, 46, 62, 0.14);
    border-radius: 6px;
    transform: translateX(-50%);
}

.main.light .speed-selector-popover {
    --focus-ring: #{$focus-ring-light};

    color: $popover-ink-light;
    background: $popover-bg-light;
    box-shadow: 0 12px 28px rgba(32, 46, 62, 0.28);
}

.speed-selector-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding-bottom: 10px;
    border-bottom: 1px solid currentColor;

    .speed-selector-bpm {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .speed-selector-bpm button {
        @include button-reset;
        min-width: $touch-target;
        min-height: $touch-target;
        font-size: 24px;
        line-height: 1;
        border-radius: 4px;

        &:hover {
            color: var(--accent);
        }

        @include focus-ring;
    }

    .speed-selector-bpm input {
        width: 64px;
        height: $touch-target;
        padding: 0;
        color: inherit;
        text-align: center;
        background: transparent;
        border: 0;
        font-size: 16px;

        @include focus-ring(-2px);
    }

    .speed-reset {
        display: flex;
        align-items: center;
        gap: 5px;
        min-height: $touch-target;
        padding: 2px 10px;
        color: inherit;
        background: transparent;
        border: 0;
        border-radius: 4px;

        &:hover:not(:disabled) {
            color: var(--accent);
        }

        &:disabled {
            opacity: .45;
        }

        @include focus-ring;
    }
}

.speed-scale {
    position: relative;
    height: 105px;
    margin-top: 24px;
    margin-right: 36px;
    margin-left: 12px;

    &::after {
        position: absolute;
        right: 0;
        bottom: 16px;
        left: 0;
        height: 1px;
        content: "";
        background: currentColor;
    }

    input[type="range"] {
        position: absolute;
        right: 0;
        bottom: 7px;
        left: 0;
        z-index: 2;
        width: 100%;
        margin: 0;
        appearance: none;
        background: transparent;

        &::-webkit-slider-runnable-track {
            height: 18px;
            background: transparent;
        }

        &::-webkit-slider-thumb {
            width: 28px;
            height: 28px;
            margin-top: -5px;
            appearance: none;
            background: var(--accent);
            border: 8px solid $thumb-ring;
            border-radius: 50%;
            box-shadow: 0 3px 8px rgba(25, 35, 48, 0.3);
        }

        &::-moz-range-track {
            height: 18px;
            background: transparent;
        }

        &::-moz-range-thumb {
            width: 12px;
            height: 12px;
            background: var(--accent);
            border: 8px solid $thumb-ring;
            border-radius: 50%;
        }

        @include focus-ring(4px);
    }
}

.speed-ticks {
    position: absolute;
    right: 0;
    bottom: 16px;
    left: 0;
    display: flex;
    justify-content: space-between;
    height: 12px;
    pointer-events: none;

    i {
        width: 1px;
        height: 8px;
        background: var(--tick);

        &.major {
            height: 16px;
        }
    }
}

.speed-mark {
    @include button-reset;
    position: absolute;
    z-index: 3;
    bottom: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: $touch-target;
    height: $touch-target;
    color: color-mix(in srgb, currentColor 82%, transparent);
    font-size: 20px;
    transform: translateX(-50%);

    &:hover,
    &.active {
        color: var(--accent);
        font-weight: 700;
    }

    @include focus-ring(-4px);

    &:focus-visible {
        color: var(--accent);
        font-weight: 700;
    }
}

.speed-unit {
    position: absolute;
    right: -27px;
    bottom: 47px;
    font-size: 18px;
    font-weight: 700;
    color: var(--accent);
}

.mobile {
    h1 {
        font-size: 20px;
        line-height: 1.2;
    }

    h2 {
        font-size: 16px;
    }

    .list {
        width: 100%;
        left: 0;
    }

    .toolbar {
        .scroll {
            overflow-x: scroll;
        }

        .player-container {
            // Stack the sync offset input above the video/editor instead of hiding it
            flex-direction: column;
            align-items: stretch;

            .sync-offset {
                justify-content: space-between;
            }

            .youtube-sync-fields {
                flex-wrap: wrap;
            }

            .youtube-sync-editor {
                height: auto;
                min-height: 180px;
                width: calc(100vw - 32px);
            }

            .youtube-player {
                flex-direction: column;
                align-items: stretch;
            }
        }
    }

    .speed-mark {
        font-size: 16px;
    }

    .speed-selector {
        width: min(420px, calc(100vw - 32px));

        .speed-selector-popover {
            right: auto;
            left: 0;
            width: 100%;
            transform: none;
        }
    }

    .drum-notation-selector > .btn {
        width: 48px;
        padding-right: 0;
        padding-left: 0;

        .drum-notation-label {
            display: none;
        }
    }
}

.key-signature {
    margin-left: 0;
}
</style>
