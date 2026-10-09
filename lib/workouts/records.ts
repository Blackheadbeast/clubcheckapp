// Personal records.
//
// Given what a member logged in one workout and their bests before it, work out which bests were
// beaten. Pure and deterministic: the same inputs always give the same records, in the same order.
//
// A record needs something to be a record of. A first-ever lift is stored as a starting point
// (previous: null) so the next one has something to beat, and is shown as "first recorded", never
// as a PR. Sets missing the numbers a record needs are ignored rather than guessed at.

export type RecordType = 'heaviest_weight' | 'estimated_1rm' | 'reps_at_weight' | 'most_reps' | 'longest_duration' | 'longest_distance' | 'fastest_time' | 'most_rounds'

export interface LoggedSet {
  exerciseId: string | null
  exerciseName: string
  measure: string
  weight?: number | null
  weightUnit?: string | null
  reps?: number | null
  durationSec?: number | null
  distanceM?: number | null
}

export interface Best { value: number; unit: string }
export interface RecordFound {
  exerciseId: string | null
  workoutId: string | null
  name: string
  type: RecordType
  bucket: string
  value: number
  unit: string
  previousValue: number | null
  detail: string
}

export const RECORD_LABELS: Record<RecordType, string> = {
  heaviest_weight: 'Heaviest weight', estimated_1rm: 'Estimated 1RM', reps_at_weight: 'Most reps at a weight', most_reps: 'Most reps',
  longest_duration: 'Longest time', longest_distance: 'Longest distance', fastest_time: 'Fastest time', most_rounds: 'Most rounds',
}
/** Lower is better for these; higher is better for everything else. */
const LOWER_IS_BETTER: RecordType[] = ['fastest_time']

const KG_PER_LB = 0.45359237
const toKg = (value: number, unit: string) => (unit === 'kg' ? value : value * KG_PER_LB)
const fromKg = (kg: number, unit: string) => (unit === 'kg' ? kg : kg / KG_PER_LB)
const round1 = (n: number) => Math.round(n * 10) / 10
const tidy = (n: number) => String(round1(n))

/**
 * Epley's estimate of a one-rep max. Only for sets of 1 to 10 reps: beyond that the estimate says
 * more about endurance than strength, so no number is offered.
 */
export function estimatedOneRepMax(weight: number, reps: number): number | null {
  if (!(weight > 0) || !Number.isInteger(reps) || reps < 1 || reps > 10) return null
  return reps === 1 ? round1(weight) : round1(weight * (1 + reps / 30))
}

export const recordKey = (subject: string, type: RecordType, bucket = '') => `${subject}|${type}|${bucket}`

/** Is `value` better than `best`? Weights are compared in kilograms so a kg lift can beat a lb one. */
function beats(type: RecordType, value: number, unit: string, best: Best) {
  const weight = type === 'heaviest_weight' || type === 'estimated_1rm'
  const a = weight ? toKg(value, unit) : value
  const b = weight ? toKg(best.value, best.unit) : best.value
  // A hair's breadth is not a record: 100 kg does not beat 220.5 lb by rounding.
  return LOWER_IS_BETTER.includes(type) ? a < b - 1e-6 : a > b + 1e-6
}

export interface DetectInput {
  sets: LoggedSet[]
  /** The whole-workout score, for a workout that has one and was done exactly as written. */
  workout?: { id: string; name: string; scoring: 'time' | 'rounds' | null; asPrescribed: boolean; timeSec?: number | null; rounds?: number | null; reps?: number | null } | null
}

