// Documents and e-signatures: templates and their versions, one copy per member, signing, and the
// signed record.
//
// Three rules hold everything else up:
//
//   1. A published version of a template is never edited. Editing starts the next version.
//   2. A member's copy is the wording as it was when they were given it, with their details filled
//      in. Later versions do not reach back into it.
//   3. Signing writes the complete record once (finalSnapshot, with its SHA-256) and nothing here
//      writes it again. The PDF is drawn from that record, never from a template. Voiding and
//      expiring change the status and leave the record where it is.
//
// The audit trail (DocumentEvent) is append-only: this file adds rows and has no code that changes
// or removes one.

import { createHash, randomBytes } from 'crypto'
import { z } from 'zod'
import type { Member, MemberDocument, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError, badRequest, notFound } from '@/lib/api'
import { formatDate, formatMoney } from '@/lib/format'
import { getStorage } from '@/lib/storage'
import { CONSENT_TEXT, DOCUMENT_TYPE_KEYS, MAX_BODY, canonicalJson, OPEN_STATUSES, checkFieldValues, fieldsSchema, parseBody, resolveBlocks, signatureSchema, tidySignature, unknownMergeFields, type DocumentContent, type DocumentField, type MergeValues, type SignedSnapshot } from '@/lib/documents/content'
import { renderSignedPdf } from '@/lib/documents/pdf'
import { getGymSettings, lockRow, logActivity, notify, type ActorRef, type Db } from './core'
import { intervalLabel } from './memberships'

const SYSTEM: ActorRef = { type: 'system', name: 'System' }
export const LINK_DAYS = 14
const REMIND_AFTER_DAYS = 3

/** Where a request came from, for the audit trail. */
export interface Evidence { ip?: string | null; userAgent?: string | null; via: 'Member app' | 'Signing link' | 'Online booking' | 'Staff' | 'System' }

// ---------------------------------------------------------------------------
// The audit trail
// ---------------------------------------------------------------------------

async function record(db: Db, doc: { id: string; ownerId: string }, type: string, actor: ActorRef, evidence?: Evidence | null, metadata?: Record<string, unknown>) {
  await db.documentEvent.create({
    data: {
      ownerId: doc.ownerId, documentId: doc.id, type, actorType: actor.type, actorId: actor.id || null, actorName: actor.name || null,
      ip: evidence?.ip?.slice(0, 64) || null, userAgent: evidence?.userAgent?.slice(0, 300) || null,
      metadata: { ...(evidence && { via: evidence.via }), ...metadata } as Prisma.InputJsonValue,
    },
  })
}

// ---------------------------------------------------------------------------
// Templates and versions
// ---------------------------------------------------------------------------

const days = (max: number) => z.number().int().min(1).max(max).nullish().transform((v) => v ?? null)
const meta = {
  name: z.string().trim().min(1, 'Give the document a name').max(120),
  description: z.string().trim().max(500).nullish().transform((v) => v || null),
  type: z.enum(DOCUMENT_TYPE_KEYS as [string, ...string[]]),
  validForDays: days(3650),
  signWithinDays: days(365),
  allowDecline: z.boolean(),
  declineReasonRequired: z.boolean(),
}
const wording = {
  title: z.string().trim().min(1, 'Give the document a title').max(160),
  body: z.string().max(MAX_BODY, 'That is too long for one document').refine((b) => b.trim().length > 0, 'Write the document'),
  fields: fieldsSchema,
  requireSignature: z.boolean(),
}
export const templateCreateSchema = z.object({ ...meta, type: meta.type.default('custom'), allowDecline: meta.allowDecline.default(true), declineReasonRequired: meta.declineReasonRequired.default(false), ...wording, fields: wording.fields.default([]), requireSignature: wording.requireSignature.default(true) })
export const templateMetaSchema = z.object(meta).partial()
export const draftSchema = z.object(wording).partial()

const REQUIREMENT_TRIGGERS = ['member_signup', 'membership_purchase', 'class_booking', 'appointment_booking'] as const
export type RequirementTrigger = (typeof REQUIREMENT_TRIGGERS)[number]
export const requirementsSchema = z.array(z.object({
  trigger: z.enum(REQUIREMENT_TRIGGERS),
  planIds: z.array(z.string().uuid()).max(100).default([]),
  classTypeIds: z.array(z.string().uuid()).max(100).default([]),
  appointmentTypeIds: z.array(z.string().uuid()).max(100).default([]),
  blocking: z.boolean().default(true),
})).max(12)

async function ownTemplate(db: Db, ownerId: string, id: string) {
  const template = await db.documentTemplate.findFirst({ where: { id, ownerId }, include: { versions: { orderBy: { version: 'desc' } } } })
  if (!template) throw notFound('Document template')
  return template
}

export async function createTemplate(ownerId: string, input: z.infer<typeof templateCreateSchema>, actor: ActorRef) {
  const { title, body, fields, requireSignature, ...rest } = input
  return prisma.documentTemplate.create({
    data: { ownerId, ...rest, createdById: actor.id || null, createdByName: actor.name || null, versions: { create: { ownerId, version: 1, status: 'draft', title, body, fields: fields as Prisma.InputJsonValue, requireSignature, createdByName: actor.name || null } } },
    include: { versions: true },
  })
}

export async function updateTemplateMeta(ownerId: string, id: string, input: z.infer<typeof templateMetaSchema>) {
  const template = await ownTemplate(prisma, ownerId, id)
  return prisma.documentTemplate.update({ where: { id: template.id }, data: input })
}

/**
 * Save changes to the wording. If there is a draft, it is the draft that changes. If the newest
 * version is published, a new draft version is started from it: the published one is left exactly as it is.
 */
export async function saveDraft(ownerId: string, id: string, input: z.infer<typeof draftSchema>, actor: ActorRef) {
  return prisma.$transaction(async (db) => {
    const template = await ownTemplate(db, ownerId, id)
    if (template.archivedAt) throw new ApiError(409, 'Restore this template before editing it.', 'archived')
    const draft = template.versions.find((v) => v.status === 'draft')
    const data = { ...(input.title !== undefined && { title: input.title }), ...(input.body !== undefined && { body: input.body }), ...(input.fields !== undefined && { fields: input.fields as Prisma.InputJsonValue }), ...(input.requireSignature !== undefined && { requireSignature: input.requireSignature }) }
    if (draft) return { version: await db.documentTemplateVersion.update({ where: { id: draft.id }, data }), started: false }
    const latest = template.versions[0]
    const version = await db.documentTemplateVersion.create({
      data: { ownerId, templateId: template.id, version: latest.version + 1, status: 'draft', title: latest.title, body: latest.body, fields: latest.fields as Prisma.InputJsonValue, requireSignature: latest.requireSignature, createdByName: actor.name || null, ...data },
    })
    return { version, started: true }
  })
}

