# Understanding Permissions

Surveyor uses a fine-grained permission system that gives you precise control over who can access and modify your entities.

## Permission System Overview

The permission system has two levels:

1. **Group Permissions** (Audience-based) - Apply to groups of users
2. **Individual Permissions** (Administrator-based) - Apply to specific users

## Group Permissions (Audiences)

Group permissions define what different categories of users can do with your entity.

### Four Audience Types

#### 1. Participant
Users who are registered participants in the linked event.

**When it applies:**
- Only for entities linked to an event
- User must be registered for that event
- Provides access to event-related coordination

#### 2. Guest
Users accessing via a guest link (not logged in).

**When it applies:**
- Anyone with a guest link can access
- No account required
- Access tied to personalized link

#### 3. Authenticated
Any user with a registered account.

**When it applies:**
- User must be logged in
- Applies to all registered users
- More permissive than participant-only

#### 4. Public
Anyone, including anonymous visitors.

**When it applies:**
- No login required
- No guest link needed
- Completely open access

### Permission Levels

Each audience can have these permissions:

- **VIEW** - Can see the entity
- **EDIT** - Can modify entity details (title, description)
- **EDIT_TITLE** - Can change the entity title
- **EDIT_DESC** - Can edit the description
- **ITEM_ADD** - Can add new items (slots, packing items, drivers)
- **ITEM_EDIT** - Can edit existing items
- **ITEM_DELETE** - Can delete items
- **MANAGE_ASSIGNMENTS** - Can assign/remove people
- **MANAGE_PERMISSIONS** - Can change permission settings
- **MANAGE_REQUIREMENTS** - Can set participant requirements (activity plans)

### Setting Group Permissions

When creating or editing an entity:

1. **Expand Permission Section** - Click on audience name (Participant, Guest, etc.)
2. **Select Permissions** - Check boxes for desired permissions
3. **Use Presets** (if available):
   - **View Only** - Can see but not modify
   - **Participant** - Can view and contribute
   - **Editor** - Can view and edit
   - **Manager** - Full control except ownership
4. **Quick Actions**:
   - **All** - Select all permissions
   - **None** - Clear all permissions

### Permission Presets

Common permission combinations:

**View Only:**
- ✓ VIEW

**Participant:**
- ✓ VIEW
- ✓ MANAGE_ASSIGNMENTS (can take/leave assignments)

**Editor:**
- ✓ VIEW
- ✓ EDIT
- ✓ EDIT_TITLE
- ✓ EDIT_DESC
- ✓ ITEM_EDIT

**Manager:**
- ✓ All permissions except MANAGE_PERMISSIONS

## Individual Permissions (Administrators)

Grant specific permissions to individual users, overriding group permissions.

### Adding an Administrator

1. **Click "Add"** in the Administrators section
2. **Search for User** - Enter name or email
3. **Select from Results** - Click to choose user
4. **Choose Initial Preset** (optional)
5. **Click "Add"**

### Managing Administrator Permissions

For each administrator:

1. **Click Their Name** to expand permissions
2. **Check/Uncheck Permissions** as needed
3. **Use Presets or All/None** buttons
4. **Click "Save"** to apply changes

### Removing an Administrator

1. **Expand Administrator's Section**
2. **Click "Remove"**
3. **Confirm Removal**

## Permission Hierarchy

Permissions are checked in this order:

1. **Owner** - Always has full access
2. **Individual Permissions** - Override group permissions
3. **Group Permissions** - Based on user's audience type
4. **Default** - No access if none of above grant it

## Practical Examples

### Example 1: Public Survey

**Goal:** Anyone can vote

**Setup:**
- **Public**: VIEW + MANAGE_ASSIGNMENTS (to vote)
- **Authenticated**: Same as public
- **Guest**: Not needed (public covers it)

### Example 2: Event Participants Only Packing List

**Goal:** Only event attendees can see and contribute

**Setup:**
- **Participant**: VIEW + MANAGE_ASSIGNMENTS
- **Guest**: None
- **Authenticated**: None
- **Public**: None

**Note:** Entity must be linked to event

### Example 3: Collaborative Activity Plan

**Goal:** Registered users can view and sign up, specific users can edit

**Setup:**
- **Authenticated**: VIEW + MANAGE_ASSIGNMENTS
- **Administrators**: Add event organizers with ITEM_EDIT + ITEM_ADD permissions

### Example 4: Private List with Specific Collaborators

**Goal:** Only invited people can access

**Setup:**
- **All Audiences**: None (default)
- **Administrators**: Add each collaborator individually with desired permissions

## Permission Tips

### Best Practices

✅ **Start Restrictive:**
- Begin with minimal permissions
- Add more as needed
- Easier to open up than lock down

✅ **Use Presets:**
- Quick setup for common patterns
- Consistent permission sets
- Easy to understand

✅ **Test Permissions:**
- View as different user types
- Verify expected access
- Check that restrictions work

✅ **Document Intent:**
- Use entity description to explain access
- Note if guest links will be shared
- Clarify audience expectations

### Common Patterns

**Open Collaboration:**
- Authenticated: VIEW + MANAGE_ASSIGNMENTS + ITEM_ADD
- Good for community projects

**Controlled Editing:**
- Authenticated: VIEW
- Administrators: Editors with ITEM_EDIT
- Good for curated content

**Event Coordination:**
- Participant: Full access
- Others: None or VIEW only
- Good for event-specific planning

**Guest-Friendly:**
- Guest: VIEW + MANAGE_ASSIGNMENTS
- Authenticated: Same or more
- Good for including non-registered users

## Understanding Permission Indicators

When viewing entities, you'll see what you can do:

- **Editable Fields** - Double-click or pencil icon
- **Action Buttons** - Take, Leave, Add, Remove
- **Hidden Sections** - Features you can't access won't appear
- **Read-Only** - Can see but not modify

## Troubleshooting Permissions

### "I can't see an entity"

**Check:**
- Do you have VIEW permission?
- Are you in the right audience (logged in, event participant, etc.)?
- Is the entity linked correctly (for participant audience)?

### "I can't edit something"

**Check:**
- Do you have the specific edit permission?
- Are you the owner or administrator?
- Is the field locked for other reasons (entity status)?

### "Guest link doesn't work"

**Check:**
- Does guest audience have permissions?
- Is the link complete and correct?
- Has the entity been deleted?

### "Can't add items"

**Check:**
- Do you have ITEM_ADD permission?
- For your audience or as administrator?
- Is the entity in a state that allows additions?

## Security Notes

### What Permissions Control

✓ **Access to view entity**
✓ **Ability to edit details**
✓ **Adding/removing items**
✓ **Managing assignments**
✓ **Permission changes**

### What Permissions Don't Control

✗ **Entity ownership** - Always the creator
✗ **Deletion** - Only owner can delete
✗ **Creation** - Anyone can create their own entities

### Permission Limitations

- Cannot grant yourself permissions on others' entities
- Cannot remove the owner's access
- Cannot lock yourself out if you're the owner
- Cannot bypass system-level restrictions

---

## Related Guides

- **[Getting Started](GETTING_STARTED.md)** - Account setup
- **[Surveys](SURVEYS.md)** - Survey-specific permissions
- **[Events](EVENTS.md)** - Event participant access
- **[Activity Plans](ACTIVITY_PLANS.md)** - Activity plan permissions
- **[Packing Lists](PACKING_LISTS.md)** - Packing list permissions
- **[Drivers Lists](DRIVERS_LISTS.md)** - Drivers list permissions

---

**Last Updated:** December 10, 2025  
**Version:** 1.0
