<script>
import { defineComponent } from "vue";
import { authClient } from "../auth-client.ts";
import { notify } from "@kyvg/vue3-notification";
import { clearMe } from "../me.ts";
import Logo from "../components/Logo.vue";

export default defineComponent({
    components: { Logo },
    data() {
        return {
            processing: false,
            email: "",
            pinDigits: Array(6).fill(""),
            rememberMe: true,
            error: "",
            pinError: "",
        };
    },
    methods: {
        async submit() {
            const pin = this.pinDigits.join("");
            this.error = "";
            this.pinError = "";
            if (!this.email.trim()) {
                this.error = "Enter your email.";
                document.getElementById("floatingInput")?.focus();
                return;
            }
            if (pin.length !== 6) {
                this.pinError = "Enter all 6 digits of your PIN.";
                const firstEmpty = this.pinDigits.findIndex((digit) => !digit);
                this.focusPin(firstEmpty === -1 ? 0 : firstEmpty);
                return;
            }

            this.processing = true;

            const { data, error } = await authClient.signIn.email({
                email: this.email,
                password: pin,
                rememberMe: this.rememberMe,
            });

            if (error) {
                this.error = error.message || "Log in failed. Check your email and PIN.";
            } else {
                clearMe();
                this.$router.push("/");
                notify({
                    text: "Logged in successfully",
                    type: "success",
                });
            }

            this.processing = false;
        },
        updatePin(index, value) {
            const digits = value.replace(/\D/g, "").slice(0, 6 - index);
            const pinDigits = [...this.pinDigits];

            if (!digits) {
                pinDigits[index] = "";
            } else {
                for (const [offset, digit] of [...digits].entries()) {
                    pinDigits[index + offset] = digit;
                }
            }

            this.pinDigits = pinDigits;
            this.pinError = "";
            if (digits) {
                this.focusPin(Math.min(index + digits.length, 5));
            }
        },
        onPinInput(index, event) {
            this.updatePin(index, event.target.value);
        },
        onPinPaste(index, event) {
            event.preventDefault();
            this.updatePin(index, event.clipboardData.getData("text"));
        },
        onPinKeydown(index, event) {
            if (event.key === "Backspace" && !this.pinDigits[index] && index > 0) {
                this.pinDigits[index - 1] = "";
                this.focusPin(index - 1);
            }
        },
        focusPin(index) {
            this.$nextTick(() => this.$refs.pinInputs[index]?.focus());
        },
    },
});
</script>

<template>
    <main id="main-content" tabindex="-1" class="form-container" data-cy="setup-form">
        <div class="form">
            <form @submit.prevent="submit" novalidate>
                <div class="brand mb-5 mt-4">
                    <Logo inline />
                    <h1 class="brand-name">Drum Tabs</h1>
                    <p class="visually-hidden">Log in</p>
                </div>

                <div class="form-floating mt-3">
                    <input id="floatingInput" v-model="email" name="username" type="email" autocomplete="username" class="form-control" placeholder="Email" required :aria-invalid="!!error"
                        :aria-describedby="error ? 'login-error' : undefined">
                    <label for="floatingInput">Email</label>
                </div>

                <div class="mt-3 text-start" role="group" aria-labelledby="pin-label" :aria-describedby="pinError ? 'pin-error' : undefined">
                    <label id="pin-label" class="form-label">6-digit PIN</label>
                    <div class="pin-inputs">
                        <input
                            v-for="(_, index) in pinDigits"
                            :key="index"
                            :id="`pin-${index}`"
                            ref="pinInputs"
                            :value="pinDigits[index]"
                            type="password"
                            :name="index === 0 ? 'password' : undefined"
                            inputmode="numeric"
                            pattern="[0-9]*"
                            :maxlength="index === 0 ? 6 : 1"
                            :autocomplete="index === 0 ? 'current-password' : 'off'"
                            :aria-label="`PIN digit ${index + 1} of 6`"
                            :aria-invalid="!!pinError"
                            class="form-control pin-input"
                            @input="onPinInput(index, $event)"
                            @change="onPinInput(index, $event)"
                            @paste="onPinPaste(index, $event)"
                            @keydown="onPinKeydown(index, $event)"
                        >
                    </div>
                    <div v-if="pinError" id="pin-error" class="form-error" role="alert">{{ pinError }}</div>
                </div>

                <!-- Remember me -->
                <div class="mt-3">
                    <div class="form-check form-check-inline">
                        <input class="form-check-input" id="rememberMe" type="checkbox" v-model="rememberMe">
                        <label class="form-check-label" for="rememberMe">
                            Remember me
                        </label>
                    </div>
                </div>

                <button class="w-100 btn btn-primary mt-3" type="submit" :disabled="processing">
                    {{ processing ? "Logging in..." : "Log in" }}
                </button>

                <div id="login-error" class="form-error text-center mt-3" v-if="error" role="alert">
                    {{ error }}
                </div>
                <router-link class="d-block mt-3" to="/register">Create an account</router-link>
            </form>
        </div>
    </main>
</template>

<style scoped lang="scss">
.brand {
    :deep(.navbar-brand) {
        display: block;
        margin: 0 auto 12px;
    }
}

.brand-name {
    margin: 0;
    font-size: 28px;
    font-weight: bold;
}

.pin-inputs {
    display: flex;
    gap: 0.5rem;
}

.pin-input {
    min-width: 0;
    min-height: 48px;
    padding: 0.75rem 0;
    text-align: center;
}
</style>
