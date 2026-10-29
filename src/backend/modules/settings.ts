/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type {Settings} from '../../types/SettingsTypes';


// src/settings-csv.ts
import * as dotenv from 'dotenv';
import crypto from 'node:crypto';
import fs from 'node:fs';

// Load env before anything else.
// Priority: E2E_DOTENV_FILE > .env.e2e (when NODE_ENV=e2e) > .env
const envPath =
    process.env.E2E_DOTENV_FILE ??
    (process.env.NODE_ENV === "e2e" ? ".env.e2e" : ".env");
dotenv.config({path: envPath});

const defaults: Settings = {
    initialized: false,
    appName: "Surveyor",
    rootUrl: "http://localhost:3000",

    dbType: "mariadb",
    dbHost: "localhost",
    dbPort: 3306,
    dbUser: "user",
    dbPassword: "password",
    dbName: "database",

    smtpPool: true,
    smtpHost: "smtp.example.com",
    smtpPort: 465,
    smtpSecure: true,
    smtpEmail: "test@example.com",
    smtpUser: "username",
    smtpPassword: "password",
    emailAccentColor: "#6d5dfc",

    oidcEnabled: false,
    oidcName: "OIDC Provider",
    oidcClientId: "CLIENT_ID",
    oidcClientSecret: "CLIENT_SECRET",
    oidcIssuerBaseUrl: "http://example.com",
    oidcRedirectUrl: "http://localhost:3000/users/oidc/callback",
    // Email claims acquire local identity only when the operator explicitly trusts
    // that provider's policy. Replacing an existing binding requires its own opt-in.
    oidcLinkByEmail: false,
    oidcAllowEmailRebinding: false,

    localLoginEnabled: true,

    sessionSecret:
        "CHANGE__" + crypto.randomBytes(32).toString("base64url").slice(0, 20),
    appPort: 3000,

    file: "./settings.csv",

    invoiceDir: "uploads/invoices/",
    invoiceRetentionMonths: 6,
    // A fresh installation archives expired dated roots after the waiting period.
    // Deployments may disable the job or choose a different delay through the normal
    // settings-file/environment precedence below; feature code uses this store only.
    autoArchiveEnabled: true,
    autoArchiveAfterDays: 30,
    headerImgDir: "uploads/headerImgs/",

    imprintUrl: "http://example.com/imprint",
    privacyPolicyUrl: "http://example.com/privacy",

    activityAvailabilityWeight: 0.30,
    activitySwapOptimizationIterations: 10,
    activityArrivalDeparturePenalty: 0.2,
    activityMaxDurationDays: 366,

    // Every identity entry consumes the same configured admission owners; limits
    // never depend on a browser component or on a submitted password value.
    authLoginClientLimit: 30,
    authLoginFailureClientLimit: 10,
    authLoginAccountLimit: 10,
    authLoginWindowMinutes: 15,
    authSignupClientLimit: 10,
    authSignupWindowMinutes: 60,
    authGuestCreationClientLimit: 20,
    authGuestCreationWindowMinutes: 60,
    authMailClientLimit: 10,
    authMailClientWindowMinutes: 15,
    authMailRecipientLimit: 3,
    authMailRecipientWindowMinutes: 60,
    authGuestLookupClientLimit: 30,
    authGuestLookupWindowMinutes: 15,
};

