# Inline Drum Editor Plan

## Goal

Let authorized tab editors change drum notes directly on the rendered score without risking silent overwrites or modifying the original tab until an explicit save.

## Scope

- Edit existing drum hits and add/remove hits in a selected beat.
- Support velocity and drum articulation only when alphaTab exposes a stable mapping.
- Keep the first release private to the tab owner and authorized teachers.
- Do not port the fork's guitar string/fret popover.

## Implementation

1. Define the edit model in `shared/api/ports.ts` and validate it in `backend/zod.ts`.
   - Addresses use track, staff, bar, voice, beat, and percussion-note identifiers.
   - Requests carry the tab's revision identifier.

2. Enforce mutation authorization before adding editor routes.
   - Update `shared/api/tab-mutation-routes.ts` and `backend/main.ts` so only the tab owner or teacher can create, update, discard, or save a draft.
   - Reject stale revisions with `409 Conflict`.

3. Add bounded server-side draft sessions in `backend/tab-edit.ts`.
   - Copy the source tab to a private temporary file.
   - Bind each opaque session token to tab ID, user ID, revision, expiry, and byte limit.
   - Delete drafts on discard, save, expiry, and server shutdown where possible.

4. Build a focused score overlay in `frontend/src/pages/Tab.vue` or a dedicated `frontend/src/components/DrumNoteEditor.vue`.
   - Enable it only for logged-in users with edit permission and drum tracks.
   - Use alphaTab note bounds to target beats.
   - Autosave only to the draft; expose explicit Save and Discard states.

5. Export and reload safely.
   - Apply edits to a clean score parsed from the original draft bytes.
   - Export the supported Guitar Pro format and replace the source only after explicit Save succeeds.
   - Preserve playback range, selected track, and current audio source across reload.

6. Test the complete lifecycle.
   - Unit-test address resolution, edit validation, stale revisions, authorization, and draft expiry.
   - Add Playwright coverage for edit, draft autosave, discard, save, reload, and concurrent-save conflict.

## Definition Of Done

- Unauthorized users cannot create or access drafts.
- A second editor cannot silently replace a newer saved revision.
- Discard leaves the original file byte-identical.
- Save persists only the selected drum changes and retains valid playback.
