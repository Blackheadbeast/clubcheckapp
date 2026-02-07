'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navbar from '@/components/Navbar'

interface Invoice {
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

export default function InvoicesPage() {
  const router = useRouter()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/invoices', { credentials: 'include' })
        if (!res.ok) {
          router.push('/login')
          return
        }
        const data = await res.json()
        setInvoices(data.invoices)
      } catch {
        console.error('Failed to load invoices')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [router])

  function formatAmount(cents: number, currency: string) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(cents / 100)
  }

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      paid: 'bg-green-900/20 text-green-400 border-green-900',
      open: 'bg-yellow-900/20 text-yellow-400 border-yellow-900',
      void: 'bg-gray-800 text-gray-400 border-gray-700',
      uncollectible: 'bg-red-900/20 text-red-400 border-red-900',
      draft: 'bg-gray-800 text-gray-400 border-gray-700',
    }
    return (
      <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${colors[status] || colors.draft}`}>
        {status}
      </span>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-primary text-xl">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-theme">
      <Navbar />
      <div className="max-w-5xl mx-auto p-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-primary">Invoices</h1>
          <p className="text-gray-400 mt-1">Your billing history</p>
        </div>

        {/* Invoices Table */}
        {invoices.length === 0 ? (
          <div className="bg-theme-card p-12 rounded-lg border border-theme text-center">
            <p className="text-gray-400 text-lg">No invoices yet</p>
            <p className="text-gray-500 text-sm mt-2">Invoices will appear here once you have an active subscription.</p>
          </div>
        ) : (
          <div className="bg-theme-card rounded-lg border border-theme overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-theme-lighter border-b border-theme">
                  <tr>
                    <th className="text-left px-6 py-4 text-gray-400 font-medium">Date</th>
                    <th className="text-left px-6 py-4 text-gray-400 font-medium">Description</th>
                    <th className="text-left px-6 py-4 text-gray-400 font-medium">Amount</th>
                    <th className="text-left px-6 py-4 text-gray-400 font-medium">Status</th>
                    <th className="text-left px-6 py-4 text-gray-400 font-medium">Type</th>
                    <th className="text-right px-6 py-4 text-gray-400 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="border-b border-theme hover:bg-theme-lighter">
                      <td className="px-6 py-4 text-gray-100">
                        {new Date(inv.date).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="px-6 py-4 text-gray-300">{inv.description}</td>
                      <td className="px-6 py-4 text-gray-100 font-medium">
                        {formatAmount(inv.amountCents, inv.currency)}
                      </td>
                      <td className="px-6 py-4">{statusBadge(inv.status)}</td>
                      <td className="px-6 py-4">
                        <span className="text-xs text-gray-500 bg-theme-lighter px-2 py-1 rounded">
                          {inv.type === 'stripe' ? 'Stripe' : 'Manual'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-3">
                          {inv.hostedUrl && (
                            <a
                              href={inv.hostedUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:text-primary-light text-sm font-medium"
                            >
                              View
                            </a>
                          )}
                          {inv.pdfUrl && (
                            <a
                              href={inv.pdfUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-gray-400 hover:text-gray-200 text-sm font-medium"
                            >
                              PDF
                            </a>
                          )}
                          {!inv.hostedUrl && !inv.pdfUrl && (
                            <span className="text-gray-600 text-sm">-</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
