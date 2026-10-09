/** @type {import('next').NextConfig} */
const nextConfig = {
  // Security headers
  async headers() {
    const csp = (frameAncestors) => [
      "default-src 'self'",
      // The development server needs eval for its error overlay and hot reload. Nothing in production does.
      `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'"} https://js.stripe.com`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://api.stripe.com https://api.resend.com",
      "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      `frame-ancestors ${frameAncestors}`,
    ].join('; ')
    const common = [
      // Prevent MIME type sniffing
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      // Enable XSS protection
      { key: 'X-XSS-Protection', value: '1; mode=block' },
      // Referrer policy
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      // Permissions policy (disable unused features)
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), interest-cohort=()' },
      // Strict Transport Security (HTTPS only)
      { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
    ]
    return [
      {
        // Everything except the public booking pages: never shown inside another site's frame.
        source: '/((?!book/).*)',
        headers: [{ key: 'X-Frame-Options', value: 'DENY' }, ...common, { key: 'Content-Security-Policy', value: csp("'none'") }],
      },
      {
        // The public booking page is the one thing a gym embeds in its own website, so it alone
        // may be framed by any site. Nothing behind a staff or member sign-in lives under /book.
        source: '/book/:path*',
        headers: [...common, { key: 'Content-Security-Policy', value: csp('*') }],
      },
      {
        // The embed script is loaded by other websites.
        source: '/embed/:path*',
        headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }, { key: 'Cache-Control', value: 'public, max-age=300' }],
      },
    ]
  },

  // Old URLs from before the navigation was reorganised
  async redirects() {
    return [
      { source: '/prospects', destination: '/leads', permanent: false },
      { source: '/analytics', destination: '/reports/financial', permanent: false },
      { source: '/reports', destination: '/reports/financial', permanent: false },
      { source: '/broadcast', destination: '/communication/campaigns', permanent: false },
      { source: '/invoices', destination: '/settings/invoices', permanent: false },
    ]
  },

  // Performance optimizations
  compress: true,

  // No need to advertise the framework to every visitor.
  poweredByHeader: false,

  // Image optimization
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },

  // Logging
  logging: {
    fetches: {
      fullUrl: true,
    },
  },

  // Experimental features for better performance
  experimental: {
    // Enable server actions optimization
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
}

export default nextConfig
