# Packing Lists Guide

Coordinate what to bring for trips or events using shared packing lists.

## What are Packing Lists?

Packing lists help groups coordinate items for trips:
- Create items with descriptions
- Assign items to people
- Set maximum number needed per item
- Track who's bringing what
- Support guest participation

## Creating a Packing List

### Basic Steps

1. **Dashboard** → Packing Lists → "+ Create"
2. **Fill in:**
   - **Title** (required) - e.g., "Camp Trip Packing"
   - **Description** (optional) - Details or instructions
   - **Assign to Event** (optional) - Link to an event
3. **Set Permissions** - Who can view/edit
4. **Create List**

### Adding Items

After creation, add items to the list:

1. **Scroll to "Add new item" section** at bottom
2. **Fill in:**
   - **Title** (required) - What to bring
   - **Description** (optional) - Specifics, preferences
   - **Quantity** - How many needed
3. **Click "Add"**

Items appear in the table immediately.

---

## Using a Packing List

### Viewing the List

The packing list page shows:
- **Description** - List details (double-click to edit if permitted)
- **Statistics** - Total participants, items, assigned/unassigned counts
- **Table** - All items with assignment info

### Item Table Columns

- **Title** - Item name
- **Description** - Additional details
- **Assignees** - Who's bringing it (list of names)
- **Assigned / Max** - e.g., "2 / 3" means 2 people assigned, 3 needed
- **Action** - Take/Remove buttons

### Taking Items

To sign up to bring an item:

1. Find the item in the table
2. **Click "Take"** button
3. Your name appears in Assignees column
4. Counter updates (e.g., "3 / 4")

### Removing Yourself

To remove your assignment:

1. Find your name in the Assignees list
2. **Click "Remove"** (or × button next to your name)
3. Your name is removed
4. Counter updates

### Full Items

When assigned count reaches max:
- **"Full"** badge appears
- **"Take" button** disabled for others
- If you're already assigned, you can still remove yourself

---

## Managing Items (Based on Permissions)

### Editing Item Details

Depending on permissions granted:
- **Double-click Title** to edit item name (requires EDIT_TITLE or ITEM_EDIT permission)
- **Double-click Description** to edit details (requires EDIT_DESC or ITEM_EDIT permission)
- **Double-click Max number** to change quantity needed (requires EDIT_CAPACITY or ITEM_EDIT permission)
- Changes save automatically

**Note:** By default, only the owner has these permissions. Others need to be granted specific permissions.

### Reordering Items

Drag items to reorder:
- **Click and hold** on an item row
- **Drag** to new position
- **Release** to drop
- Order saves automatically

### Removing Participants

Users with MANAGE_ASSIGNMENTS permission can remove any assignee:
- **Click × button** next to participant name
- Person is unassigned immediately

**Note:** Participants can always remove themselves, even without this permission.

### Deleting Items

If you have ITEM_DELETE permission:
- **Click trash icon** on item row
- Confirm deletion
- Item and all assignments removed

### The "Everyone" Option

Items can be marked as required for everyone:
- When creating or editing an item, mark it as "required by all"
- These items show a blue **"Everyone"** badge instead of individual assignees
- The item appears highlighted (blue background) in the table
- Everyone is expected to bring this item

This is useful for items everyone needs individually (e.g., "Personal water bottle", "Sleeping bag")

---

## Guest Participation

### Registering as Guest

1. **Receive Link** from organizer
2. **Register as Guest** (name + optional email)
3. **Save Personalized Link** to access again
4. **Take Items** just like registered users

### Guest Capabilities

Guests can:
- ✅ View packing list
- ✅ Take items (sign up)
- ✅ Remove themselves
- ✅ See who else is bringing what

Guests cannot:
- ❌ Add new items
- ❌ Edit item details
- ❌ Change permissions
- ❌ Delete the list

---

## Permissions

### Default Permissions

Set for all users:
- **View** - See the list
- **Edit** - Modify items
- **Manage Assignments** - Add/remove people

### Individual Permissions

Grant specific permissions to users or make list public/authenticated-only.

---

## Tips and Best Practices

✅ **Organization:**
- Group similar items in description
- Use clear item titles
- Set realistic max quantities
- Update as plans change

✅ **Communication:**
- Add context in list description
- Coordinate duplicates (multiple people bringing)
- Confirm before the event
- Update if items change

✅ **Coordination:**
- Check what's already assigned
- Don't over-assign items
- Bring a bit extra as backup
- Share any last-minute changes

---

## Common Use Cases

### Trip Supplies
"Camping Trip - May 2025"
- Tents, cooking gear, food items
- Each person takes what they can bring
- Coordinate to cover everything

### Event Materials
"Conference Setup Materials"
- Signs, supplies, equipment
- Volunteers sign up for items
- Track what's covered

### Group Meals
"Potluck Dinner Items"
- Dishes, ingredients, supplies
- Avoid duplicates
- Ensure variety

---

**Next:** [Activity Plans Guide](ACTIVITY_PLANS.md)

---

**Last Updated:** December 10, 2025
