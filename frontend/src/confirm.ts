import { reactive } from "vue";

export interface ConfirmOptions {
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    /** Style the confirm button as destructive (default true). */
    danger?: boolean;
}

export const confirmState = reactive({
    open: false,
    title: "Are you sure?",
    message: "",
    confirmText: "Confirm",
    cancelText: "Cancel",
    danger: true,
});

let pending: ((value: boolean) => void) | null = null;

/** Promise-based replacement for window.confirm(). Rendered by <ConfirmDialog /> in Layout. */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
    // Resolve any dialog that is still open as cancelled
    pending?.(false);
    Object.assign(confirmState, {
        title: options.title ?? "Are you sure?",
        message: options.message,
        confirmText: options.confirmText ?? "Confirm",
        cancelText: options.cancelText ?? "Cancel",
        danger: options.danger ?? true,
        open: true,
    });
    return new Promise<boolean>((resolve) => {
        pending = resolve;
    });
}

export function settleConfirm(result: boolean) {
    confirmState.open = false;
    pending?.(result);
    pending = null;
}
