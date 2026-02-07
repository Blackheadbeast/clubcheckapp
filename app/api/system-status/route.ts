import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie, isOwnerRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'

interface ServiceStatus {
  name: string
  status: 'operational' | 'degraded' | 'down'
  latency?: number
  message?: string
}

async function checkDatabase(): Promise<ServiceStatus> {
  const start = Date.now()
  try {
    await prisma.$queryRaw`SELECT 1`
    return {
      name: 'Database',
      status: 'operational',
      latency: Date.now() - start,
    }
  } catch (error) {
    return {
      name: 'Database',
      status: 'down',
      message: 'Database connection failed',
    }
  }
}

async function checkStripe(): Promise<ServiceStatus> {
  if (!process.env.STRIPE_SECRET_KEY) {
    return {
      name: 'Stripe',
      status: 'degraded',
      message: 'Not configured',
    }
  }

  const start = Date.now()
  try {
    const response = await fetch('https://api.stripe.com/v1/balance', {
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      },
    })
    if (response.ok) {
      return {
        name: 'Stripe',
        status: 'operational',
        latency: Date.now() - start,
      }
    }
    return {
      name: 'Stripe',
      status: 'degraded',
      message: `HTTP ${response.status}`,
    }
  } catch {
    return {
      name: 'Stripe',
      status: 'down',
      message: 'Connection failed',
    }
  }
}

async function checkEmail(): Promise<ServiceStatus> {
  if (!process.env.RESEND_API_KEY) {
    return {
      name: 'Email (Resend)',
      status: 'degraded',
      message: 'Not configured',
    }
  }

  const start = Date.now()
  try {
    const response = await fetch('https://api.resend.com/domains', {
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
    })
    if (response.ok) {
      return {
        name: 'Email (Resend)',
        status: 'operational',
        latency: Date.now() - start,
      }
    }
    return {
      name: 'Email (Resend)',
      status: 'degraded',
      message: `HTTP ${response.status}`,
    }
  } catch {
    return {
      name: 'Email (Resend)',
      status: 'down',
      message: 'Connection failed',
    }
  }
}

export async function GET() {
  try {
    const auth = await getOwnerFromCookie()
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Only owners can view system status
    if (!isOwnerRole(auth)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Run health checks in parallel
    const [database, stripe, email] = await Promise.all([
      checkDatabase(),
      checkStripe(),
      checkEmail(),
    ])

    const services = [database, stripe, email]

    // Overall status
    const hasDown = services.some((s) => s.status === 'down')
    const hasDegraded = services.some((s) => s.status === 'degraded')
    const overallStatus = hasDown ? 'down' : hasDegraded ? 'degraded' : 'operational'

    return NextResponse.json({
      status: overallStatus,
      services,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
    })
  } catch (error) {
    console.error('System status error:', error)
    return NextResponse.json(
      {
        status: 'down',
        services: [],
        error: 'Failed to check system status',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}
