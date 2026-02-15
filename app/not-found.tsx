import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-7xl font-bold text-primary mb-4">404</h1>
        <h2 className="text-xl font-semibold text-gray-100 mb-2">Page not found</h2>
        <p className="text-gray-500 mb-8 max-w-sm mx-auto text-sm">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div className="flex gap-3 justify-center">
          <Link
            href="/"
            className="bg-primary hover:bg-primary-dark text-black font-semibold px-6 py-2.5 rounded-lg transition-colors text-sm"
          >
            Go Home
          </Link>
          <Link
            href="/dashboard"
            className="text-gray-300 hover:text-gray-100 font-medium px-6 py-2.5 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors text-sm"
          >
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
