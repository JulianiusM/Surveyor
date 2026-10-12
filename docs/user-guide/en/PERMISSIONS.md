# Permissions and Sharing
<!--
documentation-metadata
audience: organizers; advanced administrators
owner: permission-system maintainers
status: current
last-verified: 2026-10-12
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: Reviewed pilot-language content at its fixed release-owned source; article bodies, declared anchors and image bytes preserved during promotion.
source-anchors: src/views/modules/module_entity_properties.pug; src/public/js/modules/entity-properties.ts; src/views/modules/module_entity_select.pug; src/public/js/modules/entity-select.ts; src/controller/entityAdminController.ts; src/modules/archive/policy.ts; src/modules/database/services/EntityLifecycleService.ts; src/views/modules/module_entity_archive.pug; src/modules/permissionEngine.ts; src/modules/lib/permissions.ts; src/middleware/permissionMiddleware.ts; src/middleware/guestFlowFactory.ts; src/middleware/adminApiFactory.ts; src/modules/database/services/EntityAdminService.ts; src/views/modules/module_perm_matrix.pug; src/views/modules/module_admin_matrix.pug; src/views/modules/module_admin_options.pug; src/public/js/modules/perm-matrix.ts; src/public/js/modules/admin-matrix.ts; src/routes/event.ts; src/routes/api/event.ts; src/routes/api/activity.ts; src/routes/api/packing.ts; src/routes/api/drivers.ts; src/controller/helpController.ts; tests/unit/help-documentation.spec.ts
next-review: permission-or-entity-settings-behavior-change
production-reference: 2dfa257 native frontend documentation; not an installed production commit
-->

Use permissions to decide which actions people may perform in an **Event**, **Activity plan**, **Packing list**, or **Drivers list**. Start with a sharing recipe, test it with a non-owner profile, and use the reference sections only when you need finer control.

> **Surveys are different.** Surveys deliberately do not use this permission system. Their invitation, guest, voting, and add-combination behavior is explained in [Surveys](SURVEYS.md).

## Choose a common setup

| Goal | Recommended setup |
|---|---|
| Keep the normal open starting point | Leave **Public** on **Default Entity**. Add only the extra action permissions your participants need. |
| Give an action only to full-account profiles | Set that action to **None** for **Public** and **Guest**, then select it for **Authenticated**. |
| Limit a linked plan or list to registered event participants | Link it to the event. Clear the action from **Public**, **Guest**, and **Authenticated**; select **Access View** and the needed action permissions for **Participant**. |
| Give one person organizer powers | Add that person under **Administrators** and select only the permissions needed for their role. |
| Give one person complete control | Add the person under **Administrators** and select **Admin**. For an event, **Admin** includes access to the administration dashboard. |
| Remove a capability from somebody | Clear it from every audience and individual grant that the active profile matches. There is no deny rule that cancels another grant. |

The sections below explain why these recipes work and how to apply them safely.

## Four rules to remember

1. **Grants add together.** Public, Guest, Authenticated, Participant, and individual administrator permissions are combined. A more specific grant does not replace a broader grant.
2. **One profile can match several groups.** A full-account profile that is registered for an event can receive Public, Guest, Authenticated, and Participant grants at the same time, plus an individual grant.
3. **The owner always has every permission.** Group or individual settings cannot reduce the owner’s access.
4. **A preset replaces the current selection for one group or administrator.** Select the preset first, then adjust individual checkboxes. **All** selects every permission; **None** clears every permission in that section.

### Example of cumulative grants

Suppose **Public** has **Access View**, **Authenticated** has **Item Add**, and Alex has an individual **Item Delete** grant. When Alex uses a full-account profile, the effective result includes all three permissions: **Access View**, **Item Add**, and **Item Delete**.

Clearing **Item Delete** from Alex’s individual entry would not remove it if Alex also received **Item Delete** from Public, Guest, Authenticated, or Participant. Check every matching source when a permission seems to remain active.

## Who receives each grant

| Grant source | Who receives it |
|---|---|
| **Public** | Everyone, including guests, full-account profiles, participants and individual administrators. These permissions also apply alongside their other permissions. |
| **Guest** | Any active profile receives the Guest grant, including a guest profile **and a profile belonging to a full account**. Think of this as the broad “has entered with a profile” grant rather than a guest-only deny boundary. |
| **Authenticated** | An active profile belonging to a full account. A guest-only profile does not receive it. |
| **Participant** | An active profile registered for the relevant event. For an event-linked activity plan, packing list, or drivers list, registration is checked against the linked event. |
| **Individual administrator** | The selected profile receives the chosen permissions in addition to those from every matching audience. The administrator picker searches profiles attached to full accounts. |
| **Owner** | The active owner profile receives every permission automatically. |

