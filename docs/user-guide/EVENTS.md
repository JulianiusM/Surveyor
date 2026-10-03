# Events Guide
<!--
documentation-metadata
audience: event participants; event organizers
owner: event feature maintainers
status: current
last-verified: 2026-10-03
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: compartmentalized settings tabs, compact audience editor, paged event search, and restored searchable timezone controls; source-reviewed Entity settings dialog labels, per-action permissions, root property changes, image/actions, minimal archival hints, and event selection/reassociation boundaries; archival behavior and labels reviewed against shared policy, persistence service, and Pug controls; expanded event descriptions and dietary-note limits; invoice factors, rebates, progress feedback, calculation previews, payment carry-forward, rollback, and email-control entry points; D05 event creation, registration, deadline, dietary, participant-management, related-entity, export, permission, and privacy workflows verified; D06 invoice-pool entry points and permission boundary linked to the dedicated guide; D14 rendered help navigation, semantic checks, and trusted-content integration
source-anchors: src/views/modules/module_entity_properties.pug; src/public/js/modules/entity-properties.ts; src/views/modules/module_entity_select.pug; src/public/js/modules/entity-select.ts; src/controller/entityAdminController.ts; src/modules/archive/policy.ts; src/modules/database/services/EntityLifecycleService.ts; src/views/modules/module_entity_archive.pug; src/views/modules/module_invoice_pool.pug; docs/user-guide/INVOICE_POOLS.md; src/routes/event.ts; src/routes/api/event.ts; src/controller/eventController.ts; src/middleware/guestFlowFactory.ts; src/modules/database/entities/event/; src/modules/database/services/EventService.ts; src/modules/lib/fileCommons.ts; src/modules/lib/pdf.ts; src/modules/lib/permissions.ts; src/views/event/event-create.pug; src/views/event/event-view.pug; src/views/event/event-dashboard.pug; src/views/modules/module_registration_links.pug; src/views/modules/module_event_participants.pug; src/public/js/events.ts; src/public/js/modules/reg-links.ts; src/public/js/modules/event-participant.ts; src/controller/helpController.ts; tests/unit/help-documentation.spec.ts
next-review: event-visible-UI-or-behavior-change
-->

Use an event to collect attendance dates, optional dietary information, and related packing, activity, and transport plans.

## Choose your task