// CSV_KEY -> settings key
const keyMap: Record<string, keyof Settings> = {
    APP_NAME: "appName",
    ROOT_URL: "rootUrl",
    DB_TYPE: "dbType",
    DB_HOST: "dbHost",
    DB_PORT: "dbPort",
    DB_NAME: "dbName",
    DB_USER: "dbUser",
    DB_PASSWORD: "dbPassword",
    SMTP_POOL: "smtpPool",
    SMTP_HOST: "smtpHost",
    SMTP_PORT: "smtpPort",
    SMTP_SECURE: "smtpSecure",
    SMTP_EMAIL: "smtpEmail",
    SMTP_USER: "smtpUser",
    SMTP_PASSWORD: "smtpPassword",
    EMAIL_ACCENT_COLOR: "emailAccentColor",
    OIDC_ENABLED: "oidcEnabled",
    OIDC_NAME: "oidcName",
    OIDC_CLIENT_ID: "oidcClientId",
    OIDC_CLIENT_SECRET: "oidcClientSecret",
    OIDC_ISSUER_BASE_URL: "oidcIssuerBaseUrl",
    OIDC_REDIRECT_URL: "oidcRedirectUrl",
    OIDC_LINK_BY_EMAIL: "oidcLinkByEmail",
    OIDC_ALLOW_EMAIL_REBINDING: "oidcAllowEmailRebinding",
    LOCAL_LOGIN_ENABLED: "localLoginEnabled",
    SESSION_SECRET: "sessionSecret",
    APP_PORT: "appPort",
    INVOICE_DIR: "invoiceDir",
    INVOICE_RETENTION_MONTHS: "invoiceRetentionMonths",
    // Keep archival on the existing settings path instead of reading process.env in the job.
    AUTO_ARCHIVE_ENABLED: "autoArchiveEnabled",
    AUTO_ARCHIVE_AFTER_DAYS: "autoArchiveAfterDays",
    HEADER_IMG_DIR: "headerImgDir",
    IMPRINT_URL: "imprintUrl",
    PRIVACY_POLICY_URL: "privacyPolicyUrl",
    ACTIVITY_AVAILABILITY_WEIGHT: "activityAvailabilityWeight",
    ACTIVITY_SWAP_OPTIMIZATION_ITERATIONS: "activitySwapOptimizationIterations",
    ACTIVITY_ARRIVAL_DEPARTURE_PENALTY: "activityArrivalDeparturePenalty",
    ACTIVITY_MAX_DURATION_DAYS: 'activityMaxDurationDays',
    AUTH_LOGIN_CLIENT_LIMIT: 'authLoginClientLimit',
    AUTH_LOGIN_FAILURE_CLIENT_LIMIT: 'authLoginFailureClientLimit',
    AUTH_LOGIN_ACCOUNT_LIMIT: 'authLoginAccountLimit',
    AUTH_LOGIN_WINDOW_MINUTES: 'authLoginWindowMinutes',
    AUTH_SIGNUP_CLIENT_LIMIT: 'authSignupClientLimit',
    AUTH_SIGNUP_WINDOW_MINUTES: 'authSignupWindowMinutes',
    AUTH_GUEST_CREATION_CLIENT_LIMIT: 'authGuestCreationClientLimit',
    AUTH_GUEST_CREATION_WINDOW_MINUTES: 'authGuestCreationWindowMinutes',
    AUTH_MAIL_CLIENT_LIMIT: 'authMailClientLimit',
    AUTH_MAIL_CLIENT_WINDOW_MINUTES: 'authMailClientWindowMinutes',
    AUTH_MAIL_RECIPIENT_LIMIT: 'authMailRecipientLimit',
    AUTH_MAIL_RECIPIENT_WINDOW_MINUTES: 'authMailRecipientWindowMinutes',
    AUTH_GUEST_LOOKUP_CLIENT_LIMIT: 'authGuestLookupClientLimit',
    AUTH_GUEST_LOOKUP_WINDOW_MINUTES: 'authGuestLookupWindowMinutes',
};

// per-field coercion
const coerce: Partial<Record<keyof Settings, (v: string) => any>> = {
    dbPort: Number,
    smtpPort: Number,
    appPort: Number,
    smtpPool: (v) => /^(1|true|yes|on)$/i.test(v),
    smtpSecure: (v) => /^(1|true|yes|on)$/i.test(v),
    localLoginEnabled: (v) => /^(1|true|yes|on)$/i.test(v),
    oidcEnabled: (v) => /^(1|true|yes|on)$/i.test(v),
    oidcLinkByEmail: (v) => /^(1|true|yes|on)$/i.test(v),
    oidcAllowEmailRebinding: (v) => /^(1|true|yes|on)$/i.test(v),
    activityAvailabilityWeight: Number,
    activitySwapOptimizationIterations: Number,
    activityArrivalDeparturePenalty: Number,
    invoiceRetentionMonths: Number,
    // Match the existing boolean setting convention. Number conversion is followed by
    // stricter integer/range validation in the archival policy before any database write.
    autoArchiveEnabled: (v) => /^(1|true|yes|on)$/i.test(v),
    autoArchiveAfterDays: Number,
    activityMaxDurationDays: Number,
    authLoginClientLimit: Number,
    authLoginFailureClientLimit: Number,
    authLoginAccountLimit: Number,
    authLoginWindowMinutes: Number,
    authSignupClientLimit: Number,
    authSignupWindowMinutes: Number,
    authGuestCreationClientLimit: Number,
    authGuestCreationWindowMinutes: Number,
    authMailClientLimit: Number,
    authMailClientWindowMinutes: Number,
    authMailRecipientLimit: Number,
    authMailRecipientWindowMinutes: Number,
    authGuestLookupClientLimit: Number,
    authGuestLookupWindowMinutes: Number,
};

/** Validate only the newly configured bounds after CSV/environment precedence.
 * Invalid budgets must fail before admission starts, rather than expire immediately
 * through a truncated timer or silently stop protecting an identity operation. */
