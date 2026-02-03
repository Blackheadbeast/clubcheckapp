//app/members/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Member {
  id: string
  name: string
  email: string
  phone: string | null
  status: string
  qrCode: string
  createdAt: string
  qrCodeUrl?: string
}

export default function MembersPage() {
  const router = useRouter()
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [selectedMember, setSelectedMember] = useState<Member | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{
    error?: string
    message?: string
    errors?: string[]
  } | null>(null)
  
  // Form state
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadMembers()
  }, [])

  async function loadMembers() {
    try {
      const res = await fetch('/api/members', {
        credentials: 'include',
      })
      
      if (!res.ok) {
        router.push('/login')
        return
      }

      const data = await res.json()
      setMembers(data.members)
    } catch (error) {
      console.error('Failed to load members:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      const res = await fetch('/api/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone }),
        credentials: 'include',
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to add member')
        setSubmitting(false)
        return
      }

      // Reset form
      setName('')
      setEmail('')
      setPhone('')
      setShowAddForm(false)
      
      // Reload members
      await loadMembers()
    } catch (err) {
      setError('Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCSVImport(e: React.FormEvent) {
    e.preventDefault()
    if (!csvFile) return

    setImporting(true)
    setImportResult(null)

    try {
      const text = await csvFile.text()
      const lines = text.split('\n').filter(line => line.trim())
      
      // Skip header row
      const dataLines = lines.slice(1)
      
      const membersToImport = dataLines.map(line => {
        const [memberName, memberEmail, memberPhone] = line.split(',').map(s => s.trim())
        return { name: memberName, email: memberEmail, phone: memberPhone }
      })

      const res = await fetch('/api/members/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ members: membersToImport }),
        credentials: 'include',
      })

      const data = await res.json()
      setImportResult(data)
      
      if (res.ok) {
        setCsvFile(null)
        await loadMembers()
      }
    } catch (err) {
      setImportResult({ error: 'Failed to parse CSV file' })
    } finally {
      setImporting(false)
    }
  }

  async function viewMemberQR(memberId: string) {
    try {
      const res = await fetch(`/api/members/${memberId}`, {
        credentials: 'include',
      })
      const data = await res.json()
      setSelectedMember(data.member)
    } catch (err) {
      console.error('Failed to load member:', err)
    }
  }

  async function toggleMemberStatus(memberId: string, currentStatus: string) {
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active'
    
    try {
      await fetch(`/api/members/${memberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
        credentials: 'include',
      })

      await loadMembers()
    } catch (err) {
      console.error('Failed to update member:', err)
    }
  }

  async function deleteMember(memberId: string) {
    if (!confirm('Are you sure you want to delete this member?')) return

    try {
      await fetch(`/api/members/${memberId}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      await loadMembers()
    } catch (err) {
      console.error('Failed to delete member:', err)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-primary text-xl">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-4xl font-bold text-primary">Members</h1>
            <p className="text-gray-400 mt-1">{members.length} total members</p>
          </div>
          <div className="flex gap-4">
            <Link
              href="/dashboard"
              className="bg-dark-lighter hover:bg-gray-800 text-gray-100 font-semibold py-2 px-6 rounded-lg border border-gray-700 transition"
            >
              Dashboard
            </Link>
            <button
              onClick={() => setShowImport(!showImport)}
              className="bg-dark-lighter hover:bg-gray-800 text-gray-100 font-semibold py-2 px-6 rounded-lg border border-gray-700 transition"
            >
              {showImport ? 'Cancel Import' : '📥 Import CSV'}
            </button>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="bg-primary hover:bg-primary-dark text-black font-semibold py-2 px-6 rounded-lg transition"
            >
              {showAddForm ? 'Cancel' : '+ Add Member'}
            </button>
          </div>
        </div>

        {/* Add Member Form */}
        {showAddForm && (
          <div className="bg-dark-card p-6 rounded-lg border border-gray-800 mb-8">
            <h2 className="text-xl font-bold text-primary mb-4">Add New Member</h2>
            <form onSubmit={handleAddMember} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Name *</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="w-full px-4 py-2 bg-dark-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
                    placeholder="John Doe"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Email *</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full px-4 py-2 bg-dark-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
                    placeholder="john@example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Phone</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-4 py-2 bg-dark-lighter border border-gray-700 rounded-lg focus:outline-none focus:border-primary text-gray-100"
                    placeholder="(555) 123-4567"
                  />
                </div>
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
                {submitting ? 'Adding...' : 'Add Member'}
              </button>
            </form>
          </div>
        )}

        {/* CSV Import Form */}
        {showImport && (
          <div className="bg-dark-card p-6 rounded-lg border border-gray-800 mb-8">
            <h2 className="text-xl font-bold text-primary mb-4">Import Members from CSV</h2>
            <form onSubmit={handleCSVImport} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Upload CSV File
                </label>
                <input
                  type="file"
                  accept=".csv"
                  onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                  className="w-full px-4 py-2 bg-dark-lighter border border-gray-700 rounded-lg text-gray-100 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-primary file:text-black file:font-semibold hover:file:bg-primary-dark"
                />
                <p className="text-gray-500 text-sm mt-2">
                  CSV format: name, email, phone (one member per line, header row required)
                </p>
                <div className="mt-2 bg-dark-lighter p-3 rounded text-sm text-gray-400 font-mono">
                  Example:<br/>
                  name,email,phone<br/>
                  John Doe,john@example.com,5551234567<br/>
                  Jane Smith,jane@example.com,5559876543
                </div>
              </div>

              {importResult && (
                <div className={`px-4 py-3 rounded-lg ${
                  importResult.error 
                    ? 'bg-red-900/20 border border-red-900 text-red-400'
                    : 'bg-green-900/20 border border-green-900 text-green-400'
                }`}>
                  {importResult.error || importResult.message}
                  {importResult.errors && importResult.errors.length > 0 && (
                    <ul className="mt-2 text-sm">
                      {importResult.errors.map((err: string, i: number) => (
                        <li key={i}>• {err}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={importing || !csvFile}
                className="bg-primary hover:bg-primary-dark text-black font-semibold py-2 px-6 rounded-lg transition disabled:opacity-50"
              >
                {importing ? 'Importing...' : 'Import Members'}
              </button>
            </form>
          </div>
        )}

        {/* Members List */}
        {members.length === 0 ? (
          <div className="bg-dark-card p-12 rounded-lg border border-gray-800 text-center">
            <p className="text-gray-400 text-lg mb-4">No members yet</p>
            <button
              onClick={() => setShowAddForm(true)}
              className="bg-primary hover:bg-primary-dark text-black font-semibold py-2 px-6 rounded-lg transition"
            >
              Add Your First Member
            </button>
          </div>
        ) : (
          <div className="bg-dark-card rounded-lg border border-gray-800 overflow-hidden">
            <table className="w-full">
              <thead className="bg-dark-lighter border-b border-gray-800">
                <tr>
                  <th className="text-left px-6 py-4 text-gray-400 font-medium">Name</th>
                  <th className="text-left px-6 py-4 text-gray-400 font-medium">Email</th>
                  <th className="text-left px-6 py-4 text-gray-400 font-medium">Phone</th>
                  <th className="text-left px-6 py-4 text-gray-400 font-medium">Status</th>
                  <th className="text-left px-6 py-4 text-gray-400 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id} className="border-b border-gray-800 hover:bg-dark-lighter">
                    <td className="px-6 py-4">{member.name}</td>
                    <td className="px-6 py-4 text-gray-400">{member.email}</td>
                    <td className="px-6 py-4 text-gray-400">{member.phone || '-'}</td>
                    <td className="px-6 py-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                        member.status === 'active' 
                          ? 'bg-green-900/20 text-green-400 border border-green-900' 
                          : 'bg-gray-800 text-gray-400 border border-gray-700'
                      }`}>
                        {member.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex gap-2">
                        <button
                          onClick={() => viewMemberQR(member.id)}
                          className="text-primary hover:text-primary-light text-sm font-medium"
                        >
                          QR Code
                        </button>
                        <button
                          onClick={() => toggleMemberStatus(member.id, member.status)}
                          className="text-gray-400 hover:text-gray-200 text-sm font-medium"
                        >
                          {member.status === 'active' ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          onClick={() => deleteMember(member.id)}
                          className="text-red-400 hover:text-red-300 text-sm font-medium"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* QR Code Modal */}
        {selectedMember && (
          <div
            className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50"
            onClick={() => setSelectedMember(null)}
          >
            <div
              className="bg-dark-card p-8 rounded-lg border border-gray-800 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-2xl font-bold text-primary mb-4">{selectedMember.name}</h2>
              <div className="bg-dark p-4 rounded-lg mb-4 flex justify-center">
                {selectedMember.qrCodeUrl && (
                  <img src={selectedMember.qrCodeUrl} alt="Member QR Code" className="w-64 h-64" />
                )}
              </div>
              <p className="text-gray-400 text-sm text-center mb-4">
                Scan this code at check-in
              </p>
              <button
                onClick={() => setSelectedMember(null)}
                className="w-full bg-dark-lighter hover:bg-gray-800 text-gray-100 font-semibold py-2 px-4 rounded-lg border border-gray-700 transition"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}