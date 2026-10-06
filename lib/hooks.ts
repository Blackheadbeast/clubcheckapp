'use client'

import { useApi } from './client'

export interface Lookups {
  plans: { id: string; name: string; type: string; priceCents: number; billingInterval: string; intervalCount: number; trialDays: number; enrollmentFeeCents: number; credits: number | null; contractMonths: number }[]
  tags: { id: string; name: string; color: string }[]
  staff: { id: string; name: string; role: string; isCoach: boolean }[]
  coaches: { id: string; name: string; role: string; isCoach: boolean }[]
  locations: { id: string; name: string }[]
  classTypes: { id: string; name: string; color: string; category: string; defaultDurationMin: number; defaultCapacity: number }[]
}

const EMPTY: Lookups = { plans: [], tags: [], staff: [], coaches: [], locations: [], classTypes: [] }

/** Reference lists for dropdowns. Returns empty lists while loading so forms can render immediately. */
export function useLookups() {
  const { data, reload } = useApi<Lookups>('/api/lookups')
  return { ...(data || EMPTY), ready: !!data, reload }
}

export function planPriceLabel(plan: Pick<Lookups['plans'][number], 'type' | 'priceCents' | 'billingInterval' | 'intervalCount' | 'credits'>, money: (c: number) => string) {
  if (plan.type === 'free' || plan.priceCents === 0) return 'Free'
  if (plan.type !== 'recurring') return `${money(plan.priceCents)}${plan.credits ? ` · ${plan.credits} session${plan.credits === 1 ? '' : 's'}` : ''}`
  const unit = plan.billingInterval === 'week' ? 'wk' : plan.billingInterval === 'year' ? 'yr' : 'mo'
  return `${money(plan.priceCents)}/${plan.intervalCount > 1 ? `${plan.intervalCount} ` : ''}${unit}`
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  check: 'Check',
  card: 'Card',
  ach: 'Bank transfer (ACH)',
  account_credit: 'Account credit',
  other: 'Other / external terminal',
}
