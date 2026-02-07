import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie } from '@/lib/auth'
import { stripe } from '@/lib/stripe'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface InvoiceItem {
  id: string
  type: 'stripe' | 'manual'
  amountCents: number
  currency: string
  status: string
  date: string
  pdfUrl: string | null
  hostedUrl: string | null
  description: string
}

export async function GET() {
  try {
    const owner = await getOwnerFromCookie()
    if (!owner) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const ownerData = await prisma.owner.findUnique({
      where: { id: owner.ownerId },
      select: {
        stripeCustomerId: true,
      },
    })

    const gymProfile = await prisma.gymProfile.findUnique({
      where: { ownerId: owner.ownerId },
      select: { billingMode: true },
    })

    const billingMode = gymProfile?.billingMode || 'stripe'
    const invoices: InvoiceItem[] = []

    // Fetch Stripe invoices if the owner has a Stripe customer ID
    if (ownerData?.stripeCustomerId) {
      try {
        const stripeInvoices = await stripe.invoices.list({
          customer: ownerData.stripeCustomerId,
          limit: 12,
        })

        for (const inv of stripeInvoices.data) {
          invoices.push({
            id: inv.id,
            type: 'stripe',
            amountCents: inv.amount_paid || inv.amount_due || 0,
            currency: inv.currency || 'usd',
            status: inv.status || 'unknown',
            date: new Date((inv.created || 0) * 1000).toISOString(),
            pdfUrl: inv.invoice_pdf || null,
            hostedUrl: inv.hosted_invoice_url || null,
            description: inv.lines?.data?.[0]?.description || 'Subscription',
          })
        }
      } catch (stripeErr) {
        console.error('Failed to fetch Stripe invoices:', stripeErr)
      }
    }

    // Fetch manual InvoiceRecords from DB (for external billing or supplementary records)
    if (billingMode === 'external' || invoices.length === 0) {
      const dbInvoices = await prisma.invoiceRecord.findMany({
        where: { ownerId: owner.ownerId },
        orderBy: { createdAt: 'desc' },
        take: 12,
      })

      for (const inv of dbInvoices) {
        invoices.push({
          id: inv.id,
          type: 'manual',
          amountCents: inv.amountCents,
          currency: 'usd',
          status: inv.status,
          date: inv.createdAt.toISOString(),
          pdfUrl: inv.pdfUrl,
          hostedUrl: inv.hostedUrl,
          description: inv.type === 'stripe' ? 'Subscription' : 'Manual Invoice',
        })
      }
    }

    // Sort by date descending
    invoices.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    return NextResponse.json({ invoices, billingMode })
  } catch (error) {
    console.error('Get invoices error:', error)
    return NextResponse.json({ error: 'Failed to fetch invoices' }, { status: 500 })
  }
}
