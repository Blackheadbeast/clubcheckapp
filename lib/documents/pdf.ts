// A signed document as a PDF, written directly: text in the standard PDF fonts, the signature as
// vector strokes. No PDF library, no browser, no images, so it runs anywhere the server does and
// the same snapshot always produces the same pages.
//
// The only input is the signed snapshot. Nothing here reads a template or the database.

import type { Block, Run, SignedSnapshot } from './content'

const PAGE = { width: 612, height: 792, margin: 56 }
const WIDTH = PAGE.width - PAGE.margin * 2

// Helvetica advance widths (per 1000 units) for the printable ASCII range; bold is a little wider.
const HELVETICA = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584]
const HELVETICA_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584]
type Font = 'F1' | 'F2' | 'F3' | 'F4' | 'F5'
const fontOf = (r: Pick<Run, 'bold' | 'italic'>): Font => (r.bold && r.italic ? 'F4' : r.bold ? 'F2' : r.italic ? 'F3' : 'F1')

// Characters outside Latin-1 that the standard encoding still has a place for.
const WIN_ANSI: Record<string, number> = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99 }
/** Text as the bytes the PDF's fonts understand, escaped for a PDF string. Anything unrepresentable becomes "?". */
function encode(text: string) {
  let out = ''
  for (const ch of text) {
    const code = WIN_ANSI[ch] ?? ch.codePointAt(0)!
    const byte = code === 0x09 ? 0x20 : code < 0x20 || code > 0xff || (code >= 0x7f && code <= 0x9f && WIN_ANSI[ch] === undefined) ? 0x3f : code
    out += byte === 0x28 || byte === 0x29 || byte === 0x5c ? `\\${String.fromCharCode(byte)}` : String.fromCharCode(byte)
  }
  return out
}
function widthOf(text: string, font: Font, size: number) {
  let units = 0
  const table = font === 'F2' || font === 'F4' ? HELVETICA_BOLD : HELVETICA
  for (const ch of text) { const code = ch.codePointAt(0)!; units += code >= 32 && code <= 126 ? table[code - 32] : 556 }
  return (units * (font === 'F5' ? 0.9 : 1) * size) / 1000
}

class Writer {
  pages: string[][] = [[]]
  y = PAGE.height - PAGE.margin
  private get page() { return this.pages[this.pages.length - 1] }
  newPage() { this.pages.push([]); this.y = PAGE.height - PAGE.margin }
  /** Make sure `height` fits on this page, or start another. */
  room(height: number) { if (this.y - height < PAGE.margin + 24) this.newPage() }
  text(x: number, y: number, text: string, font: Font, size: number, gray = 0) {
    this.page.push(`BT /${font} ${size} Tf ${gray} g ${x.toFixed(2)} ${y.toFixed(2)} Td (${encode(text)}) Tj ET`)
  }
  line(x1: number, y1: number, x2: number, y2: number, width = 0.5, gray = 0.6) {
    this.page.push(`${gray} G ${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`)
  }
  raw(op: string) { this.page.push(op) }

  /** Runs of mixed bold and italic, wrapped to `width`. Returns nothing; moves the cursor down. */
  runs(runs: Run[], size: number, opts: { x?: number; width?: number; leading?: number; gray?: number } = {}) {
    const x0 = opts.x ?? PAGE.margin
    const max = opts.width ?? WIDTH - (x0 - PAGE.margin)
    const leading = opts.leading ?? size * 1.45
    // Words carry their font, so a line can change style part-way through.
    const words: { text: string; font: Font; space: boolean; underline: boolean }[] = []
    for (const run of runs) {
      const font = fontOf(run)
      const parts = (run.link && run.link !== run.text && !run.link.startsWith('mailto:') ? `${run.text} (${run.link})` : run.text).split(/(\s+)/)
      for (const part of parts) {
        if (!part) continue
        if (/^\s+$/.test(part)) { if (words.length) words[words.length - 1].space = true }
        else words.push({ text: part, font, space: false, underline: !!run.link })
      }
    }
    let line: typeof words = []
    let used = 0
    const flush = () => {
      this.room(leading)
      this.y -= leading
      let x = x0
      for (const w of line) {
        this.text(x, this.y, w.text, w.font, size, opts.gray ?? 0)
        const width = widthOf(w.text, w.font, size)
        if (w.underline) this.line(x, this.y - 1.5, x + width, this.y - 1.5, 0.4, 0.3)
        x += width + (w.space ? widthOf(' ', w.font, size) : 0)
      }
      line = []
      used = 0
    }
    for (const word of words) {
      // A single word wider than the line (a long link, say) is broken rather than run off the page.
      let rest = word.text
      while (widthOf(rest, word.font, size) > max) {
        if (line.length) flush()
        let cut = rest.length
        while (cut > 1 && widthOf(rest.slice(0, cut), word.font, size) > max) cut--
        line = [{ ...word, text: rest.slice(0, cut), space: false }]
        flush()
        rest = rest.slice(cut)
      }
      const w = widthOf(rest, word.font, size)
      if (line.length && used + w > max) flush()
      line.push({ ...word, text: rest })
      used += w + (word.space ? widthOf(' ', word.font, size) : 0)
    }
    if (line.length) flush()
  }
  gap(points: number) { this.y -= points }
}

