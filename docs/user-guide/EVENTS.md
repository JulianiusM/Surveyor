# Events Guide
<!--
documentation-metadata
audience: event participants; event organizers
owner: event feature maintainers
status: current
last-verified: 2026-09-05
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: D05 event creation, registration, deadline, dietary, participant-management, related-entity, export, permission, and privacy workflows verified; D06 invoice-pool entry points and permission boundary linked to the dedicated guide; D14 rendered help navigation, semantic checks, and trusted-content integration
source-anchors: docs/user-guide/INVOICE_POOLS.md; src/routes/event.ts; src/routes/api/event.ts; src/controller/eventController.ts; src/middleware/guestFlowFactory.ts; src/modules/database/entities/event/; src/modules/database/services/EventService.ts; src/modules/lib/fileCommons.ts; src/modules/lib/pdf.ts; src/modules/lib/permissions.ts; src/views/event/event-create.pug; src/views/event/event-view.pug; src/views/event/event-dashboard.pug; src/views/modules/module_registration_links.pug; src/views/modules/module_event_participants.pug; src/public/js/events.ts; src/public/js/modules/reg-links.ts; src/public/js/modules/event-participant.ts; src/controller/helpController.ts; tests/unit/help-documentation.spec.ts
next-review: event-visible-UI-or-behavior-change
-->

Use an event to collect attendance dates, optional dietary information, and related packing, activity, and transport plans.

## Choose your task

- [Join and register for an event](#join-and-register-for-an-event)
- [Change or cancel your registration](#change-or-cancel-your-registration)
- [Create an event](#create-an-event)
- [Manage registrations](#manage-registrations)
- [Create a late-registration link](#create-a-late-registration-link)
- [Use invoice pools and shared payments](INVOICE_POOLS.md)
- [Link packing, activity, and drivers lists](#link-plans-and-lists-to-the-event)
- [Export the participant list](#export-the-participant-list)

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

You may also select **Halal**, **Kosher**, or **Allergies**. When you select **Allergies**, enter the allergy details in **Allergies (if selected)**. Allergy details are limited to 255 characters.

When the organizer enabled diet comments, you can select **Comment** under **Additional diet comments (optional)** and enter the explanation in **Comment (if selected)**. The comment is limited to 255 characters.

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

See [Invoice Pools and Payments](INVOICE_POOLS.md) for submitting receipts, managing takeovers and surcharges, reviewing costs, calculating shares, recording settlement, and understanding proof retention.

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
| **Description (optional)** | Event details, up to 2,000 characters. |
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

## Open the administration dashboard

A profile with **Access Admin** sees **Event administration dashboard** on the event page.

Sections and controls appear according to the profile’s other permissions:

| Permission | Main event-administration capability |
|---|---|
| **Edit Title** | Change the event title. |
| **Edit Description** | Change the description. |
| **Edit Metadata** | Change dates, location, binding deadline, time zone, the post-deadline date/cancellation policy, and the header image. |
| **Edit Capacity** | Change **Max Participants**. |
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

Registered participants can access an event-linked resource through their event participation. The **Things to do** collection appears on the event page only when the event also grants them **Access Items**. A person who is not registered needs suitable direct access to the linked resource.

The event dashboard does not currently expose an **Event surveys** section or a **Create new survey** action. Create and share a survey separately rather than expecting it to appear with the event’s packing, activity, and drivers lists.

## Export the participant list

A profile needs both **Data Export** and **Access Participants**.

1. Open **Event administration dashboard**.
2. Find **Exports**.
3. Select **Participants (PDF)**.

The PDF contains event information, attendance totals, dietary totals, and participant rows with names, available email addresses, dates, dietary choices, allergy details, and comments. Store and share it as sensitive personal data, and delete local copies when they are no longer needed.

## Header image, duplication, and deletion

A profile with **Edit Metadata** can add, replace, or remove the event header image. Accepted images are JPEG, PNG, and GIF files up to 10 MiB.

The owner can use **Duplicate** or **Delete** from **Your overview**. Duplicating opens a prefilled creation form so that the copy can be reviewed before it is created. Deletion is an owner-only destructive action; verify the selected event before confirming it.

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

### Participant information is visible to more people than expected

Permissions are cumulative. Remove **Access Participants** from every audience and individual grant that applies to those profiles, then grant it only to the intended organizers. The [Permissions and Sharing](PERMISSIONS.md#permissions-that-seem-to-remain-enabled) troubleshooting steps explain how to find overlapping grants.

---

**Back to:** [User Guide Home](README.md)
