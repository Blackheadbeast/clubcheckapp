'use client'

// The workout builder. A workout is a list of blocks (straight sets, a superset, an AMRAP…), each
// holding exercises with whatever prescription makes sense for them. No field is required beyond
// the exercise itself: the form shows the usual ones for the movement and keeps the rest one tap away.

import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { BLOCK_LABELS, BLOCK_TYPES, DIFFICULTIES, WORKOUT_TYPES, describeBlock, describePrescription, itemLabel, type BlockType } from '@/lib/workouts/content'
import { Button, Card, Field, Input, Select, Textarea, cn } from '@/components/ui'
import { ExercisePicker, titleCase, type ExerciseRow } from './shared'

type Num = number | null
export interface DraftScaling { id?: string; label: string; exerciseId: string | null; exerciseName: string | null; sets: Num; reps: string; weight: Num; weightUnit: 'lb' | 'kg'; durationSec: Num; distanceM: Num; notes: string }
export interface DraftItem {
  id?: string; exerciseId: string; exerciseName: string; measure: string
  sets: Num; reps: string; durationSec: Num; distanceM: Num; weight: Num; weightUnit: 'lb' | 'kg'; percent: Num; rpe: Num; restSec: Num; tempo: string; notes: string
  scaling: DraftScaling[]
  more?: boolean
}
export interface DraftBlock { id?: string; type: BlockType; title: string; instructions: string; rounds: Num; durationSec: Num; workSec: Num; restSec: Num; items: DraftItem[] }
export interface Draft { name: string; description: string; instructions: string; type: string; difficulty: string; estimatedMinutes: Num; equipment: string; blocks: DraftBlock[] }

export const emptyDraft = (): Draft => ({ name: '', description: '', instructions: '', type: 'strength', difficulty: 'intermediate', estimatedMinutes: null, equipment: '', blocks: [newBlock('straight')] })
const newBlock = (type: BlockType): DraftBlock => ({ type, title: '', instructions: '', rounds: null, durationSec: null, workSec: null, restSec: null, items: [] })
const newItem = (e: ExerciseRow): DraftItem => ({ exerciseId: e.id, exerciseName: e.name, measure: e.measure, sets: null, reps: '', durationSec: null, distanceM: null, weight: null, weightUnit: 'lb', percent: null, rpe: null, restSec: null, tempo: '', notes: '', scaling: [] })

