// Appointments: availability engine, booking, credits, payment, cancellation,
// rescheduling, attendance, and the double-booking guarantee.

import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { addDaysToDate, zonedParts, zonedToUtc } from '@/lib/dates'
import { setPaymentProviderForTests, type ChargeRequest, type ChargeResult, type PaymentProvider } from '@/lib/payments/provider'
import { bookAppointment, cancelAppointment, getSlots, markAppointment, rescheduleAppointment, sendAppointmentReminders, settleAppointmentPayment } from '@/lib/services/appointments'
import { sellMembership } from '@/lib/services/memberships'
import { recordPayment } from '@/lib/services/payments'
import { DAY, HOUR, createGym, createMember, createPlan, createSession, destroyGym, tx } from './helpers'

const TZ = 'America/New_York'
let ownerId: string
let coach: { id: string; name: string }
const today = zonedParts(new Date(), TZ).date
/** A weekday-agnostic date a few days out, inside every booking window used here. */
const day = (offset = 3) => addDaysToDate(today, offset)
const at = (date: string, time: string) => zonedToUtc(date, time, TZ)
const times = (slots: { startsAt: Date }[]) => slots.map((s) => `${String(zonedParts(s.startsAt, TZ).hour).padStart(2, '0')}:${String(zonedParts(s.startsAt, TZ).minute).padStart(2, '0')}`)

async function createStaff(owner = ownerId, name = `Coach ${randomUUID().slice(0, 4)}`, hours: [number, number] | null = [9 * 60, 17 * 60]) {
  const staff = await prisma.staff.create({ data: { ownerId: owner, name, email: `${randomUUID()}@test.local`, password: 'x', role: 'coach', isCoach: true } })
  if (hours) await prisma.staffAvailability.createMany({ data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ ownerId: owner, staffId: staff.id, weekday, startMinute: hours[0], endMinute: hours[1], kind: 'work' })) })
  return staff
}
async function createType(data: Record<string, unknown> = {}, staffIds: string[] = [coach.id], owner = ownerId) {
  return prisma.appointmentType.create({
    data: { ownerId: owner, name: 'Personal Training', durationMin: 60, paymentMode: 'included', minNoticeMinutes: 0, maxAdvanceDays: 60, slotIntervalMin: 30, cancelWindowHours: 12, ...data, staff: { create: staffIds.map((staffId) => ({ staffId, ownerId: owner })) } },
  })
}
const book = (typeId: string, memberId: string, startsAt: Date, extra: Partial<Parameters<typeof bookAppointment>[0]> = {}) =>
  bookAppointment({ ownerId, typeId, memberId, staffId: coach.id, startsAt, source: 'member', ...extra })
const claims = (appointmentId: string) => prisma.timeClaim.count({ where: { appointmentId } })

beforeAll(async () => {
  ownerId = await createGym({ timezone: TZ })
  coach = await createStaff(ownerId, 'Coach Kim')
})
afterAll(async () => { setPaymentProviderForTests(null); await destroyGym(ownerId) })

