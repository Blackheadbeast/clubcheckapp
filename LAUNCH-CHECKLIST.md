# ClubCheck Launch Checklist

## Pre-Launch Verification

### Security Hardening
- [x] Security headers configured (CSP, HSTS, X-Frame-Options, X-Content-Type-Options)
- [x] Rate limiting on all sensitive endpoints (auth, signup, email, feedback, checkin)
- [x] JWT tokens with httpOnly cookies
- [x] Password hashing with bcrypt (10 rounds)
- [x] Input validation with Zod schemas
- [x] SQL injection protection via Prisma ORM
- [x] CORS properly configured
- [x] Email verification required for new accounts
- [x] Demo mode isolation (mutations blocked)

### Database
- [x] Proper indexes on frequently queried columns
- [x] Cascade deletes configured
- [x] Database connection pooling (Prisma)
- [ ] Run `npx prisma db push` to apply new indexes
- [ ] Verify database backup strategy with Vercel/Supabase

### Authentication & Authorization
- [x] Email verification flow working
- [x] Trial period starts after verification
- [x] Billing status enforcement on mutations
- [x] Staff role-based permissions
- [x] Token expiry (7 days for auth, 24h for verification)
- [x] Logout clears auth cookie

### Rate Limits Applied
| Endpoint | Limit | Window |
|----------|-------|--------|
| Login | 10 attempts | 15 min |
| Signup | 5 signups | 1 hour |
| Email (verification/resend) | 5 emails | 15 min |
| Feedback | 10 submissions | 1 hour |
| Check-in | 60 requests | 1 min |
| Member Portal | 30 requests | 1 min |
| Bulk Operations | 10 operations | 5 min |
| General API | 100 requests | 1 min |

### Legal & Compliance
- [x] Privacy Policy page (/privacy)
- [x] Terms of Service page (/terms)
- [x] Legal entity: BlueLoom Ventures LLC (d/b/a ClubCheck)
- [x] Contact email: blueloomventuresllc@gmail.com
- [x] Footer copyright updated
- [x] Waiver system with signature capture

### Environment Variables Required
```
# Core
DATABASE_URL=postgresql://...
JWT_SECRET=<secure-random-string>
NEXT_PUBLIC_APP_URL=https://clubcheckapp.com

# Email (Resend)
RESEND_API_KEY=re_...

# Stripe Billing
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID_STARTER=price_...
STRIPE_PRICE_ID_PRO=price_...
STRIPE_PRICE_ID_STARTER_YEARLY=price_...
STRIPE_PRICE_ID_PRO_YEARLY=price_...
```

### Pre-Deployment Steps
1. [ ] Verify all environment variables are set in Vercel
2. [ ] Run `npx prisma db push` on production
3. [ ] Test email sending (verification emails)
4. [ ] Test Stripe webhook endpoint
5. [ ] Verify demo account exists
6. [ ] Check mobile responsiveness
7. [ ] Test walkthrough tour on fresh account

### Monitoring & Logging
- [x] Audit logging for key actions
- [x] Error logging to console (enhance for production)
- [ ] Set up error tracking (Sentry/LogRocket)
- [ ] Set up uptime monitoring

### Performance
- [x] Next.js compression enabled
- [x] Image optimization configured
- [x] Database indexes for common queries
- [x] Efficient pagination (take limits)

---

## Scaling for 100+ Users

### Current Capacity
The system is designed to handle:
- **100+ gym owners** (signups)
- **10,000+ total members** across all gyms
- **1,000+ daily check-ins**
- **Concurrent users**: ~50-100 (typical usage pattern)

### Architecture for Scale
| Component | Current | At 500+ Users |
|-----------|---------|---------------|
| Rate Limiting | In-memory (per-instance) | Upgrade to Upstash Redis |
| Database | Supabase/Vercel Postgres | Add connection pooling (PgBouncer) |
| Sessions | JWT (stateless) | No change needed |
| Email | Resend | Verify rate limits, upgrade plan if needed |

### When to Upgrade (Warning Signs)
1. **Rate limit failures** - Users getting blocked incorrectly
2. **Database connection errors** - "Too many connections"
3. **Slow API responses** - >500ms average
4. **Email delivery delays** - >30 second delays

### Upgrade Path
1. **Upstash Redis** ($0-10/mo) - Distributed rate limiting
   ```bash
   npm install @upstash/redis @upstash/ratelimit
   ```

2. **Supabase Pro** ($25/mo) - More connections, better pooling

3. **Resend Pro** ($20/mo) - Higher email limits

### Database Connection Pooling
For Supabase, add to DATABASE_URL:
```
?pgbouncer=true&connection_limit=10
```

---

## Launch Day Checklist

### Before Going Live
1. [ ] Final test of signup -> verification -> dashboard flow
2. [ ] Test Stripe checkout (monthly and yearly)
3. [ ] Test member creation and check-in
4. [ ] Test kiosk mode
5. [ ] Verify emails are being sent
6. [ ] Check all links in emails

### After Launch
1. [ ] Monitor error logs for first 24 hours
2. [ ] Check database performance
3. [ ] Monitor rate limit hits
4. [ ] Watch for unusual signup patterns
5. [ ] Respond to feedback submissions

---

## Emergency Contacts

- **Technical Issues**: blueloomventuresllc@gmail.com
- **Billing/Stripe**: Stripe Dashboard
- **Database**: Supabase/Vercel Dashboard
- **Domain/DNS**: Domain registrar

---

## Rollback Plan

If critical issues arise:
1. Revert to previous Vercel deployment
2. Check database for corrupted data
3. Review audit logs for issue timeline
4. Communicate with affected users

---

*Last updated: 2026-02-08*
*ClubCheck v1.0 - BlueLoom Ventures LLC*
