#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const [dataDirectory, databaseName, bucketName] = process.argv.slice(2);

if (!dataDirectory || !databaseName || !bucketName) {
    throw new Error("Usage: node cloud/import-local.mjs <local-data-dir> <d1-database-name> <r2-bucket-name>");
}

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const run = (args) => {
    const result = spawnSync("npx", ["wrangler", ...args], { stdio: "inherit" });
    if (result.status !== 0) throw new Error(`wrangler ${args.slice(0, 3).join(" ")} failed`);
};

const tabsDirectory = join(dataDirectory, "tabs");
const entries = await readdir(tabsDirectory);
let imported = 0;

for (const id of entries) {
    const directory = join(tabsDirectory, id);
    if (id === "deleted" || !(await stat(directory)).isDirectory()) continue;
    const configPath = join(directory, "config.json");
    let config;
    try {
        config = JSON.parse(await readFile(configPath, "utf8"));
    } catch {
        console.warn(`Skipping ${id}: no readable config.json`);
        continue;
    }

    const sourcePath = join(directory, config.tab.filename);
    const sourceKey = `tabs/${id}/${config.tab.filename}`;
    run(["r2", "object", "put", `${bucketName}/${sourceKey}`, "--file", sourcePath, "--remote"]);

    const commands = [
        "BEGIN;",
        `INSERT INTO tab (id, title, artist, filename, original_filename, created_at, is_public, is_fav, object_key) VALUES (${quote(id)}, ${quote(config.tab.title)}, ${quote(config.tab.artist)}, ${
            quote(config.tab.filename)
        }, ${quote(config.tab.originalFilename)}, ${quote(config.tab.createdAt)}, ${config.tab.public ? 1 : 0}, ${config.tab.fav ? 1 : 0}, ${quote(sourceKey)});`,
    ];

    for (const audio of config.audio || []) {
        const localPath = join(directory, audio.filename);
        const key = `tabs/${id}/audio/${audio.filename}`;
        run(["r2", "object", "put", `${bucketName}/${key}`, "--file", localPath, "--remote"]);
        const contentType = audio.filename.toLowerCase().endsWith(".ogg") ? "audio/ogg" : "audio/mpeg";
        commands.push(
            `INSERT INTO tab_audio (tab_id, filename, object_key, content_type, sync_method, simple_sync, advanced_sync) VALUES (${quote(id)}, ${quote(audio.filename)}, ${quote(key)}, ${
                quote(contentType)
            }, ${quote(audio.syncMethod || "simple")}, ${Number(audio.simpleSync || 0)}, ${quote(audio.advancedSync || "")});`,
        );
    }

    for (const youtube of config.youtube || []) {
        commands.push(
            `INSERT INTO tab_youtube (tab_id, video_id, sync_method, simple_sync, advanced_sync) VALUES (${quote(id)}, ${quote(youtube.videoID)}, ${quote(youtube.syncMethod || "simple")}, ${
                Number(youtube.simpleSync || 0)
            }, ${quote(youtube.advancedSync || "")});`,
        );
    }

    commands.push("COMMIT;");
    run(["d1", "execute", databaseName, "--remote", "--command", commands.join("\n")]);
    imported++;
    console.log(`Imported tab ${id}`);
}

console.log(`Imported ${imported} tabs. Create the cloud account separately; local accounts are intentionally not migrated.`);
