<script>
import { defineComponent } from "vue";
import Vue3Dropzone from "@jaxtheprime/vue3-dropzone";
import "@jaxtheprime/vue3-dropzone/dist/style.css";
import { notify } from "@kyvg/vue3-notification";
import { baseURL } from "../app.js";
import { supportedFormatCommaString } from "../../../backend/common.js";

const alphaTab = await import("@coderline/alphatab");

export default defineComponent({
    components: { Vue3Dropzone },
    data() {
        return {
            files: [],
            supportedFormatCommaString,
            isUploading: false,
            drumAsciiText: "",
            drumAsciiTitle: "",
            drumAsciiArtist: "",
            ugQuery: "",
            ugMode: "guitar-pro",
            ugResults: [],
            ugLoading: false,
            ugSelectedTab: null,
            ugError: "",
        };
    },
    methods: {
        async upload() {
            if (this.files.length === 0) {
                notify({ text: "Please select at least one file to upload", type: "error" });
                return;
            }

            this.isUploading = true;

            const uploadPromises = this.files.map(async (f) => {
                try {
                    const file = f.file;
                    const isText = file.name.toLowerCase().endsWith(".txt");
                    const score = isText ? null : alphaTab.importer.ScoreLoader.loadScoreFromBytes(
                        new Uint8Array(await file.arrayBuffer()),
                        new alphaTab.Settings(),
                    );

                    // Upload to /api/new-tab
                    const formData = new FormData();
                    formData.append("file", file);
                    formData.append("title", score?.title || file.name.replace(/\.txt$/i, ""));
                    formData.append("artist", score?.artist || "");

                    const res = await fetch(baseURL + "/api/new-tab", {
                        method: "POST",
                        credentials: "include",
                        body: formData,
                    });

                    if (!res.ok) {
                        const errorData = await res.json();
                        throw new Error(errorData.msg || "Upload failed");
                    }

                    const respData = await res.json();
                    notify({ text: `Uploaded: ${score?.artist || ""} - ${score?.title || file.name}`, type: "success" });
                    return respData.id;
                } catch (err) {
                    notify({ text: `Error with ${f.name}: ${err.message}`, type: "error" });
                    return null;
                }
            });

            const results = await Promise.all(uploadPromises);

            const firstId = results.find((id) => id !== null);
            if (firstId) {
                this.$router.push(`/tab/${firstId}`);
            }

            // Reset Dropzone
            this.isUploading = false;
        },
        async importDrumAscii() {
            const file = this.files[0]?.file;
            if (!file || !file.name.toLowerCase().endsWith(".txt")) {
                notify({ text: "Select one .txt drum tab first", type: "error" });
                return;
            }
            this.isUploading = true;
            try {
                const formData = new FormData();
                formData.append("file", file);
                const res = await fetch(baseURL + "/api/new-drum-tab", { method: "POST", credentials: "include", body: formData });
                const data = await res.json();
                if (!res.ok) throw new Error(data.msg || "Drum import failed");
                if (data.warnings?.length) notify({ text: data.warnings.join("; "), type: "warn" });
                notify({ text: "Drum tab converted to MusicXML", type: "success" });
                this.$router.push(`/tab/${data.id}`);
            } catch (err) {
                notify({ text: `Drum import error: ${err.message}`, type: "error" });
            } finally {
                this.isUploading = false;
            }
        },
        async importPastedDrumAscii() {
            if (!this.drumAsciiText.trim()) {
                notify({ text: "Paste a drum ASCII tab first", type: "error" });
                return;
            }
            this.isUploading = true;
            try {
                const formData = new FormData();
                formData.append("text", this.drumAsciiText);
                formData.append("title", this.drumAsciiTitle);
                formData.append("artist", this.drumAsciiArtist);
                const res = await fetch(baseURL + "/api/new-drum-tab", { method: "POST", credentials: "include", body: formData });
                const data = await res.json();
                if (!res.ok) throw new Error(data.msg || "Drum import failed");
                if (data.warnings?.length) notify({ text: data.warnings.join("; "), type: "warn" });
                notify({ text: "Drum tab converted to MusicXML", type: "success" });
                this.$router.push(`/tab/${data.id}`);
            } catch (err) {
                notify({ text: `Drum import error: ${err.message}`, type: "error" });
            } finally {
                this.isUploading = false;
            }
        },
        dropzoneError(err) {
            console.log(err);
            notify({ text: err.type || "Dropzone error", type: "error" });
        },

        async createEmpty(type) {
            this.isUploading = true;
            try {
                const res = await fetch(baseURL + `/api/new-tab/template/${type}`, {
                    method: "POST",
                    credentials: "include",
                });

                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.msg || "Failed to create tab from template");
                }

                const data = await res.json();
                notify({ text: `Created ${type} tab`, type: "success" });
                if (data.id) {
                    this.$router.push(`/tab/${data.id}`);
                }
            } catch (e) {
                notify({ text: e.message || "Unknown error", type: "error" });
            } finally {
                this.isUploading = false;
            }
        },
        async searchUltimateGuitar() {
            this.ugError = "";
            this.ugResults = [];
            const cookie = this.getUltimateGuitarCookie();
            if (!cookie) return;
            this.ugLoading = true;
            try {
                const params = new URLSearchParams({ query: this.ugQuery, mode: this.ugMode });
                const res = await fetch(baseURL + `/api/ultimate-guitar/search?${params}`, {
                    credentials: "include",
                    headers: { "X-Ultimate-Guitar-Cookie": cookie },
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.msg || "Ultimate Guitar search failed");
                this.ugResults = data.results || [];
            } catch (e) {
                this.ugError = e.message || "Ultimate Guitar search failed";
            } finally {
                this.ugLoading = false;
            }
        },
        async openUltimateGuitarResult(result) {
            this.ugError = "";
            const cookie = this.getUltimateGuitarCookie();
            if (!cookie) return;
            this.ugSelectedTab = { ...result, loading: true };
            try {
                const params = new URLSearchParams({ url: result.url });
                const res = await fetch(baseURL + `/api/ultimate-guitar/tab?${params}`, {
                    credentials: "include",
                    headers: { "X-Ultimate-Guitar-Cookie": cookie },
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.msg || "Could not load tab");
                this.ugSelectedTab = { ...result, ...data.tab, loading: false };
            } catch (e) {
                this.ugSelectedTab = null;
                this.ugError = e.message || "Could not load tab";
            }
        },
        async copyUltimateGuitarText() {
            await navigator.clipboard.writeText(this.ugSelectedTab.text);
            notify({ text: "Tab copied", type: "success" });
        },
        async importUltimateGuitarResult() {
            const tab = this.ugSelectedTab;
            if (!tab?.downloadUrl) return;
            const cookie = this.getUltimateGuitarCookie();
            if (!cookie) return;
            this.isUploading = true;
            try {
                const res = await fetch(baseURL + `/api/ultimate-guitar/download?url=${encodeURIComponent(tab.downloadUrl)}`, {
                    credentials: "include",
                    headers: { "X-Ultimate-Guitar-Cookie": cookie },
                });
                if (!res.ok) throw new Error((await res.json()).msg || "Download failed");
                const blob = await res.blob();
                const file = new File([blob], `${tab.title || "ultimate-guitar"}.gp`, { type: "application/octet-stream" });
                const data = await file.arrayBuffer();
                const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(data), new alphaTab.Settings());
                if (!score.tracks.some((track) => track.isPercussion)) throw new Error("This Guitar Pro tab has no drums track.");
                const formData = new FormData();
                formData.append("file", file);
                formData.append("title", score.title || tab.title || "Untitled");
                formData.append("artist", score.artist || tab.artist || "");
                const upload = await fetch(baseURL + "/api/new-tab", { method: "POST", credentials: "include", body: formData });
                const uploaded = await upload.json();
                if (!upload.ok) throw new Error(uploaded.msg || "Import failed");
                this.$router.push(`/tab/${uploaded.id}`);
            } catch (e) {
                this.ugError = e.message || "Import failed";
            } finally {
                this.isUploading = false;
            }
        },
        getUltimateGuitarCookie() {
            const cookie = localStorage.getItem("ultimateGuitarCookie")?.trim();
            if (!cookie) {
                this.ugError = "Ultimate Guitar cookie missing. Add it in Settings.";
                return null;
            }
            return cookie;
        },
    },
});
</script>

