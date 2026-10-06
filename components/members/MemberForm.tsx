'use client'

import { useState } from 'react'
import { api, ClientError } from '@/lib/client'
import { useLookups } from '@/lib/hooks'
import { Button, Checkbox, Field, FormError, Input, Modal, Select, Textarea, useToast } from '@/components/ui'

export interface MemberFormValues {
  name: string
  email: string
  phone: string
  dateOfBirth: string
  addressLine1: string
  city: string
  state: string
  postalCode: string
  emergencyContactName: string
  emergencyContactPhone: string
  goals: string
  medicalNotes: string
  leadSource: string
  photoUrl: string
  emailOptIn: boolean
  smsOptIn: boolean
  homeLocationId: string
  assignedStaffId: string
}

export const EMPTY_MEMBER: MemberFormValues = {
  name: '', email: '', phone: '', dateOfBirth: '', addressLine1: '', city: '', state: '', postalCode: '',
  emergencyContactName: '', emergencyContactPhone: '', goals: '', medicalNotes: '', leadSource: '', photoUrl: '',
  emailOptIn: true, smsOptIn: false, homeLocationId: '', assignedStaffId: '',
}

export function toPayload(v: MemberFormValues) {
  return { ...v, homeLocationId: v.homeLocationId || null, assignedStaffId: v.assignedStaffId || null }
}

/** Shared member fields. `compact` shows only what the front desk needs to sign someone up. */
export function MemberFields({ value, onChange, compact }: { value: MemberFormValues; onChange: (v: MemberFormValues) => void; compact?: boolean }) {
  const { locations, coaches } = useLookups()
  const set = <K extends keyof MemberFormValues>(key: K, v: MemberFormValues[K]) => onChange({ ...value, [key]: v })
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Full name" required className="sm:col-span-2">
        <Input value={value.name} onChange={(e) => set('name', e.target.value)} autoComplete="off" required />
      </Field>
      <Field label="Email" required>
        <Input type="email" value={value.email} onChange={(e) => set('email', e.target.value)} autoComplete="off" required />
      </Field>
      <Field label="Mobile phone">
        <Input type="tel" value={value.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="off" />
      </Field>
      <Field label="Date of birth">
        <Input type="date" value={value.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />
      </Field>
      <Field label="How did they hear about you?">
        <Input value={value.leadSource} onChange={(e) => set('leadSource', e.target.value)} placeholder="Referral, Instagram, walk-in…" />
      </Field>
      {locations.length > 1 && (
        <Field label="Home location">
          <Select value={value.homeLocationId} onChange={(e) => set('homeLocationId', e.target.value)}>
            <option value="">Not set</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </Field>
      )}
      {coaches.length > 0 && (
        <Field label="Assigned coach">
          <Select value={value.assignedStaffId} onChange={(e) => set('assignedStaffId', e.target.value)}>
            <option value="">None</option>
            {coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
      )}
      {!compact && (
        <>
          <Field label="Street address" className="sm:col-span-2">
            <Input value={value.addressLine1} onChange={(e) => set('addressLine1', e.target.value)} />
          </Field>
          <Field label="City">
            <Input value={value.city} onChange={(e) => set('city', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="State">
              <Input value={value.state} onChange={(e) => set('state', e.target.value)} />
            </Field>
            <Field label="Postal code">
              <Input value={value.postalCode} onChange={(e) => set('postalCode', e.target.value)} />
            </Field>
          </div>
          <Field label="Emergency contact">
            <Input value={value.emergencyContactName} onChange={(e) => set('emergencyContactName', e.target.value)} />
          </Field>
          <Field label="Emergency contact phone">
            <Input type="tel" value={value.emergencyContactPhone} onChange={(e) => set('emergencyContactPhone', e.target.value)} />
          </Field>
          <Field label="Goals" className="sm:col-span-2">
            <Textarea rows={2} value={value.goals} onChange={(e) => set('goals', e.target.value)} />
          </Field>
          <Field label="Medical or injury notes" hint="Visible to staff who can view members." className="sm:col-span-2">
            <Textarea rows={2} value={value.medicalNotes} onChange={(e) => set('medicalNotes', e.target.value)} />
          </Field>
          <Field label="Profile photo URL" className="sm:col-span-2">
            <Input type="url" value={value.photoUrl} onChange={(e) => set('photoUrl', e.target.value)} placeholder="https://" />
          </Field>
          <div className="space-y-2 sm:col-span-2">
            <Checkbox checked={value.emailOptIn} onChange={(e) => set('emailOptIn', e.target.checked)} label="Send marketing emails" />
            <Checkbox checked={value.smsOptIn} onChange={(e) => set('smsOptIn', e.target.checked)} label="Member has opted in to text messages" />
          </div>
        </>
      )}
    </div>
  )
}

export function AddMemberModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast()
  const [value, setValue] = useState(EMPTY_MEMBER)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const created = await api<{ id: string; name: string }>('/api/members', { body: toPayload(value) })
      toast.success(`${created.name} added`)
      setValue(EMPTY_MEMBER)
      onCreated(created.id)
    } catch (err) {
      setError((err as ClientError).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add member"
      description="You can fill in the rest of their profile later."
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" type="submit" form="add-member" loading={saving}>Add member</Button>
        </>
      }
    >
      <form id="add-member" onSubmit={submit} className="space-y-4">
        <MemberFields value={value} onChange={setValue} compact />
        <FormError message={error} />
      </form>
    </Modal>
  )
}
