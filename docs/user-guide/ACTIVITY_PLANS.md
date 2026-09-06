# Activity Plans
<!--
documentation-metadata
audience: activity participants; activity organizers
owner: activity-plan maintainers
status: current
last-verified: 2026-09-06
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: D07 basic activity-plan creation and participation plus D08 advanced requirement configuration, live coverage, automatic recommendation generation, review, manual staging, application, and limitations verified; D14 rendered help navigation, semantic checks, and trusted-content integration
source-anchors: src/views/activity/activity-create.pug; src/views/activity/activity-view.pug; src/views/activity/parts/schedule.pug; src/views/activity/parts/participants.pug; src/views/activity/parts/participant-status.pug; src/views/activity/parts/assignments.pug; src/views/activity/parts/recommendations-schedule.pug; src/views/activity/parts/settings.pug; src/views/activity/export/schedule.pug; src/views/modules/module_role_assignment_addon.pug; src/public/js/activity-create.ts; src/public/js/modules/activity/activity-requirements.ts; src/public/js/modules/activity/activity-recommendation-jobs.ts; src/public/js/modules/activity/activity-recommendations-schedule.ts; src/public/js/modules/activity/activity-recommendations-state.ts; src/public/js/modules/activity/activity-recommendations-logic.ts; src/public/js/modules/activity/activity-recommendations-ui.ts; src/routes/activity.ts; src/routes/api/activity.ts; src/controller/activityController.ts; src/middleware/assignFlowFactory.ts; src/modules/activity/requirements.ts; src/modules/activity/availability.ts; src/modules/activity/fairAssignment.ts; src/modules/activity/autoAssignment.ts; src/modules/activity/recommendations.ts; src/modules/activity/recommendationJobs.ts; src/modules/database/services/ActivityService.ts; src/modules/database/services/ActivityRequirementService.ts; src/modules/database/services/ActivityRecommendationService.ts; tests/unit/activity-requirements.spec.ts; tests/frontend/activity-requirement-coverage.spec.ts; tests/unit/activity-auto-assignment.spec.ts; tests/unit/activity-recommendation-jobs.spec.ts; tests/integration/activity-workflows.spec.ts; src/controller/helpController.ts; tests/unit/help-documentation.spec.ts
next-review: activity-plan-visible-UI-or-behavior-change
-->

Activity plans provide a dated schedule of slots. Participants can join a complete slot or take a named role, while organizers can create slots, manage assignments, and link the plan to an event.

## Choose your task

### I am participating

