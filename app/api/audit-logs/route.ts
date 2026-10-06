import { NextRequest, NextResponse } from 'next/server'
import { getActor } from '@/lib/api'
import { can } from '@/lib/permissions'
import { getAuditLogs, type AuditAction } from '@/lib/audit'

export async function GET(request: NextRequest) {
  const session = await getActor()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!can(session.actor.role, 'audit.view')) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }
  const auth = session.auth

  const searchParams = request.nextUrl.searchParams
  const page = parseInt(searchParams.get('page') || '1', 10)
  const limit = parseInt(searchParams.get('limit') || '50', 10)
  const action = searchParams.get('action') as AuditAction | null
  const startDateStr = searchParams.get('startDate')
  const endDateStr = searchParams.get('endDate')

  const startDate = startDateStr ? new Date(startDateStr) : undefined
  const endDate = endDateStr ? new Date(endDateStr) : undefined

  try {
    const result = await getAuditLogs(auth.ownerId, {
      page,
      limit: Math.min(limit, 100), // Cap at 100 per request
      action: action || undefined,
      startDate,
      endDate,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Failed to fetch audit logs:', error)
    return NextResponse.json(
      { error: 'Failed to fetch audit logs' },
      { status: 500 }
    )
  }
}
