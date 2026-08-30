# Activity Plans Guide

Schedule activities with time slots, role assignments, and participant management.

## What are Activity Plans?

Activity plans help you:
- Create time-based schedules
- Define roles (e.g., Facilitator, Helper, Participant)
- Assign people to activity slots
- Track participant requirements
- Get automatic assignment recommendations
- Support guest participation

## Creating an Activity Plan

### Basic Steps

1. **Dashboard** → Activity Plans → "+ Create"
2. **Fill in:**
   - **Title** (required) - e.g., "Conference Schedule"
   - **Description** (optional) - Event details
   - **Start Date** (required)
   - **End Date** (required)
   - **Assign to Event** (optional) - Link to an event
3. **Set Permissions**
4. **Create Plan**

---

## Understanding the Interface

The activity plan page has tabs:

### Schedule Tab
- View all activity slots (time blocks)
- See assignments for each slot
- Take or leave activity slots
- See your current slot count and whether you have met your personal requirement
- Shows role requirements

### Participants Tab (if event linked)
- List of all participants
- Assignment statistics per person
- Used for recommendations

### Requirements Tab (if event linked & permitted)
- Set participant requirements
- Calculate proportional defaults for each possible stay duration, then adjust the exact shift count for any number of days
- Manage role requirements
- Compare role-capped slot capacity with the attendance-aware shifts participants require
- Configure auto-assignment rules

Required mode must save one value for every possible stay duration. These values are authoritative and are never
rounded again at runtime. A matching participant-and-role override takes precedence, followed by a participant-wide
override, the minimum configured requirement of the participant's assigned roles, and finally the saved stay-duration
value. Rounding is used only when the baseline calculator initially populates the duration table. For long plans, the
duration fields stay in a compact scrollable grid.
Participant attendance also shows the total number of days within the plan. Participant overrides use a compact,
scrollable editor so the add action and surrounding settings remain accessible when many overrides exist.
While editing rules, a compact coverage status remains visible inside the settings card and updates immediately using
the same calculation as the server, including unsaved open-role, override, and stay-duration changes. The baseline
calculator uses the current draft and explains when zero is correct because fixed requirements consume the capacity or
no stay-based participant remains.
Exact coverage uses the sum of every slot's participant capacity, not merely the number of slots. Open named roles are
modeled as a hypothetical maximum-cardinality assignment in which each participant can cover at most one named role;
the coverage display warns when roles cannot be filled or their quotas exceed slot capacity. When overfill is enabled,
the slot count is treated as a minimum; otherwise it
is treated as a hard cap, and the status identifies whether a deviation is on the permitted side of that boundary.
The coverage status also shows whether the live values are saved. Editing a field or calculating a new baseline marks
the section as having unsaved changes, and both the header and the end of the section provide a save action. The browser
warns before leaving the page with unsaved requirement changes.
The Participants and coverage sections share the same responsive participant status view. It combines assignment
counts, requirement progress and source, attendance, and roles; on small screens it becomes a card list, while long
lists remain searchable, filterable, and contained in a scrollable area. In Free mode it continues to show assignment,
attendance, and role coverage and labels the absent shift minimum explicitly.
Requirement-state filters distinguish participants who have not started from those who have made partial progress,
completed their requirement, or have no minimum. Assignment-only profiles are displayed by their profile name even
when they are not registered for the linked event.

Linked activity plans accept self-sign-ups from registered event participants by default. Organizers can explicitly
enable **Allow non-participants to take slots** when external providers or administrators should be able to volunteer;
those profiles must still have permission to view the plan. With overfill disabled, slot and role capacities are
enforced as hard limits by the server. With overfill enabled, a full slot remains available through a clearly marked
**Full — join anyway** action, and the participant must confirm a capacity warning before the assignment is created.
The **Open slots** filter continues to show only slots that still have capacity.

### Settings Tab (owners only)
- Permission management
- Plan configuration

---

## Working with Activity Slots

### Slot Structure

Each slot has:
- **Time** - Start and end time
- **Title** - Activity name
- **Roles** - Positions needed (with counts)
- **Assignments** - Who's assigned to each role
- **Actions** - Take/Leave buttons

### Taking a Slot

To sign up for an activity:

1. Find the slot in the schedule
2. See available roles (e.g., "Facilitator (0/1)" means 0 of 1 needed)
3. **Click "Take"** on the role you want
4. Your name appears in that role
5. Counter updates

### Leaving a Slot

To remove yourself:
1. Find your assignment
2. **Click "Leave"** or remove button
3. Your name is removed
4. Slot becomes available again

### Slot Status

- **Open roles** - Show "Take" button
- **Full roles** - Show "Full" badge
- **Full slots with overfill enabled** - Show a warning-styled "Full — join anyway" button and require confirmation
- **Your assignments** - Show "Leave" button

---

## Roles

### What are Roles?

Roles define positions within activities:
- **Facilitator** - Lead the activity
- **Helper** - Assist with activity
- **Participant** - Attend the activity
- Custom roles as needed

