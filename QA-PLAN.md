# ClubCheck QA Plan

**Version:** 1.0
**Last Updated:** February 7, 2026
**Operated by:** BlueLoom Ventures LLC

---

## Table of Contents

1. [Overview](#overview)
2. [Test Environment Setup](#test-environment-setup)
3. [Authentication & Onboarding](#1-authentication--onboarding)
4. [Dashboard](#2-dashboard)
5. [Member Management](#3-member-management)
6. [Check-in System](#4-check-in-system)
7. [Kiosk Mode](#5-kiosk-mode)
8. [Billing & Subscriptions](#6-billing--subscriptions)
9. [Staff Management](#7-staff-management)
10. [Prospects & CRM](#8-prospects--crm)
11. [Broadcasts](#9-broadcasts)
12. [Analytics](#10-analytics)
13. [Settings](#11-settings)
14. [Member Portal](#12-member-portal)
15. [Waiver System](#13-waiver-system)
16. [Walkthrough Tour](#14-walkthrough-tour)
17. [Theme System](#15-theme-system)
18. [Audit Logs](#16-audit-logs)
19. [Legal Pages](#17-legal-pages)
20. [Mobile Responsiveness](#18-mobile-responsiveness)
21. [Security Testing](#19-security-testing)
22. [Performance Testing](#20-performance-testing)
23. [Regression Checklist](#regression-checklist)

---

## Overview

This QA plan covers all features of ClubCheck, a gym management SaaS platform. Each section includes:
- **Test Cases** - Specific scenarios to test
- **Expected Results** - What should happen
- **Priority** - P0 (Critical), P1 (High), P2 (Medium), P3 (Low)

---

## Test Environment Setup

### Prerequisites
- [ ] Node.js 18+ installed
- [ ] PostgreSQL database running
- [ ] Environment variables configured:
  - `DATABASE_URL`
  - `JWT_SECRET`
  - `RESEND_API_KEY`
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `NEXT_PUBLIC_APP_URL`

### Test Accounts
| Account Type | Email | Purpose |
|-------------|-------|---------|
| Demo Owner | demo@clubcheckapp.com | Demo mode testing |
| Test Owner | test@example.com | Full feature testing |
| Test Staff (Manager) | manager@example.com | Staff role testing |
| Test Staff (Front Desk) | frontdesk@example.com | Limited access testing |

---

## 1. Authentication & Onboarding

### 1.1 Signup Flow
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| AUTH-001 | Valid signup | Enter valid email, password (6+ chars), phone | Account created, redirected to /verify-email | P0 |
| AUTH-002 | Duplicate email | Signup with existing email | Error: "Email already registered" | P0 |
| AUTH-003 | Invalid email format | Enter "notanemail" | Validation error displayed | P1 |
| AUTH-004 | Weak password | Enter password < 6 chars | Error: "Password must be at least 6 characters" | P1 |
| AUTH-005 | Referral code | Signup with valid referral code | Account created with referral linked | P2 |
| AUTH-006 | Invalid referral code | Signup with invalid referral code | Account created (code ignored silently) | P2 |

### 1.2 Email Verification
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| AUTH-010 | Verification email sent | Complete signup | Email received with verification link | P0 |
| AUTH-011 | Valid verification link | Click link in email | Email verified, redirected to dashboard, trial starts | P0 |
| AUTH-012 | Expired verification link | Click link after 24 hours | Error: "Link expired", option to resend | P1 |
| AUTH-013 | Invalid verification link | Visit /verify-email/invalidtoken | Error: "Invalid link" | P1 |
| AUTH-014 | Resend verification | Click "Resend" on /verify-email | New email sent, old token invalidated | P1 |
| AUTH-015 | Already verified | Click verification link twice | Error: "Already verified" or redirect to dashboard | P2 |

### 1.3 Login Flow
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| AUTH-020 | Valid login | Enter correct email/password | Logged in, redirected to dashboard | P0 |
| AUTH-021 | Invalid credentials | Enter wrong password | Error: "Invalid email or password" | P0 |
| AUTH-022 | Unverified login | Login before email verification | Logged in, redirected to /verify-email | P1 |
| AUTH-023 | Remember session | Login, close browser, reopen | Still logged in (7 day cookie) | P2 |
| AUTH-024 | Logout | Click logout | Cookie cleared, redirected to /login | P0 |

### 1.4 Demo Mode
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| AUTH-030 | Demo login via button | Click "See Live Demo" on landing page | Logged into demo account, redirected to dashboard | P0 |
| AUTH-031 | Demo login via API | POST /api/demo/login | Returns success, sets cookie | P1 |
| AUTH-032 | Demo mode restrictions | Try to modify data in demo mode | Mutations blocked with "Demo mode" message | P0 |
| AUTH-033 | Demo badge visible | Login to demo account | "DEMO" badge shown in navbar | P1 |

### 1.5 Staff Login
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| AUTH-040 | Valid staff login | Enter gym code, email, password | Logged in with staff role | P0 |
| AUTH-041 | Invalid gym code | Enter wrong gym code | Error: "Invalid gym code" | P1 |
| AUTH-042 | Inactive staff | Login as deactivated staff | Error: "Account deactivated" | P1 |

---

## 2. Dashboard

### 2.1 Dashboard Display
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| DASH-001 | Dashboard loads | Login and navigate to /dashboard | Stats cards display correctly | P0 |
| DASH-002 | Active members count | Check "Active Members" card | Shows correct count matching DB | P0 |
| DASH-003 | Check-ins today | Check "Check-ins Today" card | Shows today's check-in count | P0 |
| DASH-004 | Revenue estimate | Check "Est. Revenue" card | Shows calculated revenue | P1 |
| DASH-005 | Failed payments | Check "Failed Payments" card | Shows count of failed payments | P1 |
| DASH-006 | Sparkline charts | View trend charts | Charts render with correct data | P2 |

### 2.2 Billing Status Strip
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| DASH-010 | Trial status shown | Login during trial | Shows "Trial - X days left" | P0 |
| DASH-011 | Active subscription | Login with active subscription | Shows plan name + "Active" | P1 |
| DASH-012 | Past due status | Login with failed payment | Shows "Past Due" warning | P0 |
| DASH-013 | Member limit warning | Approach 90% of member limit | Warning banner displayed | P1 |

### 2.3 Quick Actions
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| DASH-020 | Manage Members link | Click "Manage Members" | Navigates to /members | P1 |
| DASH-021 | Record Check-in link | Click "Record Check-in" | Navigates to /checkin | P1 |
| DASH-022 | Send Broadcast link | Click "Send Broadcast" | Navigates to /broadcast | P1 |

### 2.4 Setup Wizard
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| DASH-030 | Setup wizard shows | New account, first login | Setup wizard displayed | P1 |
| DASH-031 | Progress tracking | Complete setup steps | Checkmarks appear for completed items | P2 |
| DASH-032 | Dismiss setup | Click "Dismiss" | Wizard hidden, preference saved | P2 |

---

## 3. Member Management

### 3.1 Member List
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| MEM-001 | List loads | Navigate to /members | Member list displays | P0 |
| MEM-002 | Search by name | Type in search box | Filters members by name | P0 |
| MEM-003 | Search by email | Search for email | Filters members by email | P1 |
| MEM-004 | Search by phone | Search for phone number | Filters members by phone | P1 |
| MEM-005 | Filter by status | Select "Active" filter | Shows only active members | P1 |
| MEM-006 | Pagination | View list with 100+ members | Pagination works correctly | P2 |

### 3.2 Add Member
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| MEM-010 | Add member form | Click "Add Member" | Modal/form opens | P0 |
| MEM-011 | Valid member creation | Enter name, email, save | Member created with QR code | P0 |
| MEM-012 | Duplicate email | Add member with existing email | Error: "Email already exists" | P1 |
| MEM-013 | Send welcome email | Check "Send welcome email" | Email sent with QR code | P1 |
| MEM-014 | Member limit reached | Add member when at plan limit | Error: "Member limit reached" | P0 |

### 3.3 Edit Member
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| MEM-020 | Edit member | Click member row, edit fields | Changes saved successfully | P0 |
| MEM-021 | Change status | Change from Active to Inactive | Status updated, reflected in list | P0 |
| MEM-022 | Update contact info | Change email/phone | Info updated | P1 |

### 3.4 Delete Member
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| MEM-030 | Delete member | Click delete, confirm | Member removed from list | P0 |
| MEM-031 | Cancel delete | Click delete, cancel | Member not deleted | P1 |
| MEM-032 | Delete with check-ins | Delete member with history | Check-in history preserved or cascaded | P2 |

### 3.5 Bulk Actions
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| MEM-040 | Select multiple | Check multiple member checkboxes | Selection count shown | P1 |
| MEM-041 | Bulk status change | Select members, change status | All selected updated | P1 |
| MEM-042 | Bulk send QR | Select members, send QR codes | Emails sent to all selected | P2 |
| MEM-043 | Bulk delete | Select members, delete | All selected deleted after confirm | P2 |

### 3.6 Member Detail
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| MEM-050 | View detail page | Click member name | Detail page loads | P0 |
| MEM-051 | QR code display | View member detail | QR code visible | P0 |
| MEM-052 | Check-in history | View member detail | Check-in history listed | P1 |
| MEM-053 | Streak display | View member detail | Current/longest streak shown | P2 |
| MEM-054 | Resend QR | Click "Send QR Code" | Email sent to member | P1 |

### 3.7 Export
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| MEM-060 | Export CSV | Click "Export CSV" | CSV file downloaded | P1 |
| MEM-061 | Export with filters | Apply filters, export | Only filtered data exported | P2 |

---

## 4. Check-in System

### 4.1 QR Code Check-in
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| CHK-001 | Scan valid QR | Scan member's QR code | Check-in recorded, success message | P0 |
| CHK-002 | Scan invalid QR | Scan random QR code | Error: "Member not found" | P0 |
| CHK-003 | Scan inactive member | Scan inactive member's QR | Warning: "Member is inactive" | P1 |
| CHK-004 | Duplicate check-in | Scan same QR within 1 hour | Warning or success (configurable) | P2 |

### 4.2 Phone Lookup Check-in
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| CHK-010 | Valid phone lookup | Enter member's phone number | Member found, check-in option | P0 |
| CHK-011 | Invalid phone | Enter non-member phone | Error: "No member found" | P1 |
| CHK-012 | Partial phone match | Enter partial phone | Matching members listed | P2 |

### 4.3 Manual Check-in
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| CHK-020 | Search and check-in | Search member, click check-in | Check-in recorded | P0 |
| CHK-021 | Recent check-ins | View recent check-ins list | Today's check-ins displayed | P1 |

### 4.4 Check-in History
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| CHK-030 | View history | Navigate to check-in history | List of check-ins displayed | P1 |
| CHK-031 | Filter by date | Select date range | Filtered results shown | P2 |
| CHK-032 | Export check-ins | Export check-in data | CSV downloaded | P2 |

### 4.5 Streak Calculation
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| CHK-040 | Streak increment | Check-in on consecutive days | Current streak increases | P1 |
| CHK-041 | Streak break | Miss a day, check in | Streak resets to 1 | P1 |
| CHK-042 | Same day check-in | Check-in twice same day | Streak unchanged | P2 |
| CHK-043 | Longest streak | Achieve new longest streak | Longest streak updated | P2 |

---

## 5. Kiosk Mode

### 5.1 Kiosk Setup
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| KSK-001 | Access kiosk | Navigate to /kiosk | PIN entry screen shown | P0 |
| KSK-002 | Valid PIN | Enter correct kiosk PIN | Kiosk mode unlocked | P0 |
| KSK-003 | Invalid PIN | Enter wrong PIN | Error: "Invalid PIN" | P0 |
| KSK-004 | Set kiosk PIN | Set PIN in settings | PIN saved, works for kiosk | P1 |

### 5.2 Kiosk Check-in
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| KSK-010 | QR scan in kiosk | Scan QR in kiosk mode | Check-in recorded, welcome message | P0 |
| KSK-011 | Phone lookup | Enter phone in kiosk | Member found, checked in | P0 |
| KSK-012 | Self-service flow | Complete self-check-in | Returns to idle after timeout | P1 |

### 5.3 Kiosk Display
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| KSK-020 | Gym branding | View kiosk screen | Gym name/logo displayed | P1 |
| KSK-021 | Idle timeout | Leave kiosk idle | Returns to welcome screen | P2 |
| KSK-022 | Exit kiosk | Press exit button, enter PIN | Returns to normal mode | P1 |

---

## 6. Billing & Subscriptions

### 6.1 Trial Period
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| BIL-001 | Trial starts | Verify email | 14-day trial begins | P0 |
| BIL-002 | Trial countdown | View billing status | Days remaining shown | P0 |
| BIL-003 | Trial expiry | Let trial expire | Account enters expired state | P0 |
| BIL-004 | Grace period | Trial expires | 7-day grace period active | P1 |

### 6.2 Plan Selection
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| BIL-010 | View plans | Navigate to /billing | Starter and Pro plans shown | P0 |
| BIL-011 | Monthly toggle | Select monthly billing | Monthly prices displayed | P1 |
| BIL-012 | Yearly toggle | Select yearly billing | Yearly prices with savings shown | P1 |
| BIL-013 | Plan comparison | View plan features | Feature differences clear | P2 |

### 6.3 Subscription Checkout
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| BIL-020 | Start subscription | Click "Upgrade" on plan | Redirected to Stripe Checkout | P0 |
| BIL-021 | Successful payment | Complete Stripe checkout | Subscription active, redirected back | P0 |
| BIL-022 | Failed payment | Use declined card | Error displayed, subscription not created | P0 |
| BIL-023 | Webhook processing | Complete payment | Webhook updates subscription status | P0 |

### 6.4 Subscription Management
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| BIL-030 | View subscription | Navigate to /billing | Current plan and status shown | P0 |
| BIL-031 | Manage billing | Click "Manage Billing" | Opens Stripe Customer Portal | P1 |
| BIL-032 | Cancel subscription | Cancel via Stripe Portal | Status updates to "canceling" | P1 |
| BIL-033 | Reactivate | Reactivate canceled subscription | Subscription resumes | P2 |

### 6.5 Payment Failures
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| BIL-040 | Payment failed | Simulate failed payment webhook | Alert shown in dashboard, email sent | P0 |
| BIL-041 | Update payment | Update card in Stripe Portal | New card used for retry | P1 |
| BIL-042 | Past due access | Access app with past_due status | Read-only access enforced | P0 |

### 6.6 Invoices
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| BIL-050 | View invoices | Navigate to /invoices | Invoice list displayed | P1 |
| BIL-051 | Download invoice | Click invoice download | PDF downloaded | P2 |

---

## 7. Staff Management

### 7.1 Staff List
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| STF-001 | View staff | Navigate to /staff | Staff list displayed | P0 |
| STF-002 | Add staff | Click "Add Staff" | Staff creation form | P0 |
| STF-003 | Valid staff creation | Enter details, select role | Staff account created | P0 |
| STF-004 | Duplicate email | Add staff with existing email | Error: "Email already exists" | P1 |

### 7.2 Staff Roles
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| STF-010 | Manager role | Create manager staff | Can access management features | P0 |
| STF-011 | Front desk role | Create front desk staff | Limited to check-in features | P0 |
| STF-012 | Role permissions | Login as different roles | Correct menu items visible | P0 |

### 7.3 Staff Management
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| STF-020 | Edit staff | Edit staff details | Changes saved | P1 |
| STF-021 | Deactivate staff | Toggle staff active status | Staff cannot login | P0 |
| STF-022 | Delete staff | Delete staff member | Staff removed | P1 |
| STF-023 | Reset password | Reset staff password | New password email sent | P2 |

---

## 8. Prospects & CRM

### 8.1 Prospect Management
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| PRS-001 | View prospects | Navigate to /prospects | Prospect list displayed | P0 |
| PRS-002 | Add prospect | Click "Add Prospect" | Form opens | P0 |
| PRS-003 | Create prospect | Enter name, email | Prospect created with "New" status | P0 |
| PRS-004 | Edit prospect | Edit prospect details | Changes saved | P1 |

### 8.2 Prospect Status Flow
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| PRS-010 | Mark contacted | Change status to "Contacted" | Status updated, date recorded | P1 |
| PRS-011 | Mark toured | Change status to "Toured" | Status updated, date recorded | P1 |
| PRS-012 | Convert to member | Convert prospect | Member created, prospect marked "Converted" | P0 |
| PRS-013 | Mark lost | Change status to "Lost" | Status updated | P1 |

### 8.3 Prospect Notes
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| PRS-020 | Add notes | Add notes to prospect | Notes saved | P2 |
| PRS-021 | View notes | View prospect details | Notes displayed | P2 |

---

## 9. Broadcasts

### 9.1 Create Broadcast
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| BRD-001 | Access broadcasts | Navigate to /broadcast | Broadcast page loads | P0 |
| BRD-002 | Compose message | Enter subject and body | Text saved | P0 |
| BRD-003 | Select recipients | Choose "All Active Members" | Recipient count shown | P0 |
| BRD-004 | Preview email | Click preview | Email preview displayed | P2 |

### 9.2 Send Broadcast
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| BRD-010 | Send broadcast | Click "Send" | Emails queued, confirmation shown | P0 |
| BRD-011 | Send to filtered | Select specific status | Only matching members receive | P1 |
| BRD-012 | Empty recipient list | Send with no recipients | Error: "No recipients" | P1 |

---

## 10. Analytics

### 10.1 Analytics Dashboard
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| ANL-001 | View analytics | Navigate to /analytics | Analytics page loads | P0 |
| ANL-002 | Check-in trends | View check-in chart | Correct data displayed | P1 |
| ANL-003 | Member growth | View member chart | Growth trend shown | P1 |
| ANL-004 | Date range filter | Change date range | Data updates accordingly | P2 |

---

## 11. Settings

### 11.1 Gym Profile
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| SET-001 | View settings | Navigate to /settings | Settings page loads | P0 |
| SET-002 | Update gym name | Change gym name, save | Name updated, shown in navbar | P0 |
| SET-003 | Upload logo | Upload image file | Logo saved and displayed | P1 |
| SET-004 | Update address | Change address | Address saved | P2 |

### 11.2 Kiosk Settings
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| SET-010 | Set kiosk PIN | Enter new PIN | PIN saved (hashed) | P0 |
| SET-011 | Change PIN | Update existing PIN | New PIN works, old doesn't | P1 |

### 11.3 Theme Settings
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| SET-020 | Switch to light | Select "Light" theme | UI changes to light mode | P1 |
| SET-021 | Switch to dark | Select "Dark" theme | UI changes to dark mode | P1 |
| SET-022 | Auto theme | Select "Auto" | Follows system preference | P2 |
| SET-023 | Theme persistence | Change theme, refresh | Theme persists | P1 |

---

## 12. Member Portal

### 12.1 Portal Access
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| PRT-001 | Access portal | Visit /member/[token] | Portal loads with member data | P0 |
| PRT-002 | Invalid token | Visit with invalid token | Error: "Invalid or expired link" | P0 |
| PRT-003 | Expired token | Visit with expired token | Error with option to request new link | P1 |

### 12.2 Portal Features
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| PRT-010 | View QR code | Access portal | QR code displayed | P0 |
| PRT-011 | View check-in history | Navigate to history | Check-in list shown | P1 |
| PRT-012 | View streak | Access portal | Current streak displayed | P2 |
| PRT-013 | Update profile | Edit contact info | Changes saved | P2 |

---

## 13. Waiver System

### 13.1 Waiver Configuration
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| WAV-001 | Enable waiver | Toggle waiver on in settings | Waiver enabled | P1 |
| WAV-002 | Customize waiver | Edit waiver text | Text saved | P1 |
| WAV-003 | Disable waiver | Toggle waiver off | Waiver disabled | P1 |

### 13.2 Waiver Signing
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| WAV-010 | Waiver email sent | Add member when waiver enabled | Waiver email sent | P1 |
| WAV-011 | Sign waiver | Click link, type name, submit | Waiver signed, timestamp recorded | P0 |
| WAV-012 | Check waiver status | View member detail | Waiver status shown | P1 |
| WAV-013 | Unsigned waiver check-in | Check in without signed waiver | Warning displayed | P2 |

---

## 14. Walkthrough Tour

### 14.1 Tour Trigger
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| WLK-001 | Tour on first login | Sign up, verify, login | Tour starts automatically | P1 |
| WLK-002 | Tour in demo mode | Login to demo | Tour starts automatically | P1 |
| WLK-003 | No tour on return | Login after completing tour | Tour does not start | P2 |

### 14.2 Tour Navigation
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| WLK-010 | Next button | Click "Next" | Advances to next step | P1 |
| WLK-011 | Back button | Click "Back" | Returns to previous step | P2 |
| WLK-012 | Skip tour | Click "Skip Tour" | Tour closes, marked complete | P1 |
| WLK-013 | Complete tour | Finish all steps | Tour closes, "Get Started" shown | P1 |

### 14.3 Tour Display
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| WLK-020 | Tooltip positioning | Progress through tour | Tooltips stay within viewport | P1 |
| WLK-021 | Spotlight effect | View tour | Target element highlighted | P2 |
| WLK-022 | Replay tour (demo) | Click "Replay Feature Tour" | Tour restarts | P2 |

---

## 15. Theme System

### 15.1 Light Mode
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| THM-001 | Light backgrounds | Enable light mode | Light backgrounds applied | P1 |
| THM-002 | Text readability | View all pages in light mode | All text readable | P0 |
| THM-003 | Charts in light mode | View dashboard charts | Charts visible and clear | P1 |

### 15.2 Dark Mode
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| THM-010 | Dark backgrounds | Enable dark mode | Dark backgrounds applied | P1 |
| THM-011 | Text contrast | View all pages in dark mode | Adequate contrast | P0 |

### 15.3 Auto Mode
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| THM-020 | System dark | Set system to dark, select Auto | Dark theme applied | P2 |
| THM-021 | System light | Set system to light, select Auto | Light theme applied | P2 |
| THM-022 | System change | Change system preference | Theme updates live | P2 |

---

## 16. Audit Logs

### 16.1 Audit Log Access
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| AUD-001 | Access logs | Navigate to /audit-logs | Audit log page loads | P1 |
| AUD-002 | Owner only | Login as staff, try to access | Access denied | P0 |

### 16.2 Log Content
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| AUD-010 | Login logged | Login to account | Login action recorded | P1 |
| AUD-011 | Member actions | Create/update/delete member | Actions logged | P1 |
| AUD-012 | Settings changes | Update settings | Changes logged | P2 |

### 16.3 Log Viewing
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| AUD-020 | Filter by action | Select action filter | Filtered results shown | P2 |
| AUD-021 | View details | Click "View" on log | Detail modal opens | P2 |
| AUD-022 | Pagination | View many logs | Pagination works | P2 |

---

## 17. Legal Pages

### 17.1 Privacy Policy
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| LGL-001 | Access privacy | Navigate to /privacy | Privacy policy loads | P0 |
| LGL-002 | Company name | View privacy page | "BlueLoom Ventures LLC" displayed | P1 |
| LGL-003 | Contact email | View contact section | blueloomventuresllc@gmail.com shown | P1 |

### 17.2 Terms of Service
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| LGL-010 | Access terms | Navigate to /terms | Terms of service loads | P0 |
| LGL-011 | Company name | View terms page | "BlueLoom Ventures LLC" displayed | P1 |
| LGL-012 | No medical disclaimer | Find disclaimer section | Disclaimer present and clear | P1 |

### 17.3 Footer Links
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| LGL-020 | Footer privacy link | Click "Privacy Policy" in footer | Navigates to /privacy | P1 |
| LGL-021 | Footer terms link | Click "Terms of Service" in footer | Navigates to /terms | P1 |
| LGL-022 | Footer copyright | View footer | "© 2026 ClubCheck. Operated by BlueLoom Ventures LLC." | P1 |

---

## 18. Mobile Responsiveness

### 18.1 Navigation
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| MOB-001 | Mobile menu | View on mobile device | Hamburger menu works | P0 |
| MOB-002 | Navigation drawer | Open menu on mobile | Drawer slides in properly | P0 |
| MOB-003 | Touch targets | Tap menu items | Items easily tappable (44px min) | P1 |

### 18.2 Pages
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| MOB-010 | Dashboard mobile | View dashboard on mobile | Stats stack vertically | P0 |
| MOB-011 | Member list mobile | View members on mobile | List scrollable, readable | P0 |
| MOB-012 | Forms mobile | Fill forms on mobile | Inputs usable | P0 |
| MOB-013 | Tables mobile | View tables on mobile | Horizontal scroll or responsive | P1 |

### 18.3 Kiosk Mobile
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| MOB-020 | Kiosk on tablet | Use kiosk on iPad | Full functionality | P0 |
| MOB-021 | QR scanner | Use camera on tablet | QR scanning works | P1 |

---

## 19. Security Testing

### 19.1 Authentication
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| SEC-001 | Protected routes | Access /dashboard without login | Redirected to /login | P0 |
| SEC-002 | Invalid JWT | Send request with tampered token | Rejected with 401 | P0 |
| SEC-003 | Expired JWT | Send request with expired token | Rejected, prompt to login | P0 |
| SEC-004 | CSRF protection | Send POST without valid origin | Request rejected | P1 |

### 19.2 Authorization
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| SEC-010 | Cross-owner access | Try to access another owner's data | 403 Forbidden | P0 |
| SEC-011 | Staff permission | Staff tries owner-only action | Access denied | P0 |
| SEC-012 | Demo mode mutation | Try to modify data in demo | Blocked with message | P0 |

### 19.3 Input Validation
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| SEC-020 | XSS prevention | Enter <script> in name field | Script not executed | P0 |
| SEC-021 | SQL injection | Enter SQL in search | No SQL execution | P0 |
| SEC-022 | Email validation | Enter invalid email formats | Validation error | P1 |

### 19.4 Rate Limiting
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| SEC-030 | Login rate limit | Attempt 10+ logins quickly | Rate limit triggered | P1 |
| SEC-031 | Signup rate limit | Attempt multiple signups | Rate limit triggered | P1 |
| SEC-032 | API rate limit | Make many API calls | Rate limit headers present | P2 |

---

## 20. Performance Testing

### 20.1 Page Load
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| PRF-001 | Dashboard load | Measure dashboard load time | < 3 seconds | P1 |
| PRF-002 | Member list load | Load 100+ members | < 2 seconds | P1 |
| PRF-003 | Landing page | Measure landing page LCP | < 2.5 seconds | P1 |

### 20.2 Database
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| PRF-010 | Large member count | Query with 1000+ members | Query < 500ms | P2 |
| PRF-011 | Check-in history | Query large check-in history | Paginated, responsive | P2 |

### 20.3 Concurrent Users
| ID | Test Case | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| PRF-020 | Multiple sessions | 10 concurrent users | No degradation | P2 |
| PRF-021 | Kiosk + dashboard | Use both simultaneously | Both responsive | P2 |

---

## Regression Checklist

Use this checklist before each release:

### Critical Path (Must Pass)
- [ ] User can sign up
- [ ] User receives verification email
- [ ] User can verify email and start trial
- [ ] User can login
- [ ] Dashboard loads with correct data
- [ ] User can add a member
- [ ] Member receives QR code email
- [ ] QR check-in works
- [ ] Kiosk mode works
- [ ] Stripe checkout works
- [ ] Webhook processes payments

### Secondary Flows
- [ ] Staff login works
- [ ] Role permissions enforced
- [ ] Demo mode works
- [ ] Theme switching works
- [ ] Mobile navigation works
- [ ] All pages load without errors
- [ ] Forms validate correctly
- [ ] Export functions work

### Visual/UX
- [ ] No console errors
- [ ] Images load correctly
- [ ] Logo displays everywhere
- [ ] Light mode readable
- [ ] Dark mode readable
- [ ] Walkthrough tour completes

---

## Bug Report Template

```markdown
**Bug ID:** BUG-XXX
**Reporter:**
**Date:**
**Severity:** Critical / High / Medium / Low

**Summary:**
[One-line description]

**Steps to Reproduce:**
1.
2.
3.

**Expected Result:**
[What should happen]

**Actual Result:**
[What actually happens]

**Environment:**
- Browser:
- OS:
- Screen size:
- Account type:

**Screenshots/Logs:**
[Attach if applicable]
```

---

## Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| QA Lead | | | |
| Dev Lead | | | |
| Product Owner | | | |

---

*Document maintained by BlueLoom Ventures LLC*
