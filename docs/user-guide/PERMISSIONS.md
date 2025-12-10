# Understanding Permissions

Surveyor uses a bitwise permission system that controls access to entities (surveys, events, packing lists, activity plans, drivers lists) and their items.

## Permission System Overview

Permissions work at two levels:

1. **Group Permissions** - Apply to audiences (categories of users)
2. **Individual Permissions** - Apply to specific users (administrators)

## How Permissions Work

### Owner Always Has Full Access

The creator (owner) of an entity always has all permissions. This cannot be changed.

### Permission Hierarchy

Permissions are checked in this order:
1. **Owner** - Full access (all permissions)
2. **Individual administrator** - Permissions granted to specific user
3. **Audience (group)** - Permissions for user's category
4. **None** - No access if none of the above grant it

Individual permissions override audience permissions. If you're granted specific permissions as an administrator, those take precedence over your audience permissions.

## Audiences (User Categories)

The system recognizes four audience types:

### 1. Public
Anyone visiting the site, including anonymous users.
- No login required
- No guest link needed
- Broadest audience

### 2. Guest
Users with a personalized guest link (not logged in with an account).
- Requires guest link
- Not a registered user
- Tied to specific entity via link

### 3. Authenticated
Any user with a registered account who is logged in.
- Must have account and be logged in
- Applies to all registered users
- More restrictive than public

### 4. Participant  
Users registered as participants in the linked event.
- **Only applies when entity is linked to an event**
- User must be registered for that specific event
- Most restrictive audience
- Used for event-specific coordination

**Important:** Participant permissions only work if the entity has an `eventId`. Otherwise, this audience is ignored.

## Permission Bits

The system uses these permission bits (can be combined):

### Access Permissions
- **ACCESS_VIEW** - Can view the entity
- **ACCESS_REGISTRATION** - Can register/interact (varies by entity type)
- **ACCESS_CREATE** - Can create new entities of this type
- **ACCESS_ADMIN** - Administrative access
- **ACCESS_PARTICIPANTS** - Can see participant list (events)

### Edit Permissions
- **EDIT_TITLE** - Can change title
- **EDIT_DESC** - Can change description  
- **EDIT_CAPACITY** - Can change capacity/max assignees
- **EDIT_META** - Can change metadata (dates, settings, etc.)

### Item Permissions
- **ITEM_ADD** - Can add new items (slots, packing items, drivers, etc.)
- **ITEM_EDIT** - Can edit existing items
- **ITEM_DELETE** - Can delete items

### Management Permissions
- **MANAGE_ASSIGNMENTS** - Can assign/remove people from slots/items
- **MANAGE_REQUIREMENTS** - Can set participant requirements (activity plans)
- **MANAGE_REGISTRATIONS** - Can manage event registrations
- **MANAGE_PERMISSIONS** - Can change permission settings

### Data Permissions
- **DATA_EXPORT** - Can export data
- **DATA_DUPLICATE** - Can duplicate entity

## Setting Permissions

### When Creating an Entity

When you create an entity, you'll see the permission matrix for different audiences. By default, entities get:
- **Public**: ACCESS_REGISTRATION + ACCESS_VIEW + ACCESS_CREATE

You can customize these for each audience before creating.

### After Creation

If you have MANAGE_PERMISSIONS permission:
1. Go to the entity page
2. Find the "Group Permissions" or "Administrators" section
3. Expand the audience you want to configure
4. Check/uncheck permission boxes
5. Save changes

### Permission Presets

The system offers preset combinations:

- **FULL_EDIT**: All edit permissions (EDIT_TITLE, EDIT_DESC, EDIT_CAPACITY, EDIT_META)
- **FULL_ITEM**: All item permissions (ITEM_ADD, ITEM_EDIT, ITEM_DELETE)
- **FULL_MANAGE**: All management permissions  
- **FULL_DATA**: All data permissions
- **FULL_ACCESS**: All access permissions
- **ADMIN**: All permissions combined
- **DEFAULT_ENTITY**: The default (ACCESS_REGISTRATION + ACCESS_VIEW + ACCESS_CREATE)