describe('availability engine', () => {
  it('offers only times that fit inside working hours', async () => {
    const type = await createType()
    const slots = await getSlots({ ownerId, typeId: type.id, date: day() })
    expect(times(slots)[0]).toBe('09:00')
    // A 60-minute session cannot start after 16:00 in a day that ends at 17:00.
    expect(times(slots).at(-1)).toBe('16:00')
    expect(slots).toHaveLength(15)
    expect(slots.every((s) => s.staff.length === 1 && s.staff[0].id === coach.id)).toBe(true)
    expect(slots[0].startsAt.toISOString()).toBe(at(day(), '09:00').toISOString())
  })

  it('respects the slot interval and the appointment duration', async () => {
    const short = await createType({ durationMin: 30, slotIntervalMin: 15 })
    const slots = await getSlots({ ownerId, typeId: short.id, date: day() })
    expect(times(slots).slice(0, 3)).toEqual(['09:00', '09:15', '09:30'])
    expect(times(slots).at(-1)).toBe('16:30')
  })

  it('removes breaks and time off', async () => {
    const staff = await createStaff()
    const type = await createType({}, [staff.id])
    await prisma.staffAvailability.createMany({ data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ ownerId, staffId: staff.id, weekday, startMinute: 12 * 60, endMinute: 13 * 60, kind: 'break' })) })
    const withBreak = times(await getSlots({ ownerId, typeId: type.id, date: day() }))
    // 11:30 would run into the break; 12:00 and 12:30 are in it.
    expect(withBreak).not.toContain('11:30')
    expect(withBreak).not.toContain('12:00')
    expect(withBreak).not.toContain('12:30')
    expect(withBreak).toContain('11:00')
    expect(withBreak).toContain('13:00')

    await prisma.staffTimeOff.create({ data: { ownerId, staffId: staff.id, startsAt: at(day(), '13:00'), endsAt: at(day(), '15:00'), kind: 'personal' } })
    const withOff = times(await getSlots({ ownerId, typeId: type.id, date: day() }))
    expect(withOff).not.toContain('12:30')
    expect(withOff).not.toContain('13:00')
    expect(withOff).not.toContain('14:30')
    expect(withOff).toContain('15:00')

    await prisma.staffTimeOff.create({ data: { ownerId, staffId: staff.id, startsAt: at(day(5), '00:00'), endsAt: at(day(7), '00:00'), kind: 'vacation' } })
    expect(await getSlots({ ownerId, typeId: type.id, date: day(5) })).toEqual([])
    expect(await getSlots({ ownerId, typeId: type.id, date: day(6) })).toEqual([])
    expect((await getSlots({ ownerId, typeId: type.id, date: day(7) })).length).toBeGreaterThan(0)
  })

  it('removes times taken by other appointments and by classes the coach teaches', async () => {
    const staff = await createStaff()
    const type = await createType({}, [staff.id])
    const member = await createMember(ownerId)
    await bookAppointment({ ownerId, typeId: type.id, memberId: member.id, staffId: staff.id, startsAt: at(day(), '10:00'), source: 'staff' })
    await createSession(ownerId, { coachId: staff.id, startsAt: at(day(), '14:00'), endsAt: at(day(), '15:00') })
    const open = times(await getSlots({ ownerId, typeId: type.id, date: day() }))
    for (const blocked of ['09:30', '10:00', '10:30', '13:30', '14:00', '14:30']) expect(open, blocked).not.toContain(blocked)
    for (const free of ['09:00', '11:00', '13:00', '15:00']) expect(open, free).toContain(free)
    // A cancelled class no longer blocks.
    await prisma.classSession.updateMany({ where: { coachId: staff.id }, data: { status: 'cancelled' } })
    expect(times(await getSlots({ ownerId, typeId: type.id, date: day() }))).toContain('14:00')
  })

  it('applies minimum notice and the advance limit to members, and lets staff override them', async () => {
    const type = await createType({ minNoticeMinutes: 24 * 60, maxAdvanceDays: 7 })
    expect(await getSlots({ ownerId, typeId: type.id, date: today })).toEqual([])
    expect(await getSlots({ ownerId, typeId: type.id, date: day(20) })).toEqual([])
    expect((await getSlots({ ownerId, typeId: type.id, date: day(3) })).length).toBeGreaterThan(0)
    expect((await getSlots({ ownerId, typeId: type.id, date: day(20), ignoreBookingWindow: true })).length).toBeGreaterThan(0)
    // Never in the past, whoever asks.
    expect(await getSlots({ ownerId, typeId: type.id, date: addDaysToDate(today, -1), ignoreBookingWindow: true })).toEqual([])
  })

  it('filters by location and only lists staff who offer the type', async () => {
    const downtown = await prisma.location.create({ data: { ownerId, name: 'Downtown' } })
    const uptown = await prisma.location.create({ data: { ownerId, name: 'Uptown' } })
    const a = await createStaff(ownerId, 'Ana', null)
    const b = await createStaff(ownerId, 'Ben', null)
    const notOffering = await createStaff(ownerId, 'Cy')
    await prisma.staffAvailability.createMany({ data: [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => [
      { ownerId, staffId: a.id, weekday, startMinute: 540, endMinute: 720, kind: 'work', locationId: downtown.id },
      { ownerId, staffId: b.id, weekday, startMinute: 600, endMinute: 780, kind: 'work', locationId: uptown.id },
    ]) })
    const type = await createType({}, [a.id, b.id])
    const all = await getSlots({ ownerId, typeId: type.id, date: day() })
    expect(all.find((s) => times([s])[0] === '09:00')!.staff.map((p) => p.name)).toEqual(['Ana'])
    expect(all.find((s) => times([s])[0] === '10:00')!.staff.map((p) => p.name).sort()).toEqual(['Ana', 'Ben'])
    expect(all.flatMap((s) => s.staff.map((p) => p.id))).not.toContain(notOffering.id)
    const up = await getSlots({ ownerId, typeId: type.id, date: day(), locationId: uptown.id })
    expect(up.every((s) => s.staff.every((p) => p.name === 'Ben' && p.locationId === uptown.id))).toBe(true)
    expect(times(up)[0]).toBe('10:00')
    expect(times(await getSlots({ ownerId, typeId: type.id, date: day(), staffId: a.id })).at(-1)).toBe('11:00')
    // A type limited to one location is not offered by a coach working elsewhere.
    const limited = await createType({ locationIds: [uptown.id] }, [a.id, b.id])
    expect((await getSlots({ ownerId, typeId: limited.id, date: day() })).every((s) => s.staff.every((p) => p.name === 'Ben'))).toBe(true)
  })

  it("hides times that clash with the member's own classes and appointments", async () => {
    const type = await createType()
    const other = await createStaff()
    const otherType = await createType({ name: 'Assessment' }, [other.id])
    const member = await createMember(ownerId)
    const plan = await createPlan(ownerId)
    await tx((db) => sellMembership(db, { ownerId, memberId: member.id, planId: plan.id, paymentMethod: 'cash' }))
    const session = await createSession(ownerId, { startsAt: at(day(4), '11:00'), endsAt: at(day(4), '12:00') })
    await prisma.booking.create({ data: { ownerId, sessionId: session.id, memberId: member.id, status: 'booked' } })
    await bookAppointment({ ownerId, typeId: otherType.id, memberId: member.id, staffId: other.id, startsAt: at(day(4), '14:00'), source: 'staff' })
    const mine = times(await getSlots({ ownerId, typeId: type.id, date: day(4), memberId: member.id }))
    for (const blocked of ['10:30', '11:00', '11:30', '13:30', '14:00', '14:30']) expect(mine, blocked).not.toContain(blocked)
    // Without the member in the picture the coach is free at those times.
    expect(times(await getSlots({ ownerId, typeId: type.id, date: day(4) }))).toContain('11:00')
  })

  it('keeps wall-clock hours across a daylight-saving change', async () => {
    const staff = await createStaff()
    const type = await createType({ maxAdvanceDays: 365 }, [staff.id])
    // US clocks go back on the first Sunday of November: 9:00 local is a different UTC hour either side.
    const year = new Date().getUTCFullYear() + (new Date().getUTCMonth() >= 9 ? 1 : 0)
    const firstNov = new Date(Date.UTC(year, 10, 1))
    const sunday = 1 + ((7 - firstNov.getUTCDay()) % 7)
    const before = `${year}-10-${String(31 - ((firstNov.getUTCDay() + 6) % 7) - 1).padStart(2, '0')}`
    const after = `${year}-11-${String(sunday + 1).padStart(2, '0')}`
    const a = await getSlots({ ownerId, typeId: type.id, date: before, ignoreBookingWindow: true })
    const b = await getSlots({ ownerId, typeId: type.id, date: after, ignoreBookingWindow: true })
    expect(times(a)[0]).toBe('09:00')
    expect(times(b)[0]).toBe('09:00')
    expect(a[0].startsAt.getUTCHours()).toBe(13)
    expect(b[0].startsAt.getUTCHours()).toBe(14)
  })
})

