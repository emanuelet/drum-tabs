import * as fs from "@std/fs";
import { DatabaseSync } from "node:sqlite";
import * as path from "@std/path";
import { dataDir, getSourceDir, isDemoMode, tabDir } from "./util.ts";
import { getNextTabID } from "./tab.ts";
import { AudioDataSchema, ConfigJSONSchema, TabInfoSchema, YoutubeSchema } from "./zod.ts";
import { UserRole, UserRoleSchema } from "./zod.ts";

let dbPath = path.join(dataDir, "config.db");

let isInitDatabase = false;

if (!await fs.exists(dbPath)) {
    isInitDatabase = true;
    await Deno.copyFile(path.join(getSourceDir(), "./extra/config-template.db"), dbPath);
}

export const db = new DatabaseSync(dbPath);
export const kv = await Deno.openKv(dbPath);

export interface Learner {
    id: string;
    name: string;
    email: string;
}

export interface Assignment {
    id: string;
    teacherId: string;
    teacherName: string;
    learnerId: string;
    resourceType: "exercise" | "tab";
    resourceId: string;
    createdAt: string;
}

if (isInitDatabase) {
    await addDemoTab();
}

export function isInitDB() {
    return isInitDatabase;
}

export function hasUser() {
    // For demo mode, always return true
    if (isDemoMode) {
        return true;
    }

    const row = db.prepare("SELECT COUNT(*) as count FROM user").get();
    if (!row) {
        throw new Error("User table not found");
    }
    if (typeof row.count !== "number") {
        throw new Error("Invalid count value");
    }
    return row.count > 0;
}

export async function addDemoTab() {
    try {
        const demoTabPath = path.join(getSourceDir(), "./extra/demo-tab.gp");
        const id = await getNextTabID();
        const dir = path.join(tabDir, id.toString());
        await Deno.mkdir(dir);

        // Copy demo tab file
        await Deno.copyFile(demoTabPath, path.join(dir, "tab.gp"));

        // Create config.json with the new structure
        const configJson = ConfigJSONSchema.parse({
            tab: {
                id: id.toString(),
                title: "Hare no Hi ni (Bass Only)",
                artist: "Reira Ushio",
                filename: "tab.gp",
                originalFilename: "汐れいら-ハレの日に (Bass Only)-09-18-2025.gp",
                createdAt: "2025-09-26T07:29:56.450Z",
                public: isDemoMode,
                fav: false,
            },
            audio: [],
            youtube: [
                {
                    videoID: "VuKSlOT__9s",
                    syncMethod: "simple",
                    simpleSync: 2900,
                    advancedSync: "",
                },
            ],
        });

        const configPath = path.join(dir, "config.json");
        await Deno.writeTextFile(configPath, JSON.stringify(configJson, null, 2));
    } catch (e) {
        console.log("Skip: Failed to add demo tab:", e);
    }
}

