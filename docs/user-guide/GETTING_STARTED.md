# Getting Started with Surveyor
<!--
documentation-metadata
audience: novice users; guests; registered users
owner: identity feature maintainers
status: current
last-verified: 2026-09-05
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: D01 identity, onboarding, guest recovery, profile, migration, and account-lifecycle behavior; D14 rendered help navigation, semantic checks, and trusted-content integration
source-anchors: src/routes/users.ts; src/routes/guests.ts; src/controller/userController.ts; src/middleware/guestFlowFactory.ts; src/middleware/permissionMiddleware.ts; src/modules/database/services/UserService.ts; src/modules/database/entities/user/; src/modules/oidc.ts; src/modules/settings.ts; src/modules/email.ts; src/modules/lib/guestRegistrationNags.ts; src/public/js/core/password-validation.ts; src/views/users/; src/views/layout.pug; tests/integration/authentication-workflows.spec.ts; src/controller/helpController.ts; tests/unit/help-documentation.spec.ts
next-review: identity-or-authentication-visible-behavior-change
-->

Use this guide to enter Surveyor, recover access, and manage the profile that represents you.

## Find your task

| I need to… | Go to… |
|---|---|
| Create a username-and-password account | [Create and activate a local account](#create-and-activate-a-local-account) |
| Sign in through my organization | [Sign in with an organization account](#sign-in-with-an-organization-account) |
| Reset a local password | [Reset a local password](#reset-a-local-password) |
| Join an invitation without a full account | [Join an invitation as a guest](#join-an-invitation-as-a-guest) |
| Recover a guest account | [Recover guest access by email](#recover-guest-access-by-email) |
| Rename or switch my identity | [Understand accounts and profiles](#understand-accounts-and-profiles) |
| Move a guest or profile to another account | [Move a profile to another full account](#move-a-profile-to-another-full-account) |
| Permanently remove access | [Deactivate a profile or delete an account](#deactivate-a-profile-or-delete-an-account) |

## Choose how to enter Surveyor

A Surveyor installation can offer one or both full-account sign-in methods:

| Method | What you use | First-time setup |
|---|---|---|
| Local account | A Surveyor username or email address and password | Register, activate the account by email, and then log in. |
| Organization sign-in | **Login using _provider name_**, or an automatic redirect to that provider | Sign in at the provider; Surveyor creates or connects a full account. |

You can also join an invitation as a **guest**. A guest sets no password and has one guest profile. The guest receives a private access link and can use **Your overview** to return to items connected to that profile.

The screens depend on how this Surveyor installation is configured. Selecting **Login** or **Register** may show local account fields, an organization sign-in button, both, or an immediate redirect to the organization’s sign-in page.

## Create and activate a local account

Use these steps when **Register** shows username, email, and password fields.

1. Select **Register** in the top navigation.
2. Complete the form:
   - **Username**: the unique name used for local login.
   - **Display name**: the initial name shown to other participants.
   - **E-mail**: used for activation and password recovery.
   - **Password** and **Repeat password**.
3. Use a password with at least 8 characters, at least one letter, and at least one digit.
4. Make sure **Repeat password** matches, then select **Register**.
5. Open the email with subject **Activate your account** and select **Activate account** within one hour.
6. When Surveyor opens **Login**, enter your **Username or email** and password, then select **Login**.

Registration does not sign you in. You must activate the account before the first local login.

Surveyor creates the first profile from the display name entered during registration. After login, that profile is active and Surveyor opens **Your overview**.

### Activation link problems

An activation link is valid for one hour and can be used once. An invalid, expired, or previously used link is rejected.

When an inactive account’s link has expired, attempting to log in causes Surveyor to send a replacement activation email. Check the address entered during registration and the spam folder. Contact the Surveyor operator when no usable activation email arrives.

## Sign in with an organization account

Use these steps when Surveyor shows **Login using _provider name_** or redirects you to an organization sign-in page.

1. Select the organization sign-in option when it is shown.
2. Sign in at the external provider.
3. Complete any approval step requested by that provider.
4. After the provider returns you to Surveyor, Surveyor opens **Your overview** with the active profile.

The first successful provider sign-in creates an active Surveyor account and profile when none exists. When the provider supplies an email address already used by a Surveyor account, Surveyor can connect the provider identity to that account instead.

The external provider manages this sign-in method’s credentials. Use the provider’s account-recovery process rather than Surveyor’s **Forgot password?** flow.

## Log in to a local account

1. Select **Login**.
2. Enter either the Surveyor username or the account’s email address in **Username or email**.
3. Enter the password.
4. Select **Login**.

Surveyor opens **Your overview** and activates the account’s default profile. When no profile is marked as default, Surveyor uses the oldest profile on the account.

### Reset a local password

1. On **Login**, select **Forgot password?**.
2. Enter the account’s username or email address in **Username or Email**.
3. Select **Send reset link**.
4. Open the email with subject **Reset your password** and select **Reset password** within one hour.
5. Enter the new password twice and select **Change password**.

The new password must have at least 8 characters, at least one letter, and at least one digit. Both entries must match.

For privacy, Surveyor shows the same confirmation whether or not an account matches the entered value. If no email arrives, check the spelling, the spam folder, and whether the account normally uses organization sign-in. A reset link expires after one hour and cannot be reused after the password is changed.

## Join an invitation as a guest

Guest access is useful when you need to participate but do not want to create a full account.

1. Open the invitation link supplied by the organizer.
2. On **Join «…»**, choose an existing-account option when appropriate:
   - **Log in** for a full account;
   - **Recover guest account** for an existing guest identity; or
   - **Create account** for a new full account.
3. To create a separate guest identity, continue to the guest form.
4. Enter a **Display name**. This is the name initially shown to other participants.
5. Enter an email address whenever possible. It is optional, but it is the recovery key for this guest account.
6. Select **Continue as guest**.

Surveyor signs you in to the new guest account and opens the invited item. It also creates a private access link. When you supplied an email address, Surveyor sends that link to the address as well.

Keep the private link secret. Anyone who can use it can enter that guest account. Logging out does not invalidate the link; keep it or the recovery email so that you can return later.

### When the email already has guest accounts

When Surveyor recognizes the entered email address, it may show **Guest account found!**. Choose:

- **Recover guest account** to receive the existing guest links; or
- **Continue as new guest** to create another separate guest account.

One email address can be associated with several guest accounts. Each private link opens one specific guest account and profile.

### What a guest account can do

A guest account has one profile and no password. While signed in, a guest can:

- open **Your overview** and return to items connected to that guest profile;
- participate in invited features as allowed by that feature;
- change the profile name;
- obtain a migration token and move the guest profile into a full account; and
- log out and return through the private link or email recovery.

A guest cannot create new surveys, events, lists, or plans, and cannot create or switch between multiple profiles. Feature-specific actions can depend on the item and its sharing settings; use the relevant feature guide for those details.

## Recover guest access by email

Email recovery works only for guest accounts created with an email address.

1. Select **Login**.
2. Find **Looking for your guest account?**.
3. Enter the email address used for guest registration.
4. Select **Request access**.
5. Open the email with subject **Your guest accounts**.
6. Select **Open _guest name_** for the account you want to use.

The email lists every guest account connected to that address, including its guest name and creation time. When there is one result, the message heading is **Your guest account**. Opening a private link signs you in to that guest account and normally opens **Your overview**.

For privacy, the request page confirms the request even when the address has no matching guest account. If no email arrives, check the spelling and spam folder. A guest account created without an email cannot use email recovery; its saved private link is required.

Each link always opens the guest account named beside it. Request the account links again by email when you no longer have them, then choose the correct account instead of creating an unnecessary duplicate.

## Understand accounts and profiles

An **account** is how you sign in. A **profile** is the participant identity that owns, administers, or participates in Surveyor items.

- A full account can have several profiles, but only one is active at a time.
- A guest account has one profile.
- Each profile has its own display name, participation, and ownership relationships.
- Changing the active profile changes which items appear in **Your overview** and which identity is used for new actions.

The local-account username is not the same as the profile name. Renaming a profile changes the displayed participant name but does not change the username used for local login. For a guest, the account identifier remains the name originally used to create the guest, even after the profile name is changed.

## Edit the active profile

1. Open the user menu showing the current profile name.
2. Select **Profile settings**.
3. Change **Profile name** as needed.
4. On a full account, select **Default profile** when this profile should be chosen automatically at login.
5. Select **Submit changes**.

Marking one profile as default clears the previous default on the same account. If no profile is marked as default, Surveyor selects the oldest profile at the next login.

## Create or switch profiles on a full account

Multiple profiles are useful when one login must represent different people, such as members of a family, or when separate participant identities are needed.

### Create another profile

1. Open the user menu and select **Your profiles**.
2. Select **Create new profile**.
3. Enter the **Profile name**.
4. Select **Create new profile**.
5. Return to **Your profiles** and select **Switch to profile** beside the profile you want to use.

### Switch profiles

1. Open the user menu and select **Your profiles**.
2. Select **Switch to profile** beside the required identity.

The selected profile becomes active immediately. Check the profile name in the user menu before voting, registering, assigning an item, or creating content.

## Move a profile to another full account

Profile migration preserves the profile itself, including its existing participation and ownership relationships, while changing which full account controls it. Use it to bring a guest profile into a full account or transfer a profile between full accounts.

### Obtain the token from the profile being moved

1. Sign in to the guest or full account that currently controls the profile.
2. Make that profile active.
3. Open **Profile settings**.
4. Select **Show profile migration token**.
5. Copy the token and keep it private.

The token grants control of the profile and is valid for 24 hours. Generating another token replaces the previous token. Share it only with the intended receiving account.

### Complete the migration in the receiving account

1. Sign out of the source account.
2. Sign in to the full account that should receive the profile.
3. Open the user menu and select **Your profiles**.
4. Select **Migrate profile to account**.
5. Paste the token and select **Show migration profile**.
6. Verify the displayed profile and current owner.
7. Select **Permanently migrate profile**.
8. On **Your profiles**, select **Switch to profile** when you want to use the migrated identity.

Migration removes the profile from its previous owner. Surveyor closes a previous guest account after its profile is moved. It also closes a previous full account when the migrated profile was its final profile. When an email address is available, Surveyor sends a migration notice and an account-closure notice when applicable.

Do not deactivate a profile when the goal is to transfer or preserve it. Migrate the profile instead.

## Deactivate a profile or delete an account

These actions are permanent. Existing participation can remain visible in shared records after you lose access.

### Deactivate one profile on a full account

1. Make the profile active.
2. Open **Profile settings**.
3. Select **Delete profile**.
4. Enter the exact **Profile name** requested by the confirmation form.
5. Select **Permanently deactivate profile**.

The profile is detached from the account, and you can no longer use it to access its items. Other profiles on the full account remain available. Deactivating the final profile also closes the full account. Use profile migration instead when another account should retain the profile and its access.

A guest account contains only one profile and does not use the multi-profile deactivation flow. Close the guest account through **Delete account** instead.

### Delete a full or guest account

1. Open the user menu.
2. Select **Delete account**.
3. Enter the Surveyor **Username** required by the confirmation form. For a local account, this is the login username. For a guest account, it is the display name originally used to create the guest, not a later profile name.
4. Select **Permanently delete account**.

Deleting a full account closes the account and deactivates every profile attached to it. Deleting a guest account closes that guest identity and deactivates its one profile. The action cannot be undone through Surveyor. Existing participation can remain visible where it is needed for shared group records.

Deleting a Surveyor account that uses organization sign-in does not delete the account at the external identity provider. Signing in again creates or connects a Surveyor account, but it does not restore profiles that were previously deactivated.

## Troubleshooting

### I do not see local registration or password fields

This installation may use organization sign-in only. Select **Login** or **Register** and follow the redirect, or use **Login using _provider name_**.

### Local login says the account is not activated

Open the activation email first. If the one-hour link has expired, a login attempt sends a replacement activation email. Check spam and contact the Surveyor operator if no usable message arrives.

### I requested a password reset but received no email

Check the username or email spelling and the spam folder. The confirmation page does not reveal whether an account matched. Accounts that use organization sign-in recover credentials through the external provider.

### I requested guest access but received no email

Confirm that the guest account was created with that exact email address. The recovery message always has subject **Your guest accounts** and can contain several account links. A guest created without an email requires its saved private link.

### My overview does not show the item I expected

Check the active profile name in the user menu. On a full account, switch profiles through **Your profiles**. For guest access, open the private link for the guest account that originally joined the item or request all links through email recovery.

### A migration token is rejected

Migration tokens expire after 24 hours, are tied to one profile, and are replaced when another token is generated. Generate a new token from **Profile settings** on the source profile and repeat the preview before confirming the migration.

## Next steps

- Learn how **Your overview** is organized in the [Your Overview Guide](DASHBOARD.md).
- Open the guide for the feature you were invited to use.
- Review [Permissions](PERMISSIONS.md) before sharing or administering a feature that uses the general permission system.
