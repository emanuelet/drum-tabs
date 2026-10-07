<script>
import { defineComponent } from "vue";
import { notify } from "@kyvg/vue3-notification";
import { baseURL, getSetting } from "../app.js";
import { isLoggedIn } from "../auth-client.js";
import TabItem from "../components/TabItem.vue";
import { SettingSchema } from "../zod.ts";
import { confirmAction } from "../confirm.ts";
import { fetchMe } from "../me.ts";

export default defineComponent({
    components: {
        TabItem,
    },

    data() {
        return {
            tabList: [],
            ready: false,
            loading: true,
            loadError: "",
            isLoggedIn: false,
            searchQuery: "",
            setting: {},
            user: null,
        };
    },

    async mounted() {
        this.isLoggedIn = await isLoggedIn();
        this.setting = getSetting();

        if (!this.isLoggedIn) {
            this.$router.push("/login");
            return;
        }

        await this.load();
    },

    computed: {
        filteredTabList() {
            if (!this.searchQuery.trim()) return this.tabList;

            const query = this.searchQuery.trim().toLowerCase();

            return this.tabList.filter((tab) => {
                const title = (tab.title || "").toLowerCase();
                const artist = (tab.artist || "").toLowerCase();
                return title.includes(query) || artist.includes(query);
            });
        },

        favoritedTabs() {
            return this.tabList.filter((tab) => tab.fav);
        },

        groupedTabs() {
            const groups = {};

            for (const tab of this.filteredTabList) {
                const rawArtist = tab.artist || "Unknown Artist";

                // Normalize for grouping (ignore case + trim)
                const key = rawArtist.trim().toLowerCase();

                if (!groups[key]) {
                    groups[key] = {
                        displayName: rawArtist.trim() || "Unknown Artist",
                        tabs: [],
                    };
                }

                groups[key].tabs.push(tab);
            }

            // Sort artists alphabetically
            const sortedArtists = Object.values(groups).sort((a, b) => a.displayName.localeCompare(b.displayName));

            // Sort songs alphabetically inside each artist
            sortedArtists.forEach((group) => {
                group.tabs.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
            });

            return sortedArtists;
        },
    },

    methods: {
        async load() {
            this.loading = true;
            this.loadError = "";
            try {
                const [tabsRes, user] = await Promise.all([
                    fetch(baseURL + "/api/tabs", { credentials: "include" }),
                    fetchMe(),
                ]);
                const data = await tabsRes.json();
                if (!tabsRes.ok) throw new Error(data.msg || "Unable to load tabs");
                this.tabList = data.tabs;
                this.user = user;
                this.ready = true;

                await this.$nextTick();
                this.$refs.searchInput?.focus();
            } catch (error) {
                this.loadError = error.message || "Unable to load tabs";
            } finally {
                this.loading = false;
            }
        },

        handleFavToggled() {
            // Force re-render by creating a new array reference
            this.tabList = [...this.tabList];
        },

        persistSetting() {
            const setting = SettingSchema.parse(this.setting);
            this.setting = setting;
            localStorage.setItem("userSetting", JSON.stringify(setting));
        },

        async deleteTab(id, title, artist) {
            const name = [artist, title].filter(Boolean).join(" - ");
            const ok = await confirmAction({
                title: "Delete tab?",
                message: `Delete "${name}"? This cannot be undone.`,
                confirmText: "Delete",
            });
            if (!ok) return;

            try {
                const res = await fetch(baseURL + `/api/tab/${id}`, {
                    method: "DELETE",
                    credentials: "include",
                });

                if (res.status === 200) {
                    this.tabList = this.tabList.filter((tab) => tab.id !== id);

                    notify({
                        text: "Tab deleted successfully",
                        type: "success",
                    });
                } else {
                    const data = await res.json();
                    throw new Error(data.message || "Failed to delete tab");
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
    <div class="container my-container">
        <h1 class="visually-hidden">Tabs</h1>

        <div v-if="loading" class="state-block" role="status">
            <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Loading tabs...
        </div>

        <div v-else-if="loadError" class="state-block" role="alert">
            <p class="mb-3">{{ loadError }}</p>
            <button class="btn btn-outline-primary" type="button" @click="load">Retry</button>
        </div>

        <div v-else-if="ready && tabList.length === 0" class="state-block">
            <p class="fs-5 mb-1">Your tab library is empty.</p>
            <p class="mb-3">Upload a Guitar Pro, MusicXML or text tab to get started.</p>
            <router-link class="btn btn-primary" to="/new-tab">
                <font-awesome-icon :icon='["fas", "plus"]' />
                Add your first tab
            </router-link>
        </div>

        <template v-else-if="ready">
            <div class="search-section mb-3 mt-4 pe-3 ps-3">
                <div class="search-row">
                    <div class="input-group">
                        <span class="input-group-text">
                            <font-awesome-icon icon="magnifying-glass" />
                        </span>

                        <label for="tabSearch" class="visually-hidden">Search tabs by title or artist</label>
                        <input id="tabSearch" type="text" class="form-control search-input" v-model="searchQuery"
                            placeholder="Search by title or artist..." ref="searchInput" />

                        <button class="btn btn-outline-secondary" type="button"
                            @click='searchQuery = ""' v-if="searchQuery" aria-label="Clear search">
                            <font-awesome-icon icon="xmark" />
                        </button>
                    </div>

                    <router-link class="btn btn-primary new-tab-button" to="/new-tab">
                    <font-awesome-icon :icon='["fas", "plus"]' />
                    New Tab
                </router-link>
                </div>
            </div>

            <div class="tab-list-controls mb-4 ms-3 me-3">
                <div aria-live="polite">
                Total Tabs: {{ filteredTabList.length }}
                <span v-if="searchQuery" class="text-dt-muted">
                    (of {{ tabList.length }})
                </span>
            </div>

                <div class="form-check form-switch mb-0">
                    <input id="groupByArtist" v-model="setting.groupByArtist" class="form-check-input" type="checkbox"
                        role="switch" @change="persistSetting" />
                    <label class="form-check-label" for="groupByArtist">Group by artist</label>
                </div>
            </div>

            <!-- Favorites stay near the tab list, not above primary controls. -->
            <div class="favorites-section" v-if="favoritedTabs.length > 0">
                <TabItem v-for="tab in favoritedTabs" :key="`fav-${tab.id}`" :tab="tab" :show-artist="true"
                    :can-assign="user?.role === 'teacher'" :can-show-teacher-assignment="user?.role === 'learner'"
                    @delete="deleteTab" @favToggled="handleFavToggled" />
            </div>

            <template v-if="setting.groupByArtist && groupedTabs">
                <div v-for="group in groupedTabs" :key="group.displayName" class="mb-4 ms-3">
                    <h2 class="artist-heading">{{ group.displayName }}</h2>

                    <TabItem v-for="tab in group.tabs" :key="tab.id" :tab="tab" :show-artist="false"
                        :can-assign="user?.role === 'teacher'" :can-show-teacher-assignment="user?.role === 'learner'"
                        @delete="deleteTab" @favToggled="handleFavToggled" />
                </div>
            </template>

            <template v-else>
                <TabItem v-for="tab in filteredTabList" :key="tab.id" :tab="tab" :show-artist="true"
                    :can-assign="user?.role === 'teacher'" :can-show-teacher-assignment="user?.role === 'learner'"
                    @delete="deleteTab" @favToggled="handleFavToggled" />
            </template>

            <div v-if="filteredTabList.length === 0 && searchQuery" class="empty-state text-center py-5 mb-4 fs-5">
                <p class="text-dt-muted">No tabs found for "{{ searchQuery }}"</p>

                <button class="btn btn-outline-secondary" @click='searchQuery = ""'>
                Clear search
            </button>
            </div>
        </template>
    </div>
</template>

<style scoped lang="scss">
.artist-heading {
    margin-bottom: 0.5rem;
    font-size: 1.5rem;
    color: var(--dt-muted);
}

.tab-list-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 16px;
}

.search-row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;

    .input-group {
        flex: 1 1 220px;
        min-width: 0;
    }

    .form-control,
    .btn,
    .input-group-text {
        min-height: 44px;
    }
}

.new-tab-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    white-space: nowrap;
}

// New Tab takes a full row below the search field on phones
@media (max-width: 575px) {
    .new-tab-button {
        flex: 1 1 100%;
    }
}
</style>
