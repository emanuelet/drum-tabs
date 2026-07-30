/// <reference path="./platform.d.ts" />

export interface Env {
    ASSETS: Fetcher;
    DB: D1Database;
    TABS_BUCKET: R2Bucket;
    APP_ORIGIN: string;
    AUTH_SECRET: string;
    YATTEE_USERNAME?: string;
    YATTEE_PASSWORD?: string;
    YATTEE_BASE_URL?: string;
}
