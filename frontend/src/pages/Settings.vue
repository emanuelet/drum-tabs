<script lang="ts">
import { defineComponent } from "vue";
import { SettingSchema } from "../zod.ts";
import { baseURL, checkFetch, generalError, getSetting, successMessage } from "../app.js";
import { ScrollMode } from "@coderline/alphatab";

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
            ultimateGuitarCookie: localStorage.getItem("ultimateGuitarCookie") || "",
        };
    },
    mounted() {
        this.setting = getSetting();
    },
    methods: {
        /**
         * Load the setting from the server
         */
        async loadFromServer() {
            const ok = window.confirm("This will overwrite your local settings. Are you sure?");
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
            const ok = window.confirm("This will overwrite the settings stored on the server. Are you sure?");
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
            const ok = window.confirm("Are you sure you want to reset your local settings? This will not affect the settings stored on the server.");
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

        <h2 class="mt-4 mb-4">Tab Player</h2>

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

        <!-- Score Color Dropdown -->
        <div class="mb-3">
            <span class="form-label d-block">Tab/Score Color</span>
            <div class="btn-group" role="group" aria-label="Tab and score color">
                <button type="button" class="btn" :class="setting.scoreColor === 'light' ? 'btn-primary' : 'btn-outline-secondary'" @click="setting.scoreColor = 'light'">Light</button>
                <button type="button" class="btn" :class="setting.scoreColor === 'dark' ? 'btn-primary' : 'btn-outline-secondary'" @click="setting.scoreColor = 'dark'">Dark</button>
            </div>
        </div>

        <!-- Tab/Score Display Scale -->
        <div class="mb-3">
            <label for="scale" class="form-label">Tab/Score Display Scale</label>
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
        <div class="mb-3">
            <span class="form-label d-block">
                Scroll
                <span v-if='setting.scoreStyle === "horizontal-tab"'> (Force Smooth Scroll for Horizontal Tab)</span>
            </span>
            <div class="btn-group" role="group" aria-label="Scroll mode">
                <button type="button" class="btn" :class="setting.scrollMode === ScrollMode.Continuous ? 'btn-primary' : 'btn-outline-secondary'" :disabled='setting.scoreStyle === "horizontal-tab"'
                    @click="setting.scrollMode = ScrollMode.Continuous">Scroll</button>
                <button type="button" class="btn" :class="setting.scrollMode === ScrollMode.Off ? 'btn-primary' : 'btn-outline-secondary'" :disabled='setting.scoreStyle === "horizontal-tab"'
                    @click="setting.scrollMode = ScrollMode.Off">Off</button>
                <button type="button" class="btn" :class="setting.scrollMode === ScrollMode.Smooth ? 'btn-primary' : 'btn-outline-secondary'" :disabled='setting.scoreStyle === "horizontal-tab"'
                    @click="setting.scrollMode = ScrollMode.Smooth">Smooth Scroll</button>
            </div>
        </div>

        <!-- Show Key Signature -->
        <div class="mb-3">
            <span class="form-label d-block">Show Key Signature</span>
            <div class="btn-group" role="group" aria-label="Show key signature">
                <button type="button" class="btn" :class="setting.showKeySignature ? 'btn-primary' : 'btn-outline-secondary'" @click="setting.showKeySignature = true">Yes</button>
                <button type="button" class="btn" :class="!setting.showKeySignature ? 'btn-primary' : 'btn-outline-secondary'" @click="setting.showKeySignature = false">No</button>
            </div>
        </div>

        <!-- Toolbar Auto-hide -->
        <div class="mb-3">
            <span class="form-label d-block">Auto-hide bottom toolbar</span>
            <div class="btn-group" role="group" aria-label="Auto-hide bottom toolbar">
                <button type="button" class="btn" :class="!setting.toolbarAutoHide ? 'btn-primary' : 'btn-outline-secondary'" @click="setting.toolbarAutoHide = false">No</button>
                <button type="button" class="btn" :class="setting.toolbarAutoHide ? 'btn-primary' : 'btn-outline-secondary'" @click="setting.toolbarAutoHide = true">Yes</button>
            </div>
        </div>

        <h2 class="mt-5 mb-4">Assists</h2>

        <!-- Note Color refer to SettingSchema   noteColor: z.enum(["rocksmith", "none"]).default("none"), -->
        <div class="mb-3">
            <span class="form-label d-block">Note Color</span>
            <div class="btn-group" role="group" aria-label="Note color">
                <button type="button" class="btn" :class="setting.noteColor === 'none' ? 'btn-primary' : 'btn-outline-secondary'" @click="setting.noteColor = 'none'">No Color</button>
                <button type="button" class="btn" :class="setting.noteColor === 'rocksmith' ? 'btn-primary' : 'btn-outline-secondary'" @click="setting.noteColor = 'rocksmith'">Rocksmith 2014</button>
                <button type="button" class="btn" :class="setting.noteColor === 'louis-bass-v' ? 'btn-primary' : 'btn-outline-secondary'"
                    @click="setting.noteColor = 'louis-bass-v'">Louis' 5-string Bass</button>
            </div>
        </div>

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

        <p class="text-secondary">Tips: If you want to check if the sync points is correct, "Cursor (Instant)" is a good indicator.</p>

        <h2 class="mt-5 mb-4">Ultimate Guitar</h2>

        <div class="mb-3">
            <label for="ultimateGuitarCookie" class="form-label">Cookie header</label>
            <input id="ultimateGuitarCookie" v-model="ultimateGuitarCookie" type="password" class="form-control" autocomplete="off" @change="saveUltimateGuitarCookie" />
            <div class="form-text">Stored only in this browser and sent only with Ultimate Guitar requests.</div>
        </div>

        <h2 class="mt-5 mb-4">Others</h2>

        <div class="mb-3">
            <label class="form-label">Load/Save Settings to Server</label>

            <div class="d-flex gap-2">
                <button class="btn btn-secondary" :disabled="isProcessing" @click.prevent="loadFromServer">Load from Server</button>
                <button class="btn btn-secondary" :disabled="isProcessing" @click.prevent="saveToServer">Save to Server</button>
                <button class="btn btn-danger" :disabled="isProcessing" @click.prevent="resetToDefault">Reset Local</button>
            </div>
        </div>
    </div>
</template>

<style scoped lang="scss"></style>