function drawBlocks(w: Writer, blocks: Block[]) {
  for (const b of blocks) {
    if (b.type === 'page_break') { w.newPage(); continue }
    if (b.type === 'heading') {
      const size = b.level === 1 ? 16 : b.level === 2 ? 13 : 11.5
      w.room(size * 3)
      w.gap(b.level === 1 ? 10 : 7)
      w.runs(b.runs.map((r) => ({ ...r, bold: true })), size)
      w.gap(3)
    } else if (b.type === 'paragraph') {
      w.runs(b.runs, 10.5)
      w.gap(6)
    } else {
      b.items.forEach((item, i) => {
        // room() guarantees the item's first line is on this page, so the marker can be placed before the text is laid out.
        w.room(18)
        w.text(PAGE.margin + 6, w.y - 10.5 * 1.45, b.ordered ? `${i + 1}.` : '•', 'F1', 10.5)
        w.runs(item, 10.5, { x: PAGE.margin + 22 })
        w.gap(2)
      })
      w.gap(5)
    }
  }
}

const stamp = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)} UTC`
}

/** The PDF for a signed document, from its snapshot. `hash` is the snapshot's SHA-256, printed so a copy can be checked against the record. */
export function renderSignedPdf(snapshot: SignedSnapshot, hash: string): Buffer {
  const w = new Writer()
  // Letterhead
  w.y -= 4
  w.text(PAGE.margin, w.y, snapshot.gym.name, 'F2', 13)
  const contact = [snapshot.gym.address, snapshot.gym.phone, snapshot.gym.email].filter(Boolean).join('  ·  ')
  if (contact) { w.y -= 13; w.text(PAGE.margin, w.y, contact, 'F1', 8.5, 0.35) }
  w.y -= 10
  w.line(PAGE.margin, w.y, PAGE.width - PAGE.margin, w.y, 0.8, 0.75)
  w.gap(14)
  w.runs([{ text: snapshot.title, bold: true }], 19, { leading: 24 })
  w.gap(2)
  w.runs([{ text: `Version ${snapshot.version}  ·  ${snapshot.member.name}  ·  ${snapshot.member.email}` }], 9, { gray: 0.35 })
  w.gap(10)

  drawBlocks(w, snapshot.blocks)

  if (snapshot.fields.length) {
    w.room(60)
    w.gap(8)
    w.runs([{ text: 'Completed by the signer', bold: true }], 12)
    w.gap(4)
    for (const f of snapshot.fields) {
      const value = f.type === 'checkbox' ? (f.value === true ? 'Yes (ticked)' : 'No (not ticked)') : typeof f.value === 'string' && f.value ? f.value : 'Not answered'
      w.room(30)
      w.runs([{ text: f.label, bold: true }], 9.5, { gray: 0.25 })
      w.runs([{ text: value }], 10.5, { x: PAGE.margin + 10 })
      w.gap(5)
    }
  }

  // Signature
  w.room(150)
  w.gap(14)
  w.line(PAGE.margin, w.y, PAGE.width - PAGE.margin, w.y, 0.8, 0.75)
  w.gap(6)
  w.runs([{ text: 'Signature', bold: true }], 12)
  const box = { x: PAGE.margin, width: 250, height: 76 }
  const top = w.y - 8
  const sig = snapshot.signature
  if (sig?.method === 'drawn') {
    const scale = Math.min(box.width / sig.width, box.height / sig.height)
    const ops: string[] = ['0 G 1.3 w 1 J 1 j']
    for (const stroke of sig.strokes) {
      stroke.forEach(([x, y], i) => ops.push(`${(box.x + x * scale).toFixed(2)} ${(top - y * scale).toFixed(2)} ${i === 0 ? 'm' : 'l'}`))
      // A dot is a stroke of one point: draw it as a tiny line so it shows.
      if (stroke.length === 1) ops.push(`${(box.x + stroke[0][0] * scale + 0.6).toFixed(2)} ${(top - stroke[0][1] * scale).toFixed(2)} l`)
      ops.push('S')
    }
    w.raw(ops.join(' '))
  } else if (sig?.method === 'typed') {
    w.text(box.x + 4, top - 48, sig.text, 'F5', 26)
  } else {
    w.text(box.x + 4, top - 44, 'Accepted without a drawn or typed signature', 'F3', 10, 0.3)
  }
  w.y = top - box.height - 6
  w.line(box.x, w.y, box.x + box.width, w.y, 0.7, 0.3)
  w.gap(2)
  w.runs([{ text: snapshot.signerName, bold: true }], 10.5)
  w.runs([{ text: `Signed ${stamp(snapshot.evidence.signedAt)}` }], 9.5, { gray: 0.25 })

  // Evidence
  w.room(120)
  w.gap(14)
  w.runs([{ text: 'Signature record', bold: true }], 10)
  const e = snapshot.evidence
  const rows: [string, string][] = [
    ['Signer', `${snapshot.member.name} <${snapshot.member.email}>`],
    ['Signature method', e.method === 'drawn' ? 'Drawn on screen' : e.method === 'typed' ? 'Typed name' : 'Acceptance'],
    ['Consent to sign electronically', `${stamp(e.consentAt)}: "${e.consentText}"`],
    ['Signed', stamp(e.signedAt)],
    ['Signed through', e.via],
    ['IP address', e.ip || 'Not recorded'],
    ['Browser', e.userAgent || 'Not recorded'],
    ['Document', `${snapshot.title}, version ${snapshot.version} (${snapshot.documentId})`],
    ['Record fingerprint (SHA-256)', hash],
  ]
  for (const [label, value] of rows) {
    w.room(22)
    w.runs([{ text: `${label}: `, bold: true }, { text: value }], 8, { gray: 0.3, leading: 11 })
  }

  // Page furniture, then the file itself.
  const total = w.pages.length
  w.pages.forEach((ops, i) => {
    ops.push(`BT /F1 7.5 Tf 0.45 g ${PAGE.margin} 30 Td (${encode(`${snapshot.title} · v${snapshot.version} · ${snapshot.member.name} · record ${hash.slice(0, 16)}`)}) Tj ET`)
    const label = `Page ${i + 1} of ${total}`
    ops.push(`BT /F1 7.5 Tf 0.45 g ${(PAGE.width - PAGE.margin - widthOf(label, 'F1', 7.5)).toFixed(2)} 30 Td (${label}) Tj ET`)
  })

  const objects: string[] = []
  const add = (body: string) => { objects.push(body); return objects.length }
  const fonts = ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique', 'Times-Italic'].map((name) => add(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`))
  const pagesId = objects.length + 1 + w.pages.length * 2
  const kids: number[] = []
  for (const ops of w.pages) {
    const stream = ops.join('\n')
    const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`)
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Contents ${content} 0 R /Resources << /Font << ${fonts.map((id, i) => `/F${i + 1} ${id} 0 R`).join(' ')} >> >> >>`))
  }
  add(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`)
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)
  const date = `D:${snapshot.evidence.signedAt.replace(/[-:T]/g, '').slice(0, 14)}Z`
  const info = add(`<< /Title (${encode(snapshot.title)}) /Author (${encode(snapshot.gym.name)}) /Creator (ClubCheck) /Producer (ClubCheck) /CreationDate (${date}) >>`)

  let file = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'
  const offsets: number[] = []
  objects.forEach((body, i) => { offsets.push(Buffer.byteLength(file, 'latin1')); file += `${i + 1} 0 obj\n${body}\nendobj\n` })
  const xref = Buffer.byteLength(file, 'latin1')
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  file += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(file, 'latin1')
}
