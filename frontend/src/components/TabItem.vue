<script>
import { defineComponent } from "vue";
import { notify } from "@kyvg/vue3-notification";
import { baseURL } from "../app.js";
import AssignButton from "./AssignButton.vue";

export default defineComponent({
    components: { AssignButton },
    props: {
        tab: {
            type: Object,
            required: true,
        },
        showArtist: {
            type: Boolean,
            default: true,
        },
        canAssign: {
            type: Boolean,
            default: false,
        },
        canShowTeacherAssignment: {
            type: Boolean,
            default: false,
        },
    },

    emits: ["delete", "favToggled"],

    methods: {
        handleEdit() {
            this.$router.push(`/tab/${this.tab.id}/edit/info`);
        },

        handleDelete() {
            this.$emit("delete", this.tab.id, this.tab.title, this.tab.artist);
        },

        async toggleFav() {
            const newFavStatus = !this.tab.fav;

            try {
                const res = await fetch(baseURL + `/api/tab/${this.tab.id}/fav`, {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        fav: newFavStatus,
                    }),
                });

                if (res.status === 200) {
                    this.tab.fav = newFavStatus;
                    this.$emit("favToggled");
                } else {
                    const data = await res.json();
                    throw new Error(data.message || "Failed to update favorite status");
                }
            } catch (error) {
                notify({
                    text: error.message,
                    type: "error",
                });
            }
        },
    },
});
</script>

<template>
    <div class="tab-item p-3 rounded">
        <button
            class="fav-star"
            type="button"
            :class='{ active: tab.fav }'
            :aria-label="tab.fav ? `Remove ${tab.title} from favorites` : `Add ${tab.title} to favorites`"
            :aria-pressed="!!tab.fav"
            @click="toggleFav"
        >
            <font-awesome-icon
                :icon='tab.fav ? "star" : ["far", "star"]'
            />
        </button>

        <router-link class="info" :to="`/tab/${tab.id}`">
            <div class="title">{{ tab.title }}</div>
            <div class="artist" v-if="showArtist">{{ tab.artist }}</div>
            <small v-if="canShowTeacherAssignment && tab.teacherAssignment" class="teacher-badge">From {{ tab.teacherAssignment.teacherName }}</small>
        </router-link>

        <div class="actions">
            <AssignButton v-if="canAssign" resource-type="tab" :resource-id="tab.id" :resource-title="tab.title" />
            <button class="btn btn-outline-secondary icon-btn" type="button" :aria-label="`Edit ${tab.title}`" @click="handleEdit">
                <font-awesome-icon icon="pen" />
                <span class="d-none d-md-inline">Edit</span>
            </button>

            <button class="btn btn-outline-danger icon-btn" type="button" :aria-label="`Delete ${tab.title}`" @click="handleDelete">
                <font-awesome-icon icon="trash-can" />
                <span class="d-none d-md-inline">Delete</span>
            </button>
        </div>
    </div>
</template>

<style scoped lang="scss">
.tab-item {
    display: flex;
    align-items: center;
    gap: 8px;
    transition: background-color 0.1s;

    &:hover {
        background-color: rgba(128, 128, 128, 0.08);
    }

    .info {
        flex: 1 1 0;
        min-width: 0;
        display: flex;
        flex-direction: column;
        justify-content: center;
        overflow-wrap: anywhere;

        .title {
            font-size: 20px;
        }

        .artist {
            color: var(--dt-muted);
        }

        .teacher-badge {
            color: var(--dt-accent);
            font-weight: 700;
        }
    }

    .actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: none;
    }
}

// Narrow screens: title keeps the full row, actions drop below it
@media (max-width: 575px) {
    .tab-item {
        flex-wrap: wrap;

        .actions {
            flex: 1 0 100%;
            justify-content: flex-end;
        }
    }
}
</style>