/** Make the draft the version new assignments use. The version it replaces is kept, marked as replaced. */
export async function publishTemplate(ownerId: string, id: string) {
  return prisma.$transaction(async (db) => {
    const template = await ownTemplate(db, ownerId, id)
    if (template.archivedAt) throw new ApiError(409, 'Restore this template before publishing it.', 'archived')
    const draft = template.versions.find((v) => v.status === 'draft')
    if (!draft) throw new ApiError(409, 'There are no changes to publish.', 'nothing_to_publish')
    const fields = fieldsSchema.safeParse(draft.fields)
    if (!fields.success) throw badRequest(fields.error.issues[0].message, 'validation_error')
    if (!draft.body.trim()) throw badRequest('Write the document before publishing it.', 'validation_error')
    const unknown = unknownMergeFields(draft.body)
    if (unknown.length) throw badRequest(`This document uses a merge field that does not exist: {{${unknown[0]}}}. Fix or remove it before publishing.`, 'unknown_merge_field')
    await db.documentTemplateVersion.updateMany({ where: { templateId: template.id, status: 'published' }, data: { status: 'archived' } })
    const version = await db.documentTemplateVersion.update({ where: { id: draft.id }, data: { status: 'published', publishedAt: new Date() } })
    await db.documentTemplate.update({ where: { id: template.id }, data: { publishedVersionId: version.id } })
    return version
  })
}

/** Throw away an unpublished draft. The first draft of a template nobody has used can only be archived. */
export async function discardDraft(ownerId: string, id: string) {
  const template = await ownTemplate(prisma, ownerId, id)
  const draft = template.versions.find((v) => v.status === 'draft')
  if (!draft) throw new ApiError(409, 'There is no draft to discard.', 'nothing_to_discard')
  if (template.versions.length === 1) throw new ApiError(409, 'This is the only version. Archive the template instead.', 'only_version')
  await prisma.documentTemplateVersion.delete({ where: { id: draft.id } })
  return { discarded: true }
}

export async function duplicateTemplate(ownerId: string, id: string, actor: ActorRef) {
  const template = await ownTemplate(prisma, ownerId, id)
  const source = template.versions[0]
  return prisma.documentTemplate.create({
    data: {
      ownerId, name: `${template.name} (copy)`.slice(0, 120), description: template.description, type: template.type, validForDays: template.validForDays, signWithinDays: template.signWithinDays, allowDecline: template.allowDecline, declineReasonRequired: template.declineReasonRequired,
      createdById: actor.id || null, createdByName: actor.name || null,
      versions: { create: { ownerId, version: 1, status: 'draft', title: source.title, body: source.body, fields: source.fields as Prisma.InputJsonValue, requireSignature: source.requireSignature, createdByName: actor.name || null } },
    },
  })
}

/** Archive: nothing new can be assigned from it and its requirements stop applying. Everything already sent or signed stays. */
export async function archiveTemplate(ownerId: string, id: string, archived: boolean) {
  const template = await ownTemplate(prisma, ownerId, id)
  return prisma.documentTemplate.update({ where: { id: template.id }, data: { archivedAt: archived ? new Date() : null } })
}

export async function saveRequirements(ownerId: string, id: string, rules: z.infer<typeof requirementsSchema>) {
  const template = await ownTemplate(prisma, ownerId, id)
  // A rule can only name this gym's own plans, class types and appointment types.
  const [plans, classTypes, appointmentTypes] = await Promise.all([
    prisma.membershipPlan.count({ where: { ownerId, id: { in: rules.flatMap((r) => r.planIds) } } }),
    prisma.classType.count({ where: { ownerId, id: { in: rules.flatMap((r) => r.classTypeIds) } } }),
    prisma.appointmentType.count({ where: { ownerId, id: { in: rules.flatMap((r) => r.appointmentTypeIds) } } }),
  ])
  if (plans !== new Set(rules.flatMap((r) => r.planIds)).size) throw notFound('Membership plan')
  if (classTypes !== new Set(rules.flatMap((r) => r.classTypeIds)).size) throw notFound('Class type')
  if (appointmentTypes !== new Set(rules.flatMap((r) => r.appointmentTypeIds)).size) throw notFound('Appointment type')
  await prisma.$transaction([
    prisma.documentRequirement.deleteMany({ where: { ownerId, templateId: template.id } }),
    prisma.documentRequirement.createMany({ data: rules.map((r) => ({ ownerId, templateId: template.id, ...r })) }),
  ])
  return prisma.documentRequirement.findMany({ where: { ownerId, templateId: template.id }, orderBy: { createdAt: 'asc' } })
}

export async function listTemplates(ownerId: string, filters: { archived?: boolean; search?: string | null }) {
  const search = (filters.search || '').trim()
  const rows = await prisma.documentTemplate.findMany({
    where: { ownerId, archivedAt: filters.archived ? { not: null } : null, ...(search && { name: { contains: search, mode: 'insensitive' } }) },
    orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 200,
    include: { versions: { select: { id: true, version: true, status: true, publishedAt: true }, orderBy: { version: 'desc' } } },
  })
  const [counts, rules] = await Promise.all([
    rows.length ? prisma.memberDocument.groupBy({ by: ['templateId', 'status'], where: { ownerId, templateId: { in: rows.map((r) => r.id) } }, _count: { _all: true } }) : [],
    rows.length ? prisma.documentRequirement.findMany({ where: { ownerId, templateId: { in: rows.map((r) => r.id) }, isActive: true }, select: { templateId: true, trigger: true } }) : [],
  ])
  const count = (id: string, statuses: string[]) => counts.filter((c) => c.templateId === id && statuses.includes(c.status)).reduce((n, c) => n + c._count._all, 0)
  return rows.map((t) => {
    const published = t.versions.find((v) => v.status === 'published')
    return {
      id: t.id, name: t.name, description: t.description, type: t.type, archived: !!t.archivedAt, createdByName: t.createdByName, createdAt: t.createdAt, updatedAt: t.updatedAt,
      status: t.archivedAt ? 'archived' : published ? 'published' : 'draft',
      version: published?.version ?? null, publishedAt: published?.publishedAt ?? null,
      hasDraft: t.versions.some((v) => v.status === 'draft'), versions: t.versions.length,
      validForDays: t.validForDays,
      requiredFor: Array.from(new Set(rules.filter((r) => r.templateId === t.id).map((r) => r.trigger))),
      signed: count(t.id, ['signed']), waiting: count(t.id, OPEN_STATUSES),
    }
  })
}

