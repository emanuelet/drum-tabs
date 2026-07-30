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
        };
    },
    methods: {
        async submit() {
            if (this.pin !== this.repeatPin) {
                notify({
                    title: "PINs do not match",
                    type: "error",
                });
                return;
            }

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
                notify({ title: "Account created. Log in with your PIN.", type: "success" });
                this.$router.push("/login");
            } catch (error) {
                notify({ title: error.message || "Registration failed", type: "error" });
            } finally {
                this.processing = false;
            }
        },
    },
});
</script>

<template>
    <div class="form-container" data-cy="setup-form">
        <div class="form">
            <form @submit.prevent="submit">
                <div style="font-size: 28px; font-weight: bold" class="mb-5 mt-5">
                    Drum Tabs
                </div>

                <p class="mt-3">
                    Create your account
                </p>

                <div class="form-floating mt-3">
                    <input id="name" v-model="name" type="text" class="form-control" placeholder="Name" required>
                    <label for="name">Name</label>
                </div>

                <div class="form-floating mt-3">
                    <input id="floatingInput" v-model="email" type="email" class="form-control" :placeholder='$t("Username")' required>
                    <label for="floatingInput">{{ $t("Email") }}</label>
                </div>

                <div class="form-floating mt-3">
                    <input id="pin" v-model="pin" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" class="form-control" placeholder="6-digit PIN" required>
                    <label for="pin">6-digit PIN</label>
                </div>

                <div class="form-floating mt-3">
                    <input id="repeat" v-model="repeatPin" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" class="form-control" placeholder="Repeat PIN" required>
                    <label for="repeat">Repeat PIN</label>
                </div>

                <div class="mt-3"><label for="role" class="form-label">I am a</label><select id="role" v-model="role" class="form-select"><option value="learner">Learner</option><option value="teacher">Teacher</option></select></div>

                <button class="w-100 btn btn-primary mt-3" type="submit" :disabled="processing">
                    {{ $t("Create") }}
                </button>
                <router-link class="d-block mt-3" to="/login">Already have an account? Log in</router-link>
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
</style>
