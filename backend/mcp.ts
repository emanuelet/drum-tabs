import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as path from "@std/path";
import * as z from "zod";
import { supportedAudioFormatList, supportedFormatList } from "./common.ts";
import { migrate } from "./db.ts";
import {
    addAudio,
    addYoutube,
    createTab,
    deleteTab,
    getAllTabs,
    getConfigJSON,
    getTab,
    getTabFilePath,
    getTabFolderFullPath,
    removeAudio,
    removeYoutube,
    replaceTab,
    updateAudio,
    updateConfigJSON,
    updateYoutube,
} from "./tab.ts";
import { checkFilename } from "./util.ts";

const maxFileBytes = 20 * 1024 * 1024;
const maxReadBytes = 1024 * 1024;

const idSchema = z.string().min(1).max(64).refine((id) => !id.includes("/") && !id.includes("\\") && !id.includes(".."), "Invalid tab id");
const filenameSchema = z.string().min(1).max(255).refine((filename) => !filename.includes("/") && !filename.includes("\\") && !filename.includes(".."), "Invalid filename");
const base64Schema = z.string().min(1).max(Math.ceil(maxFileBytes / 3) * 4 + 4);
const syncSchema = {
    syncMethod: z.enum(["simple", "advanced"]).optional(),
    simpleSync: z.number().finite().optional(),
    advancedSync: z.string().optional(),
};

type ListArgs = { query?: string; fav?: boolean; public?: boolean };
type IdArgs = { id: string };
type CreateArgs = { filename: string; contentBase64: string; title: string; artist: string };
type UpdateArgs = { id: string; title: string; artist: string; public: boolean; fav: boolean };
type ReplaceArgs = { id: string; filename: string; contentBase64: string };
type ReadFileArgs = { id: string; kind: "tab" | "audio"; filename?: string; offset: number; length: number };
type AudioArgs = {
    action: "add" | "update" | "remove";
    id: string;
    filename: string;
    contentBase64?: string;
    confirm?: true;
    syncMethod?: "simple" | "advanced";
    simpleSync?: number;
    advancedSync?: string;
};
type YoutubeArgs = {
    action: "add" | "update" | "remove";
    id: string;
    videoID: string;
    confirm?: true;
    syncMethod?: "simple" | "advanced";
    simpleSync?: number;
    advancedSync?: string;
};

function result(data: unknown) {
    return {
        content: [{ type: "text" as const, text: JSON.stringify(data) }],
        structuredContent: data as Record<string, unknown>,
    };
}

function errorResult(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: { message } }) }],
        isError: true,
    };
}

async function handle(callback: () => Promise<unknown>) {
    try {
        return result(await callback());
    } catch (error) {
        return errorResult(error);
    }
}

function getExtension(filename: string, supportedFormats: string[]) {
    checkFilename(filename);
    const extension = path.extname(filename).slice(1).toLowerCase();
    if (!supportedFormats.includes(extension)) {
        throw new Error(`Unsupported file format: .${extension || "(none)"}`);
    }
    return extension;
}

function decodeBase64(contentBase64: string) {
    try {
        const data = Uint8Array.fromBase64(contentBase64, { alphabet: "base64", lastChunkHandling: "strict" });
        if (data.byteLength > maxFileBytes) {
            throw new Error(`File exceeds the ${maxFileBytes} byte limit`);
        }
        return data;
    } catch (error) {
        if (error instanceof Error && error.message.startsWith("File exceeds")) {
            throw error;
        }
        throw new Error("contentBase64 must be valid base64 data");
    }
}

async function readFileChunk(filePath: string, offset: number, length: number) {
    const info = await Deno.stat(filePath);
    if (!info.isFile) {
        throw new Error("File not found");
    }
    if (offset >= info.size) {
        return { sizeBytes: info.size, contentBase64: "", nextOffset: null };
    }

    const file = await Deno.open(filePath, { read: true });
    try {
        await file.seek(offset, Deno.SeekMode.Start);
        const bytes = new Uint8Array(Math.min(length, info.size - offset));
        const bytesRead = await file.read(bytes) ?? 0;
        const nextOffset = offset + bytesRead < info.size ? offset + bytesRead : null;
        return { sizeBytes: info.size, contentBase64: bytes.subarray(0, bytesRead).toBase64(), nextOffset };
    } finally {
        file.close();
    }
}

