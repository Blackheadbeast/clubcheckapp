'use client'

// Reading and signing one document. The same screen is used in the member app, from an emailed
// signing link, and inside the public booking page; only the address it talks to differs.
//
// The document is drawn from text runs, never as HTML. Nothing is signed by opening it: the person
// has to reach the end, complete what is asked, sign, tick the consent box and submit.

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Download, Eraser, FileText, Loader2, PenLine, Type } from 'lucide-react'
import { api, ClientError } from '@/lib/client'
import type { Block, DocumentField, Run, Signature } from '@/lib/documents/content'
import { Button, Field, FormError, Input, Select, Skeleton, Textarea, cn } from '@/components/ui'

export interface DocumentView {
  id: string; name: string; type: string; version: number; status: string; title: string
  blocks: Block[]; fields: DocumentField[]; requireSignature: boolean; fieldValues: Record<string, string | boolean>
  consentText: string; can: { sign: boolean; decline: boolean; download: boolean }; declineReasonRequired: boolean
  signedAt: string | null; declinedAt: string | null; signBy: string | null; validUntil: string | null
  signerName: string | null; declineReason: string | null; gymName?: string; signerHint?: string
}

// ---------------------------------------------------------------------------
// The document itself
// ---------------------------------------------------------------------------

function Runs({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map((r, i) => {
        const text = <span className={cn(r.bold && 'font-semibold text-fg-heading', r.italic && 'italic')}>{r.text}</span>
        return r.link ? <a key={i} href={r.link} target="_blank" rel="noopener noreferrer nofollow" className="break-words text-accent-text underline">{text}</a> : <span key={i}>{text}</span>
      })}
    </>
  )
}