describe('booking', () => {
  it('books a valid slot, reserves the time and tells the member and the coach', async () => {
    const type = await createType()
    const member = await createMember(ownerId)
    const { appointment } = await book(type.id, member.id, at(day(), '09:00'))
    expect(appointment).toMatchObject({ status: 'booked', staffId: coach.id, memberId: member.id, paymentMode: 'included', source: 'member' })
    expect(appointment.endsAt.getTime() - appointment.startsAt.getTime()).toBe(HOUR)
    // 12 five-minute slots each for the coach and the member.
    expect(await claims(appointment.id)).toBe(24)
    const note = await prisma.memberNotification.findFirst({ where: { memberId: member.id, type: 'appointment_booked' } })
    expect(note).toMatchObject({ category: 'appointment', title: 'Booked Personal Training with Coach Kim' })
    expect(await prisma.notification.count({ where: { ownerId, staffId: coach.id, type: 'appointment' } })).toBeGreaterThan(0)
    expect(times(await getSlots({ ownerId, typeId: type.id, date: day() }))).not.toContain('09:00')
  })

  it('refuses times outside the rules for members, and lets staff override everything except a clash', async () => {
    const staff = await createStaff()
    const type = await createType({ minNoticeMinutes: 48 * 60 }, [staff.id])
    const member = await createMember(ownerId)
    const go = (startsAt: Date, extra = {}) => bookAppointment({ ownerId, typeId: type.id, memberId: member.id, staffId: staff.id, startsAt, source: 'member', ...extra })
    await expect(go(at(day(4), '07:00'))).rejects.toMatchObject({ code: 'slot_unavailable' })          // before working hours
    await expect(go(at(day(4), '16:30'))).rejects.toMatchObject({ code: 'slot_unavailable' })          // runs past closing
    await expect(go(at(day(1), '10:00'))).rejects.toMatchObject({ code: 'slot_unavailable' })          // inside minimum notice
    await expect(go(new Date(at(day(4), '10:00').getTime() + 60_000))).rejects.toMatchObject({ code: 'off_grid' })
    await expect(go(at(day(4), '10:15'))).rejects.toMatchObject({ code: 'slot_unavailable' })          // not on the 30-minute interval
    // A member cannot grant themselves the override.
    await expect(go(at(day(1), '10:00'), { override: true })).rejects.toMatchObject({ code: 'slot_unavailable' })

    const early = await go(at(day(1), '07:00'), { source: 'staff', override: true })
    expect(early.appointment.status).toBe('booked')
    const second = await createMember(ownerId)
    await expect(bookAppointment({ ownerId, typeId: type.id, memberId: second.id, staffId: staff.id, startsAt: at(day(1), '07:30'), source: 'staff', override: true })).rejects.toMatchObject({ status: 409, code: 'slot_taken' })
    const session = await createSession(ownerId, { coachId: staff.id, startsAt: at(day(4), '12:00'), endsAt: at(day(4), '13:00') })
    await expect(bookAppointment({ ownerId, typeId: type.id, memberId: second.id, staffId: staff.id, startsAt: at(day(4), '12:30'), source: 'staff', override: true })).rejects.toMatchObject({ status: 409, code: 'staff_teaching' })
    expect(session.id).toBeTruthy()
  })

  it('refuses a coach who does not offer the type, an inactive type, and frozen or archived members', async () => {
    const type = await createType()
    const stranger = await createStaff()
    const member = await createMember(ownerId)
    await expect(bookAppointment({ ownerId, typeId: type.id, memberId: member.id, staffId: stranger.id, startsAt: at(day(), '11:00'), source: 'staff' })).rejects.toMatchObject({ code: 'staff_not_offering' })
    const off = await createType({ isActive: false })
    await expect(book(off.id, member.id, at(day(), '11:00'))).rejects.toMatchObject({ status: 404 })
    const deskOnly = await createType({ memberBookable: false })
    await expect(book(deskOnly.id, member.id, at(day(), '11:00'))).rejects.toMatchObject({ code: 'not_bookable_online' })
    const frozen = await createMember(ownerId, { status: 'frozen' })
    await expect(book(type.id, frozen.id, at(day(), '11:00'))).rejects.toMatchObject({ code: 'member_frozen' })
    const archived = await createMember(ownerId, { archivedAt: new Date() })
    await expect(book(type.id, archived.id, at(day(), '11:00'))).rejects.toMatchObject({ code: 'member_archived' })
  })

  it('picks a free coach for "any available"', async () => {
    const a = await createStaff(ownerId, 'Any A')
    const b = await createStaff(ownerId, 'Any B')
    const type = await createType({}, [a.id, b.id])
    const [m1, m2, m3] = await Promise.all([createMember(ownerId), createMember(ownerId), createMember(ownerId)])
    const first = await bookAppointment({ ownerId, typeId: type.id, memberId: m1.id, staffId: null, startsAt: at(day(), '10:00'), source: 'member' })
    const second = await bookAppointment({ ownerId, typeId: type.id, memberId: m2.id, staffId: null, startsAt: at(day(), '10:00'), source: 'member' })
    expect(new Set([first.staff.id, second.staff.id])).toEqual(new Set([a.id, b.id]))
    await expect(bookAppointment({ ownerId, typeId: type.id, memberId: m3.id, staffId: null, startsAt: at(day(), '10:00'), source: 'member' })).rejects.toMatchObject({ code: 'slot_unavailable' })
  })
})

