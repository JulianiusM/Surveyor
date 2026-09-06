# Drivers Lists
<!--
documentation-metadata
audience: drivers; passengers; transport organizers
owner: drivers-list feature maintainers
status: current
last-verified: 2026-09-05
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: D11 driver, passenger, and organizer workflows; profile-derived driver identity; capacity and counter semantics; event linkage; permissions; privacy; images; duplication; deletion; and troubleshooting; D14 rendered help navigation, semantic checks, and trusted-content integration
source-anchors: src/views/drivers/drivers-create.pug; src/views/drivers/drivers-view.pug; src/public/js/drivers.ts; src/routes/drivers.ts; src/routes/api/drivers.ts; src/controller/driversController.ts; src/middleware/guestFlowFactory.ts; src/middleware/assignFlowFactory.ts; src/middleware/entityHeaderUpdateHandler.ts; src/modules/database/entities/drivers/DriversList.ts; src/modules/database/entities/drivers/DriversItem.ts; src/modules/database/entities/drivers/DriversAssignment.ts; src/modules/database/services/DriverService.ts; src/modules/lib/permissions.ts; src/views/event/event-dashboard.pug; src/views/modules/module_entity_header.pug; src/views/modules/module_unified_entity_cards.pug; tests/integration/drivers-workflows.spec.ts; tests/integration/controller-smoke-workflows.spec.ts; docs/decisions/DEC-003-DRIVER-LIST-PARTICIPANT-COUNT.md; src/controller/helpController.ts; tests/unit/help-documentation.spec.ts
next-review: drivers-visible-UI-or-behavior-change
-->

Drivers lists coordinate ride offers and passenger seats. Each row is one ride offered by the active profile that created it. Other participants can take an available passenger place.

> **Driver names come from profiles.** The **Driver** value is the name of the profile that added the row. It is not an editable field in the drivers list. Change the profile name in **Profile settings** when the displayed name is wrong.

> **Descriptions and names are shared.** Everyone admitted to the list can see driver names, passenger names, and ride descriptions. Do not put a private phone number, email address, home address, or other sensitive information in a description unless it is acceptable for every admitted viewer to see it.

## Choose your task

