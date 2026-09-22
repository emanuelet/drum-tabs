<script>
import { defineComponent } from "vue";
import { authClient } from "../auth-client.ts";
import { notify } from "@kyvg/vue3-notification";
import { baseURL } from "../app.js";
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
        };
    },
    methods: {
        async submit() {
            const pin = this.pinDigits.join("");
            if (pin.length !== 6) {
                return;
            }

            this.processing = true;
            this.error = "";

            const { data, error } = await authClient.signIn.email({
                email: this.email,
                password: pin,
                rememberMe: this.rememberMe,
            });

            if (error) {
                this.error = error.message;
                notify({
                    title: error.message,
                    type: "error",
                });
            } else {
                this.$router.push("/");
                notify({
                    title: "Logged in successfully",
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
    <div class="form-container" data-cy="setup-form">
        <div class="form">
            <form @submit.prevent="submit">
                <div class="brand mb-5 mt-4">
                    <Logo inline />
                    <div>Drum Tabs</div>
                </div>

                <div class="form-floating mt-3">
                    <input id="floatingInput" v-model="email" type="email" class="form-control" :placeholder='$t("Username")' required>
                    <label for="floatingInput">{{ $t("Email") }}</label>
                </div>

                <div class="mt-3 text-start" role="group" aria-labelledby="pin-label">
                    <label id="pin-label" class="form-label">6-digit PIN</label>
                    <div class="pin-inputs">
                        <input
                            v-for="(_, index) in pinDigits"
                            :key="index"
                            :id="`pin-${index}`"
                            ref="pinInputs"
                            :value="pinDigits[index]"
                            type="password"
                            inputmode="numeric"
                            pattern="[0-9]*"
                            maxlength="1"
                            :autocomplete="index === 0 ? 'one-time-code' : 'off'"
                            :aria-label="`PIN digit ${index + 1}`"
                            class="form-control pin-input"
                            required
                            @input="onPinInput(index, $event)"
                            @paste="onPinPaste(index, $event)"
                            @keydown="onPinKeydown(index, $event)"
                        >
                    </div>
                </div>

                <!-- Remember me -->
                <div class="mt-3">
                    <div class="form-check form-check-inline">
                        <input class="form-check-input" id="rememberMe" type="checkbox" v-model="rememberMe">
                        <label class="form-check-label" for="rememberMe">
                            {{ $t("Remember me") }}
                        </label>
                    </div>
                </div>

                <button class="w-100 btn btn-primary mt-3" type="submit" :disabled="processing">
                    {{ $t("Log in") }}
                </button>

                <div class="error text-danger mt-3" v-if="error">
                    {{ error }}
                </div>
                <router-link class="d-block mt-3" to="/register">Create an account</router-link>
            </form>
        </div>
    </div>
</template>

<style scoped lang="scss">
.form-container {
    display: flex;
    align-items: center;
    padding-top: 40px;
    padding-bottom: 40px;
}

.form {
    width: 100%;
    max-width: 330px;
    padding: 15px;
    margin: auto;
    text-align: center;
}

.brand {
    font-size: 28px;
    font-weight: bold;

    :deep(.navbar-brand) {
        display: block;
        margin: 0 auto 12px;
    }
}

.pin-inputs {
    display: flex;
    gap: 0.5rem;
}

.pin-input {
    min-width: 0;
    padding: 0.75rem 0;
    text-align: center;
}
</style>