describe('packages and credits', () => {
  async function withPackage(credits = 10, planData: Record<string, unknown> = {}) {
    const plan = await createPlan(ownerId, { name: `${credits} PT Sessions`, type: 'pt_package', credits, priceCents: 50000, billingInterval: 'once', ...planData })
    const member = await createMember(ownerId)
    const sale = await tx((db) => sellMembership(db, { ownerId, memberId: member.id, planId: plan.id, paymentMethod: 'cash', collectNow: true }))
    return { plan, member, membershipId: sale.membership.id }
  }
  const remaining = async (id: string) => (await prisma.membership.findUniqueOrThrow({ where: { id } })).creditsRemaining

  it('takes one session per appointment: 10 becomes 9', async () => {
    const { member, membershipId } = await withPackage(10)
    const type = await createType({ paymentMode: 'credit' })
    expect(await remaining(membershipId)).toBe(10)
    const result = await book(type.id, member.id, at(day(6), '09:00'))
    expect(result.creditsRemaining).toBe(9)
    expect(await remaining(membershipId)).toBe(9)
    expect(result.appointment).toMatchObject({ paymentMode: 'credit', creditsUsed: 1, membershipId })
    expect((await prisma.memberNotification.findFirstOrThrow({ where: { memberId: member.id, type: 'appointment_booked' } })).body).toContain('9 sessions remaining')
  })

  it('refuses a member with no package, the wrong package, or none left', async () => {
    const type = await createType({ paymentMode: 'credit' })
    const none = await createMember(ownerId)
    await expect(book(type.id, none.id, at(day(6), '10:00'))).rejects.toMatchObject({ code: 'no_package' })
    // A class pack is not a PT package.
    const classPack = await createPlan(ownerId, { type: 'class_pack', credits: 5, billingInterval: 'once' })
    await tx((db) => sellMembership(db, { ownerId, memberId: none.id, planId: classPack.id, paymentMethod: 'cash' }))
    await expect(book(type.id, none.id, at(day(6), '10:00'))).rejects.toMatchObject({ code: 'no_package' })

    const { member, membershipId } = await withPackage(1)
    await book(type.id, member.id, at(day(6), '11:00'))
    expect(await remaining(membershipId)).toBe(0)
    await expect(book(type.id, member.id, at(day(6), '13:00'))).rejects.toMatchObject({ code: 'insufficient_credits' })
    expect(await prisma.appointment.count({ where: { memberId: member.id } })).toBe(1)

    const { plan: required, member: holder } = await withPackage(3)
    const { member: otherHolder } = await withPackage(3)
    const restricted = await createType({ paymentMode: 'credit', requiredPlanIds: [required.id] })
    await expect(book(restricted.id, otherHolder.id, at(day(6), '14:00'))).rejects.toMatchObject({ code: 'no_package' })
    expect((await book(restricted.id, holder.id, at(day(6), '14:00'))).creditsRemaining).toBe(2)
  })

  it('will not use a package that has expired by the appointment date', async () => {
    const { member, membershipId } = await withPackage(5, { expiresAfterDays: 2 })
    const type = await createType({ paymentMode: 'credit' })
    await expect(book(type.id, member.id, at(day(6), '15:00'))).rejects.toMatchObject({ code: 'no_package' })
    expect(await remaining(membershipId)).toBe(5)
  })

  it('requires the right membership for an included appointment', async () => {
    const premium = await createPlan(ownerId, { name: 'Premium' })
    const type = await createType({ paymentMode: 'included', requiredPlanIds: [premium.id], name: 'Monthly Check-in' })
    const outsider = await createMember(ownerId)
    await expect(book(type.id, outsider.id, at(day(6), '16:00'))).rejects.toMatchObject({ code: 'membership_required' })
    await tx((db) => sellMembership(db, { ownerId, memberId: outsider.id, planId: premium.id, paymentMethod: 'cash' }))
    const ok = await book(type.id, outsider.id, at(day(6), '16:00'))
    expect(ok.appointment).toMatchObject({ creditsUsed: 0, invoiceId: null })
  })

  it('never lets two simultaneous bookings spend the same last credit', async () => {
    const { member, membershipId } = await withPackage(1)
    const a = await createStaff()
    const b = await createStaff()
    const type = await createType({ paymentMode: 'credit' }, [a.id, b.id])
    const results = await Promise.allSettled([
      bookAppointment({ ownerId, typeId: type.id, memberId: member.id, staffId: a.id, startsAt: at(day(8), '09:00'), source: 'staff' }),
      bookAppointment({ ownerId, typeId: type.id, memberId: member.id, staffId: b.id, startsAt: at(day(8), '11:00'), source: 'staff' }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await remaining(membershipId)).toBe(0)
    expect(await prisma.appointment.count({ where: { memberId: member.id, status: 'booked' } })).toBe(1)
  })
})

describe('paid appointments', () => {
  class Fake implements PaymentProvider {
    name = 'stripe'
    canAutoCharge = true
    charges: ChargeRequest[] = []
    refunds: { reference: string; amountCents: number }[] = []
    next: 'succeeded' | 'failed' = 'succeeded'
    async charge(request: ChargeRequest): Promise<ChargeResult> {
      this.charges.push(request)
      const reference = `pi_${randomUUID()}`
      return this.next === 'failed' ? { status: 'failed', reference, failureReason: 'Your card was declined.' } : { status: 'succeeded', reference }
    }
    async refund(input: { reference: string; amountCents: number }) {
      this.refunds.push(input)
      return { status: 'succeeded' as const, reference: `re_${randomUUID()}` }
    }
  }
  let processor: Fake
  beforeEach(() => { processor = new Fake(); setPaymentProviderForTests(processor) })
  afterEach(() => setPaymentProviderForTests(null))

  async function payer() {
    const member = await createMember(ownerId, { connectCustomerId: `cus_${randomUUID()}` })
    await prisma.paymentMethod.create({ data: { ownerId, memberId: member.id, providerId: `pm_${randomUUID()}`, type: 'card', brand: 'visa', last4: '4242', isDefault: true } })
    return member
  }

  it('charges the saved card through the existing payment system and refunds an early cancellation', async () => {
    const type = await createType({ paymentMode: 'paid', priceCents: 8000, taxRateBps: 1000, name: 'Nutrition Consultation' })
    const member = await payer()
    const { appointment } = await book(type.id, member.id, at(day(9), '09:00'))
    expect(appointment).toMatchObject({ paymentMode: 'paid', priceCents: 8000 })
    const payment = await settleAppointmentPayment(ownerId, appointment.id, 'member')
    expect(payment.status).toBe('succeeded')
    expect(processor.charges).toHaveLength(1)
    expect(processor.charges[0].amountCents).toBe(8800)
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: appointment.invoiceId! }, include: { items: true, transactions: true } })
    expect(invoice).toMatchObject({ status: 'paid', totalCents: 8800, taxCents: 800, memberId: member.id })
    expect(invoice.items[0]).toMatchObject({ type: 'appointment' })
    expect(invoice.transactions).toHaveLength(1)

    const cancelled = await cancelAppointment({ ownerId, appointmentId: appointment.id, by: 'member', memberId: member.id })
    expect(cancelled).toMatchObject({ late: false, refunded: true })
    expect(processor.refunds).toEqual([expect.objectContaining({ amountCents: 8800 })])
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).refundedCents).toBe(8800)
  })

  it('releases the slot when a member\'s payment is declined, and charges nothing', async () => {
    const type = await createType({ paymentMode: 'paid', priceCents: 5000 })
    const member = await payer()
    processor.next = 'failed'
    const { appointment } = await book(type.id, member.id, at(day(9), '11:00'))
    await expect(settleAppointmentPayment(ownerId, appointment.id, 'member')).rejects.toMatchObject({ status: 402, code: 'payment_failed' })
    const after = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })
    expect(after.status).toBe('cancelled')
    expect(await claims(appointment.id)).toBe(0)
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: appointment.invoiceId! } })).status).toBe('void')
    expect(times(await getSlots({ ownerId, typeId: type.id, date: day(9) }))).toContain('11:00')
  })

  it('leaves the invoice open for the desk when staff book and no card is on file, and keeps a late cancellation fee', async () => {
    const type = await createType({ paymentMode: 'paid', priceCents: 6000, cancelWindowHours: 24 })
    const member = await createMember(ownerId)
    const { appointment } = await bookAppointment({ ownerId, typeId: type.id, memberId: member.id, staffId: coach.id, startsAt: new Date(Math.ceil((Date.now() + 3 * HOUR) / (30 * 60_000)) * 30 * 60_000), source: 'staff', override: true })
    const payment = await settleAppointmentPayment(ownerId, appointment.id, 'staff')
    expect(payment.status).toBe('due')
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: appointment.invoiceId! } })).status).toBe('open')
    await tx((db) => recordPayment(db, { ownerId, invoiceId: appointment.invoiceId!, method: 'cash' }))
    // Inside the 24-hour window: late, so the payment is kept.
    const late = await cancelAppointment({ ownerId, appointmentId: appointment.id, by: 'member', memberId: member.id })
    expect(late).toMatchObject({ late: true, refunded: false })
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: appointment.invoiceId! } })).refundedCents).toBe(0)
    expect(late.appointment.status).toBe('late_cancelled')
  })
})