export async function migrate() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_role (
            user_id TEXT PRIMARY KEY,
            role TEXT NOT NULL CHECK (role IN ('teacher', 'learner')),
            FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS teacher_student (
            teacher_id TEXT NOT NULL,
            learner_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (teacher_id, learner_id),
            FOREIGN KEY (teacher_id) REFERENCES user(id) ON DELETE CASCADE,
            FOREIGN KEY (learner_id) REFERENCES user(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS assignment (
            id TEXT PRIMARY KEY,
            teacher_id TEXT NOT NULL,
            learner_id TEXT NOT NULL,
            resource_type TEXT NOT NULL CHECK (resource_type IN ('exercise', 'tab')),
            resource_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (teacher_id) REFERENCES user(id) ON DELETE CASCADE,
            FOREIGN KEY (learner_id) REFERENCES user(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS assignment_learner_idx ON assignment(learner_id);
        CREATE INDEX IF NOT EXISTS assignment_teacher_idx ON assignment(teacher_id);
    `);

    // Existing installations only had a single administrator, so retain that access.
    db.prepare("INSERT OR IGNORE INTO user_role (user_id, role) SELECT id, 'teacher' FROM user").run();

    let migratedCount = 0;
    let skippedCount = 0;
    let hasRecord = false;

    const tabIter = kv.list({ prefix: ["tab"] });

    for await (const entry of tabIter) {
        if (!hasRecord) {
            hasRecord = true;
            console.log("Starting migration from KV to config.json...");
        }

        try {
            const key = entry.key;
            // Key format: ["tab", id] where id is a number
            if (key.length !== 2 || key[0] !== "tab") {
                continue;
            }

            const oldId = key[1];
            const id = String(oldId);
            const tabDirPath = path.join(tabDir, id);
            const configPath = path.join(tabDirPath, "config.json");

            // Skip if config.json already exists
            if (await fs.exists(configPath)) {
                console.log(`Skipping tab ${id}: config.json already exists`);
                skippedCount++;
                continue;
            }

            // Skip if directory doesn't exist
            if (!await fs.exists(tabDirPath)) {
                console.log(`Skipping tab ${id}: directory doesn't exist`);
                skippedCount++;
                continue;
            }

            // Parse old tab info
            const oldTabData = entry.value as Record<string, unknown>;
            const tab = TabInfoSchema.parse({
                ...oldTabData,
                id: id, // Convert to string
            });

            // Get youtube entries for this tab
            const youtubeList: ReturnType<typeof YoutubeSchema.parse>[] = [];
            const youtubeIter = kv.list({ prefix: ["youtube", oldId] });
            for await (const ytEntry of youtubeIter) {
                try {
                    const ytData = ytEntry.value as Record<string, unknown>;
                    youtubeList.push(YoutubeSchema.parse(ytData));
                } catch (e) {
                    console.warn(`Failed to parse youtube entry for tab ${id}:`, ytEntry.key, e);
                }
            }

            // Get audio entries for this tab
            const audioList: ReturnType<typeof AudioDataSchema.parse>[] = [];
            const audioIter = kv.list({ prefix: ["audio", oldId] });
            for await (const audioEntry of audioIter) {
                try {
                    const audioData = audioEntry.value as Record<string, unknown>;
                    audioList.push(AudioDataSchema.parse(audioData));
                } catch (e) {
                    console.warn(`Failed to parse audio entry for tab ${id}:`, audioEntry.key, e);
                }
            }

            // Create config.json
            const configJson = ConfigJSONSchema.parse({
                tab,
                audio: audioList,
                youtube: youtubeList,
            });

            await Deno.writeTextFile(configPath, JSON.stringify(configJson, null, 2));
            console.log(`Migrated tab ${id}: ${tab.title} (${youtubeList.length} youtube, ${audioList.length} audio)`);

            // Delete old KV records
            await kv.delete(["tab", oldId]);
            for await (const ytEntry of kv.list({ prefix: ["youtube", oldId] })) {
                await kv.delete(ytEntry.key);
            }
            for await (const audioEntry of kv.list({ prefix: ["audio", oldId] })) {
                await kv.delete(audioEntry.key);
            }

            migratedCount++;
        } catch (e) {
            console.error(`Failed to migrate tab entry:`, entry.key, e);
        }
    }

    if (!hasRecord) {
        return;
    }

    console.log(`Migration complete: ${migratedCount} migrated, ${skippedCount} skipped`);
}

export function setUserRole(userId: string, role: UserRole) {
    db.prepare("INSERT INTO user_role (user_id, role) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET role = excluded.role").run(userId, role);
}

export function getUserRole(userId: string): UserRole {
    const row = db.prepare("SELECT role FROM user_role WHERE user_id = ?").get(userId) as { role?: unknown } | undefined;
    return UserRoleSchema.safeParse(row?.role).data || "learner";
}

export function searchLearners(query: string): Learner[] {
    const term = query.trim();
    if (term.length < 2) return [];
    const match = `%${term}%`;
    return db.prepare(
        `SELECT user.id, user.name, user.email FROM user INNER JOIN user_role ON user_role.user_id = user.id WHERE user_role.role = 'learner' AND (user.name LIKE ? COLLATE NOCASE OR user.email LIKE ? COLLATE NOCASE) ORDER BY user.name COLLATE NOCASE LIMIT 20`,
    )
        .all(match, match) as unknown as Learner[];
}

export function connectStudent(teacherId: string, learnerId: string) {
    if (getUserRole(learnerId) !== "learner") throw new Error("Learner not found");
    db.prepare("INSERT OR IGNORE INTO teacher_student (teacher_id, learner_id, created_at) VALUES (?, ?, ?)").run(teacherId, learnerId, new Date().toISOString());
}

export function disconnectStudent(teacherId: string, learnerId: string) {
    db.prepare("DELETE FROM teacher_student WHERE teacher_id = ? AND learner_id = ?").run(teacherId, learnerId);
    db.prepare("DELETE FROM assignment WHERE teacher_id = ? AND learner_id = ?").run(teacherId, learnerId);
}

export function getStudents(teacherId: string): Learner[] {
    return db.prepare(
        `SELECT user.id, user.name, user.email FROM teacher_student INNER JOIN user ON user.id = teacher_student.learner_id WHERE teacher_student.teacher_id = ? ORDER BY user.name COLLATE NOCASE`,
    ).all(teacherId) as unknown as Learner[];
}

export function isConnectedStudent(teacherId: string, learnerId: string) {
    return !!db.prepare("SELECT 1 FROM teacher_student WHERE teacher_id = ? AND learner_id = ?").get(teacherId, learnerId);
}

export function createAssignment(teacherId: string, learnerId: string, resourceType: "exercise" | "tab", resourceId: string) {
    if (!isConnectedStudent(teacherId, learnerId)) throw new Error("Learner is not connected to this teacher");
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO assignment (id, teacher_id, learner_id, resource_type, resource_id, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
        id,
        teacherId,
        learnerId,
        resourceType,
        resourceId,
        new Date().toISOString(),
    );
    return id;
}

export function deleteAssignment(teacherId: string, assignmentId: string) {
    db.prepare("DELETE FROM assignment WHERE id = ? AND teacher_id = ?").run(assignmentId, teacherId);
}

export function getTeacherAssignments(teacherId: string): Assignment[] {
    return db.prepare(
        `SELECT assignment.id, assignment.teacher_id AS teacherId, user.name AS teacherName, assignment.learner_id AS learnerId, assignment.resource_type AS resourceType, assignment.resource_id AS resourceId, assignment.created_at AS createdAt FROM assignment INNER JOIN user ON user.id = assignment.teacher_id WHERE assignment.teacher_id = ? ORDER BY assignment.created_at DESC`,
    ).all(teacherId) as unknown as Assignment[];
}

export function getLearnerAssignments(learnerId: string): Assignment[] {
    return db.prepare(
        `SELECT assignment.id, assignment.teacher_id AS teacherId, user.name AS teacherName, assignment.learner_id AS learnerId, assignment.resource_type AS resourceType, assignment.resource_id AS resourceId, assignment.created_at AS createdAt FROM assignment INNER JOIN user ON user.id = assignment.teacher_id WHERE assignment.learner_id = ? ORDER BY assignment.created_at DESC`,
    ).all(learnerId) as unknown as Assignment[];
}
