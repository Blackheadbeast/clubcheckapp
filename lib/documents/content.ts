// What a document is made of, shared by the editor, the signing screen, the server and the PDF.
//
// A template's text is written in a small plain markup, deliberately not HTML:
//
//   # Heading        ## Smaller heading      ### Smallest
//   **bold**  *italic*  [link text](https://example.com)
//   - bullet         1. numbered
//   ---              (a line of three dashes on its own: start a new page)
//   {{member.full_name}}   a merge field, filled in when the document is given to someone
//
// It is parsed into blocks of text runs. Nothing in it is ever treated as markup by a browser or
// run as code: every screen and the PDF draw the runs as text. A merge field can only be replaced
// by a value from the fixed list below.

import { z } from 'zod'

export const DOCUMENT_TYPES = {
  waiver: 'Waiver',
  liability_release: 'Liability release',
  membership_agreement: 'Membership agreement',
  terms: 'Terms & conditions',
  policy: 'Gym policy',
  media_release: 'Photo/video release',
  medical_form: 'Medical/emergency information',
  custom: 'Custom document',
} as const
export type DocumentType = keyof typeof DOCUMENT_TYPES
export const DOCUMENT_TYPE_KEYS = Object.keys(DOCUMENT_TYPES) as DocumentType[]

export const DOCUMENT_STATUSES = ['draft', 'sent', 'viewed', 'partially_completed', 'signed', 'declined', 'expired', 'voided'] as const
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number]
/** Still waiting on the member. */
export const OPEN_STATUSES: DocumentStatus[] = ['sent', 'viewed', 'partially_completed']
export const STATUS_LABELS: Record<DocumentStatus, string> = { draft: 'Draft', sent: 'Sent', viewed: 'Viewed', partially_completed: 'Partly completed', signed: 'Signed', declined: 'Declined', expired: 'Expired', voided: 'Voided' }

// ---------------------------------------------------------------------------
// Merge fields
// ---------------------------------------------------------------------------

export const MERGE_FIELDS = {
  'member.first_name': 'Member first name',
  'member.last_name': 'Member last name',
  'member.full_name': 'Member full name',
  'member.email': 'Member email',
  'member.phone': 'Member phone',
  'member.date_of_birth': 'Member date of birth',
  'member.address': 'Member address',
  'gym.name': 'Gym name',
  'gym.address': 'Gym address',
  'gym.phone': 'Gym phone',
  'gym.email': 'Gym email',
  'membership.name': 'Membership name',
  'membership.price': 'Membership price',
  'membership.billing_interval': 'Membership billing interval',
  'membership.start_date': 'Membership start date',
  'membership.end_date': 'Membership end date',
  'today': "Today's date",
} as const
export type MergeField = keyof typeof MERGE_FIELDS
export const MERGE_FIELD_KEYS = Object.keys(MERGE_FIELDS) as MergeField[]
export type MergeValues = Partial<Record<MergeField, string>>
// Own keys only: "constructor" is not a merge field.
const isMergeField = (key: string): key is MergeField => Object.prototype.hasOwnProperty.call(MERGE_FIELDS, key)
const FIELD_RE = /\{\{\s*([a-z_.]+)\s*\}\}/g

/** Merge fields named in a body that are not ones we know. Shown to the author; never filled in. */
export function unknownMergeFields(body: string) {
  const found = new Set<string>()
  for (const m of body.matchAll(FIELD_RE)) if (!isMergeField(m[1])) found.add(m[1])
  return Array.from(found)
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export interface Run { text: string; bold?: boolean; italic?: boolean; link?: string; field?: MergeField }
export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; runs: Run[] }
  | { type: 'paragraph'; runs: Run[] }
  | { type: 'list'; ordered: boolean; items: Run[][] }
  | { type: 'page_break' }

export const MAX_BODY = 60_000