describe('cancellation policy', () => {
  async function creditSetup(cancelWindowHours: number) {
    const plan = await createPlan(ownerId, { type: 'pt_package', credits: 5, billingInterval: 'once' })
    const member = await createMember(ownerId)
    const sale = await tx((db) => sellMembership(db, { ownerId, memberId: member.id, planId: plan.id, paymentMethod: 'cash', collectNow: true }))
    const staff = await createStaff(ownerId, undefined, [0, 1440])
    const type = await createType({ paymentMode: 'credit', cancelWindowHours }, [staff.id])
    const credits = async () => (await prisma.membership.findUniqueOrThrow({ where: { id: sale.membership.id } })).creditsRemaining
    return { member, staff, type, credits }
  }
  const soon = (hours: number) => new Date(Math.ceil((Date.now() + hours * HOUR) / (30 * 60_000)) * 30 * 60_000)
  /** The next five-minute mark, so it is always inside the 30 minutes in which attendance can be recorded. */
  const imminent = () => new Date(Math.ceil((Date.now() + 2 * 60_000) / 300_000) * 300_000)

  it('returns the session when cancelled before the window, and frees the time', async () => {
    const { member, staff, type, credits } = await creditSetup(12)
    const { appointment } = await bookAppointment({ ownerId, typeId: type.id, memberId: member.id, staffId: staff.id, startsAt: soon(30), source: 'member' })
    expect(await credits()).toBe(4)
    const result = await cancelAppointment({ ownerId, appointmentId: appointment.id, by: 'member', memberId: member.id, reason: 'Plans changed' })
    expect(result).toMatchObject({ late: false, creditsReturned: true })
    expect(result.appointment).toMatchObject({ status: 'cancelled', cancelledBy: 'member', cancelReason: 'Plans changed' })
    expect(await credits()).toBe(5)
    expect(await claims(appointment.id)).toBe(0)
    expect((await prisma.memberNotification.findFirstOrThrow({ where: { memberId: member.id, type: 'appointment_cancelled' } })).body).toContain('session returned')
    // The same time can be booked again.
    const again = await bookAppointment({ ownerId, typeId: type.id, memberId: member.id, staffId: staff.id, startsAt: appointment.startsAt, source: 'member' })
    expect(again.appointment.status).toBe('booked')
    await expect(cancelAppointment({ ownerId, appointmentId: appointment.id, by: 'member', memberId: member.id })).rejects.toMatchObject({ code: 'not_cancellable' })
  })

  it('keeps the session on a late cancellation, uses each type\'s own window, and lets staff waive it', async () => {
    const { member, staff, type, credits } = await creditSetup(12)
    const a = await bookAppointment({ ownerId, typeId: type.id, memberId: member.id, staffId: staff.id, startsAt: soon(5), source: 'member' })
    const late = await cancelAppointment({ ownerId, appointmentId: a.appointment.id, by: 'member', memberId: member.id })
    expect(late).toMatchObject({ late: true, creditsReturned: false })
    expect(late.appointment.status).toBe('late_cancelled')
    expect(await credits()).toBe(4)
    expect(await claims(a.appointment.id)).toBe(0)

    // The same five hours' notice is on time for a type with a 2-hour window.
    const lenient = await createType({ paymentMode: 'credit', cancelWindowHours: 2, name: 'Lenient' }, [staff.id])
    const b = await bookAppointment({ ownerId, typeId: lenient.id, memberId: member.id, staffId: staff.id, startsAt: soon(5), source: 'member' })
    expect(await credits()).toBe(3)
    expect(await cancelAppointment({ ownerId, appointmentId: b.appointment.id, by: 'member', memberId: member.id })).toMatchObject({ late: false, creditsReturned: true })
    expect(await credits()).toBe(4)

    // Changing the type later does not rewrite the terms of an existing booking.
    const c = await bookAppointment({ ownerId, typeId: lenient.id, memberId: member.id, staffId: staff.id, startsAt: soon(6), source: 'member' })
    await prisma.appointmentType.update({ where: { id: lenient.id }, data: { cancelWindowHours: 48 } })
    expect((await cancelAppointment({ ownerId, appointmentId: c.appointment.id, by: 'member', memberId: member.id })).late).toBe(false)

    const d = await bookAppointment({ ownerId, typeId: type.id, memberId: member.id, staffId: staff.id, startsAt: soon(4), source: 'member' })
    const waived = await cancelAppointment({ ownerId, appointmentId: d.appointment.id, by: 'staff', waive: true })
    expect(waived).toMatchObject({ late: false, creditsReturned: true })
    // A member cannot waive their own late fee.
    const e = await bookAppointment({ ownerId, typeId: type.id, memberId: member.id, staffId: staff.id, startsAt: soon(4), source: 'member' })
    expect((await cancelAppointment({ ownerId, appointmentId: e.appointment.id, by: 'member', memberId: member.id, waive: true })).late).toBe(true)
  })

  it('keeps the session for a no-show and records attendance as a visit', async () => {
    const { member, staff, type, credits } = await creditSetup(12)
    const noShow = await bookAppointment({ ownerId, typeId: type.id, memberId: member.id, staffId: staff.id, startsAt: imminent(), source: 'staff', override: true })
    const marked = await markAppointment({ ownerId, appointmentId: noShow.appointment.id, outcome: 'no_show' })
    expect(marked.status).toBe('no_show')
    expect(await credits()).toBe(4)
    expect(await prisma.memberNotification.count({ where: { memberId: member.id, type: 'appointment_no_show' } })).toBe(1)
    await expect(markAppointment({ ownerId, appointmentId: noShow.appointment.id, outcome: 'completed' })).rejects.toMatchObject({ code: 'already_recorded' })

    const visitsBefore = await prisma.checkin.count({ where: { memberId: member.id } })
    const came = await bookAppointment({ ownerId, typeId: type.id, memberId: member.id, staffId: staff.id, startsAt: imminent(), source: 'staff', override: true })
    const done = await markAppointment({ ownerId, appointmentId: came.appointment.id, outcome: 'completed' })
    expect(done.status).toBe('completed')
    expect(done.completedAt).not.toBeNull()
    expect(await credits()).toBe(3)
    expect(await prisma.checkin.count({ where: { memberId: member.id, type: 'personal_training' } })).toBe(visitsBefore + 1)
    // Attendance cannot be recorded for something days away.
    const future = await bookAppointment({ ownerId, typeId: type.id, memberId: member.id, staffId: staff.id, startsAt: soon(50), source: 'staff' })
    await expect(markAppointment({ ownerId, appointmentId: future.appointment.id, outcome: 'completed' })).rejects.toMatchObject({ code: 'too_early' })
  })
})

