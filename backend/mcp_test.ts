import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { assert, assertEquals } from "jsr:@std/assert@^1.0.17";

const dataDir = await Deno.makeTempDir();
Deno.env.set("DATA_DIR", dataDir);

const { createMcpServer } = await import("./mcp.ts");

function base64(bytes: number[]) {
    return new Uint8Array(bytes).toBase64();
}

Deno.test("MCP server manages the complete tab library lifecycle", async () => {
    const server = createMcpServer();
    const client = new Client({ name: "drum-tabs-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
        const tools = await client.listTools();
        assertEquals(tools.tools.map((tool: { name: string }) => tool.name).sort(), [
            "tabs_create",
            "tabs_delete",
            "tabs_get",
            "tabs_list",
            "tabs_manage_audio",
            "tabs_manage_youtube",
            "tabs_read_file",
            "tabs_replace_file",
            "tabs_update",
        ]);

        const create = await client.callTool({
            name: "tabs_create",
            arguments: { filename: "exercise.gp", contentBase64: base64([1, 2, 3]), title: "Exercise", artist: "Drummer" },
        });
        assert(!create.isError);
        const created = JSON.parse(create.content[0].text) as { tab: { id: string; title: string } };
        assertEquals(created.tab.title, "Exercise");
        const id = created.tab.id;

        const update = await client.callTool({
            name: "tabs_update",
            arguments: { id, title: "Updated Exercise", artist: "Drummer", public: true, fav: true },
        });
        assert(!update.isError);

        const readTab = await client.callTool({ name: "tabs_read_file", arguments: { id, kind: "tab", offset: 0, length: 2 } });
        const tabChunk = JSON.parse(readTab.content[0].text) as { contentBase64: string; nextOffset: number };
        assertEquals(tabChunk.contentBase64, base64([1, 2]));
        assertEquals(tabChunk.nextOffset, 2);

        const addAudio = await client.callTool({
            name: "tabs_manage_audio",
            arguments: { action: "add", id, filename: "guide.mp3", contentBase64: base64([4, 5, 6]) },
        });
        assert(!addAudio.isError);
        const updateAudio = await client.callTool({
            name: "tabs_manage_audio",
            arguments: { action: "update", id, filename: "guide.mp3", syncMethod: "simple", simpleSync: 250, advancedSync: "" },
        });
        assert(!updateAudio.isError);

        const readAudio = await client.callTool({ name: "tabs_read_file", arguments: { id, kind: "audio", filename: "guide.mp3", offset: 0, length: 1024 } });
        const audioChunk = JSON.parse(readAudio.content[0].text) as { contentBase64: string };
        assertEquals(audioChunk.contentBase64, base64([4, 5, 6]));

        const addYoutube = await client.callTool({ name: "tabs_manage_youtube", arguments: { action: "add", id, videoID: "abc123" } });
        assert(!addYoutube.isError);
        const updateYoutube = await client.callTool({
            name: "tabs_manage_youtube",
            arguments: { action: "update", id, videoID: "abc123", syncMethod: "simple", simpleSync: 100, advancedSync: "" },
        });
        assert(!updateYoutube.isError);

        const replace = await client.callTool({ name: "tabs_replace_file", arguments: { id, filename: "exercise.gpx", contentBase64: base64([7, 8]) } });
        assert(!replace.isError);

        const removeAudio = await client.callTool({ name: "tabs_manage_audio", arguments: { action: "remove", id, filename: "guide.mp3", confirm: true } });
        assert(!removeAudio.isError);
        const removeYoutube = await client.callTool({ name: "tabs_manage_youtube", arguments: { action: "remove", id, videoID: "abc123", confirm: true } });
        assert(!removeYoutube.isError);

        const remove = await client.callTool({ name: "tabs_delete", arguments: { id, confirm: true } });
        assert(!remove.isError);
        const list = await client.callTool({ name: "tabs_list", arguments: { query: "Updated Exercise" } });
        const listed = JSON.parse(list.content[0].text) as { tabs: unknown[] };
        assertEquals(listed.tabs.length, 0);
    } finally {
        await client.close();
        await server.close();
    }
});
