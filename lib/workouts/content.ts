// The shape of a workout.
//
// A workout is a list of blocks; a block is a way of working (straight sets, a superset, a circuit,
// an EMOM, an AMRAP, for time, intervals, or the coach's own words) and holds the exercises done that
// way. Every prescription field is optional, because a plank has no weight and a 5k has no reps.
// New ways of working are a new block type and nothing else: the content is stored as JSON.
//
// This module has no database in it, so the staff builder, the member app and the server all read
// one definition.

import { z } from 'zod'

export const BLOCK_TYPES = ['straight', 'superset', 'circuit', 'emom', 'amrap', 'for_time', 'interval', 'custom'] as const
export type BlockType = (typeof BLOCK_TYPES)[number]
export const BLOCK_LABELS: Record<BlockType, string> = {
  straight: 'Straight sets', superset: 'Superset', circuit: 'Circuit', emom: 'EMOM', amrap: 'AMRAP', for_time: 'For time', interval: 'Intervals', custom: 'Custom',
}
export const WORKOUT_TYPES = ['strength', 'conditioning', 'hypertrophy', 'skill', 'mobility', 'mixed', 'other'] as const
export const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'] as const
export const MEASURES = ['weight_reps', 'reps', 'time', 'distance'] as const
export type Measure = (typeof MEASURES)[number]
/** Suggestions, not a closed list: a gym can type its own category. */
export const EXERCISE_CATEGORIES = ['squat', 'hinge', 'push', 'pull', 'carry', 'olympic lift', 'gymnastics', 'core', 'conditioning', 'mobility', 'cardio']

const id = z.string().min(1).max(40)
const text = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null)
const whole = (max: number) => z.number().int().min(1).max(max).nullish().transform((v) => v ?? null)
const amount = (max: number) => z.number().positive().max(max).nullish().transform((v) => v ?? null)
/** "8", "8-10", "21-15-9", "AMRAP", "max": whatever a coach would write on a whiteboard. */
const reps = z.string().trim().max(24).nullish().transform((v) => v || null)

const prescription = {
  sets: whole(50),
  reps,
  durationSec: whole(86_400),
  distanceM: amount(1_000_000),
  weight: amount(5000),
  weightUnit: z.enum(['lb', 'kg']).nullish().transform((v) => v ?? null),
  /** Percentage of the member's one-rep max. */
  percent: amount(200),
  rpe: z.number().min(1).max(10).nullish().transform((v) => v ?? null),
  restSec: z.number().int().min(0).max(3600).nullish().transform((v) => v ?? null),
  tempo: text(20),
  notes: text(500),
}

const scalingSchema = z.object({
  id: id.optional(),
  /** "Scaled", "Alternative", "Beginner": the coach's word for it. */
  label: z.string().trim().min(1, 'Name the scaling option').max(40),
  /** A different exercise to do instead. Omitted: the same exercise, done differently. */
  exerciseId: z.string().uuid().nullish().transform((v) => v ?? null),
  ...prescription,
})

const itemSchema = z.object({
  id: id.optional(),
  exerciseId: z.string().uuid('Choose an exercise'),
  ...prescription,
  scaling: z.array(scalingSchema).max(6).default([]),
})

const blockSchema = z.object({
  id: id.optional(),
  type: z.enum(BLOCK_TYPES),
  title: text(80),
  instructions: text(1000),
  /** Rounds of a superset or circuit, or the target for a "for time" piece. */
  rounds: whole(100),
  /** How long the whole block runs: an AMRAP's clock, an EMOM's total. */
  durationSec: whole(86_400),
  /** Interval work and rest. */
  workSec: whole(3600),
  restSec: z.number().int().min(0).max(3600).nullish().transform((v) => v ?? null),
  items: z.array(itemSchema).max(30).default([]),
})

/** What a coach submits. Exercise names are filled in by the server from the library. */
export const contentInputSchema = z.object({ blocks: z.array(blockSchema).min(1, 'Add at least one block').max(20) })
  .refine((c) => c.blocks.every((b) => b.type === 'custom' || b.items.length > 0), 'Every block needs at least one exercise (or make it a custom block with instructions)')
  .refine((c) => c.blocks.every((b) => b.type !== 'custom' || b.items.length > 0 || !!b.instructions), 'A custom block needs instructions or exercises')
export type ContentInput = z.infer<typeof contentInputSchema>

export interface Prescription {
  sets: number | null
  reps: string | null
  durationSec: number | null
  distanceM: number | null
  weight: number | null
  weightUnit: 'lb' | 'kg' | null
  percent: number | null
  rpe: number | null
  restSec: number | null
  tempo: string | null
  notes: string | null
}
export interface Scaling extends Prescription {
  id: string
  label: string
  exerciseId: string | null
  /** The exercise done instead, by the name it had when the workout was saved. */
  exerciseName: string | null
  measure: Measure | null
}
export interface WorkoutItem extends Prescription {
  id: string
  exerciseId: string
  /** The name the exercise had when this version was saved. History reads this, not the library. */
  exerciseName: string
  measure: Measure
  scaling: Scaling[]
}
export interface WorkoutBlock {
  id: string
  type: BlockType
  title: string | null
  instructions: string | null
  rounds: number | null
  durationSec: number | null
  workSec: number | null
  restSec: number | null
  items: WorkoutItem[]
}
export interface WorkoutContent {
  blocks: WorkoutBlock[]
}