export function DocumentBody({ blocks, className }: { blocks: Block[]; className?: string }) {
  return (
    <div className={cn('space-y-3 break-words text-[15px] leading-relaxed text-fg', className)}>
      {blocks.map((b, i) => {
        if (b.type === 'page_break') return <hr key={i} className="my-6 border-dashed border-line" aria-hidden />
        if (b.type === 'heading') {
          const Tag = b.level === 1 ? 'h2' : b.level === 2 ? 'h3' : 'h4'
          return <Tag key={i} className={cn('font-semibold text-fg-heading', b.level === 1 ? 'pt-2 text-xl' : b.level === 2 ? 'pt-1 text-lg' : 'text-base')}><Runs runs={b.runs} /></Tag>
        }
        if (b.type === 'list') {
          const Tag = b.ordered ? 'ol' : 'ul'
          return <Tag key={i} className={cn('space-y-1 pl-6', b.ordered ? 'list-decimal' : 'list-disc')}>{b.items.map((item, j) => <li key={j}><Runs runs={item} /></li>)}</Tag>
        }
        return <p key={i}><Runs runs={b.runs} /></p>
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Signature
// ---------------------------------------------------------------------------

/** A box to sign in with a finger, a stylus or a mouse. Keeps the strokes as points and nothing else. */
function SignaturePad({ onChange, onStart }: { onChange: (s: Signature | null) => void; onStart: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const strokes = useRef<[number, number][][]>([])
  const drawing = useRef(false)
  const [empty, setEmpty] = useState(true)

  const redraw = useCallback(() => {
    const el = canvas.current
    if (!el) return
    const ratio = window.devicePixelRatio || 1
    const rect = el.getBoundingClientRect()
    el.width = Math.round(rect.width * ratio)
    el.height = Math.round(rect.height * ratio)
    const ctx = el.getContext('2d')!
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = getComputedStyle(el).color
    for (const stroke of strokes.current) {
      ctx.beginPath()
      stroke.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
      if (stroke.length === 1) ctx.lineTo(stroke[0][0] + 0.5, stroke[0][1])
      ctx.stroke()
    }
  }, [])
  useEffect(() => {
    redraw()
    // Turning the phone changes the box: start again rather than keep a signature drawn for another shape.
    const el = canvas.current
    if (!el) return
    let width = el.getBoundingClientRect().width
    const observer = new ResizeObserver(() => {
      const now = el.getBoundingClientRect().width
      if (Math.abs(now - width) < 2) return
      width = now
      strokes.current = []
      setEmpty(true)
      onChange(null)
      redraw()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [redraw, onChange])

  const point = (e: React.PointerEvent): [number, number] => {
    const rect = canvas.current!.getBoundingClientRect()
    return [Math.round((e.clientX - rect.left) * 10) / 10, Math.round((e.clientY - rect.top) * 10) / 10]
  }
  const emit = () => {
    const rect = canvas.current!.getBoundingClientRect()
    onChange(strokes.current.length ? { method: 'drawn', width: rect.width, height: rect.height, strokes: strokes.current } : null)
  }
  const down = (e: React.PointerEvent) => {
    e.preventDefault()
    canvas.current!.setPointerCapture(e.pointerId)
    drawing.current = true
    if (strokes.current.length === 0) onStart()
    strokes.current.push([point(e)])
    setEmpty(false)
    redraw()
  }
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return
    const stroke = strokes.current[strokes.current.length - 1]
    const p = point(e)
    const last = stroke[stroke.length - 1]
    // Points closer than a pixel and a half add nothing but size.
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.5 || stroke.length >= 3000) return
    stroke.push(p)
    redraw()
  }
  const up = () => { if (drawing.current) { drawing.current = false; emit() } }
  const clear = () => { strokes.current = []; setEmpty(true); onChange(null); redraw() }

  return (
    <div>
      <div className="relative">
        <canvas ref={canvas} role="img" aria-label="Signature box. Draw your signature here." onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up}
          className="block h-40 w-full cursor-crosshair touch-none rounded-xl border-2 border-dashed border-line bg-surface text-fg-heading sm:h-44" />
        {empty && <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-fg-subtle">Sign here with your finger or mouse</p>}
        <span className="pointer-events-none absolute inset-x-6 bottom-9 border-b border-line" aria-hidden />
      </div>
      <div className="mt-2 flex justify-end"><Button size="sm" className="min-h-10" disabled={empty} icon={<Eraser className="h-4 w-4" />} onClick={clear}>Clear and try again</Button></div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

/** A tick box with a whole-row target big enough for a thumb. */
function Tick({ checked, onChange, children, boxed }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; boxed?: boolean }) {
  return (
    <label className={cn('flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm text-fg', boxed && 'rounded-xl border border-line bg-surface p-3')}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 rounded border-line accent-[rgb(var(--color-accent))]" />
      <span className="min-w-0">{children}</span>
    </label>
  )
}

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '')

export function SignDocument({ url, onDone, onClose, closeLabel = 'Back', compact }: { url: string; onDone?: (outcome: 'signed' | 'declined') => void; onClose?: () => void; closeLabel?: string; compact?: boolean }) {
  const [view, setView] = useState<DocumentView | null>(null)
  const [error, setError] = useState<ClientError | null>(null)
  const [values, setValues] = useState<Record<string, string | boolean>>({})
  const [problems, setProblems] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<'draw' | 'type'>('draw')
  const [drawn, setDrawn] = useState<Signature | null>(null)
  const [typed, setTyped] = useState('')
  const [name, setName] = useState('')
  const [consent, setConsent] = useState(false)
  const [read, setRead] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const [download, setDownload] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const started = useRef(false)

  const load = useCallback(() => {
    setError(null)
    api<DocumentView>(url).then((v) => { setView(v); setValues(v.fieldValues || {}); setName((n) => n || v.signerHint || '') }).catch((e: ClientError) => setError(e))
  }, [url])
  useEffect(() => { load() }, [load])

  // "Read" means the end of the document has been on screen.
  useEffect(() => {
    if (!view?.can.sign || !end.current || read) return
    const observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) setRead(true) }, { threshold: 0.6 })
    observer.observe(end.current)
    return () => observer.disconnect()
  }, [view, read])

  const begin = () => {
    if (started.current) return
    started.current = true
    api(url, { body: { action: 'begin' } }).catch(() => {})
  }

  if (error) {
    return (
      <div className="space-y-4 py-6 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-fg-subtle" aria-hidden />
        <p className="text-fg">{error.message}</p>
        <div className="flex flex-wrap justify-center gap-2">{error.status !== 404 && <Button className="min-h-11" onClick={load}>Try again</Button>}{onClose && <Button className="min-h-11" onClick={onClose}>{closeLabel}</Button>}</div>
      </div>
    )
  }
  if (!view) return <div className="space-y-3" aria-busy="true" aria-label="Loading document"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-4 w-1/3" /><Skeleton className="h-40 rounded-xl" /><Skeleton className="h-24 rounded-xl" /></div>

  const signature: Signature | null = mode === 'draw' ? drawn : typed.trim().length >= 2 ? { method: 'typed', text: typed.trim() } : null
  const missing = view.fields.filter((f) => f.required && (f.type === 'checkbox' ? values[f.key] !== true : !String(values[f.key] ?? '').trim()))
  const ready = read && consent && name.trim().length >= 2 && missing.length === 0 && (!view.requireSignature || !!signature)
  const todo = !read ? 'Read to the end of the document' : missing.length ? `Complete: ${missing[0].label}` : view.requireSignature && !signature ? 'Add your signature' : name.trim().length < 2 ? 'Type your full name' : !consent ? 'Tick the box to agree to sign electronically' : null

  const set = (key: string, value: string | boolean) => { setValues((v) => ({ ...v, [key]: value })); setProblems((p) => { const { [key]: _gone, ...rest } = p; return rest }); setSaved(false) }
  const act = async (action: 'sign' | 'decline' | 'fields') => {
    setBusy(action)
    setProblem(null)
    try {
      if (action === 'fields') {
        await api(url, { body: { action: 'fields', fields: values } })
        setSaved(true)
      } else if (action === 'sign') {
        const done = await api<{ downloadToken?: string; signedAt?: string | null; validUntil?: string | null }>(url, { body: { action: 'sign', consent, read, signerName: name.trim(), signature: view.requireSignature ? signature : null, fields: values } })
        setDownload(done.downloadToken ? `/api/public/documents/${done.downloadToken}` : null)
        setView({ ...view, status: 'signed', signedAt: done.signedAt || new Date().toISOString(), validUntil: done.validUntil ?? view.validUntil, signerName: name.trim(), can: { sign: false, decline: false, download: true } })
        onDone?.('signed')
        window.scrollTo({ top: 0 })
      } else {
        await api(url, { body: { action: 'decline', reason: reason.trim() || null } })
        setView({ ...view, status: 'declined', declinedAt: new Date().toISOString(), declineReason: reason.trim() || null, can: { sign: false, decline: false, download: false } })
        setDeclining(false)
        onDone?.('declined')
        window.scrollTo({ top: 0 })
      }
    } catch (e) {
      const err = e as ClientError
      setProblem(err.message)
      if (err.code === 'fields_incomplete' && err.details && typeof err.details === 'object') setProblems(err.details as Record<string, string>)
      // Signed in another tab, withdrawn by the gym, or out of time: show what is true now.
      if (['already_signed', 'voided', 'declined', 'expired', 'not_open', 'invalid_link'].includes(err.code || '')) load()
    } finally {
      setBusy(null)
    }
  }

  // ---- Not (or no longer) waiting for a signature
  if (!view.can.sign) {
    const signed = view.status === 'signed' || (view.status === 'expired' && !!view.signedAt)
    return (
      <div className="space-y-4">
        <div className="text-center">
          <span className={cn('mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full', view.status === 'signed' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-subtle text-fg-muted')}>{view.status === 'signed' ? <Check className="h-6 w-6" aria-hidden /> : <FileText className="h-6 w-6" aria-hidden />}</span>
          <h2 className="break-words text-xl font-semibold text-fg-heading">{view.title}</h2>
          <p className="mt-1 text-sm text-fg-muted">
            {view.status === 'signed' ? `Signed${view.signerName ? ` by ${view.signerName}` : ''} on ${fmtDate(view.signedAt)}.${view.validUntil ? ` Valid until ${fmtDate(view.validUntil)}.` : ''}`
              : view.status === 'declined' ? `You declined this document on ${fmtDate(view.declinedAt)}.${view.declineReason ? ` Reason given: ${view.declineReason}` : ''}`
              : view.status === 'voided' ? 'The gym has withdrawn this document. There is nothing for you to do.'
              : view.status === 'expired' ? (view.signedAt ? `Signed on ${fmtDate(view.signedAt)}. It has since expired and the gym may ask you to sign the current version.` : 'The time to sign this document has passed. Ask the gym to send it again.')
              : 'This document is not waiting for a signature.'}
          </p>
        </div>
        {view.status === 'signed' && <p className="rounded-xl bg-emerald-500/10 px-3 py-2.5 text-center text-sm text-emerald-800 dark:text-emerald-300">Thank you. Your signed copy is saved and cannot be changed.</p>}
        <div className="flex flex-wrap justify-center gap-2">
          {signed && (download || view.can.download) && <a href={download || `${url}/pdf`} className="ui-focus inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line px-4 text-sm font-medium text-fg hover:bg-subtle"><Download className="h-4 w-4" aria-hidden />Download signed copy (PDF)</a>}
          {onClose && <Button variant="primary" className="min-h-11" onClick={onClose}>{closeLabel}</Button>}
        </div>
      </div>
    )
  }

  // ---- Reading and signing
  return (
    <div className="space-y-5">
      <div>
        {view.gymName && <p className="text-sm text-fg-muted">{view.gymName}</p>}
        <h2 className={cn('break-words font-semibold leading-tight text-fg-heading', compact ? 'text-xl' : 'text-2xl')}>{view.title}</h2>
        <p className="mt-1 text-sm text-fg-muted">Version {view.version}{view.signBy ? ` · please sign by ${fmtDate(view.signBy)}` : ''}</p>
      </div>

      <div className="rounded-xl border border-line bg-surface p-4 sm:p-6">
        <DocumentBody blocks={view.blocks} />
        <div ref={end} className="h-px" aria-hidden />
      </div>
      {!read && <p className="sticky bottom-3 z-10 mx-auto w-fit rounded-full bg-fg-heading px-4 py-2 text-center text-xs font-medium text-surface shadow-lg" role="status">Scroll to the end of the document to continue</p>}

      {view.fields.length > 0 && (
        <section aria-labelledby="doc-fields" className="space-y-4">
          <h3 id="doc-fields" className="text-base font-semibold text-fg-heading">Your details</h3>
          {view.fields.map((f) => {
            const label = `${f.label}${f.required ? '' : ' (optional)'}`
            const err = problems[f.key]
            if (f.type === 'checkbox') return <div key={f.key}><Tick checked={values[f.key] === true} onChange={(v) => set(f.key, v)}>{f.label}{f.required && <span className="text-red-600"> *</span>}</Tick>{err && <p className="mt-1 text-xs text-red-600">{err}</p>}</div>
            return (
              <Field key={f.key} label={label} required={f.required} error={err}>
                {f.type === 'textarea' ? <Textarea rows={3} maxLength={2000} value={String(values[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} className="text-base" />
                  : f.type === 'select' ? <Select value={String(values[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} className="h-12 text-base"><option value="">Choose…</option>{(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}</Select>
                  : <Input type={f.type === 'date' ? 'date' : 'text'} maxLength={f.type === 'initials' ? 6 : 300} value={String(values[f.key] ?? '')} onChange={(e) => set(f.key, f.type === 'initials' ? e.target.value.toUpperCase() : e.target.value)} className={cn('h-12 text-base', f.type === 'initials' && 'w-28 text-center font-semibold tracking-widest')} />}
              </Field>
            )
          })}
        </section>
      )}

      <section aria-labelledby="doc-sign" className="space-y-4">
        <h3 id="doc-sign" className="text-base font-semibold text-fg-heading">Sign</h3>
        {view.requireSignature && (
          <div>
            <div role="tablist" aria-label="How to sign" className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-subtle p-1">
              {([['draw', 'Draw', PenLine], ['type', 'Type', Type]] as const).map(([key, label, Icon]) => <button key={key} role="tab" type="button" aria-selected={mode === key} onClick={() => setMode(key)} className={cn('ui-focus inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold', mode === key ? 'bg-surface text-fg-heading shadow-sm' : 'text-fg-muted')}><Icon className="h-4 w-4" aria-hidden />{label}</button>)}
            </div>
            {mode === 'draw' ? <SignaturePad onChange={setDrawn} onStart={begin} /> : (
              <div>
                <Field label="Type your name as your signature"><Input value={typed} maxLength={120} autoComplete="name" onChange={(e) => { begin(); setTyped(e.target.value); if (!name.trim() || name === typed) setName(e.target.value) }} className="h-12 text-base" /></Field>
                <div className="mt-2 flex min-h-[5rem] items-end rounded-xl border-2 border-dashed border-line bg-surface px-5 pb-3" aria-hidden><span className="w-full truncate border-b border-line pb-1 text-3xl text-fg-heading" style={{ fontFamily: '"Snell Roundhand", "Segoe Script", "Brush Script MT", "Apple Chancery", cursive' }}>{typed || ' '}</span></div>
              </div>
            )}
          </div>
        )}
        <Field label="Your full legal name" required><Input value={name} maxLength={120} autoComplete="name" onChange={(e) => setName(e.target.value)} className="h-12 text-base" /></Field>
        <Tick checked={consent} onChange={setConsent} boxed>{view.consentText}</Tick>
        {problem && <FormError message={problem} />}
        <Button variant="primary" size="lg" className="min-h-12 w-full text-base" loading={busy === 'sign'} disabled={!ready || !!busy} onClick={() => act('sign')}>Sign document</Button>
        {todo && <p className="text-center text-sm text-fg-muted" role="status">{todo} to continue.</p>}
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-sm">
          {view.fields.length > 0 && <button type="button" disabled={!!busy} onClick={() => act('fields')} className="ui-focus inline-flex min-h-11 items-center gap-1 rounded px-1 font-medium text-fg-muted hover:text-fg">{busy === 'fields' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : saved ? <Check className="h-4 w-4 text-emerald-600" aria-hidden /> : null}{saved ? 'Saved' : 'Save and finish later'}</button>}
          {view.can.decline && !declining && <button type="button" onClick={() => setDeclining(true)} className="ui-focus min-h-11 rounded px-1 font-medium text-fg-muted hover:text-fg">I do not want to sign this</button>}
          {onClose && <button type="button" onClick={onClose} className="ui-focus min-h-11 rounded px-1 font-medium text-fg-muted hover:text-fg">{closeLabel}</button>}
        </div>
        {declining && (
          <div className="space-y-3 rounded-xl border border-line bg-subtle p-4">
            <p className="font-semibold text-fg-heading">Decline this document?</p>
            <p className="text-sm text-fg-muted">The gym will be told. Anything that needs this document signed will stay on hold.</p>
            <Field label={`Reason${view.declineReasonRequired ? '' : ' (optional)'}`} required={view.declineReasonRequired}><Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <div className="flex flex-wrap gap-2"><Button variant="danger" className="min-h-11" loading={busy === 'decline'} disabled={view.declineReasonRequired && !reason.trim()} onClick={() => act('decline')}>Yes, decline</Button><Button className="min-h-11" disabled={!!busy} onClick={() => setDeclining(false)}>Go back</Button></div>
          </div>
        )}
      </section>
    </div>
  )
}
