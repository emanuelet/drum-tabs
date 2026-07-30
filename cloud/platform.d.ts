interface Fetcher {
    fetch(request: Request): Promise<Response>;
}

interface D1Result<T = unknown> {
    results: T[];
    meta: { changes: number };
}

interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    first<T = unknown>(): Promise<T | null>;
    all<T = unknown>(): Promise<D1Result<T>>;
    run(): Promise<D1Result>;
}

interface D1Database {
    prepare(query: string): D1PreparedStatement;
}

interface R2Object {
    httpEtag: string;
    httpMetadata: R2HTTPMetadata;
    writeHttpMetadata(headers: Headers): void;
}

interface R2ObjectBody extends R2Object {
    body: ReadableStream<Uint8Array>;
}

interface R2HTTPMetadata {
    contentType?: string;
    contentDisposition?: string;
}

interface R2Bucket {
    get(key: string): Promise<R2ObjectBody | null>;
    put(key: string, value: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | string | Blob, options?: { httpMetadata?: R2HTTPMetadata }): Promise<R2Object | null>;
    delete(key: string | string[]): Promise<void>;
}