async function getConfig(id: string) {
    const config = await getConfigJSON(id);
    if (!config) {
        throw new Error("Tab not found");
    }
    return config;
}

function getSyncRequest(syncMethod: "simple" | "advanced" | undefined, simpleSync: number | undefined, advancedSync: string | undefined) {
    if (syncMethod === undefined || simpleSync === undefined || advancedSync === undefined) {
        throw new Error("syncMethod, simpleSync, and advancedSync are required when action is update");
    }
    return { syncMethod, simpleSync, advancedSync };
}

export function createMcpServer() {
    const server = new McpServer({ name: "drum-tabs", version: "1.0.0" });

    server.registerTool(
        "tabs_list",
        {
            description: "List tab-library metadata. Use query to match title or artist, and fav/public to filter exact boolean values.",
            inputSchema: { query: z.string().max(200).optional(), fav: z.boolean().optional(), public: z.boolean().optional() },
        },
        ({ query, fav, public: isPublic }: ListArgs) =>
            handle(async () => {
                const normalizedQuery = query?.trim().toLowerCase();
                const tabs = (await getAllTabs()).filter((tab) => {
                    const matchesQuery = !normalizedQuery || tab.title.toLowerCase().includes(normalizedQuery) || tab.artist.toLowerCase().includes(normalizedQuery);
                    return matchesQuery && (fav === undefined || tab.fav === fav) && (isPublic === undefined || tab.public === isPublic);
                });
                return { tabs };
            }),
    );

    server.registerTool(
        "tabs_get",
        { description: "Get one tab's metadata, audio sources, and YouTube associations. Does not return file bytes.", inputSchema: { id: idSchema } },
        ({ id }: IdArgs) => handle(async () => getConfig(id)),
    );

    server.registerTool(
        "tabs_create",
        {
            description: "Create a tab from a supported Guitar Pro or MusicXML file. contentBase64 is the complete file encoded as base64 and is limited to 20 MiB.",
            inputSchema: { filename: filenameSchema, contentBase64: base64Schema, title: z.string().min(1).max(500), artist: z.string().max(500).default("") },
        },
        ({ filename, contentBase64, title, artist }: CreateArgs) =>
            handle(async () => {
                const extension = getExtension(filename, supportedFormatList);
                const id = await createTab(decodeBase64(contentBase64), extension, title.trim(), artist.trim(), filename);
                return getConfig(id);
            }),
    );

    server.registerTool(
        "tabs_update",
        {
            description: "Replace a tab's title, artist, public visibility, and favorite status. Provide every metadata field; omitted fields are not preserved.",
            inputSchema: { id: idSchema, title: z.string().min(1).max(500), artist: z.string().max(500), public: z.boolean(), fav: z.boolean() },
        },
        ({ id, title, artist, public: isPublic, fav }: UpdateArgs) =>
            handle(async () => {
                await updateConfigJSON(id, async (config) => {
                    config.tab.title = title.trim();
                    config.tab.artist = artist.trim();
                    config.tab.public = isPublic;
                    config.tab.fav = fav;
                });
                return getConfig(id);
            }),
    );

    server.registerTool(
        "tabs_replace_file",
        {
            description: "Replace a tab's score file. The previous file is preserved in its tab folder. contentBase64 is the complete replacement file encoded as base64 and is limited to 20 MiB.",
            inputSchema: { id: idSchema, filename: filenameSchema, contentBase64: base64Schema },
        },
        ({ id, filename, contentBase64 }: ReplaceArgs) =>
            handle(async () => {
                const extension = getExtension(filename, supportedFormatList);
                await replaceTab(await getTab(id), decodeBase64(contentBase64), extension, filename);
                return getConfig(id);
            }),
    );

    server.registerTool(
        "tabs_read_file",
        {
            description:
                "Read a tab or audio file as a bounded base64 chunk. Use kind=tab for the score file; use kind=audio plus filename for an attached audio file. Continue with nextOffset until null.",
            inputSchema: {
                id: idSchema,
                kind: z.enum(["tab", "audio"]),
                filename: filenameSchema.optional(),
                offset: z.number().int().min(0).default(0),
                length: z.number().int().min(1).max(maxReadBytes).default(65536),
            },
        },
        ({ id, kind, filename, offset, length }: ReadFileArgs) =>
            handle(async () => {
                const tab = await getTab(id);
                let filePath = getTabFilePath(tab);
                let resolvedFilename = tab.filename;
                if (kind === "audio") {
                    if (!filename) {
                        throw new Error("filename is required when kind is audio");
                    }
                    getExtension(filename, supportedAudioFormatList);
                    filePath = path.join(getTabFolderFullPath(tab), filename);
                    resolvedFilename = filename;
                }
                return { filename: resolvedFilename, ...await readFileChunk(filePath, offset, length) };
            }),
    );

    server.registerTool(
        "tabs_delete",
        {
            description: "Move a tab into the library's recoverable deleted folder. This changes the library; confirm must be true.",
            inputSchema: { id: idSchema, confirm: z.literal(true) },
        },
        ({ id }: IdArgs) =>
            handle(async () => {
                await deleteTab(id);
                return { deleted: true, id };
            }),
    );

    server.registerTool(
        "tabs_manage_audio",
        {
            description:
                "Manage local audio for a tab. action=add requires contentBase64; action=update requires syncMethod, simpleSync (milliseconds), and advancedSync; action=remove requires confirm=true.",
            inputSchema: {
                action: z.enum(["add", "update", "remove"]),
                id: idSchema,
                filename: filenameSchema,
                contentBase64: base64Schema.optional(),
                confirm: z.literal(true).optional(),
                ...syncSchema,
            },
        },
        ({ action, id, filename, contentBase64, confirm, syncMethod, simpleSync, advancedSync }: AudioArgs) =>
            handle(async () => {
                const tab = await getTab(id);
                if (action === "add") {
                    if (!contentBase64) throw new Error("contentBase64 is required when action is add");
                    getExtension(filename, supportedAudioFormatList);
                    await addAudio(tab, decodeBase64(contentBase64), filename);
                } else if (action === "update") {
                    await updateAudio(tab, filename, getSyncRequest(syncMethod, simpleSync, advancedSync));
                } else {
                    if (!confirm) throw new Error("confirm must be true when action is remove");
                    await removeAudio(tab, filename);
                }
                return getConfig(id);
            }),
    );

    server.registerTool(
        "tabs_manage_youtube",
        {
            description:
                "Manage YouTube associations. action=add adds a video ID; action=update requires syncMethod, simpleSync (milliseconds), and advancedSync; action=remove requires confirm=true.",
            inputSchema: {
                action: z.enum(["add", "update", "remove"]),
                id: idSchema,
                videoID: z.string().min(1).max(100),
                confirm: z.literal(true).optional(),
                ...syncSchema,
            },
        },
        ({ action, id, videoID, confirm, syncMethod, simpleSync, advancedSync }: YoutubeArgs) =>
            handle(async () => {
                if (action === "add") {
                    await addYoutube(id, videoID);
                } else if (action === "update") {
                    await updateYoutube(id, videoID, getSyncRequest(syncMethod, simpleSync, advancedSync));
                } else {
                    if (!confirm) throw new Error("confirm must be true when action is remove");
                    await removeYoutube(id, videoID);
                }
                return getConfig(id);
            }),
    );

    return server;
}

if (import.meta.main) {
    await migrate();
    const server = createMcpServer();
    await server.connect(new StdioServerTransport());
}