## Individual Administrators

### Adding an Administrator

1. In the entity's "Administrators" section, click "Add"
2. Search for user by name or email
3. Select the user from results
4. Optionally choose an initial preset
5. Click "Add"

### Configuring Administrator Permissions

1. Click on the administrator's name to expand
2. Check/uncheck individual permissions
3. Use presets for quick configuration (All/None buttons)
4. Click "Save" to apply

### Removing an Administrator

1. Expand the administrator's section
2. Click "Remove"
3. Confirm removal

## Permission Item Inheritance

For entities with items (slots, packing items, drivers), permissions work with inheritance:

- Items can have their own permissions
- If an item doesn't grant a permission, the parent entity's permission is checked
- This is handled by `itemAllow(id, key, parentKey)` which checks item first, then parent

Example: To edit a packing item, you need ITEM_EDIT on the item itself OR ITEM_EDIT on the parent packing list.

## Practical Examples

### Example 1: Public Survey
Anyone can vote.

**Setup:**
- Public: ACCESS_VIEW + MANAGE_ASSIGNMENTS
- Guest: (none - covered by public)
- Authenticated: (none - covered by public)
- Participant: (none - no event link)

### Example 2: Event-Only Packing List
Only event participants can access.

**Setup:**
- Public: (none)
- Guest: (none)
- Authenticated: (none)
- Participant: ACCESS_VIEW + MANAGE_ASSIGNMENTS
- **Entity must be linked to event**

### Example 3: Collaborative Activity Plan
Registered users can view and sign up, specific users can edit.

**Setup:**
- Authenticated: ACCESS_VIEW + MANAGE_ASSIGNMENTS
- Administrators: Add organizers with ITEM_ADD + ITEM_EDIT permissions

### Example 4: Private with Specific Access
Only invited people can access.

**Setup:**
- All audiences: (none)
- Administrators: Add each person individually with desired permissions

## Understanding Permission Checks in Views

When viewing an entity, the permission bundle includes:

- `entity.has(key)` - Check if you have permission on entity
- `entity.allow(key, parentKey)` - Check entity permission
- `itemHas(id, key)` - Check if you have permission on specific item
- `itemAllow(id, key, parentKey)` - Check item permission, fall back to entity

Views use these to show/hide features:
- Edit buttons appear only if you have the required permission
- Action buttons (Take/Leave) depend on MANAGE_ASSIGNMENTS
- Add buttons depend on ITEM_ADD
- Delete buttons depend on ITEM_DELETE

## Special Cases

### Events and Participant Audience

For events, the default permissions are slightly different:
- **Public**: ACCESS_REGISTRATION + ACCESS_VIEW + ACCESS_CREATE
- **Participant**: ACCESS_PARTICIPANTS (can see participant list)

Linked entities (packing lists, activity plans, drivers lists) can use the participant audience to restrict access to event participants only.

### Guest Links

Guest users get a personalized link that ties them to the entity. Their permissions come from the "guest" audience setting.

If an entity is public (has public permissions), guest links may not be necessary - anyone can access it.

## Troubleshooting

### "I can't see an entity"
- Check if you have ACCESS_VIEW permission
- Verify you're in the right audience (logged in? event participant?)
- Ensure entity isn't private (all audiences set to none)

### "I can't edit something"
- Check if you have the specific edit permission (EDIT_TITLE, EDIT_DESC, etc.)
- Are you the owner or an administrator?
- Does the entity allow editing for your audience?

### "I can't add items"
- Do you have ITEM_ADD permission?
- For your audience or as administrator?

### "Participant permissions don't work"
- Is the entity linked to an event?
- Are you registered for that event?
- Does the participant audience have the permission you need?

---

**Related Guides:**
- [Getting Started](GETTING_STARTED.md)
- [Surveys](SURVEYS.md)
- [Events](EVENTS.md)
- [Activity Plans](ACTIVITY_PLANS.md)
- [Packing Lists](PACKING_LISTS.md)
- [Drivers Lists](DRIVERS_LISTS.md)

---

**Last Updated:** December 10, 2025  
**Version:** 2.0