export async function templateDetail(ownerId: string, id: string) {
  const template = await ownTemplate(prisma, ownerId, id)
  const [requirements, used] = await Promise.all([
    prisma.documentRequirement.findMany({ where: { ownerId, templateId: template.id }, orderBy: { createdAt: 'asc' } }),
    prisma.memberDocument.groupBy({ by: ['version'], where: { ownerId, templateId: template.id }, _count: { _all: true } }),
  ])
  const draft = template.versions.find((v) => v.status === 'draft') || null
  const published = template.versions.find((v) => v.status === 'published') || null
  const { versions, ...rest } = template
  const out = (v: (typeof versions)[number]) => ({ id: v.id, version: v.version, status: v.status, title: v.title, body: v.body, fields: v.fields as unknown as DocumentField[], requireSignature: v.requireSignature, createdByName: v.createdByName, publishedAt: v.publishedAt, updatedAt: v.updatedAt, timesUsed: used.find((u) => u.version === v.version)?._count._all || 0 })
  return {
    ...rest, archived: !!template.archivedAt, status: template.archivedAt ? 'archived' : published ? 'published' : 'draft',
    draft: draft && out(draft), published: published && out(published),
    // What the editor opens on: the draft if there is one, otherwise the published wording (saving it starts the next version).
    editing: out(draft || published || versions[0]),
    versions: versions.map((v) => ({ id: v.id, version: v.version, status: v.status, title: v.title, publishedAt: v.publishedAt, createdByName: v.createdByName, timesUsed: used.find((u) => u.version === v.version)?._count._all || 0 })),
    requirements: requirements.map((r) => ({ trigger: r.trigger, planIds: r.planIds, classTypeIds: r.classTypeIds, appointmentTypeIds: r.appointmentTypeIds, blocking: r.blocking })),
  }
}

// ---------------------------------------------------------------------------
// Giving a document to a member
// ---------------------------------------------------------------------------

/** The values merge fields take for one member, read once, when the document is made for them. */
async function mergeValues(db: Db, member: Member, membershipId?: string | null): Promise<MergeValues> {
  const [settings, profile, owner, location, site, membership] = await Promise.all([
    getGymSettings(member.ownerId, db),
    db.gymProfile.findUnique({ where: { ownerId: member.ownerId }, select: { address: true, billingContactEmail: true } }),
    db.owner.findUnique({ where: { id: member.ownerId }, select: { email: true } }),
    db.location.findFirst({ where: { ownerId: member.ownerId, isActive: true }, orderBy: { createdAt: 'asc' }, select: { address: true, city: true, state: true, postalCode: true, phone: true } }),
    db.bookingSite.findUnique({ where: { ownerId: member.ownerId }, select: { contactEmail: true, contactPhone: true } }),
    membershipId
      ? db.membership.findFirst({ where: { id: membershipId, ownerId: member.ownerId, memberId: member.id }, include: { plan: true } })
      : db.membership.findFirst({ where: { ownerId: member.ownerId, memberId: member.id, status: { in: ['trial', 'active', 'past_due', 'frozen'] } }, orderBy: { createdAt: 'desc' }, include: { plan: true } }),
  ])
  const [first, ...last] = member.name.trim().split(/\s+/)
  const tz = settings.timezone
  return {
    'member.first_name': first || '', 'member.last_name': last.join(' '), 'member.full_name': member.name, 'member.email': member.email, 'member.phone': member.phone || '',
    'member.date_of_birth': member.dateOfBirth ? formatDate(member.dateOfBirth, 'UTC') : '',
    'member.address': [member.addressLine1, member.city, member.state, member.postalCode].filter(Boolean).join(', '),
    'gym.name': settings.name,
    'gym.address': profile?.address || [location?.address, location?.city, location?.state, location?.postalCode].filter(Boolean).join(', '),
    'gym.phone': site?.contactPhone || location?.phone || '',
    'gym.email': site?.contactEmail || profile?.billingContactEmail || owner?.email || '',
    'membership.name': membership?.plan.name || '',
    'membership.price': membership ? formatMoney(membership.priceCents, settings.currency) : '',
    'membership.billing_interval': membership ? intervalLabel(membership.plan) : '',
    'membership.start_date': membership ? formatDate(membership.startDate, tz) : '',
    'membership.end_date': membership?.endDate ? formatDate(membership.endDate, tz) : '',
    today: formatDate(new Date(), tz),
  }
}

export interface AssignInput {
  ownerId: string
  templateId: string
  memberId: string
  /** Why it is being given: staff choosing to, or a workflow that needs it. */
  source?: string
  actor?: ActorRef
  /** Ask again even though they have a signed copy that is still good (a new version, say). */
  again?: boolean
  membershipId?: string | null
}

/**
 * Give a member their copy of a template's published version. Must run inside a transaction.
 *
 * Asking twice gives one copy: the member's row is locked first, so two requests at once take
 * turns, and the second finds the first's copy. Someone with a copy still waiting to be signed is
 * handed that copy back; someone with a signed copy that is still good is not asked again unless
 * `again` is set.
 */
export async function assignDocument(db: Db, input: AssignInput): Promise<{ document: MemberDocument; created: boolean }> {
  const template = await db.documentTemplate.findFirst({ where: { id: input.templateId, ownerId: input.ownerId } })
  if (!template) throw notFound('Document template')
  if (template.archivedAt) throw new ApiError(409, `${template.name} is archived and cannot be sent.`, 'archived')
  if (!template.publishedVersionId) throw new ApiError(409, `${template.name} has not been published yet.`, 'not_published')
  await lockRow(db, 'Member', input.memberId)
  const member = await db.member.findFirst({ where: { id: input.memberId, ownerId: input.ownerId } })
  if (!member) throw notFound('Member')
  if (member.archivedAt) throw new ApiError(409, `${member.name} is archived.`, 'member_archived')
  const version = await db.documentTemplateVersion.findFirstOrThrow({ where: { id: template.publishedVersionId, ownerId: input.ownerId } })
  const now = new Date()

  const open = await db.memberDocument.findFirst({ where: { ownerId: input.ownerId, memberId: member.id, templateId: template.id, status: { in: OPEN_STATUSES } }, orderBy: { createdAt: 'desc' } })
  // A copy of an older version that nobody has signed is replaced by the current wording rather than left to be signed.
  if (open && open.versionId === version.id) return { document: open, created: false }
  if (!input.again) {
    const good = await db.memberDocument.findFirst({ where: { ownerId: input.ownerId, memberId: member.id, templateId: template.id, status: 'signed', OR: [{ validUntil: null }, { validUntil: { gt: now } }] }, orderBy: { signedAt: 'desc' } })
    if (good && !open) return { document: good, created: false }
  }
  const actor = input.actor || SYSTEM
  if (open) {
    await db.memberDocument.update({ where: { id: open.id }, data: { status: 'voided', voidedAt: now, voidReason: `Replaced by version ${version.version}`, voidedByName: actor.name || 'System', lastActivityAt: now } })
    await db.documentSigningToken.updateMany({ where: { documentId: open.id, revokedAt: null, usedAt: null }, data: { revokedAt: now } })
    await record(db, open, 'voided', actor, null, { reason: `Replaced by version ${version.version}` })
  }

  const content: DocumentContent = { title: version.title, blocks: resolveBlocks(parseBody(version.body), await mergeValues(db, member, input.membershipId)), fields: fieldsSchema.parse(version.fields), requireSignature: version.requireSignature }
  const document = await db.memberDocument.create({
    data: {
      ownerId: input.ownerId, memberId: member.id, templateId: template.id, versionId: version.id, version: version.version, name: version.title, type: template.type,
      status: 'sent', content: content as unknown as Prisma.InputJsonValue, source: input.source || 'staff', assignedByName: actor.name || null,
      assignedAt: now, sentAt: now, lastActivityAt: now, signBy: template.signWithinDays ? new Date(now.getTime() + template.signWithinDays * 86_400_000) : null,
    },
  })
  await record(db, document, 'assigned', actor, null, { version: version.version, source: input.source || 'staff' })
  await record(db, document, 'sent', actor)
  await logActivity(db, { ownerId: input.ownerId, memberId: member.id, type: 'document_assigned', title: `Document to sign: ${version.title}`, metadata: { documentId: document.id }, actor })
  const { fireTrigger } = await import('./automations')
  await fireTrigger(db, input.ownerId, 'document_assigned', { memberId: member.id, dedupeKey: `document:${document.id}:assigned`, context: { document_name: version.title } })
  return { document, created: true }
}

