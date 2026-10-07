<script>
import { defineComponent } from "vue";
import { baseURL } from "../app.js";
import { notify } from "@kyvg/vue3-notification";
import { confirmAction } from "../confirm.ts";

export default defineComponent({
    data() {
        return {
            students: [],
            tabs: [],
            exercises: [],
            assignments: [],
            learnerQuery: "",
            searchResults: [],
            searching: false,
            searchError: "",
            loading: true,
            loadError: "",
            // ids of rows with a request in flight (connect/disconnect/revoke)
            busy: [],
            searchTimer: null,
            searchSeq: 0,
            opener: null,
        };
    },
    async mounted() {
        await this.init();
    },
    beforeUnmount() {
        clearTimeout(this.searchTimer);
    },
    methods: {
        async init() {
            this.loading = true;
            this.loadError = "";
            try {
                await this.load();
            } catch (error) {
                // Not a teacher / not logged in: this page is not for them
                if (error.status === 401 || error.status === 403 || /teacher access/i.test(error.message)) {
                    notify({ text: error.message || "Unable to load students", type: "error" });
                    this.$router.push("/");
                    return;
                }
                this.loadError = error.message || "Unable to load students";
            } finally {
                this.loading = false;
            }
        },
        async request(path, options = {}) {
            const res = await fetch(baseURL + path, {
                credentials: "include",
                ...options,
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                const error = new Error(data.msg || data.error || "Request failed");
                error.status = res.status;
                throw error;
            }
            return data;
        },
        async load() {
            const [students, tabs, exercises] = await Promise.all([
                this.request("/api/students"),
                this.request("/api/tabs"),
                this.request("/api/exercises"),
            ]);
            this.students = students.students;
            this.assignments = students.assignments;
            this.tabs = tabs.tabs;
            this.exercises = exercises.exercises;
        },
        isBusy(key) {
            return this.busy.includes(key);
        },
        async runBusy(key, task, fallbackMessage) {
            if (this.isBusy(key)) return false;
            this.busy.push(key);
            try {
                await task();
                return true;
            } catch (error) {
                notify({ text: error.message || fallbackMessage, type: "error" });
                return false;
            } finally {
                this.busy = this.busy.filter((item) => item !== key);
            }
        },
        openSearch(event) {
            this.opener = event?.currentTarget || null;
            this.learnerQuery = "";
            this.searchResults = [];
            this.searchError = "";
            this.$refs.searchDialog.showModal();
        },
        closeSearch() {
            this.$refs.searchDialog.close();
        },
        onSearchClosed() {
            clearTimeout(this.searchTimer);
            this.opener?.focus();
        },
        // Debounced: wait for a pause in typing before hitting the API
        onSearchInput() {
            clearTimeout(this.searchTimer);
            this.searchError = "";
            if (this.learnerQuery.trim().length < 2) {
                this.searchSeq++;
                this.searchResults = [];
                this.searching = false;
                return;
            }
            this.searching = true;
            this.searchTimer = setTimeout(() => this.searchLearners(), 300);
        },
        async searchLearners() {
            clearTimeout(this.searchTimer);
            const query = this.learnerQuery.trim();
            if (query.length < 2) {
                this.searchResults = [];
                this.searching = false;
                return;
            }
            const seq = ++this.searchSeq;
            this.searching = true;
            this.searchError = "";
            try {
                const data = await this.request(`/api/learners?query=${encodeURIComponent(query)}`);
                if (seq !== this.searchSeq) return; // a newer search superseded this one
                const connected = new Set(this.students.map((student) => student.id));
                this.searchResults = data.learners.filter((learner) => !connected.has(learner.id));
            } catch (error) {
                if (seq !== this.searchSeq) return;
                this.searchResults = [];
                this.searchError = error.message || "Search failed";
            } finally {
                if (seq === this.searchSeq) this.searching = false;
            }
        },
        async connect(learner) {
            const ok = await this.runBusy(`connect-${learner.id}`, async () => {
                await this.request(`/api/students/${learner.id}`, { method: "POST" });
                await this.load();
            }, "Unable to connect learner");
            if (ok) {
                this.closeSearch();
                notify({ text: `${learner.name} connected`, type: "success" });
            }
        },
        async disconnect(student) {
            const confirmed = await confirmAction({
                title: "Disconnect learner?",
                message: `Disconnect ${student.name}? Their assignments from you will be removed.`,
                confirmText: "Disconnect",
            });
            if (!confirmed) return;
            const ok = await this.runBusy(`disconnect-${student.id}`, async () => {
                await this.request(`/api/students/${student.id}`, { method: "DELETE" });
                await this.load();
            }, "Unable to disconnect learner");
            if (ok) notify({ text: `${student.name} disconnected`, type: "success" });
        },
        async revoke(assignment) {
            const confirmed = await confirmAction({
                title: "Revoke assignment?",
                message: `Revoke "${this.resourceTitle(assignment)}" from ${this.learnerName(assignment.learnerId)}?`,
                confirmText: "Revoke",
            });
            if (!confirmed) return;
            const ok = await this.runBusy(`revoke-${assignment.id}`, async () => {
                await this.request(`/api/assignments/${assignment.id}`, { method: "DELETE" });
                await this.load();
            }, "Unable to revoke assignment");
            if (ok) notify({ text: "Assignment revoked", type: "success" });
        },
        resourceTitle(assignment) {
            const list = assignment.resourceType === "exercise" ? this.exercises : this.tabs;
            return list.find((item) => item.id === assignment.resourceId)?.title || "Removed item";
        },
        learnerName(id) {
            return this.students.find((student) => student.id === id)?.name || "Disconnected learner";
        },
    },
});
</script>

<template>
    <div class="container students">
        <div v-if="loading" class="state-block" role="status">
            <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Loading students...
        </div>

        <div v-else-if="loadError" class="state-block" role="alert">
            <p class="mb-3">{{ loadError }}</p>
            <button class="btn btn-outline-primary" type="button" @click="init">Retry</button>
        </div>

        <template v-else>
            <header>
                <p class="eyebrow">Teacher workspace</p>
                <h1>Students</h1>
                <p>
                    Connect learners, then assign practice from the Tabs or
                    Exercises lists.
                </p>
            </header>
            <section class="card" aria-labelledby="connected-heading">
                <div class="card-heading mb-3">
                    <h2 id="connected-heading">Connected students</h2>
                    <button class="btn btn-primary touch-target" type="button" @click="openSearch">
                        Connect learner
                    </button>
                </div>
                <p v-if="students.length === 0" class="text-dt-muted mb-0">
                    No learners connected yet.
                </p>
                <div v-for="student in students" :key="student.id" class="learner-row">
                    <span class="learner-info"><strong>{{ student.name }}</strong><small>{{ student.email }}</small></span>
                    <button
                        class="btn btn-outline-danger touch-target"
                        type="button"
                        :aria-label="`Disconnect ${student.name}`"
                        :disabled="isBusy(`disconnect-${student.id}`)"
                        @click="disconnect(student)"
                    >
                        {{ isBusy(`disconnect-${student.id}`) ? "Disconnecting..." : "Disconnect" }}
                    </button>
                </div>
            </section>
            <section class="card" aria-labelledby="assignments-heading">
                <h2 id="assignments-heading">Sent assignments</h2>
                <p v-if="assignments.length === 0" class="text-dt-muted mb-0">
                    No assignments sent yet.
                </p>
                <div v-for="assignment in assignments" :key="assignment.id" class="learner-row">
                    <span class="learner-info"><strong>{{ resourceTitle(assignment) }}</strong><small>To {{ learnerName(assignment.learnerId) }} · {{ assignment.resourceType }}</small></span>
                    <button
                        class="btn btn-outline-danger touch-target"
                        type="button"
                        :aria-label="`Revoke ${resourceTitle(assignment)} from ${learnerName(assignment.learnerId)}`"
                        :disabled="isBusy(`revoke-${assignment.id}`)"
                        @click="revoke(assignment)"
                    >
                        {{ isBusy(`revoke-${assignment.id}`) ? "Revoking..." : "Revoke" }}
                    </button>
                </div>
            </section>
        </template>

        <dialog ref="searchDialog" class="dt-dialog" aria-labelledby="connect-title" @close="onSearchClosed">
            <form @submit.prevent="searchLearners">
                <div class="dt-dialog-heading">
                    <h2 id="connect-title">Connect learner</h2>
                    <button class="btn-close" type="button" aria-label="Close" @click="closeSearch"></button>
                </div>
                <label for="learnerSearch" class="form-label">Search by name or email</label>
                <input
                    id="learnerSearch"
                    v-model="learnerQuery"
                    class="form-control"
                    type="search"
                    placeholder="Enter at least 2 characters"
                    autocomplete="off"
                    @input="onSearchInput"
                />
                <div aria-live="polite">
                    <p v-if="searching" class="text-dt-muted mt-3 mb-0">Searching...</p>
                    <p v-else-if="searchError" class="form-error mt-3 mb-0" role="alert">{{ searchError }}</p>
                    <p v-else-if="learnerQuery.trim().length >= 2 && searchResults.length === 0" class="text-dt-muted mt-3 mb-0">
                        No unconnected learners found.
                    </p>
                </div>
                <div v-for="learner in searchResults" :key="learner.id" class="learner-row">
                    <span class="learner-info"><strong>{{ learner.name }}</strong><small>{{ learner.email }}</small></span>
                    <button
                        class="btn btn-outline-primary touch-target"
                        type="button"
                        :aria-label="`Connect ${learner.name}`"
                        :disabled="isBusy(`connect-${learner.id}`)"
                        @click="connect(learner)"
                    >
                        {{ isBusy(`connect-${learner.id}`) ? "Connecting..." : "Connect" }}
                    </button>
                </div>
            </form>
        </dialog>
    </div>
</template>

<style scoped lang="scss">
.students {
    max-width: 900px;
}
header {
    padding: 2rem 0 1rem;
}
.card {
    margin: 18px 0;
    padding: 18px;
    border: 1px solid var(--dt-divider);
    border-radius: 8px;
    background: rgba(128, 128, 128, 0.06);
}
.card h2 {
    font-size: 1.25rem;
}
.card-heading {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 12px;

    h2 {
        margin: 0;
    }
}
.learner-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-top: 12px;
    padding: 12px 0 0;
    border-top: 1px solid var(--dt-divider);
}
.learner-info {
    min-width: 0;
    overflow-wrap: anywhere;
}
.learner-row small {
    display: block;
    color: var(--dt-muted);
}
</style>