function validateProductionBounds(target: Settings): void {
    // The existing settings map owns names and coercion; select these numeric
    // policies without another loader or a duplicate source of default values.
    for (const [environmentKey, settingsKey] of Object.entries(keyMap)) {
        if (!environmentKey.startsWith('AUTH_') && environmentKey !== 'ACTIVITY_MAX_DURATION_DAYS') continue;
        const value = target[settingsKey];
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
            throw new Error(`${environmentKey} must be a positive safe integer`);
        }
        // Node's interval implementation cannot represent a longer millisecond
        // window. Reject it rather than let a large operator value wrap to 1ms.
        if (environmentKey.endsWith('_WINDOW_MINUTES') && value * 60_000 > 2_147_483_647) {
            throw new Error(`${environmentKey} exceeds the supported timer window`);
        }
    }
}

// Apply environment variable overrides AFTER reading CSV.
// In E2E: E2E_* vars override; otherwise plain vars override.
// Example: E2E_DB_HOST > DB_HOST > CSV value.
/** Overlay nonempty environment values using each setting's declared coercion.
 * E2E values take precedence in that mode; the dedicated-database notice remains
 * advisory and never changes the selected database or supplied credentials. */
function applyEnvOverrides(target: Settings): void {
    const entries = Object.entries(keyMap) as [string, keyof Settings][];

    for (const [csvKey, settingsKey] of entries) {
        // Prefer E2E_ prefixed variables when running in E2E mode
        let raw;
        if (process.env.NODE_ENV === 'e2e') {
            raw = process.env[`E2E_${csvKey}` as keyof NodeJS.ProcessEnv]
        }
        raw = raw ?? process.env[csvKey as keyof NodeJS.ProcessEnv];

        if (raw === undefined || raw === "") continue;

        const conv = coerce[settingsKey];
        (target as any)[settingsKey] = conv ? conv(String(raw)) : String(raw);
    }

    // Allow overriding the settings file location itself.
    if (process.env.SETTINGS_FILE) {
        target.file = process.env.SETTINGS_FILE;
    }

    // Safety: when in E2E, nudge to use a dedicated database.
    if (
        process.env.NODE_ENV === "e2e" &&
        target.dbName &&
        !/e2e/i.test(target.dbName)
    ) {
        console.warn(
            `[settings] E2E mode: database name "${target.dbName}" does not contain "e2e". ` +
            `Consider setting E2E_DB_NAME for safety.`
        );
    }
}

export class SettingsStore {
    private readonly _settings: Settings = {...defaults};

    get value(): Settings {
        return this._settings;
    }

    /** Load the selected CSV then environment overrides, or initialize from the
     * existing defaults when absent. E2E skips default-file creation; forceCsv
     * retains its existing file-selection and final-overlay exceptions. */
    async read(file = this._settings.file, forceCsv: boolean = false): Promise<void> {
        // If an env override for the file is present, prefer it.
        if (!forceCsv && process.env.SETTINGS_FILE) {
            file = process.env.SETTINGS_FILE;
            this._settings.file = file;
        }

        const isE2E = process.env.NODE_ENV === "e2e";

        // If the CSV doesn't exist:
        // - in normal modes, create it from defaults (original behavior)
        // - in E2E, SKIP writing (we rely on env-only for secrets)
        if (!fs.existsSync(file)) {
            if (!isE2E) {
                await this.write(file);
            }
            applyEnvOverrides(this._settings);
            validateProductionBounds(this._settings);
            this._settings.initialized = true;
            return;
        }

        // Parse CSV
        const text = fs.readFileSync(file, "utf8");
        for (const line of text.split(/\r?\n/)) {
            if (!line.trim()) continue;
            const [kRaw, ...rest] = line.split(",");
            const k = kRaw.trim();
            const vRaw = rest.join(","); // allow commas in values
            const mapKey = keyMap[k];
            if (!mapKey) {
                console.warn("Unknown setting:", k);
                continue;
            }
            const conv = coerce[mapKey];
            (this._settings as any)[mapKey] = conv ? conv(vRaw) : vRaw;
        }

        // Finally, apply env overrides on top.
        if (!forceCsv) applyEnvOverrides(this._settings);
        validateProductionBounds(this._settings);
        this._settings.initialized = true;
    }

    async write(file = this._settings.file): Promise<void> {
        const reverse = Object.fromEntries(
            Object.entries(keyMap).map(([csv, key]) => [key, csv])
        );
        const lines: string[] = [];
        for (const [key, value] of Object.entries(this._settings)) {
            const csvKey = (reverse as any)[key];
            if (!csvKey) continue; // skip fields not in CSV
            lines.push(`${csvKey},${String(value)}`);
        }
        fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
        console.log("Settings file written!");
    }
}

const settingsStore = new SettingsStore();
export default settingsStore;
