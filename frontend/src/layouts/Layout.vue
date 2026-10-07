<script setup lang="ts">
import { useRoute } from "vue-router";
import { Notifications } from "@kyvg/vue3-notification";
import { computed, ref } from "vue";
import ConfirmDialog from "../components/ConfirmDialog.vue";
const route = useRoute();

// @ts-ignore
const version = ref(appVersion);
const hideFooter = computed(() => route.meta?.hideFooter);

function skipToContent() {
    const main = document.getElementById("main-content");
    main?.focus();
    main?.scrollIntoView();
}
</script>

<template>
    <div>
        <a class="skip-link" href="#main-content" @click.prevent="skipToContent">Skip to main content</a>

        <!-- Add :key to disable vue router re-use the same component -->
        <router-view :key="route.fullPath" />

        <footer v-if="!hideFooter" class="my-5">
            Drum Tabs
            <span class="version me-3">{{ version }}</span>
            <a href="https://github.com/louislam/its-mytabs" target="_blank" rel="noreferrer">Forked from louislam/its-mytabs</a>
        </footer>

        <notifications position="top right" />
        <ConfirmDialog />
    </div>
</template>

<style lang="scss" scoped>
footer {
    text-align: center;
    font-size: 0.9rem;
    color: var(--dt-muted);

    a {
        color: var(--dt-muted);
    }
}
</style>
