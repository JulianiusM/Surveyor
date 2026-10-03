# Your Overview
<!--
documentation-metadata
audience: novice users; organizers; participants
owner: dashboard feature maintainers
status: current
last-verified: 2026-10-03
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: compartmentalized settings tabs, compact audience editor, paged event search, and restored searchable timezone controls; source-reviewed Entity settings dialog labels, per-action permissions, root property changes, image/actions, minimal archival hints, and event selection/reassociation boundaries; source review of mixed paged cards, event expansion, search/count labels, profile membership and visibility fallbacks; archival behavior and labels reviewed against shared policy, persistence service, and Pug controls; D02 global navigation, profile-scoped overview collections, and owner-only card actions; D14 rendered help navigation, semantic checks, and trusted-content integration
source-anchors: src/views/modules/module_entity_properties.pug; src/public/js/modules/entity-properties.ts; src/views/modules/module_entity_select.pug; src/public/js/modules/entity-select.ts; src/controller/entityAdminController.ts; src/modules/archive/policy.ts; src/modules/database/services/EntityLifecycleService.ts; src/modules/database/services/UserService.ts; src/views/modules/module_entity_archive.pug; src/views/layout.pug; src/routes/users.ts; src/routes/api/users.ts; src/controller/userController.ts; src/views/users/dashboard.pug; src/views/modules/module_unified_entity_cards.pug; src/public/js/user-dashboard.ts; src/public/js/modules/entity-cards-overview.ts; tests/integration/controller-smoke-workflows.spec.ts; tests/unit/application-utilities.spec.ts; src/controller/helpController.ts; tests/unit/help-documentation.spec.ts
next-review: overview-or-navigation-visible-UI-change
-->

**Your overview** is the page where you return to items connected to the active profile. It includes items in which that profile participates and items that the profile owns or can administer. It is not limited to things you created.

## Open Your overview

1. Sign in with a full account or guest account.
2. In the top navigation, open **Overview**.
3. Select **Your overview**.
4. Select an item's image or title to open it. For a plan or list within an event, first select that event card's **Show linked entities** action.

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
| **Administrable entities** | Items that the active profile owns or has been added to as an administrator. Available actions depend on the profile's permissions; an administrator does not automatically become the owner. |

The same item can appear in both collections when the active profile both participates in it and administers it.

Events appear alongside independent surveys, plans, and lists in one card grid. When a linked plan or list belongs to the same collection and main or hidden section as its event, find it through the event's **Show linked entities** action. Each collection includes only your relevant linked items: registering for an event does not automatically add every attached plan or list to **Your participation**.

When a collection has no cards, Surveyor shows one of these messages:

- **You are not participating anywhere**
- **You don't have any administrable entities yet**

The overview does not contain feature-specific create buttons. Use the global **New** menu to create an item.

## Find an item

Each collection is an expandable section with a total count badge. The main cards and **Archived and hidden** section each have their own search field and **Filter** menu. Use **Previous** and **Next** beneath the cards to change pages. Cards are ordered alphabetically by title.

### Search

Use **Search your participation…** or **Search administrable entities…**. Search is not case-sensitive and matches:

- the item title;
- the description;
- the item type.

The cards update while you type, or you can select **Search**. Search includes later pages and linked items inside events you have not opened.

### Filter by type

1. Select **Filter** in the relevant collection.
2. Select a type that is present in that collection, or select **All types** to remove the type filter.

The current type labels are `survey`, `activity`, `packing`, `drivers`, and `event`. The menu lists types belonging to that main or hidden section, including items on other pages and inside event cards.

Search and type filters work together. The **matching entities** count describes the individual matching items; **Cards 1–24 of …** counts the cards in the grid. One event card can lead to several matching linked items. The collection badge counts all associated items, including those in **Archived and hidden**. To restore all results in a section, clear its search field and select **All types**.

An event card can appear because one of its linked items matches, even if the event title does not. For example, filtering to `packing` can show an event card whose **Show linked entities** action says **3 of 8 match**. Open it to see those three matching packing lists. Searching an event's title does not make all its linked items match that text.

## Read and open a card

A card can show:

- a header image, when the item has one;
- the title;
- a shortened description;
- a type badge;
- **Archived**, independently of whether the card is in the main section;
- **Hidden for me** or **Shown for me** when you saved a personal visibility choice.

Select the image or the main body of the card to open the item. The feature page then shows the actions available to the active profile.

On a feature page, **Entity settings** gathers permitted property, image, sharing, event-link, archival, and other actions. Only actions available to the active profile appear. Ordinary archived feature views show **This entity is archived.**; organizer explanations are inside the dialog.

## Open an event's linked entities

1. Find the event card in the relevant collection.
2. Select **Show linked entities**. The number counts your linked items in that collection and main or hidden section.
3. Select a linked card to open its feature page. Use **Previous** and **Next** if the event contains several pages of linked items.
4. Select **Back to overview** to return to the mixed card grid.

