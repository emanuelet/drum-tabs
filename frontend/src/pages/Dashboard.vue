<script>
import { defineComponent } from "vue";
import { authClient, isLoggedIn } from "../auth-client.ts";
import Logo from "../components/Logo.vue";
import { clearMe, fetchMe } from "../me.ts";

export default defineComponent({
    components: {
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
        document.addEventListener("click", this.onDocumentClick);
        document.addEventListener("keydown", this.onKeydown);
        this.isLoggedIn = await isLoggedIn();
        if (this.isLoggedIn) {
            this.user = await fetchMe();
        }
        this.ready = true;
    },
    beforeUnmount() {
        document.removeEventListener("click", this.onDocumentClick);
        document.removeEventListener("keydown", this.onKeydown);
    },
    watch: {
        $route() {
            this.fixedNavbar = false;
            this.mobileMenuOpen = false;
        },
    },
    methods: {
        async signOut() {
            await authClient.signOut();
            clearMe();
            this.$router.push("/login");
        },
        onSetFixedHeader(val) {
            this.fixedNavbar = val;
        },
        onDocumentClick(event) {
            if (!this.mobileMenuOpen) return;
            if (!this.$refs.navbar?.contains(event.target)) {
                this.mobileMenuOpen = false;
            }
        },
        onKeydown(event) {
            if (event.key === "Escape" && this.mobileMenuOpen) {
                this.mobileMenuOpen = false;
                this.$refs.menuToggle?.focus();
            }
        },
    },
});
</script>

<template>
    <div :class='{
        "fixed-navbar": fixedNavbar,
    }'>
        <header ref="navbar" class="my-navbar">
            <Logo />

            <button
                ref="menuToggle"
                class="mobile-menu-toggle"
                type="button"
                aria-controls="mobile-navigation"
                aria-label="Menu"
                :aria-expanded="mobileMenuOpen"
                @click="mobileMenuOpen = !mobileMenuOpen"
            >
                <font-awesome-icon :icon='["fas", mobileMenuOpen ? "xmark" : "bars"]' />
            </button>

            <nav id="mobile-navigation" class="toolbar" aria-label="Main" :class="{ open: mobileMenuOpen }">
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
                        <font-awesome-icon :icon='["fas", "users"]' />
                        Students
                    </router-link>

                    <router-link to="/settings" v-if="isLoggedIn">
                        <font-awesome-icon :icon='["fas", "gear"]' />
                        Settings
                    </router-link>

                    <a class="metronome-link" href="https://drum-metronome.pages.dev/" target="_blank" rel="noopener noreferrer">
                        <font-awesome-icon :icon='["fas", "arrow-up-right-from-square"]' />
                        Drum Metronome
                        <span class="visually-hidden">(opens in a new tab)</span>
                    </a>
                </div>

                <div class="right" v-show="ready">
                    <button class="sign-out-link" type="button" @click="signOut()" v-if="isLoggedIn">
                        <font-awesome-icon :icon='["fas", "arrow-right-from-bracket"]' />
                        Log out
                    </button>

                    <router-link to="/login" v-else>
                        <font-awesome-icon :icon='["fas", "arrow-right-to-bracket"]' />
                        Log in
                    </router-link>
                </div>
            </nav>
        </header>

        <main id="main-content" tabindex="-1">
            <router-view v-slot="{ Component }">
                <component :is="Component" @setFixedHeader="onSetFixedHeader" />
            </router-view>
        </main>
    </div>
</template>

<style lang="scss" scoped>
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
        background-color: var(--dt-surface);
    }
}

.my-navbar {
    height: $navHeight;
    border-bottom: 1px solid var(--dt-divider);
    display: flex;
    justify-content: center;
    align-items: center;
    margin-bottom: 20px;

    .toolbar {
        padding: 0 clamp(12px, 3vw, 30px) 0 clamp(12px, 4vw, 40px);
        flex: 1;
        min-width: 0;
        display: flex;
        justify-content: space-between;
        column-gap: 16px;

        & > div {
            flex-grow: 4;
            min-width: 0;
            display: flex;
            flex-wrap: wrap;
            // shrinks with the viewport instead of a fixed 50px, so 768-1000px does not overflow
            column-gap: clamp(14px, 2.5vw, 50px);
            row-gap: 4px;

            &.left {
                justify-content: flex-start;
            }

            &.right {
                justify-content: flex-end;
            }

            & > a,
            & > button {
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 44px;
                min-width: 44px;

                // item from top to bottom
                flex-direction: column;
            }
        }

        svg {
            font-size: 20px;
        }

        .metronome-link {
            color: var(--dt-link-nav-metronome);
        }

        .sign-out-link {
            padding: 0;
            font: inherit;
            color: var(--dt-link-nav-signout);
            background: none;
            border: 0;
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
            background-color: var(--dt-surface);
            border-bottom: 1px solid var(--dt-divider);
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

                & > a,
                & > button {
                    width: 100%;
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
                    border-top: 1px solid var(--dt-divider);
                }
            }
        }

        .mobile-menu-toggle {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 44px;
            height: 44px;
            margin-left: auto;
            margin-right: 12px;
            padding: 0;
            font-size: 20px;
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
