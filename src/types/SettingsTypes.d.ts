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

export type Settings = {
    appName: string;
    appPort: number;
    file: string;
    dbType: "mariadb" | "mysql";
    dbName: string;
    dbHost: string;
    dbPassword: string;
    dbPort: number;
    dbUser: string;
    rootUrl: string;
    sessionSecret: string;
    smtpEmail: string;
    smtpHost: string;
    smtpPassword: string;
    smtpPool: boolean;
    smtpPort: number;
    smtpSecure: boolean;
    smtpUser: string;
    emailAccentColor: string;
    localLoginEnabled: boolean;
    oidcEnabled: boolean;
    oidcName: string;
    oidcIssuerBaseUrl: string;
    oidcClientId: string;
    oidcClientSecret: string;
    oidcRedirectUrl: string;
    /** Trust configured provider email claims for automatic linking to local accounts. */
    oidcLinkByEmail: boolean;
    /** Permit email-based replacement only while automatic email linking is also enabled. */
    oidcAllowEmailRebinding: boolean;
    invoiceDir: string;
    invoiceRetentionMonths: number;
    /**
     * Controls the background archival job; manual archival and personal choices remain available.
     * This setting has no connection to invoice/file retention or permanent entity deletion.
     */
    autoArchiveEnabled: boolean;
    /**
     * Complete UTC days after the inclusive end date; zero still waits until the following day.
     * The archival policy validates the integer and resulting database-date cutoff at startup.
     */
    autoArchiveAfterDays: number;
    headerImgDir: string;
    imprintUrl: string;
    privacyPolicyUrl: string;
    initialized: boolean;
    activityAvailabilityWeight: number;
    activitySwapOptimizationIterations: number;
    activityArrivalDeparturePenalty: number;
    /** Maximum inclusive duration for new or expanded Activity plans and full requirement workflows. */
    activityMaxDurationDays: number;
    /** Shared HTTP abuse budgets; every limit/window is a positive safe integer. */
    authLoginClientLimit: number;
    authLoginFailureClientLimit: number;
    authLoginAccountLimit: number;
    authLoginWindowMinutes: number;
    authSignupClientLimit: number;
    authSignupWindowMinutes: number;
    authGuestCreationClientLimit: number;
    authGuestCreationWindowMinutes: number;
    authMailClientLimit: number;
    authMailClientWindowMinutes: number;
    authMailRecipientLimit: number;
    authMailRecipientWindowMinutes: number;
    authGuestLookupClientLimit: number;
    authGuestLookupWindowMinutes: number;
};