export function detectRecords(input: DetectInput, bests: Map<string, Best>): RecordFound[] {
  const found = new Map<string, RecordFound>()
  const offer = (r: Omit<RecordFound, 'previousValue'>) => {
    const key = recordKey(r.exerciseId || `workout:${r.workoutId}`, r.type, r.bucket)
    const current = found.get(key)
    // Within this workout, keep only the best attempt at each record.
    if (current && !beats(r.type, r.value, r.unit, { value: current.value, unit: current.unit })) return
    const before = bests.get(key)
    if (before && !beats(r.type, r.value, r.unit, before)) return
    const comparable = before ? (r.type === 'heaviest_weight' || r.type === 'estimated_1rm' ? round1(fromKg(toKg(before.value, before.unit), r.unit)) : before.value) : null
    found.set(key, { ...r, previousValue: comparable })
  }

  for (const s of input.sets) {
    // A record belongs to an exercise in the library. A free-text substitute has nothing to compare with.
    if (!s.exerciseId) continue
    const base = { exerciseId: s.exerciseId, workoutId: null, name: s.exerciseName }
    const reps = s.reps != null && Number.isInteger(s.reps) && s.reps > 0 ? s.reps : null
    const weight = s.weight != null && s.weight > 0 ? s.weight : null
    const unit = s.weightUnit === 'kg' ? 'kg' : 'lb'
    if (weight && reps) {
      offer({ ...base, type: 'heaviest_weight', bucket: '', value: weight, unit, detail: `${tidy(weight)} ${unit} × ${reps}` })
      const max = estimatedOneRepMax(weight, reps)
      if (max) offer({ ...base, type: 'estimated_1rm', bucket: '', value: max, unit, detail: `from ${tidy(weight)} ${unit} × ${reps}` })
      offer({ ...base, type: 'reps_at_weight', bucket: `${tidy(weight)}${unit}`, value: reps, unit: 'reps', detail: `${reps} reps at ${tidy(weight)} ${unit}` })
    } else if (reps && !weight && (s.measure === 'reps' || s.measure === 'weight_reps')) {
      // Unweighted reps only count for movements that are done unweighted.
      if (s.measure === 'reps') offer({ ...base, type: 'most_reps', bucket: '', value: reps, unit: 'reps', detail: `${reps} reps in one set` })
    }
    if (s.measure === 'time' && s.durationSec != null && s.durationSec > 0) {
      offer({ ...base, type: 'longest_duration', bucket: '', value: s.durationSec, unit: 'sec', detail: `${s.durationSec} seconds` })
    }
    if (s.measure === 'distance' && s.distanceM != null && s.distanceM > 0) {
      offer({ ...base, type: 'longest_distance', bucket: '', value: s.distanceM, unit: 'm', detail: `${tidy(s.distanceM)} m` })
    }
  }

  const w = input.workout
  // A time or a score only means something against the same workout done the same way.
  if (w && w.asPrescribed) {
    const base = { exerciseId: null, workoutId: w.id, name: w.name, bucket: '' }
    if (w.scoring === 'time' && w.timeSec != null && w.timeSec > 0) {
      offer({ ...base, type: 'fastest_time', value: w.timeSec, unit: 'sec', detail: `${Math.floor(w.timeSec / 60)}:${String(w.timeSec % 60).padStart(2, '0')}` })
    }
    if (w.scoring === 'rounds' && w.rounds != null && w.rounds >= 0 && (w.rounds > 0 || (w.reps || 0) > 0)) {
      const reps = Math.min(999, Math.max(0, w.reps || 0))
      // Rounds, with the extra reps as the tie-break: 5 rounds + 12 beats 5 rounds + 3.
      offer({ ...base, type: 'most_rounds', value: w.rounds + reps / 1000, unit: 'rounds', detail: `${w.rounds} round${w.rounds === 1 ? '' : 's'}${reps ? ` + ${reps} reps` : ''}` })
    }
  }
  // A stable order, so the same workout always reports its records the same way.
  return Array.from(found.values()).sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type) || a.bucket.localeCompare(b.bucket))
}

/** A record's value in words: "245 lb", "12 reps", "3:42", "5 rounds + 12 reps". */
export function recordValue(type: string, value: number, unit: string): string {
  if (type === 'fastest_time') return `${Math.floor(value / 60)}:${String(Math.round(value % 60)).padStart(2, '0')}`
  if (type === 'longest_duration') return value >= 60 ? `${Math.floor(value / 60)}:${String(Math.round(value % 60)).padStart(2, '0')}` : `${value} sec`
  if (type === 'most_rounds') { const rounds = Math.floor(value + 1e-9); const reps = Math.round((value - rounds) * 1000); return `${rounds} round${rounds === 1 ? '' : 's'}${reps ? ` + ${reps} reps` : ''}` }
  if (type === 'longest_distance') return value >= 1000 ? `${tidy(value / 1000)} km` : `${tidy(value)} m`
  return `${tidy(value)} ${unit}`
}