/** Staff sending a template to one or many members. Each gets their own copy; anyone who already has one is not sent another. */
export async function sendToMembers(input: { ownerId: string; templateId: string; memberIds: string[]; actor: ActorRef; again?: boolean; origin: string }) {
  const ids = Array.from(new Set(input.memberIds)).sort()
  const members = await prisma.member.findMany({ where: { ownerId: input.ownerId, id: { in: ids } }, select: { id: true } })
  if (members.length !== ids.length) throw new ApiError(404, 'One of those members was not found.', 'not_found')
  const created: MemberDocument[] = []
  const existing: MemberDocument[] = []
  for (const memberId of ids) {
    const r = await prisma.$transaction((db) => assignDocument(db, { ownerId: input.ownerId, templateId: input.templateId, memberId, actor: input.actor, again: input.again }), { timeout: 15_000 })
    ;(r.created ? created : existing).push(r.document)
  }
  for (const document of created) await emailSigningLink(document, input.origin, 'assigned').catch((error) => console.error('[documents] could not email a signing link:', (error as Error).message))
  return { created, existing }
}

// ---------------------------------------------------------------------------
// Signing links
// ---------------------------------------------------------------------------

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

/** A new link for a document. Any earlier link for it stops working: there is one live link at a time. */
export async function issueSigningToken(db: Db, document: { id: string; ownerId: string; signBy: Date | null }) {
  const token = randomBytes(32).toString('base64url')
  const now = new Date()
  const expires = new Date(Math.min(now.getTime() + LINK_DAYS * 86_400_000, document.signBy?.getTime() ?? Infinity))
  await db.documentSigningToken.updateMany({ where: { documentId: document.id, revokedAt: null, usedAt: null }, data: { revokedAt: now } })
  await db.documentSigningToken.create({ data: { ownerId: document.ownerId, documentId: document.id, tokenHash: hashToken(token), expiresAt: expires } })
  return token
}

const badLink = () => new ApiError(404, 'This link has expired or is no longer valid. Ask the gym to send it again, or sign in to your member account.', 'invalid_link')

/** The document a signing link opens, if the link is still good. Says nothing about why when it is not. */
export async function documentForToken(token: string) {
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) throw badLink()
  const row = await prisma.documentSigningToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { document: true } })
  if (!row || row.revokedAt || row.usedAt || row.expiresAt <= new Date()) throw badLink()
  return { tokenId: row.id, document: row.document }
}

/**
 * Email a member the link to sign. Sent directly rather than through the message log, like account
 * emails, because the link is a credential: it is never written anywhere but the email itself.
 */
export async function emailSigningLink(document: Pick<MemberDocument, 'id' | 'ownerId' | 'memberId' | 'name' | 'signBy' | 'status'>, origin: string, kind: 'assigned' | 'reminder') {
  if (!OPEN_STATUSES.includes(document.status as never)) return { delivered: false }
  const [member, settings] = await Promise.all([prisma.member.findUnique({ where: { id: document.memberId }, select: { name: true, email: true, emailOptIn: true } }), getGymSettings(document.ownerId)])
  if (!member?.email) return { delivered: false }
  const token = await prisma.$transaction((db) => issueSigningToken(db, document))
  const url = `${origin}/sign/${token}`
  const subject = kind === 'reminder' ? `Reminder: please sign ${document.name}` : `${settings.name} has sent you a document to sign`
  const text = `Hi ${member.name.split(' ')[0]},\n\n${kind === 'reminder' ? `${document.name} from ${settings.name} is still waiting for your signature.` : `${settings.name} has sent you ${document.name} to read and sign.`} It takes a couple of minutes on any phone or computer:\n\n${url}\n\nThis link is personal to you and stops working after ${LINK_DAYS} days${document.signBy ? `, or on ${formatDate(document.signBy, settings.timezone)} if that is sooner` : ''}. Opening it does not sign anything.\n\n${settings.name}`
  const undeliverable = /\.(local|test|invalid|example|localhost)$/i.test(member.email)
  if (!process.env.RESEND_API_KEY || undeliverable) {
    if (process.env.NODE_ENV !== 'production') console.log(`[documents] signing link for ${member.email}: ${url}`)
    return { delivered: false }
  }
  const { Resend } = await import('resend')
  const { emailHtml } = await import('./messaging')
  const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({ from: process.env.EMAIL_FROM || 'ClubCheck <onboarding@resend.dev>', to: member.email, subject, text, html: emailHtml(settings.name, text) })
  if (error) { console.error('[documents] could not send a signing email:', error.message); return { delivered: false } }
  return { delivered: true }
}

// ---------------------------------------------------------------------------
// What the member sees and does
// ---------------------------------------------------------------------------

const summary = (d: MemberDocument) => ({
  id: d.id, name: d.name, type: d.type, version: d.version, status: d.status as string,
  assignedAt: d.assignedAt, sentAt: d.sentAt, viewedAt: d.viewedAt, signedAt: d.signedAt, declinedAt: d.declinedAt, expiredAt: d.expiredAt, voidedAt: d.voidedAt,
  signBy: d.signBy, validUntil: d.validUntil, lastActivityAt: d.lastActivityAt,
  // A signature that has run out is still a signed record: it can be read and downloaded.
  hasSignedCopy: !!d.finalSnapshot,
})

/** The member's document centre. */
export async function memberDocuments(ownerId: string, memberId: string) {
  const rows = await prisma.memberDocument.findMany({ where: { ownerId, memberId, status: { not: 'draft' } }, orderBy: { createdAt: 'desc' }, take: 200 })
  const all = rows.map(summary)
  return {
    actionRequired: all.filter((d) => OPEN_STATUSES.includes(d.status as never)),
    signed: all.filter((d) => d.status === 'signed'),
    expired: all.filter((d) => d.status === 'expired'),
    declined: all.filter((d) => d.status === 'declined'),
    // A voided copy that was never signed is of no interest to the member.
    voided: all.filter((d) => d.status === 'voided' && d.hasSignedCopy),
  }
}

