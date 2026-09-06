# Your Overview
<!--
documentation-metadata
audience: novice users; organizers; participants
owner: dashboard feature maintainers
status: current
last-verified: 2026-09-05
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: D02 global navigation, profile-scoped overview collections, card search and filtering, and owner-only card actions; D14 rendered help navigation, semantic checks, and trusted-content integration
source-anchors: src/views/layout.pug; src/routes/users.ts; src/controller/userController.ts; src/views/users/dashboard.pug; src/views/modules/module_unified_entity_cards.pug; src/public/js/user-dashboard.ts; src/public/js/modules/entity-cards-overview.ts; tests/integration/controller-smoke-workflows.spec.ts; tests/unit/application-utilities.spec.ts; src/controller/helpController.ts; tests/unit/help-documentation.spec.ts
next-review: overview-or-navigation-visible-UI-change
-->

**Your overview** is the page where you return to items connected to the active profile. It includes items in which that profile participates and items that the profile owns or can administer. It is not limited to things you created.

## Open Your overview

1. Sign in with a full account or guest account.
2. In the top navigation, open **Overview**.
3. Select **Your overview**.

You can also open the user menu showing the active profile name and select **Your overview** there. On a narrow screen, open the navigation menu first.

## Check the active profile

Your overview belongs to the **active profile**, not to the whole account.

- The welcome heading and user menu show the active profile name.
- A full account can switch profiles through **Your profiles**. The overview changes when the active profile changes.
- A guest account has one profile and can use the same overview page.
- An item can appear for one profile but not for another profile on the same full account.

Before creating, registering, voting, or taking an assignment, check the profile name in the user menu so that the action is recorded for the intended person.

## Understand the two collections

Your overview contains two separate collections. Both can contain surveys, activity plans, packing lists, drivers lists, and events.

| Collection | What it contains |
|---|---|
| **Your participation** | Items in which the active profile participates. The action that creates participation depends on the feature, such as voting, registering, or accepting an assignment. |
| **Administrable entities** | Items that the active profile owns or is allowed to administer. An administrator does not automatically become the owner. |

The same item can appear in both collections when the active profile both participates in it and administers it.

When a collection has no cards, Surveyor shows one of these messages:

- **You are not participating anywhere**
- **You don't have any administrable entities yet**

The overview does not contain feature-specific create buttons. Use the global **New** menu to create an item.

## Find an item

Each collection is an expandable section with a count badge, a search field, and a **Filter** menu.

### Search

Use **Search your participation…** or **Search administrable entities…**. Search is not case-sensitive and matches:

- the item title;
- the description;
- the item type.

The cards update while you type.

### Filter by type

1. Select **Filter** in the relevant collection.
2. Select a type that is present in that collection, or select **All types** to remove the type filter.

The current type labels are `survey`, `activity`, `packing`, `drivers`, and `event`. The menu lists only types for which that collection currently has cards.

Search and type filters work together. The count badge shows how many cards remain visible after both filters are applied. To restore all cards, clear the search field and select **All types**.

## Read and open a card

A card can show:

- a header image, when the item has one;
- the title;
- a shortened description;
- a type badge.

Select the image or the main body of the card to open the item. The feature page then shows the actions available to the active profile.

## Use owner actions

The **Administrable entities** collection can show these buttons on a card:

- **Duplicate** opens a creation form based on the existing item. Review the copied values before creating the new item; the original is not changed.
- **Delete** asks **Delete this item?** and then permanently removes the item when confirmed.

These card buttons appear only when the active profile is the item owner. A profile that can administer an item but does not own it can still open the card, but does not receive **Duplicate** or **Delete** on the overview card. Additional administration controls depend on the feature and its access settings.

## Create a new item

Creation requires a signed-in **full account** with an active profile. Guest accounts can participate in shared items but cannot create new ones. The active profile becomes the owner of the new item.

1. Check the active profile in the user menu.
2. Open **New** in the top navigation.
3. Select the required item type:

| Menu group | Item |
|---|---|
| **Plan & decide** | **Survey** |
| **Plan & decide** | **Activity plan** |
| **Plan & decide** | **Event** |
| **Organize & share** | **Packing list** |
| **Organize & share** | **Drivers list** |

Surveyor opens that feature's creation form. After the form is submitted successfully, Surveyor opens the new item. If you are not signed in with a full account, selecting a creation page takes you to **Login** first.

## Navigation at a glance

| Top-navigation label | Purpose |
|---|---|
| **Home** | Open the application home page. |
| **New** | Start a survey, activity plan, event, packing list, or drivers list. |
| **Overview** → **Your overview** | Return to the active profile's participation and administrable items. |
| **Help** | Open these in-app guides. |
| Active profile name | Open **Your overview**, **Profile settings**, profile management for full accounts, logout, and account deletion. |

## Troubleshooting

### An expected item is missing

1. Check the active profile name.
2. Clear the search field and select **Filter** → **All types** in both collections.
3. Check both **Your participation** and **Administrable entities**.
4. Confirm that the active profile has actually joined, been assigned to, registered for, or received administration access to the item.
5. For a guest, use the private link for the guest identity that joined the item, or recover the correct guest account by email.

### Duplicate or Delete is missing

Those buttons are shown on **Administrable entities** cards only when the active profile owns the item. Being an administrator without being the owner does not add the card buttons. Check the active profile, then open the item to see any feature-specific administration controls available to that profile.

### Both collections are empty

A full-account user can open **New** to create an item. To participate in an existing item, open the link supplied by its organizer and complete the relevant participation action. A guest must use an invitation or private guest link and cannot create a new item.

## Related guides

- [Getting Started](GETTING_STARTED.md) — accounts, guest recovery, and profile switching
- [Surveys](SURVEYS.md)
- [Events](EVENTS.md)
- [Packing Lists](PACKING_LISTS.md)
- [Activity Plans](ACTIVITY_PLANS.md)
- [Drivers Lists](DRIVERS_LISTS.md)
