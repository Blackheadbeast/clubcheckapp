import { NextRequest } from 'next/server'
import { notFoundResponse } from '@/lib/public-api/handler'

export const dynamic = 'force-dynamic'

// Anything under /api/v1 that is not a real endpoint answers in the API's own error shape.
const none = (req: NextRequest) => notFoundResponse(req)
export { none as GET, none as POST, none as PUT, none as PATCH, none as DELETE }
