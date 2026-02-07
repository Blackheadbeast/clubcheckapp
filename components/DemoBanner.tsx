'use client'

import Link from 'next/link'

export default function DemoBanner() {
  return (
    <div className="bg-gradient-to-r from-purple-900/50 to-blue-900/50 border-b border-purple-700/50">
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="bg-purple-500 text-white text-xs font-bold px-2 py-0.5 rounded">DEMO</span>
          <span className="text-purple-200 text-sm">
            You&apos;re viewing a demo account. Changes won&apos;t be saved.
          </span>
        </div>
        <Link
          href="/signup"
          className="text-sm font-medium text-white bg-purple-600 hover:bg-purple-500 px-4 py-1.5 rounded-lg transition"
        >
          Create Free Account
        </Link>
      </div>
    </div>
  )
}
