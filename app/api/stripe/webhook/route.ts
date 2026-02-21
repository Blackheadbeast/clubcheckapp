import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'
import Stripe from 'stripe'

// Simple in-memory cache for processed events (TTL: 5 minutes)
// This prevents duplicate processing when Stripe retries
const processedEvents = new Map<string, number>()
const EVENT_TTL = 5 * 60 * 1000 // 5 minutes

// Clean up old events periodically
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    for (const [id, timestamp] of processedEvents.entries()) {
      if (now - timestamp > EVENT_TTL) {
        processedEvents.delete(id)
      }
    }
  }, 60000) // Every minute
}

export async function POST(request: NextRequest) {
  const body = await request.text()
  const sig = request.headers.get('stripe-signature')!

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (err: unknown) {
    console.error('Webhook signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // Idempotency check - skip if already processed
  if (processedEvents.has(event.id)) {
    console.log(`Skipping duplicate event: ${event.id}`)
    return NextResponse.json({ received: true, duplicate: true })
  }

  // Mark as processing
  processedEvents.set(event.id, Date.now())

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const ownerId = session.metadata?.ownerId
        const planType = session.metadata?.planType

        if (ownerId && session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(
            session.subscription as string
          )

          await prisma.owner.update({
            where: { id: ownerId },
            data: {
              stripeSubscriptionId: subscription.id,
              stripeCustomerId: session.customer as string,
              subscriptionStatus: subscription.status,
              currentPeriodEnd: new Date(subscription.current_period_end * 1000),
              planType: planType || 'starter',
            },
          })

          await prisma.billingEvent.create({
            data: {
              ownerId,
              type: 'subscription_created',
              message: `${planType || 'starter'} subscription activated.`,
              resolvedAt: new Date(),
            },
          })

          // Apply referral credit if this owner was referred
          try {
            const referral = await prisma.referral.findUnique({
              where: { ownerId },
            })

            if (referral?.referredByOwnerId) {
              // Check if we already credited for this referral
              const existingCredit = await prisma.billingEvent.findFirst({
                where: {
                  ownerId: referral.referredByOwnerId,
                  type: 'referral_credit',
                  message: { contains: ownerId },
                },
              })

              if (!existingCredit) {
                // Get the referring owner
                const referringOwner = await prisma.owner.findUnique({
                  where: { id: referral.referredByOwnerId },
                  include: { gymProfile: true },
                })

                if (referringOwner) {
                  const billingMode = referringOwner.gymProfile?.billingMode || 'stripe'

                  if (billingMode === 'stripe' && referringOwner.stripeCustomerId) {
                    // Apply Stripe credit ($50 = 5000 cents, approximately 1 month)
                    try {
                      await stripe.customers.createBalanceTransaction(
                        referringOwner.stripeCustomerId,
                        {
                          amount: -5000, // Negative = credit
                          currency: 'usd',
                          description: 'Referral credit - 1 month free for referring a new gym',
                        }
                      )
                    } catch (stripeErr) {
                      console.error('Stripe credit error:', stripeErr)
                    }
                  } else {
                    // External billing: extend freeUntil
                    const currentFreeUntil = referringOwner.gymProfile?.freeUntil || new Date()
                    const newFreeUntil = new Date(Math.max(currentFreeUntil.getTime(), Date.now()))
                    newFreeUntil.setMonth(newFreeUntil.getMonth() + 1)

                    await prisma.gymProfile.upsert({
                      where: { ownerId: referringOwner.id },
                      create: {
                        ownerId: referringOwner.id,
                        freeUntil: newFreeUntil,
                      },
                      update: {
                        freeUntil: newFreeUntil,
                      },
                    })
                  }

                  // Update credited months
                  await prisma.referral.update({
                    where: { ownerId: referringOwner.id },
                    data: {
                      creditedMonths: { increment: 1 },
                    },
                  })

                  // Create billing event for credit
                  await prisma.billingEvent.create({
                    data: {
                      ownerId: referringOwner.id,
                      type: 'referral_credit',
                      message: `You earned 1 free month for referring a new gym! (Ref: ${ownerId.slice(0, 8)})`,
                      resolvedAt: new Date(),
                    },
                  })
                }
              }
            }
          } catch (refErr) {
            console.error('Referral credit error:', refErr)
            // Don't fail the webhook for referral issues
          }
        }
        break
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice
        const subscriptionId = invoice.subscription as string

        if (subscriptionId) {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId)
          const periodEnd = subscription.current_period_end
            ? new Date(subscription.current_period_end * 1000)
            : null

          const owner = await prisma.owner.findFirst({
            where: { stripeSubscriptionId: subscriptionId },
          })

          await prisma.owner.updateMany({
            where: { stripeSubscriptionId: subscriptionId },
            data: {
              subscriptionStatus: subscription.status,
              ...(periodEnd && { currentPeriodEnd: periodEnd }),
            },
          })

          if (owner) {
            // Update sales referral status to paid on first payment
            await prisma.salesReferral.updateMany({
              where: { ownerId: owner.id, status: { in: ['trialing', 'verified'] } },
              data: { status: 'paid', paidAt: new Date() },
            });

            // Resolve any open payment_failed events
            await prisma.billingEvent.updateMany({
              where: {
                ownerId: owner.id,
                type: 'payment_failed',
                resolvedAt: null,
              },
              data: { resolvedAt: new Date() },
            })

            await prisma.billingEvent.create({
              data: {
                ownerId: owner.id,
                type: 'payment_succeeded',
                message: `Payment of $${((invoice.amount_paid || 0) / 100).toFixed(2)} succeeded.`,
                resolvedAt: new Date(),
              },
            })
          }
        }
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const subscriptionId = invoice.subscription as string

        if (subscriptionId) {
          const owner = await prisma.owner.findFirst({
            where: { stripeSubscriptionId: subscriptionId },
          })

          await prisma.owner.updateMany({
            where: { stripeSubscriptionId: subscriptionId },
            data: { subscriptionStatus: 'past_due' },
          })

          if (owner) {
            await prisma.billingEvent.create({
              data: {
                ownerId: owner.id,
                type: 'payment_failed',
                message: `Payment of $${((invoice.amount_due || 0) / 100).toFixed(2)} failed. Please update your payment method.`,
              },
            })

            // Email owner about failure (non-blocking)
            try {
              const { sendPaymentFailedEmail } = await import('@/lib/email')
              await sendPaymentFailedEmail(owner.email)
            } catch (emailErr) {
              console.error('Failed to send payment failed email:', emailErr)
            }
          }
        }
        break
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        const periodEnd = subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000)
          : null

        await prisma.owner.updateMany({
          where: { stripeSubscriptionId: subscription.id },
          data: {
            subscriptionStatus: subscription.status,
            ...(periodEnd && { currentPeriodEnd: periodEnd }),
          },
        })
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription

        const owner = await prisma.owner.findFirst({
          where: { stripeSubscriptionId: subscription.id },
        })

        await prisma.owner.updateMany({
          where: { stripeSubscriptionId: subscription.id },
          data: { subscriptionStatus: 'canceled' },
        })

        if (owner) {
          // Update sales referral status to churned
          await prisma.salesReferral.updateMany({
            where: { ownerId: owner.id },
            data: { status: 'churned' },
          });

          await prisma.billingEvent.create({
            data: {
              ownerId: owner.id,
              type: 'subscription_canceled',
              message: 'Your subscription has been canceled.',
            },
          })
        }
        break
      }
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Webhook handler error:', error)
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }
}