The **active profile** matters. A full account with several profiles can receive a different result after switching profiles because ownership, event registration, and individual administrator grants belong to profiles rather than to the account as a whole.

## Open the permission controls

**Edit Meta** also permits **Archive for everyone**, **Restore for everyone**, and automatic archival controls on events and standalone activity plans. The same permission permits manual archive and restore on activity plans, packing lists, and drivers lists. **Access Admin** or an administrator entry alone is insufficient. A child organizer cannot override an archived event or restore that event without event authority. Surveys retain owner-only authoritative archival.

Personal **Hide for me**, **Show for me**, and **Use default visibility** choices require participation or administration membership in the active profile's overview, without changing permissions or anyone else's archival state. See [Your Overview](DASHBOARD.md#hide-or-show-an-item-only-for-yourself).

### While creating an item

Creation forms for Events, Activity plans, Packing lists, and Drivers lists contain **Group Permissions**. Choose a
**Permission audience**, use **Presets** or individual checkboxes, and then submit the creation form.

Surveys do not show this matrix.

### After creation

You need **Manage Permissions** to see and use the controls. Open the event, activity plan, packing list, or drivers list, select **Entity settings** in the header, then select **Access**.

For events, these controls are available on the ordinary event page without **Access Admin**. The administration dashboard offers the same dialog but still requires **Access Admin** to enter. Activity assignment rules remain in **Rules & auto-assign**.

Inside **Access**:

- **Group Permissions** changes grants for Participant, Guest, Authenticated, and Public.
- **Administrators** changes grants for named full-account profiles.

After changing a group, select **Update permissions**. After changing a named administrator, select **Save**.

## Configure Group Permissions

1. Open **Entity settings** and select **Access**, then **Group Permissions**.
2. Choose **Participant**, **Guest**, **Authenticated**, or **Public** under **Permission audience**. Only that audience's editor is shown.
3. Select a preset, **All**, **None**, or individual permission checkboxes.
4. Select **Update permissions**.
5. Test the result using the kind of profile you intended to affect.

Switching audiences keeps every unsaved selection. **Update permissions** saves all four audiences together, including
an audience whose checkboxes you cleared. Permission checkboxes are grouped by purpose; expand **Presets** for a
starting set. Because grants combine, changing one audience never subtracts permissions supplied by another audience.

## Add or change a named administrator

1. Open **Entity settings** → **Access** → **Administrators** and select **Add**.
2. In the **Add administrator** area within the dialog, search under **User (name or email)** and select the intended profile.
3. Choose an **Initial preset**, or leave it on **None**.
4. Select **Add**.
5. Expand the new administrator, adjust the checkboxes, and select **Save**.

Use **Remove** to delete the individual administrator entry. Removal does not remove permissions that the profile still receives through Public, Guest, Authenticated, or Participant.

An initial preset of **None** creates an administrator entry with no individual capability. The item can still appear in that profile’s **Administrable entities** collection because the assignment exists, but actions remain unavailable until another matching grant supplies them.

## Sharing recipes

### Normal open collaboration

Use the initial **Public: Default Entity** selection. It includes **Access Registration**, **Access View**, **Access Create**, and **Access Items**.

This starting point does **not** grant editing, item creation, assignment management, permission management, export, or duplication. Add only the action permissions the group actually needs.

**Access Create** does not replace the normal creation requirements. Starting a new top-level item still requires a signed-in full account and any feature-specific checks.

### Full-account profiles only

To grant an action only to people using full accounts:

1. Set the action to **None** under **Public**.
2. Also clear it under **Guest** because full-account profiles receive the Guest grant too.
3. Select it under **Authenticated**.
4. Check Participant and individual entries for unintended copies of the same permission.

### Registered event participants only

For an Activity plan, Packing list, or Drivers list linked to an event:

1. Clear the relevant permissions from Public, Guest, and Authenticated.
2. Under **Participant**, select **Access View** and the actions participants need.
3. Add **Access Participants** only when participants should see names or participant/assignee lists.

A registered participant can enter the linked resource through the event relationship. **Access View** is still important because several self-service actions use it as their permission check.

A nonparticipant can enter a linked resource only when their effective grants include **Access View**.

### Read-only participation

Give the intended audience **Access View** and do not add edit, item, management, data, or administration permissions. Add **Access Participants** or **Access Items** only when those lists should be visible.

For an unlinked activity plan, packing list, or drivers list, permissions are primarily action grants rather than a universal page-privacy switch. A person with the URL may be able to establish an active profile and open the page even when all group checkboxes are clear, while protected actions remain unavailable. Treat the item link as sensitive when the page content itself must be restricted.

### Let participants add entries without managing everybody

Give the intended audience:

- **Access View** for the collaborative page and self-service actions.
- **Item Add** to create activity slots, packing items, or driver rows.

Do not add **Manage Assignments** merely to let people join or leave their own assignment. That permission controls more powerful assignment and role-management actions.

### Delegate a limited organizer

Add the organizer under **Administrators**, then grant only the required labels. Common combinations include:

- **Full Edit** for top-level details.
- **Full Item** for adding, editing, reordering, and deleting child entries.
- **Manage Assignments** for administering other people’s assignments or roles.
- **Manage Registrations** for event registration administration.
- **Manage Permissions** for changing sharing and administrators.
- **Access Admin** for entering an event’s administration dashboard.

For an event permission manager, grant **Manage Permissions**. That exposes the permission controls in **Entity settings** on the event page. Add **Access Admin** only when the organizer also needs to enter the dashboard.

### Delegate property or event-link editing

**Entity settings** shows only authorized fields and actions. Grant **Edit Title** for a title-only editor or **Edit Desc** for a description-only editor. An event editor with only **Manage Requirements** sees the dietary requirement controls. These profiles do not need **Access Admin** merely to use the dialog.

Changing or clearing the event linked to an activity plan, packing list, or drivers list requires **Edit Meta** on that resource. Selecting a destination additionally requires **Manage Assignments** on the destination event. Past, deadline-passed, and archived events remain eligible under those same permissions; being listed as an event administrator without the required grant is insufficient.

After a link change, event-participant grants are evaluated against the new event. Existing records and individual grants remain, but a profile relying on the old event's participant access may lose access. Review the new sharing boundary before selecting **Save event link**. See [Choose an event](EVENTS.md#choose-an-event) for the selector and its filters.

### Delegate complete control

Select **Admin** for the named administrator. This grants every available permission, but it does not transfer ownership. Actions reserved for the owner, such as permanently deleting the item, remain owner-only.

## Permission-label reference

Use these labels to choose the actions a person may perform. Feature guides explain where each action appears.

| UI label | What it allows |
|---|---|
| **Edit Title** | Change the title of an event, plan or list. |
| **Edit Desc** | Change the description of an event, plan or list. |
| **Edit Capacity** | Change the event capacity or a supported item capacity. |
| **Edit Meta** | Change other settings such as dates, location, the header image, or a plan/list's event link. Selecting a destination also needs Manage Assignments there. |
| **Item Add** | Add activity slots, packing items or driver rows. |
| **Item Edit** | Reorder slots or list items and allow supported edits to those entries. |
| **Item Edit Desc** | Edit slot or list-item descriptions without granting the broader Item Edit permission. |
| **Item Edit Meta** | Edit supported settings of individual entries, currently activity slots, without granting the broader Item Edit permission. |
| **Item Delete** | Delete slots or list items. |
| **Manage Assignments** | Manage other people’s assignments or roles. Ordinary self-service actions may need only Access View. |
| **Manage Requirements** | Manage event requirement settings and activity-plan requirements, rules, and shared-field definitions. |
| **Manage Registrations** | Manage event registration links and participant registrations. |
| **Manage Permissions** | Open and change Group Permissions and Administrators. |
| **Data Export** | Export supported data. Event participant export also requires Access Participants. |
| **Data Duplicate** | Open the duplicate form. Completing creation still requires a full account. |
| **Access Registration** | Register for an event. |
| **Access View** | Enter an event-linked plan or list as a nonparticipant and use the collaborative actions allowed by its sharing rules. |
| **Access Create** | Included in the standard access presets. Creating an event, plan or list still requires a full account and the permissions described in its guide. |
| **Access Admin** | Open the Event administration dashboard. It does not grant every management permission. |
| **Access Participants** | See participant or assignee names and lists where available. |
| **Access Items** | See an event’s related activity plans, packing lists, and drivers lists. |

If you are asked to log in when submitting a duplicate, you return to the same duplicate form after logging in.
Review its values before submitting it again.

## Preset reference

Selecting a preset replaces the current checkboxes in that one audience or administrator section.

| Preset | Permissions selected |
|---|---|
| **Full Edit** | **Edit Title**, **Edit Desc**, **Edit Capacity**, **Edit Meta** |
| **Full Item** | **Item Add**, **Item Edit**, **Item Edit Desc**, **Item Edit Meta**, **Item Delete** |
| **Full Manage** | **Manage Assignments**, **Manage Requirements**, **Manage Registrations**, **Manage Permissions** |
| **Full Data** | **Data Export**, **Data Duplicate** |
| **Full Access** | **Access Registration**, **Access Create**, **Access View**, **Access Admin**, **Access Participants**, **Access Items** |
| **Admin** | **Edit Title**, **Edit Desc**, **Edit Capacity**, **Edit Meta**, **Item Add**, **Item Edit**, **Item Edit Desc**, **Item Edit Meta**, **Item Delete**, **Manage Assignments**, **Manage Requirements**, **Manage Registrations**, **Manage Permissions**, **Data Export**, **Data Duplicate**, **Access Registration**, **Access Create**, **Access View**, **Access Admin**, **Access Participants**, **Access Items** |
| **Default Entity** | **Access Registration**, **Access View**, **Access Create**, **Access Items** |

### Initial selections

| Item type | Initial group selection |
|---|---|
| Event | **Public: Default Entity**; **Participant: Access Participants**; Guest and Authenticated have no additional selection. |
| Activity plan | **Public: Default Entity**; all other audiences have no additional selection. |
| Packing list | **Public: Default Entity**; all other audiences have no additional selection. |
| Drivers list | **Public: Default Entity**; all other audiences have no additional selection. |
| Survey | No general permission matrix; surveys use their own participation model. |

**Default Entity** includes **Access Items** as well as **Access Registration**, **Access View**, and **Access Create**.

## Parent and child permissions

Activity slots, packing items and driver rows belong to a plan or list. Permissions on the plan or list can allow actions on its entries. An individual entry may also have additional permissions.

Common parent-wide behavior is:

- **Item Edit** allows several supported edits and reordering.
- **Item Edit Desc** allows editing descriptions.
- **Item Edit Meta** allows editing supported settings, currently those of activity slots.
- **Item Delete** can authorize deleting child entries.
- **Manage Assignments** can authorize managing child assignments.

The available actions depend on the feature and the entry's permissions. A permission on the plan or list does not always allow the same action on every entry. Use the feature guide and visible controls to confirm the effect of a narrowly delegated role.

## Page access is not the same as an action permission

Most shared feature pages first establish an active profile. A visitor without one is sent through the guest-entry flow.

For an event-linked Activity plan, Packing list, or Drivers list:

- A registered event participant can enter.
- A nonparticipant needs effective **Access View**.
- Otherwise Surveyor reports that event registration is required.

For an unlinked plan or list, an active profile can generally open the page even when **Access View** is not selected. Individual actions still require their specific permissions. Choosing **None** therefore does not guarantee that the page is inaccessible.

## Troubleshooting

### A permission remains after I cleared it

The active profile probably receives the same label from another source. Check Public first, then Guest, Authenticated, Participant, and the individual administrator entry. Also confirm whether the profile is the owner.

### A full-account user receives a Guest permission

That is the current audience model: Guest is applied to every active guest-backed or full-account-backed profile. Clear the permission from Guest when it must be exclusive to Authenticated profiles.

### A participant cannot use an action on a linked list or plan

Confirm all of the following:

- The correct profile is active.
- That profile is registered for the linked event.
- Participant has **Access View**.
- Participant has the permission for the requested action.
- Another feature rule, such as capacity or a deadline, is not blocking the action.

### An event organizer cannot open the administration dashboard

Grant **Access Admin**. Grant the additional management permissions needed inside the dashboard, such as **Manage Permissions**, **Manage Registrations**, or **Access Participants**.

Property and permission changes can instead be made through **Entity settings** on the ordinary event page with their respective action grants. If **Entity settings** or a field is missing, check the active profile's relevant permission rather than granting dashboard access alone.

### An administrator appears but cannot do anything

The entry may have been added with **None**, or its selected permissions may not cover the action. Expand the administrator, choose the needed labels, and select **Save**.

### I cannot find a guest in Add administrator

The picker searches profiles connected to full accounts. Use audience permissions for guest profiles.

---

**Related guides**

- [Getting Started](GETTING_STARTED.md)
- [Your Overview](DASHBOARD.md)
- [Events](EVENTS.md)
- [Activity Plans](ACTIVITY_PLANS.md)
- [Packing Lists](PACKING_LISTS.md)
- [Drivers Lists](DRIVERS_LISTS.md)
- [Surveys](SURVEYS.md) — separate access and participation model