export const clock = (seconds: number) => {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s === 0 && m > 0 ? `${m} min` : m === 0 ? `${s} sec` : `${m}:${String(s).padStart(2, '0')}`
}
export const stopwatch = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`
const distance = (m: number) => (m >= 1000 && m % 100 === 0 ? `${m / 1000} km` : `${m} m`)

/** "4 × 8 @ 225 lb · RPE 8 · rest 90 sec": a prescription the way a coach would write it. */
export function describePrescription(p: Prescription): string {
  const parts: string[] = []
  const what = p.reps ? p.reps : p.durationSec ? clock(p.durationSec) : p.distanceM ? distance(p.distanceM) : null
  if (p.sets && what) parts.push(`${p.sets} × ${what}`)
  else if (p.sets) parts.push(`${p.sets} set${p.sets === 1 ? '' : 's'}`)
  // A bare "8" reads as nothing in particular; "21-15-9" and "AMRAP" already say what they are.
  else if (what) parts.push(p.reps && /^\d+$/.test(p.reps) ? `${p.reps} rep${p.reps === '1' ? '' : 's'}` : what)
  // Something measured two ways (a 400 m run in 90 seconds, 10 reps over 20 m) says both.
  if (p.reps && p.durationSec) parts.push(clock(p.durationSec))
  if ((p.reps || p.durationSec) && p.distanceM) parts.push(distance(p.distanceM))
  let line = parts.join(' · ')
  if (p.weight) line += `${line ? ' ' : ''}@ ${p.weight} ${p.weightUnit || 'lb'}`
  else if (p.percent) line += `${line ? ' ' : ''}@ ${p.percent}%`
  const extras = [p.rpe ? `RPE ${p.rpe}` : null, p.tempo ? `tempo ${p.tempo}` : null, p.restSec ? `rest ${clock(p.restSec)}` : null].filter(Boolean)
  return [line, ...extras].filter(Boolean).join(' · ')
}

/** "4 rounds", "AMRAP 12 min", "EMOM 10 min", "30 sec on / 30 sec off × 8". */
export function describeBlock(b: Pick<WorkoutBlock, 'type' | 'rounds' | 'durationSec' | 'workSec' | 'restSec'>): string {
  switch (b.type) {
    case 'superset': case 'circuit': return b.rounds ? `${b.rounds} round${b.rounds === 1 ? '' : 's'}` : BLOCK_LABELS[b.type]
    case 'amrap': return b.durationSec ? `AMRAP ${clock(b.durationSec)}` : 'AMRAP'
    case 'emom': return b.durationSec ? `EMOM ${clock(b.durationSec)}` : 'EMOM'
    case 'for_time': return b.rounds ? `${b.rounds} round${b.rounds === 1 ? '' : 's'} for time` : 'For time'
    case 'interval': return [b.workSec ? `${clock(b.workSec)} on` : null, b.restSec ? `${clock(b.restSec)} off` : null].filter(Boolean).join(' / ') + (b.rounds ? ` × ${b.rounds}` : '') || 'Intervals'
    default: return BLOCK_LABELS[b.type]
  }
}

/** Letters for a superset or circuit: A1, A2, B1… Straight sets are just numbered. */
export function itemLabel(blockIndex: number, itemIndex: number, block: { type: BlockType; items: unknown[] }) {
  if (block.type === 'straight' || block.items.length < 2) return ''
  return `${String.fromCharCode(65 + (blockIndex % 26))}${itemIndex + 1}`
}

/**
 * How a whole workout is scored, when it has one obvious score: a single "for time" piece is scored
 * by the clock, a single AMRAP by rounds and reps. Anything else has no overall score.
 */
export function scoring(content: WorkoutContent): 'time' | 'rounds' | null {
  const timed = content.blocks.filter((b) => b.type === 'for_time').length
  const amrap = content.blocks.filter((b) => b.type === 'amrap').length
  if (timed === 1 && amrap === 0) return 'time'
  if (amrap === 1 && timed === 0) return 'rounds'
  return null
}

export const allItems = (content: WorkoutContent) => content.blocks.flatMap((b) => b.items.map((item) => ({ block: b, item })))
export const findItem = (content: WorkoutContent, itemId: string) => allItems(content).find((x) => x.item.id === itemId) || null
/** Sets a member is expected to log for an item: the prescribed sets, or the block's rounds, or one. */
export const expectedSets = (block: Pick<WorkoutBlock, 'type' | 'rounds'>, item: Pick<Prescription, 'sets'>) =>
  item.sets || (['superset', 'circuit', 'interval'].includes(block.type) && block.rounds ? block.rounds : 1)
