// Where a program's training days fall on the calendar.
//
// Dates here are plain "YYYY-MM-DD" in the gym's own timezone. Week 1 is the calendar week (Monday
// to Sunday) the assignment starts in; training days before the start date are simply not part of
// it. Time spent paused pushes everything after it back by that many days.

import { addDaysToDate } from '@/lib/dates'

const dayNumber = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000)
}
export const daysApart = (from: string, to: string) => dayNumber(to) - dayNumber(from)
/** 1 = Monday … 7 = Sunday. */
export const weekday = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1
}
export const mondayOf = (date: string) => addDaysToDate(date, 1 - weekday(date))
/** A stored date (noon UTC of the local day) back to its local day. */
export const toDay = (stored: Date) => stored.toISOString().slice(0, 10)
export const fromDay = (date: string) => new Date(`${date}T12:00:00.000Z`)

export interface AssignmentTiming {
  startDate: string
  endDate?: string | null
  pausedDays: number
  /** When it was paused, if it is paused now. */
  pausedOn?: string | null
}

/** Days this assignment has been shifted by, counting a pause still running today. */
export function shift(a: AssignmentTiming, today: string) {
  return a.pausedDays + (a.pausedOn ? Math.max(0, daysApart(a.pausedOn, today)) : 0)
}

/** The calendar date of a training day, or null if it falls before the start or after the end. */
export function dateOf(a: AssignmentTiming, week: number, day: number, today: string): string | null {
  const base = addDaysToDate(mondayOf(a.startDate), (week - 1) * 7 + (day - 1))
  if (base < a.startDate) return null
  // A pause pushes the whole schedule back. Days already done keep the date they were done on.
  const moved = addDaysToDate(base, shift(a, today))
  if (a.endDate && moved > a.endDate) return null
  return moved
}

/** Which week and day of the program today is, for showing "Week 3, day 2". */
export function position(a: AssignmentTiming, weeks: number, today: string) {
  const elapsed = daysApart(mondayOf(a.startDate), today) - shift(a, today)
  const week = Math.floor(elapsed / 7) + 1
  return { week: Math.min(Math.max(week, 1), weeks), day: weekday(today), notStarted: today < a.startDate, finished: week > weeks || (!!a.endDate && today > a.endDate) }
}

/** The last calendar day the program has anything on, for knowing when it is over. */
export function lastDate(a: AssignmentTiming, weeks: number, today: string) {
  const end = addDaysToDate(mondayOf(a.startDate), weeks * 7 - 1 + shift(a, today))
  return a.endDate && a.endDate < end ? a.endDate : end
}
