<script lang="ts">
import { defineComponent } from "vue";
import { SettingSchema } from "../zod.ts";
import { baseURL, checkFetch, generalError, getSetting, successMessage } from "../app.js";
import { ScrollMode } from "@coderline/alphatab";
import { confirmAction } from "../confirm.ts";

export default defineComponent({
    computed: {
        ScrollMode() {
            return ScrollMode;
        },
    },
    data() {
        return {
            setting: {
                scoreColor: "",
                noteColor: "",
                cursor: "",
                scoreStyle: "",
                groupByArtist: false,
                showKeySignature: false,
                scrollMode: "",
                scale: 1,
                toolbarAutoHide: false,
            },
            isProcessing: false,
            activeTab: "player",
            tabs: [
                { id: "player", label: "Tab Player" },
                { id: "assists", label: "Assists" },
                { id: "ultimate-guitar", label: "Ultimate Guitar" },
                { id: "others", label: "Others" },
            ],
            ultimateGuitarCookie: localStorage.getItem("ultimateGuitarCookie") || "",
        };
    },
    mounted() {
        this.setting = getSetting();
        const initial = String(this.$route.query.tab || "");
        if (this.tabs.some((tab) => tab.id === initial)) {
            this.activeTab = initial;
        }
    },
    methods: {
        selectTab(id: string) {
            this.activeTab = id;
            this.$router.replace({ query: { ...this.$route.query, tab: id } });
        },

        /**
         * Arrow-key navigation between tabs (WAI-ARIA tabs pattern)
         */
        onTabKeydown(e: KeyboardEvent, index: number) {
            const last = this.tabs.length - 1;
            let next = -1;
            if (e.key === "ArrowRight") next = index === last ? 0 : index + 1;
            else if (e.key === "ArrowLeft") next = index === 0 ? last : index - 1;
            else if (e.key === "Home") next = 0;
            else if (e.key === "End") next = last;
            if (next < 0) return;
            e.preventDefault();
            this.selectTab(this.tabs[next].id);
            this.$nextTick(() => document.getElementById(`settings-tab-${this.tabs[next].id}`)?.focus());
        },

        /**
         * Load the setting from the server
         */
        async loadFromServer() {
            const ok = await confirmAction({
                title: "Load settings from server?",
                message: "This will overwrite your local settings.",
                confirmText: "Load",
                danger: false,
            });
            if (!ok) {
                return;
            }

            try {
                this.isProcessing = true;
                const res = await fetch(baseURL + `/api/settings`, {
                    credentials: "include",
                });
                await checkFetch(res);
                const data = await res.json();
                const serverSetting = data.setting || {};
                const parsed = SettingSchema.parse(serverSetting);
                this.setting = parsed;
                localStorage.setItem("userSetting", JSON.stringify(parsed));
                successMessage("Settings loaded from server");
            } catch (e) {
                generalError(e);
            } finally {
                this.isProcessing = false;
            }
        },

        /**
         * Save the current setting to the server.
         */
        async saveToServer() {
            const ok = await confirmAction({
                title: "Save settings to server?",
                message: "This will overwrite the settings stored on the server.",
                confirmText: "Save",
            });
            if (!ok) {
                return;
            }

            try {
                this.isProcessing = true;
                const parsedSetting = SettingSchema.parse(this.setting);
                const res = await fetch(baseURL + `/api/settings`, {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(parsedSetting),
                });
                await checkFetch(res);
                successMessage("Settings saved to server");
            } catch (e) {
                generalError(e);
            } finally {
                this.isProcessing = false;
            }
        },

        /**
         * Reset local/client settings to default values
         */
        async resetToDefault() {
            const ok = await confirmAction({
                title: "Reset local settings?",
                message: "This resets your local settings to their defaults. Settings stored on the server are not affected.",
                confirmText: "Reset",
            });
            if (!ok) {
                return;
            }

            try {
                const defaults = SettingSchema.parse({});
                this.setting = defaults;
                localStorage.setItem("userSetting", JSON.stringify(defaults));
                successMessage("Reset to default settings successfully");
            } catch (e) {
                generalError(e);
            }
        },
        saveUltimateGuitarCookie() {
            const cookie = this.ultimateGuitarCookie.trim();
            if (cookie) {
                localStorage.setItem("ultimateGuitarCookie", cookie);
            } else {
                localStorage.removeItem("ultimateGuitarCookie");
            }
        },
    },
    watch: {
        setting: {
            handler(newSetting) {
                const parsedSetting = SettingSchema.parse(newSetting);
                localStorage.setItem("userSetting", JSON.stringify(parsedSetting));
            },
            deep: true,
        },
    },
});
</script>

