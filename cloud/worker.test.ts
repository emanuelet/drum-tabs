import { describe, expect, it } from "vitest";
import { isSignUpDisabled } from "./auth.ts";
import { registrationBody, safeFilename, tabValue } from "./worker.ts";

describe("cloud worker helpers", () => {
    it("rejects object-key traversal", () => {
        expect(() => safeFilename("../private.mp3")).toThrow("Invalid filename");
        expect(() => safeFilename("folder/song.mp3")).toThrow("Invalid filename");
    });

    it("preserves the API tab shape", () => {
        expect(tabValue({
            id: "tab-1",
            title: "Song",
            artist: "Artist",
            filename: "tab.gp",
            original_filename: "song.gp",
            created_at: "2026-01-01T00:00:00.000Z",
            is_public: 1,
            is_fav: 0,
            object_key: "tabs/tab-1/tab.gp",
            deleted_at: null,
        })).toEqual({
            id: "tab-1",
            title: "Song",
            artist: "Artist",
            filename: "tab.gp",
            originalFilename: "song.gp",
            createdAt: "2026-01-01T00:00:00.000Z",
            public: true,
            fav: false,
        });
    });

    it("maps the registration PIN to Better Auth's password field", () => {
        expect(registrationBody({ email: "drummer@example.com", name: "Drummer", pin: "123456", role: "learner" })).toEqual({
            email: "drummer@example.com",
            name: "Drummer",
            password: "123456",
        });
    });

    it("respects the Cloud signup-disable binding", () => {
        expect(isSignUpDisabled({ MYTABS_DISABLE_SIGN_UP: "true" })).toBe(true);
        expect(isSignUpDisabled({ MYTABS_DISABLE_SIGN_UP: "false" })).toBe(false);
        expect(isSignUpDisabled({})).toBe(false);
    });
});
