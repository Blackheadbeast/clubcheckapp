'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navbar from '@/components/Navbar'

interface StaffMember {
  id: string
  name: string
  email: string
  role: string
  active: boolean
  createdAt: string
  lastLoginAt: string | null
}

const ROLE_OPTIONS = [
  { value: 'front_desk', label: 'Front Desk', description: 'Can check in members and view member list' },
  { value: 'manager', label: 'Manager', description: 'Full access except staff management and settings' },
]

export default function StaffPage() {
  const router = useRouter()
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [gymCode, setGymCode] = useState('')

  // Add form state
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('front_desk')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Edit modal state
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [editRole, setEditRole] = useState('')
  const [editActive, setEditActive] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadStaff()
  }, [])

  async function loadStaff() {
    try {
      const res = await fetch('/api/staff', { credentials: 'include' })
      if (res.status === 403) {
        // Not an owner, redirect to dashboard
        router.push('/dashboard')
        return
      }
      if (!res.ok) {
        router.push('/login')
        return
      }
      const data = await res.json()
      setStaff(data.staff)

      // Get gym code (owner ID) from settings
      const settingsRes = await fetch('/api/settings', { credentials: 'include' })
      if (settingsRes.ok) {
        const settingsData = await settingsRes.json()
        setGymCode(settingsData.owner.id)
      }
    } catch (err) {
      console.error('Failed to load staff:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleAddStaff(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, role }),
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to add staff')
        return
      }
      setName('')
      setEmail('')
      setPassword('')
      setRole('front_desk')
      setShowAddForm(false)
      await loadStaff()
    } catch {
      setError('Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  function openEditModal(member: StaffMember) {
    setEditingStaff(member)
    setEditName(member.name)
    setEditEmail(member.email)
    setEditPassword('')
    setEditRole(member.role)
    setEditActive(member.active)
    setError('')
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editingStaff) return
    setError('')
    setSaving(true)
    try {
      const updateData: Record<string, unknown> = {
        name: editName,
        email: editEmail,
        role: editRole,
        active: editActive,
      }
      if (editPassword) {
        updateData.password = editPassword
      }

      const res = await fetch(`/api/staff/${editingStaff.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to update')
        return
      }
      setEditingStaff(null)
      await loadStaff()
    } catch {
      setError('Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!editingStaff) return
    if (!confirm(`Delete ${editingStaff.name}? This cannot be undone.`)) return
    try {
      await fetch(`/api/staff/${editingStaff.id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      setEditingStaff(null)
      await loadStaff()
    } catch {
      setError('Failed to delete')
    }
  }

  const roleBadge = (role: string) => {
    const colors: Record<string, string> = {
      front_desk: 'bg-blue-900/20 text-blue-400 border-blue-900',
      manager: 'bg-purple-900/20 text-purple-400 border-purple-900',
    }
    const labels: Record<string, string> = {
      front_desk: 'Front Desk',
      manager: 'Manager',
    }
    return (
      <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${colors[role] || colors.front_desk}`}>
        {labels[role] || role}
      </span>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-primary text-xl">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-theme">
      <Navbar />
      <div className="max-w-5xl mx-auto p-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-primary">Staff</h1>
            <p className="text-gray-400 mt-1">{staff.length} staff member{staff.length !== 1 ? 's' : ''}</p>
          </div>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="bg-primary hover:bg-primary-dark text-black font-semibold py-2 px-5 rounded-lg transition"
          >
            {showAddForm ? 'Cancel' : '+ Add Staff'}
          </button>
        </div>

        {/* Gym Code Info */}
        <div className="bg-theme-card p-4 rounded-lg border border-theme mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-300">Staff Login Gym Code</h3>
              <p className="text-xs text-gray-500 mt-1">Staff members need this code to log in at /staff-login</p>
            </div>
            <div className="flex items-center gap-2">
              <code className="bg-theme-lighter px-3 py-2 rounded text-primary font-mono text-sm">
                {gymCode}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(gymCode)
                }}
                className="text-gray-400 hover:text-primary p-2"
                title="Copy gym code"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Add Staff Form */}
        {showAddForm && (
          <div className="bg-theme-card p-6 rounded-lg border border-theme mb-6">
            <h2 className="text-xl font-bold text-primary mb-4">Add Staff Member</h2>
            <form onSubmit={handleAddStaff} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Name *</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="w-full px-4 py-2 bg-theme-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
                    placeholder="John Smith"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Email *</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full px-4 py-2 bg-theme-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
                    placeholder="john@example.com"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Password *</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    className="w-full px-4 py-2 bg-theme-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
                    placeholder="Min 8 characters"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Role *</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full px-4 py-2 bg-theme-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Role descriptions */}
              <div className="bg-theme-lighter rounded-lg p-4">
                <h4 className="text-sm font-medium text-gray-300 mb-2">Role Permissions:</h4>
                <ul className="text-xs text-gray-500 space-y-1">
                  <li><strong className="text-blue-400">Front Desk:</strong> Check-in members, view member list, kiosk access</li>
                  <li><strong className="text-purple-400">Manager:</strong> Full access except staff management and billing settings</li>
                </ul>
              </div>

              {error && (
                <div className="bg-red-900/20 border border-red-900 text-red-400 px-4 py-2 rounded-lg text-sm">
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={submitting}
                className="bg-primary hover:bg-primary-dark text-black font-semibold py-2 px-6 rounded-lg transition disabled:opacity-50"
              >
                {submitting ? 'Adding...' : 'Add Staff Member'}
              </button>
            </form>
          </div>
        )}

        {/* Staff Table */}
        {staff.length === 0 ? (
          <div className="bg-theme-card p-12 rounded-lg border border-theme text-center">
            <p className="text-gray-400 text-lg mb-4">No staff members yet</p>
            <button
              onClick={() => setShowAddForm(true)}
              className="bg-primary hover:bg-primary-dark text-black font-semibold py-2 px-6 rounded-lg transition"
            >
              Add Your First Staff Member
            </button>
          </div>
        ) : (
          <div className="bg-theme-card rounded-lg border border-theme overflow-hidden">
            <table className="w-full">
              <thead className="bg-theme-lighter border-b border-theme">
                <tr>
                  <th className="text-left px-4 py-4 text-gray-400 font-medium">Name</th>
                  <th className="text-left px-4 py-4 text-gray-400 font-medium">Email</th>
                  <th className="text-left px-4 py-4 text-gray-400 font-medium">Role</th>
                  <th className="text-left px-4 py-4 text-gray-400 font-medium">Status</th>
                  <th className="text-left px-4 py-4 text-gray-400 font-medium">Last Login</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((member) => (
                  <tr
                    key={member.id}
                    onClick={() => openEditModal(member)}
                    className="border-b border-theme hover:bg-theme-lighter cursor-pointer"
                  >
                    <td className="px-4 py-4 font-medium text-gray-100">{member.name}</td>
                    <td className="px-4 py-4 text-gray-400">{member.email}</td>
                    <td className="px-4 py-4">{roleBadge(member.role)}</td>
                    <td className="px-4 py-4">
                      {member.active ? (
                        <span className="text-green-400 text-sm">Active</span>
                      ) : (
                        <span className="text-gray-500 text-sm">Inactive</span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-gray-400 text-sm">
                      {member.lastLoginAt
                        ? new Date(member.lastLoginAt).toLocaleDateString()
                        : 'Never'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Edit Modal */}
        {editingStaff && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-theme-card rounded-lg border border-theme w-full max-w-md">
              <div className="p-6">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-bold text-primary">Edit Staff</h2>
                  <button
                    onClick={() => setEditingStaff(null)}
                    className="text-gray-400 hover:text-gray-100"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <form onSubmit={handleSaveEdit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Name</label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      required
                      className="w-full px-4 py-2 bg-theme-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Email</label>
                    <input
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      required
                      className="w-full px-4 py-2 bg-theme-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      New Password <span className="text-gray-500">(leave blank to keep current)</span>
                    </label>
                    <input
                      type="password"
                      value={editPassword}
                      onChange={(e) => setEditPassword(e.target.value)}
                      minLength={8}
                      className="w-full px-4 py-2 bg-theme-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
                      placeholder="Min 8 characters"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Role</label>
                    <select
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value)}
                      className="w-full px-4 py-2 bg-theme-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editActive}
                        onChange={(e) => setEditActive(e.target.checked)}
                        className="rounded border-gray-600 accent-primary"
                      />
                      <span className="text-gray-300">Active (can log in)</span>
                    </label>
                  </div>

                  {error && (
                    <div className="bg-red-900/20 border border-red-900 text-red-400 px-4 py-2 rounded-lg text-sm">
                      {error}
                    </div>
                  )}

                  <div className="flex gap-3 pt-4">
                    <button
                      type="submit"
                      disabled={saving}
                      className="bg-primary hover:bg-primary-dark text-black font-semibold py-2 px-4 rounded-lg transition disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      className="text-red-400 hover:text-red-300 font-medium py-2 px-4 rounded-lg border border-red-900/50 hover:border-red-700 transition"
                    >
                      Delete
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
