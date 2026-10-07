<script>
import { defineComponent } from "vue";
import { notify } from "@kyvg/vue3-notification";
import { baseURL } from "../app.js";
import Logo from "../components/Logo.vue";

export default defineComponent({
    components: { Logo },
    data() {
        return {
            processing: false,
            email: "",
            name: "",
            pin: "",
            repeatPin: "",
            role: "learner",
            errors: {},
            formError: "",
        };
    },
    methods: {
        validate() {
            const errors = {};
            if (!this.name.trim()) errors.name = "Enter your name.";
            if (!this.email.trim()) errors.email = "Enter your email.";
            else if (!/^\S+@\S+\.\S+$/.test(this.email.trim())) errors.email = "Enter a valid email address.";
            if (!/^\d{6}$/.test(this.pin)) errors.pin = "PIN must be exactly 6 digits.";
            if (this.pin !== this.repeatPin) errors.repeat = "PINs do not match.";
            this.errors = errors;
            const first = Object.keys(errors)[0];
            if (first) {
                const ids = { name: "name", email: "email", pin: "pin", repeat: "repeat" };
                document.getElementById(ids[first])?.focus();
            }
            return !first;
        },
        async submit() {
            this.formError = "";
            if (!this.validate()) return;

            this.processing = true;
            try {
                const res = await fetch(baseURL + "/api/register", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email: this.email, name: this.name, pin: this.pin, role: this.role }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || data.msg || "Registration failed");
                notify({ text: "Account created. Log in with your PIN.", type: "success" });
                this.$router.push("/login");
            } catch (error) {
                this.formError = error.message || "Registration failed";
            } finally {
                this.processing = false;
            }
        },
    },
});
</script>

<template>
    <main id="main-content" tabindex="-1" class="form-container" data-cy="setup-form">
        <div class="form">
            <form @submit.prevent="submit" novalidate>
                <div class="brand mb-4 mt-4">
                    <Logo inline />
                    <div class="brand-name">Drum Tabs</div>
                </div>

                <h1 class="fs-5 mt-3">
                    Create your account
                </h1>

                <div class="form-floating mt-3">
                    <input id="name" v-model="name" type="text" autocomplete="name" class="form-control" placeholder="Name" required :aria-invalid="!!errors.name"
                        :aria-describedby="errors.name ? 'name-error' : undefined">
                    <label for="name">Name</label>
                </div>
                <div v-if="errors.name" id="name-error" class="form-error" role="alert">{{ errors.name }}</div>

                <div class="form-floating mt-3">
                    <input id="email" v-model="email" type="email" autocomplete="email" class="form-control" placeholder="Email" required :aria-invalid="!!errors.email"
                        :aria-describedby="errors.email ? 'email-error' : undefined">
                    <label for="email">Email</label>
                </div>
                <div v-if="errors.email" id="email-error" class="form-error" role="alert">{{ errors.email }}</div>

                <div class="form-floating mt-3">
                    <input id="pin" v-model="pin" type="password" inputmode="numeric" autocomplete="new-password" maxlength="6" class="form-control" placeholder="6-digit PIN" required
                        :aria-invalid="!!errors.pin" :aria-describedby="errors.pin ? 'pin-error' : undefined">
                    <label for="pin">6-digit PIN</label>
                </div>
                <div v-if="errors.pin" id="pin-error" class="form-error" role="alert">{{ errors.pin }}</div>

                <div class="form-floating mt-3">
                    <input id="repeat" v-model="repeatPin" type="password" inputmode="numeric" autocomplete="new-password" maxlength="6" class="form-control" placeholder="Repeat PIN" required
                        :aria-invalid="!!errors.repeat" :aria-describedby="errors.repeat ? 'repeat-error' : undefined">
                    <label for="repeat">Repeat PIN</label>
                </div>
                <div v-if="errors.repeat" id="repeat-error" class="form-error" role="alert">{{ errors.repeat }}</div>

                <fieldset class="mt-3 text-start">
                    <legend class="form-label fs-6">I am a</legend>
                    <div class="btn-group toggle-group" role="group">
                        <input id="role-learner" v-model="role" type="radio" class="btn-check" name="role" value="learner">
                        <label class="btn btn-outline-secondary" for="role-learner">Learner</label>
                        <input id="role-teacher" v-model="role" type="radio" class="btn-check" name="role" value="teacher">
                        <label class="btn btn-outline-secondary" for="role-teacher">Teacher</label>
                    </div>
                </fieldset>

                <button class="w-100 btn btn-primary mt-3" type="submit" :disabled="processing">
                    {{ processing ? "Creating..." : "Create" }}
                </button>

                <div v-if="formError" class="form-error text-center mt-3" role="alert">{{ formError }}</div>
                <router-link class="d-block mt-3" to="/login">Already have an account? Log in</router-link>
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
    font-size: 28px;
    font-weight: bold;
}
</style>