describe('rescheduling', () => {
  it('moves the appointment, keeps the same credit, frees the old time and claims the new one', async () => {
    const plan = await createPlan(ownerId, { type: 'pt_package', credits: 3, billingInterval: 'once' })
    const member = await createMember(ownerId)
    const sale = await tx((db) => sellMembership(db, { ownerId, memberId: member.id, planId: plan.id, paymentMethod: 'cash', collectNow: true }))
    const staff = await createStaff()
    const type = await createType({ paymentMode: 'credit' }, [staff.id])
    const credits = async () => (await prisma.membership.findUniqueOrThrow({ where: { id: sale.membership.id } })).creditsRemaining
    const { appointment } = await bookAppointment({ ownerId, typeId: type.id, memberId: member.id, staffId: staff.id, startsAt: at(day(10), '09:00'), source: 'member' })
    expect(await credits()).toBe(2)

    const moved = await rescheduleAppointment({ ownerId, appointmentId: appointment.id, startsAt: at(day(11), '14:00'), by: 'member', memberId: member.id })
    expect(moved.appointment.id).toBe(appointment.id)
    expect(moved.appointment).toMatchObject({ status: 'booked', rescheduleCount: 1, creditsUsed: 1 })
    expect(moved.appointment.startsAt.toISOString()).toBe(at(day(11), '14:00').toISOString())
    expect(moved.appointment.previousStartsAt?.toISOString()).toBe(at(day(10), '09:00').toISOString())
    // Not charged twice, not refunded.
    expect(await credits()).toBe(2)
    expect(await claims(appointment.id)).toBe(24)
    expect(times(await getSlots({ ownerId, typeId: type.id, date: day(10) }))).toContain('09:00')
    expect(times(await getSlots({ ownerId, typeId: type.id, date: day(11) }))).not.toContain('14:00')
    expect(await prisma.memberNotification.count({ where: { memberId: member.id, type: 'appointment_rescheduled' } })).toBe(1)
    expect(await prisma.notification.count({ where: { ownerId, staffId: staff.id, title: { startsWith: 'Appointment moved' } } })).toBe(1)

    // An appointment may move to a time that overlaps its own old one.
    const nudged = await rescheduleAppointment({ ownerId, appointmentId: appointment.id, startsAt: at(day(11), '14:30'), by: 'member', memberId: member.id })
    expect(nudged.appointment.rescheduleCount).toBe(2)
    expect(await credits()).toBe(2)
  })

  it('refuses an unavailable slot, a taken slot, and a late change by the member', async () => {
    const staff = await createStaff(ownerId, undefined, [0, 1440])
    const type = await createType({ cancelWindowHours: 12 }, [staff.id])
    const [m1, m2] = await Promise.all([createMember(ownerId), createMember(ownerId)])
    const mine = await bookAppointment({ ownerId, typeId: type.id, memberId: m1.id, staffId: staff.id, startsAt: at(day(12), '09:00'), source: 'member' })
    const theirs = await bookAppointment({ ownerId, typeId: type.id, memberId: m2.id, staffId: staff.id, startsAt: at(day(12), '11:00'), source: 'member' })
    await expect(rescheduleAppointment({ ownerId, appointmentId: mine.appointment.id, startsAt: at(day(12), '11:00'), by: 'member', memberId: m1.id })).rejects.toMatchObject({ status: 409 })
    await expect(rescheduleAppointment({ ownerId, appointmentId: mine.appointment.id, startsAt: at(day(12), '10:30'), by: 'member', memberId: m1.id })).rejects.toMatchObject({ status: 409 })
    await expect(rescheduleAppointment({ ownerId, appointmentId: mine.appointment.id, startsAt: at(day(200), '10:00'), by: 'member', memberId: m1.id })).rejects.toMatchObject({ code: 'slot_unavailable' })
    await expect(rescheduleAppointment({ ownerId, appointmentId: mine.appointment.id, startsAt: at(day(12), '09:00'), by: 'member', memberId: m1.id })).rejects.toMatchObject({ status: 400 })
    // Nothing moved, and the original claims are intact.
    const still = await prisma.appointment.findUniqueOrThrow({ where: { id: mine.appointment.id } })
    expect(still.startsAt.toISOString()).toBe(at(day(12), '09:00').toISOString())
    expect(await claims(mine.appointment.id)).toBe(24)
    // Someone else's appointment cannot be moved.
    await expect(rescheduleAppointment({ ownerId, appointmentId: theirs.appointment.id, startsAt: at(day(12), '15:00'), by: 'member', memberId: m1.id })).rejects.toMatchObject({ status: 404 })

    const soonStart = new Date(Math.ceil((Date.now() + 3 * HOUR) / (30 * 60_000)) * 30 * 60_000)
    const late = await bookAppointment({ ownerId, typeId: type.id, memberId: m1.id, staffId: staff.id, startsAt: soonStart, source: 'member' })
    await expect(rescheduleAppointment({ ownerId, appointmentId: late.appointment.id, startsAt: at(day(12), '15:00'), by: 'member', memberId: m1.id })).rejects.toMatchObject({ code: 'reschedule_window' })
    // Staff can still move it.
    expect((await rescheduleAppointment({ ownerId, appointmentId: late.appointment.id, startsAt: at(day(12), '15:00'), by: 'staff' })).appointment.rescheduleCount).toBe(1)
    const fixed = await createType({ memberReschedule: false, name: 'Fixed' }, [staff.id])
    const f = await bookAppointment({ ownerId, typeId: fixed.id, memberId: m2.id, staffId: staff.id, startsAt: at(day(13), '09:00'), source: 'member' })
    await expect(rescheduleAppointment({ ownerId, appointmentId: f.appointment.id, startsAt: at(day(13), '11:00'), by: 'member', memberId: m2.id })).rejects.toMatchObject({ code: 'reschedule_not_allowed' })
  })
})

