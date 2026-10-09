import { assertOwned, handler } from '@/lib/api'
import { removePaymentMethod, setDefaultPaymentMethod } from '@/lib/payments/stripe-connect'

export const dynamic = 'force-dynamic'

// PATCH /api/members/:id/payment-methods/:methodId - make it the default for renewals
export const PATCH = handler({ permission: 'billing.manage', write: true }, async ({ ownerId, params, audit }) => {
  await assertOwned(ownerId, 'member', params.id, 'Member')
  const method = await setDefaultPaymentMethod(ownerId, params.id, params.methodId)
  await audit('payment_method.default', `Set the default payment method to one ending ${method.last4}`, { entityType: 'member', entityId: params.id })
  return method
})

export const DELETE = handler({ permission: 'billing.manage', write: true }, async ({ ownerId, params, audit }) => {
  await assertOwned(ownerId, 'member', params.id, 'Member')
  await removePaymentMethod(ownerId, params.id, params.methodId)
  await audit('payment_method.remove', 'Removed a saved payment method', { entityType: 'member', entityId: params.id })
  return { ok: true }
})
