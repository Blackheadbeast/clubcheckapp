import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError, handler } from '@/lib/api'
import { appOrigin } from '@/lib/member-auth-http'
import { archiveTemplate, discardDraft, draftSchema, duplicateTemplate, publishTemplate, requirementsSchema, saveDraft, saveRequirements, sendToMembers, templateDetail, templateMetaSchema, updateTemplateMeta } from '@/lib/services/documents'

export const dynamic = 'force-dynamic'

// GET - the template, the wording being edited, its versions and what it is required for
export const GET = handler({ permission: 'documents.view' }, async ({ ownerId, params, can }) => {
  const [detail, plans, classTypes, appointmentTypes] = await Promise.all([
    templateDetail(ownerId, params.id),
    prisma.membershipPlan.findMany({ where: { ownerId, isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.classType.findMany({ where: { ownerId, isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.appointmentType.findMany({ where: { ownerId, isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ])
  return { ...detail, canManage: can('documents.manage'), canSend: can('documents.send'), options: { plans, classTypes, appointmentTypes } }
})

// PATCH - the template's name, type and rules (not its wording)
export const PATCH = handler({ permission: 'documents.manage', write: true, body: templateMetaSchema }, async ({ ownerId, params, body, audit }) => {
  const template = await updateTemplateMeta(ownerId, params.id, body)
  await audit('document_template.update', `Updated the document template ${template.name}`, { entityType: 'document_template', entityId: template.id })
  return { id: template.id }
})

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save_draft'), draft: draftSchema }),
  z.object({ action: z.literal('publish') }),
  z.object({ action: z.literal('discard_draft') }),
  z.object({ action: z.literal('duplicate') }),
  z.object({ action: z.literal('archive') }),
  z.object({ action: z.literal('restore') }),
  z.object({ action: z.literal('requirements'), requirements: requirementsSchema }),
  z.object({ action: z.literal('send'), memberIds: z.array(z.string().uuid()).min(1, 'Choose at least one member').max(200), again: z.boolean().optional() }),
])

// POST { action } - edit the wording, publish it, copy or archive the template, say what it is required for, or send it to members
export const POST = handler({ permission: ['documents.manage', 'documents.send'], write: true, body: actionSchema }, async ({ ownerId, params, body, actor, audit, can, req }) => {
  if (body.action === 'send') {
    if (!can('documents.send')) throw new ApiError(403, 'You do not have permission to send documents.', 'forbidden')
    const result = await sendToMembers({ ownerId, templateId: params.id, memberIds: body.memberIds, actor, again: body.again, origin: appOrigin(req) })
    await audit('document.send', `Sent a document to ${result.created.length} member${result.created.length === 1 ? '' : 's'}`, { entityType: 'document_template', entityId: params.id, metadata: { sent: result.created.length, alreadyHad: result.existing.length } })
    return { sent: result.created.length, alreadyHad: result.existing.length, documentIds: result.created.map((d) => d.id) }
  }
  if (!can('documents.manage')) throw new ApiError(403, 'You do not have permission to change document templates.', 'forbidden')
  switch (body.action) {
    case 'save_draft': {
      const { version, started } = await saveDraft(ownerId, params.id, body.draft, actor)
      if (started) await audit('document_template.new_version', `Started version ${version.version} of a document template`, { entityType: 'document_template', entityId: params.id })
      return { version: version.version, status: version.status, startedNewVersion: started }
    }
    case 'publish': {
      const version = await publishTemplate(ownerId, params.id)
      await audit('document_template.publish', `Published version ${version.version} of ${version.title}`, { entityType: 'document_template', entityId: params.id, metadata: { version: version.version } })
      return { version: version.version, status: version.status }
    }
    case 'discard_draft':
      return discardDraft(ownerId, params.id)
    case 'duplicate': {
      const copy = await duplicateTemplate(ownerId, params.id, actor)
      await audit('document_template.duplicate', `Copied a document template as ${copy.name}`, { entityType: 'document_template', entityId: copy.id })
      return { id: copy.id }
    }
    case 'archive':
    case 'restore': {
      const template = await archiveTemplate(ownerId, params.id, body.action === 'archive')
      await audit(`document_template.${body.action}`, `${body.action === 'archive' ? 'Archived' : 'Restored'} the document template ${template.name}`, { entityType: 'document_template', entityId: template.id })
      return { id: template.id, archived: !!template.archivedAt }
    }
    case 'requirements': {
      const rules = await saveRequirements(ownerId, params.id, body.requirements)
      await audit('document_template.requirements', 'Changed when a document is required', { entityType: 'document_template', entityId: params.id, metadata: { rules: rules.map((r) => r.trigger) } })
      return { saved: rules.length }
    }
  }
})