<template>
    <div class="container my-container">
        <div class="display-6 mb-4 mt-5">Upload tabs or text sheets</div>

        <Vue3Dropzone
            v-model="files"
            :maxFileSize="500"
            :multiple="true"
            :maxFiles="10"
            @error="dropzoneError"
        >
            <template #title>Drop your tabs here</template>
            <template #description>Supports {{ supportedFormatCommaString }}</template>
        </Vue3Dropzone>

        <button
            @click="upload"
            class="btn btn-primary w-100 mt-4"
            :disabled="isUploading"
        >
            {{ isUploading ? "Uploading..." : "Upload" }}
        </button>

        <button
            @click="importDrumAscii"
            class="btn btn-outline-secondary w-100 mt-2"
            :disabled="isUploading"
        >
            Import Selected Drum ASCII as MusicXML
        </button>
        <section class="mt-5">
            <h2>Paste Drum ASCII</h2>
            <textarea v-model="drumAsciiText" class="form-control mb-2" rows="10" placeholder="Paste drum ASCII tab here"></textarea>
            <div class="row g-2">
                <div class="col"><input v-model="drumAsciiTitle" class="form-control" placeholder="Title (optional)" /></div>
                <div class="col"><input v-model="drumAsciiArtist" class="form-control" placeholder="Artist (optional)" /></div>
                <div class="col-auto"><button class="btn btn-outline-primary" :disabled="isUploading" @click="importPastedDrumAscii">Import as MusicXML</button></div>
            </div>
        </section>
        <section class="ultimate-guitar mt-5">
            <h2>Ultimate Guitar</h2>
            <p class="text-secondary">Configure the Cookie header in <router-link :to="{ name: 'settings' }">Settings</router-link>. It is kept only in this browser and sent to Ultimate Guitar requests.</p>
            <div class="d-flex gap-2 mb-3">
                <input v-model="ugQuery" class="form-control" placeholder="Artist or song" @keyup.enter="searchUltimateGuitar" />
                <select v-model="ugMode" class="form-select">
                    <option value="guitar-pro">Guitar Pro with drums</option>
                    <option value="ascii-drums">ASCII drum tabs</option>
                </select>
                <button class="btn btn-primary" :disabled="ugLoading" @click="searchUltimateGuitar">{{ ugLoading ? "Searching..." : "Search" }}</button>
            </div>
            <div v-if="ugError" class="alert alert-danger">{{ ugError }}</div>
            <div v-for="result in ugResults" :key="result.url" class="card mb-2">
                <div class="card-body d-flex justify-content-between align-items-center">
                    <div><strong>{{ result.title }}</strong><span v-if="result.artist"> by {{ result.artist }}</span><br /><small>Rating: {{ result.rating ?? "unknown" }}</small></div>
                    <button class="btn btn-outline-primary" @click="openUltimateGuitarResult(result)">Open</button>
                </div>
            </div>
            <div v-if="ugSelectedTab && !ugSelectedTab.loading" class="mt-3">
                <h4>{{ ugSelectedTab.title }}</h4>
                <pre v-if="ugMode === 'ascii-drums'" class="tab-text">{{ ugSelectedTab.text || "No tab text found." }}</pre>
                <button v-if="ugMode === 'ascii-drums' && ugSelectedTab.text" class="btn btn-secondary me-2" @click="copyUltimateGuitarText">Copy entire tab</button>
                <button v-if="ugMode === 'guitar-pro'" class="btn btn-primary" :disabled="isUploading" @click="importUltimateGuitarResult">Download and import</button>
            </div>
        </section>

        <ul class="mt-3">
            <li>
                <a href="#" @click.prevent='createEmpty("bass")' class="me-3">Create Empty Bass Tab</a>
            </li>
            <li>
                <a href="#" @click.prevent='createEmpty("guitar")'>Create Empty Guitar Tab</a>
            </li>
            <li>
                <a href="#" @click.prevent='createEmpty("drum")'>Create Empty Drum Tab</a>
            </li>
        </ul>

        <div></div>

        <h4 class="mt-5">Free Resources</h4>

        <ul class="free-resources">
            <li><a href="https://www.ultimate-guitar.com/" target="_blank" rel="noopener">Ultimate Guitar</a><br />Some free tabs in *.gp format</li>
            <li><a href="https://www.911tabs.com/" target="_blank" rel="noopener">911Tabs</a><br />Search engine for tabs</li>
            <li>
                <a href="https://musescore.com/sheetmusic?instrument=72%2C73&recording_type=free-download" target="_blank" rel="noopener">MuseScore (Free Download filtered)</a><br />Some free tabs in
                MusicXML format
            </li>
            <li><a href="https://gprotab.net/" target="_blank" rel="noopener">GProTab</a><br />Free Guitar Pro tabs in *.gp format</li>
        </ul>
    </div>
</template>

<style lang="scss">
.img-details {
    opacity: 1 !important;
    visibility: visible !important;
}

.free-resources li {
    margin-bottom: 15px;
}
</style>