### Role Requirements

Each role can have:
- **Count required** - How many people needed (e.g., 1 facilitator, 2 helpers)
- **Skills or qualifications** - If requirements are configured

---

## Guest Participation

### Registering as Guest

1. **Receive Link** from organizer
2. **Register as Guest** (name + optional email)
3. **Save Personalized Link**
4. **View Schedule** and available slots
5. **Take Slots** just like registered users

### Guest Capabilities

What guests can do depends on the permissions set for the "guest" audience:

**Typically guests can:**
- ✅ View activity schedule (if VIEW permission granted)
- ✅ Sign up for open roles when registered for the linked event, or when external sign-ups are explicitly enabled
- ✅ Leave their own assignments
- ✅ See all participants and assignments

**Typically guests cannot:**
- ❌ Create or edit slots (unless ITEM_ADD/ITEM_EDIT granted)
- ❌ Manage others' assignments (unless MANAGE_ASSIGNMENTS granted)
- ❌ Change permissions (requires MANAGE_PERMISSIONS)

---

## Management Features (Users with Permissions)

### Creating Slots

If you have ITEM_ADD permission:
1. Use the slot creation interface
2. Set time range, date, and activity title
3. Define roles needed with counts
4. Save the slot

### Editing Slots

If you have ITEM_EDIT permission:
- **Use the pencil (✏️) icon** on each slot to open the edit modal (preferred method)
- **Or double-click** editable fields for inline editing
- Modify time, title, description, or role requirements
- Changes save automatically (inline) or on modal save

### Managing Assignments

Users with MANAGE_ASSIGNMENTS permission can:
- Assign people to specific roles
- Remove assignments from slots
- View assignment statistics
- Use auto-assignment recommendations (if available and permitted)

---

## Auto-Assignment Recommendations

If configured and you have permissions:

### How It Works

The system suggests default-role slot assignments based on:
- Participant availability
- Exact participant requirements after current manual roles and overrides are applied
- Fair distribution
- Even calendar-time spacing across each participant's attendance window
- Existing assignments

Named roles are not recommended automatically because skills and organizer judgment are case-specific. Assign those
roles manually, then generate recommendations again. The allocator fills ordinary capacity first, attempts bounded
rearrangements of pending suggestions, and may explicitly recommend moving an existing assignment that has no named
role when doing so unlocks an otherwise unfillable slot. Arrival mornings and departure afternoons/evenings are never
recommended. Arrival-day later slots and departure-day morning slots also require their matching plan setting. The
allocator uses allowed overfill only for remaining participant deficits. Free mode
has no requirements and therefore disables automatic recommendations entirely.

### Using Recommendations

1. Open **Rules & auto-assign** and review the recommendation schedule.
2. Approve or reject suggestions. Reassignments have a prominent label and identify their source slot.
3. Use **Add recommendation** to stage a new assignment, a roleless reassignment, or a two-person swap. Use the remove action beside a confirmed participant to stage an unassignment. Every manually staged operation has a remove button; removing either side of a swap removes the complete swap.
4. Select **Save changes** to apply every approved operation. Swaps and reassignments release their source assignments and create their targets together.

Applying a manually added recommendation before the binding deadline does not generate replacement suggestions. Once
the deadline has passed, applying changes recalculates the remaining replaceable work automatically.
Completed recommendations disappear from the review schedule after they have been applied.
Rejected recommendations also disappear after saving, but automatic rejections remain allocation restrictions. If a
concurrent generation run emits the same participant/slot suggestion, it reappears already marked **Rejected**. A
manually staged operation saved as rejected is discarded instead and does not become rejection memory.

---

## Tips and Best Practices

✅ **Planning:**
- Define roles clearly before creating slots
- Set realistic time blocks
- Allow buffer time between activities
- Consider participant limits

✅ **Assignments:**
- Balance workload across participants
- Ensure critical roles are filled
- Have backup for key positions
- Confirm assignments before event

✅ **Communication:**
- Add clear activity descriptions
- Note special requirements in slot details
- Confirm with assigned participants
- Send reminders before activities

---

## Common Use Cases

### Conference Schedule
"TechConf 2025"
- Sessions with facilitators
- Workshops with helpers
- Social activities with participants
- Track who's leading what

### Camp Activities
"Summer Camp Week 1"
- Daily activities (crafts, sports, etc.)
- Counselor roles
- Helper assignments
- Ensure coverage for all time blocks

### Training Program
"New Employee Onboarding"
- Training sessions
- Mentor assignments
- Group activities
- Track participation

---

## Notes

Activity plans are complex and powerful. Key features:

- **Time-based scheduling** - Organize by dates and times
- **Role flexibility** - Define custom roles as needed
- **Requirement system** - Set participant requirements (advanced)
- **Auto-recommendations** - Smart assignment suggestions (advanced)
- **Guest support** - Anyone can participate
- **Event integration** - Link to events for participant lists

---

**Next:** [Events Guide](EVENTS.md)

---

**Last Updated:** December 10, 2025