/** Only http(s) links, and mailto: anything else is kept as plain text. */
const safeLink = (href: string) => (/^(https?:\/\/|mailto:)[^\s<>"']+$/i.test(href) ? href : null)

/** One line of text into runs: bold, italic, links and merge fields. Anything unrecognised stays as it was typed. */
export function parseInline(text: string): Run[] {
  const runs: Run[] = []
  const push = (run: Run) => { if (run.text || run.field) runs.push(run) }
  // Links first, then emphasis inside the pieces around them.
  const emphasis = (piece: string, base: Partial<Run>) => {
    const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|\{\{\s*([a-z_.]+)\s*\}\})/g
    let last = 0
    for (const m of piece.matchAll(re)) {
      push({ ...base, text: piece.slice(last, m.index) })
      if (m[2] !== undefined) for (const inner of fields(m[2], { ...base, bold: true })) push(inner)
      else if (m[3] !== undefined) for (const inner of fields(m[3], { ...base, italic: true })) push(inner)
      else if (isMergeField(m[4])) push({ ...base, text: '', field: m[4] as MergeField })
      else push({ ...base, text: m[0] })
      last = m.index! + m[0].length
    }
    push({ ...base, text: piece.slice(last) })
  }
  const fields = (piece: string, base: Partial<Run>): Run[] => {
    const out: Run[] = []
    let last = 0
    for (const m of piece.matchAll(FIELD_RE)) {
      if (m.index! > last) out.push({ ...base, text: piece.slice(last, m.index) })
      out.push(isMergeField(m[1]) ? { ...base, text: '', field: m[1] as MergeField } : { ...base, text: m[0] })
      last = m.index! + m[0].length
    }
    if (last < piece.length) out.push({ ...base, text: piece.slice(last) })
    return out
  }
  const link = /\[([^\]]+)\]\(([^)\s]+)\)/g
  let last = 0
  for (const m of text.matchAll(link)) {
    emphasis(text.slice(last, m.index), {})
    const href = safeLink(m[2])
    if (href) emphasis(m[1], { link: href })
    else emphasis(m[0], {})
    last = m.index! + m[0].length
  }
  emphasis(text.slice(last), {})
  return runs
}

/** The template's text into blocks. */
export function parseBody(body: string): Block[] {
  const blocks: Block[] = []
  let paragraph: string[] = []
  let list: { ordered: boolean; items: Run[][] } | null = null
  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', runs: parseInline(paragraph.join(' ')) })
    paragraph = []
    if (list) blocks.push({ type: 'list', ...list })
    list = null
  }
  for (const raw of body.replace(/\r\n?/g, '\n').slice(0, MAX_BODY).split('\n')) {
    const line = raw.trimEnd()
    const heading = line.match(/^(#{1,3})\s+(.*)$/)
    const bullet = line.match(/^\s*[-*]\s+(.*)$/)
    const numbered = line.match(/^\s*\d{1,3}[.)]\s+(.*)$/)
    if (/^\s*-{3,}\s*$/.test(line)) { flush(); blocks.push({ type: 'page_break' }) }
    else if (heading) { flush(); blocks.push({ type: 'heading', level: heading[1].length as 1 | 2 | 3, runs: parseInline(heading[2]) }) }
    else if (bullet || numbered) {
      const ordered = !bullet
      if (paragraph.length) { blocks.push({ type: 'paragraph', runs: parseInline(paragraph.join(' ')) }); paragraph = [] }
      if (list && list.ordered !== ordered) { blocks.push({ type: 'list', ...list }); list = null }
      list = list || { ordered, items: [] }
      list.items.push(parseInline((bullet || numbered)![1]))
    } else if (line.trim() === '') flush()
    else {
      if (list) { blocks.push({ type: 'list', ...list }); list = null }
      paragraph.push(line.trim())
    }
  }
  flush()
  return blocks
}

/** Fill in the merge fields. A field with no value is left as an underlined blank to be read as "not given". */
export function resolveBlocks(blocks: Block[], values: MergeValues): Block[] {
  const run = (r: Run): Run => {
    if (!r.field) return r
    const { field, ...rest } = r
    return { ...rest, text: values[field] || '__________' }
  }
  return blocks.map((b) => (b.type === 'page_break' ? b : b.type === 'list' ? { ...b, items: b.items.map((item) => item.map(run)) } : { ...b, runs: b.runs.map(run) }))
}

/** For the editor's preview: merge fields shown by name. */
export function previewBlocks(blocks: Block[]): Block[] {
  const run = (r: Run): Run => (r.field ? { text: `[${MERGE_FIELDS[r.field]}]`, bold: r.bold, italic: true } : r)
  return blocks.map((b) => (b.type === 'page_break' ? b : b.type === 'list' ? { ...b, items: b.items.map((item) => item.map(run)) } : { ...b, runs: b.runs.map(run) }))
}

export const blockText = (blocks: Block[]) => blocks.map((b) => (b.type === 'page_break' ? '' : b.type === 'list' ? b.items.map((i) => i.map((r) => r.text).join('')).join('\n') : b.runs.map((r) => r.text).join(''))).join('\n')

