// Demo data for local evaluation: one gym ("Iron Harbor Fitness") with two
// locations, staff in every role, ~14 months of members, billing, classes,
// attendance, leads, product sales and messages.
//
//   npm run seed
//
// Safe to re-run: it deletes and rebuilds only the demo gym. It refuses to run
// against anything but a local database unless SEED_ALLOW_REMOTE=1 is set.

import { config } from 'dotenv'
import { randomUUID, randomBytes } from 'node:crypto'

config({ path: '.env.development.local', override: true })

const OWNER_EMAIL = 'owner@ironharbor.test'
const PASSWORD = 'clubcheck-demo'
const GYM_CODE = 'IRONHB'
const TZ = 'America/New_York'
const DAY = 86_400_000

function assertLocal() {
  let host = ''
  try {
    host = new URL(process.env.DATABASE_URL || '').hostname
  } catch {}
  if (!['localhost', '127.0.0.1'].includes(host) && process.env.SEED_ALLOW_REMOTE !== '1') {
    console.error(`Refusing to seed: DATABASE_URL points at "${host || 'nothing'}", which is not a local database.`)
    console.error('Start one with `npm run db:dev`, or set SEED_ALLOW_REMOTE=1 if you really mean it.')
    process.exit(1)
  }
}

// Deterministic randomness so the demo looks the same every time.
let seed = 20260118
function rand() {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min
const pick = <T,>(items: T[]): T => items[Math.floor(rand() * items.length)]
const chance = (p: number) => rand() < p
function weighted<T>(options: [T, number][]): T {
  const total = options.reduce((s, [, w]) => s + w, 0)
  let r = rand() * total
  for (const [value, w] of options) {
    r -= w
    if (r <= 0) return value
  }
  return options[0][0]
}

const FIRST = ['Maya', 'Jordan', 'Liam', 'Sofia', 'Ethan', 'Aaliyah', 'Noah', 'Chloe', 'Diego', 'Hannah', 'Marcus', 'Priya', 'Owen', 'Zoe', 'Andre', 'Lena', 'Caleb', 'Nadia', 'Isaac', 'Ruby', 'Tomas', 'Imani', 'Felix', 'Grace', 'Darius', 'Elise', 'Kenji', 'Amara', 'Lucas', 'Talia', 'Victor', 'Simone', 'Rafael', 'Ingrid', 'Malik', 'Camille']
const LAST = ['Reyes', 'Okafor', 'Lindqvist', 'Patel', 'Brennan', 'Nakamura', 'Alvarez', 'Whitfield', 'Kowalski', 'Haddad', 'Thornton', 'Baptiste', 'Sandoval', 'Mercer', 'Oyelaran', 'Castellanos', 'Fitzgerald', 'Novak', 'Abernathy', 'Delgado', 'Ishikawa', 'Mbeki', 'Rosenthal', 'Vasquez']
const STREETS = ['Harbor St', 'Mill Rd', 'Foundry Ave', 'Canal St', 'Linden Way', 'Summit Ave', 'Wharf Ln', 'Prospect St']
const SOURCES = ['Referral', 'Instagram', 'Google search', 'Walk-in', 'Website', 'Facebook ad', 'Corporate wellness', 'Community event']

async function main() {
  assertLocal()
  const { prisma } = await import('../lib/prisma')
  const bcrypt = (await import('bcryptjs')).default
  const { zonedToUtc, zonedParts, addDaysToDate, addMonths, addDays } = await import('../lib/dates')
  const { generateSessions } = await import('../lib/services/classes')
  const { getGymSettings } = await import('../lib/services/core')
  const { TRIGGERS } = await import('../lib/services/automations')

  const now = new Date()
  const today = zonedParts(now, TZ).date
  const ago = (days: number, jitterHours = 0) => new Date(now.getTime() - days * DAY - rand() * jitterHours * 3_600_000)
  // Small batches: the local dev database (PGlite) rejects very large parameter lists.
  const chunked = async <T,>(rows: T[], insert: (batch: T[]) => Promise<unknown>, size = 60) => {
    for (let i = 0; i < rows.length; i += size) await insert(rows.slice(i, i + size))
  }

  console.log('Seeding demo gym...')
  const existing = await prisma.owner.findUnique({ where: { email: OWNER_EMAIL } })
  if (existing) {
    // Memberships reference plans without cascade, so clear them first.
    await prisma.membership.deleteMany({ where: { ownerId: existing.id } })
    await prisma.owner.delete({ where: { id: existing.id } })
  }

  const ownerId = randomUUID()
  const passwordHash = await bcrypt.hash(PASSWORD, 10)
  await prisma.owner.create({
    data: {
      id: ownerId, email: OWNER_EMAIL, password: passwordHash, emailVerified: ago(420), planType: 'pro',
      subscriptionStatus: 'active', currentPeriodEnd: addDays(now, 21), createdAt: ago(420), gymCode: GYM_CODE,
      gymProfile: {
        create: {
          name: 'Iron Harbor Fitness', address: '48 Harbor St, Portland, ME 04101', timezone: TZ, currency: 'usd',
          kioskPinHash: await bcrypt.hash('1234', 10), waiverEnabled: true, walkthroughCompletedAt: ago(400), setupDismissedAt: ago(400),
          waiverText: 'I understand that physical exercise involves risk of injury. I voluntarily assume all such risks and release Iron Harbor Fitness, its owners and staff from liability for any injury sustained while using the facility or taking part in its classes.',
          bookingWindowDays: 14, cancelWindowHours: 2, waitlistOfferMinutes: 30, pastDueGraceDays: 7, theme: 'light',
        },
      },
    },
  })

  // ---- Locations & staff ---------------------------------------------------
  const downtown = await prisma.location.create({ data: { ownerId, name: 'Downtown', address: '48 Harbor St', city: 'Portland', state: 'ME', postalCode: '04101', phone: '(207) 555-0142', timezone: TZ, createdAt: ago(420) } })
  const eastside = await prisma.location.create({ data: { ownerId, name: 'Eastside', address: '310 Foundry Ave', city: 'Portland', state: 'ME', postalCode: '04103', phone: '(207) 555-0177', timezone: TZ, createdAt: ago(190) } })

  const staffDefs = [
    { key: 'admin', name: 'Renee Castellanos', role: 'admin', title: 'General Manager', location: downtown },
    { key: 'manager', name: 'Theo Brennan', role: 'manager', title: 'Eastside Manager', location: eastside },
    { key: 'desk', name: 'Jasmine Okafor', role: 'front_desk', title: 'Front Desk', location: downtown },
    { key: 'marcus', name: 'Marcus Thornton', role: 'coach', title: 'Head Coach', location: downtown, isCoach: true, color: '#f59e0b', bio: 'CF-L3. Fifteen years coaching strength and conditioning.' },
    { key: 'dana', name: 'Dana Whitfield', role: 'coach', title: 'Coach', location: downtown, isCoach: true, color: '#ef4444', bio: 'Former amateur boxer. Coaches boxing and CrossFit.' },
    { key: 'priya', name: 'Priya Patel', role: 'coach', title: 'Coach', location: downtown, isCoach: true, color: '#8b5cf6', bio: 'HIIT and conditioning specialist.' },
    { key: 'elena', name: 'Elena Novak', role: 'coach', title: 'Yoga & Pilates', location: eastside, isCoach: true, color: '#10b981', bio: 'RYT-500 yoga teacher and certified Pilates instructor.' },
    { key: 'tyrell', name: 'Tyrell Mercer', role: 'trainer', title: 'Coach & Personal Trainer', location: eastside, isCoach: true, color: '#3b82f6', bio: 'NSCA-CSCS. Runs Eastside CrossFit and 1:1 training.' },
    { key: 'sales', name: 'Bianca Sandoval', role: 'sales', title: 'Membership Advisor', location: downtown },
    { key: 'accountant', name: 'Walter Rosenthal', role: 'accountant', title: 'Bookkeeper', location: null },
  ]
  const staff: Record<string, { id: string; name: string }> = {}
  for (const s of staffDefs) {
    const email = `${s.name.split(' ')[0].toLowerCase()}@ironharbor.test`
    const row = await prisma.staff.create({
      data: {
        ownerId, name: s.name, email, password: passwordHash, role: s.role, title: s.title, locationId: s.location?.id || null,
        isCoach: !!s.isCoach, color: s.color || null, bio: s.bio || null, createdAt: ago(int(120, 400)), lastLoginAt: ago(int(0, 6), 12),
      },
    })
    staff[s.key] = { id: row.id, name: row.name }
  }

  // ---- Class types & plans -------------------------------------------------
  const classDefs = [
    { key: 'crossfit', name: 'CrossFit', category: 'class', color: '#f59e0b', dur: 60, cap: 16, description: 'Constantly varied functional movement at high intensity. All levels, every workout scaled.' },
    { key: 'hiit', name: 'HIIT', category: 'class', color: '#ef4444', dur: 45, cap: 20, description: 'Forty-five minutes of interval conditioning. No barbell experience needed.' },
    { key: 'yoga', name: 'Yoga Flow', category: 'class', color: '#10b981', dur: 60, cap: 18, description: 'Vinyasa flow focused on mobility and recovery.' },
    { key: 'pilates', name: 'Pilates', category: 'class', color: '#14b8a6', dur: 50, cap: 12, description: 'Mat Pilates for core strength and posture.' },
    { key: 'strength', name: 'Strength', category: 'class', color: '#6366f1', dur: 75, cap: 12, description: 'Barbell-focused strength cycle: squat, press, deadlift.' },
    { key: 'boxing', name: 'Boxing', category: 'class', color: '#ec4899', dur: 60, cap: 14, description: 'Bag work, pad work and conditioning. Gloves provided.' },
    { key: 'pt', name: 'Personal Training', category: 'personal_training', color: '#3b82f6', dur: 60, cap: 1, description: 'One-on-one session with a trainer.' },
    { key: 'workshop', name: 'Olympic Lifting Workshop', category: 'workshop', color: '#a855f7', dur: 120, cap: 10, description: 'Two-hour technique clinic on the snatch and clean & jerk.' },
  ]
  const classType: Record<string, { id: string; name: string; dur: number; cap: number }> = {}
  for (const c of classDefs) {
    const row = await prisma.classType.create({ data: { ownerId, name: c.name, category: c.category, color: c.color, defaultDurationMin: c.dur, defaultCapacity: c.cap, description: c.description } })
    classType[c.key] = { id: row.id, name: c.name, dur: c.dur, cap: c.cap }
  }

  const planDefs = [
    { key: 'unlimited', name: 'Unlimited Monthly', type: 'recurring', priceCents: 15900, description: 'Unlimited classes and open gym at both locations.' },
    { key: 'three', name: '3x per Week', type: 'recurring', priceCents: 11900, classLimit: 3, classLimitPeriod: 'week', description: 'Up to three classes a week.' },
    { key: 'student', name: 'Student Unlimited', type: 'recurring', priceCents: 9900, description: 'Unlimited membership for full-time students with valid ID.' },
    { key: 'founders', name: 'Founders 12-Month', type: 'recurring', priceCents: 13900, contractMonths: 12, enrollmentFeeCents: 4900, cancellationNoticeDays: 30, description: 'Discounted rate with a 12-month commitment.' },
    { key: 'annual', name: 'Unlimited Annual', type: 'recurring', priceCents: 159000, billingInterval: 'year', description: 'Pay for ten months, get twelve.' },
    { key: 'yoga_only', name: 'Yoga & Pilates Only', type: 'recurring', priceCents: 8900, classTypeIds: [classType.yoga.id, classType.pilates.id], description: 'Unlimited yoga and Pilates classes.' },
    { key: 'pack10', name: '10-Class Pack', type: 'class_pack', priceCents: 18000, credits: 10, expiresAfterDays: 120, description: 'Ten classes to use within four months.' },
    { key: 'dropin', name: 'Drop-In', type: 'drop_in', priceCents: 2500, credits: 1, expiresAfterDays: 30, description: 'A single class.' },
    { key: 'trial', name: '7-Day Free Trial', type: 'trial', priceCents: 0, trialDays: 7, description: 'A free week of unlimited classes for new members.' },
    { key: 'pt5', name: 'Personal Training 5-Pack', type: 'pt_package', priceCents: 35000, credits: 5, expiresAfterDays: 90, classTypeIds: [classType.pt.id], description: 'Five one-hour sessions with a trainer.' },
    { key: 'staff', name: 'Staff & Family', type: 'free', priceCents: 0, isPublic: false, description: 'Complimentary membership.' },
  ]
  const plan: Record<string, { id: string; name: string; priceCents: number; type: string; billingInterval: string; credits: number | null }> = {}
  for (const [i, p] of planDefs.entries()) {
    const { key, ...data } = p
    const row = await prisma.membershipPlan.create({
      data: { ownerId, sortOrder: i, billingInterval: data.type === 'recurring' ? 'month' : 'once', autoRenew: data.type === 'recurring', ...data },
    })
    plan[key] = { id: row.id, name: row.name, priceCents: row.priceCents, type: row.type, billingInterval: row.billingInterval, credits: row.credits }
  }

  const tagDefs = [['Founding Member', '#f59e0b'], ['Competitor', '#ef4444'], ['Morning Crew', '#3b82f6'], ['Student', '#8b5cf6'], ['Corporate', '#14b8a6'], ['Returning from injury', '#ec4899']]
  const tag: Record<string, string> = {}
  for (const [name, color] of tagDefs) tag[name] = (await prisma.tag.create({ data: { ownerId, name, color } })).id

  await prisma.coupon.createMany({
    data: [
      { ownerId, code: 'NEWYEAR20', description: '20% off the first month', percentOff: 20, appliesTo: 'memberships', maxRedemptions: 100, timesRedeemed: 14 },
      { ownerId, code: 'FRIEND25', description: '$25 off for referred friends', amountOffCents: 2500, appliesTo: 'all', timesRedeemed: 9 },
      { ownerId, code: 'SUMMERGEAR', description: '15% off apparel', percentOff: 15, appliesTo: 'products', expiresAt: ago(40), isActive: false, timesRedeemed: 31 },
    ],
  })

  // ---- Members -------------------------------------------------------------
  type Segment = 'recurring' | 'trial' | 'past_due' | 'frozen' | 'cancelled' | 'pack' | 'pt' | 'none'
  interface SeedMember {
    id: string; name: string; email: string; joined: Date; segment: Segment; locationId: string; planKey: string | null
    propensity: number; status: string; method: string
  }
  const segments: Segment[] = [
    ...Array(40).fill('recurring'), ...Array(5).fill('trial'), ...Array(4).fill('past_due'), ...Array(3).fill('frozen'),
    ...Array(6).fill('cancelled'), ...Array(7).fill('pack'), ...Array(3).fill('pt'), ...Array(4).fill('none'),
  ]
  const usedNames = new Set<string>()
  const members: SeedMember[] = []
  const memberRows: any[] = []
  const memberTags: { memberId: string; tagId: string }[] = []

  for (const [i, segment] of segments.entries()) {
    let name = ''
    do name = `${pick(FIRST)} ${pick(LAST)}`
    while (usedNames.has(name))
    usedNames.add(name)
    const id = randomUUID()
    const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`
    const joinedDaysAgo = segment === 'trial' ? int(1, 6) : segment === 'none' ? int(200, 400) : segment === 'pack' ? int(15, 100) : int(35, 410)
    const joined = ago(joinedDaysAgo, 10)
    const locationId = chance(0.62) ? downtown.id : eastside.id
    const planKey =
      segment === 'recurring' || segment === 'past_due' || segment === 'frozen' || segment === 'cancelled'
        ? weighted([['unlimited', 46], ['three', 20], ['student', 10], ['founders', 12], ['annual', 6], ['yoga_only', 6]])
        : segment === 'trial' ? 'trial' : segment === 'pack' ? 'pack10' : segment === 'pt' ? 'unlimited' : null
    const status = segment === 'recurring' || segment === 'pack' || segment === 'pt' ? 'active' : segment === 'none' ? 'inactive' : segment
    const method = weighted([['card', 55], ['ach', 15], ['cash', 20], ['check', 10]])
    const propensity = segment === 'cancelled' || segment === 'none' ? 0.05 : segment === 'frozen' ? 0.08 : 0.08 + rand() * 0.34
    members.push({ id, name, email, joined, segment, locationId, planKey, propensity, status, method })

    const birthYear = int(1968, 2004)
    // A couple of members have a birthday today so the alert and automation have something to show.
    const dob = i === 3 || i === 17 ? `${birthYear}-${today.slice(5)}` : `${birthYear}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`
    memberRows.push({
      id, ownerId, name, email, phone: `(207) 555-${String(1000 + i * 37).slice(-4)}`, status,
      qrCode: `clubcheck-member-${randomUUID()}`, accessToken: randomBytes(32).toString('hex'), accessTokenExpiry: addDays(now, 365),
      createdAt: joined, dateOfBirth: new Date(`${dob}T00:00:00.000Z`),
      addressLine1: `${int(12, 980)} ${pick(STREETS)}`, city: 'Portland', state: 'ME', postalCode: pick(['04101', '04102', '04103']),
      emergencyContactName: `${pick(FIRST)} ${name.split(' ')[1]}`, emergencyContactPhone: `(207) 555-${String(int(2000, 9999))}`,
      leadSource: pick(SOURCES), homeLocationId: locationId, emailOptIn: !chance(0.08), smsOptIn: chance(0.45),
      waiverSignedAt: chance(0.9) ? new Date(joined.getTime() + int(0, 3) * DAY) : null,
      waiverSignature: null as string | null,
      goals: chance(0.4) ? pick(['Lose 15 lb before the summer', 'First unassisted pull-up', 'Train for a half marathon', 'Build strength after a desk job', 'Compete in a local throwdown', 'Stay consistent three times a week']) : null,
      medicalNotes: chance(0.07) ? pick(['Recovering from a left shoulder impingement: no overhead pressing above 60%.', 'Asthma: carries an inhaler.', 'Lower back sensitivity: scale deadlifts.']) : null,
      assignedStaffId: segment === 'pt' ? staff.tyrell.id : chance(0.2) ? pick([staff.marcus.id, staff.dana.id, staff.priya.id]) : null,
    })
    if (joinedDaysAgo > 330) memberTags.push({ memberId: id, tagId: tag['Founding Member'] })
    if (planKey === 'student') memberTags.push({ memberId: id, tagId: tag.Student })
    if (chance(0.12)) memberTags.push({ memberId: id, tagId: tag.Competitor })
    if (chance(0.2)) memberTags.push({ memberId: id, tagId: tag['Morning Crew'] })
    if (chance(0.08)) memberTags.push({ memberId: id, tagId: tag.Corporate })
    if (memberRows[memberRows.length - 1].medicalNotes) memberTags.push({ memberId: id, tagId: tag['Returning from injury'] })
  }
  for (const row of memberRows) if (row.waiverSignedAt) row.waiverSignature = row.name
  await chunked(memberRows, (batch) => prisma.member.createMany({ data: batch }))
  await prisma.memberTag.createMany({ data: memberTags, skipDuplicates: true })

  // ---- Memberships, invoices, transactions ---------------------------------
  const memberships: any[] = []
  const invoices: any[] = []
  const invoiceItems: any[] = []
  const transactions: any[] = []
  const activities: any[] = []
  const membershipOf = new Map<string, { id: string; planKey: string; credit: boolean }>()
  const activity = (memberId: string, type: string, title: string, at: Date, detail?: string | null, actorName?: string) =>
    activities.push({ ownerId, memberId, type, title, detail: detail || null, createdAt: at, actorType: actorName ? 'staff' : 'system', actorName: actorName || 'System' })
  const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`

  const addInvoice = (o: { memberId: string | null; membershipId?: string | null; description: string; type: string; amountCents: number; at: Date; paid: boolean; method: string; periodStart?: Date; periodEnd?: Date; planId?: string; failed?: boolean; locationId?: string | null; extra?: { description: string; amountCents: number }[] }) => {
    const id = randomUUID()
    const lines = [{ description: o.description, amountCents: o.amountCents, type: o.type }, ...(o.extra || []).map((e) => ({ ...e, type: 'enrollment_fee' }))]
    const total = lines.reduce((s, l) => s + l.amountCents, 0)
    invoices.push({
      id, ownerId, memberId: o.memberId, membershipId: o.membershipId || null, number: '', status: o.paid ? 'paid' : 'open',
      subtotalCents: total, totalCents: total, amountPaidCents: o.paid ? total : 0, dueDate: o.at, paidAt: o.paid ? o.at : null,
      periodStart: o.periodStart || null, periodEnd: o.periodEnd || null, createdAt: o.at, attemptCount: o.failed ? 2 : 0,
      nextAttemptAt: o.failed ? addDays(now, 2) : null,
    })
    for (const l of lines) invoiceItems.push({ invoiceId: id, description: l.description, type: l.type, quantity: 1, unitPriceCents: l.amountCents, amountCents: l.amountCents, planId: o.planId || null })
    if (o.paid) {
      transactions.push({ ownerId, memberId: o.memberId, invoiceId: id, locationId: o.locationId || null, type: 'payment', status: 'succeeded', amountCents: total, method: o.method, provider: 'manual', cardLast4: o.method === 'card' ? String(int(1000, 9999)) : null, staffName: o.method === 'cash' || o.method === 'check' ? staff.desk.name : null, createdAt: new Date(o.at.getTime() + int(0, 40) * 60_000) })
    }
    if (o.failed) {
      for (const offset of [0, 3]) {
        transactions.push({ ownerId, memberId: o.memberId, invoiceId: id, type: 'payment', status: 'failed', amountCents: total, method: 'card', provider: 'manual', failureReason: pick(['Card declined', 'Insufficient funds', 'Card expired']), createdAt: addDays(o.at, offset) })
      }
    }
    return { id, total }
  }

  for (const m of members) {
    if (!m.planKey) continue
    const p = plan[m.planKey]
    const membershipId = randomUUID()
    const base: any = { id: membershipId, ownerId, memberId: m.id, planId: p.id, startDate: m.joined, priceCents: p.priceCents, paymentMethod: m.method, createdAt: m.joined, autoRenew: p.type === 'recurring', status: 'active' }
    membershipOf.set(m.id, { id: membershipId, planKey: m.planKey, credit: p.type !== 'recurring' && p.type !== 'free' && p.type !== 'trial' })
    activity(m.id, 'joined', 'Joined', m.joined, `Source: ${memberRows.find((r) => r.id === m.id).leadSource}`)

    if (p.type === 'trial') {
      base.status = 'trial'
      base.endDate = addDays(m.joined, 7)
      activity(m.id, 'membership_purchased', `Started ${p.name}`, m.joined, 'Free', staff.sales.name)
    } else if (p.type === 'class_pack') {
      base.creditsRemaining = p.credits
      base.endDate = addDays(m.joined, 120)
      addInvoice({ memberId: m.id, membershipId, description: `${p.name} · 10 sessions`, type: 'class_pack', amountCents: p.priceCents, at: m.joined, paid: true, method: m.method, planId: p.id, locationId: m.locationId })
      activity(m.id, 'membership_purchased', `Purchased ${p.name}`, m.joined, money(p.priceCents), staff.desk.name)
    } else {
      // Recurring: one invoice per elapsed period.
      const months = p.billingInterval === 'year' ? 12 : 1
      // Past-due members were last billed 12 days ago and have not paid.
      const start = m.segment === 'past_due' ? addMonths(ago(12), -int(2, 9)) : m.joined
      base.startDate = start
      if (m.planKey === 'founders') base.contractEndsAt = addMonths(start, 12)
      const end = m.segment === 'cancelled' ? ago(int(20, 120)) : m.segment === 'frozen' ? ago(int(8, 30)) : now
      let periodStart = start
      let k = 0
      while (periodStart <= end) {
        const periodEnd = addMonths(start, (k + 1) * months)
        const isLatest = periodEnd > end
        const unpaid = m.segment === 'past_due' && isLatest
        addInvoice({
          memberId: m.id, membershipId, description: `${p.name} (${months === 12 ? 'annual' : 'monthly'})`, type: 'membership', amountCents: p.priceCents,
          at: periodStart, paid: !unpaid, failed: unpaid, method: m.method, periodStart, periodEnd, planId: p.id, locationId: m.locationId,
          extra: k === 0 && m.planKey === 'founders' ? [{ description: 'Enrollment fee', amountCents: 4900 }] : undefined,
        })
        if (unpaid) {
          activity(m.id, 'payment_failed', `Payment of ${money(p.priceCents)} failed`, periodStart, 'Card declined')
          activity(m.id, 'membership_past_due', `${p.name} is past due`, addDays(periodStart, 8))
        } else if (isLatest || periodEnd > ago(70)) {
          activity(m.id, 'payment', `Payment of ${money(p.priceCents)} received`, periodStart, m.method)
        }
        base.currentPeriodStart = periodStart
        base.currentPeriodEnd = periodEnd
        base.lastBilledAt = periodStart
        periodStart = periodEnd
        k++
      }
      activity(m.id, 'membership_purchased', `Purchased ${p.name}`, start, `${money(p.priceCents)} ${months === 12 ? 'annual' : 'monthly'}`, staff.sales.name)
      if (m.segment === 'past_due') {
        base.status = 'past_due'
        base.failedPaymentCount = 2
        base.paymentMethod = 'card'
      }
      if (m.segment === 'frozen') {
        base.status = 'frozen'
        base.frozenAt = end
        base.freezeEndsAt = addDays(now, int(10, 45))
        activity(m.id, 'membership_frozen', `${p.name} frozen`, end, pick(['Travelling for work', 'Knee surgery recovery', 'Summer away']), staff.admin.name)
      }
      if (m.segment === 'cancelled') {
        base.status = 'cancelled'
        base.cancelledAt = end
        base.endDate = end
        base.autoRenew = false
        base.cancelReason = pick(['Moving out of state', 'Cost', 'Not using it enough', 'Switched to a gym closer to work'])
        activity(m.id, 'membership_cancelled', `${p.name} cancelled`, end, base.cancelReason, staff.admin.name)
      }
      // A few members have told the desk they are leaving at the end of the period.
      if (m.segment === 'recurring' && chance(0.06) && base.currentPeriodEnd) {
        base.cancelAt = base.currentPeriodEnd
        base.autoRenew = false
        base.cancelReason = 'Moving in the spring'
      }
    }
    memberships.push(base)

    if (m.segment === 'pt') {
      const ptId = randomUUID()
      const bought = ago(int(10, 40))
      memberships.push({ id: ptId, ownerId, memberId: m.id, planId: plan.pt5.id, startDate: bought, endDate: addDays(bought, 90), priceCents: plan.pt5.priceCents, paymentMethod: m.method, createdAt: bought, autoRenew: false, status: 'active', creditsRemaining: int(1, 4) })
      addInvoice({ memberId: m.id, membershipId: ptId, description: `${plan.pt5.name} · 5 sessions`, type: 'class_pack', amountCents: plan.pt5.priceCents, at: bought, paid: true, method: m.method, planId: plan.pt5.id, locationId: m.locationId })
      activity(m.id, 'membership_purchased', `Purchased ${plan.pt5.name}`, bought, money(plan.pt5.priceCents), staff.tyrell.name)
    }
  }
  for (const m of members.filter((x) => x.segment === 'none')) activity(m.id, 'joined', 'Joined', m.joined)

  // ---- Products & orders ---------------------------------------------------
  const productDefs = [
    ['Iron Harbor Tee', 'TEE-BLK', 'apparel', 2800, 1100, 60], ['Iron Harbor Hoodie', 'HOOD-GRY', 'apparel', 5800, 2600, 30], ['Tank Top', 'TANK-WHT', 'apparel', 2400, 900, 40],
    ['Whey Protein 2 lb', 'SUP-WHEY2', 'supplements', 4900, 2900, 24], ['Creatine 300 g', 'SUP-CREA', 'supplements', 2900, 1500, 20], ['Pre-Workout', 'SUP-PRE', 'supplements', 3900, 2100, 18],
    ['Cold Brew', 'DRK-COLD', 'drinks', 450, 180, 120], ['Electrolyte Drink', 'DRK-ELEC', 'drinks', 350, 140, 150], ['Protein Shake', 'DRK-SHAKE', 'drinks', 650, 260, 90], ['Sparkling Water', 'DRK-SPRK', 'drinks', 250, 90, 140],
    ['Jump Rope', 'EQ-ROPE', 'equipment', 2200, 900, 25], ['Lifting Straps', 'EQ-STRAP', 'equipment', 1800, 700, 20], ['Hand Wraps', 'EQ-WRAP', 'equipment', 1200, 400, 35],
    ['Shaker Bottle', 'MER-SHKR', 'merchandise', 1200, 450, 45], ['Gym Towel', 'MER-TOWL', 'merchandise', 1500, 600, 8],
  ] as const
  const products: { id: string; name: string; priceCents: number; stock: number; sold: number }[] = []
  for (const [name, sku, category, priceCents, costCents, stock] of productDefs) {
    const row = await prisma.product.create({ data: { ownerId, name, sku, category, priceCents, costCents, stock, lowStockThreshold: category === 'drinks' ? 24 : 6 } })
    products.push({ id: row.id, name, priceCents, stock, sold: 0 })
  }
  const orders: any[] = []
  const orderItems: any[] = []
  const adjustments: any[] = products.map((p) => ({ productId: p.id, delta: p.stock, reason: 'restock', note: 'Opening stock', staffName: staff.admin.name, createdAt: ago(75) }))
  const buyers = members.filter((m) => m.status === 'active')
  for (let i = 0; i < 130; i++) {
    const at = ago(rand() * 60, 0)
    const orderId = randomUUID()
    const buyer = chance(0.8) ? pick(buyers) : null
    const count = weighted([[1, 60], [2, 30], [3, 10]])
    let subtotal = 0
    const chosen = new Set<string>()
    for (let j = 0; j < count; j++) {
      const p = weighted(products.map((x) => [x, x.name.includes('Drink') || x.name.includes('Brew') || x.name.includes('Water') || x.name.includes('Shake') ? 5 : 1] as [typeof x, number]))
      if (chosen.has(p.id) || p.stock - p.sold <= 2) continue
      chosen.add(p.id)
      const qty = chance(0.85) ? 1 : 2
      p.sold += qty
      subtotal += qty * p.priceCents
      orderItems.push({ orderId, productId: p.id, name: p.name, quantity: qty, unitPriceCents: p.priceCents, amountCents: qty * p.priceCents })
      adjustments.push({ productId: p.id, delta: -qty, reason: 'sale', staffName: staff.desk.name, createdAt: at })
    }
    if (subtotal === 0) continue
    const method = weighted([['card', 70], ['cash', 30]])
    const locationId = chance(0.65) ? downtown.id : eastside.id
    orders.push({ id: orderId, ownerId, number: '', memberId: buyer?.id || null, locationId, staffId: staff.desk.id, staffName: staff.desk.name, status: 'completed', subtotalCents: subtotal, totalCents: subtotal, paymentMethod: method, createdAt: at })
    const inv = addInvoice({ memberId: buyer?.id || null, description: 'Product sale', type: 'product', amountCents: subtotal, at, paid: true, method, locationId })
    invoices[invoices.length - 1].orderId = orderId
    // Replace the generic line with the real items.
    for (let n = invoiceItems.length - 1; n >= 0 && invoiceItems[n].invoiceId === inv.id; n--) invoiceItems.splice(n, 1)
    for (const item of orderItems.filter((o) => o.orderId === orderId)) invoiceItems.push({ invoiceId: inv.id, description: item.name, type: 'product', quantity: item.quantity, unitPriceCents: item.unitPriceCents, amountCents: item.amountCents, productId: item.productId })
  }
  orders.sort((a, b) => a.createdAt - b.createdAt).forEach((o, i) => (o.number = `ORD-${String(i + 1).padStart(5, '0')}`))

  // One refund so refunds show up in reports.
  const refundable = transactions.filter((t) => t.status === 'succeeded' && t.amountCents === plan.unlimited.priceCents && t.createdAt > ago(40))[0]
  invoices.sort((a, b) => a.createdAt - b.createdAt).forEach((inv, i) => (inv.number = `INV-${String(i + 1).padStart(5, '0')}`))
  await chunked(memberships, (batch) => prisma.membership.createMany({ data: batch }))
  await chunked(orders, (batch) => prisma.order.createMany({ data: batch }))
  await chunked(orderItems, (batch) => prisma.orderItem.createMany({ data: batch }))
  await chunked(adjustments, (batch) => prisma.inventoryAdjustment.createMany({ data: batch }))
  await chunked(invoices, (batch) => prisma.invoice.createMany({ data: batch }))
  await chunked(invoiceItems, (batch) => prisma.invoiceItem.createMany({ data: batch }))
  await chunked(transactions.map((t) => ({ id: randomUUID(), ...t })), (batch) => prisma.transaction.createMany({ data: batch }))
  for (const p of products) await prisma.product.update({ where: { id: p.id }, data: { stock: p.stock - p.sold } })
  await prisma.gymProfile.update({ where: { ownerId }, data: { invoiceSequence: invoices.length, orderSequence: orders.length } })
  if (refundable) {
    const original = await prisma.transaction.findFirst({ where: { ownerId, invoiceId: refundable.invoiceId, status: 'succeeded' } })
    if (original) {
      await prisma.transaction.create({ data: { ownerId, memberId: original.memberId, invoiceId: original.invoiceId, type: 'refund', status: 'succeeded', amountCents: 5000, method: original.method, locationId: original.locationId, note: 'Goodwill credit for a cancelled class week', parentTransactionId: original.id, staffName: staff.admin.name, createdAt: ago(9) } })
      await prisma.transaction.update({ where: { id: original.id }, data: { refundedCents: 5000 } })
      await prisma.invoice.update({ where: { id: original.invoiceId! }, data: { refundedCents: 5000 } })
      if (original.memberId) activity(original.memberId, 'refund', 'Refund of $50 issued', ago(9), 'Goodwill credit for a cancelled class week', staff.admin.name)
    }
  }

  // ---- Class schedule ------------------------------------------------------
  const D = downtown.id
  const E = eastside.id
  const templates = [
    { type: 'crossfit', days: [1, 2, 3, 4, 5], time: '06:00', coach: 'marcus', loc: D, room: 'Main Floor' },
    { type: 'crossfit', days: [1, 2, 3, 4, 5], time: '17:30', coach: 'dana', loc: D, room: 'Main Floor' },
    { type: 'crossfit', days: [6], time: '09:00', coach: 'marcus', loc: D, room: 'Main Floor' },
    { type: 'hiit', days: [1, 3, 5], time: '12:00', coach: 'priya', loc: D, room: 'Studio A' },
    { type: 'strength', days: [2, 4], time: '18:30', coach: 'marcus', loc: D, room: 'Barbell Room' },
    { type: 'yoga', days: [2, 4], time: '07:00', coach: 'elena', loc: D, room: 'Studio A' },
    { type: 'yoga', days: [0], time: '10:00', coach: 'elena', loc: D, room: 'Studio A' },
    { type: 'boxing', days: [1, 3], time: '19:00', coach: 'dana', loc: D, room: 'Studio B' },
    { type: 'crossfit', days: [1, 2, 3, 4, 5], time: '06:30', coach: 'tyrell', loc: E, room: 'Main Floor', cap: 14 },
    { type: 'crossfit', days: [1, 2, 3, 4, 5], time: '18:00', coach: 'tyrell', loc: E, room: 'Main Floor', cap: 14 },
    { type: 'pilates', days: [2, 4], time: '09:30', coach: 'elena', loc: E, room: 'Studio' },
    { type: 'pilates', days: [6], time: '10:30', coach: 'elena', loc: E, room: 'Studio' },
    { type: 'hiit', days: [6], time: '08:00', coach: 'priya', loc: E, room: 'Main Floor' },
  ]
  const settings = await getGymSettings(ownerId)
  const sessionRows: any[] = []
  const HISTORY_DAYS = 70
  for (const t of templates) {
    const ct = classType[t.type]
    const schedule = await prisma.classSchedule.create({
      data: {
        ownerId, classTypeId: ct.id, locationId: t.loc, coachId: staff[t.coach].id, room: t.room, daysOfWeek: t.days, startTime: t.time,
        durationMin: ct.dur, capacity: t.cap || ct.cap, waitlistCapacity: 8, startDate: zonedToUtc(addDaysToDate(today, -HISTORY_DAYS), '00:00', TZ),
      },
    })
    // History (and anything earlier today) is written directly; the future comes from the real generator.
    for (let d = HISTORY_DAYS; d >= 0; d--) {
      const date = addDaysToDate(today, -d)
      const [y, mo, da] = date.split('-').map(Number)
      if (!t.days.includes(new Date(Date.UTC(y, mo - 1, da)).getUTCDay())) continue
      const startsAt = zonedToUtc(date, t.time, TZ)
      if (startsAt >= now) continue
      sessionRows.push({ id: randomUUID(), ownerId, classTypeId: ct.id, scheduleId: schedule.id, locationId: t.loc, coachId: staff[t.coach].id, room: t.room, startsAt, endsAt: new Date(startsAt.getTime() + ct.dur * 60_000), capacity: t.cap || ct.cap, waitlistCapacity: 8, _type: t.type })
    }
    await generateSessions(prisma, schedule, settings, addDays(now, 35), now)
  }
  await chunked(sessionRows.map(({ _type, ...s }) => s), (batch) => prisma.classSession.createMany({ data: batch, skipDuplicates: true }))

  // A one-off workshop next weekend, restricted to people who paid for it or have unlimited plans.
  const workshopDate = addDaysToDate(today, 9)
  const workshopStart = zonedToUtc(workshopDate, '13:00', TZ)
  await prisma.classSession.create({
    data: { ownerId, classTypeId: classType.workshop.id, locationId: D, coachId: staff.marcus.id, room: 'Barbell Room', startsAt: workshopStart, endsAt: new Date(workshopStart.getTime() + 120 * 60_000), capacity: 10, waitlistCapacity: 5, notes: 'Bring lifting shoes if you have them.' },
  })

  // ---- Attendance history --------------------------------------------------
  const bookings: any[] = []
  const checkins: any[] = []
  const visitDays = new Map<string, Set<string>>()
  const lastVisit = new Map<string, Date>()
  const packUsed = new Map<string, number>()
  const noteVisit = (memberId: string, at: Date) => {
    const set = visitDays.get(memberId) || new Set<string>()
    set.add(zonedParts(at, TZ).date)
    visitDays.set(memberId, set)
    if (!lastVisit.get(memberId) || at > lastVisit.get(memberId)!) lastVisit.set(memberId, at)
  }
  const canAttend = (m: SeedMember, s: any) => {
    if (m.joined > s.startsAt || !m.planKey) return false
    if (m.planKey === 'yoga_only' && !['yoga', 'pilates'].includes(s._type)) return false
    if (m.segment === 'cancelled' || m.segment === 'frozen') return s.startsAt < ago(35)
    if (m.segment === 'pack') return (packUsed.get(m.id) || 0) < 8
    return true
  }
  for (const s of sessionRows) {
    const pool = members.filter((m) => canAttend(m, s) && chance(m.propensity * (m.locationId === s.locationId ? 1 : 0.2)))
    for (const m of pool.slice(0, s.capacity)) {
      const membership = membershipOf.get(m.id)!
      const outcome = weighted([['attended', 88], ['no_show', 5], ['late_cancelled', 3], ['cancelled', 4]])
      const bookedAt = new Date(s.startsAt.getTime() - int(2, 96) * 3_600_000)
      if (m.segment === 'pack' && outcome !== 'cancelled') packUsed.set(m.id, (packUsed.get(m.id) || 0) + 1)
      const at = new Date(s.startsAt.getTime() - int(1, 14) * 60_000)
      bookings.push({ ownerId, sessionId: s.id, memberId: m.id, membershipId: membership.id, status: outcome, creditUsed: membership.credit && outcome !== 'cancelled', source: chance(0.7) ? 'member' : 'staff', createdAt: bookedAt, checkedInAt: outcome === 'attended' ? at : null, cancelledAt: outcome.includes('cancelled') ? new Date(s.startsAt.getTime() - int(1, 30) * 3_600_000) : null })
      if (outcome === 'attended') {
        checkins.push({ ownerId, memberId: m.id, timestamp: at, source: weighted([['qr', 60], ['kiosk', 25], ['search', 15]]), type: 'class', sessionId: s.id, locationId: s.locationId })
        noteVisit(m.id, at)
      }
    }
  }
  // Open-gym visits on top of classes.
  for (const m of members) {
    if (!m.planKey || m.planKey === 'yoga_only') continue
    for (let d = HISTORY_DAYS; d >= 0; d--) {
      if (m.segment === 'cancelled' || m.segment === 'frozen' ? d < 35 : false) continue
      if (!chance(m.propensity * 0.35)) continue
      const at = zonedToUtc(addDaysToDate(today, -d), `${String(int(6, 20)).padStart(2, '0')}:${String(int(0, 59)).padStart(2, '0')}`, TZ)
      if (at > now || at < m.joined) continue
      checkins.push({ ownerId, memberId: m.id, timestamp: at, source: weighted([['qr', 55], ['kiosk', 30], ['phone', 15]]), type: 'open_gym', locationId: m.locationId })
      noteVisit(m.id, at)
    }
  }
  await chunked(bookings, (batch) => prisma.booking.createMany({ data: batch, skipDuplicates: true }))
  await chunked(checkins, (batch) => prisma.checkin.createMany({ data: batch }))

  // Streaks and last-visit columns derived from the visits just written.
  for (const m of members) {
    const days = Array.from(visitDays.get(m.id) || []).sort()
    if (days.length === 0) continue
    let longest = 1
    let run = 1
    for (let i = 1; i < days.length; i++) {
      run = addDaysToDate(days[i - 1], 1) === days[i] ? run + 1 : 1
      longest = Math.max(longest, run)
    }
    const last = days[days.length - 1]
    const live = last === today || last === addDaysToDate(today, -1)
    await prisma.member.update({
      where: { id: m.id },
      data: { lastCheckInAt: lastVisit.get(m.id), currentStreak: live ? run : 0, longestStreak: longest, lastStreakCheckDate: zonedToUtc(last, '00:00', TZ) },
    })
    const recent = checkins.filter((c) => c.memberId === m.id).sort((a, b) => b.timestamp - a.timestamp).slice(0, 4)
    for (const c of recent) activity(m.id, c.type === 'class' ? 'class_attended' : 'checkin', c.type === 'class' ? `Attended ${classDefs.find((d) => classType[d.key].id === sessionRows.find((s) => s.id === c.sessionId)?.classTypeId)?.name || 'class'}` : 'Checked in', c.timestamp)
    if (m.segment === 'pack') {
      await prisma.membership.update({ where: { id: membershipOf.get(m.id)!.id }, data: { creditsRemaining: Math.max(0, 10 - (packUsed.get(m.id) || 0)) } })
    }
  }

  // ---- Upcoming bookings & a live waitlist ---------------------------------
  const upcoming = await prisma.classSession.findMany({ where: { ownerId, startsAt: { gt: now, lt: addDays(now, 8) } }, orderBy: { startsAt: 'asc' } })
  const unlimited = members.filter((m) => m.segment === 'recurring' && m.planKey !== 'yoga_only' && m.planKey !== 'three')
  const futureBookings: any[] = []
  const upcomingPerMember = new Map<string, number>()
  let showcase: string | null = null
  for (const s of upcoming) {
    // The first 5:30pm CrossFit class is deliberately oversubscribed to show the waitlist.
    const isShowcase = !showcase && s.classTypeId === classType.crossfit.id && s.locationId === D && zonedParts(s.startsAt, TZ).hour === 17
    if (isShowcase) showcase = s.id
    const daysOut = (s.startsAt.getTime() - now.getTime()) / DAY
    const fill = isShowcase ? s.capacity + 3 : Math.round(s.capacity * Math.max(0.15, 0.85 - daysOut * 0.09 + (rand() - 0.5) * 0.3))
    const pool = [...unlimited].filter((m) => (isShowcase || (upcomingPerMember.get(m.id) || 0) < 4) && (m.locationId === s.locationId || chance(0.15))).sort(() => rand() - 0.5).slice(0, Math.min(fill, s.capacity + 3))
    pool.forEach((m) => upcomingPerMember.set(m.id, (upcomingPerMember.get(m.id) || 0) + 1))
    pool.forEach((m, i) => {
      const waitlisted = i >= s.capacity
      futureBookings.push({ ownerId, sessionId: s.id, memberId: m.id, membershipId: membershipOf.get(m.id)!.id, status: waitlisted ? 'waitlisted' : 'booked', source: 'member', createdAt: ago(rand() * 3), waitlistedAt: waitlisted ? ago(0.2 - i * 0.001) : null })
    })
  }
  await chunked(futureBookings, (batch) => prisma.booking.createMany({ data: batch, skipDuplicates: true }))

  // ---- Leads ---------------------------------------------------------------
  const leadStages: [string, number][] = [['new', 7], ['contacted', 6], ['trial_scheduled', 4], ['trial_completed', 3], ['follow_up', 3], ['converted', 6], ['lost', 4]]
  const converted = members.filter((m) => m.segment === 'recurring').slice(0, 6)
  let convertedIndex = 0
  for (const [stage, count] of leadStages) {
    for (let i = 0; i < count; i++) {
      const member = stage === 'converted' ? converted[convertedIndex++] : null
      let name = member?.name || ''
      while (!name || (!member && usedNames.has(name))) name = `${pick(FIRST)} ${pick(LAST)}`
      usedNames.add(name)
      const created = member ? addDays(member.joined, -int(4, 16)) : ago(stage === 'new' ? rand() * 4 : int(3, 45), 8)
      const lead = await prisma.prospect.create({
        data: {
          ownerId, name, email: member?.email || `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`, phone: `(207) 555-${String(int(3000, 9999))}`,
          status: stage, source: pick(SOURCES), interest: pick(['CrossFit', 'Weight loss', 'Yoga', 'Personal training', 'General fitness', 'Boxing']),
          assignedStaffId: chance(0.8) ? staff.sales.id : staff.desk.id, locationId: chance(0.6) ? D : E, createdAt: created,
          estimatedValueCents: pick([15900, 11900, 9900, 13900]) * 12,
          contactedAt: stage !== 'new' ? addDays(created, 1) : null,
          trialDate: stage === 'trial_scheduled' ? zonedToUtc(addDaysToDate(today, i === 0 ? 1 : int(2, 6)), pick(['06:00', '12:00', '17:30']), TZ) : ['trial_completed', 'follow_up', 'converted'].includes(stage) ? addDays(created, 4) : null,
          touredAt: ['trial_completed', 'follow_up', 'converted'].includes(stage) ? addDays(created, 4) : null,
          nextFollowUpAt: ['contacted', 'follow_up', 'trial_completed'].includes(stage) ? addDays(now, int(-2, 4)) : null,
          convertedAt: stage === 'converted' ? member!.joined : null, convertedMemberId: member?.id || null,
          lostReason: stage === 'lost' ? pick(['Price', 'Joined another gym', 'No response after three attempts', 'Schedule did not fit']) : null,
          notes: chance(0.5) ? pick(['Works downtown, prefers the 6am class.', 'Came in with a friend who is already a member.', 'Asked about the student rate.', 'Training for a Spartan race in the fall.']) : null,
        },
      })
      const log = (type: string, title: string, at: Date, detail?: string) => activities.push({ ownerId, prospectId: lead.id, type, title, detail: detail || null, createdAt: at, actorType: 'staff', actorName: staff.sales.name })
      log('lead_created', 'Lead created', created, `Source: ${lead.source}`)
      if (stage !== 'new') log('lead_stage', 'Moved to Contacted', addDays(created, 1), 'Left a voicemail and sent a follow-up email.')
      if (['trial_scheduled', 'trial_completed', 'follow_up', 'converted'].includes(stage)) log('lead_stage', 'Trial scheduled', addDays(created, 2))
      if (['trial_completed', 'follow_up', 'converted'].includes(stage)) log('lead_stage', 'Trial completed', addDays(created, 4), 'Enjoyed the class, asked about pricing.')
      if (stage === 'converted') log('lead_converted', 'Converted to member', member!.joined)
      if (stage === 'lost') log('lead_stage', 'Marked as lost', addDays(created, 12), lead.lostReason || undefined)
    }
  }

  // ---- Notes, templates, automations, campaign -----------------------------
  const noteTexts = ['Prefers to be coached quietly, does not like being called out in class.', 'Interested in the next Olympic lifting workshop.', 'Asked to move billing date to the 15th.', 'Brought a guest on Saturday who may sign up.', 'Mentioned a sore wrist: check in before front squats.', 'Wants to try the 6am class next month.']
  for (const m of members.filter((x) => x.segment === 'recurring').slice(0, 14)) activity(m.id, 'note', 'Note', ago(int(1, 60)), pick(noteTexts), pick([staff.marcus.name, staff.desk.name, staff.admin.name]))
  await chunked(activities, (batch) => prisma.activity.createMany({ data: batch }))

  await prisma.messageTemplate.createMany({
    data: [
      { ownerId, name: 'Holiday hours', channel: 'email', subject: 'Holiday hours at {{gym_name}}', body: 'Hi {{first_name}},\n\nA quick note on our holiday schedule: we close at 2pm on the 24th and reopen on the 26th with a full class timetable.\n\nSee you on the floor,\n{{gym_name}}' },
      { ownerId, name: 'Class cancelled', channel: 'sms', body: '{{gym_name}}: tonight\'s class is cancelled. Any credit has been returned. Sorry for the short notice!' },
      { ownerId, name: 'Bring a friend week', channel: 'email', subject: 'Bring a friend free next week', body: 'Hi {{first_name}},\n\nNext week is Bring a Friend week. Any friend can join you in class for free, Monday to Saturday. Just have them arrive ten minutes early to sign a waiver.' },
      { ownerId, name: 'Payment reminder', channel: 'email', subject: 'A quick reminder about your balance', body: 'Hi {{first_name}},\n\nOur records show a balance on your account. You can settle it at the front desk next time you are in. Thanks!' },
    ],
  })
  const activeTriggers = ['lead_created', 'trial_booked', 'member_joined', 'payment_failed', 'member_inactive', 'class_missed']
  await prisma.automation.createMany({
    data: TRIGGERS.map((t) => ({ ownerId, name: t.label, trigger: t.key, channel: 'email', subject: t.defaultSubject, body: t.defaultBody, isActive: activeTriggers.includes(t.key), conditions: t.condition ? { [t.condition.key]: t.condition.default } : undefined })),
  })

  const campaign = await prisma.campaign.create({
    data: { ownerId, name: 'Bring a friend week', channel: 'email', subject: 'Bring a friend free next week', body: 'Hi {{first_name}},\n\nNext week is Bring a Friend week. Any friend can join you in class for free.', audience: { type: 'status', status: 'active' }, status: 'sent', sentAt: ago(18), createdByName: staff.admin.name, createdAt: ago(18) },
  })
  const recipients = members.filter((m) => m.status === 'active' && m.joined < ago(18))
  await prisma.message.createMany({
    data: recipients.map((m) => {
      const opened = chance(0.58)
      const failed = chance(0.03)
      return {
        ownerId, channel: 'email', memberId: m.id, campaignId: campaign.id, toAddress: m.email, subject: 'Bring a friend free next week',
        body: `Hi ${m.name.split(' ')[0]},\n\nNext week is Bring a Friend week. Any friend can join you in class for free.`,
        status: failed ? 'failed' : opened ? (chance(0.3) ? 'clicked' : 'opened') : 'delivered', error: failed ? 'Mailbox unavailable' : null,
        sentAt: ago(18), deliveredAt: failed ? null : ago(18), openedAt: opened && !failed ? ago(17.5) : null, createdAt: ago(18),
      }
    }),
  })
  await prisma.campaign.update({ where: { id: campaign.id }, data: { recipientCount: recipients.length } })

  const pastDue = members.filter((m) => m.segment === 'past_due')
  await prisma.notification.createMany({
    data: [
      ...pastDue.slice(0, 2).map((m) => ({ ownerId, type: 'payment_failed', title: `Payment failed for ${m.name}`, body: 'Card declined on the latest membership invoice.', href: `/members/${m.id}?tab=billing`, createdAt: ago(rand() * 3) })),
      { ownerId, type: 'low_stock', title: 'Gym Towel is running low', body: 'Fewer than 6 left in stock.', href: '/pos/products', createdAt: ago(1.2) },
      { ownerId, type: 'lead', title: 'New lead from the website', body: 'Assigned to Bianca Sandoval.', href: '/leads', createdAt: ago(0.4), readAt: ago(0.3) },
    ],
  })
  await prisma.auditLog.createMany({
    data: [
      { ownerId, action: 'membership.change_plan', description: 'Changed membership from 3x per Week to Unlimited Monthly', actorType: 'staff', actorId: staff.admin.id, actorEmail: 'renee@ironharbor.test', entityType: 'membership', createdAt: ago(6) },
      { ownerId, action: 'payment.refund', description: 'Refunded $50: Goodwill credit for a cancelled class week', actorType: 'staff', actorId: staff.admin.id, actorEmail: 'renee@ironharbor.test', entityType: 'transaction', createdAt: ago(9) },
      { ownerId, action: 'session.cancel', description: 'Cancelled Boxing: Coach is unwell', actorType: 'staff', actorId: staff.dana.id, actorEmail: 'dana@ironharbor.test', entityType: 'classSession', createdAt: ago(13) },
      { ownerId, action: 'staff_create', description: 'Added Bianca Sandoval as Sales', actorType: 'owner', actorId: ownerId, actorEmail: OWNER_EMAIL, entityType: 'staff', createdAt: ago(150) },
    ],
  })

  const counts = {
    members: members.length, memberships: memberships.length, invoices: invoices.length, transactions: transactions.length,
    sessions: await prisma.classSession.count({ where: { ownerId } }), bookings: bookings.length + futureBookings.length, checkins: checkins.length,
    leads: leadStages.reduce((s, [, n]) => s + n, 0), products: products.length, orders: orders.length,
  }
  console.log('Done.', counts)
  console.log(`
Sign in at http://localhost:3000/login
  Owner:  ${OWNER_EMAIL} / ${PASSWORD}

Staff sign in at http://localhost:3000/staff-login with gym code ${GYM_CODE} and password ${PASSWORD}:
${staffDefs.map((s) => `  ${s.role.padEnd(11)} ${s.name.split(' ')[0].toLowerCase()}@ironharbor.test`).join('\n')}

Kiosk PIN: 1234`)
  await prisma.$disconnect()
}

main().catch((error) => {
  console.error('Seed failed:', error)
  process.exit(1)
})