async function ownDocument(db: Db, ownerId: string, memberId: string, id: string) {
  const document = await db.memberDocument.findFirst({ where: { id, ownerId, memberId } })
  if (!document) throw notFound('Document')
  return document
}

/** What is shown on the signing screen. Never includes anyone's signature: a signed copy is read as its PDF. */
function signerView(d: MemberDocument, template: { allowDecline: boolean; declineReasonRequired: boolean } | null) {
  const content = d.content as unknown as DocumentContent
  const open = OPEN_STATUSES.includes(d.status as never)
  return {
    ...summary(d), title: content.title, blocks: content.blocks, fields: content.fields, requireSignature: content.requireSignature,
    fieldValues: open ? (d.fieldValues as Record<string, string | boolean>) : {},
    consentText: CONSENT_TEXT,
    can: { sign: open, decline: open && (template?.allowDecline ?? true), download: !!d.finalSnapshot },
    declineReasonRequired: template?.declineReasonRequired ?? false,
    signerName: d.signerName, signatureMethod: d.signatureMethod, declineReason: d.declineReason,
  }
}

/** Open a document to read it. The first time is recorded as "viewed". Opening never signs anything. */
export async function openDocument(document: MemberDocument, actor: ActorRef, evidence: Evidence) {
  let current = document
  if (OPEN_STATUSES.includes(document.status as never) && document.signBy && document.signBy <= new Date()) {
    // Past its deadline: say so now rather than waiting for the nightly job.
    await expireOne(document.id)
    current = await prisma.memberDocument.findUniqueOrThrow({ where: { id: document.id } })
  } else if (document.status === 'sent') {
    await prisma.$transaction(async (db) => {
      const now = new Date()
      const moved = await db.memberDocument.updateMany({ where: { id: document.id, status: 'sent' }, data: { status: 'viewed', viewedAt: now, lastActivityAt: now } })
      if (moved.count) await record(db, document, 'viewed', actor, evidence)
    })
    current = await prisma.memberDocument.findUniqueOrThrow({ where: { id: document.id } })
  }
  const template = await prisma.documentTemplate.findUnique({ where: { id: current.templateId }, select: { allowDecline: true, declineReasonRequired: true } })
  return signerView(current, template)
}

export async function openMemberDocument(ownerId: string, memberId: string, id: string, actor: ActorRef, evidence: Evidence) {
  return openDocument(await ownDocument(prisma, ownerId, memberId, id), actor, evidence)
}

/** Why a document can no longer be signed, in words for the person trying. */
function assertOpen(d: MemberDocument, now: Date) {
  if (d.status === 'signed') throw new ApiError(409, 'This document has already been signed.', 'already_signed')
  if (d.status === 'voided') throw new ApiError(409, 'This document has been withdrawn by the gym and can no longer be signed.', 'voided')
  if (d.status === 'declined') throw new ApiError(409, 'This document was declined. Ask the gym to send it again if you have changed your mind.', 'declined')
  if (d.status === 'expired' || (d.signBy && d.signBy <= now)) throw new ApiError(409, 'The time to sign this document has passed. Ask the gym to send it again.', 'expired')
  if (!OPEN_STATUSES.includes(d.status as never)) throw new ApiError(409, 'This document cannot be signed.', 'not_open')
}

/** Save answers part-way through, so a long form is not lost. */
export async function saveFields(input: { document: Pick<MemberDocument, 'id'>; fields: unknown; actor: ActorRef; evidence: Evidence }) {
  return prisma.$transaction(async (db) => {
    await lockRow(db, 'MemberDocument', input.document.id)
    const d = await db.memberDocument.findUniqueOrThrow({ where: { id: input.document.id } })
    const now = new Date()
    assertOpen(d, now)
    const content = d.content as unknown as DocumentContent
    const { values } = checkFieldValues(content.fields, input.fields, false)
    await db.memberDocument.update({ where: { id: d.id }, data: { fieldValues: values as Prisma.InputJsonValue, status: 'partially_completed', viewedAt: d.viewedAt || now, lastActivityAt: now } })
    await record(db, d, 'fields_saved', input.actor, input.evidence, { completed: Object.keys(values).length, of: content.fields.length })
    return { saved: true }
  })
}

export const signSchema = z.object({
  /** They must tick the box. Anything but `true` is a refusal to sign electronically. */
  consent: z.literal(true, { message: 'Tick the box to agree to sign electronically.' }),
  /** They reached the end of the document. */
  read: z.literal(true, { message: 'Read to the end of the document before signing.' }),
  signerName: z.string().trim().min(2, 'Type your full name').max(120),
  signature: signatureSchema.nullish(),
  fields: z.record(z.string(), z.union([z.string().max(2500), z.boolean()])).default({}),
})

/**
 * Sign. The document's row is locked, so a double tap, a second tab or a second device all take
 * turns: the first writes the record, the rest are told it is already signed and change nothing.
 */
export async function signDocument(input: { document: Pick<MemberDocument, 'id'>; tokenId?: string; actor: ActorRef; evidence: Evidence } & z.infer<typeof signSchema>) {
  const result = await prisma.$transaction(async (db) => {
    await lockRow(db, 'MemberDocument', input.document.id)
    const d = await db.memberDocument.findUniqueOrThrow({ where: { id: input.document.id }, include: { member: true } })
    const now = new Date()
    assertOpen(d, now)
    const content = d.content as unknown as DocumentContent
    const { values, problems } = checkFieldValues(content.fields, input.fields, true)
    const first = Object.keys(problems)[0]
    if (first) throw new ApiError(400, `${content.fields.find((f) => f.key === first)?.label || 'A field'}: ${problems[first].toLowerCase()}.`, 'fields_incomplete', problems)
    if (content.requireSignature && !input.signature) throw new ApiError(400, 'Add your signature before submitting.', 'signature_required')
    const signature = input.signature ? tidySignature(input.signature) : null
    const [settings, template, merge] = await Promise.all([getGymSettings(d.ownerId, db), db.documentTemplate.findUnique({ where: { id: d.templateId }, select: { validForDays: true } }), mergeValues(db, d.member)])
    const snapshot: SignedSnapshot = {
      documentId: d.id, title: content.title, type: d.type, version: d.version,
      gym: { name: settings.name, address: merge['gym.address'] || null, phone: merge['gym.phone'] || null, email: merge['gym.email'] || null },
      member: { name: d.member.name, email: d.member.email },
      blocks: content.blocks,
      fields: content.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, value: values[f.key] ?? null })),
      signature, signerName: input.signerName,
      evidence: { consentAt: now.toISOString(), consentText: CONSENT_TEXT, signedAt: now.toISOString(), method: signature?.method || 'acceptance', ip: input.evidence.ip?.slice(0, 64) || null, userAgent: input.evidence.userAgent?.slice(0, 300) || null, via: input.evidence.via },
    }
    const snapshotHash = createHash('sha256').update(canonicalJson(snapshot)).digest('hex')
    const signed = await db.memberDocument.update({
      where: { id: d.id },
      data: {
        status: 'signed', signedAt: now, viewedAt: d.viewedAt || now, lastActivityAt: now, fieldValues: values as Prisma.InputJsonValue,
        signerName: input.signerName, signatureMethod: snapshot.evidence.method, signature: (signature as unknown as Prisma.InputJsonValue) ?? undefined,
        consentAt: now, signedIp: snapshot.evidence.ip, signedUserAgent: snapshot.evidence.userAgent,
        finalSnapshot: snapshot as unknown as Prisma.InputJsonValue, snapshotHash,
        validUntil: template?.validForDays ? new Date(now.getTime() + template.validForDays * 86_400_000) : null,
      },
    })
    // Every link to it is spent: there is nothing left for a link to do.
    await db.documentSigningToken.updateMany({ where: { documentId: d.id, usedAt: null, revokedAt: null }, data: input.tokenId ? { usedAt: now } : { revokedAt: now } })
    await record(db, d, 'consent_given', input.actor, input.evidence, { text: CONSENT_TEXT })
    await record(db, d, 'signed', input.actor, input.evidence, { method: snapshot.evidence.method, signerName: input.signerName, version: d.version, snapshotHash })
    await logActivity(db, { ownerId: d.ownerId, memberId: d.memberId, type: 'document_signed', title: `Signed ${content.title}`, detail: `Version ${d.version}`, metadata: { documentId: d.id }, actor: input.actor })
    await notify(db, { ownerId: d.ownerId, type: 'document_signed', title: `${d.member.name} signed ${content.title}`, href: `/members/${d.memberId}?tab=documents` })
    const { fireTrigger } = await import('./automations')
    await fireTrigger(db, d.ownerId, 'document_signed', { memberId: d.memberId, dedupeKey: `document:${d.id}:signed`, context: { document_name: content.title } })
    return signed
  }, { timeout: 20_000 })
  const { flushOutbox } = await import('./automations')
  await flushOutbox(result.ownerId)
  return summary(result)
}