describe('double booking is impossible', () => {
  async function overlapping(staffId: string) {
    // Any two live appointments for one coach that share time.
    const rows = await prisma.appointment.findMany({ where: { ownerId, staffId, status: { in: ['booked', 'completed'] } }, orderBy: { startsAt: 'asc' } })
    let clashes = 0
    for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) if (rows[i].startsAt < rows[j].endsAt && rows[j].startsAt < rows[i].endsAt) clashes++
    return { rows, clashes }
  }

  it('lets exactly one of two simultaneous requests for the same coach and time succeed', async () => {
    const staff = await createStaff()
    const type = await createType({}, [staff.id])
    const [m1, m2] = await Promise.all([createMember(ownerId), createMember(ownerId)])
    const startsAt = at(day(14), '10:00')
    const results = await Promise.allSettled([
      bookAppointment({ ownerId, typeId: type.id, memberId: m1.id, staffId: staff.id, startsAt, source: 'member' }),
      bookAppointment({ ownerId, typeId: type.id, memberId: m2.id, staffId: staff.id, startsAt, source: 'member' }),
    ])
    const won = results.filter((r) => r.status === 'fulfilled')
    const lost = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
    expect(won).toHaveLength(1)
    expect(lost).toHaveLength(1)
    expect(lost[0].reason).toMatchObject({ status: 409 })
    const { rows, clashes } = await overlapping(staff.id)
    expect(rows).toHaveLength(1)
    expect(clashes).toBe(0)
  })

  it('holds under a burst: 12 members race for one slot, then for overlapping slots', async () => {
    const staff = await createStaff()
    const type = await createType({ durationMin: 60, slotIntervalMin: 15 }, [staff.id])
    const members = await Promise.all(Array.from({ length: 12 }, () => createMember(ownerId)))
    const same = await Promise.allSettled(members.map((m) => bookAppointment({ ownerId, typeId: type.id, memberId: m.id, staffId: staff.id, startsAt: at(day(15), '09:00'), source: 'member' })))
    expect(same.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect((same.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]).every((r) => r.reason?.status === 409)).toBe(true)

    // Different start times that all overlap each other (12:00, 12:15, 12:30, 12:45 x3): still only one.
    const starts = ['12:00', '12:15', '12:30', '12:45']
    const staggered = await Promise.allSettled(members.map((m, i) => bookAppointment({ ownerId, typeId: type.id, memberId: m.id, staffId: staff.id, startsAt: at(day(15), starts[i % 4]), source: 'member' })))
    expect(staggered.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const { rows, clashes } = await overlapping(staff.id)
    expect(rows).toHaveLength(2)
    expect(clashes).toBe(0)
  })

  it('stops one member being booked with two coaches at once, simultaneously', async () => {
    const a = await createStaff()
    const b = await createStaff()
    const type = await createType({}, [a.id, b.id])
    const member = await createMember(ownerId)
    const startsAt = at(day(14), '13:00')
    const results = await Promise.allSettled([
      bookAppointment({ ownerId, typeId: type.id, memberId: member.id, staffId: a.id, startsAt, source: 'staff' }),
      bookAppointment({ ownerId, typeId: type.id, memberId: member.id, staffId: b.id, startsAt: new Date(startsAt.getTime() + 30 * 60_000), source: 'staff' }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await prisma.appointment.count({ where: { memberId: member.id, status: 'booked' } })).toBe(1)
  })

  it('lets only one of two appointments be rescheduled into the same free slot at once', async () => {
    const staff = await createStaff()
    const type = await createType({}, [staff.id])
    const [m1, m2] = await Promise.all([createMember(ownerId), createMember(ownerId)])
    const a = await bookAppointment({ ownerId, typeId: type.id, memberId: m1.id, staffId: staff.id, startsAt: at(day(16), '09:00'), source: 'member' })
    const b = await bookAppointment({ ownerId, typeId: type.id, memberId: m2.id, staffId: staff.id, startsAt: at(day(16), '11:00'), source: 'member' })
    const target = at(day(16), '14:00')
    const results = await Promise.allSettled([
      rescheduleAppointment({ ownerId, appointmentId: a.appointment.id, startsAt: target, by: 'member', memberId: m1.id }),
      rescheduleAppointment({ ownerId, appointmentId: b.appointment.id, startsAt: target, by: 'member', memberId: m2.id }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const { rows, clashes } = await overlapping(staff.id)
    expect(rows).toHaveLength(2)
    expect(clashes).toBe(0)
    // The loser kept its original time and its claims.
    expect(await prisma.timeClaim.count({ where: { resource: `staff:${staff.id}` } })).toBe(24)
  })

  it('is enforced by the database itself, not only by the booking code', async () => {
    const staff = await createStaff()
    const type = await createType({}, [staff.id])
    const [m1, m2] = await Promise.all([createMember(ownerId), createMember(ownerId)])
    const first = await bookAppointment({ ownerId, typeId: type.id, memberId: m1.id, staffId: staff.id, startsAt: at(day(17), '10:00'), source: 'member' })
    // Bypass every check and write a second appointment straight in: the claim index refuses it.
    const rogue = await prisma.appointment.create({ data: { ownerId, typeId: type.id, memberId: m2.id, staffId: staff.id, startsAt: at(day(17), '10:30'), endsAt: at(day(17), '11:30'), paymentMode: 'included' } })
    await expect(prisma.timeClaim.create({ data: { ownerId, appointmentId: rogue.id, resource: `staff:${staff.id}`, slot: at(day(17), '10:30') } })).rejects.toMatchObject({ code: 'P2002' })
    expect(first.appointment.status).toBe('booked')
    await prisma.appointment.delete({ where: { id: rogue.id } })
  })
})

describe('reminders', () => {
  it('reminds once for tomorrow and once shortly before, however often the job runs', async () => {
    const staff = await createStaff(ownerId, undefined, [0, 1440])
    const type = await createType({}, [staff.id])
    const member = await createMember(ownerId)
    const startsAt = new Date(Math.ceil((Date.now() + 20 * HOUR) / (30 * 60_000)) * 30 * 60_000)
    const { appointment } = await bookAppointment({ ownerId, typeId: type.id, memberId: member.id, staffId: staff.id, startsAt, source: 'member' })
    await sendAppointmentReminders(ownerId)
    await sendAppointmentReminders(ownerId)
    expect(await prisma.memberNotification.count({ where: { memberId: member.id, type: 'appointment_reminder' } })).toBe(1)
    const nearly = new Date(startsAt.getTime() - HOUR)
    await sendAppointmentReminders(ownerId, nearly)
    await sendAppointmentReminders(ownerId, nearly)
    expect(await prisma.memberNotification.count({ where: { memberId: member.id, type: 'appointment_soon' } })).toBe(1)
    // A cancelled appointment is not reminded.
    await cancelAppointment({ ownerId, appointmentId: appointment.id, by: 'staff', waive: true })
    const other = await bookAppointment({ ownerId, typeId: type.id, memberId: member.id, staffId: staff.id, startsAt, source: 'member' })
    await cancelAppointment({ ownerId, appointmentId: other.appointment.id, by: 'staff', waive: true })
    await sendAppointmentReminders(ownerId)
    expect(await prisma.memberNotification.count({ where: { memberId: member.id, type: 'appointment_reminder' } })).toBe(1)
  })
})

describe('commission-ready records', () => {
  it('keeps who, what, where, when and how much on every appointment', async () => {
    const location = await prisma.location.create({ data: { ownerId, name: 'HQ' } })
    const staff = await createStaff()
    await prisma.staffAvailability.updateMany({ where: { staffId: staff.id }, data: { locationId: location.id } })
    const type = await createType({ paymentMode: 'paid', priceCents: 9000 }, [staff.id])
    const member = await createMember(ownerId)
    const { appointment } = await bookAppointment({ ownerId, typeId: type.id, memberId: member.id, staffId: staff.id, startsAt: at(day(18), '10:00'), source: 'staff' })
    expect(appointment).toMatchObject({ staffId: staff.id, typeId: type.id, memberId: member.id, locationId: location.id, priceCents: 9000, paymentMode: 'paid' })
    expect(appointment.invoiceId).toBeTruthy()
    expect(appointment.startsAt.toISOString()).toBe(at(day(18), '10:00').toISOString())
    // Changing the price later does not rewrite history.
    await prisma.appointmentType.update({ where: { id: type.id }, data: { priceCents: 12000 } })
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).priceCents).toBe(9000)
  })
})
