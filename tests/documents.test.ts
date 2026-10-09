// Documents and e-signatures: templates and versions, assignment, signing, the signed record and
// its PDF, links, required documents in other workflows, and who may see what.
// The HTTP half needs a running dev server (npm run dev) and is skipped without one.

import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Member, MemberDocument } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createToken } from '@/lib/auth'
import { addDaysToDate, zonedParts, zonedToUtc } from '@/lib/dates'
import { createInvite, setPasswordWithToken } from '@/lib/member-auth'
import { CONSENT_TEXT, canonicalJson, checkFieldValues, parseBody, resolveBlocks, signatureSchema, tidySignature, unknownMergeFields, type DocumentContent, type DocumentField, type SignedSnapshot } from '@/lib/documents/content'
import { readDownloadToken, signDownloadToken } from '@/lib/documents/actions'
import { renderSignedPdf } from '@/lib/documents/pdf'
import { LocalFileStorage, MemoryStorage, setStorageForTests } from '@/lib/storage'
import {
  archiveTemplate, assignDocument, createTemplate, declineDocument, discardDraft, documentDetail, documentForToken, duplicateTemplate, expireDocuments, issueSigningToken, memberDocuments, missingRequired,
  openDocument, publishTemplate, remindUnsigned, requireDocuments, resendDocument, saveDraft, saveFields, saveRequirements, searchDocuments, sendToMembers, signDocument, signSchema, signedPdf, templateCreateSchema, templateDetail, voidDocument,
} from '@/lib/services/documents'
import { bookAppointment } from '@/lib/services/appointments'
import { bookClass, classDocumentsGate } from '@/lib/services/bookings'
import { createMember as createMemberService } from '@/lib/services/members'
import { sellMembership } from '@/lib/services/memberships'
import { buyPlanWithSavedMethod } from '@/lib/services/purchases'
import { bookAppointmentOnline, bookClassOnline, getBookingSite, resolveSite, saveBookingSite, siteSchema } from '@/lib/services/public-booking'
import { signBookingSession } from '@/lib/public-booking/tokens'
import { DAY, HOUR, createGym, createMember, createPlan, createSession, destroyGym, memberBearer, tx } from './helpers'

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
const TZ = ['America/New_York', 'Europe/London', 'Asia/Kolkata', 'Asia/Tokyo', 'Pacific/Auckland', 'Pacific/Honolulu', 'America/Sao_Paulo'].find((zone) => {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).format(new Date()))
  return hour >= 5 && hour <= 15
}) || 'UTC'
let up = false
try { up = (await fetch(`${BASE}/api/system-status`, { signal: AbortSignal.timeout(3000) })).status > 0 } catch {}

const staffActor = { type: 'staff' as const, id: randomUUID(), name: 'Sam Staff' }
const evidence = { ip: '203.0.113.9', userAgent: 'Vitest', via: 'Member app' as const }
const BODY = `# Assumption of risk

I, {{member.full_name}}, train at {{gym.name}} **at my own risk**. My email is {{member.email}}.

- I will follow instructions.
- I will report injuries.

Signed on {{today}}.`
const FIELDS: DocumentField[] = [
  { key: 'emergency_name', label: 'Emergency contact name', type: 'text', required: true },
  { key: 'photo_ok', label: 'I agree to photos', type: 'checkbox', required: false },
]
const drawn = { method: 'drawn' as const, width: 300, height: 120, strokes: [Array.from({ length: 30 }, (_, i) => [10 + i * 8, 60 + (i % 5) * 6] as [number, number])] }
const signing = (extra: Record<string, unknown> = {}) => signSchema.parse({ consent: true, read: true, signerName: 'Wendy Signer', signature: drawn, fields: { emergency_name: 'Sam Signer' }, ...extra })
/** The words a PDF draws, in order. The writer places one word at a time. */
const pdfText = (pdf: Buffer | string) => [...(typeof pdf === 'string' ? pdf : pdf.toString('latin1')).matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => m[1]).join(' ')
const memberActor = (m: Member) => ({ type: 'member' as const, id: m.id, name: m.name })

const gyms: string[] = []
async function gym(data: Record<string, unknown> = {}) {
  const ownerId = await createGym({ timezone: TZ, name: 'Signing Gym', ...data })
  gyms.push(ownerId)
  return ownerId
}
/** A published template. */
async function template(ownerId: string, extra: Record<string, unknown> = {}) {
  const created = await createTemplate(ownerId, templateCreateSchema.parse({ name: `Waiver ${randomUUID().slice(0, 6)}`, type: 'waiver', title: 'Liability Waiver', body: BODY, fields: FIELDS, ...extra }), staffActor)
  await publishTemplate(ownerId, created.id)
  return prisma.documentTemplate.findUniqueOrThrow({ where: { id: created.id } })
}
const give = async (ownerId: string, templateId: string, memberId: string, extra: Record<string, unknown> = {}) => (await tx((db) => assignDocument(db, { ownerId, templateId, memberId, actor: staffActor, ...extra }))).document
const fresh = (id: string) => prisma.memberDocument.findUniqueOrThrow({ where: { id } })
const sign = (d: MemberDocument, member: Member, extra: Record<string, unknown> = {}) => signDocument({ document: d, actor: memberActor(member), evidence, ...signing(extra) })
const events = async (id: string) => (await prisma.documentEvent.findMany({ where: { documentId: id }, orderBy: { createdAt: 'asc' } })).map((e) => e.type)

const storage = new MemoryStorage()
beforeAll(() => setStorageForTests(storage))
afterAll(async () => {
  setStorageForTests(null)
  for (const ownerId of gyms) {
    await prisma.documentRequirement.deleteMany({ where: { ownerId } })
    await prisma.documentTemplate.deleteMany({ where: { ownerId } })
    await prisma.bookingSite.deleteMany({ where: { ownerId } })
    await destroyGym(ownerId)
  }
})

// ===========================================================================
describe('documents: content, fields and signatures', () => {
  it('parses the editor\'s markup into text runs and nothing else', () => {
    const blocks = parseBody('# Title\n\nPlain **bold** and *italic* with a [link](https://example.com/x) and {{member.first_name}}.\n\n- one\n- two\n\n1. first\n2. second\n\n---\n\n## Next page')
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'list', 'page_break', 'heading'])
    const p = blocks[1] as { runs: { text: string; bold?: boolean; italic?: boolean; link?: string; field?: string }[] }
    expect(p.runs.find((r) => r.bold)?.text).toBe('bold')
    expect(p.runs.find((r) => r.italic)?.text).toBe('italic')
    expect(p.runs.find((r) => r.link)).toMatchObject({ text: 'link', link: 'https://example.com/x' })
    expect(p.runs.find((r) => r.field)?.field).toBe('member.first_name')
    expect(blocks[2]).toMatchObject({ ordered: false })
    expect((blocks[3] as { ordered: boolean; items: unknown[] })).toMatchObject({ ordered: true })
    // Markup and script are just characters; a link that is not http(s) is not a link.
    const hostile = parseBody('<script>alert(1)</script> <img src=x onerror=alert(1)> [click](javascript:alert(1)) [data](data:text/html,x)')
    const runs = (hostile[0] as { runs: { text: string; link?: string }[] }).runs
    expect(runs.some((r) => r.link)).toBe(false)
    expect(runs.map((r) => r.text).join('')).toContain('<script>alert(1)</script>')
  })

  it('fills merge fields from a fixed list, once, as plain text', () => {
    const blocks = parseBody('Hello {{member.full_name}} of {{gym.name}}. {{nonsense.field}} {{ member.email }} {{constructor}} {{__proto__}}')
    expect(unknownMergeFields('{{member.full_name}} {{nonsense.field}} {{constructor}}')).toEqual(['nonsense.field', 'constructor'])
    const resolved = resolveBlocks(blocks, { 'member.full_name': '{{gym.name}} **bold** <b>x</b>', 'gym.name': 'Iron & Co', 'member.email': 'a@b.test' })
    const text = (resolved[0] as { runs: { text: string; bold?: boolean }[] }).runs.map((r) => r.text).join('')
    // A value that looks like a merge field or markup is not processed again.
    expect(text).toBe('Hello {{gym.name}} **bold** <b>x</b> of Iron & Co. {{nonsense.field}} a@b.test {{constructor}} {{__proto__}}')
    expect((resolved[0] as { runs: { bold?: boolean }[] }).runs.some((r) => r.bold)).toBe(false)
    // Something not known about the member is a blank to be read as "not given", never "undefined".
    expect(JSON.stringify(resolveBlocks(parseBody('Born {{member.date_of_birth}}'), {}))).toContain('__________')
  })

  it('checks what a signer enters against the fields they were given', () => {
    const fields: DocumentField[] = [...FIELDS, { key: 'dob', label: 'Date of birth', type: 'date', required: true }, { key: 'shirt', label: 'Shirt size', type: 'select', required: false, options: ['S', 'M'] }, { key: 'ini', label: 'Initials', type: 'initials', required: false }]
    expect(checkFieldValues(fields, {}, true).problems).toEqual({ emergency_name: 'This is required', dob: 'This is required' })
    expect(checkFieldValues(fields, {}, false).problems).toEqual({})
    const ok = checkFieldValues(fields, { emergency_name: '  Sam  ', dob: '1990-05-01', shirt: 'M', photo_ok: true, ini: 'WS', extra: 'dropped', __proto__: 'x' }, true)
    expect(ok.problems).toEqual({})
    expect(ok.values).toEqual({ emergency_name: 'Sam', dob: '1990-05-01', shirt: 'M', photo_ok: true, ini: 'WS' })
    expect(checkFieldValues(fields, { emergency_name: 'x', dob: 'yesterday', shirt: 'XXL', ini: 'TOOLONGX' }, true).problems).toEqual({ dob: 'Enter a date', shirt: 'Choose one of the options', ini: 'Initials only' })
  })

  it('accepts a real signature and nothing oversized or empty', () => {
    expect(signatureSchema.safeParse(drawn).success).toBe(true)
    expect(signatureSchema.safeParse({ method: 'typed', text: 'Wendy Signer' }).success).toBe(true)
    for (const bad of [{ method: 'typed', text: 'W' }, { method: 'drawn', width: 300, height: 120, strokes: [] }, { method: 'drawn', width: 300, height: 120, strokes: [[[1, 1]]] }, { method: 'drawn', width: 300, height: 120, strokes: Array.from({ length: 6 }, () => Array.from({ length: 4000 }, () => [1, 1])) }, { method: 'image', data: 'data:image/png;base64,AAAA' }]) {
      expect(signatureSchema.safeParse(bad).success, JSON.stringify(bad).slice(0, 60)).toBe(false)
    }
    // Stored as whole points inside the box: enough to draw it again, and no more.
    const tidy = tidySignature({ method: 'drawn', width: 300.4, height: 120.2, strokes: [[[10.26, 20.71], [-5, 500]]] })
    expect(tidy).toEqual({ method: 'drawn', width: 300, height: 120, strokes: [[[10, 21], [0, 120]]] })
    // Signing needs the consent box ticked and the document read: anything else is refused before it reaches the database.
    for (const bad of [{ consent: false }, { consent: 'true' }, { read: false }, { signerName: '' }]) expect(signSchema.safeParse({ consent: true, read: true, signerName: 'W S', signature: drawn, fields: {}, ...bad }).success, JSON.stringify(bad)).toBe(false)
    const { consent: _c, ...noConsent } = { consent: true, read: true, signerName: 'W S', signature: drawn, fields: {} }
    expect(signSchema.safeParse(noConsent).success).toBe(false)
  })
})

