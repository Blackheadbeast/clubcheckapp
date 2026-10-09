import { handler } from '@/lib/api'
import { createTemplate, listTemplates, templateCreateSchema } from '@/lib/services/documents'

export const dynamic = 'force-dynamic'

// GET /api/documents/templates?archived=1&search=
export const GET = handler({ permission: 'documents.view' }, async ({ ownerId, query }) => listTemplates(ownerId, { archived: query.get('archived') === '1', search: query.get('search') }))

// POST - a new template, starting as a draft
export const POST = handler({ permission: 'documents.manage', write: true, body: templateCreateSchema }, async ({ ownerId, body, actor, audit }) => {
  const template = await createTemplate(ownerId, body, actor)
  await audit('document_template.create', `Created the document template ${template.name}`, { entityType: 'document_template', entityId: template.id })
  return { id: template.id }
})
