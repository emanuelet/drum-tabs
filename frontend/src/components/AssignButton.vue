<script>
import { defineComponent } from "vue";
import { notify } from "@kyvg/vue3-notification";
import { baseURL } from "../app.js";

export default defineComponent({
    props: {
        outline: { type: Boolean, default: false },
        resourceType: { type: String, required: true },
        resourceId: { type: String, required: true },
        resourceTitle: { type: String, required: true },
    },
    data() {
        return { students: [], learnerId: "", loading: false, assigning: false };
    },
    methods: {
        async open() {
            this.loading = true;
            try {
                const res = await fetch(baseURL + "/api/students", { credentials: "include" });
                const data = await res.json();
                if (!res.ok) throw new Error(data.msg || "Unable to load students");
                this.students = data.students;
                this.learnerId = this.students[0]?.id || "";
                this.$refs.dialog.showModal();
            } catch (error) {
                notify({ text: error.message || "Unable to load students", type: "error" });
            } finally {
                this.loading = false;
            }
        },
        async assign() {
            if (!this.learnerId) return;
            this.assigning = true;
            try {
                const res = await fetch(baseURL + "/api/assignments", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ learnerId: this.learnerId, resourceType: this.resourceType, resourceId: this.resourceId }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.msg || "Unable to assign");
                this.$refs.dialog.close();
                notify({ text: "Assignment sent", type: "success" });
            } catch (error) {
                notify({ text: error.message || "Unable to assign", type: "error" });
            } finally {
                this.assigning = false;
            }
        },
    },
});
</script>

<template>
    <button class="btn btn-sm" :class="outline ? 'btn-outline-primary' : 'btn-primary me-2' " type="button" :disabled="loading" @click="open">Assign</button>
    <dialog ref="dialog" class="assign-dialog">
        <form @submit.prevent="assign">
            <h2>Assign {{ resourceTitle }}</h2>
            <p v-if="students.length === 0" class="text-muted">Connect a learner from Students before assigning practice.</p>
            <select v-else v-model="learnerId" class="form-select"><option v-for="student in students" :key="student.id" :value="student.id">{{ student.name }}</option></select>
            <div class="actions"><button class="btn btn-outline-secondary" type="button" @click="$refs.dialog.close()">Cancel</button><button class="btn btn-primary" type="submit" :disabled="!learnerId || assigning">Assign</button></div>
        </form>
    </dialog>
</template>

<style scoped lang="scss">
.assign-dialog { width: min(420px, calc(100vw - 32px)); padding: 24px; color: inherit; background: #212529; border: 1px solid #555; border-radius: 8px; }
.assign-dialog::backdrop { background: rgba(0, 0, 0, .55); }
.assign-dialog h2 { margin: 0 0 16px; font-size: 1.25rem; }
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
</style>