<template>
    <div class="container my-container">
        <h1 class="mb-3">Settings</h1>

        <ul class="nav nav-tabs settings-tabs mb-4" role="tablist" aria-label="Settings sections">
            <li v-for="(tab, index) in tabs" :key="tab.id" class="nav-item" role="presentation">
                <button :id="`settings-tab-${tab.id}`" class="nav-link" :class="{ active: activeTab === tab.id }" type="button" role="tab" :aria-selected="activeTab === tab.id"
                    :aria-controls="`settings-panel-${tab.id}`" :tabindex="activeTab === tab.id ? 0 : -1" @click="selectTab(tab.id)" @keydown="onTabKeydown($event, index)">
                    {{ tab.label }}
                </button>
            </li>
        </ul>

        <section id="settings-panel-player" v-show="activeTab === 'player'" role="tabpanel" aria-labelledby="settings-tab-player">
            <!--     scoreStyle: z.enum(["tab", "score-tab", "score"]).default("tab"), -->
            <div class="mb-3">
                <label for="scoreStyle" class="form-label">Style</label>
                <select id="scoreStyle" class="form-select" v-model="setting.scoreStyle">
                    <option value="tab">Tab</option>
                    <option value="score">Score</option>
                    <option value="score-tab">Tab + Score</option>
                    <option value="horizontal-tab">Horizontal Tab</option>
                </select>
            </div>

            <fieldset class="mb-3">
                <legend class="form-label fs-6">Tab/Score Color</legend>
                <div class="btn-group toggle-group" role="group">
                    <input id="scoreColor-0" v-model="setting.scoreColor" type="radio" class="btn-check" name="scoreColor" :value="'light'">
                    <label class="btn btn-outline-secondary" for="scoreColor-0">Light</label>
                    <input id="scoreColor-1" v-model="setting.scoreColor" type="radio" class="btn-check" name="scoreColor" :value="'dark'">
                    <label class="btn btn-outline-secondary" for="scoreColor-1">Dark</label>
                </div>
            </fieldset>

            <!-- Default zoom -->
            <div class="mb-3">
                <label for="scale" class="form-label">Default Zoom</label>
                <select id="scale" class="form-select" v-model.number="setting.scale">
                    <option :value="0.8">80%</option>
                    <option :value="1">100%</option>
                    <option :value="1.1">110%</option>
                    <option :value="1.2">120%</option>
                    <option :value="1.3">130%</option>
                    <option :value="1.4">140%</option>
                    <option :value="1.5">150%</option>
                    <option :value="2">200%</option>
                    <option :value="3">300%</option>
                </select>
            </div>

            <!-- Scroll Mode -->
            <fieldset class="mb-3">
                <legend class="form-label fs-6">
                Scroll
                <span v-if='setting.scoreStyle === "horizontal-tab"'> (Force Smooth Scroll for Horizontal Tab)</span>
            </legend>
                <div class="btn-group toggle-group" role="group">
                    <input id="scroll-0" v-model="setting.scrollMode" type="radio" class="btn-check" name="scrollMode" :value="ScrollMode.Continuous"
                        :disabled='setting.scoreStyle === "horizontal-tab"'>
                    <label class="btn btn-outline-secondary" for="scroll-0">Scroll</label>
                    <input id="scroll-1" v-model="setting.scrollMode" type="radio" class="btn-check" name="scrollMode" :value="ScrollMode.Off" :disabled='setting.scoreStyle === "horizontal-tab"'>
                    <label class="btn btn-outline-secondary" for="scroll-1">Off</label>
                    <input id="scroll-2" v-model="setting.scrollMode" type="radio" class="btn-check" name="scrollMode" :value="ScrollMode.Smooth" :disabled='setting.scoreStyle === "horizontal-tab"'>
                    <label class="btn btn-outline-secondary" for="scroll-2">Smooth Scroll</label>
                </div>
            </fieldset>

            <!-- Show Key Signature -->
            <fieldset class="mb-3">
                <legend class="form-label fs-6">Show Key Signature</legend>
                <div class="btn-group toggle-group" role="group">
                    <input id="keySig-0" v-model="setting.showKeySignature" type="radio" class="btn-check" name="showKeySignature" :value="true">
                    <label class="btn btn-outline-secondary" for="keySig-0">Yes</label>
                    <input id="keySig-1" v-model="setting.showKeySignature" type="radio" class="btn-check" name="showKeySignature" :value="false">
                    <label class="btn btn-outline-secondary" for="keySig-1">No</label>
                </div>
            </fieldset>

            <!-- Toolbar Auto-hide -->
            <fieldset class="mb-3">
                <legend class="form-label fs-6">Auto-hide bottom toolbar</legend>
                <div class="btn-group toggle-group" role="group">
                    <input id="autoHide-0" v-model="setting.toolbarAutoHide" type="radio" class="btn-check" name="toolbarAutoHide" :value="true">
                    <label class="btn btn-outline-secondary" for="autoHide-0">Yes</label>
                    <input id="autoHide-1" v-model="setting.toolbarAutoHide" type="radio" class="btn-check" name="toolbarAutoHide" :value="false">
                    <label class="btn btn-outline-secondary" for="autoHide-1">No</label>
                </div>
            </fieldset>
        </section>

        <section id="settings-panel-assists" v-show="activeTab === 'assists'" role="tabpanel" aria-labelledby="settings-tab-assists">
            <!-- Note Color refer to SettingSchema   noteColor: z.enum(["rocksmith", "none"]).default("none"), -->
            <fieldset class="mb-3">
                <legend class="form-label fs-6">Note Color</legend>
                <div class="btn-group toggle-group" role="group">
                    <input id="noteColor-0" v-model="setting.noteColor" type="radio" class="btn-check" name="noteColor" :value="'none'">
                    <label class="btn btn-outline-secondary" for="noteColor-0">No Color</label>
                    <input id="noteColor-1" v-model="setting.noteColor" type="radio" class="btn-check" name="noteColor" :value="'rocksmith'">
                    <label class="btn btn-outline-secondary" for="noteColor-1">Rocksmith 2014</label>
                    <input id="noteColor-2" v-model="setting.noteColor" type="radio" class="btn-check" name="noteColor" :value="'louis-bass-v'">
                    <label class="btn btn-outline-secondary" for="noteColor-2">Louis' 5-string Bass</label>
                </div>
            </fieldset>

            <!--     cursor: z.enum(["animated", "instant", "bar", "invisible"]).default("animated"),-->
            <div class="mb-3">
                <label for="cursor" class="form-label">Cursor Style</label>
                <select id="cursor" class="form-select" v-model="setting.cursor">
                    <option value="invisible">No Cursor</option>
                    <option value="animated">Cursor (Smooth)</option>
                    <option value="instant">Cursor (Instant)</option>
                    <option value="bar">Bar</option>
                </select>
            </div>

            <p class="text-dt-muted">Tips: If you want to check if the sync points is correct, "Cursor (Instant)" is a good indicator.</p>
        </section>

        <section id="settings-panel-ultimate-guitar" v-show="activeTab === 'ultimate-guitar'" role="tabpanel" aria-labelledby="settings-tab-ultimate-guitar">
            <div class="mb-3">
                <h2 class="h5">What this does</h2>
                <p>
                Adds an Ultimate Guitar search to the <router-link :to="{ name: 'tabNew' }">New Tab</router-link> page. You can search by artist or song, preview a result, and import it into your library as either a
                Guitar Pro file with a drum track or an ASCII drum tab. Imported tabs behave like any other uploaded tab.
            </p>
                <h2 class="h5">Why a cookie is needed</h2>
                <p>
                Searches and downloads are made with your own Ultimate Guitar login session. This server forwards your cookie with each request and never stores it. It is kept only in this browser.
            </p>
                <h2 class="h5">How to get it</h2>
                <ol>
                    <li>Log in at ultimate-guitar.com in your browser.</li>
                    <li>Open developer tools (F12) and go to the Network tab.</li>
                    <li>Reload the page and click any request to ultimate-guitar.com.</li>
                    <li>Copy the whole <code>Cookie</code> value from the request headers and paste it below.</li>
                </ol>

                <label for="ultimateGuitarCookie" class="form-label">Cookie header</label>
                <input id="ultimateGuitarCookie" v-model="ultimateGuitarCookie" type="password" class="form-control" autocomplete="off" aria-describedby="ugCookieHelp"
                    @change="saveUltimateGuitarCookie" />
                <div id="ugCookieHelp" class="form-text text-dt-muted">Stored only in this browser and sent only with Ultimate Guitar requests.</div>
            </div>
        </section>

        <section id="settings-panel-others" v-show="activeTab === 'others'" role="tabpanel" aria-labelledby="settings-tab-others">
            <div class="mb-3" role="group" aria-labelledby="serverSyncLabel">
                <div id="serverSyncLabel" class="form-label">Load/Save Settings to Server</div>

                <div class="d-flex flex-wrap gap-2">
                    <button class="btn btn-secondary touch-target" :disabled="isProcessing" @click.prevent="loadFromServer">Load from Server</button>
                    <button class="btn btn-success touch-target" :disabled="isProcessing" @click.prevent="saveToServer">Save to Server</button>
                    <button class="btn btn-outline-danger touch-target" :disabled="isProcessing" @click.prevent="resetToDefault">Reset Local</button>
                </div>
            </div>
        </section>
    </div>
</template>

<style scoped lang="scss">
.settings-tabs {
    flex-wrap: wrap;

    .nav-link {
        min-height: 44px;
        white-space: nowrap;
    }
}
</style>
