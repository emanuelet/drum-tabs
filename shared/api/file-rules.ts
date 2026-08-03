export const sourceFormats = new Set(["gp", "gpx", "gp3", "gp4", "gp5", "musicxml", "capx", "txt"]);
export const audioContentTypes = new Map([["mp3", "audio/mpeg"], ["ogg", "audio/ogg"]]);

export function extension(filename: string) {
    const value = filename.split(".").pop()?.toLowerCase();
    if (!value) throw new Error("File has no extension");
    return value;
}

export function safeFilename(filename: string) {
    if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes("..")) throw new Error("Invalid filename");
    return filename.replace(/[^A-Za-z0-9._ -]/g, "_");
}