/* eslint-disable @typescript-eslint/no-explicit-any */
/** What the server sent, as the form's own shape. */
export function toDraft(w: { name: string; description: string | null; instructions: string | null; type: string; difficulty: string; estimatedMinutes: number | null; equipment: string[]; content: { blocks: any[] } }): Draft {
  return {
    name: w.name, description: w.description || '', instructions: w.instructions || '', type: w.type, difficulty: w.difficulty, estimatedMinutes: w.estimatedMinutes, equipment: w.equipment.join(', '),
    blocks: w.content.blocks.map((b) => ({
      id: b.id, type: b.type, title: b.title || '', instructions: b.instructions || '', rounds: b.rounds, durationSec: b.durationSec, workSec: b.workSec, restSec: b.restSec,
      items: b.items.map((i: any) => ({
        id: i.id, exerciseId: i.exerciseId, exerciseName: i.exerciseName, measure: i.measure, sets: i.sets, reps: i.reps || '', durationSec: i.durationSec, distanceM: i.distanceM, weight: i.weight, weightUnit: i.weightUnit || 'lb',
        percent: i.percent, rpe: i.rpe, restSec: i.restSec, tempo: i.tempo || '', notes: i.notes || '', more: !!(i.percent || i.rpe || i.tempo || i.notes || (i.measure === 'weight_reps' && (i.durationSec || i.distanceM))),
        scaling: i.scaling.map((s: any) => ({ id: s.id, label: s.label, exerciseId: s.exerciseId, exerciseName: s.exerciseName, sets: s.sets, reps: s.reps || '', weight: s.weight, weightUnit: s.weightUnit || 'lb', durationSec: s.durationSec, distanceM: s.distanceM, notes: s.notes || '' })),
      })),
    })),
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** The form's shape as the request the server expects. Empty fields are left out, not sent as zero. */
export function fromDraft(d: Draft) {
  const text = (s: string) => s.trim() || null
  return {
    name: d.name.trim(), description: text(d.description), instructions: text(d.instructions), type: d.type, difficulty: d.difficulty, estimatedMinutes: d.estimatedMinutes,
    equipment: d.equipment.split(',').map((s) => s.trim()).filter(Boolean),
    content: {
      blocks: d.blocks.map((b) => ({
        id: b.id, type: b.type, title: text(b.title), instructions: text(b.instructions), rounds: b.rounds, durationSec: b.durationSec, workSec: b.workSec, restSec: b.restSec,
        items: b.items.map((i) => ({
          id: i.id, exerciseId: i.exerciseId, sets: i.sets, reps: text(i.reps), durationSec: i.durationSec, distanceM: i.distanceM, weight: i.weight, weightUnit: i.weight ? i.weightUnit : null,
          percent: i.percent, rpe: i.rpe, restSec: i.restSec, tempo: text(i.tempo), notes: text(i.notes),
          scaling: i.scaling.map((s) => ({ id: s.id, label: s.label.trim(), exerciseId: s.exerciseId, sets: s.sets, reps: text(s.reps), weight: s.weight, weightUnit: s.weight ? s.weightUnit : null, durationSec: s.durationSec, distanceM: s.distanceM, notes: text(s.notes) })),
        })),
      })),
    },
  }
}

function NumberField({ label, value, onChange, step, max, className, disabled }: { label: string; value: Num; onChange: (v: Num) => void; step?: number; max?: number; className?: string; disabled?: boolean }) {
  return (
    <label className={cn('block min-w-0', className)}>
      <span className="mb-1 block truncate text-xs text-fg-muted">{label}</span>
      <Input type="number" inputMode="decimal" min={0} max={max} step={step || 1} disabled={disabled} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} className="h-9" />
    </label>
  )
}
function TextField({ label, value, onChange, placeholder, className, disabled, maxLength }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; className?: string; disabled?: boolean; maxLength?: number }) {
  return (
    <label className={cn('block min-w-0', className)}>
      <span className="mb-1 block truncate text-xs text-fg-muted">{label}</span>
      <Input value={value} disabled={disabled} maxLength={maxLength} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="h-9" />
    </label>
  )
}

