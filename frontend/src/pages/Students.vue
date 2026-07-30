<script>
import { defineComponent } from "vue";
import { baseURL } from "../app.js";
import { notify } from "@kyvg/vue3-notification";

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
            loading: true,
        };
    },
    async mounted() {
        try {
            await this.load();
        } catch (error) {
            notify({
                text: error.message || "Unable to load students",
                type: "error",
            });
            this.$router.push("/");
        } finally {
            this.loading = false;
        }
    },
    methods: {
        async request(path, options = {}) {
            const res = await fetch(baseURL + path, {
                credentials: "include",
                ...options,
            });
            const data = await res.json();
            if (!res.ok)
                throw new Error(data.msg || data.error || "Request failed");
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
        openSearch() {
            this.learnerQuery = "";
            this.searchResults = [];
            this.$refs.searchDialog.showModal();
        },
        async searchLearners() {
            if (this.learnerQuery.trim().length < 2) {
                this.searchResults = [];
                return;
            }
            this.searching = true;
            try {
                const data = await this.request(
                    `/api/learners?query=${encodeURIComponent(this.learnerQuery)}`,
                );
                const connected = new Set(
                    this.students.map((student) => student.id),
                );
                this.searchResults = data.learners.filter(
                    (learner) => !connected.has(learner.id),
                );
            } finally {
                this.searching = false;
            }
        },
        async connect(learner) {
            await this.request(`/api/students/${learner.id}`, {
                method: "POST",
            });
            await this.load();
            this.$refs.searchDialog.close();
            notify({ text: `${learner.name} connected`, type: "success" });
        },
        async disconnect(student) {
            if (
                !confirm(
                    `Disconnect ${student.name}? Their assignments from you will be removed.`,
                )
            )
                return;
            await this.request(`/api/students/${student.id}`, {
                method: "DELETE",
            });
            await this.load();
        },
        async revoke(assignment) {
            await this.request(`/api/assignments/${assignment.id}`, {
                method: "DELETE",
            });
            await this.load();
        },
        resourceTitle(assignment) {
            const list =
                assignment.resourceType === "exercise"
                    ? this.exercises
                    : this.tabs;
            return (
                list.find((item) => item.id === assignment.resourceId)?.title ||
                "Removed item"
            );
        },
        learnerName(id) {
            return (
                this.students.find((student) => student.id === id)?.name ||
                "Disconnected learner"
            );
        },
    },
});
</script>

<template>
    <main class="container students" v-if="!loading">
        <header>
            <p class="eyebrow">Teacher workspace</p>
            <h1>Students</h1>
            <p>
                Connect learners, then assign practice from the Tabs or
                Exercises lists.
            </p>
        </header>
        <section class="card">
            <div class="card-heading">
                <h2>Connected students</h2>
                <button class="btn btn-primary" @click="openSearch">
                    Connect learner
                </button>
            </div>
            <br />
            <p v-if="students.length === 0" class="text-muted">
                No learners connected yet.
            </p>
            <div
                v-for="student in students"
                :key="student.id"
                class="learner-row"
            >
                <span
                    ><strong>{{ student.name }}</strong
                    ><small>{{ student.email }}</small></span
                ><button
                    class="btn btn-outline-danger"
                    @click="disconnect(student)"
                >
                    Disconnect
                </button>
            </div>
        </section>
        <section class="card">
            <h2>Sent assignments</h2>
            <p v-if="assignments.length === 0" class="text-muted">
                No assignments sent yet.
            </p>
            <div
                v-for="assignment in assignments"
                :key="assignment.id"
                class="learner-row"
            >
                <span
                    ><strong>{{ resourceTitle(assignment) }}</strong
                    ><small
                        >To {{ learnerName(assignment.learnerId) }} ·
                        {{ assignment.resourceType }}</small
                    ></span
                ><button
                    class="btn btn-outline-danger"
                    @click="revoke(assignment)"
                >
                    Revoke
                </button>
            </div>
        </section>
        <dialog ref="searchDialog" class="search-dialog">
            <form @submit.prevent="searchLearners">
                <div class="dialog-heading">
                    <h2>Connect learner</h2>
                    <button
                        class="btn-close"
                        type="button"
                        aria-label="Close"
                        @click="$refs.searchDialog.close()"
                    ></button>
                </div>
                <label for="learnerSearch">Search by name or email</label
                ><input
                    id="learnerSearch"
                    v-model="learnerQuery"
                    class="form-control mt-2"
                    type="search"
                    placeholder="Enter at least 2 characters"
                    @input="searchLearners"
                />
                <p v-if="searching" class="text-muted mt-3">Searching...</p>
                <p
                    v-else-if="
                        learnerQuery.length >= 2 && searchResults.length === 0
                    "
                    class="text-muted mt-3"
                >
                    No unconnected learners found.
                </p>
                <div
                    v-for="learner in searchResults"
                    :key="learner.id"
                    class="learner-row"
                >
                    <span
                        ><strong>{{ learner.name }}</strong
                        ><small>{{ learner.email }}</small></span
                    ><button
                        class="btn btn-outline-primary"
                        type="button"
                        @click="connect(learner)"
                    >
                        Connect
                    </button>
                </div>
            </form>
        </dialog>
    </main>
</template>

<style scoped lang="scss">
.students {
    max-width: 900px;
}
header {
    padding: 2rem 0 1rem;
}
.eyebrow {
    color: #d87d30;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}
.card {
    margin: 18px 0;
    padding: 18px;
    border: 1px solid #555;
    border-radius: 8px;
    background: rgba(128, 128, 128, 0.06);
}
.card h2 {
    font-size: 1.25rem;
}
.card-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
}
.learner-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-top: 12px;
    padding: 12px 0;
    border-top: 1px solid #555;
}
.learner-row small {
    display: block;
    opacity: 0.7;
}
.search-dialog {
    width: min(560px, calc(100vw - 32px));
    padding: 24px;
    color: inherit;
    background: #212529;
    border: 1px solid #555;
    border-radius: 8px;
}
.search-dialog::backdrop {
    background: rgba(0, 0, 0, 0.55);
}
.dialog-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
}
</style>