The event becomes the enclosing card, keeping its image, title, and usual controls. Its image or title still opens the normal event page. The linked cards retain their own actions and visibility choices.

Search and type filters also apply inside the event. Select **Show all my linked entities** to clear both filters while keeping the event open. If only the event itself matches your search, its linked view can initially be empty; that action reveals your other linked items. Returning with **Back to overview** keeps your current filters. Changing a filter starts at the first page; otherwise the previous overview page is restored. Browser Back and Forward follow your navigation history.

If you participate in or administer a child but its event is absent from that collection or section, the child remains an ordinary card in the mixed grid. Where you can open its event, a small event link supplies context. No replacement event card is added solely because you have a linked item.

## Find archived and hidden items

1. Open **Your participation** or **Administrable entities**.
2. Expand **Archived and hidden** beneath the main cards.
3. Search or filter that section, then open the item normally.

The section starts collapsed on a normal visit. A saved overview link can reopen it with its search, filters, and selected event. It remains available when all your items are archived or hidden; the main section then explains where to find them. Archival preserves your existing access and actions. Losing participation or administration membership can still remove an item from the overview.

## Hide or show an item only for yourself

Open a card's **Archival** menu and use the actions under **Only my overview**:

| Action | Result for the active profile |
|---|---|
| **Hide for me** | Put the card in **Archived and hidden**, whether or not it is archived for everyone. |
| **Show for me** | Keep the card in the main section, including after an organizer or the automatic process archives it. The archive badge remains visible. |
| **Use default visibility** | Remove your personal choice: active items appear in the main section and archived items appear in **Archived and hidden**. |

Your choice applies to both collections and is saved for the active profile, including guests. Other profiles and other users keep their own choices. Hiding an event affects its card only: its visible linked plans and lists become ordinary cards in the main grid. A hidden child appears inside its event only when the event is also in **Archived and hidden**; otherwise it remains a separate hidden card. A child kept visible with **Show for me** stays discoverable even while its event is archived or hidden. The event page's **Things to do** section continues to show its linked items.

## Archive or restore for everyone

An owner or organizer with **Edit Meta** can select **Archive for everyone** or **Restore for everyone** under **For everyone** in a card's **Archival** menu, or open the feature page's **Entity settings** → **Actions** → **Archival**. For surveys, only the owner has these controls. Confirm the action when prompted.

Archiving an event archives all its attached entities and contents together. Restoring the event restores inherited archival; an attached entity archived separately stays archived until restored separately. The **Archival** section inside **Entity settings** explains inherited archival and provides **Open event** where available when the event must be restored first. Permission to manage a child does not grant permission to restore its event.

You can use **Archive for everyone** on a child already archived with its event to keep that child archived independently after the event is restored. The confirmation explains this effect.

Events and standalone activity plans can also be archived automatically after their end date and the site's configured delay. A linked activity plan follows its event's schedule. Restoring an event or standalone plan pauses automatic archival until an organizer chooses **Resume automatic archival**. **Pause automatic archival** also lets an organizer keep an active entity from being archived automatically. Resuming can make an already-ended entity eligible at the next run.

Archival preserves registrations, answers, assignments, invoice data, images, proofs, and existing permissions. It does not delete files or prevent normal authorized use. Invoice retention and deliberate deletion continue under their existing policies. Your personal visibility choices survive authoritative archive and restore actions.

## Use owner actions

The **Administrable entities** collection can show these buttons on a card:

- **Duplicate** opens a creation form based on the existing item. Review the copied values before creating the new item; the original is not changed.
- **Delete** asks **Delete this item?** and then permanently removes the item when confirmed.

These card buttons appear only when the active profile is the item owner. A profile that can administer an item but does not own it can still open the card, but does not receive **Duplicate** or **Delete** on the overview card. Additional administration controls depend on the feature and its access settings.

The feature page's **Entity settings** → **Actions** also offers **Duplicate** when the active full-account profile has **Data Duplicate**, and **Delete permanently** for the owner. This can give a delegated profile access to duplication without showing an owner-only card button. The same dialog contains authorized exports where the feature supports them.

A duplicate starts without the original's direct archival, automation pause, or personal visibility choices. When it is created under an archived event, it inherits that event's archival. Old dates on a new standalone plan or event can make it eligible for automatic archival.

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
4. Use the event card's **Show linked entities** action and check later pages with **Next**. Searching by the missing item's title also finds it inside an event.
5. Expand **Archived and hidden** in each collection and clear that section's filters too.
6. Confirm that the active profile has actually joined, been assigned to, registered for, or received administration access to the item.
7. For a guest, use the private link for the guest identity that joined the item, or recover the correct guest account by email.

### An overview page could not load

Select **Retry** beside the error. If your session expired, sign in again and reopen **Your overview**. If an event or your membership changed while you were browsing, Surveyor returns to the valid overview and keeps any remaining eligible items available.

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