- [Find a slot](#find-a-slot)
- [Join a slot](#join-a-whole-slot)
- [Take a named role](#take-a-named-role)
- [Leave a slot or role](#leave-a-slot-or-role)
- [Understand assignment warnings](#understand-assignment-warnings)
- [Edit a shared text field](#use-shared-text-fields)

### I am organizing

- [Create an activity plan](#create-an-activity-plan)
- [Add or edit slots](#add-and-edit-slots)
- [Add named roles](#add-named-roles-to-a-slot)
- [Correct role assignments](#manage-role-assignments)
- [Review participants](#review-participants)
- [Configure basic assignment rules](#configure-basic-assignment-rules)
- [Set participant requirements](#set-participant-requirements)
- [Check requirement coverage](#check-requirement-coverage)
- [Generate and review assignment suggestions](#generate-assignment-suggestions)
- [Stage manual corrections](#stage-a-manual-assignment-change)
- [Export the schedule](#export-the-schedule)

## Before you begin

The name shown in the user menu is your active profile. Participation, ownership, and assignments belong to that profile. See [Getting Started](GETTING_STARTED.md#understand-accounts-and-profiles) when you need to switch profiles or recover guest access.

A plan can be independent or assigned to an event. For an event-linked plan, you normally need a registration for that event before you can join slots. An organizer can instead enable **Allow non-participants to take slots**. You may still be able to view a linked plan when you cannot join it; in that case the schedule displays **Registration required** and an explanation above the filters.

The actions visible to you depend on the plan’s sharing settings. See [Permissions and Sharing](PERMISSIONS.md) for audience permissions and delegated organizer access.

## Participate in an activity plan

### Find a slot

Open the plan and stay on the **Schedule** tab. The schedule is grouped by week and day. Each slot can show:

- Its title, optional start and end time, and optional description.
- Named roles, such as Facilitator or Helper.
- The number assigned compared with **Max participants**.
- A status dot: **Overbooked**, **No assignments yet**, or **OK**.
- Participant names when you have permission to see them.

Use the schedule filters:

- **All slots** shows the complete schedule.
- **My slots** shows slots assigned to your active profile.
- **Open slots** shows slots that still have ordinary capacity. A full slot does not appear here even when the organizer permits joining beyond capacity.

The summary above the calendar shows the number of **Participants**, **Slots**, open slots, and unassigned slots. An unassigned slot currently has no participant; it is not necessarily unavailable.

When the organizer uses required participation, a message above the filters shows your progress, such as **You participate in 1 of 2 required slots. Take 1 more.** In free mode, no minimum is required.

### Join a whole slot

Use **Join** when you want to participate in the slot without selecting a particular named position.

1. Find the slot on **Schedule**.
2. Check its time, description, capacity, and any named roles.
3. Select **Join**.
4. Review any **Assignment warnings** that appear.
5. Select **Continue anyway** only when you have understood and accepted every warning.

Your active profile is added to the slot and the action changes to **Leave**.

When a slot is at capacity, the normal action is replaced by **Full**. When the organizer has enabled over-capacity assignments, it instead becomes **Full — join anyway**. Selecting it always requires you to confirm the capacity warning before the assignment is created.

### Take a named role

A named role is one position within a slot. Each displayed role can be held by one assigned participant.

1. Find the role under the slot.
2. Select **Take** beside that role.
3. Review and confirm any **Assignment warnings**.

Taking a role also joins the slot when you were not already assigned. The role then shows your profile and offers **Leave** to you.

A named role does not increase the slot’s overall capacity. The organizer controls overall capacity through **Max participants** and controls the available positions through **Roles for this slot**.

### Leave a slot or role

There are two different **Leave** actions:

- **Leave** in the slot footer removes your assignment from the whole slot, including any named roles you hold there.
- **Leave** beside a named role releases only that role. When that role was your only reason for being assigned, your slot assignment is also removed. When you had separately joined the slot, you remain assigned without that role.

After the plan’s **Binding deadline**, participants can no longer join, take, or leave slots and roles. An organizer with assignment-management access can still make necessary corrections.

### Understand assignment warnings

Surveyor can warn before joining a slot or taking a role. The **Assignment warnings** dialog can identify issues such as:

- The slot falling outside your event attendance dates or permitted arrival/departure period.
- An overlap with another slot already assigned to you.
- Joining beyond the slot’s capacity.

Select **Cancel** to keep the current assignments unchanged. Select **Continue anyway** only when the exception is intentional. A warning is not the same as an error: settings such as a binding deadline, event-registration requirement, or disabled over-capacity assignment can block the action completely.

### Use shared text fields

**Shared text fields** appear above the tabs. Organizers can use them for notes that apply to the whole plan, such as meeting points, equipment information, or last-minute instructions.

When a pencil button is available:

1. Select the pencil, or double-click the field text.
2. Edit **Text**.
3. Select **Save**.

A user with rule-management access can also select **Add text field**, enter its **Title** and **Text**, and later rename or delete it. Because field text is collaborative, do not place secrets or information there that the plan’s viewers should not be able to edit.

## Organize an activity plan

### Create an activity plan

Creation requires a signed-in full account. The active profile becomes the owner; a guest can participate in a shared plan but cannot create one.

1. Open **New** in the top navigation.
2. Under **Plan & decide**, select **Activity plan**.
3. Complete the plan fields:
   - **Title \*** — the plan name.
   - **Start date \*** and **End date \*** — the complete calendar range. When only the start date is entered, Surveyor initially uses it as the end date. The end date cannot be before the start date.
   - **Description (optional)** — up to 2,000 characters.
   - **Header image (optional)** — JPEG, PNG, or GIF, up to 10 MiB.
   - **Assign to event (optional)** — connects registration, attendance, participant, and advanced assignment features to an event.
4. Review **Group Permissions**. These control who can view, join, edit, administer, or export the plan. See [Permissions and Sharing](PERMISSIONS.md).
5. After selecting the date range, add at least one initial slot in the calendar:
   - Select **+ Slot** under the correct day.
   - Enter its **Title**.
   - Optionally enter **Description**, **Start time**, and **End time**.
   - Set **Max participants** to a whole number of at least 1.
6. Select **Create plan**.

Each slot must be inside the plan’s date range. When both times are set, the end time must be later than the start time.

Initial slots do not yet have named roles. Add those after creation with the slot editor.

### Understand the tabs

The tabs are shown only when they apply to the plan and your access:

| Tab | Purpose | When it appears |
|---|---|---|
| **Schedule** | View slots, join or leave, and perform slot-management tasks. | Always. |
| **Participants** | Review assignment, requirement, attendance, and role information. | When participant data exists and you have **Access Participants**. |
| **Rules & auto-assign** | Configure event-linked assignment rules and, with the relevant access, work with assignment suggestions. | On an event-linked plan for organizers with rule- or assignment-management access. |
| **Settings** | Manage group permissions and delegated administrators. | With **Manage Permissions**. |

The plan description appears above **Shared text fields**. When **Double click to edit** is shown, double-click the description to change it.

### Add and edit slots

#### Add a slot after creation

1. Open **Schedule**.
2. Select **+ Slot** under the required date.
3. In **Create slot**, complete:
   - **Title**.
   - **Start time** and **End time**, when the slot has a fixed time.
   - **Max participants**, at least 1.
   - **Description**, when participants need more detail.
   - **Roles for this slot**, when named positions are needed.
4. Select **Save**.

#### Edit a slot

Select the pencil on the slot to open **Edit slot**. Change the same fields and select **Save**. Depending on your item permissions, you may also be able to double-click a title or description for a quick edit.

When **Drag slots to reorder** is shown, drag slots within their day to change their order. Use the trash button to delete a slot. Deleting a slot also removes its assignments, so verify the affected participants first.

### Add named roles to a slot

In **Create slot** or **Edit slot**:

1. Select the **Roles for this slot** search field.
2. Type to find an existing role in the plan.
3. Select the role suggestion. When permitted, you can select **Create new role “…”** to add a new role name.
4. Repeat for each distinct position needed in that slot.
5. Remove an unwanted role chip before saving.
6. Select **Save**.

The role editor contains role names only. There is no skills, qualifications, or per-role quantity field. Every selected role represents one named position in that slot; use **Max participants** for the slot’s overall capacity.

Use clear role names that tell participants what they are accepting. Put qualifications, preparation, or equipment expectations in the slot **Description** or a shared text field.

### Manage role assignments

**Manage role assignments** lets an organizer correct who holds each named position without changing the complete slot assignment.

1. Make sure the participant is already assigned to the slot. Use the participant’s normal join action or an organizer assignment control first when necessary.
2. Select **Manage role assignments** on the slot.
3. For each **Role**, select a **Participant**, or choose **-- None --** to leave it open.
4. Select **Save changes**.

Only participants currently assigned to that slot appear in the selection lists. To remove someone from the slot entirely, use the remove control beside their name instead of only clearing their named role.

### Review participants

Open **Participants** to see one row per relevant profile. Event-linked plans can include registered event participants who have no assignment yet; independent plans can include profiles that have joined a slot.

Use **Search participant…** or the filters:

- **All**
- **Assigned**
- **Unassigned**
- **Not started**
- **Needs slots**
- **Complete**
- **No minimum**

The columns show **Participant**, **Assignments**, **Requirement**, **Attendance**, and **Roles**. In free mode, the requirement column says **No minimum**. In required mode, it shows progress toward the participant’s current minimum.

Attendance and requirement information is meaningful mainly for a plan assigned to an event. Treat this view as participant information and grant **Access Participants** only to people who should see it.

### Configure basic assignment rules

For an event-linked plan, authorized organizers can open **Rules & auto-assign**. D07 covers the controls that directly affect everyday participation:

- **Assignment mode** — **Free** means no minimum slot count; **Required** enables participant requirements.
- **Binding deadline** — after this time, participants cannot join or leave on their own.
- **Allow assignments beyond slot capacity** — exposes **Full — join anyway** and the capacity warning for general slot participation.
- **Allow non-participants to take slots** — allows profiles with plan access to join without an event registration.
- **Allow arrival-day evening assignments** and **Allow departure-day morning assignments** — permit those attendance-boundary exceptions when applicable.

Select **Save settings** or **Save requirement settings** before leaving the tab. For a required-participation plan, continue with [Set participant requirements](#set-participant-requirements), [Check requirement coverage](#check-requirement-coverage), and [Generate assignment suggestions](#generate-assignment-suggestions).

### Open the settings tab

Open **Settings** to edit **Group Permissions** and delegated administrators. This tab is not general plan configuration: it appears only with **Manage Permissions**.

The owner always keeps full access. A delegated organizer needs the specific permissions for the tasks they perform; being listed as an administrator does not automatically grant every capability. See [Permissions and Sharing](PERMISSIONS.md#delegate-an-organizer).

### Export the schedule

With **Data Export** permission:

1. Open **Schedule**.
2. Select **Export schedule**.
3. A print-friendly page opens in a new browser tab.
4. Select **Print** to print it or use the browser’s print dialog to save a PDF.

The export contains the plan title and dates, linked event and time zone when applicable, summary counts, plan description, shared notes, slots, times, descriptions, assigned participants, and named roles. It reflects the current data at the generated time; create a new export after assignments change.

Because participant names and assignments can be personal information, share exported copies only with their intended recipients and delete obsolete copies according to your organization’s policy.

## Advanced: requirements and assignment recommendations

The advanced workflow is available only for an activity plan assigned to an event. It is split into three visible steps under **Rules & auto-assign**:

1. **Configure rules & defaults**.
2. **Check coverage**.
3. **Generate & apply suggestions**.

A delegated organizer needs **Manage Requirements** for the first two steps and **Manage Assignments** for the third. Grant **Access Participants** as well when that person must see participant names and detailed participant status. These permissions are cumulative; see [Permissions and Sharing](PERMISSIONS.md).

Before using automatic suggestions, finish the event registrations and attendance dates, add the plan's slots and capacities, set reliable slot times, and add any named roles. Automatic generation works from the saved plan and requirement configuration, not from unsaved draft values.

### Set participant requirements

Open **Rules & auto-assign**, then use **Step 1 — Configure rules & defaults**. The **Requirement settings** card contains the saved assignment mode, deadline, attendance-boundary switches, and requirement tables.

1. In **Assignment mode**, select **Required**. **Free** keeps participation optional, displays **No minimum**, and disables **Auto-generate**.
2. Set the **Binding deadline** when participants should stop changing their own assignments.
3. Review the switches for over-capacity assignments, nonparticipants, and arrival/departure boundary exceptions.
4. Build the **Stay duration requirements** table:
   - Enter a non-negative whole number in **Baseline shift requirement**.
   - Choose **Ceil**, **Round**, or **Floor** under **Rounding mode**. When **None** is selected, **Calculate** uses upward rounding.
   - Select **Calculate** to fill a proportional draft for every possible number of attendance days.
   - Adjust any row that should use a different exact number of required shifts.
5. Under **Role requirements**, enter an exact participant-wide shift target for any named role that should change the normal stay-based target.
6. Under **Participant overrides**, select **Add override** when one registered event participant needs a different target. Select the participant, optionally restrict the override to a role they currently hold, and enter the exact required shifts.
7. Select **Save requirement settings**. The **Calculate** action and the live preview do not save the draft.

Required mode needs one saved non-negative integer for every stay duration from one day through the complete plan length. A participant whose event attendance does not overlap the plan receives a target of zero.

#### Understand which requirement wins

Surveyor resolves one total shift target for each participant. The first applicable source in this order wins:

| Priority | Source |
|---:|---|
| 1 | A role-scoped participant override whose role the participant currently holds. When several match, the lowest required-shift value wins. |
| 2 | A participant-wide override without a role. |
| 3 | The lowest matching **Role requirements** value for a role the participant currently holds. |
| 4 | The exact saved **Stay duration requirements** value for the participant's attendance length. |

Zero is a valid target and does not fall through to the next source. Role requirements and overrides set the participant's complete target; they are not added to the stay-duration target and are not multiplied by the number of matching roles.

**Reload** restores the last saved configuration. Surveyor asks before discarding an unsaved requirement draft when you reload or leave the page.

### Check requirement coverage

**Step 2 — Check coverage** updates while you edit Step 1, before you save. The status card labels the preview as **Saved** or **Unsaved changes** and compares **Required shifts** with total **Slot capacity**.

The main states mean:

| Status | Meaning |
|---|---|
| **Free assignment mode** | Required-participation coverage is inactive. |
| **Exact coverage** | The sum of participant targets equals total slot capacity. |
| **Above slot capacity by _N_** | Requirements exceed ordinary capacity, but overfill is enabled. This is permitted, although exact coverage remains preferable. |
| **Short of slot capacity by _N_** | Requirements leave capacity uncovered while overfill is enabled. Increase requirements when every place should be covered. |
| **Hard slot capacity exceeded by _N_** | Requirements exceed capacity while overfill is disabled. Reduce requirements or add capacity. |
| **Below hard slot capacity by _N_** | Some capacity remains outside participant targets. This is allowed but means not every place is required. |
| **Invalid or incomplete requirements** | A required stay-duration row or another value is missing or invalid. Correct it before generating suggestions. |
| **Role quotas exceed slot capacity** | The configured named-role positions cannot fit within one or more slot capacities. Increase those capacities or reduce the affected roles. |

When open named roles exist, the card can also show **Open roles modeled** or **Open roles unfillable**. This is a coverage estimate only. Surveyor may hypothetically match an otherwise unassigned participant to one open role to assess totals, but it does not assign that role or change the schedule.

Coverage is an aggregate planning check, not proof that a timetable is feasible. Exact totals can still be impossible because of attendance dates, overlapping slots, named roles, rejected suggestions, or the search limits described below.

### Generate assignment suggestions

After saving a complete Required-mode configuration, use the **Assignment recommendations** area:

1. Open **Step 3 — Generate & apply suggestions**.
2. Select **Auto-generate**.
3. Leave the page open while **Generating recommendations...** and **Calculating recommendations...** are shown.
4. If the plan changes during calculation, generate again from the new state.
5. Review every proposed row in the schedule before saving anything.

Automatic suggestions use participant requirements, event attendance, arrival/departure switches, existing assignments, time overlaps, capacity, and previously rejected participant/slot pairs. Surveyor aims to distribute progress fairly and spread assignments across the available dates.

Automatic generation creates only ordinary slot assignments. It does not fill named roles. It can propose a **REASSIGNMENT** for an existing assignment without a named role when moving it helps satisfy the plan and the vacated place can also be repaired. An assignment carrying a named role is never moved automatically.

When **Allow assignments beyond slot capacity** is enabled, Surveyor considers overfill only after ordinary capacity and its bounded repair search cannot place the remaining requirements. Overfill never ignores attendance boundaries, overlap checks, named-role protection, or a rejected participant/slot pair.

The allocator is deliberately bounded rather than exhaustive. A workable arrangement can exist even when no suggestion is found. Treat the result as an organizer aid, not as proof that the plan has or lacks a feasible schedule.

### Review generated suggestions

The recommendation schedule displays confirmed assignments and staged changes. The summary counts **Pending**, **Approved**, and **Rejected** rows.

- **Pending** — a generated suggestion awaiting a decision. Select **Approve** or **Reject**.
- **Approved** — staged for application. Select **Revert to Pending** to undo that review choice before saving.
- **Rejected** — declined. Select **Approve** or **Revert to Pending** to reconsider it.
- **Confirmed** — an assignment already present in the schedule; it is not a pending suggestion.

Rejecting an automatically generated participant/slot pair tells later generation not to suggest that same pair again. Returning it to Pending or approving it removes that rejection choice when the review is saved.

### Stage a manual assignment change

Use the recommendation schedule when a correction should be reviewed together with generated work:

- Select **Add recommendation** under a target slot.
- Use **Select participant** to choose the affected person.
- Choose **New assignment** to add a participant.
- Choose **Reassign from another slot** and **Move from** to move a participant.
- Choose **Swap two assignments** and **Swap with participant in this slot** to exchange two roleless assignments.
- Select **Stage as approved** to add the operation to the review.
- Select **Stage unassignment** beside a confirmed assignment to propose removing it.

A reassignment or swap can use only a source assignment without a named role. A manually staged row starts Approved. Remove or revert it before saving when it should not be applied.

### Save and apply the review

Select **Save changes** only after reviewing the complete staged batch.

Surveyor saves the review states and applies every Approved operation that is still valid. Pending and Rejected rows do not change the schedule. Before applying, Surveyor checks the plan and participants again, including source assignments, duplicate targets, attendance, arrival/departure boundaries, overlaps, named roles, and capacity. A blocked operation is skipped rather than forced; both legs of a swap are kept together.

After applying, reload and check the schedule, participant progress, and any reported warnings or skipped operations. Applied rows leave the active review and remain as history. When the binding deadline has passed, Surveyor recalculates replaceable pending work after a successful application. Before the deadline, select **Auto-generate** again when another calculation is needed.

### Advanced limitations

Keep these boundaries in mind:

- Automatic generation does not choose or assign named roles.
- Requirement coverage compares totals and cannot prove a conflict-free timetable.
- Existing assignments with named roles are not moved automatically.
- Rejected memory applies to one participant and target slot; it does not store a reason or expiry date.
- The bounded search can miss a solution that requires more rearrangement.
- Optional overfill is a last resort and never bypasses attendance or overlap rules.
- Surveyor does not notify participants when an organizer applies schedule changes. Communicate the final assignment plan separately.

Maintainers and advanced reviewers can find the single calculation, job, review-state, and persistence reference in `docs/ACTIVITY_REQUIREMENTS_ALGORITHM.md`.

## Troubleshooting

### I see Registration required

The plan is linked to an event, and the active profile is not registered for it. Register with that same profile, switch to the registered profile, or ask the organizer whether external participation should be enabled.

### Join or Take is unavailable

Check whether:

- The slot is full and over-capacity assignment is disabled.
- The plan’s binding deadline has passed.
- Your active profile lacks plan access or the necessary participation permission.
- An event-linked plan requires a registration.
- The named role is already held by another participant.

### A slot does not appear under Open slots

**Open slots** includes only slots below ordinary capacity. A full slot remains excluded even when **Full — join anyway** is available under **All slots**.

### I joined the wrong profile

Open the user menu and check the active profile. A full-account user can switch through **Your profiles**. Assignments remain attached to the profile that made them; leave with that profile or ask an organizer to correct the assignment.

### I cannot edit slots, roles, participants, rules, settings, or exports

Those controls depend on different permissions. Ask the owner to grant only the capabilities needed for your organizer role. See [Permissions and Sharing](PERMISSIONS.md#delegate-an-organizer).

### My changes in Rules & auto-assign were lost

Use **Save settings**, **Save requirement settings**, or **Save changes**, depending on the section. The page warns about unsaved requirement changes, but do not rely on navigation to save them automatically.

### Auto-generate is disabled

The plan must be linked to an event, **Assignment mode** must be **Required**, and your profile needs **Manage Assignments**. Save a complete requirement table before generating.

### Requirement coverage says the configuration is incomplete

Check every row under **Stay duration requirements**. Required mode needs a non-negative whole number for every possible attendance length. Also correct invalid role requirements and participant overrides, then select **Save requirement settings**.

### Recommendation generation became stale or failed

A stale calculation means relevant plan data changed while Surveyor was working. Select **Reload**, confirm the saved requirements and current assignments, and select **Auto-generate** again. A failure or timeout leaves the schedule unchanged.

### A participant still needs shifts after generation

Check that the participant has eligible, non-overlapping slots inside their attendance period. Review capacity, arrival/departure switches, named roles, and any rejected participant/slot pairs. The bounded allocator can also require a manual assignment, reassignment, or swap even when a feasible arrangement exists.

### An approved change was not applied

Surveyor validates the complete batch again when you select **Save changes**. Reload the review and check for a changed source assignment, duplicate target, attendance or overlap conflict, named role, or capacity limit. Correct the schedule or stage a different operation rather than assuming approval bypasses validation.

## Related guides

- [Getting Started](GETTING_STARTED.md) — accounts, guests, and profiles.
- [Events](EVENTS.md) — registration, attendance dates, and event administration.
- [Permissions and Sharing](PERMISSIONS.md) — viewing, participation, management, export, and delegation.
- [Your Overview](DASHBOARD.md) — find plans associated with the active profile.