describe('documents: the PDF and file storage', () => {
  const snapshot = (extra: Partial<SignedSnapshot> = {}): SignedSnapshot => ({
    documentId: randomUUID(), title: 'Liability Waiver (2026)', type: 'waiver', version: 3, gym: { name: 'Iron & Harbor', address: '1 Main St', phone: '555-0100', email: 'hi@gym.test' }, member: { name: 'Wendy Signer', email: 'wendy@test.local' },
    blocks: resolveBlocks(parseBody(`${BODY}\n\n${'A long paragraph of ordinary words to wrap across the page. '.repeat(120)}\n\n---\n\n## Second section\n\nUnusual: “quotes” – dash — café ☃ 日本語 (parens) \\backslash`), { 'member.full_name': 'Wendy Signer', 'gym.name': 'Iron & Harbor', today: 'October 7, 2026' }),
    fields: [{ key: 'emergency_name', label: 'Emergency contact name', type: 'text', value: 'Sam Signer' }, { key: 'photo_ok', label: 'I agree to photos', type: 'checkbox', value: true }],
    signature: drawn, signerName: 'Wendy Signer',
    evidence: { consentAt: '2026-10-07T18:20:11.000Z', consentText: CONSENT_TEXT, signedAt: '2026-10-07T18:21:40.000Z', method: 'drawn', ip: '203.0.113.9', userAgent: 'Vitest', via: 'Member app' }, ...extra,
  })

  it('writes a well-formed, multi-page PDF from a signed record alone, the same way every time', () => {
    const s = snapshot()
    const pdf = renderSignedPdf(s, 'ab'.repeat(32))
    const text = pdf.toString('latin1')
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
    // The cross-reference table points at every object.
    const xref = Number(text.match(/startxref\n(\d+)/)![1])
    expect(text.slice(xref, xref + 4)).toBe('xref')
    const offsets = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n /gm)].map((m) => Number(m[1]))
    offsets.forEach((o, i) => expect(text.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`))
    expect((text.match(/\/Type \/Page /g) || []).length).toBeGreaterThanOrEqual(3)
    for (const piece of ['Iron & Harbor', 'Liability Waiver \\(2026\\)', 'Wendy Signer', 'Emergency contact name', 'Sam Signer', 'Yes \\(ticked\\)', 'Version 3', 'Signature record', '203.0.113.9', 'ab'.repeat(32), 'Page 1 of', '\\(parens\\)', '\\\\backslash']) expect(pdfText(pdf), piece).toContain(piece)
    // The drawn signature is there as strokes.
    expect(text).toMatch(/\d+\.\d\d \d+\.\d\d m \d+\.\d\d \d+\.\d\d l/)
    expect(renderSignedPdf(s, 'ab'.repeat(32)).equals(pdf)).toBe(true)
    // A typed signature, and no signature at all, also render.
    expect(renderSignedPdf(snapshot({ signature: { method: 'typed', text: 'Wendy Signer' } }), 'cd'.repeat(32)).toString('latin1')).toContain('/F5 26 Tf')
    expect(pdfText(renderSignedPdf(snapshot({ signature: null }), 'cd'.repeat(32)))).toContain('Accepted without a drawn or typed signature')
  })

  it('keeps files behind keys the server chooses, and refuses anything that would leave its folder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-docs-'))
    const local = new LocalFileStorage(dir)
    await local.put('documents/gym/one.pdf', Buffer.from('%PDF-test'))
    expect((await local.get('documents/gym/one.pdf'))?.toString()).toBe('%PDF-test')
    expect(await local.get('documents/gym/missing.pdf')).toBeNull()
    for (const key of ['../escape.pdf', 'documents/../../etc/passwd', '/etc/passwd', 'a//b', 'a/./b', '', 'white space.pdf', 'a\\b']) {
      await expect(local.put(key, Buffer.from('x')), key).rejects.toThrow()
      await expect(local.get(key), key).rejects.toThrow()
    }
    await local.delete('documents/gym/one.pdf')
    expect(await local.get('documents/gym/one.pdf')).toBeNull()
  })
})

// ===========================================================================
describe('documents: services', () => {
  describe('templates and versions', () => {
    it('creates a draft, edits it in place, publishes it, and starts a new version for any later edit', async () => {
      const g = await gym()
      const created = await createTemplate(g, templateCreateSchema.parse({ name: 'Membership Agreement', type: 'membership_agreement', title: 'Agreement', body: 'Version one text.' }), staffActor)
      let detail = await templateDetail(g, created.id)
      expect(detail).toMatchObject({ status: 'draft', published: null, draft: { version: 1, status: 'draft' }, createdByName: 'Sam Staff' })
      // Not published: it cannot be sent.
      const m = await createMember(g)
      await expect(give(g, created.id, m.id)).rejects.toMatchObject({ status: 409, code: 'not_published' })
      // Editing a draft changes the draft.
      expect(await saveDraft(g, created.id, { body: 'Version one, corrected.' }, staffActor)).toMatchObject({ started: false })
      expect((await templateDetail(g, created.id)).versions).toHaveLength(1)
      const v1 = await publishTemplate(g, created.id)
      expect(v1).toMatchObject({ version: 1, status: 'published' })
      expect(v1.publishedAt).not.toBeNull()
      await expect(publishTemplate(g, created.id)).rejects.toMatchObject({ status: 409, code: 'nothing_to_publish' })
      // Editing a published version starts version 2; version 1 is exactly as it was.
      const edit = await saveDraft(g, created.id, { body: 'Version two text.' }, staffActor)
      expect(edit).toMatchObject({ started: true, version: { version: 2, status: 'draft' } })
      detail = await templateDetail(g, created.id)
      expect(detail.published).toMatchObject({ version: 1, body: 'Version one, corrected.' })
      expect(detail.draft).toMatchObject({ version: 2, body: 'Version two text.' })
      expect(detail.editing.version).toBe(2)
      // Members are still given version 1 until version 2 is published.
      expect((await give(g, created.id, m.id)).version).toBe(1)
      await publishTemplate(g, created.id)
      detail = await templateDetail(g, created.id)
      expect(detail.versions.map((v) => [v.version, v.status])).toEqual([[2, 'published'], [1, 'archived']])
      expect((await prisma.documentTemplateVersion.findFirstOrThrow({ where: { templateId: created.id, version: 1 } })).body).toBe('Version one, corrected.')
      // A draft can be thrown away; the only version cannot.
      await saveDraft(g, created.id, { body: 'Abandoned.' }, staffActor)
      expect(await discardDraft(g, created.id)).toEqual({ discarded: true })
      expect((await templateDetail(g, created.id)).draft).toBeNull()
      await expect(discardDraft(g, created.id)).rejects.toMatchObject({ status: 409 })
    })

    it('refuses to publish a merge field that does not exist, and copies and archives templates', async () => {
      const g = await gym()
      const bad = await createTemplate(g, templateCreateSchema.parse({ name: 'Bad', title: 'Bad', body: 'Hello {{member.nickname}}' }), staffActor)
      await expect(publishTemplate(g, bad.id)).rejects.toMatchObject({ status: 400, code: 'unknown_merge_field' })
      const t = await template(g, { validForDays: 365 })
      const copy = await duplicateTemplate(g, t.id, staffActor)
      expect(copy.name).toBe(`${t.name} (copy)`)
      expect(await templateDetail(g, copy.id)).toMatchObject({ status: 'draft', validForDays: 365, draft: { version: 1, body: BODY } })
      await archiveTemplate(g, t.id, true)
      const m = await createMember(g)
      await expect(give(g, t.id, m.id)).rejects.toMatchObject({ status: 409, code: 'archived' })
      await expect(saveDraft(g, t.id, { body: 'x' }, staffActor)).rejects.toMatchObject({ status: 409 })
      await archiveTemplate(g, t.id, false)
      expect((await give(g, t.id, m.id)).status).toBe('sent')
      // Another gym's template is not there at all.
      const other = await gym()
      for (const fn of [() => templateDetail(other, t.id), () => publishTemplate(other, t.id), () => saveDraft(other, t.id, { body: 'x' }, staffActor), () => duplicateTemplate(other, t.id, staffActor), () => archiveTemplate(other, t.id, true)]) await expect(fn()).rejects.toMatchObject({ status: 404 })
    })
  })

  describe('assignment', () => {
    it('gives each member their own copy with their details filled in, and never two', async () => {
      const g = await gym()
      const plan = await createPlan(g, { name: 'Gold Plan', priceCents: 12900 })
      const t = await template(g, { body: `${BODY}\n\nPlan: {{membership.name}} at {{membership.price}} {{membership.billing_interval}}. Phone {{member.phone}}. Born {{member.date_of_birth}}.` })
      const a = await createMember(g, { name: 'Ada Lovelace', email: 'ada@test.local', phone: '555-0101', dateOfBirth: new Date('1990-12-10T00:00:00Z') })
      const b = await createMember(g, { name: 'Bob', email: 'bob@test.local' })
      await tx((db) => sellMembership(db, { ownerId: g, memberId: a.id, planId: plan.id, paymentMethod: 'cash' }))
      const result = await sendToMembers({ ownerId: g, templateId: t.id, memberIds: [a.id, b.id, a.id], actor: staffActor, origin: BASE })
      expect(result.created).toHaveLength(2)
      const mine = result.created.find((d) => d.memberId === a.id)!
      expect(mine).toMatchObject({ status: 'sent', version: 1, name: 'Liability Waiver', type: 'waiver', assignedByName: 'Sam Staff', source: 'staff' })
      const text = JSON.stringify((mine.content as unknown as DocumentContent).blocks)
      for (const piece of ['Ada Lovelace', 'Signing Gym', 'ada@test.local', 'Gold Plan', '$129', 'monthly', '555-0101', 'Dec 10, 1990']) expect(text, piece).toContain(piece)
      expect(text).not.toContain('{{')
      // Someone with no last name, phone, membership or birthday gets blanks, not errors.
      const theirs = JSON.stringify((result.created.find((d) => d.memberId === b.id)!.content as unknown as DocumentContent).blocks)
      expect(theirs).toContain('Bob')
      expect(theirs).toContain('__________')
      expect(await events(mine.id)).toEqual(['assigned', 'sent'])
      // Sending again changes nothing: they already have it.
      const again = await sendToMembers({ ownerId: g, templateId: t.id, memberIds: [a.id, b.id], actor: staffActor, origin: BASE })
      expect(again.created).toHaveLength(0)
      expect(again.existing.map((d) => d.id).sort()).toEqual(result.created.map((d) => d.id).sort())
      // Eight requests at once for the same member: one copy.
      const c = await createMember(g)
      const all = await Promise.all(Array.from({ length: 8 }, () => tx((db) => assignDocument(db, { ownerId: g, templateId: t.id, memberId: c.id }))))
      expect(all.filter((r) => r.created)).toHaveLength(1)
      expect(new Set(all.map((r) => r.document.id)).size).toBe(1)
      expect(await prisma.memberDocument.count({ where: { memberId: c.id } })).toBe(1)
      // A member of another gym, an archived member and a made-up id are refused, and nobody is half-sent.
      const outsider = await createMember(await gym())
      await expect(sendToMembers({ ownerId: g, templateId: t.id, memberIds: [b.id, outsider.id], actor: staffActor, origin: BASE })).rejects.toMatchObject({ status: 404 })
      const gone = await createMember(g, { archivedAt: new Date() })
      await expect(give(g, t.id, gone.id)).rejects.toMatchObject({ status: 409, code: 'member_archived' })
    })
  })

  describe('signing', () => {
    it('records opening, saving, consent and the signature, and fixes the signed record', async () => {
      const g = await gym()
      const t = await template(g, { validForDays: 365 })
      const m = await createMember(g, { name: 'Wendy Signer' })
      const d = await give(g, t.id, m.id)
      // Opening is recorded once and signs nothing.
      const view = await openDocument(d, memberActor(m), evidence)
      expect(view).toMatchObject({ status: 'viewed', title: 'Liability Waiver', can: { sign: true, decline: true, download: false }, consentText: CONSENT_TEXT })
      expect(view.fields.map((f) => f.key)).toEqual(['emergency_name', 'photo_ok'])
      await openDocument(await fresh(d.id), memberActor(m), evidence)
      expect(await fresh(d.id)).toMatchObject({ status: 'viewed', signedAt: null, finalSnapshot: null })
      await saveFields({ document: d, fields: { emergency_name: 'Sam', junk: 'x' }, actor: memberActor(m), evidence })
      expect(await fresh(d.id)).toMatchObject({ status: 'partially_completed', fieldValues: { emergency_name: 'Sam' } })
      // Incomplete, or unsigned, is refused and changes nothing.
      await expect(sign(d, m, { fields: {} })).rejects.toMatchObject({ status: 400, code: 'fields_incomplete' })
      await expect(sign(d, m, { signature: null })).rejects.toMatchObject({ status: 400, code: 'signature_required' })
      expect((await fresh(d.id)).status).toBe('partially_completed')

      const before = Date.now()
      const signed = await sign(d, m)
      expect(signed).toMatchObject({ status: 'signed', hasSignedCopy: true })
      const row = await fresh(d.id)
      expect(row).toMatchObject({ status: 'signed', signerName: 'Wendy Signer', signatureMethod: 'drawn', signedIp: '203.0.113.9', signedUserAgent: 'Vitest' })
      expect(row.signedAt!.getTime()).toBeGreaterThanOrEqual(before - 5)
      expect(row.consentAt).toEqual(row.signedAt)
      expect(Math.round((row.validUntil!.getTime() - row.signedAt!.getTime()) / DAY)).toBe(365)
      const snap = row.finalSnapshot as unknown as SignedSnapshot
      expect(snap).toMatchObject({
        documentId: d.id, title: 'Liability Waiver', version: 1, signerName: 'Wendy Signer', member: { name: 'Wendy Signer', email: m.email }, gym: { name: 'Signing Gym' },
        fields: [{ key: 'emergency_name', value: 'Sam Signer' }, { key: 'photo_ok', value: null }],
        signature: { method: 'drawn' }, evidence: { method: 'drawn', ip: '203.0.113.9', userAgent: 'Vitest', via: 'Member app', consentText: CONSENT_TEXT },
      })
      expect(JSON.stringify(snap.blocks)).toContain('Wendy Signer')
      expect(row.snapshotHash).toBe(createHash('sha256').update(canonicalJson(snap)).digest('hex'))
      expect(await events(d.id)).toEqual(['assigned', 'sent', 'viewed', 'fields_saved', 'consent_given', 'signed'])
      const signedEvent = await prisma.documentEvent.findFirstOrThrow({ where: { documentId: d.id, type: 'signed' } })
      expect(signedEvent).toMatchObject({ actorType: 'member', actorId: m.id, actorName: 'Wendy Signer', ip: '203.0.113.9', userAgent: 'Vitest' })
      expect(signedEvent.metadata).toMatchObject({ method: 'drawn', version: 1, snapshotHash: row.snapshotHash })
      // The member's timeline and the staff notification come from the existing engines.
      expect(await prisma.activity.count({ where: { memberId: m.id, type: 'document_signed' } })).toBe(1)
      expect(await prisma.notification.count({ where: { ownerId: g, type: 'document_signed' } })).toBe(1)
      expect((await prisma.memberNotification.findMany({ where: { memberId: m.id } })).map((n) => n.type)).toEqual(expect.arrayContaining(['document_assigned', 'document_signed']))
      // Signing again, saving fields, or declining now: refused, and the record does not move.
      await expect(sign(d, m, { signerName: 'Someone Else' })).rejects.toMatchObject({ status: 409, code: 'already_signed' })
      await expect(saveFields({ document: d, fields: { emergency_name: 'Changed' }, actor: memberActor(m), evidence })).rejects.toMatchObject({ status: 409, code: 'already_signed' })
      await expect(declineDocument({ document: d, reason: null, actor: memberActor(m), evidence })).rejects.toMatchObject({ status: 409 })
      expect(JSON.stringify((await fresh(d.id)).finalSnapshot)).toBe(JSON.stringify(snap))
      // What the signer is shown afterwards has no signature in it; that is in the PDF.
      const after = await openDocument(await fresh(d.id), memberActor(m), evidence)
      expect(after).toMatchObject({ status: 'signed', fieldValues: {}, can: { sign: false, decline: false, download: true } })
      expect(JSON.stringify(after)).not.toContain('strokes')
    })

    it('records exactly one signature when the same document is signed six times at once', async () => {
      const g = await gym()
      const t = await template(g)
      const m = await createMember(g)
      const d = await give(g, t.id, m.id)
      const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => sign(d, m, { signerName: `Tab ${i}` })))
      const ok = results.filter((r) => r.status === 'fulfilled')
      const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
      expect(ok).toHaveLength(1)
      expect(failed.every((f) => f.reason.code === 'already_signed')).toBe(true)
      expect(await prisma.documentEvent.count({ where: { documentId: d.id, type: 'signed' } })).toBe(1)
      const row = await fresh(d.id)
      expect((row.finalSnapshot as unknown as SignedSnapshot).signerName).toBe(row.signerName)
      expect(await prisma.activity.count({ where: { memberId: m.id, type: 'document_signed' } })).toBe(1)
    })

    it('accepts a typed signature, and a document that only needs acknowledging', async () => {
      const g = await gym()
      const m = await createMember(g)
      const typed = await give(g, (await template(g, { fields: [] })).id, m.id)
      await sign(typed, m, { signature: { method: 'typed', text: 'Wendy Signer' }, fields: {} })
      expect(await fresh(typed.id)).toMatchObject({ signatureMethod: 'typed', signature: { method: 'typed', text: 'Wendy Signer' } })
      const policy = await give(g, (await template(g, { type: 'policy', fields: [], requireSignature: false })).id, m.id)
      await sign(policy, m, { signature: null, fields: {} })
      expect(await fresh(policy.id)).toMatchObject({ status: 'signed', signatureMethod: 'acceptance', signature: null })
    })
  })

  describe('versions and the signed record', () => {
    it('keeps a signed version 1 exactly as signed when the template moves to version 2', async () => {
      const g = await gym()
      const t = await template(g)
      const first = await createMember(g, { name: 'First Member' })
      const d1 = await give(g, t.id, first.id)
      await sign(d1, first)
      const signed = await fresh(d1.id)
      const pdf1 = (await signedPdf(signed, staffActor, { via: 'Staff' })).pdf

      await saveDraft(g, t.id, { title: 'Liability Waiver (revised)', body: '# New wording\n\nCompletely different text for {{member.full_name}}.', fields: [] }, staffActor)
      await publishTemplate(g, t.id)
      // The member also changes their name and the gym renames itself: none of it reaches the signed record.
      await prisma.member.update({ where: { id: first.id }, data: { name: 'Renamed Person' } })
      await prisma.gymProfile.update({ where: { ownerId: g }, data: { name: 'Renamed Gym' } })
      const still = await fresh(d1.id)
      expect(still).toMatchObject({ version: 1, name: 'Liability Waiver', status: 'signed' })
      expect(JSON.stringify(still.finalSnapshot)).toBe(JSON.stringify(signed.finalSnapshot))
      expect(still.snapshotHash).toBe(signed.snapshotHash)
      // The PDF is drawn from the record, not the template: byte for byte the same, from storage or drawn again.
      expect((await signedPdf(still, staffActor, { via: 'Staff' })).pdf.equals(pdf1)).toBe(true)
      storage.files.clear()
      const redrawn = (await signedPdf(still, staffActor, { via: 'Staff' })).pdf
      expect(redrawn.equals(pdf1)).toBe(true)
      const text = pdfText(redrawn)
      expect(text).toContain('First Member')
      expect(text).toContain('Signing Gym')
      expect(text).toContain('Assumption of risk')
      expect(text).not.toContain('New wording')
      expect(text).not.toContain('Renamed')

      // Someone new gets version 2. The first member still counts as signed, and can be explicitly asked to sign version 2.
      const second = await createMember(g, { name: 'Second Member' })
      const d2 = await give(g, t.id, second.id)
      expect(d2).toMatchObject({ version: 2, name: 'Liability Waiver (revised)' })
      expect(JSON.stringify(d2.content)).toContain('New wording')
      const same = await tx((db) => assignDocument(db, { ownerId: g, templateId: t.id, memberId: first.id }))
      expect(same).toMatchObject({ created: false, document: { id: d1.id } })
      const asked = await tx((db) => assignDocument(db, { ownerId: g, templateId: t.id, memberId: first.id, again: true }))
      expect(asked).toMatchObject({ created: true, document: { version: 2, status: 'sent' } })
      await sign(asked.document, first, { fields: {} })
      const both = await prisma.memberDocument.findMany({ where: { memberId: first.id, templateId: t.id }, orderBy: { version: 'asc' } })
      expect(both.map((d) => [d.version, d.status])).toEqual([[1, 'signed'], [2, 'signed']])
      expect(JSON.stringify(both[0].finalSnapshot)).toBe(JSON.stringify(signed.finalSnapshot))
      // An unsigned copy of the old version is replaced by the new wording rather than left to be signed.
      const third = await createMember(g)
      const waiting = await give(g, t.id, third.id)
      await saveDraft(g, t.id, { body: 'Version three.' }, staffActor)
      await publishTemplate(g, t.id)
      const replaced = await give(g, t.id, third.id)
      expect(replaced.version).toBe(3)
      expect(await fresh(waiting.id)).toMatchObject({ status: 'voided', voidReason: 'Replaced by version 3' })
    })

    it('refuses to hand out a signed record that no longer matches its fingerprint', async () => {
      const g = await gym()
      const m = await createMember(g)
      const d = await give(g, (await template(g)).id, m.id)
      await sign(d, m)
      const row = await fresh(d.id)
      const tampered = { ...(row.finalSnapshot as object), signerName: 'Forged Name' }
      await prisma.memberDocument.update({ where: { id: d.id }, data: { finalSnapshot: tampered } })
      storage.files.clear()
      await expect(signedPdf(await fresh(d.id), staffActor, { via: 'Staff' })).rejects.toMatchObject({ status: 500, code: 'integrity_error' })
      // And an unsigned document has no PDF at all.
      const unsigned = await give(g, (await template(g)).id, m.id)
      await expect(signedPdf(unsigned, staffActor, { via: 'Staff' })).rejects.toMatchObject({ status: 409, code: 'not_signed' })
    })
  })

  describe('signing links', () => {
    it('are random, kept only as a hash, one at a time, and stop working when used, replaced, expired or the document is voided', async () => {
      const g = await gym()
      const t = await template(g)
      const m = await createMember(g)
      const d = await give(g, t.id, m.id)
      const token = await tx((db) => issueSigningToken(db, d))
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(token).not.toContain(m.id.slice(0, 8))
      const stored = await prisma.documentSigningToken.findMany({ where: { documentId: d.id } })
      expect(stored).toHaveLength(1)
      expect(stored[0].tokenHash).toBe(createHash('sha256').update(token).digest('hex'))
      expect(JSON.stringify(stored)).not.toContain(token)
      expect(Math.round((stored[0].expiresAt.getTime() - Date.now()) / DAY)).toBe(14)
      // Opening the link finds the document and signs nothing.
      const found = await documentForToken(token)
      expect(found.document.id).toBe(d.id)
      await openDocument(found.document, memberActor(m), { ...evidence, via: 'Signing link' })
      expect(await fresh(d.id)).toMatchObject({ status: 'viewed', signedAt: null })
      // Wrong, altered, truncated: all the same answer.
      for (const bad of [`${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`, token.slice(0, 20), `${token}x`.repeat(3), randomUUID(), '../../etc/passwd', '']) await expect(documentForToken(bad), bad.slice(0, 10)).rejects.toMatchObject({ status: 404, code: 'invalid_link' })
      // A new link replaces the old one.
      const second = await tx((db) => issueSigningToken(db, d))
      await expect(documentForToken(token)).rejects.toMatchObject({ status: 404 })
      expect((await documentForToken(second)).document.id).toBe(d.id)
      // Expired.
      await prisma.documentSigningToken.updateMany({ where: { documentId: d.id, revokedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } })
      await expect(documentForToken(second)).rejects.toMatchObject({ status: 404 })
      // Used: signing through a link spends it.
      const third = await tx((db) => issueSigningToken(db, d))
      const viaLink = await documentForToken(third)
      await signDocument({ document: viaLink.document, tokenId: viaLink.tokenId, actor: memberActor(m), evidence: { ...evidence, via: 'Signing link' }, ...signing() })
      await expect(documentForToken(third)).rejects.toMatchObject({ status: 404 })
      expect((await prisma.documentSigningToken.findFirstOrThrow({ where: { tokenHash: createHash('sha256').update(third).digest('hex') } })).usedAt).not.toBeNull()
      expect(((await fresh(d.id)).finalSnapshot as unknown as SignedSnapshot).evidence.via).toBe('Signing link')
      // Voided: the link dies with it.
      const d2 = await give(g, (await template(g)).id, m.id)
      const live = await tx((db) => issueSigningToken(db, d2))
      await voidDocument({ ownerId: g, id: d2.id, reason: 'Sent by mistake', actor: staffActor })
      await expect(documentForToken(live)).rejects.toMatchObject({ status: 404 })
      // The quarter-hour download token names one document and cannot be altered.
      const download = await signDownloadToken(await fresh(d.id))
      expect(await readDownloadToken(download)).toEqual({ documentId: d.id, ownerId: g, memberId: m.id })
      expect(await readDownloadToken(`${download}x`)).toBeNull()
      expect(await readDownloadToken(token)).toBeNull()
    })
  })

  describe('declining, voiding, resending', () => {
    it('lets a member decline where allowed, with a reason where required', async () => {
      const g = await gym()
      const m = await createMember(g)
      const strict = await give(g, (await template(g, { allowDecline: false })).id, m.id)
      await expect(declineDocument({ document: strict, reason: 'No', actor: memberActor(m), evidence })).rejects.toMatchObject({ status: 409, code: 'decline_not_allowed' })
      const needsReason = await give(g, (await template(g, { declineReasonRequired: true })).id, m.id)
      await expect(declineDocument({ document: needsReason, reason: null, actor: memberActor(m), evidence })).rejects.toMatchObject({ status: 400, code: 'reason_required' })
      const declined = await declineDocument({ document: needsReason, reason: 'I do not agree with clause 2', actor: memberActor(m), evidence })
      expect(declined.status).toBe('declined')
      const row = await fresh(needsReason.id)
      expect(row).toMatchObject({ status: 'declined', declineReason: 'I do not agree with clause 2', finalSnapshot: null, signedAt: null })
      expect(row.declinedAt).not.toBeNull()
      expect(await prisma.documentEvent.findFirstOrThrow({ where: { documentId: row.id, type: 'declined' } })).toMatchObject({ actorId: m.id, ip: '203.0.113.9', userAgent: 'Vitest', metadata: { reason: 'I do not agree with clause 2', via: 'Member app' } })
      await expect(sign(needsReason, m)).rejects.toMatchObject({ status: 409, code: 'declined' })
      expect(await prisma.notification.count({ where: { ownerId: g, type: 'document_declined' } })).toBe(1)
    })

    it('voids with a reason, keeps the record, and stops any further signing', async () => {
      const g = await gym()
      const m = await createMember(g)
      const t = await template(g)
      const unsigned = await give(g, t.id, m.id)
      const voided = await voidDocument({ ownerId: g, id: unsigned.id, reason: 'Wrong member', actor: staffActor })
      expect(voided.status).toBe('voided')
      expect(await fresh(unsigned.id)).toMatchObject({ voidReason: 'Wrong member', voidedByName: 'Sam Staff' })
      await expect(sign(unsigned, m)).rejects.toMatchObject({ status: 409, code: 'voided' })
      await expect(saveFields({ document: unsigned, fields: {}, actor: memberActor(m), evidence })).rejects.toMatchObject({ status: 409 })
      await expect(voidDocument({ ownerId: g, id: unsigned.id, reason: 'Again', actor: staffActor })).rejects.toMatchObject({ status: 409, code: 'already_voided' })
      expect(await prisma.documentEvent.findFirstOrThrow({ where: { documentId: unsigned.id, type: 'voided' } })).toMatchObject({ actorName: 'Sam Staff', metadata: { reason: 'Wrong member', wasStatus: 'sent' } })
      // A signed document that is voided keeps its signed record and can still be read.
      const d = await give(g, (await template(g)).id, m.id)
      await sign(d, m)
      const before = await fresh(d.id)
      await voidDocument({ ownerId: g, id: d.id, reason: 'Superseded by a paper copy', actor: staffActor })
      const after = await fresh(d.id)
      expect(after).toMatchObject({ status: 'voided', signedAt: before.signedAt, snapshotHash: before.snapshotHash })
      expect(JSON.stringify(after.finalSnapshot)).toBe(JSON.stringify(before.finalSnapshot))
      expect((await signedPdf(after, staffActor, { via: 'Staff' })).pdf.length).toBeGreaterThan(1000)
      expect(await prisma.memberDocument.count({ where: { id: d.id } })).toBe(1)
      // It no longer counts as signed for anything that requires it.
      await saveRequirements(g, after.templateId, [{ trigger: 'class_booking', planIds: [], classTypeIds: [], appointmentTypeIds: [], blocking: true }])
      expect(await missingRequired(prisma, g, m.id, { trigger: 'class_booking' })).toHaveLength(1)
      await expect(voidDocument({ ownerId: await gym(), id: d.id, reason: 'Not mine', actor: staffActor })).rejects.toMatchObject({ status: 404 })
    })

    it('resends the same copy with a fresh link, once however many people press the button', async () => {
      const g = await gym()
      const m = await createMember(g)
      const d = await give(g, (await template(g)).id, m.id)
      const old = await tx((db) => issueSigningToken(db, d))
      // Straight away is treated as the same send.
      expect(await resendDocument({ ownerId: g, id: d.id, actor: staffActor, origin: BASE })).toMatchObject({ resent: false })
      await prisma.memberDocument.update({ where: { id: d.id }, data: { sentAt: new Date(Date.now() - HOUR) } })
      const results = await Promise.all(Array.from({ length: 5 }, () => resendDocument({ ownerId: g, id: d.id, actor: staffActor, origin: BASE })))
      expect(results.filter((r) => r.resent)).toHaveLength(1)
      expect(await prisma.documentEvent.count({ where: { documentId: d.id, type: 'resent' } })).toBe(1)
      expect(await prisma.memberDocument.count({ where: { memberId: m.id } })).toBe(1)
      const row = await fresh(d.id)
      expect(row).toMatchObject({ id: d.id, version: 1, status: 'sent' })
      expect(Date.now() - row.sentAt!.getTime()).toBeLessThan(10_000)
      await expect(documentForToken(old)).rejects.toMatchObject({ status: 404 })
      expect(await prisma.documentSigningToken.count({ where: { documentId: d.id, revokedAt: null, usedAt: null } })).toBe(1)
      await sign(d, m)
      await expect(resendDocument({ ownerId: g, id: d.id, actor: staffActor, origin: BASE })).rejects.toMatchObject({ status: 409, code: 'already_signed' })
      await expect(resendDocument({ ownerId: await gym(), id: d.id, actor: staffActor, origin: BASE })).rejects.toMatchObject({ status: 404 })
    })
  })

  describe('expiry and reminders', () => {
    it('expires an unsigned document after its deadline and a signature after its validity, keeping what was signed', async () => {
      const g = await gym()
      const m = await createMember(g)
      const t = await template(g, { signWithinDays: 7, validForDays: 365 })
      await saveRequirements(g, t.id, [{ trigger: 'class_booking', planIds: [], classTypeIds: [], appointmentTypeIds: [], blocking: true }])
      const d = await give(g, t.id, m.id)
      expect(Math.round((d.signBy!.getTime() - Date.now()) / DAY)).toBe(7)
      expect(await expireDocuments(g)).toBe(0)
      // Past the deadline: it cannot be signed even before the nightly job has run, and opening it says so.
      await prisma.memberDocument.update({ where: { id: d.id }, data: { signBy: new Date(Date.now() - 1000) } })
      await expect(sign(await fresh(d.id), m)).rejects.toMatchObject({ status: 409, code: 'expired' })
      expect((await openDocument(await fresh(d.id), memberActor(m), evidence)).status).toBe('expired')
      expect(await fresh(d.id)).toMatchObject({ status: 'expired', finalSnapshot: null })
      expect(await expireDocuments(g)).toBe(0)

      const again = await give(g, t.id, m.id)
      expect(again.id).not.toBe(d.id)
      await sign(again, m)
      const signed = await fresh(again.id)
      expect(await missingRequired(prisma, g, m.id, { trigger: 'class_booking' })).toEqual([])
      // A year later the signature runs out. The record is still there, still downloadable, and they are asked afresh.
      const later = new Date(signed.validUntil!.getTime() + 1000)
      expect(await expireDocuments(g, later)).toBe(1)
      const lapsed = await fresh(again.id)
      expect(lapsed).toMatchObject({ status: 'expired', signedAt: signed.signedAt, snapshotHash: signed.snapshotHash })
      expect(JSON.stringify(lapsed.finalSnapshot)).toBe(JSON.stringify(signed.finalSnapshot))
      expect(pdfText((await signedPdf(lapsed, staffActor, { via: 'Staff' })).pdf)).toContain('Signature record')
      expect(await events(again.id)).toContain('expired')
      expect(await expireDocuments(g, later)).toBe(0)
      const centre = await memberDocuments(g, m.id)
      expect(centre.expired.map((x) => x.id).sort()).toEqual([d.id, again.id].sort())
      expect(await missingRequired(prisma, g, m.id, { trigger: 'class_booking' })).toHaveLength(1)
      const renewed = await requireDocuments(g, m.id, { trigger: 'class_booking' }, { enforce: false })
      expect(renewed).toHaveLength(1)
      expect(renewed[0].id).not.toBe(again.id)
      expect((await memberDocuments(g, m.id)).actionRequired).toHaveLength(1)
    })

    it('sends one reminder for a document left unsigned for three days', async () => {
      const g = await gym()
      const m = await createMember(g)
      const d = await give(g, (await template(g)).id, m.id)
      expect(await remindUnsigned(BASE, g)).toBe(0)
      await prisma.memberDocument.update({ where: { id: d.id }, data: { sentAt: new Date(Date.now() - 4 * DAY) } })
      const runs = await Promise.all([remindUnsigned(BASE, g), remindUnsigned(BASE, g), remindUnsigned(BASE, g)])
      expect(runs.reduce((a, b) => a + b, 0)).toBe(1)
      expect(await remindUnsigned(BASE, g)).toBe(0)
      expect(await events(d.id)).toContain('reminded')
      expect((await fresh(d.id)).remindedAt).not.toBeNull()
      // A signed one is never reminded.
      const d2 = await give(g, (await template(g)).id, m.id)
      await sign(d2, m)
      await prisma.memberDocument.update({ where: { id: d2.id }, data: { sentAt: new Date(Date.now() - 9 * DAY) } })
      expect(await remindUnsigned(BASE, g)).toBe(0)
    })
  })

  describe('required documents in other workflows', () => {
    const slot = (days: number, time: string) => zonedToUtc(addDaysToDate(zonedParts(new Date(), TZ).date, days), time, TZ)
    async function site(ownerId: string, extra: Record<string, unknown> = {}) {
      await getBookingSite(ownerId)
      const slug = `d-${randomUUID().slice(0, 12)}`
      await saveBookingSite(ownerId, siteSchema.parse({ enabled: true, slug, displayName: null, tagline: null, primaryColor: '#0f766e', buttonStyle: 'rounded', appearance: 'light', showLogo: true, locationIds: [], allClassTypes: true, classTypeIds: [], appointmentTypeIds: [], requireAccount: false, allowGuests: true, advanceDays: null, cancellationPolicy: null, contactEmail: null, contactPhone: null, termsUrl: null, ...extra }))
      return resolveSite(slug)
    }
    async function appointmentType(ownerId: string) {
      const coach = await prisma.staff.create({ data: { ownerId, name: 'Coach', email: `${randomUUID()}@test.local`, password: 'x', role: 'coach', isCoach: true } })
      await prisma.staffAvailability.createMany({ data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ ownerId, staffId: coach.id, weekday, startMinute: 480, endMinute: 1200, kind: 'work' })) })
      const type = await prisma.appointmentType.create({ data: { ownerId, name: 'PT Intro', durationMin: 60, paymentMode: 'included', minNoticeMinutes: 0, maxAdvanceDays: 60, cancelWindowHours: 12, memberBookable: true } })
      await prisma.appointmentTypeStaff.create({ data: { ownerId, typeId: type.id, staffId: coach.id } })
      return { type, coach }
    }

    it('sends signup documents to every new member, and nothing to anyone when nothing is required', async () => {
      const g = await gym()
      const plain = await tx((db) => createMemberService(db, g, { name: 'No Rules', email: `nr-${randomUUID()}@test.local` }))
      expect(await prisma.memberDocument.count({ where: { memberId: plain.id } })).toBe(0)
      const waiver = await template(g)
      const draftOnly = await createTemplate(g, templateCreateSchema.parse({ name: 'Unpublished', title: 'Unpublished', body: 'Draft' }), staffActor)
      await saveRequirements(g, waiver.id, [{ trigger: 'member_signup', planIds: [], classTypeIds: [], appointmentTypeIds: [], blocking: true }])
      await saveRequirements(g, draftOnly.id, [{ trigger: 'member_signup', planIds: [], classTypeIds: [], appointmentTypeIds: [], blocking: true }])
      const joined = await tx((db) => createMemberService(db, g, { name: 'New Joiner', email: `nj-${randomUUID()}@test.local` }))
      const docs = await prisma.memberDocument.findMany({ where: { memberId: joined.id } })
      // The published one only: a template that has never been published cannot be required of anyone.
      expect(docs).toHaveLength(1)
      expect(docs[0]).toMatchObject({ templateId: waiver.id, status: 'sent', source: 'member_signup' })
      expect(JSON.stringify(docs[0].content)).toContain('New Joiner')
      // A rule cannot point at another gym's plans or class types.
      const theirPlan = await createPlan(await gym())
      await expect(saveRequirements(g, waiver.id, [{ trigger: 'membership_purchase', planIds: [theirPlan.id], classTypeIds: [], appointmentTypeIds: [], blocking: true }])).rejects.toMatchObject({ status: 404 })
    })

    it('holds a member\'s own membership purchase until the agreement for that plan is signed', async () => {
      const g = await gym()
      const trial = await createPlan(g, { name: 'Free Trial', type: 'trial', priceCents: 0, credits: 1, isPublic: true })
      const other = await createPlan(g, { name: 'Other Free', type: 'free', priceCents: 0, isPublic: true })
      const agreement = await template(g, { type: 'membership_agreement', title: 'Membership Agreement', fields: [] })
      await saveRequirements(g, agreement.id, [{ trigger: 'membership_purchase', planIds: [trial.id], classTypeIds: [], appointmentTypeIds: [], blocking: true }])
      const m = await createMember(g, { status: 'inactive' })
      const buy = (planId: string) => buyPlanWithSavedMethod({ ownerId: g, memberId: m.id, planId, types: ['trial', 'free'], actor: memberActor(m) })
      const refused = await buy(trial.id).catch((e) => e)
      expect(refused).toMatchObject({ status: 409, code: 'documents_required' })
      expect(refused.message).toBe('Please sign Membership Agreement first.')
      const [needed] = refused.details.documents
      expect(needed).toMatchObject({ name: 'Membership Agreement', type: 'membership_agreement' })
      expect(await prisma.membership.count({ where: { memberId: m.id } })).toBe(0)
      // Asking again does not pile up copies.
      await buy(trial.id).catch(() => {})
      expect(await prisma.memberDocument.count({ where: { memberId: m.id } })).toBe(1)
      // A plan the rule does not cover is not held up.
      expect((await buy(other.id)).membership.status).toBeTruthy()
      // Declining leaves the purchase unmade; a fresh copy is offered next time they try.
      await declineDocument({ document: await fresh(needed.id), reason: null, actor: memberActor(m), evidence })
      const stillRefused = await buy(trial.id).catch((e) => e)
      expect(stillRefused).toMatchObject({ status: 409, code: 'documents_required' })
      expect(stillRefused.details.documents[0].id).not.toBe(needed.id)
      expect(await prisma.membership.count({ where: { memberId: m.id, planId: trial.id } })).toBe(0)
      await sign(await fresh(stillRefused.details.documents[0].id), m, { fields: {} })
      expect((await buy(trial.id)).plan.name).toBe('Free Trial')
      // Staff selling at the desk are not stopped: the agreement is assigned for the member to sign.
      const walkIn = await createMember(g)
      await tx((db) => sellMembership(db, { ownerId: g, memberId: walkIn.id, planId: trial.id, paymentMethod: 'cash' }))
      const assigned = await requireDocuments(g, walkIn.id, { trigger: 'membership_purchase', planId: trial.id }, { enforce: false })
      expect(assigned).toMatchObject([{ name: 'Membership Agreement', blocking: true, status: 'sent' }])
    })

    it('holds a class booking from the public page until the waiver is signed, and not at all if it is declined', async () => {
      const g = await gym()
      const s = await site(g)
      const plan = await createPlan(g)
      const session = await createSession(g, { capacity: 5 })
      const otherClass = await createSession(g, { capacity: 5 })
      const waiver = await template(g, { title: 'Class Waiver', fields: [] })
      await saveRequirements(g, waiver.id, [{ trigger: 'class_booking', planIds: [], classTypeIds: [session.classTypeId], appointmentTypeIds: [], blocking: true }])
      const m = await createMember(g)
      await tx((db) => sellMembership(db, { ownerId: g, memberId: m.id, planId: plan.id, paymentMethod: 'cash' }))
      const member = await prisma.member.findUniqueOrThrow({ where: { id: m.id } })
      const viewer = { member, hasAccount: true }
      const refused = await bookClassOnline(s, viewer, { classId: session.id }, BASE).catch((e) => e)
      expect(refused).toMatchObject({ status: 409, code: 'documents_required' })
      expect(await prisma.booking.count({ where: { memberId: m.id } })).toBe(0)
      // A class the rule does not name is unaffected.
      const free = await bookClassOnline(s, viewer, { classId: otherClass.id }, BASE)
      expect(free.status).toBe('booked')
      // The member app goes through the same gate.
      await expect(classDocumentsGate(g, m.id, session.id)).rejects.toMatchObject({ code: 'documents_required' })
      // Declined: the booking is not made, however many times they try.
      await declineDocument({ document: await fresh(refused.details.documents[0].id), reason: 'No thanks', actor: memberActor(member), evidence })
      await expect(bookClassOnline(s, viewer, { classId: session.id }, BASE)).rejects.toMatchObject({ code: 'documents_required' })
      expect(await prisma.booking.count({ where: { memberId: m.id, sessionId: session.id } })).toBe(0)
      // Signed: it goes through, and the next booking of that class type asks for nothing.
      const next = await bookClassOnline(s, viewer, { classId: session.id }, BASE).catch((e) => e)
      await sign(await fresh(next.details.documents[0].id), member, { fields: {} })
      expect((await bookClassOnline(s, viewer, { classId: session.id }, BASE)).status).toBe('booked')
      // Staff booking the same class for someone else is not held up by it.
      const walkIn = await createMember(g)
      await tx((db) => sellMembership(db, { ownerId: g, memberId: walkIn.id, planId: plan.id, paymentMethod: 'cash' }))
      expect((await tx((db) => bookClass(db, { ownerId: g, memberId: walkIn.id, sessionId: session.id, joinWaitlist: false, source: 'staff' }))).booking.status).toBe('booked')
    })

    it('holds a member\'s own appointment booking until the appointment waiver is signed, and only assigns when a rule is not blocking', async () => {
      const g = await gym()
      const { type } = await appointmentType(g)
      const s = await site(g, { appointmentTypeIds: [type.id] })
      const waiver = await template(g, { title: 'PT Waiver', fields: [] })
      const notice = await template(g, { title: 'House Rules', type: 'policy', fields: [], requireSignature: false })
      await saveRequirements(g, waiver.id, [{ trigger: 'appointment_booking', planIds: [], classTypeIds: [], appointmentTypeIds: [type.id], blocking: true }])
      await saveRequirements(g, notice.id, [{ trigger: 'appointment_booking', planIds: [], classTypeIds: [], appointmentTypeIds: [], blocking: false }])
      const m = await createMember(g)
      const viewer = { member: m, hasAccount: false }
      const refused = await bookAppointmentOnline(s, viewer, { typeId: type.id, startsAt: slot(3, '10:00') }, BASE).catch((e) => e)
      expect(refused).toMatchObject({ status: 409, code: 'documents_required' })
      // Only the blocking one is listed as in the way; the other is simply waiting for them.
      expect(refused.details.documents.map((d: { name: string }) => d.name)).toEqual(['PT Waiver'])
      expect((await memberDocuments(g, m.id)).actionRequired.map((d) => d.name).sort()).toEqual(['House Rules', 'PT Waiver'])
      expect(await prisma.appointment.count({ where: { memberId: m.id } })).toBe(0)
      await sign(await fresh(refused.details.documents[0].id), m, { fields: {} })
      const booked = await bookAppointmentOnline(s, viewer, { typeId: type.id, startsAt: slot(3, '10:00') }, BASE)
      expect(booked.status).toBe('booked')
      // The member app's own route calls the same engine with source "member"; staff are not stopped.
      const second = await createMember(g)
      await expect(bookAppointment({ ownerId: g, typeId: type.id, memberId: second.id, startsAt: slot(3, '13:00'), source: 'member' })).rejects.toMatchObject({ code: 'documents_required' })
      expect((await bookAppointment({ ownerId: g, typeId: type.id, memberId: second.id, startsAt: slot(3, '13:00'), source: 'staff' })).appointment.status).toBe('booked')
    })
  })

  it('finds documents by member, name, type, status, signed or not, and expiry, inside one gym', async () => {
    const g = await gym()
    const other = await gym()
    const waiver = await template(g, { validForDays: 20, title: 'Findable Waiver' })
    const policy = await template(g, { type: 'policy', title: 'House Policy', fields: [], requireSignature: false })
    const ann = await createMember(g, { name: 'Ann Searchable', email: 'ann.find@test.local' })
    const ben = await createMember(g, { name: 'Ben Other' })
    const a1 = await give(g, waiver.id, ann.id)
    await give(g, policy.id, ann.id)
    const b1 = await give(g, waiver.id, ben.id)
    await sign(a1, ann)
    await declineDocument({ document: b1, reason: null, actor: memberActor(ben), evidence })
    await give(other, (await template(other, { title: 'Findable Waiver' })).id, (await createMember(other, { name: 'Ann Searchable' })).id)
    const find = async (f: Record<string, unknown>) => (await searchDocuments(g, { skip: 0, take: 50, ...f })).items.map((d) => `${d.member.name}:${d.name}:${d.status}`).sort()
    expect(await find({})).toEqual(['Ann Searchable:Findable Waiver:signed', 'Ann Searchable:House Policy:sent', 'Ben Other:Findable Waiver:declined'])
    expect(await find({ search: 'ann' })).toHaveLength(2)
    expect(await find({ search: 'ann.find@' })).toHaveLength(2)
    expect(await find({ search: 'house' })).toEqual(['Ann Searchable:House Policy:sent'])
    expect(await find({ type: 'policy' })).toEqual(['Ann Searchable:House Policy:sent'])
    expect(await find({ status: 'declined' })).toEqual(['Ben Other:Findable Waiver:declined'])
    expect(await find({ signed: 'yes' })).toEqual(['Ann Searchable:Findable Waiver:signed'])
    expect(await find({ signed: 'no' })).toHaveLength(2)
    expect(await find({ memberId: ben.id })).toHaveLength(1)
    expect(await find({ expiringBefore: new Date(Date.now() + 30 * DAY) })).toEqual(['Ann Searchable:Findable Waiver:signed'])
    expect(await find({ expiringBefore: new Date(Date.now() + 5 * DAY) })).toEqual([])
    expect(await find({ from: new Date(Date.now() + DAY) })).toEqual([])
    const all = await searchDocuments(g, { skip: 0, take: 50 })
    expect(all.counts).toEqual({ signed: 1, sent: 1, declined: 1 })
    expect(JSON.stringify(all)).not.toMatch(/strokes|finalSnapshot|"content"|emergency/)
    const detail = await documentDetail(g, a1.id)
    expect(detail.events.map((e) => e.type)).toEqual(['assigned', 'sent', 'consent_given', 'signed'])
    expect(JSON.stringify(detail)).not.toMatch(/strokes|Sam Signer/)
    await expect(documentDetail(other, a1.id)).rejects.toMatchObject({ status: 404 })
  })
})

// ===========================================================================
describe.skipIf(!up)('documents over HTTP', () => {
  type Res = { status: number; json: any; data: any; text: string; headers: Headers; bytes: Buffer }
  async function call(auth: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
    const res = await fetch(BASE + path, {
      method, redirect: 'manual',
      headers: { 'X-Forwarded-For': `198.18.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`, ...(auth && (auth.startsWith('Bearer ') ? { Authorization: auth } : { Cookie: auth })), ...(body !== undefined && { 'Content-Type': 'application/json' }), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const bytes = Buffer.from(await res.arrayBuffer())
    const text = bytes.toString('latin1')
    let json: any = null
    try { json = JSON.parse(bytes.toString('utf8')) } catch {}
    return { status: res.status, json, data: json?.data, text, headers: res.headers, bytes }
  }
  let gymA: string
  let gymB: string
  const staff: Record<string, string> = {}
  let ownerB: string
  let waiver: Awaited<ReturnType<typeof template>>
  let me: Member
  let bearer: string
  let other: Member
  let otherBearer: string
  let outsiderBearer: string
  const signBody = (extra: Record<string, unknown> = {}) => ({ action: 'sign', consent: true, read: true, signerName: 'Wendy Signer', signature: drawn, fields: { emergency_name: 'Sam Signer' }, ...extra })
  async function account(ownerId: string, data: Record<string, unknown> = {}) {
    const member = await createMember(ownerId, data)
    const { token } = await createInvite(ownerId, member.id)
    await setPasswordWithToken(token, 'correct-horse-42')
    return { member, bearer: await memberBearer(member.id) }
  }

  beforeAll(async () => {
    gymA = await gym()
    gymB = await gym()
    staff.owner = `auth-token=${await createToken({ ownerId: gymA, emailVerified: true })}`
    ownerB = `auth-token=${await createToken({ ownerId: gymB, emailVerified: true })}`
    for (const role of ['admin', 'manager', 'front_desk', 'sales', 'accountant', 'coach', 'trainer'] as const) {
      const row = await prisma.staff.create({ data: { ownerId: gymA, name: `Test ${role}`, email: `${role}-${randomUUID()}@test.local`, password: 'x', role } })
      staff[role] = `auth-token=${await createToken({ ownerId: gymA, staffId: row.id, role })}`
    }
    waiver = await template(gymA)
    ;({ member: me, bearer } = await account(gymA, { name: 'Wendy Signer' }))
    ;({ member: other, bearer: otherBearer } = await account(gymA))
    outsiderBearer = (await account(gymB)).bearer
  })

  it('gives every staff role exactly the document access it should have, checked on the server', async () => {
    const sample = await give(gymA, waiver.id, other.id)
    await sign(sample, other)
    const waiting = await give(gymA, (await template(gymA)).id, other.id)
    const allowed = {
      view: ['owner', 'admin', 'manager', 'front_desk', 'sales', 'accountant'],
      send: ['owner', 'admin', 'manager', 'front_desk', 'sales'],
      download: ['owner', 'admin', 'manager', 'accountant'],
      manage: ['owner', 'admin', 'manager'],
    }
    const draft = { name: 'By Role', title: 'By Role', body: 'Text' }
    for (const role of Object.keys(staff)) {
      const c = staff[role]
      const expectStatus = async (kind: keyof typeof allowed, method: string, path: string, body?: unknown, ok = 200) => {
        const r = await call(c, method, path, body)
        expect(r.status, `${role} ${method} ${path} ${JSON.stringify(body || '').slice(0, 40)}`).toBe(allowed[kind].includes(role) ? ok : 403)
        return r
      }
      await expectStatus('view', 'GET', '/api/documents')
      await expectStatus('view', 'GET', '/api/documents/templates')
      await expectStatus('view', 'GET', `/api/documents/templates/${waiver.id}`)
      await expectStatus('view', 'GET', `/api/documents/${sample.id}`)
      await expectStatus('view', 'GET', `/api/members/${other.id}/documents`)
      await expectStatus('download', 'GET', `/api/documents/${sample.id}/pdf`)
      const made = await expectStatus('manage', 'POST', '/api/documents/templates', draft)
      await expectStatus('manage', 'PATCH', `/api/documents/templates/${waiver.id}`, { description: `Edited by ${role}` })
      await expectStatus('manage', 'POST', `/api/documents/templates/${waiver.id}`, { action: 'requirements', requirements: [] })
      if (made.status === 200) {
        expect((await call(c, 'POST', `/api/documents/templates/${made.data.id}`, { action: 'save_draft', draft: { body: 'Better text' } })).status).toBe(200)
        expect((await call(c, 'POST', `/api/documents/templates/${made.data.id}`, { action: 'publish' })).status).toBe(200)
        expect((await call(c, 'POST', `/api/documents/templates/${made.data.id}`, { action: 'archive' })).status).toBe(200)
      } else {
        for (const action of ['publish', 'archive', 'duplicate', 'discard_draft']) expect((await call(c, 'POST', `/api/documents/templates/${waiver.id}`, { action })).status, `${role} ${action}`).toBe(403)
        expect((await call(c, 'POST', `/api/documents/templates/${waiver.id}`, { action: 'save_draft', draft: { body: 'Hijack' } })).status, role).toBe(403)
      }
      const target = await createMember(gymA)
      await expectStatus('send', 'POST', `/api/documents/templates/${waiver.id}`, { action: 'send', memberIds: [target.id] })
      await expectStatus('send', 'POST', `/api/documents/${waiting.id}`, { action: 'resend' })
      // Voiding is for those who manage documents: front desk and sales can send but not void.
      const victim = await give(gymA, waiver.id, (await createMember(gymA)).id)
      await expectStatus('manage', 'POST', `/api/documents/${victim.id}`, { action: 'void', reason: 'Role check' })
    }
    expect((await fresh(waiver.id.length ? sample.id : sample.id)).status).toBe('signed')
    // Signed out, and members, get nothing from the staff side.
    for (const auth of [null, bearer]) for (const path of ['/api/documents', '/api/documents/templates', `/api/documents/${sample.id}`, `/api/documents/${sample.id}/pdf`, `/api/members/${other.id}/documents`]) expect((await call(auth, 'GET', path)).status, path).toBe(401)
    // Seeing a document was signed is not seeing what it says: no wording, answers or signature in staff listings.
    const detail = await call(staff.front_desk, 'GET', `/api/documents/${sample.id}`)
    expect(detail.data).toMatchObject({ status: 'signed', canDownload: false, canSend: true, canManage: false, signerName: 'Wendy Signer' })
    expect(detail.text).not.toMatch(/strokes|Sam Signer|Assumption of risk|finalSnapshot/)
    expect(detail.data.events.map((e: any) => e.type)).toEqual(expect.arrayContaining(['assigned', 'sent', 'signed', 'downloaded']))
    // Voiding needs a reason.
    const noReason = await call(staff.owner, 'POST', `/api/documents/${waiting.id}`, { action: 'void', reason: ' ' })
    expect(noReason.status).toBe(400)
    // There is no way to edit or delete a document or its history through the API.
    for (const [method, path] of [['PATCH', `/api/documents/${sample.id}`], ['PUT', `/api/documents/${sample.id}`], ['DELETE', `/api/documents/${sample.id}`], ['DELETE', `/api/documents/${sample.id}/pdf`], ['POST', `/api/documents/${sample.id}/events`], ['DELETE', `/api/documents/templates/${waiver.id}`]] as const) {
      expect([404, 405], `${method} ${path}`).toContain((await call(staff.owner, method, path, {})).status)
    }
    const eventsBefore = await prisma.documentEvent.count({ where: { documentId: sample.id } })
    expect((await call(staff.owner, 'POST', `/api/documents/${sample.id}`, { action: 'edit_event', id: 'x', type: 'signed' })).status).toBe(400)
    expect(await prisma.documentEvent.count({ where: { documentId: sample.id } })).toBe(eventsBefore)
    expect((await fresh(sample.id)).status).toBe('signed')
  })

  it('keeps one gym\'s templates and documents out of another gym\'s reach', async () => {
    const doc = await give(gymA, waiver.id, me.id)
    const theirMember = await createMember(gymB)
    for (const [method, path, body] of [
      ['GET', `/api/documents/${doc.id}`], ['GET', `/api/documents/${doc.id}/pdf`], ['POST', `/api/documents/${doc.id}`, { action: 'void', reason: 'Not mine' }], ['POST', `/api/documents/${doc.id}`, { action: 'resend' }],
      ['GET', `/api/documents/templates/${waiver.id}`], ['PATCH', `/api/documents/templates/${waiver.id}`, { name: 'Hijacked' }], ['POST', `/api/documents/templates/${waiver.id}`, { action: 'publish' }], ['POST', `/api/documents/templates/${waiver.id}`, { action: 'duplicate' }],
      ['POST', `/api/documents/templates/${waiver.id}`, { action: 'send', memberIds: [theirMember.id] }], ['GET', `/api/members/${me.id}/documents`],
    ] as const) expect((await call(ownerB, method, path, body)).status, `${method} ${path}`).toBe(404)
    // Gym A cannot send its own template to gym B's member either.
    expect((await call(staff.owner, 'POST', `/api/documents/templates/${waiver.id}`, { action: 'send', memberIds: [theirMember.id] })).status).toBe(404)
    expect(await prisma.memberDocument.count({ where: { memberId: theirMember.id } })).toBe(0)
    const list = await call(ownerB, 'GET', `/api/documents?search=${encodeURIComponent('Wendy')}`)
    expect(list.json.data).toEqual([])
    expect((await call(ownerB, 'GET', `/api/documents?memberId=${me.id}`)).json.data).toEqual([])
    expect((await call(ownerB, 'GET', '/api/documents/templates')).data).toEqual([])
    expect(await fresh(doc.id)).toMatchObject({ status: 'sent' })
    expect((await prisma.documentTemplate.findUniqueOrThrow({ where: { id: waiver.id } })).name).not.toBe('Hijacked')
    await voidDocument({ ownerId: gymA, id: doc.id, reason: 'Clean up', actor: staffActor })
  })

  it('lets a member read, complete, sign and download their own document, and nobody else\'s', async () => {
    const doc = await give(gymA, (await template(gymA, { title: 'My Own Waiver' })).id, me.id)
    const portal = '/api/portal/me/documents'
    expect((await call(null, 'GET', portal)).status).toBe(401)
    const centre = await call(bearer, 'GET', portal)
    expect(centre.status).toBe(200)
    expect(centre.data.actionRequired.map((d: any) => d.id)).toContain(doc.id)
    expect(centre.data.actionRequired.find((d: any) => d.id === doc.id)).toMatchObject({ name: 'My Own Waiver', type: 'waiver', status: 'sent' })
    // Another member of the same gym, a member of another gym, and nobody: no document.
    for (const auth of [otherBearer, outsiderBearer]) {
      expect((await call(auth, 'GET', `${portal}/${doc.id}`)).status).toBe(404)
      expect((await call(auth, 'POST', `${portal}/${doc.id}`, signBody())).status).toBe(404)
      expect((await call(auth, 'POST', `${portal}/${doc.id}`, { action: 'decline', reason: 'Sabotage' })).status).toBe(404)
      expect((await call(auth, 'GET', `${portal}/${doc.id}/pdf`)).status).toBe(404)
      expect((await call(auth, 'GET', portal)).data.actionRequired.map((d: any) => d.id)).not.toContain(doc.id)
    }
    expect(await fresh(doc.id)).toMatchObject({ status: 'sent', viewedAt: null })

    const view = await call(bearer, 'GET', `${portal}/${doc.id}`, undefined, { 'User-Agent': 'TestPhone/1.0', 'X-Forwarded-For': '203.0.113.77' })
    expect(view.data).toMatchObject({ status: 'viewed', title: 'My Own Waiver', can: { sign: true, decline: true, download: false } })
    expect(JSON.stringify(view.data.blocks)).toContain('Wendy Signer')
    expect((await call(bearer, 'GET', `${portal}/${doc.id}/pdf`)).status).toBe(409)
    expect((await call(bearer, 'POST', `${portal}/${doc.id}`, { action: 'begin' })).data).toEqual({ noted: true })
    expect((await call(bearer, 'POST', `${portal}/${doc.id}`, { action: 'begin' })).data).toEqual({ noted: false })
    expect((await call(bearer, 'POST', `${portal}/${doc.id}`, { action: 'fields', fields: { emergency_name: 'Sam' } })).data).toEqual({ saved: true })
    // No consent, not read, missing answers, no signature: each refused, nothing signed.
    for (const [bad, code] of [[{ consent: false }, 'validation_error'], [{ consent: undefined }, 'validation_error'], [{ read: false }, 'validation_error'], [{ fields: {} }, 'fields_incomplete'], [{ signature: null }, 'signature_required'], [{ signature: { method: 'drawn', width: 10, height: 10, strokes: [] } }, 'validation_error']] as const) {
      const r = await call(bearer, 'POST', `${portal}/${doc.id}`, signBody(bad))
      expect(r.status, JSON.stringify(bad)).toBe(400)
      expect(r.json.code, JSON.stringify(bad)).toBe(code)
    }
    expect((await fresh(doc.id)).status).toBe('partially_completed')
    // A double click: two requests at once, one signature.
    const [one, two] = await Promise.all([0, 1].map(() => call(bearer, 'POST', `${portal}/${doc.id}`, signBody(), { 'User-Agent': 'TestPhone/1.0', 'X-Forwarded-For': '203.0.113.77' })))
    expect([one.status, two.status].sort()).toEqual([200, 409])
    const done = one.status === 200 ? one : two
    expect(done.data).toMatchObject({ status: 'signed' })
    expect(done.text).not.toContain('strokes')
    const row = await fresh(doc.id)
    expect(row).toMatchObject({ status: 'signed', signedIp: '203.0.113.77', signedUserAgent: 'TestPhone/1.0', signerName: 'Wendy Signer' })
    expect(await prisma.documentEvent.count({ where: { documentId: doc.id, type: 'signed' } })).toBe(1)
    expect(await events(doc.id)).toEqual(expect.arrayContaining(['viewed', 'signature_started', 'fields_saved', 'consent_given', 'signed']))
    // Signed: it cannot be signed again, declined or changed, by them or anyone.
    for (const body of [signBody({ signerName: 'Changed' }), { action: 'decline', reason: 'Changed my mind' }, { action: 'fields', fields: { emergency_name: 'Changed' } }]) expect((await call(bearer, 'POST', `${portal}/${doc.id}`, body)).status).toBe(409)
    expect(JSON.stringify((await fresh(doc.id)).finalSnapshot)).toBe(JSON.stringify(row.finalSnapshot))
    // Their own copy, as a PDF, only for them.
    const pdf = await call(bearer, 'GET', `${portal}/${doc.id}/pdf`)
    expect(pdf.status).toBe(200)
    expect(pdf.headers.get('content-type')).toBe('application/pdf')
    expect(pdf.headers.get('content-disposition')).toMatch(/^attachment; filename="My-Own-Waiver-Wendy-Signer-v1\.pdf"$/)
    expect(pdf.headers.get('cache-control')).toContain('no-store')
    expect(pdf.text.startsWith('%PDF-1.4')).toBe(true)
    expect(pdfText(pdf.bytes)).toContain('Sam Signer')
    expect(pdf.text).toContain(row.snapshotHash!)
    const staffCopy = await call(staff.owner, 'GET', `/api/documents/${doc.id}/pdf`)
    expect(staffCopy.bytes.equals(pdf.bytes)).toBe(true)
    // The quarter-hour link given at signing works without signing in, and cannot be altered or pointed elsewhere.
    const open = await call(null, 'GET', `/api/public/documents/${done.data.downloadToken}`)
    expect(open.status).toBe(200)
    expect(open.bytes.equals(pdf.bytes)).toBe(true)
    for (const bad of [`${done.data.downloadToken}x`, 'nonsense', doc.id, bearer.replace('Bearer ', '')]) expect((await call(null, 'GET', `/api/public/documents/${bad}`)).status, bad.slice(0, 12)).toBe(404)
    for (const path of [`/api/documents/${doc.id}/pdf`, `/api/portal/me/documents/${doc.id}/pdf`, `/documents/${doc.id}.pdf`, `/api/public/documents/${doc.id}`]) expect((await call(null, 'GET', path)).status, path).not.toBe(200)
    expect((await call(bearer, 'GET', portal)).data.signed.map((d: any) => d.id)).toContain(doc.id)
  })

  it('signs through an emailed link without an account, once, and never by merely opening it', async () => {
    const guest = await createMember(gymA, { name: 'Lina Link', email: `lina-${randomUUID()}@test.local` })
    const doc = await give(gymA, (await template(gymA, { title: 'Linked Waiver' })).id, guest.id)
    const token = await tx((db) => issueSigningToken(db, doc))
    const url = `/api/public/sign/${token}`
    const view = await call(null, 'GET', url)
    expect(view.status).toBe(200)
    expect(view.data).toMatchObject({ title: 'Linked Waiver', status: 'viewed', gymName: 'Signing Gym', signerHint: 'Lina Link', can: { sign: true } })
    expect(view.headers.get('cache-control')).toBe('no-store')
    expect(view.headers.get('x-robots-tag')).toBe('noindex')
    expect(view.text).not.toMatch(new RegExp(`${guest.id}|${gymA}|ownerId|memberId`))
    // Opening it any number of times signs nothing.
    await call(null, 'GET', url); await call(null, 'GET', url)
    expect(await fresh(doc.id)).toMatchObject({ status: 'viewed', signedAt: null, finalSnapshot: null })
    expect((await call(null, 'POST', url, signBody({ consent: false, signerName: 'Lina Link' }))).status).toBe(400)
    expect((await call(null, 'POST', url, { action: 'nonsense' })).status).toBe(400)
    const page = await call(null, 'GET', `/sign/${token}`)
    expect(page.status).toBe(200)
    expect(page.text).toMatch(/noindex/)
    expect(page.text).toMatch(/name="referrer" content="no-referrer"/)
    const signed = await call(null, 'POST', url, signBody({ signerName: 'Lina Link' }), { 'X-Forwarded-For': '203.0.113.50' })
    expect(signed.status, signed.text).toBe(200)
    expect(signed.data).toMatchObject({ status: 'signed' })
    expect(await fresh(doc.id)).toMatchObject({ status: 'signed', signerName: 'Lina Link', signedIp: '203.0.113.50' })
    expect((await call(null, 'GET', `/api/public/documents/${signed.data.downloadToken}`)).text.startsWith('%PDF')).toBe(true)
    // The link is spent.
    for (const [method, body] of [['GET', undefined], ['POST', signBody()], ['POST', { action: 'decline', reason: 'Too late' }]] as const) {
      const r = await call(null, method, url, body)
      expect(r.status).toBe(404)
      expect(r.json.code).toBe('invalid_link')
    }
    // Altered, expired, revoked: the same plain answer, and nothing in it about why.
    const second = await give(gymA, (await template(gymA)).id, guest.id)
    const live = await tx((db) => issueSigningToken(db, second))
    const answers = [await call(null, 'GET', `/api/public/sign/${live.slice(0, -2)}zz`), await call(null, 'GET', `/api/public/sign/${randomUUID()}`), await call(null, 'GET', '/api/public/sign/short')]
    await prisma.documentSigningToken.updateMany({ where: { documentId: second.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    answers.push(await call(null, 'GET', `/api/public/sign/${live}`), await call(null, 'POST', `/api/public/sign/${live}`, signBody()))
    const revoked = await tx((db) => issueSigningToken(db, second))
    await call(staff.owner, 'POST', `/api/documents/${second.id}`, { action: 'void', reason: 'Withdrawn' })
    answers.push(await call(null, 'GET', `/api/public/sign/${revoked}`), await call(null, 'POST', `/api/public/sign/${revoked}`, signBody()))
    for (const r of answers) { expect(r.status).toBe(404); expect(r.json).toEqual(answers[0].json) }
    expect(await fresh(second.id)).toMatchObject({ status: 'voided', signedAt: null })
    // An archived member's link and download token expose nothing.
    const leaver = await createMember(gymA)
    const theirs = await give(gymA, waiver.id, leaver.id)
    await sign(theirs, leaver)
    const theirDownload = await signDownloadToken(await fresh(theirs.id))
    const pending = await give(gymA, (await template(gymA)).id, leaver.id)
    const theirLink = await tx((db) => issueSigningToken(db, pending))
    await prisma.member.update({ where: { id: leaver.id }, data: { archivedAt: new Date() } })
    expect((await call(null, 'GET', `/api/public/sign/${theirLink}`)).status).toBe(404)
    expect((await call(null, 'POST', `/api/public/sign/${theirLink}`, signBody())).status).toBe(404)
    expect((await call(null, 'GET', `/api/public/documents/${theirDownload}`)).status).toBe(404)
    // Staff with the right permission can still reach the signed record of someone who has left.
    expect((await call(staff.owner, 'GET', `/api/documents/${theirs.id}/pdf`)).status).toBe(200)
    // Raw tokens are nowhere in the database.
    const dump = JSON.stringify(await prisma.documentSigningToken.findMany({ where: { ownerId: gymA } })) + JSON.stringify(await prisma.documentEvent.findMany({ where: { ownerId: gymA } })) + JSON.stringify(await prisma.message.findMany({ where: { ownerId: gymA } }))
    for (const raw of [token, live, revoked, theirLink]) expect(dump).not.toContain(raw)
  })

  it('makes the public booking page ask for a required waiver, sign it in place, and then book', async () => {
    const coach = await prisma.staff.create({ data: { ownerId: gymA, name: 'Coach Pat', email: `${randomUUID()}@test.local`, password: 'x', role: 'coach', isCoach: true } })
    await prisma.staffAvailability.createMany({ data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ ownerId: gymA, staffId: coach.id, weekday, startMinute: 480, endMinute: 1200, kind: 'work' })) })
    const type = await prisma.appointmentType.create({ data: { ownerId: gymA, name: 'Intro With Waiver', durationMin: 60, paymentMode: 'included', minNoticeMinutes: 0, maxAdvanceDays: 60, cancelWindowHours: 12, memberBookable: true } })
    await prisma.appointmentTypeStaff.create({ data: { ownerId: gymA, typeId: type.id, staffId: coach.id } })
    await getBookingSite(gymA)
    const slug = `doc-${randomUUID().slice(0, 10)}`
    await saveBookingSite(gymA, siteSchema.parse({ enabled: true, slug, displayName: null, tagline: null, primaryColor: '#0f766e', buttonStyle: 'rounded', appearance: 'light', showLogo: true, locationIds: [], allClassTypes: true, classTypeIds: [], appointmentTypeIds: [type.id], requireAccount: false, allowGuests: true, advanceDays: null, cancellationPolicy: null, contactEmail: null, contactPhone: null, termsUrl: null }))
    const pt = await template(gymA, { title: 'Intro Session Waiver', body: `${BODY}\n\nSECRET-CLAUSE-TEXT applies.` })
    await saveRequirements(gymA, pt.id, [{ trigger: 'appointment_booking', planIds: [], classTypeIds: [], appointmentTypeIds: [type.id], blocking: true }])
    const api = `/api/public/booking/${slug}`
    // Nothing about documents is visible to someone merely browsing.
    const browsing = [await call(null, 'GET', api), await call(null, 'GET', `${api}/appointment-types`), await call(null, 'GET', `${api}/classes`)].map((r) => r.text).join('')
    expect(browsing).not.toMatch(/SECRET-CLAUSE-TEXT|Intro Session Waiver|Assumption of risk/)

    const guest = await call(null, 'POST', `${api}/guest`, { name: 'Gwen Guest', email: `gwen-${randomUUID()}@test.local`, phone: null })
    const token = `Bearer ${guest.data.token}`
    const startsAt = zonedToUtc(addDaysToDate(zonedParts(new Date(), TZ).date, 3), '11:00', TZ).toISOString()
    const refused = await call(token, 'POST', `${api}/appointments`, { typeId: type.id, startsAt })
    expect(refused.status).toBe(409)
    expect(refused.json).toMatchObject({ code: 'documents_required', error: 'Please sign Intro Session Waiver first.' })
    const [needed] = refused.json.details.documents
    expect(needed).toMatchObject({ name: 'Intro Session Waiver', type: 'waiver' })
    expect(await prisma.appointment.count({ where: { ownerId: gymA, typeId: type.id } })).toBe(0)
    // Only the person booking can open it; another customer's session, or none, cannot.
    const stranger = await call(null, 'POST', `${api}/guest`, { name: 'Sly Stranger', email: `sly-${randomUUID()}@test.local`, phone: null })
    expect((await call(`Bearer ${stranger.data.token}`, 'GET', `${api}/me/documents/${needed.id}`)).status).toBe(404)
    expect((await call(`Bearer ${stranger.data.token}`, 'POST', `${api}/me/documents/${needed.id}`, signBody())).status).toBe(404)
    expect((await call(null, 'GET', `${api}/me/documents/${needed.id}`)).status).toBe(401)
    const view = await call(token, 'GET', `${api}/me/documents/${needed.id}`)
    expect(view.status).toBe(200)
    expect(JSON.stringify(view.data.blocks)).toContain('Gwen Guest')
    expect(JSON.stringify(view.data.blocks)).toContain('SECRET-CLAUSE-TEXT')
    // Declining leaves the booking unmade.
    const declined = await call(token, 'POST', `${api}/me/documents/${needed.id}`, { action: 'decline', reason: 'Not today' })
    expect(declined.data.status).toBe('declined')
    const still = await call(token, 'POST', `${api}/appointments`, { typeId: type.id, startsAt })
    expect(still.status).toBe(409)
    expect(await prisma.appointment.count({ where: { ownerId: gymA, typeId: type.id } })).toBe(0)
    // Signing the fresh copy lets the same booking go through.
    const signed = await call(token, 'POST', `${api}/me/documents/${still.json.details.documents[0].id}`, signBody({ signerName: 'Gwen Guest' }))
    expect(signed.status, signed.text).toBe(200)
    const booked = await call(token, 'POST', `${api}/appointments`, { typeId: type.id, startsAt })
    expect(booked.status, booked.text).toBe(200)
    expect(booked.data).toMatchObject({ status: 'booked', name: 'Intro With Waiver' })
    const record = await fresh(still.json.details.documents[0].id)
    expect((record.finalSnapshot as unknown as SignedSnapshot).evidence.via).toBe('Online booking')
    expect(record.source).toBe('appointment_booking')
    // A booking token is not a way into the member app's documents, nor the staff side.
    expect((await call(token, 'GET', '/api/portal/me/documents')).status).toBe(401)
    expect((await call(token, 'GET', `/api/documents/${record.id}/pdf`)).status).toBe(401)
    expect((await call(null, 'GET', `/api/public/documents/${signed.data.downloadToken}`)).status).toBe(200)
  })
})