- [Take a passenger place](#take-a-passenger-place)
- [Remove yourself from a ride](#remove-yourself-from-a-ride)
- [Offer a ride](#offer-a-ride)
- [Open a list as a guest](#open-a-list-as-a-guest)
- [Understand the counters](#understand-the-counters)
- [Create a drivers list](#create-a-drivers-list)
- [Edit, reorder, or delete ride offers](#manage-ride-offers)
- [Link a list to an event](#link-a-drivers-list-to-an-event)
- [Configure permissions](#configure-sharing-and-permissions)
- [Duplicate or delete a list](#duplicate-or-delete-a-drivers-list)
- [Troubleshoot a drivers list](#troubleshooting)

## Understand drivers, rides, and assignments

A drivers list contains three related kinds of information:

| Information | Meaning |
|---|---|
| Drivers list | The shared title, description, optional event, image, and permissions. |
| Driver row | One ride offer created by a profile, with a shared description and passenger capacity. |
| Assignment | One profile taking one passenger place on one driver row. |

A driver can add several rows for different departure times, routes, journey legs, or vehicles. The same profile name then appears on each row. A driver is not automatically assigned as a passenger on their own row, and the driver does not consume one of the passenger places.

A passenger can take more than one row. This is useful when the rows represent separate journey legs. When rows are alternatives for the same journey, remove the old assignment after choosing another ride.

## Open and read a drivers list

Open the link supplied by the organizer, select the list from an event, or open it from [Your overview](DASHBOARD.md).

- With an active profile, Surveyor opens a standalone list directly.
- For a standalone list without an active profile, Surveyor sends you through guest entry.
- An event-linked list normally requires registration for that event. Enter or register through the event first. A nonparticipant with an active profile can enter only when the list grants effective **Access View** permission.

Check the active profile in the user menu. Ride offers and passenger assignments belong to that profile, not to the full account as a whole.

### Read the driver table

| Column | Meaning |
|---|---|
| **Driver** | Profile name of the person who created this ride offer. |
| **Description** | Shared vehicle, route, meeting-point, departure, luggage, or accessibility information. |
| **Assignees** | Profile names of passengers who selected **Take**. |
| **Assigned / Max** | Current passenger assignments and the maximum number of passenger places. |
| **Action** | **Take**, **Remove**, **Full**, and any organizer controls available to the active profile. |

**Max #** is the number of passenger places. It excludes the driver. For example, a car with the driver plus three passengers should use **Max #** `3`.

## Take a passenger place

For a row with an available place:

1. Check the driver, description, meeting point, and departure details.
2. Select **Take**.
3. Confirm that the active profile’s name appears under **Assignees**.
4. Confirm that **Assigned / Max** increases.

When the maximum is reached, the row shows **Full** and another participant cannot take it. Taking or removing your own assignment requires effective **Access View** permission.

### Remove yourself from a ride

1. Find the row assigned to the active profile.
2. Select **Remove** in the **Action** column.
3. Confirm that the profile name disappears and the count decreases.

The small **×** beside an assignee name is a separate driver or organizer control for removing another person. A passenger should normally use their own **Remove** button.

A driver or passenger finds a list under **Your participation** after the active profile offers a ride or takes a passenger place. Owners and delegated administrators also find it under **Administrable entities**.

## Offer a ride

A profile needs effective **Item Add** permission before **Add new item** appears. Opening the list or being registered for a linked event does not by itself grant the ability to add a driver row.

1. Open the drivers list with the profile that should be shown as the driver.
2. Find **Add new item** below the table.
3. Check the read-only **Driver** field. It shows the active profile name.
4. Enter a **Description** containing the nonprivate logistics participants need.
5. Set **Max #** to the number of passenger places, as a whole number of at least 1.
6. Select **Add**.

The new row appears with that profile as its owner. A useful description can include:

- origin or meeting point;
- destination or journey leg;
- departure date and time;
- vehicle description;
- luggage or accessibility limitations; and
- a public coordination note.

Use a private communication channel for personal contact details. Surveyor does not provide a private contact field or direct messaging between a driver and passengers.

### Correct the displayed driver name

The **Driver** column cannot be edited from the list because it identifies the profile that owns the row.

- To change that profile’s displayed name everywhere, open the profile menu and select **Profile settings**.
- When the wrong profile created the row, delete the row, switch to the intended profile, and add the ride again.

Changing a profile name changes how that profile is displayed anywhere Surveyor uses it; it is not a list-specific nickname.

## Open a list as a guest

Guest capabilities depend on access and permissions rather than on guest status alone.

For a standalone list:

1. Open the drivers-list invitation.
2. Select **Continue as guest** when no profile is active.
3. Enter a display name and, preferably, an email address.
4. Preserve the private guest link sent or shown by Surveyor.
5. Use the controls granted to that guest profile.

For an event-linked list, first open the event invitation and register the guest profile for the event, then open the drivers list from the event. A list-specific **Access View** grant can deliberately admit an already active nonparticipant profile.

A guest with **Access View** can take or remove their own passenger place. A guest can offer a ride only when the effective permissions also include **Item Add**. A driver-row owner can manage their own row after creating it. See [Getting Started — Recover guest access by email](GETTING_STARTED.md#recover-guest-access-by-email), [Events](EVENTS.md), and [Permissions and Sharing](PERMISSIONS.md).

## Understand the counters

The top of the page shows four different measurements:

- **Participants** — distinct profiles assigned to one or more driver rows. A driver who only offers a ride is not counted. The same passenger assigned to several rows is counted once.
- **Drivers** — number of driver rows, not number of unique people. One profile offering three rides contributes three rows.
- **open** — driver rows with at least one passenger place remaining.
- **empty** — driver rows with no passenger assignments.

These values answer different questions. **Participants** is not the number of driver rows, the number of raw assignments, or the total passenger capacity.

### Counter examples

| List state | Participants | Drivers | Explanation |
|---|---:|---:|---|
| Three ride offers and no passengers | 0 | 3 | Driver-only rows do not add participants. |
| One person takes two separate rows | 1 | 2 | The assignee is deduplicated across the list. |
| Two different people take one row each | 2 | 2 | Each distinct assignee is counted once. |
| A driver also takes a place on a row | 1 | At least 1 | The profile is counted because of the passenger assignment, not because it is a driver. |

## Create a drivers list

Creation requires a signed-in full account. A guest can participate when permitted but cannot create a list. The active profile becomes the owner.

### 1. Open the creation form

1. Open **New** in the top navigation.
2. Under **Organize & share**, select **Drivers list**.

An event organizer with **Manage Assignments** for the event can instead open the **Event administration dashboard**, expand **Event drivers lists**, and select **Create new drivers list**. The event is then preselected.

### 2. Enter the list details

| Field | What to enter |
|---|---|
| **Title \*** | A required name participants will recognize. |
| **Description (optional)** | Shared overall instructions, common meeting information, or transport scope. |
| **Header image (optional)** | An optional JPEG, PNG, or GIF image up to 10 MiB. |
| **Assign to event (optional)** | An active event managed by the current profile. |
| **Group Permissions** | The initial audience permissions for the new list. |

The creation form does not add driver rows. Create the list first, then grant the intended audience **Item Add** and let each driver add their own ride under the correct active profile.

### 3. Review sharing before creation

Drivers lists use the general cumulative permission system. The normal non-event default gives the Public audience basic access but does not include **Item Add**. Decide who should be allowed to offer rides before sharing the link.

For an event-linked list, granting **Item Add** to the Participant audience is a common way to limit ride creation to registered event participants. Other arrangements are possible; see [Permissions and Sharing](PERMISSIONS.md).

### 4. Create and test the list

1. Select **Create list**.
2. Add one test ride with the intended driver profile.
3. Open the link with a participant or test profile.
4. Confirm that page admission, **Take**, **Remove**, and **Add new item** match the selected permissions.
5. Remove the test data when it is no longer needed.

## Manage list content

### Edit the shared list description

A profile with **Edit Desc** sees **Double click to edit** above the description.

1. Double-click the description area.
2. Enter the revised text.
3. Press **Ctrl+Enter** or click elsewhere to save. Press **Escape** to cancel.

The list title has no in-place editor on the current drivers-list page.

## Manage ride offers

### Edit a ride description

The row owner or another profile with the required item-edit permission can double-click **Description**, change the shared logistics, and press **Enter** or click elsewhere to save. Press **Escape** to cancel.

### Change passenger capacity

The row owner or a permitted editor can double-click the maximum value under **Assigned / Max**, enter a whole number of at least 1, and press **Enter** or click elsewhere to save. Press **Escape** to cancel.

Do not lower the maximum below the visible number of assigned passengers. Remove or move passengers first, then reduce the capacity.

### Reorder rides

A profile with **Item Edit** can drag rows into a new order. Use this to group rides by journey leg, departure time, origin, or destination.

### Remove another passenger

The driver-row owner or a profile with **Manage Assignments** sees a small **×** beside each passenger name. Select it to remove that assignment. This does not delete the passenger’s profile or event registration.

### Delete a ride offer

The row owner or a profile with **Item Delete** sees a trash button.

1. Select the trash button.
2. Confirm **Delete this driver permanently?**

Deleting the row permanently removes that ride offer and all passenger assignments attached to it. It does not delete the driver or passenger profiles.

## Manage the header image

A profile with **Edit Meta** sees one of these controls in the list header:

- **Add image** when no image exists;
- **Change image** and **Remove** when an image exists.

The upload accepts JPEG, PNG, and GIF images up to 10 MiB. Replacing or removing an image removes the previous stored file.

## Link a drivers list to an event

Use **Assign to event (optional)** during creation when the transport belongs to one event.

A linked list:

- appears under **Event drivers lists**;
- shows **Go to event** in its header;
- normally admits profiles registered for that event;
- requires effective list-specific **Access View** for a nonparticipant; and
- is deleted with the event because it is part of that event’s stored data.

The selected event must be an active event managed by the current profile. Creating from the event administration dashboard preselects it.

Event registration controls admission to the linked page. Driver-list permissions separately control actions such as taking a place, adding a ride, editing content, removing assignments, or administering permissions.

## Configure sharing and permissions

A profile with **Manage Permissions** can expand **Administration Options** and edit **Group Permissions** or named **Administrators**. Grants are cumulative; the owner always has complete access.

Common drivers-list actions use these permissions:

| Goal | Relevant permission or ownership rule |
|---|---|
| Open an event-linked list without event registration | **Access View** |
| Take or remove your own passenger place | **Access View** |
| Edit the shared list description | **Edit Desc** |
| Add, replace, or remove the header image | **Edit Meta** |
| Add a ride offer | **Item Add** |
| Reorder rows and broadly edit child rows | **Item Edit** |
| Edit only a ride description | **Item Edit Desc** |
| Delete a ride row | Row owner or **Item Delete** |
| Remove another passenger | Row owner or **Manage Assignments** |
| Change group or administrator grants | **Manage Permissions** |
| Open the duplicate flow | **Data Duplicate** |

Creating a ride makes the active profile the owner of that row, so the driver can manage their own row even when they do not administer the complete list.

See [Permissions and Sharing](PERMISSIONS.md) for overlapping audiences, individual grants, presets, parent-item fallbacks, named administrators, and the distinction between page admission and action permissions.

### Privacy before sharing

Everyone admitted to the page can see:

- the drivers-list title and description;
- every driver profile name;
- every ride description;
- every assigned passenger profile name; and
- the visible capacity and assignment count.

There is no organizer-only passenger column, anonymous assignment, private ride note, or direct-message feature. Use an external private channel for phone numbers, exact home addresses, health information, or other sensitive coordination.

## Duplicate or delete a drivers list

### Duplicate a list

Duplicating requires **Data Duplicate**. The owner can start the flow from **Overview** → **Your overview**:

1. Expand **Administrable entities**.
2. Find the drivers list and select **Duplicate**.
3. Review the prefilled title, description, and **Group Permissions**.
4. Choose **Assign to event (optional)** for the new list when needed.
5. Select **Create list**.
6. Ask drivers to recreate the applicable ride offers under their own active profiles.

The duplicate is an independent list. It does not copy driver rows, passenger assignments, the previous event link, or the header image. Review all fields before creation rather than assuming the copy inherits the old event or sharing boundary.

### Delete a complete list

Only the list owner can delete the complete drivers list.

1. Open **Overview** → **Your overview**.
2. Expand **Administrable entities**.
3. Find the list and select **Delete**.
4. Confirm the deletion.

Deletion permanently removes the list, every driver row, every passenger assignment, and the stored header image. Surveyor has no drivers-list archive or in-app restore action. A linked list is also removed when its event is deleted.

## Capabilities and limits

| Supported | Not provided |
|---|---|
| Several ride offers per driver profile | Automatic driver-passenger matching |
| Shared route, time, meeting, vehicle, luggage, and accessibility notes | Route maps, navigation, or distance calculation |
| Capacity-limited self-service passenger assignments | Waiting lists or automatic reassignment |
| Event-linked and standalone lists | Recurring-driver rotation or schedule generation |
| Row-owner and delegated organizer controls | Private contact fields or direct messaging |
| Header images, duplication, and permanent deletion | Transport-cost calculation, export, archive, or in-app restore |

## Practical examples

### Separate outbound and return journeys

One driver can add **Friday — station to camp** and **Sunday — camp to station** as two rows. Passengers take each journey leg they need. The same passenger assigned to both rows contributes one to **Participants** and two raw assignments.

### Several departure times

Add one row for each vehicle and departure time. Put the origin, destination, and time at the start of each description, then reorder the rows chronologically.

### Event transport

Create the list from **Event drivers lists**, grant registered participants the actions they need, and keep personal contact details in an agreed private channel. Event registration admits participants to the linked list, while the list’s permissions control ride creation and assignments.

## Troubleshooting

### **Add new item** is missing

The active profile lacks effective **Item Add** permission. Event registration and page access alone do not grant it. Ask the list owner or a profile with **Manage Permissions** to review **Administration Options**.

### The wrong driver name appears

Check the active profile in the user menu. The name comes from the profile that created the row. Change the profile’s displayed name through **Profile settings**, or delete the row and recreate it with the intended profile.

### **Take** is missing or does not work

Check whether:

- the row is already **Full**;
- the active profile is already assigned and should use **Remove**;
- the event-linked list requires registration; or
- the profile has effective **Access View** permission.

### An event-linked list says registration is required

Register the active profile for the event, or ask an organizer to grant list-specific **Access View** when nonparticipant access is intentional. Switching profiles can change both event registration and permissions.

### The participant number seems too low

**Participants** counts only distinct passenger assignees. It does not include a driver merely because they offered a ride, and it counts one passenger assigned to several rows only once. Use **Drivers** for the number of ride rows and each **Assigned / Max** value for row-level capacity.

### The list is missing from **Your overview**

Confirm the active profile.

- Owners and delegated administrators find the list under **Administrable entities**.
- A driver or passenger finds it under **Your participation** after offering a ride or taking a place.
- Merely opening the link does not create participation state.

### I cannot edit or remove another person’s row or assignment

A ride row belongs to the profile that created it. Managing another row requires the corresponding list or item permission. Ask the owner or a profile with **Manage Permissions** to grant only the capabilities needed.

### A capacity change would leave too many passengers

Remove or move enough passengers first. Then set **Max #** to a whole number of at least 1 that is not below the visible assignment count.

## Related guides

- [Getting Started](GETTING_STARTED.md) — Accounts, guests, recovery, and active profiles.
- [Your Overview](DASHBOARD.md) — Find participated-in and administrable lists.
- [Permissions and Sharing](PERMISSIONS.md) — Complete sharing recipes and permission reference.
- [Events](EVENTS.md) — Event registration and linked resources.
- [User Guide Home](README.md) — All feature guides.
