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

const alphaTab = await import("@coderline/alphatab");
const { ScrollMode, StaveProfile } = alphaTab;

const speedActionBuffer = new ActionBuffer(1000);
const syncOffsetYoutubeActionBuffer = new ActionBuffer(200);
const syncOffsetAudioActionBuffer = new ActionBuffer(200);

export default defineComponent({
    /**
     * @type {alphaTab.AlphaTabApi}
     */
    api: null,

    audioHandler: null,

    alphaTabYoutubeHandler: null,

    youtubePlayer: null,

    components: { FontAwesomeIcon, BDropdownDivider, BDropdownItem, BDropdown, TextTabPlayer },
    emits: ["setFixedHeader"],
    data() {
        return {
            isLoggedIn: false,
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
            currentAudio: "synth",
            youtubeList: [],
            audioList: [],
            audio: {},
            scrollMode: ScrollMode.Continuous,
            keySignature: "",
            playbackRange: null,

            keyEvents: (e) => {
                // Do not handle these tagName, because the only input is sync point, it is weird when play space to test the sync point
                // It will type a space in the input instead of playing the music
                // element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable

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

        audioSelectionLabel() {
            if (this.currentAudio === "synth") return "Synth";
            if (this.currentAudio === "none") return "Mute";
            if (this.currentAudio === "backingTrack") return "Backing Track";
            if (this.currentAudio.startsWith("youtube-")) return "Youtube";
            if (this.currentAudio.startsWith("audio-")) return "Audio";
            return "Audio";
        },
    },

    watch: {
        simpleSyncSecond(newVal, oldVal) {
            if (!this.api) {
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
                this.api.play();
                requestWakeLock();
            } else {
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

            // Show the bar cursor if enabled
            if (this.setting.cursor === "bar") {
                const barCursor = document.querySelector(".at-cursor-bar");
                if (barCursor) {
                    barCursor.classList.add("enable");
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
            if (this.enableMetronome) {
                this.api.metronomeVolume = 1;
            } else {
                this.api.metronomeVolume = 0;
            }
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

            if (this.currentAudio === "synth") {
                await this.initSynth();
            } else if (this.currentAudio === "backingTrack") {
                this.api.settings.player.playerMode = alphaTab.PlayerMode.EnabledBackingTrack;
                this.api.updateSettings();
                this.pause();
            } else if (this.currentAudio.startsWith("youtube-")) {
                const videoID = this.currentAudio.substring(8);
                await this.initYoutube(videoID);
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
                notify({
                    type: "error",
                    title: "Error",
                    text: "Unknown audio source, fallback to synth.",
                });
                return;
            }

            this.setConfig("audio", this.currentAudio);
        },
    },

    // Mounted
    async mounted() {
        this.isLoggedIn = await isLoggedIn();
        this.setting = getSetting();
        this.toolbarHidden = this.setting.toolbarAutoHide;
        this.tabID = this.$route.params.id;
        this.tabScale = this.getConfig("scale", this.setting.scale);
        const urlParams = new URLSearchParams(window.location.search);

        try {
            const metadata = await fetch(baseURL + `/api/tab/${this.tabID}`, { credentials: "include" }).then((res) => res.json());
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
            await this.load(trackID);

            window.addEventListener("keydown", this.keyEvents);

            // Close open lists when clicking outside
            this._onDocumentClick = (e) => {
                try {
                    // Track list
                    if (this.showTrackList) {
                        const sel = this.$refs.trackSelector;
                        const list = this.$refs.trackList;
                        if (!sel.contains(e.target) && !list.contains(e.target)) {
                            this.showTrackList = false;
                        }
                    }

                    // Audio list
                    if (this.showAudioList) {
                        const sel = this.$refs.audioSelector;
                        const list = this.$refs.audioList;
                        if (!sel.contains(e.target) && !list.contains(e.target)) {
                            this.showAudioList = false;
                        }
                    }
                } catch (err) {
                    console.error(err);
                }
            };
            window.addEventListener("click", this._onDocumentClick);
        } catch (e) {
            notify({
                type: "error",
                title: "Error",
                text: e.message,
            });
        }

        console.log("Mounted");
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

        async load(trackID) {
            if (this.api) {
                this.destroyContainer();
            }

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

            const data = await res.json();
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
            this.play();
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
                api.tickPosition = firstBeat.absoluteDisplayStart;
            }

            this.play();
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
                }

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
                        //tracks: [trackID],
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
                    },
                });

                // Exposing api to window for debugging
                window.api = this.api;

                // Used for showing/hiding the "Restart" button
                this.api.playbackRangeChanged.on(() => {
                    this.playbackRange = this.api.playbackRange;
                });

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
                    console.log("Score loaded");

                    applyScoreColors(score, this.setting, alphaTab);

                    // Track
                    if (trackID < 0 || trackID >= score.tracks.length) {
                        trackID = 0;
                    }
                    this.api.renderTracks([this.api.score.tracks[trackID]]);

                    // Always show tempo automation on the master bar
                    if (api.score.masterBars.length > 0 && api.score.masterBars[0].tempoAutomations.length > 0) {
                        api.score.masterBars[0].tempoAutomations[0].isVisible = true;
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

                    // Looping
                    this.isLooping = this.getConfig("isLooping", false);

                    // Speed
                    this.tempo = score.masterBars[0]?.tempoAutomations[0]?.value ?? 120;
                    this.speed = 100;
                    this.speed = this.getConfig("speed", 100);

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
                        this.tracks.push({
                            id: track.index,
                            name: getInstrumentName(track.playbackInfo.program),
                            program: track.playbackInfo.program,
                        });
                    });

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
                    }
                });
            });
        },

        destroyContainer() {
            this.api?.destroy();
            this.api = undefined;

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
            this.muteTrackList = {};
            this.playbackRange = null;
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

        // Style the score with custom colors
        applyColors(score) {
            let stringColors = {
                1: alphaTab.model.Color.fromJson("#bf3732"),
                2: alphaTab.model.Color.fromJson("#fff800"),
                3: alphaTab.model.Color.fromJson("#0080ff"),
                4: alphaTab.model.Color.fromJson("#e07b39"),
                5: alphaTab.model.Color.fromJson("#2A8E08"),
                6: alphaTab.model.Color.fromJson("#A349A4"),
            };

            if (this.setting.scoreColor === "light") {
                stringColors[2] = alphaTab.model.Color.fromJson("#b5a33a");
            }

            // traverse hierarchy and apply colors as desired
            for (const track of score.tracks) {
                for (const staff of track.staves) {
                    console.log(this.setting.noteColor, staff.stringTuning.tunings.length);

                    // Coloring 5string bass line for louis-bass-v
                    if (this.setting.noteColor === "louis-bass-v" && staff.stringTuning.tunings.length === 5) {
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
                                // on tuplets colors beam and tuplet bracket
                                if (beat.hasTuplet) {
                                    beat.style = new alphaTab.model.BeatStyle();
                                    const color = alphaTab.model.Color.fromJson("#00DD00");
                                    beat.style.colors.set(
                                        alphaTab.model.BeatSubElement.StandardNotationTuplet,
                                        color,
                                    );
                                    beat.style.colors.set(
                                        alphaTab.model.BeatSubElement.StandardNotationBeams,
                                        color,
                                    );
                                }

                                if (this.setting.noteColor !== "none") {
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
        },

        /**
         * Override hidden staves based on Style settings to fix Guitar Pro hidden tabs.
         * ⚠️ This will break drum score
         * - Style "tab": showTablature = true, showStandardNotation = false
         * - Style "score": showTablature = false, showStandardNotation = true
         * - Style "score-tab": both = true
         */
        overrideHiddenStaves(score) {
            for (const track of score.tracks) {
                for (const staff of track.staves) {
                    // Override visibility flags based on user's Style setting
                    if (this.setting.scoreStyle === "tab" || this.setting.scoreStyle === "horizontal-tab") {
                        staff.showTablature = true;
                        staff.showStandardNotation = false;
                    } else if (this.setting.scoreStyle === "score") {
                        staff.showTablature = false;
                        staff.showStandardNotation = true;
                    } else if (this.setting.scoreStyle === "score-tab") {
                        staff.showTablature = true;
                        staff.showStandardNotation = true;
                    }
                }
            }
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

            this.closeAllList();

            const audioPlayer = this.$refs.audioPlayer;

            // Init the audio handler if not exists
            if (!this.audioHandler) {
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
                        audioPlayer.play();
                    },
                    pause() {
                        audioPlayer.pause();
                    },
                };

                let updateTimer = 0;
                const onTimeUpdate = () => {
                    this.api?.player?.output?.updatePosition(
                        audioPlayer.currentTime * 1000,
                    );
                };

                audioPlayer.addEventListener("timeupdate", onTimeUpdate);
                audioPlayer.addEventListener("seeked", onTimeUpdate);
                audioPlayer.addEventListener("play", () => {
                    window.clearInterval(updateTimer);
                    this.playing = true;
                    this.api?.play();
                    updateTimer = window.setInterval(onTimeUpdate, 50);
                });

                // state updates
                audioPlayer.addEventListener("pause", () => {
                    // If the audio ended, the "pause" event will also be triggered
                    // Ignore this, because we have "ended" event to handle it
                    if (audioPlayer.ended) {
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
                        audioPlayer.play();
                    } else {
                        this.playing = false;
                        this.api.pause();
                        window.clearInterval(updateTimer);
                    }
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

            // Get offset from youtubeList
            for (const audio of this.audioList) {
                if (audio.filename === filename) {
                    this.audio = audio;
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
        },

        async initYoutube(videoID) {
            this.closeAllList();

            if (!this.youtubePlayer) {
                await this.initYoutubePlayer();
            }

            // Bug? If change to EnabledExternalMedia, and this.api.updateSettings(), this sync point can not be applied correctly.
            // So it must change to EnabledSynthesizer first, then change to EnabledExternalMedia
            this.api.settings.player.playerMode = alphaTab.PlayerMode.EnabledSynthesizer;
            this.api.updateSettings();

            let found = false;

            // Get offset from youtubeList
            for (const yt of this.youtubeList) {
                if (yt.videoID === videoID) {
                    this.youtube = yt;
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
            let currentTimeInterval = 0;
            const player = new YT.Player(playerElement, {
                height: "180",
                width: "320",
                //videoId: videoID,
                playerVars: { "autoplay": 0 }, // we do not want autoplay
                events: {
                    "onReady": (e) => {
                        youtubePlayerReady.resolve();
                    },

                    // when the player state changes we update alphatab accordingly.
                    "onStateChange": (e) => {
                        //
                        switch (e.data) {
                            case YT.PlayerState.PLAYING:
                                currentTimeInterval = window.setInterval(() => {
                                    this.api?.player?.output?.updatePosition(player.getCurrentTime() * 1000);
                                }, 50);
                                this.playing = true;
                                this.api?.play();
                                break;
                            case YT.PlayerState.ENDED:
                                window.clearInterval(currentTimeInterval);
                                this.playing = false;
                                this.api?.stop();
                                break;
                            case YT.PlayerState.PAUSED:
                                window.clearInterval(currentTimeInterval);
                                this.playing = false;
                                this.api?.pause();
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
                    },
                },
            });

            await youtubePlayerReady.promise;
            console.log("YouTube Player ready");

            let initialSeek = -1;
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
                    if (initialSeek >= 0) {
                        player.seekTo(initialSeek);
                        initialSeek = -1;
                    }
                },
                pause() {
                    player.pauseVideo();
                },
            };

            this.youtubePlayer = player;
            this.alphaTabYoutubeHandler = alphaTabYoutubeHandler;
            clearTimeout(ytWarning);
        },

        getStaveProfile() {
            if (this.setting.scoreStyle === "tab" || this.setting.scoreStyle === "horizontal-tab") {
                return StaveProfile.Tab;
            } else if (this.setting.scoreStyle === "score") {
                return StaveProfile.Score;
            } else if (this.setting.scoreStyle === "score-tab") {
                return StaveProfile.ScoreTab;
            } else {
                return StaveProfile.Default;
            }
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

        toggleVolume(trackID, volume) {
            if (!this.api) {
                return;
            }
            const track = this.api.score.tracks.find(({ index }) => index === trackID);
            this.api.changeTrackVolume(track, volume / 100);
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
            } catch (e) {
                generalError(e);
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
    <div v-else class="main" :class='{ "light": this.setting.scoreColor === "light" }'>
        <h1>{{ tab.title }}</h1>
        <h2>{{ tab.artist }}</h2>
        <div class="key-signature badge bg-secondary" v-if="keySignature && setting.showKeySignature">
            {{ keySignature }}
        </div>
        <div ref="bassTabContainer" v-pre></div>

        <!-- Just add a margin, don't let youtube player overlay the tab -->
        <div :class='{ "yt-margin": currentAudio.startsWith(`youtube-`) }'></div>

        <div class="toolbar" :class='{ "auto-hide": setting.toolbarAutoHide }'>
            <div class="scroll">
                <div class="track-selector selector" ref="trackSelector">
                    <button class="button" type="button" @click='showList("track")' :aria-expanded="showTrackList">
                        <font-awesome-icon :icon='["fas", "music"]' />
                        <span v-if="tracks.length > 0">Tracks: {{ tracks[selectedTrack].name }}</span>
                        <span v-else>Loading...</span>
                        <font-awesome-icon :icon='["fas", "caret-down"]' />
                    </button>
                </div>

                <div class="drum-notation-selector" v-if="isDrum()">
                    <button class="btn btn-secondary" type="button" @click="showDrumNotation = !showDrumNotation" :aria-expanded="showDrumNotation">
                        <font-awesome-icon :icon='["fas", "drum"]' />
                        Notation
                    </button>
                    <div class="drum-notation-tooltip" v-if="showDrumNotation">
                        <strong class="drum-notation-title">DRUMSET</strong>
                        <div class="drum-notation-groups">
                            <div class="drum-notation-group bass">
                                <span>Bass drum</span><small>Normal</small><svg viewBox="0 0 28 60"><path class="drum-note" d="M20 38c1 2-1 4-4 5s-6 1-7-1c-1-2 1-4 4-5s6-1 7 1Z" /></svg>
                            </div>
                            <div class="drum-notation-group snare">
                                <span>Snare</span><small>Normal</small><svg viewBox="0 0 28 60"><path class="drum-note" d="M20 26c1 2-1 4-4 5s-6 1-7-1c-1-2 1-4 4-5s6-1 7 1Z" /></svg>
                            </div>
                            <div class="drum-notation-group hihat">
                                <span>Hi Hat</span><small>Closed</small><small>Open</small><small>Foot</small><svg viewBox="0 0 28 60"><path class="drum-glyph" d="m14 1-4-4 1-1 4 4 4-4 1 1-4 4 4 4-1 1-4-4-4 4-1-1z" /></svg><svg viewBox="0 0 28 60"><circle class="drum-glyph" cx="14" cy="1" r="6" /><path class="drum-glyph" d="m10-3 8 8m0-8-8 8" /></svg><svg viewBox="0 0 28 60"><path class="drum-glyph" d="m14 55-4-4 1-1 4 4 4-4 1 1-4 4 4 4-1 1-4-4-4 4-1-1z" /></svg>
                            </div>
                            <div class="drum-notation-group tom">
                                <span>Tom</span><small>Floor</small><small>Very low</small><small>High</small><svg viewBox="0 0 28 60"><path class="drum-note" d="M20 32c1 2-1 4-4 5s-6 1-7-1c-1-2 1-4 4-5s6-1 7 1Z" /></svg><svg viewBox="0 0 28 60"><path class="drum-note" d="M20 32c1 2-1 4-4 5s-6 1-7-1c-1-2 1-4 4-5s6-1 7 1Z" /></svg><svg viewBox="0 0 28 60"><path class="drum-note" d="M20 8c1 2-1 4-4 5s-6 1-7-1c-1-2 1-4 4-5s6-1 7 1Z" /></svg>
                            </div>
                            <div class="drum-notation-group crash">
                                <span>Crash</span><small>High</small><svg viewBox="0 0 28 60"><path class="drum-ledger" d="M6-11h16" /><path class="drum-glyph" d="m14-11-5-4 2-2 4 4 4-4 2 2-5 4 5 4-2 2-4-4-4 4-2-2z" /></svg>
                            </div>
                            <div class="drum-notation-group ride">
                                <span>Ride</span><small>Cymbal</small><svg viewBox="0 0 28 60"><path class="drum-glyph" d="m14 7-4-4 1-1 4 4 4-4 1 1-4 4 4 4-1 1-4-4-4 4-1-1z" /></svg>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="audio-selector selector" ref="audioSelector">
                    <button class="button" type="button" @click='showList("audio")' :aria-expanded="showAudioList">
                        <font-awesome-icon :icon='["fas", "volume-high"]' />
                        {{ audioSelectionLabel }}
                        <font-awesome-icon :icon='["fas", "caret-down"]' />
                    </button>
                </div>

                <button class="btn btn-warning" @click="playFromHighlightedRange()" v-if="playbackRange">
                    <font-awesome-icon :icon='["fas", "play"]' />
                    Restart
                </button>

                <button class="btn btn-primary" @click="playPause" :class="{ active: playing }">
                    <span v-if="!playing">
                        <font-awesome-icon :icon='["fas", "play"]' />
                        Play
                    </span>
                    <span v-else>
                        <font-awesome-icon :icon='["fas", "pause"]' />
                        Pause
                    </span>
                </button>
                <button class="btn btn-secondary" @click="loop()" :class="{ active: isLooping }">
                    <font-awesome-icon :icon='["fas", "check"]' v-if="isLooping" />
                    <font-awesome-icon :icon='["fas", "repeat"]' v-else />
                    Loop
                </button>
                <button class="btn btn-secondary" @click="countIn()" :class='{ active: enableCountIn, disabled: currentAudio !== "synth" }'>
                    <font-awesome-icon :icon='["fas", "check"]' v-if="enableCountIn" />
                    <font-awesome-icon :icon='["fas", "list-ol"]' v-else />
                    Count in
                </button>
                <button class="btn btn-secondary" @click="metronome()" :class='{ active: enableMetronome, disabled: currentAudio !== "synth" }'>
                    <font-awesome-icon :icon='["fas", "check"]' v-if="enableMetronome" />
                    <font-awesome-icon :icon='["fas", "stopwatch"]' v-else />
                    Metronome
                </button>

                <div class="speed-selector">
                    <button class="btn btn-secondary" type="button" @click="showSpeedSelector = !showSpeedSelector" :aria-expanded="showSpeedSelector">
                        <font-awesome-icon :icon='["fas", "gauge-high"]' />
                        Speed: {{ bpm }} BPM
                    </button>
                    <div class="speed-selector-popover" v-if="showSpeedSelector">
                        <div class="speed-selector-header">
                            <button type="button" aria-label="Decrease tempo" @click="adjustBpm(-1)">−</button>
                            <label class="visually-hidden" for="bpm-input">BPM</label>
                            <input id="bpm-input" :value="bpm" type="number" :min="tempo * 0.2" :max="tempo * 2" step="0.01" inputmode="decimal" aria-label="BPM"
                                @change="setBpm($event.target.value)" />
                            <span>BPM</span>
                            <button type="button" aria-label="Increase tempo" @click="adjustBpm(1)">+</button>
                        </div>
                        <div class="speed-scale">
                            <span v-for="mark in speedMarks" :key="mark" class="speed-mark" :class="{ active: speed === mark }" :style="{ left: speedMarkPosition(mark) }">{{ mark }}</span>
                            <div class="speed-ticks" aria-hidden="true">
                                <i v-for="tick in 37" :key="tick" :class="{ major: (tick - 1) % 5 === 0 }"></i>
                            </div>
                            <input v-model.number="speed" type="range" min="20" max="200" step="5" aria-label="Playback speed" />
                            <span class="speed-unit">%</span>
                        </div>
                    </div>
                </div>

                <div class="zoom-selector">
                    <button class="btn btn-secondary" type="button" aria-label="Zoom out" :disabled="tabScale <= 0.5" @click="adjustTabScale(-0.1)">
                        <font-awesome-icon :icon='["fas", "magnifying-glass-minus"]' />
                    </button>
                    <span>Zoom {{ Math.round(tabScale * 100) }}%</span>
                    <button class="btn btn-secondary" type="button" aria-label="Zoom in" :disabled="tabScale >= 3" @click="adjustTabScale(0.1)">
                        <font-awesome-icon :icon='["fas", "magnifying-glass-plus"]' />
                    </button>
                </div>

                <div class="btn-edit" v-if="isLoggedIn">
                    <button class="btn btn-secondary" @click="edit()">
                        <font-awesome-icon :icon='["fas", "pen"]' />
                        Edit
                    </button>
                </div>
            </div>

            <div class="track-list list" v-if="showTrackList" ref="trackList">
                <div class="p-2 text-end list-header">
                    <font-awesome-icon :icon='["fas", "xmark"]' class="me-2 close" @click="showTrackList = false" />
                </div>

                <div class="track item" v-for="track in tracks" :key="track.id" :class="{ active: selectedTrack === track.id }">
                    <div class="name" @click="changeTrack(track.id)">{{ track.name }}</div>
                    <div class="list-button solo" @click="toggleSolo(track.id)" :class="{ active: soloTrackID === track.id }">Solo</div>
                    <div class="list-button mute" @click="toggleMute(track.id)" :class="{ active: muteTrackList[track.id] }">Mute</div>
                    <div class="list-button select-percentage">
                        Volume: <input type="number" min="0" max="1000" step="1" value="100" @change="toggleVolume(track.id, $event.target.value)" /> (%)
                    </div>
                </div>
            </div>

            <div class="audio-list list" v-if="showAudioList" ref="audioList">
                <div class="p-2 text-end list-header">
                    <font-awesome-icon :icon='["fas", "xmark"]' class="me-2 close" @click="showAudioList = false" />
                </div>

                <div class="audio item" @click="audioSynth" :class='{ active: currentAudio === "synth" }'>
                    <div class="name">Synth</div>
                </div>

                <div class="audio item" @click="audioBackingTrack" :class='{ active: currentAudio === "backingTrack" }' v-if="enableBackingTrack">
                    <div class="name">Embedded Backing Track</div>
                </div>

                <div class="audio item" @click="audioYoutube(youtube.videoID)" v-for="youtube in youtubeList" :key="youtube.id" :class='{ active: currentAudio === "youtube-" + youtube.videoID }'>
                    <div class="name">Youtube: {{ youtube.videoID }}</div>
                </div>

                <div class="audio item" @click="audioFile(audio.filename)" v-for="audio in audioList" :key="audio.filename" :class='{ active: currentAudio === "audio-" + audio.filename }'>
                    <div class="name">{{ audio.filename }}</div>
                </div>

                <!-- No Audio -->
                <div
                    class="audio item"
                    @click='currentAudio = "none";
                    closeAllList()'
                    :class='{ active: currentAudio === "none" }'
                >
                    <div class="name">No Audio (Mute)</div>
                </div>

                <div class="ms-4 me-4 mt-3 mb-3" v-if="isLoggedIn">
                    <router-link :to="`/tab/${tab.id}/edit/audio`">Add Youtube or Audio File...</router-link>
                </div>
            </div>

            <!-- USE v-show, because youtube player is not vue  -->
            <div v-show='currentAudio.startsWith("youtube-") || currentAudio.startsWith("audio-")' class="player-container">
                <!-- Simple sync edit -->
                <div class="sync-offset ps-3 pe-3 p-2" v-if='syncMethod === "simple" && isLoggedIn'>
                    Sync Offset: <input type="number" class="form-control" min="-100000" max="100000" step="0.1" v-model="simpleSyncSecond" /> s
                </div>

                <!-- Youtube Player -->
                <div v-show='currentAudio.startsWith("youtube-")'>
                    <div ref="youtube" class="player"></div>
                </div>

                <!-- Audio Player -->
                <audio ref="audioPlayer" class="player" controls v-show='currentAudio.startsWith("audio-")' hidden></audio>
            </div>
        </div>
    </div>
</template>

<style scoped lang="scss">
@use "sass:color";
@use "../styles/vars.scss" as *;

$toolbar-height: 60px;
$youtube-height: 200px;

// Light Score

.main {
    width: 95%;
    color: #d6d6d6;
    margin: 0 auto $toolbar-height auto;

    &.light {
        background-color: #f1f1f1;
        padding-top: 30px;

        h1,
        h2 {
            color: #333;
        }
    }
}

.yt-margin {
    width: 1px;
    height: $youtube-height !important;
}

.toolbar {
    backdrop-filter: blur(10px);
    border-bottom: 1px solid #3c3b40;
    position: fixed;
    bottom: 0;
    left: 0;
    width: 100%;
    z-index: 1000;

    .light & {
        background-color: rgba(33, 37, 41, 0.8);
    }

    &.auto-hide {
        transition: transform 0.3s;
        transform: translateY(calc(100% - 5px));

        &:hover {
            transform: translateY(0);
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
            order: 2;
            text-align: right;
        }

        .button,
        .btn {
            height: 44px;
            white-space: nowrap;
        }

        .btn-secondary {
            &.active {
                //background-color: lighten($primary, 10%);
            }
        }

        .close {
            cursor: pointer;
            &:hover {
                color: white;
            }
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
            height: 180px;
        }

        .sync-offset {
            color: white;
            display: flex;
            align-items: center;
            background-color: $dark1;

            input {
                margin: 0 5px;
                background-color: #32393e;
                border: 1px solid #555b60;
                color: white;
            }
        }
    }
}

.youtube {
    margin-top: 20px;
}

h1 {
    text-align: center;
    font-size: 45px;
    font-weight: 300;
    line-height: 45px;
    word-break: break-word;
}

h2 {
    text-align: center;
    margin-bottom: 0;
}

$color: #32393e;
$padding: 20px;

.selector {
    .button {
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 15px;
        border-radius: 3px;
        background-color: $color;
        color: inherit;
        border: 0;
        user-select: none;
        transition: background-color 0.2s;
        white-space: nowrap;

        &:hover {
            background-color: color.adjust($color, $lightness: 10%);
        }
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
    min-width: 400px;
    overflow: scroll;
    max-height: calc(100vh - 90px);

    // TODO: No matter how big it is, the tab cursor (z-index: 1000) is always on top of it for unknown reason.
    z-index: 1;

    .list-header {
        position: sticky;
        top: 0;
        background-color: $color;
        border-bottom: 1px solid color.adjust($color, $lightness: -5%);
    }

    .item {
        cursor: pointer;
        display: flex;
        align-items: center;
        border-bottom: 1px solid color.adjust($color, $lightness: -5%);

        &.active {
            background-color: color.adjust($color, $lightness: 8%);
        }

        .name {
            flex-grow: 1;
            font-weight: bold;
            padding: $padding;
            height: 100%;
            border-right: 1px solid color.adjust($color, $lightness: -5%);

            &:hover {
                background-color: color.adjust($color, $lightness: 2%);
            }
        }
    }
}

.track-list {
    .track {
        .list-button {
            background-color: color.adjust($color, $lightness: 10%);
            border-right: 1px solid color.adjust($color, $lightness: -5%);
            padding: $padding;
            height: 100%;

            &:hover {
                background-color: color.adjust($primary, $lightness: 5%);
            }

            &.active {
                background-color: color.adjust($primary, $lightness: 8%);
            }
        }
    }
}

.audio-selector {
    position: relative;
}

.track-selector {
    position: relative;
}

.drum-notation-selector {
    position: relative;
    order: 1;
}

.drum-notation-tooltip {
    position: absolute;
    bottom: calc(100% + 10px);
    left: 0;
    z-index: 2;
    width: min(650px, calc(100vw - 32px));
    padding: 14px 20px 20px;
    color: #d8d8dc;
    background: #262d35;
    border-radius: 8px 8px 0 0;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}

.main.light .drum-notation-tooltip {
    color: #465467;
    background: #fff;
}

.drum-notation-title {
    display: block;
    padding-bottom: 7px;
    border-bottom: 1px solid #d8d8dc;
    font-size: 12px;
    letter-spacing: 1px;
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
    background: repeating-linear-gradient(to bottom, transparent 0 10px, #696970 10px 11px);
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

    .drum-symbol {
        position: relative;
        display: block;
        height: 56px;
        grid-column: span 1;
        margin-top: 2px;
        text-align: center;
        font-size: 24px;
        font-style: normal;
        font-weight: 700;
    }

    svg {
        display: block;
        width: 28px;
        height: 60px;
        justify-self: center;
        overflow: visible;
        fill: #d8d8dc;
        stroke: #d8d8dc;
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

    .note::after {
        position: absolute;
        top: 28px;
        left: 50%;
        width: 11px;
        height: 7px;
        content: "";
        background: #d8d8dc;
        border-radius: 50%;
        transform: translateX(-50%) rotate(-25deg);
    }

    .x {
        color: #e2e2e5;
    }
    .circle-x {
        font-size: 21px;
    }
    .foot {
        align-self: end;
        margin-top: 35px;
    }
}

.drum-notation-group.bass,
.drum-notation-group.snare,
.drum-notation-group.ride {
    grid-template-columns: 1fr;
}
.drum-notation-group.hihat {
    grid-template-columns: repeat(3, 1fr);
}
.drum-notation-group.tom {
    grid-template-columns: repeat(3, 1fr);
}
.drum-notation-group.crash {
    grid-template-columns: 1fr;
}

.select-percentage {
    display: flex;
    align-items: center;
    gap: 4px;

    input {
        min-width: 90px;
        border: 0;
    }
}

.speed-selector {
    position: relative;

    > .btn {
        width: 160px;
    }
}

.zoom-selector {
    display: flex;
    align-items: center;
    gap: 8px;

    span {
        min-width: 76px;
        text-align: center;
    }
}

.speed-selector-popover {
    position: absolute;
    bottom: calc(100% + 10px);
    right: 0;
    z-index: 2;
    width: 370px;
    padding: 12px 18px 22px;
    color: #d9e0e8;
    background: #262d35;
    box-shadow: 0 12px 28px rgba(32, 46, 62, 0.14);
    border-radius: 6px;
}

.main.light .speed-selector-popover {
    color: #465467;
    background: #fff;
}

.speed-selector-header {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: fit-content;
    padding-bottom: 10px;
    border-bottom: 1px solid currentColor;

    button {
        padding: 0;
        color: inherit;
        font-size: 24px;
        line-height: 1;
        background: none;
        border: 0;

        &:hover {
            color: #65d52f;
        }
    }

    input {
        width: 64px;
        padding: 0;
        color: inherit;
        text-align: center;
        background: transparent;
        border: 0;
        font-size: 16px;
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
            width: 20px;
            height: 20px;
            margin-top: -1px;
            appearance: none;
            background: #65d52f;
            border: 6px solid #344253;
            border-radius: 50%;
            box-shadow: 0 3px 8px rgba(25, 35, 48, 0.3);
        }

        &::-moz-range-track {
            height: 18px;
            background: transparent;
        }

        &::-moz-range-thumb {
            width: 9px;
            height: 9px;
            background: #65d52f;
            border: 6px solid #344253;
            border-radius: 50%;
        }
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
        background: #aab4bf;

        &.major {
            height: 16px;
        }
    }
}

.speed-mark {
    position: absolute;
    bottom: 48px;
    color: color-mix(in srgb, currentColor 65%, transparent);
    font-size: 16px;
    transform: translateX(-50%);

    &.active {
        color: #65d52f;
        font-weight: 700;
    }
}

.speed-unit {
    position: absolute;
    right: -27px;
    bottom: 47px;
    font-size: 18px;
    font-weight: 700;
    color: #65d52f;
}

.mobile {
    h1 {
        font-size: 20px;
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
            .sync-offset {
                display: none;
            }
        }
    }

    .speed {
        input {
            width: 100px;
        }
    }

    .speed-selector {
        width: min(370px, calc(100vw - 32px));
    }

    .drum-notation-tooltip {
        left: 50%;
        transform: translateX(-50%);
    }
}

.key-signature {
    position: absolute;
    margin-left: 30px;
}
</style>
