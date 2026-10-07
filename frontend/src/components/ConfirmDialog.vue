<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { confirmState, settleConfirm } from "../confirm.ts";

const dialog = ref<HTMLDialogElement | null>(null);
let opener: HTMLElement | null = null;

watch(() => confirmState.open, async (open) => {
    const el = dialog.value;
    if (!el) return;
    if (open && !el.open) {
        opener = document.activeElement as HTMLElement | null;
        el.showModal();
        await nextTick();
        // Safe default focus for destructive actions
        el.querySelector<HTMLElement>("[data-cancel]")?.focus();
    } else if (!open && el.open) {
        el.close();
    }
});

function onClose() {
    // Fires on Escape and on programmatic close
    if (confirmState.open) settleConfirm(false);
    if (opener && document.contains(opener)) opener.focus();
    opener = null;
}
</script>

<template>
    <dialog ref="dialog" class="dt-dialog" style="--dt-dialog-width: 440px" aria-labelledby="confirm-title" aria-describedby="confirm-message" @close="onClose">
        <h2 id="confirm-title">{{ confirmState.title }}</h2>
        <p id="confirm-message" class="mt-3 mb-0">{{ confirmState.message }}</p>
        <div class="dt-dialog-actions">
            <button type="button" class="btn btn-outline-secondary" data-cancel @click="settleConfirm(false)">{{ confirmState.cancelText }}</button>
            <button type="button" class="btn" :class="confirmState.danger ? 'btn-danger' : 'btn-primary'" @click="settleConfirm(true)">{{ confirmState.confirmText }}</button>
        </div>
    </dialog>
</template>