- [Join and register for an event](#join-and-register-for-an-event)
- [Change or cancel your registration](#change-or-cancel-your-registration)
- [Create an event](#create-an-event)
- [Change event properties](#change-event-properties)
- [Manage registrations](#manage-registrations)
- [Create a late-registration link](#create-a-late-registration-link)
- [Use invoice pools and shared payments](INVOICE_POOLS.md)
- [Link packing, activity, and drivers lists](#link-plans-and-lists-to-the-event)
- [Export the participant list](#export-the-participant-list)
- [Archive or restore the event](#archive-or-restore-the-event)

## Join and register for an event

### 1. Open the invitation

Open the event link supplied by the organizer. Surveyor asks you to use an existing account, create a full account, or **Continue as guest** when you do not already have an active profile.

A guest should enter an email address whenever possible and keep the private guest link. The email and private link make it possible to return to the same registration later. See [Getting Started](GETTING_STARTED.md#join-an-invitation-as-a-guest) for the complete guest and recovery workflow.

### 2. Review the event information

The top of the event page can show:

- The event dates and location.
- **Max. / registered participants** when the organizer set a capacity.
- The **Binding deadline**, both in the event time zone and in your time zone.
- A live countdown to the deadline.
- The event description and header image.

The event owner is not automatically added to the attendance list. Owners who will attend should register normally so that their dates, dietary information, and place in the capacity count are included.

### 3. Complete **Register for this event**

Enter:

1. **Arrival date** — the first day you will attend.
2. **Departure date** — the last day you will attend.
3. Dietary information, when the organizer requires it.
4. Select **Save registration**.

Arrival and departure are both required. They must be within the event’s start and end dates, and arrival cannot be after departure.

When the event has reached **Max Participants**, Surveyor displays **This event is full.** New registrations are blocked. An existing participant can still open and update their registration, subject to the deadline rules below. Surveyor does not provide a waiting list.

### Dietary information

When **Require dietary info during registration** is enabled, select at least one meal preference:

- **Meat**
- **Fish**
- **Vegetarian**
- **Vegan**

Meat and Fish may be selected together. Vegetarian cannot be combined with Meat, Fish, or Vegan. Vegan cannot be combined with Meat, Fish, or Vegetarian.

You may also select **Halal**, **Kosher**, or **Allergies**. When you select **Allergies**, enter the allergy details in **Allergies (if selected)**. Allergy details can contain up to 4,000 characters.

When the organizer enabled diet comments, you can select **Comment** under **Additional diet comments (optional)** and enter the explanation in **Comment (if selected)**. The comment can contain up to 4,000 characters.

Treat allergy and dietary-comment fields as sensitive personal information. The organizer controls who receives **Access Participants**, which permits viewing this information together with participant names, email addresses, and attendance dates.

## Change or cancel your registration

After registration, the event page shows **Your registration**.

To change it:

1. Edit **Change arrival** and **Change departure**.
2. Update the dietary fields when they are shown.
3. Select **Update**.

To withdraw, select **Cancel registration** and confirm the action.

### What the binding deadline changes

Before the binding deadline, a participant can register, update, or cancel as permitted by the event’s access settings.

After the deadline:

- A new participant needs an active late-registration link from an organizer.
- Attendance dates can be changed only when **Allow registration date update after deadline expired** is enabled.
- Dietary choices and notes can be changed only when **Allow diet update after deadline expired** is enabled.
- A registration can be cancelled only when **Allow cancelling registration after deadline expired** is enabled.

When no binding deadline is set, these after-deadline switches do not restrict normal self-service changes.

A late-registration link bypasses only the binding deadline. It does not bypass event capacity, required fields, access permissions, expiry, revocation, or its configured number of uses.

## What appears after registration

A registered participant may see:

- **Participants**, when their effective permissions include **Access Participants**.
- **Things to do**, when the event grants **Access Items** and the organizer linked packing, activity, or drivers lists.
- **Invoice pools & payments**, when the event uses shared-cost pools.

See [Invoice Pools and Payments](INVOICE_POOLS.md) for submitting receipts with progress feedback, setting participant factors, managing takeovers and surcharges/rebates, previewing calculations, carrying recorded payments forward, rolling back pending pool edits, controlling settlement emails, and understanding proof retention.

## Create an event

Creating an event requires a signed-in full account. The active profile becomes the event owner; a guest profile cannot create an event.

1. Open **New** in the top navigation.
2. Under **Plan & decide**, select **Event**.
3. Complete the creation form.
4. Review **Group Permissions**, especially participant-data visibility.
5. Select **Create event**.

### Creation fields

| Field | What to enter |
|---|---|
| **Title** | Required event name, up to 255 characters. |
| **Start date** | Required first event date. |
| **End date** | Required last event date; it cannot be before the start date. |
| **Location (optional)** | Location text, up to 255 characters. |
| **Max Participants (optional)** | A positive whole-number capacity. Leave it empty for no capacity limit. |
| **Binding deadline (optional)** | Date and time after which normal self-service registration closes. |
| **Time zone** | Required time zone used to interpret and display the binding deadline. Surveyor also shows participants the corresponding time in their own time zone. |
| **Description (optional)** | Event details, up to 16,000 characters. |
| **Header image (optional)** | JPEG, PNG, or GIF image up to 10 MiB. |
| **Group Permissions** | Initial capabilities for Participant, Guest, Authenticated, and Public audiences. |

### Deadline and dietary switches

| Switch | Effect after creation |
|---|---|
| **Allow registration date update after deadline expired** | Existing participants may change arrival and departure after the deadline. |
| **Allow cancelling registration after deadline expired** | Existing participants may cancel after the deadline. |
| **Require dietary info during registration** | Registration displays the meal-preference and dietary-requirement fields. |
| **Allow diet comments during registration** | Registration also offers an optional Comment selection and text field. |
| **Allow diet update after deadline expired** | Existing participants may change dietary choices and notes after the deadline. |

A common strict setup is to set a binding deadline and leave all three after-deadline switches off. A more flexible setup enables only the changes that can still be handled operationally after final numbers are due.

## Review permissions before sharing

Events use the general permission system described in [Permissions and Sharing](PERMISSIONS.md). Permissions combine cumulatively, and **Access Admin** only opens the administration page; it does not automatically grant every action on that page.

The initial event setup grants:

- Public: **Access Registration**, **Access View**, **Access Create**, and **Access Items**.
- Participant: **Access Participants**.

That participant default means registered participants can initially view the participant list, including names, available email addresses, attendance dates, dietary choices, allergies, and comments. Before sharing the event, decide whether that is appropriate for the group.

For a privacy-focused event:

1. Remove **Access Participants** from the Participant audience.
2. Give **Access Participants** only to trusted organizers as individual administrators.
3. Add **Manage Registrations** only when those organizers should create late-registration links, edit attendance dates, or delete registrations.
4. Add **Data Export** as well as **Access Participants** only when they should create the participant PDF.

See [Permissions and Sharing](PERMISSIONS.md#delegate-a-limited-organizer) for delegation recipes and the explanation of cumulative grants.

## Share the event

Share the normal event page URL with participants. A recipient can log in, create an account, or continue as a guest before completing **Register for this event**.

The normal URL is the appropriate invitation before the binding deadline. Use a late-registration link only for a person who must register after that deadline.

## Change event properties

1. Open the event and select **Entity settings** in the header.
2. In **General**, expand **Details**, **Dates and time**, **Registration**, or **Dietary requirements** and edit the permitted fields.
3. Select **Save properties**.

The dialog shows only permitted fields and actions. A profile allowed to edit only the title sees **Title**; one allowed to manage dietary requirements sees those switches. **Access Admin** is not required for these settings on the ordinary event page. The same dialog is available from the administration dashboard.

**General** contains property groups and **Header image**. **Access** contains **Group Permissions** and
**Administrators**. **Actions** contains archival and other permitted commands. A tab appears only when you can use
something in it. Switching tabs keeps your drafts; opening the dialog does not expose all controls at once.

In **Dates and time**, select **Time zone** to search IANA zone names or open **Common time zones**. Each result shows
its UTC offset. **Use my time zone** selects the browser's zone. The chooser expands within the settings dialog and
retains these same features when used during event creation.

Dates, location, deadline, time zone, post-deadline policies, **Maximum participants**, and dietary switches use their separate permissions listed below. Each section saves separately. Errors keep your draft available; closing the dialog discards unsaved changes. Before a command refreshes the page, Surveyor asks you to resolve unsaved changes in other sections.

To change sharing or delegated access, open **Entity settings** → **Access**. See [Permissions and Sharing](PERMISSIONS.md#after-creation).

## Open the administration dashboard

A profile with **Access Admin** sees **Event administration dashboard** on the event page.

The dashboard keeps participant, registration, related-resource, and invoice workspaces. Properties and sharing controls are in **Entity settings**. Each control uses the profile’s relevant permission:

| Permission | Main event-administration capability |
|---|---|
| **Edit Title** | Change the event title. |
| **Edit Desc** | Change the description. |
| **Edit Meta** | Change dates, location, binding deadline, time zone, the post-deadline date/cancellation policy, and the header image; archive, restore, or pause/resume automatic archival. |
| **Edit Capacity** | Change **Maximum participants** in **Entity settings**. |
| **Manage Requirements** | Change required dietary information and dietary-comment/update policies. |
| **Manage Permissions** | Edit audience permissions and individual administrator grants. |
| **Access Participants** | View participant details, attendance totals, dietary totals, allergies, and comments. |
| **Manage Registrations** | Create and revoke late-registration links, adjust a participant’s attendance dates, and delete registrations. |
| **Manage Assignments** | Create event-linked plans/lists and manage event invoice pools. See [Invoice Pools and Payments](INVOICE_POOLS.md#organizer-tasks) for the complete cost workflow and privacy implications. |
| **Data Export** | With **Access Participants**, create the participant PDF. |

The owner receives all capabilities. An individual administrator receives only the permissions that were explicitly granted, plus any audience permissions that also apply to that profile.

## Manage registrations

### View and filter participants

With **Access Participants**, open **Participants** in the administration dashboard. The section provides:

- Attendance totals for each event date.
- Dietary totals.
- **Allergy / Comment Details**.
- A filter for participant name, email address, or dietary information.
- A table containing **Name**, **Email**, **Dates**, **Dietary**, and **Actions**.

The same participant section can appear on the event page for registered participants who have **Access Participants**.

### Adjust or remove a registration

With **Manage Registrations**:

- Use the date action to open **Adjust attendance window**, keep both dates inside the event window, and select **Save dates**.
- Use the delete action to remove a registration. Deletion cannot be undone from the participant table.

The organizer date editor changes arrival and departure. Participants manage their own dietary choices through **Your registration**.

Removing a registration also removes the person’s event-derived participant status. This can affect linked resources and invoice-pool assignment, submission, takeover, and share records. Review [Invoice Pools and Payments](INVOICE_POOLS.md) before deleting a registration that participates in shared costs.

## Create a late-registration link

A profile with **Manage Registrations** can create deadline-bypass links from **Registration links** in the administration dashboard.

1. Select **Create link**.
2. Set **Uses**. Use `1` for a single accepted late registration, or a larger positive whole number for a reusable link.
3. Optionally set **Expires (optional, local time)**. Leave it empty when the link should not expire automatically.
4. Select **Create**.
5. Give the copied link only to the intended participant or group.

The list shows each link’s token, creation time, expiry, and status. A link can be:

- `active` — available for use.
- `consumed` — its allowed number of registrations has been reached.
- `expired` — its expiry time has passed.
- `revoked` — an organizer disabled it.

Use **Copy** to copy an active link again. Use **Revoke** when a shared link should stop working immediately.

A successful new registration consumes one use. Updating an existing registration does not create another participant place. Keep these links private: possession of an active link permits deadline bypass for that event, although all other registration rules still apply.

## Link plans and lists to the event

The current event dashboard exposes three related resource types:

- **Event packing lists** → **Create new packing list**
- **Event activity plans** → **Create new activity plan**
- **Event drivers lists** → **Create new drivers list**

These creation actions preselect the current event. A profile needs **Manage Assignments** to create a resource for the event.

You can also create one of these resources from **New** and choose **Assign to event (optional)** in its creation form.

For a resource that already exists, open its own **Entity settings** → **Linked event**. Select the event, then **Save event link** and confirm. Changing the link requires **Edit Meta** on that plan or list and **Manage Assignments** on the destination event. Select **No event** to unlink; this preserves the resource and its records, assignments, files, and independent archival.

Moving a resource changes which event supplies participant access and inherited archival. Existing assignees are not automatically registered in the destination. Activity plans additionally recheck recommendation eligibility and clear obsolete generated pending suggestions; see [Activity Plans](ACTIVITY_PLANS.md#link-change-or-remove-an-event).

Registered participants can access an event-linked resource through their event participation. The **Things to do** collection appears on the event page only when the event also grants them **Access Items**. A person who is not registered needs suitable direct access to the linked resource.

The event dashboard does not currently expose an **Event surveys** section or a **Create new survey** action. Create and share a survey separately rather than expecting it to appear with the event’s packing, activity, and drivers lists.

### Choose an event

The event selector works the same way during creation and in **Entity settings** → **Linked event**. It includes every event your active profile may attach to, including past events, events whose registration deadline has passed, and archived events. You need **Manage Assignments** on the selected event; merely appearing as an administrator does not guarantee that permission.

1. Use **Search events** to find a title or description.
2. Select the event, using **Next page** when necessary.
3. During creation, finish the creation form. In **Linked event**, select **Save event link** and confirm.

The selector shows one page at a time. Use **Next page** and **Previous page** to browse while retaining your current selection. To narrow a long list, open **Filter by dates and state** and use these optional filters:

| Filter | Meaning |
|---|---|
| **From** / **To** | Events whose date range overlaps the selected dates. Either boundary may be left empty. |
| **Period** | **All**, **Upcoming**, **Ongoing**, or **Ended**. |
| **Archive state** | **All**, **Active**, or **Archived**. |
| **Registration deadline** | **All**, **Not passed / no deadline**, or **Passed**. |

All state filters start on **All**. A passed registration deadline and archival are different conditions; neither by itself prevents linking. Selecting an archived event shows **Archived with selected event** inside the selector because the resource inherits that event's archival.

**Reset filters** clears the search and filters without changing your selection. **No event** explicitly clears the selection. Filtering, paging, and empty results never change the selected event; **Current selection** stays visible. **Current event** can appear when the existing relationship is preserved but its details are unavailable to the active profile.

On a loading error, use **Try again**. If an expected event remains missing, reset the filters and check the active profile's **Manage Assignments** permission for that event.

## Export the participant list

A profile needs both **Data Export** and **Access Participants**.

1. Open the event and select **Entity settings**.
2. Under **Actions**, select **Export participants**.

The administration dashboard also offers **Exports** → **Participants (PDF)** to profiles admitted to that dashboard.

The PDF contains event information, attendance totals, dietary totals, and participant rows with names, available email addresses, dates, dietary choices, allergy details, and comments. Store and share it as sensitive personal data, and delete local copies when they are no longer needed.

## Header image, duplication, and deletion

A profile with **Edit Meta** can open **Entity settings** → **General** → **Header image**, use **Choose image**, and select **Upload**. Accepted images are JPEG, PNG, and GIF files up to 10 MiB. To remove the current image, select **Remove image** and confirm.

Under **Actions**, **Duplicate** opens a prefilled creation form for a new event. It requires a full account and **Data Duplicate**. **Delete permanently** is owner-only; verify the event and its linked contents before confirming. Owners can also use **Duplicate** or **Delete** from **Your overview**.

## Archive or restore the event

In **Entity settings** → **Actions** → **Archival**, an owner or organizer with **Edit Meta** can select **Archive for everyone** and confirm. The event, its linked plans and lists, registrations, and invoice pools become archived together. Existing access and actions remain available, and archival preserves all data and files. The **Things to do** and invoice sections remain usable. The ordinary event view shows only **This entity is archived.** when applicable.

Events can also be archived automatically after their inclusive end date and the site's configured delay. Use **Pause automatic archival** to keep an event active. Select **Restore for everyone** to restore an archived event; restoration pauses automatic archival until you select **Resume automatic archival**. Separately archived child entities stay archived when their event is restored.

Archived event cards move into **Archived and hidden** by default. To change only your own card placement, use **Hide for me**, **Show for me**, or **Use default visibility** in [Your Overview](DASHBOARD.md#hide-or-show-an-item-only-for-yourself). Invoice retention continues independently; archival does not delete proofs or header images.

## Troubleshooting

### I cannot see the registration form

Check the following:

- You have logged in or entered through the guest flow and have an active profile.
- The event is not full.
- Your effective permissions include **Access Registration**.
- If the binding deadline has passed, you opened an active late-registration link.

### I cannot update or cancel after the deadline

The organizer controls date updates, dietary updates, and cancellation with three separate switches. Ask the organizer which action remains enabled; a deadline-bypass link is for a new late registration and does not change an existing registration’s update policy.

### A related plan or list is missing

Confirm that:

- You are using the profile that is registered for the event.
- The resource is assigned to this event.
- The event gives you **Access Items** when you expect it under **Things to do**.
- The organizer has not removed your registration.

### I cannot open or use the administration dashboard

**Access Admin** is required to open the dashboard. Each section then requires its own permission. Ask the owner to grant the specific action rather than only the dashboard-entry permission.

Property, image, sharing, and archival controls can be available in **Entity settings** on the ordinary event page without dashboard access. If that button or a particular field is absent, the active profile lacks the corresponding action permission.

### Participant information is visible to more people than expected

Permissions are cumulative. Remove **Access Participants** from every audience and individual grant that applies to those profiles, then grant it only to the intended organizers. The [Permissions and Sharing](PERMISSIONS.md#permissions-that-seem-to-remain-enabled) troubleshooting steps explain how to find overlapping grants.

---

**Back to:** [User Guide Home](README.md)
