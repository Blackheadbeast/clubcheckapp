import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { Page, dateParam, oneOf, pageOf, publicHandler } from '@/lib/public-api/handler'
import { workoutSessionOut } from '@/lib/public-api/serialize'

export const dynamic = 'force-dynamic'

// GET /api/v1/workout-sessions?memberId=&workoutId=&programAssignmentId=&status=&completedSince=&updatedSince=
// What members were given and what they finished. Coach-only notes are never included.
export const GET = publicHandler({ scope: 'workouts:read' }, async ({ ownerId, query }) => {
  const { page, pageSize, skip, take } = pageOf(query)
  const completedSince = dateParam(query, 'completedSince')
  const updatedSince = dateParam(query, 'updatedSince')
  const status = oneOf(query, 'status', ['not_started', 'in_progress', 'completed', 'skipped'] as const)
  const where: Prisma.WorkoutSessionWhereInput = {
    ownerId,
    ...(query.get('memberId') && { memberId: query.get('memberId')! }),
    ...(query.get('workoutId') && { workoutId: query.get('workoutId')! }),
    ...(query.get('programAssignmentId') && { assignmentId: query.get('programAssignmentId')! }),
    ...(status && { status }),
    ...(completedSince && { completedAt: { gte: completedSince } }),
    ...(updatedSince && { updatedAt: { gte: updatedSince } }),
  }
  const [rows, total] = await Promise.all([prisma.workoutSession.findMany({ where, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], skip, take }), prisma.workoutSession.count({ where })])
  return new Page(rows.map(workoutSessionOut), total, page, pageSize)
})
