<script>
import { defineComponent } from "vue";
import { BButton, BButtonGroup, BFormInput, BSpinner } from "bootstrap-vue-next";
import { authClient, isLoggedIn } from "../auth-client.ts";
import Logo from "../components/Logo.vue";
import { baseURL } from "../app.ts";

export default defineComponent({
    components: {
        BButton,
        BButtonGroup,
        BFormInput,
        BSpinner,
        Logo,
    },
    data() {
        return {
            isLoggedIn: false,
            ready: false,
            fixedNavbar: false,
            mobileMenuOpen: false,
            user: null,
        };
    },
    async mounted() {
        this.isLoggedIn = await isLoggedIn();
        if (this.isLoggedIn) {
            const res = await fetch(baseURL + "/api/me", { credentials: "include" });
            if (res.ok) this.user = (await res.json()).user;
        }
        this.ready = true;
    },
    watch: {
        $route() {
            this.fixedNavbar = false;
            this.mobileMenuOpen = false;
        },
    },
    methods: {
        async signOut() {
            const res = await authClient.signOut();
            this.$router.push("/login");
        },
        onSetFixedHeader(val) {
            this.fixedNavbar = val;
        },
    },
});
</script>

<template>
    <div :class='{
        "fixed-navbar": fixedNavbar,
    }'>
        <div class="my-navbar">
            <Logo />

            <button class="mobile-menu-toggle" type="button" aria-controls="mobile-navigation" :aria-expanded="mobileMenuOpen" @click="mobileMenuOpen = !mobileMenuOpen">Menu</button>

            <div id="mobile-navigation" class="toolbar" :class="{ open: mobileMenuOpen }">
                <div class="left" v-show="ready">
                    <router-link to="/" v-if="isLoggedIn">
                        <font-awesome-icon :icon='["fas", "folder"]' />
                        Tabs
                    </router-link>

                    <router-link to="/exercises" v-if="isLoggedIn">
                        <font-awesome-icon :icon='["fas", "play"]' />
                        Exercises
                    </router-link>

                    <router-link to="/students" v-if="user?.role === 'teacher'">
                        <font-awesome-icon :icon='["fas", "folder"]' />
                        Students
                    </router-link>

                    <router-link to="/settings">
                        <font-awesome-icon :icon='["fas", "gear"]' />
                        Settings
                    </router-link>

                    <a class="metronome-link" href="https://drum-metronome.pages.dev/" target="_blank" rel="noopener noreferrer">
                        <font-awesome-icon :icon='["fas", "arrow-up-right-from-square"]' />
                        Drum Metronome
                    </a>
                </div>

                <div class="right" v-show="ready">
                    <a class="sign-out-link" href="#" @click.prevent="signOut()" v-if="isLoggedIn">
                        <font-awesome-icon :icon='["fas", "arrow-right-from-bracket"]' />
                        Log out
                    </a>

                    <router-link to="/login" v-else>
                        <font-awesome-icon :icon='["fas", "arrow-right-to-bracket"]' />
                        Log in
                    </router-link>
                </div>
            </div>
        </div>

        <router-view v-slot="{ Component }">
            <component :is="Component" @setFixedHeader="onSetFixedHeader" />
        </router-view>
    </div>
</template>

<style lang="scss" scoped>
@use "../styles/vars.scss" as *;

$navHeight: 100px;

.fixed-navbar {
    .my-navbar {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 1000;
        width: 100vw;
        margin-bottom: 0;
        background-color: #212529;
    }
}

.my-navbar {
    height: $navHeight;
    border-bottom: 1px solid #3c3b40;
    display: flex;
    justify-content: center;
    align-items: center;
    margin-bottom: 20px;

    [data-bs-theme="light"] & {
        border-bottom-color: #dadada;
    }

    .toolbar {
        padding: 0 30px 0 40px;
        flex: 1;
        display: flex;
        justify-content: space-between;

        & > div {
            flex-grow: 4;
            display: flex;
            column-gap: 50px;

            &.left {
                justify-content: flex-start;
            }

            &.right {
                justify-content: flex-end;
            }

            & > a {
                display: flex;
                align-items: center;
                justify-content: center;

                // item from top to bottom
                flex-direction: column;
            }
        }

        svg {
            font-size: 20px;
        }

        .metronome-link {
            color: #9fd6ff;
        }

        .sign-out-link {
            color: #ffb1b8;
        }
    }

    .mobile-menu-toggle {
        display: none;
    }
}

.fixed-navbar {
    padding-top: $navHeight + 20px;
}

.mobile {
    $navHeightMobile: 75px;

    .my-navbar {
        position: relative;
        z-index: 1001;
        min-height: $navHeightMobile;
        flex-wrap: wrap;

        .navbar-brand {
            width: $navHeightMobile;
            height: $navHeightMobile;
            font-size: 15px;
        }

        .toolbar {
            position: absolute;
            top: 100%;
            right: 0;
            left: 0;
            z-index: 1002;
            flex-basis: 100%;
            display: none;
            padding: 8px 16px 16px;
            background-color: #212529;
            border-bottom: 1px solid #3c3b40;
            box-shadow: 0 8px 16px rgb(0 0 0 / 18%);

            &.open {
                display: flex;
                flex-direction: column;
            }

            & > div {
                display: flex;
                flex-direction: column;
                gap: 0;

                &.left,
                &.right {
                    justify-content: stretch;
                }

                & > a {
                    flex-direction: row;
                    justify-content: flex-start;
                    gap: 14px;
                    min-height: 48px;
                    padding: 10px 12px;
                    border-radius: 6px;
                    font-size: 17px;

                    &:hover,
                    &:focus-visible {
                        background: rgb(255 255 255 / 10%);
                    }

                    svg {
                        width: 20px;
                        font-size: 18px;
                    }
                }

                &.right {
                    margin-top: 8px;
                    padding-top: 8px;
                    border-top: 1px solid #3c3b40;
                }
            }
        }

        .mobile-menu-toggle {
            display: block;
            margin-left: auto;
            margin-right: 12px;
            padding: 6px 10px;
            color: inherit;
            background: transparent;
            border: 1px solid currentColor;
            border-radius: 4px;
        }
    }

    .fixed-navbar {
        padding-top: $navHeightMobile + 20px;
    }
}
</style>
