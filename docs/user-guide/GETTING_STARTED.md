# Getting Started with Surveyor

This guide will help you set up your account and learn the basics of using Surveyor.

## Table of Contents

- [Creating an Account](#creating-an-account)
- [Logging In](#logging-in)
- [Your First Login](#your-first-login)
- [Account Verification](#account-verification)
- [Password Management](#password-management)
- [Guest Access](#guest-access)
- [Navigation Basics](#navigation-basics)

---

## Creating an Account

### Registration Steps

1. **Visit the Registration Page**
   - Go to the application URL
   - Click "Register" or "Sign Up"

2. **Fill in Your Information**
   - **Username**: Choose a unique username (3-20 characters)
   - **Email**: Provide a valid email address
   - **Password**: Create a strong password (minimum 8 characters)
   - **Name** (optional): Your display name

3. **Submit Registration**
   - Click "Create Account" or "Register"
   - You'll receive a confirmation message

4. **Verify Your Email**
   - Check your email inbox
   - Click the verification link
   - Your account is now active!

### Password Requirements

Your password must:
- Be at least 8 characters long
- Contain at least one uppercase letter
- Contain at least one lowercase letter
- Contain at least one number
- Not be a commonly used password

**Tips for Strong Passwords:**
- Use a passphrase (e.g., "Coffee!Morning2024")
- Avoid personal information
- Don't reuse passwords from other sites
- Consider using a password manager

---

## Logging In

### Standard Login

1. **Navigate to Login Page**
   - Click "Login" or "Sign In"
   - Or visit `/users/login`

2. **Enter Credentials**
   - Username or email
   - Password

3. **Click "Login"**
   - You'll be redirected to your dashboard

### Alternative Login Methods

If your organization has configured additional authentication:

- **OIDC/SSO Login**: Click "Login with [Provider]"
- **Social Login**: May be available through OIDC

### Stay Logged In

- Check "Remember Me" to stay logged in (optional)
- Your session will remain active for security reasons
- Always log out on shared computers

---

## Your First Login

When you log in for the first time:

1. **Welcome Message**
   - You'll see a personalized greeting
   - Your dashboard will be empty initially

2. **Explore the Interface**
   - **Top Navigation**: Create new items
   - **Dashboard**: View your entities
   - **Profile Menu**: Access settings

3. **Create Your First Item**
   - Click "+ Create" in any section
   - Follow the creation wizard
   - See feature-specific guides for details

---

## Account Verification

### Email Verification

After registering, you must verify your email:

1. **Check Your Email**
   - Look for verification email from Surveyor
   - Check spam folder if not found

2. **Click Verification Link**
   - Opens verification page
   - Shows confirmation message
   - Account is now fully activated

3. **If Link Expired**
   - Request new verification email
   - Go to login page
   - Click "Resend verification email"

### Why Verification is Important

- Proves you own the email address
- Enables password reset functionality
- Ensures communication delivery
- Prevents spam registrations

---

## Password Management

### Changing Your Password

1. **Go to Account Settings**
   - Click your profile in top menu
   - Select "Account Settings" or "Profile"

2. **Password Section**
   - Click "Change Password"
   - Enter current password
   - Enter new password (twice)
   - Click "Update Password"

3. **Confirmation**
   - You'll receive email confirmation
   - Remain logged in on current device

### Forgot Password?

1. **Click "Forgot Password"**
   - On login page
   - Or at `/users/forgot-password`

2. **Enter Your Email**
   - Provide registered email address
   - Click "Send Reset Link"

3. **Check Your Email**
   - Click reset link (valid for 1 hour)
   - Enter new password (twice)
   - Click "Reset Password"

4. **Login with New Password**
   - Return to login page
   - Use your new password

### Password Reset Troubleshooting

**Email Not Received?**
- Check spam/junk folder
- Verify email address is correct
- Wait a few minutes for delivery
- Request another reset link

**Reset Link Expired?**
- Links expire after 1 hour
- Request a new reset link
- Complete reset promptly

**Still Having Issues?**
- Contact your administrator
- Provide your username/email
- Never share your password

---

## Guest Access

### What is Guest Access?

Guest access allows participation without registering:

- **Surveys**: Vote via guest links
- **Packing Lists**: Contribute to lists
- **Activity Plans**: View and sign up
- **No account required**: Use guest tokens

### Using Guest Links

1. **Receive Link**
   - From organizer via email/message
   - Unique link for specific feature

2. **Click Link**
   - Opens the feature page
   - No login required
   - Access is temporary

3. **Participate**
   - Vote, contribute, or view
   - Changes saved automatically
   - Return anytime with same link

### Guest vs. Registered Users

| Feature | Guest | Registered |
|---------|-------|------------|
| Create entities | ❌ | ✅ |
| Participate | ✅ | ✅ |
| Dashboard | ❌ | ✅ |
| History | ❌ | ✅ |
| Permissions | Limited | Full |

### Converting Guest to Registered

If you've been using guest access and want full features:

1. Register for an account
2. Contact the organizer
3. They can transfer guest data to your account
4. You'll have full access going forward

---

## Navigation Basics

### Main Dashboard

Your dashboard is your home base:

- **Surveys Section**: Your surveys
- **Packing Lists Section**: Your packing lists
- **Activity Plans Section**: Your activity plans
- **Drivers Lists Section**: Your drivers lists
- **Events Section**: Events you're organizing

### Top Navigation Bar

- **Home Icon**: Return to dashboard
- **Create Menu**: Quick access to create new items
- **Profile Menu**: Account settings, logout
- **Help**: Access this documentation

### Entity Pages

When viewing a specific item:

- **Title Bar**: Entity name and status
- **Action Buttons**: Edit, share, delete
- **Content Area**: Main content
- **Sidebar**: Related info, permissions

### Breadcrumb Navigation

Follow breadcrumbs at top of page:
```
Home > Packing Lists > My Trip List
```
Click any level to navigate back.

---

## Understanding the Interface

### Common Icons

- 📊 **Survey**: Clipboard/chart icon
- 🎉 **Event**: Calendar/celebration icon
- 📦 **Packing**: Box/package icon
- 📅 **Activity**: Calendar/schedule icon
- 🚗 **Drivers**: Car icon
- ⚙️ **Settings**: Gear icon
- 👤 **Profile**: Person icon
- ➕ **Create**: Plus icon
- ✏️ **Edit**: Pencil icon
- 🗑️ **Delete**: Trash icon
- 👥 **Share**: People/share icon

### Color Coding

- **Blue**: Primary actions (Create, Submit)
- **Green**: Success messages
- **Yellow**: Warnings
- **Red**: Errors or delete actions
- **Gray**: Disabled or inactive

### Buttons and Actions

- **Primary Button**: Main action (blue, prominent)
- **Secondary Button**: Alternative action (gray)
- **Danger Button**: Destructive action (red)
- **Icon Buttons**: Quick actions (icons only)

---

## Mobile Usage

Surveyor is mobile-friendly:

### Mobile Navigation

- **Hamburger Menu**: ☰ Access main menu
- **Bottom Actions**: Quick action buttons
- **Swipe Gestures**: Navigate between sections

### Mobile Tips

- Rotate for better view of tables
- Use native browser features (bookmarks)
- Enable notifications for updates
- Install as PWA (if available)

---

## Privacy and Security

### Your Data

- **Private by Default**: Only you can see your entities
- **Controlled Sharing**: You choose who has access
- **Secure Storage**: Data encrypted in transit and at rest
- **Regular Backups**: Data backed up automatically

### Best Practices

✅ **Do:**
- Use strong, unique passwords
- Log out on shared computers
- Review permissions regularly
- Keep email address current

❌ **Don't:**
- Share your password
- Leave account logged in on public computers
- Use same password as other sites
- Ignore security warnings

### Account Security

- **Session Timeout**: Auto-logout after inactivity
- **Failed Login Protection**: Temporary lockout after failed attempts
- **Email Notifications**: Alerts for account changes
- **2FA** (if available): Enable two-factor authentication

---

## Next Steps

Now that you're set up:

1. **Explore Your Dashboard** → [Dashboard Guide](DASHBOARD.md)
2. **Create Your First Item:**
   - [Survey](SURVEYS.md) for group decisions
   - [Event](EVENTS.md) for gatherings
   - [Packing List](PACKING_LISTS.md) for trips
   - [Activity Plan](ACTIVITY_PLANS.md) for schedules
   - [Drivers List](DRIVERS_LISTS.md) for transportation

3. **Learn About Sharing** → Check Permissions section in each guide

---

## Troubleshooting

### Can't Register

**Problem**: Registration form rejects submission

**Solutions**:
- Check all required fields are filled
- Verify password meets requirements
- Use different username (may be taken)
- Try different email address
- Contact administrator

### Can't Login

**Problem**: Login fails with correct credentials

**Solutions**:
- Verify email is verified (check inbox)
- Try password reset
- Check for caps lock
- Clear browser cache/cookies
- Try different browser
- Contact administrator

### Email Not Received

**Problem**: No verification/reset email

**Solutions**:
- Check spam/junk folder
- Wait 5-10 minutes
- Verify email address spelling
- Check email service is working
- Request resend
- Contact administrator

### Page Not Loading

**Problem**: Application slow or not loading

**Solutions**:
- Check internet connection
- Refresh page (Ctrl+R or Cmd+R)
- Clear browser cache
- Try different browser
- Check if service is down
- Contact administrator

---

## Getting Help

### In-App Help

- **Help Icons**: ℹ️ Click for context help
- **Tooltips**: Hover over items for info
- **Guides**: This documentation

### Support Channels

1. **Check Documentation**: Most answers are here
2. **Contact Administrator**: For account issues
3. **Report Bug**: Use feedback form
4. **Community**: Forum or chat (if available)

---

**Next**: [Learn about Your Dashboard](DASHBOARD.md)

---

**Last Updated:** December 10, 2025  
**Version:** 1.0