export const declineSchema = z.object({ reason: z.string().trim().max(500).nullish().transform((v) => v || null) })

export async function declineDocument(input: { document: Pick<MemberDocument, 'id'>; tokenId?: string; reason: string | null; actor: ActorRef; evidence: Evidence }) {
  const result = await prisma.$transaction(async (db) => {
    await lockRow(db, 'MemberDocument', input.document.id)
    const d = await db.memberDocument.findUniqueOrThrow({ where: { id: input.document.id }, include: { member: { select: { name: true } } } })
    const now = new Date()
    assertOpen(d, now)
    const template = await db.documentTemplate.findUnique({ where: { id: d.templateId }, select: { allowDecline: true, declineReasonRequired: true } })
    if (template && !template.allowDecline) throw new ApiError(409, 'This document cannot be declined here. Contact the gym if you do not want to sign it.', 'decline_not_allowed')
    if (template?.declineReasonRequired && !input.reason) throw new ApiError(400, 'Tell us why you are declining.', 'reason_required')
    const declined = await db.memberDocument.update({ where: { id: d.id }, data: { status: 'declined', declinedAt: now, declineReason: input.reason, lastActivityAt: now } })
    await db.documentSigningToken.updateMany({ where: { documentId: d.id, usedAt: null, revokedAt: null }, data: input.tokenId ? { usedAt: now } : { revokedAt: now } })
    await record(db, d, 'declined', input.actor, input.evidence, { reason: input.reason })
    await logActivity(db, { ownerId: d.ownerId, memberId: d.memberId, type: 'document_declined', title: `Declined ${d.name}`, detail: input.reason || undefined, metadata: { documentId: d.id }, actor: input.actor })
    await notify(db, { ownerId: d.ownerId, type: 'document_declined', title: `${d.member.name} declined ${d.name}`, body: input.reason || undefined, href: `/members/${d.memberId}?tab=documents` })
    const { fireTrigger } = await import('./automations')
    await fireTrigger(db, d.ownerId, 'document_declined', { memberId: d.memberId, dedupeKey: `document:${d.id}:declined`, context: { document_name: d.name } })
    return declined
  }, { timeout: 20_000 })
  return summary(result)
}

// ---------------------------------------------------------------------------
// What staff do
// ---------------------------------------------------------------------------

async function gymDocument(db: Db, ownerId: string, id: string) {
  const document = await db.memberDocument.findFirst({ where: { id, ownerId } })
  if (!document) throw notFound('Document')
  return document
}

/** Withdraw a document. It can no longer be signed; if it was signed, the signed record stays, marked void. */
export async function voidDocument(input: { ownerId: string; id: string; reason: string; actor: ActorRef }) {
  return prisma.$transaction(async (db) => {
    const owned = await gymDocument(db, input.ownerId, input.id)
    await lockRow(db, 'MemberDocument', owned.id)
    const d = await db.memberDocument.findUniqueOrThrow({ where: { id: owned.id } })
    if (d.status === 'voided') throw new ApiError(409, 'This document is already void.', 'already_voided')
    const now = new Date()
    const voided = await db.memberDocument.update({ where: { id: d.id }, data: { status: 'voided', voidedAt: now, voidReason: input.reason, voidedByName: input.actor.name || null, lastActivityAt: now } })
    await db.documentSigningToken.updateMany({ where: { documentId: d.id, usedAt: null, revokedAt: null }, data: { revokedAt: now } })
    await record(db, d, 'voided', input.actor, { via: 'Staff' }, { reason: input.reason, wasStatus: d.status })
    await logActivity(db, { ownerId: d.ownerId, memberId: d.memberId, type: 'document_voided', title: `${d.name} was withdrawn`, metadata: { documentId: d.id }, actor: input.actor })
    return summary(voided)
  })
}

/**
 * Send an unsigned document again. The same copy, the same version: only "sent" moves, and a fresh
 * link replaces the old one. Two people pressing resend together send one email.
 */
export async function resendDocument(input: { ownerId: string; id: string; actor: ActorRef; origin: string }) {
  const outcome = await prisma.$transaction(async (db) => {
    const owned = await gymDocument(db, input.ownerId, input.id)
    await lockRow(db, 'MemberDocument', owned.id)
    const d = await db.memberDocument.findUniqueOrThrow({ where: { id: owned.id } })
    const now = new Date()
    assertOpen(d, now)
    if (d.sentAt && now.getTime() - d.sentAt.getTime() < 60_000) return { document: d, sent: false }
    const updated = await db.memberDocument.update({ where: { id: d.id }, data: { sentAt: now, lastActivityAt: now } })
    await record(db, d, 'resent', input.actor, { via: 'Staff' })
    return { document: updated, sent: true }
  })
  if (outcome.sent) await emailSigningLink(outcome.document, input.origin, 'assigned').catch((error) => console.error('[documents] could not email a signing link:', (error as Error).message))
  return { ...summary(outcome.document), resent: outcome.sent }
}

export interface DocumentFilters { search?: string | null; status?: string | null; type?: string | null; templateId?: string | null; memberId?: string | null; signed?: 'yes' | 'no' | null; from?: Date; to?: Date; expiringBefore?: Date; skip: number; take: number }

