<script>
import { defineComponent } from "vue";
import { notify } from "@kyvg/vue3-notification";
import { baseURL } from "../app.js";

export default defineComponent({
    props: {
        resourceType: { type: String, required: true },
        resourceId: { type: [String, Number], required: true },
        resourceTitle: { type: String, required: true },
    },
    data() {
        return { students: [], learnerId: "", loading: false, assigning: false, opener: null };
    },
    computed: {
        selectId() {
            return `assign-learner-${this.resourceType}-${this.resourceId}`;
        },
    },
    methods: {
        async open(event) {
            this.opener = event?.currentTarget || null;
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
        onClose() {
            // The trigger is disabled while loading, so focus is restored explicitly
            this.opener?.focus();
        },
        async assign() {
            if (!this.learnerId || this.assigning) return;
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
    <span class="assign-button">
        <button class="btn btn-sm btn-outline-primary touch-target" type="button" :aria-label="`Assign ${resourceTitle}`" :aria-busy="loading" :disabled="loading" @click="open">
            {{ loading ? "Loading..." : "Assign" }}
        </button>
        <dialog ref="dialog" class="dt-dialog" style="--dt-dialog-width: 420px" :aria-labelledby="`${selectId}-title`" @close="onClose">
            <form @submit.prevent="assign">
                <div class="dt-dialog-heading">
                    <h2 :id="`${selectId}-title`">Assign {{ resourceTitle }}</h2>
                </div>
                <p v-if="students.length === 0" class="text-dt-muted">Connect a learner from Students before assigning practice.</p>
                <template v-else>
                    <label :for="selectId" class="form-label">Learner</label>
                    <select :id="selectId" v-model="learnerId" class="form-select">
                        <option v-for="student in students" :key="student.id" :value="student.id">{{ student.name }}</option>
                    </select>
                </template>
                <div class="dt-dialog-actions">
                    <button class="btn btn-outline-secondary" type="button" @click="$refs.dialog.close()">Cancel</button>
                    <button class="btn btn-primary" type="submit" :disabled="!learnerId || assigning">{{ assigning ? "Assigning..." : "Assign" }}</button>
                </div>
            </form>
        </dialog>
    </span>
</template>

<style scoped lang="scss">
.assign-button {
    display: contents;
}
</style>
