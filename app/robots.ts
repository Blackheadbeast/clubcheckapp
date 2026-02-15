import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/dashboard/', '/members/', '/settings/', '/billing/', '/kiosk/', '/checkin/', '/staff/', '/analytics/', '/broadcast/', '/invoices/', '/prospects/', '/referrals/'],
    },
    sitemap: 'https://clubcheckapp.com/sitemap.xml',
  }
}