// ---------------------------------------------------------------------------
// Fields the signer completes
// ---------------------------------------------------------------------------

export const FIELD_TYPES = { text: 'Short answer', textarea: 'Long answer', date: 'Date', checkbox: 'Tick box', select: 'Choice from a list', initials: 'Initials' } as const
export type FieldType = keyof typeof FIELD_TYPES

export const fieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'Use a short name in lowercase letters, numbers and underscores'),
  label: z.string().trim().min(1, 'Give the field a label').max(200),
  type: z.enum(['text', 'textarea', 'date', 'checkbox', 'select', 'initials']),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
}).refine((f) => f.type !== 'select' || (f.options && f.options.length >= 2), 'A choice needs at least two options')
export type DocumentField = z.infer<typeof fieldSchema>
export const fieldsSchema = z.array(fieldSchema).max(40).refine((list) => new Set(list.map((f) => f.key)).size === list.length, 'Two fields have the same name')

export type FieldValues = Record<string, string | boolean>

/** Check what a signer entered against the fields they were given. Unknown keys are dropped; problems are returned by field. */
export function checkFieldValues(fields: DocumentField[], input: unknown, requireAll: boolean): { values: FieldValues; problems: Record<string, string> } {
  const given = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const values: FieldValues = {}
  const problems: Record<string, string> = {}
  for (const f of fields) {
    const v = given[f.key]
    if (f.type === 'checkbox') {
      if (v === true) values[f.key] = true
      else if (f.required && requireAll) problems[f.key] = 'This must be ticked'
      continue
    }
    const text = typeof v === 'string' ? v.trim() : ''
    if (!text) { if (f.required && requireAll) problems[f.key] = 'This is required'; continue }
    if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(text)) { problems[f.key] = 'Enter a date'; continue }
    if (f.type === 'select' && !(f.options || []).includes(text)) { problems[f.key] = 'Choose one of the options'; continue }
    if (f.type === 'initials' && text.length > 6) { problems[f.key] = 'Initials only'; continue }
    values[f.key] = text.slice(0, f.type === 'textarea' ? 2000 : 300)
  }
  return { values, problems }
}

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

/** A drawn signature is its strokes: lists of points in a box `width` by `height`. No timing, pressure or speed is kept. */
export const signatureSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('typed'), text: z.string().trim().min(2, 'Type your full name').max(120) }),
  z.object({
    method: z.literal('drawn'),
    width: z.number().positive().max(4000),
    height: z.number().positive().max(4000),
    strokes: z.array(z.array(z.tuple([z.number(), z.number()])).min(1).max(4000)).min(1, 'Draw your signature').max(200),
  }).refine((s) => s.strokes.reduce((n, st) => n + st.length, 0) >= 8, 'Draw your signature').refine((s) => s.strokes.reduce((n, st) => n + st.length, 0) <= 20_000, 'That signature is too detailed. Clear it and try again.'),
])
export type Signature = z.infer<typeof signatureSchema>

/** Round a drawn signature to whole numbers inside its box: all that is needed to draw it again. */
export function tidySignature(s: Signature): Signature {
  if (s.method === 'typed') return s
  const clamp = (v: number, max: number) => Math.max(0, Math.min(Math.round(max), Math.round(v)))
  return { method: 'drawn', width: Math.round(s.width), height: Math.round(s.height), strokes: s.strokes.map((st) => st.map(([x, y]) => [clamp(x, s.width), clamp(y, s.height)] as [number, number])) }
}

/** What a person was given to read and complete. Fixed when the document is assigned. */
export interface DocumentContent { title: string; blocks: Block[]; fields: DocumentField[]; requireSignature: boolean }

/** The whole signed record. Fixed at signing; the PDF is drawn from this and nothing else. */
export interface SignedSnapshot {
  documentId: string
  title: string
  type: string
  version: number
  gym: { name: string; address: string | null; phone: string | null; email: string | null }
  member: { name: string; email: string }
  blocks: Block[]
  fields: { key: string; label: string; type: string; value: string | boolean | null }[]
  signature: Signature | null
  signerName: string
  evidence: { consentAt: string; consentText: string; signedAt: string; method: string; ip: string | null; userAgent: string | null; via: string }
}

export const CONSENT_TEXT = 'I agree to use an electronic signature, and that it has the same effect as signing this document on paper.'

/**
 * The text a signed record's fingerprint is taken over: the record with every object's keys in
 * alphabetical order. The database stores JSON without keeping key order, so the fingerprint has
 * to be of something that reads the same before and after it has been stored.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