export async function searchDocuments(ownerId: string, f: DocumentFilters) {
  const search = (f.search || '').trim()
  const where: Prisma.MemberDocumentWhereInput = {
    ownerId, status: f.status ? f.status : { not: 'draft' },
    ...(f.type && { type: f.type }), ...(f.templateId && { templateId: f.templateId }), ...(f.memberId && { memberId: f.memberId }),
    ...(f.signed === 'yes' && { signedAt: { not: null } }), ...(f.signed === 'no' && { signedAt: null }),
    ...((f.from || f.to) && { assignedAt: { ...(f.from && { gte: f.from }), ...(f.to && { lt: f.to }) } }),
    ...(f.expiringBefore && { status: 'signed', validUntil: { not: null, lt: f.expiringBefore } }),
    ...(search && { OR: [{ name: { contains: search, mode: 'insensitive' } }, { member: { name: { contains: search, mode: 'insensitive' } } }, { member: { email: { contains: search, mode: 'insensitive' } } }] }),
  }
  const [rows, total, counts] = await Promise.all([
    prisma.memberDocument.findMany({ where, orderBy: [{ lastActivityAt: 'desc' }, { id: 'asc' }], skip: f.skip, take: f.take, include: { member: { select: { id: true, name: true, email: true, archivedAt: true } } } }),
    prisma.memberDocument.count({ where }),
    prisma.memberDocument.groupBy({ by: ['status'], where: { ownerId, status: { not: 'draft' } }, _count: { _all: true } }),
  ])
  return {
    total,
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Record<string, number>,
    items: rows.map((d) => ({ ...summary(d), source: d.source, assignedByName: d.assignedByName, member: { id: d.member.id, name: d.member.name, email: d.member.email, archived: !!d.member.archivedAt } })),
  }
}

/** One document for staff: its state and its audit trail. The wording and the signature are in the PDF, which needs its own permission. */
export async function documentDetail(ownerId: string, id: string) {
  const d = await prisma.memberDocument.findFirst({ where: { id, ownerId }, include: { member: { select: { id: true, name: true, email: true } }, events: { orderBy: { createdAt: 'asc' } } } })
  if (!d) throw notFound('Document')
  const content = d.content as unknown as DocumentContent
  return {
    ...summary(d), source: d.source, assignedByName: d.assignedByName, member: d.member,
    fieldsTotal: content.fields.length, requireSignature: content.requireSignature,
    signerName: d.signerName, signatureMethod: d.signatureMethod, snapshotHash: d.snapshotHash,
    declineReason: d.declineReason, voidReason: d.voidReason, voidedByName: d.voidedByName,
    events: d.events.map((e) => ({ id: e.id, type: e.type, at: e.createdAt, actorType: e.actorType, actorName: e.actorName, ip: e.ip, userAgent: e.userAgent, metadata: e.metadata })),
  }
}

// ---------------------------------------------------------------------------
// The signed PDF
// ---------------------------------------------------------------------------

const pdfKey = (d: { ownerId: string; id: string; snapshotHash: string }) => `documents/${d.ownerId}/${d.id}-${d.snapshotHash.slice(0, 24)}.pdf`

/**
 * The PDF of a signed document. Drawn from the signed record the first time it is asked for and
 * kept in file storage; if storage has lost it, it is drawn again from the same record. The
 * template is never consulted.
 */
export async function signedPdf(document: MemberDocument, actor: ActorRef, evidence: Evidence) {
  if (!document.finalSnapshot || !document.snapshotHash) throw new ApiError(409, 'This document has not been signed.', 'not_signed')
  const snapshot = document.finalSnapshot as unknown as SignedSnapshot
  // The record is checked against its fingerprint every time: a copy that does not match is not handed out.
  if (createHash('sha256').update(canonicalJson(snapshot)).digest('hex') !== document.snapshotHash) {
    console.error(`[documents] signed record ${document.id} does not match its fingerprint`)
    throw new ApiError(500, 'This document could not be verified. Please contact support.', 'integrity_error')
  }
  const key = pdfKey({ ownerId: document.ownerId, id: document.id, snapshotHash: document.snapshotHash })
  const storage = getStorage()
  let pdf = await storage.get(key).catch(() => null)
  if (!pdf) {
    pdf = renderSignedPdf(snapshot, document.snapshotHash)
    // Somewhere with no writable disk still serves the document; it is simply drawn each time.
    await storage.put(key, pdf, 'application/pdf').then(() => prisma.memberDocument.updateMany({ where: { id: document.id, pdfKey: null }, data: { pdfKey: key } })).catch(() => {})
  }
  await record(prisma, document, 'downloaded', actor, evidence)
  const filename = `${snapshot.title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'document'}-${snapshot.member.name.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 40)}-v${snapshot.version}.pdf`
  return { pdf, filename }
}

export const pdfResponse = (file: { pdf: Buffer; filename: string }) =>
  new Response(new Uint8Array(file.pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${file.filename}"`, 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff' } })

// ---------------------------------------------------------------------------
// Required documents
// ---------------------------------------------------------------------------

export interface RequirementContext { trigger: RequirementTrigger; planId?: string | null; classTypeId?: string | null; appointmentTypeId?: string | null }

/** Templates this member must have signed for this to go ahead, and has not. */
export async function missingRequired(db: Db, ownerId: string, memberId: string, ctx: RequirementContext) {
  const rules = await db.documentRequirement.findMany({ where: { ownerId, trigger: ctx.trigger, isActive: true } })
  const applies = rules.filter((r) =>
    (r.planIds.length === 0 || (!!ctx.planId && r.planIds.includes(ctx.planId))) &&
    (r.classTypeIds.length === 0 || (!!ctx.classTypeId && r.classTypeIds.includes(ctx.classTypeId))) &&
    (r.appointmentTypeIds.length === 0 || (!!ctx.appointmentTypeId && r.appointmentTypeIds.includes(ctx.appointmentTypeId))))
  if (applies.length === 0) return []
  const templates = await db.documentTemplate.findMany({ where: { ownerId, id: { in: applies.map((r) => r.templateId) }, archivedAt: null, publishedVersionId: { not: null } }, select: { id: true, name: true, type: true } })
  if (templates.length === 0) return []
  const signed = await db.memberDocument.findMany({ where: { ownerId, memberId, templateId: { in: templates.map((t) => t.id) }, status: 'signed', OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }] }, select: { templateId: true } })
  return templates.filter((t) => !signed.some((s) => s.templateId === t.id)).map((t) => ({ templateId: t.id, name: t.name, type: t.type, blocking: applies.some((r) => r.templateId === t.id && r.blocking) }))
}

/**
 * The gate a member's own booking or purchase passes through. Anything required and unsigned is
 * given to them (once), and if any of it is blocking the action is refused with the list of what
 * to sign. Call it before the engine's own transaction, so the copies exist whatever happens next.
 * Staff acting for a member are not stopped: the documents are assigned and flagged for them.
 */