export function WorkoutBuilder({ draft, onChange, readOnly }: { draft: Draft; onChange: (d: Draft) => void; readOnly?: boolean }) {
  const [picking, setPicking] = useState<{ block: number; item?: number; scaling?: number } | null>(null)
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch })
  const setBlock = (bi: number, patch: Partial<DraftBlock>) => set({ blocks: draft.blocks.map((b, i) => (i === bi ? { ...b, ...patch } : b)) })
  const setItem = (bi: number, ii: number, patch: Partial<DraftItem>) => setBlock(bi, { items: draft.blocks[bi].items.map((x, i) => (i === ii ? { ...x, ...patch } : x)) })
  const setScaling = (bi: number, ii: number, si: number, patch: Partial<DraftScaling>) => setItem(bi, ii, { scaling: draft.blocks[bi].items[ii].scaling.map((x, i) => (i === si ? { ...x, ...patch } : x)) })
  const move = <T,>(list: T[], from: number, by: number) => { const to = from + by; if (to < 0 || to >= list.length) return list; const next = [...list]; [next[from], next[to]] = [next[to], next[from]]; return next }

  const picked = (e: ExerciseRow) => {
    if (!picking) return
    const { block, item, scaling } = picking
    if (item === undefined) setBlock(block, { items: [...draft.blocks[block].items, newItem(e)] })
    else if (scaling === undefined) setItem(block, item, { exerciseId: e.id, exerciseName: e.name, measure: e.measure })
    else setScaling(block, item, scaling, { exerciseId: e.id, exerciseName: e.name })
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Workout name" required className="sm:col-span-2"><Input value={draft.name} disabled={readOnly} maxLength={120} onChange={(e) => set({ name: e.target.value })} placeholder="Lower body strength" /></Field>
          <Field label="Type"><Select value={draft.type} disabled={readOnly} onChange={(e) => set({ type: e.target.value })}>{WORKOUT_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}</Select></Field>
          <Field label="Difficulty"><Select value={draft.difficulty} disabled={readOnly} onChange={(e) => set({ difficulty: e.target.value })}>{DIFFICULTIES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}</Select></Field>
          <Field label="Description" className="sm:col-span-2"><Input value={draft.description} disabled={readOnly} maxLength={1000} onChange={(e) => set({ description: e.target.value })} placeholder="What this session is for" /></Field>
          <Field label="Estimated minutes"><Input type="number" min={1} max={600} disabled={readOnly} value={draft.estimatedMinutes ?? ''} onChange={(e) => set({ estimatedMinutes: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
          <Field label="Equipment" hint="Separate with commas"><Input value={draft.equipment} disabled={readOnly} onChange={(e) => set({ equipment: e.target.value })} placeholder="barbell, rack" /></Field>
          <Field label="Instructions for the member" className="sm:col-span-2 lg:col-span-4"><Textarea rows={2} value={draft.instructions} disabled={readOnly} maxLength={4000} onChange={(e) => set({ instructions: e.target.value })} placeholder="Warm-up, intent, anything to know before starting" /></Field>
        </div>
      </Card>

      {draft.blocks.map((b, bi) => (
        <Card key={bi} padded={false} className="overflow-hidden">
          <div className="flex flex-wrap items-end gap-3 border-b border-line bg-subtle/50 px-4 py-3">
            <label className="block w-40"><span className="mb-1 block text-xs text-fg-muted">Block {bi + 1}</span>
              <Select aria-label={`Block ${bi + 1} type`} value={b.type} disabled={readOnly} onChange={(e) => setBlock(bi, { type: e.target.value as BlockType })} className="h-9">{BLOCK_TYPES.map((t) => <option key={t} value={t}>{BLOCK_LABELS[t]}</option>)}</Select>
            </label>
            <TextField label="Title (optional)" value={b.title} disabled={readOnly} maxLength={80} onChange={(v) => setBlock(bi, { title: v })} placeholder={BLOCK_LABELS[b.type]} className="min-w-[10rem] flex-1" />
            {['superset', 'circuit', 'for_time', 'interval'].includes(b.type) && <NumberField label="Rounds" value={b.rounds} max={100} disabled={readOnly} onChange={(v) => setBlock(bi, { rounds: v })} className="w-20" />}
            {['amrap', 'emom'].includes(b.type) && <NumberField label="Minutes" value={b.durationSec ? Math.round(b.durationSec / 60) : null} max={600} disabled={readOnly} onChange={(v) => setBlock(bi, { durationSec: v ? v * 60 : null })} className="w-24" />}
            {b.type === 'interval' && <><NumberField label="Work (sec)" value={b.workSec} max={3600} disabled={readOnly} onChange={(v) => setBlock(bi, { workSec: v })} className="w-24" /><NumberField label="Rest (sec)" value={b.restSec} max={3600} disabled={readOnly} onChange={(v) => setBlock(bi, { restSec: v })} className="w-24" /></>}
            {!readOnly && (
              <div className="ml-auto flex gap-1">
                <Button size="sm" variant="ghost" aria-label={`Move block ${bi + 1} up`} disabled={bi === 0} onClick={() => set({ blocks: move(draft.blocks, bi, -1) })}><ArrowUp className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" aria-label={`Move block ${bi + 1} down`} disabled={bi === draft.blocks.length - 1} onClick={() => set({ blocks: move(draft.blocks, bi, 1) })}><ArrowDown className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" aria-label={`Remove block ${bi + 1}`} className="text-red-600" disabled={draft.blocks.length === 1} onClick={() => set({ blocks: draft.blocks.filter((_, i) => i !== bi) })}><Trash2 className="h-4 w-4" /></Button>
              </div>
            )}
          </div>
          <div className="space-y-3 p-4">
            {(b.type === 'custom' || b.instructions || !readOnly) && (
              <label className="block"><span className="mb-1 block text-xs text-fg-muted">{b.type === 'custom' ? 'Instructions' : 'Block instructions (optional)'}</span>
                <Textarea rows={b.type === 'custom' ? 3 : 1} value={b.instructions} disabled={readOnly} maxLength={1000} onChange={(e) => setBlock(bi, { instructions: e.target.value })} placeholder={b.type === 'for_time' ? '21-15-9 reps of each, as fast as you can with good form' : b.type === 'custom' ? 'Describe what to do' : ''} />
              </label>
            )}
            {b.items.map((it, ii) => {
              const weighted = it.measure === 'weight_reps'
              return (
                <div key={ii} className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold text-fg-heading">{itemLabel(bi, ii, b) && <span className="mr-1.5 text-fg-subtle">{itemLabel(bi, ii, b)}</span>}{it.exerciseName}</p>
                    <span className="text-xs text-fg-muted">{describePrescription({ ...it, reps: it.reps || null, tempo: it.tempo || null, notes: null, weightUnit: it.weightUnit })}</span>
                    {!readOnly && (
                      <div className="flex gap-1">
                        <Button size="sm" onClick={() => setPicking({ block: bi, item: ii })}>Swap</Button>
                        <Button size="sm" variant="ghost" aria-label={`Move ${it.exerciseName} up`} disabled={ii === 0} onClick={() => setBlock(bi, { items: move(b.items, ii, -1) })}><ArrowUp className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" aria-label={`Move ${it.exerciseName} down`} disabled={ii === b.items.length - 1} onClick={() => setBlock(bi, { items: move(b.items, ii, 1) })}><ArrowDown className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" aria-label={`Remove ${it.exerciseName}`} className="text-red-600" onClick={() => setBlock(bi, { items: b.items.filter((_, i) => i !== ii) })}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    )}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                    <NumberField label="Sets" value={it.sets} max={50} disabled={readOnly} onChange={(v) => setItem(bi, ii, { sets: v })} />
                    {(it.measure === 'weight_reps' || it.measure === 'reps' || it.more) && <TextField label="Reps" value={it.reps} disabled={readOnly} maxLength={24} placeholder="8, 8-10, 21-15-9" onChange={(v) => setItem(bi, ii, { reps: v })} />}
                    {(it.measure === 'time' || it.more) && <NumberField label="Time (sec)" value={it.durationSec} max={86400} disabled={readOnly} onChange={(v) => setItem(bi, ii, { durationSec: v })} />}
                    {(it.measure === 'distance' || it.more) && <NumberField label="Distance (m)" value={it.distanceM} max={1000000} disabled={readOnly} onChange={(v) => setItem(bi, ii, { distanceM: v })} />}
                    {(weighted || it.more) && (
                      <div className="flex min-w-0 items-end gap-1">
                        <NumberField label="Weight" value={it.weight} step={0.5} max={5000} disabled={readOnly} onChange={(v) => setItem(bi, ii, { weight: v })} className="flex-1" />
                        <Select aria-label="Weight unit" value={it.weightUnit} disabled={readOnly} onChange={(e) => setItem(bi, ii, { weightUnit: e.target.value as 'lb' | 'kg' })} className="h-9 w-[4.25rem] px-2"><option value="lb">lb</option><option value="kg">kg</option></Select>
                      </div>
                    )}
                    <NumberField label="Rest (sec)" value={it.restSec} max={3600} disabled={readOnly} onChange={(v) => setItem(bi, ii, { restSec: v })} />
                    {it.more && (
                      <>
                        <NumberField label="% of 1RM" value={it.percent} max={200} disabled={readOnly} onChange={(v) => setItem(bi, ii, { percent: v })} />
                        <NumberField label="RPE" value={it.rpe} step={0.5} max={10} disabled={readOnly} onChange={(v) => setItem(bi, ii, { rpe: v })} />
                        <TextField label="Tempo" value={it.tempo} disabled={readOnly} maxLength={20} placeholder="31X1" onChange={(v) => setItem(bi, ii, { tempo: v })} />
                        <TextField label="Notes" value={it.notes} disabled={readOnly} maxLength={500} onChange={(v) => setItem(bi, ii, { notes: v })} className="col-span-2 sm:col-span-4 lg:col-span-3" />
                      </>
                    )}
                  </div>
                  {it.scaling.length > 0 && (
                    <ul className="mt-3 space-y-2 border-t border-line pt-3">
                      {it.scaling.map((s, si) => (
                        <li key={si} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-6">
                          <TextField label="Scaling option" value={s.label} disabled={readOnly} maxLength={40} placeholder="Scaled" onChange={(v) => setScaling(bi, ii, si, { label: v })} />
                          <div className="min-w-0 sm:col-span-2">
                            <span className="mb-1 block text-xs text-fg-muted">Exercise</span>
                            <div className="flex h-9 items-center gap-2">
                              <span className="min-w-0 flex-1 truncate text-sm text-fg">{s.exerciseName || `${it.exerciseName} (same)`}</span>
                              {!readOnly && <Button size="sm" onClick={() => setPicking({ block: bi, item: ii, scaling: si })}>Choose</Button>}
                              {!readOnly && s.exerciseId && <Button size="sm" variant="ghost" onClick={() => setScaling(bi, ii, si, { exerciseId: null, exerciseName: null })}>Same</Button>}
                            </div>
                          </div>
                          <NumberField label="Sets" value={s.sets} max={50} disabled={readOnly} onChange={(v) => setScaling(bi, ii, si, { sets: v })} />
                          <TextField label="Reps" value={s.reps} disabled={readOnly} maxLength={24} onChange={(v) => setScaling(bi, ii, si, { reps: v })} />
                          <div className="flex items-end gap-1">
                            <NumberField label="Weight" value={s.weight} step={0.5} max={5000} disabled={readOnly} onChange={(v) => setScaling(bi, ii, si, { weight: v })} className="flex-1" />
                            {!readOnly && <Button size="sm" variant="ghost" aria-label={`Remove scaling option ${s.label || si + 1}`} className="h-9 text-red-600" onClick={() => setItem(bi, ii, { scaling: it.scaling.filter((_, i) => i !== si) })}><Trash2 className="h-4 w-4" /></Button>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  {!readOnly && (
                    <div className="mt-2 flex flex-wrap gap-3 text-xs">
                      {!it.more && <button type="button" className="ui-focus rounded font-medium text-accent-text hover:underline" onClick={() => setItem(bi, ii, { more: true })}>More fields (%, RPE, tempo, notes)</button>}
                      {it.scaling.length < 6 && <button type="button" className="ui-focus rounded font-medium text-accent-text hover:underline" onClick={() => setItem(bi, ii, { scaling: [...it.scaling, { label: it.scaling.length === 0 ? 'Scaled' : 'Alternative', exerciseId: null, exerciseName: null, sets: it.sets, reps: it.reps, weight: null, weightUnit: it.weightUnit, durationSec: null, distanceM: null, notes: '' }] })}>Add scaling option</button>}
                    </div>
                  )}
                </div>
              )
            })}
            {!readOnly && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setPicking({ block: bi })}>Add exercise</Button>}
            {b.items.length === 0 && b.type !== 'custom' && <p className="text-xs text-fg-subtle">{describeBlock(b)} needs at least one exercise.</p>}
          </div>
        </Card>
      ))}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-fg-muted">Add a block:</span>
          {BLOCK_TYPES.map((t) => <Button key={t} size="sm" onClick={() => set({ blocks: [...draft.blocks, newBlock(t)] })}>{BLOCK_LABELS[t]}</Button>)}
        </div>
      )}
      <ExercisePicker open={!!picking} onClose={() => setPicking(null)} onPick={picked} />
    </div>
  )
}