export async function requireDocuments(ownerId: string, memberId: string, ctx: RequirementContext, opts: { enforce?: boolean } = {}) {
  const missing = await missingRequired(prisma, ownerId, memberId, ctx)
  if (missing.length === 0) return []
  const waiting: { id: string; name: string; type: string; blocking: boolean; status: string }[] = []
  for (const m of missing) {
    const { document } = await prisma.$transaction((db) => assignDocument(db, { ownerId, templateId: m.templateId, memberId, source: ctx.trigger }), { timeout: 15_000 })
    waiting.push({ id: document.id, name: document.name, type: document.type, blocking: m.blocking, status: document.status })
  }
  const blocking = waiting.filter((w) => w.blocking)
  if (blocking.length && opts.enforce !== false) {
    const names = blocking.map((b) => b.name)
    throw new ApiError(409, `Please sign ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`} first.`, 'documents_required', { documents: blocking.map(({ id, name, type }) => ({ id, name, type })) })
  }
  return waiting
}

/** A new member: anything required at signup is sent to them. Nothing is blocked, since there is nothing yet to block. */
export async function assignSignupDocuments(db: Db, ownerId: string, memberId: string, actor?: ActorRef) {
  const missing = await missingRequired(db, ownerId, memberId, { trigger: 'member_signup' })
  const created: MemberDocument[] = []
  for (const m of missing) {
    const r = await assignDocument(db, { ownerId, templateId: m.templateId, memberId, source: 'member_signup', actor })
    if (r.created) created.push(r.document)
  }
  return created
}

// ---------------------------------------------------------------------------
// Time passing: deadlines, validity and reminders
// ---------------------------------------------------------------------------

async function expireOne(id: string, now = new Date()) {
  return prisma.$transaction(async (db) => {
    await lockRow(db, 'MemberDocument', id)
    const d = await db.memberDocument.findUnique({ where: { id } })
    if (!d) return false
    const unsignedLate = OPEN_STATUSES.includes(d.status as never) && !!d.signBy && d.signBy <= now
    const signedLapsed = d.status === 'signed' && !!d.validUntil && d.validUntil <= now
    if (!unsignedLate && !signedLapsed) return false
    // Only the status moves. A signed record stays exactly as it was signed.
    await db.memberDocument.update({ where: { id }, data: { status: 'expired', expiredAt: now, lastActivityAt: now } })
    await db.documentSigningToken.updateMany({ where: { documentId: id, usedAt: null, revokedAt: null }, data: { revokedAt: now } })
    await record(db, d, 'expired', SYSTEM, { via: 'System' }, { was: d.status, reason: signedLapsed ? 'validity_ended' : 'deadline_passed' })
    await logActivity(db, { ownerId: d.ownerId, memberId: d.memberId, type: 'document_expired', title: signedLapsed ? `${d.name} has expired` : `${d.name} was not signed in time`, metadata: { documentId: d.id } })
    const { fireTrigger } = await import('./automations')
    await fireTrigger(db, d.ownerId, 'document_expired', { memberId: d.memberId, dedupeKey: `document:${d.id}:expired`, context: { document_name: d.name } })
    if (signedLapsed) await notify(db, { ownerId: d.ownerId, type: 'document_expired', title: `${d.name} has expired for a member`, href: `/members/${d.memberId}?tab=documents` })
    return true
  })
}

/** Mark what has run out: unsigned documents past their deadline, and signatures past their validity. */
export async function expireDocuments(ownerId?: string, now = new Date()) {
  const due = await prisma.memberDocument.findMany({
    where: { ...(ownerId && { ownerId }), OR: [{ status: { in: OPEN_STATUSES }, signBy: { lte: now } }, { status: 'signed', validUntil: { lte: now } }] },
    select: { id: true }, take: 500,
  })
  let expired = 0
  for (const d of due) if (await expireOne(d.id, now)) expired++
  return expired
}

/** One reminder for each document still unsigned a few days after it was sent. */
export async function remindUnsigned(origin: string, ownerId?: string, now = new Date()) {
  const due = await prisma.memberDocument.findMany({
    where: { ...(ownerId && { ownerId }), status: { in: OPEN_STATUSES }, remindedAt: null, sentAt: { lte: new Date(now.getTime() - REMIND_AFTER_DAYS * 86_400_000) }, OR: [{ signBy: null }, { signBy: { gt: now } }] },
    take: 200,
  })
  let reminded = 0
  for (const d of due) {
    // Claimed first, so two runs at once remind once.
    const claim = await prisma.memberDocument.updateMany({ where: { id: d.id, remindedAt: null, status: { in: OPEN_STATUSES } }, data: { remindedAt: now } })
    if (claim.count === 0) continue
    await prisma.$transaction(async (db) => {
      await record(db, d, 'reminded', SYSTEM, { via: 'System' })
      await logActivity(db, { ownerId: d.ownerId, memberId: d.memberId, type: 'document_reminder', title: `Reminder: ${d.name} is waiting for your signature`, metadata: { documentId: d.id } })
      const { fireTrigger } = await import('./automations')
      await fireTrigger(db, d.ownerId, 'document_reminder', { memberId: d.memberId, dedupeKey: `document:${d.id}:reminder`, context: { document_name: d.name } })
    })
    await emailSigningLink(d, origin, 'reminder').catch(() => {})
    reminded++
  }
  return reminded
}

/** For a member's profile: what they still owe, and everything else, newest first. */
export async function memberDocumentHistory(ownerId: string, memberId: string) {
  const rows = await prisma.memberDocument.findMany({ where: { ownerId, memberId, status: { not: 'draft' } }, orderBy: { createdAt: 'desc' }, take: 200 })
  return rows.map((d) => ({ ...summary(d), source: d.source, assignedByName: d.assignedByName, voidReason: d.voidReason, declineReason: d.declineReason }))
}

/** Note, once, that someone has started to sign (touched the signature box or typed their name). */
export async function markSigningStarted(document: Pick<MemberDocument, 'id' | 'ownerId' | 'status'>, actor: ActorRef, evidence: Evidence) {
  if (!OPEN_STATUSES.includes(document.status as never)) return { noted: false }
  const already = await prisma.documentEvent.findFirst({ where: { documentId: document.id, type: 'signature_started' }, select: { id: true } })
  if (already) return { noted: false }
  await record(prisma, document, 'signature_started', actor, evidence)
  return { noted: true }
}

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')

/** Email a signing link for each document a member has waiting that has never had one. Used after a workflow assigns documents on its own. */
export async function emailNewDocuments(ownerId: string, memberId: string, origin = appUrl()) {
  const waiting = await prisma.memberDocument.findMany({ where: { ownerId, memberId, status: { in: OPEN_STATUSES }, tokens: { none: {} } }, take: 20 })
  for (const d of waiting) await emailSigningLink(d, origin, 'assigned').catch((error) => console.error('[documents] could not email a signing link:', (error as Error).message))
  return waiting.length
}
