'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navbar from '@/components/Navbar'
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'

interface RevenueData {
  mrr: number
  arr: number
  daily: { date: string; revenue: number }[]
}

interface AttendanceData {
  today: number
  total30d: number
  avgPerDay: number
  daily: { date: string; checkins: number; unique: number }[]
}

interface MemberGrowthData {
  total: number
  active: number
  weekly: { week: string; total: number; new: number }[]
}

interface TopMember {
  id: string
  name: string
  email: string
  checkins: number
}

interface AnalyticsData {
  revenue: RevenueData
  attendance: AttendanceData
  memberGrowth: MemberGrowthData
  topMembers: TopMember[]
}

export default function AnalyticsPage() {
  const router = useRouter()
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/analytics', { credentials: 'include' })
        if (!res.ok) {
          router.push('/login')
          return
        }
        const json = await res.json()
        setData(json)
      } catch (err) {
        console.error('Failed to load analytics:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [router])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-primary text-xl">Loading analytics...</div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-red-400 text-xl">Failed to load analytics</div>
      </div>
    )
  }

  // Format date for tooltips
  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
    <div className="min-h-screen bg-dark">
      <Navbar />
      <div className="max-w-7xl mx-auto p-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-primary">Analytics</h1>
          <p className="text-gray-400 mt-1">Performance insights for your gym</p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-dark-card p-6 rounded-lg border border-gray-800">
            <div className="text-gray-400 text-sm mb-2">Monthly Recurring Revenue</div>
            <div className="text-4xl font-bold text-primary">${data.revenue.mrr.toLocaleString()}</div>
            <div className="text-gray-500 text-sm mt-2">MRR estimate</div>
          </div>

          <div className="bg-dark-card p-6 rounded-lg border border-gray-800">
            <div className="text-gray-400 text-sm mb-2">Annual Recurring Revenue</div>
            <div className="text-4xl font-bold text-green-400">${data.revenue.arr.toLocaleString()}</div>
            <div className="text-gray-500 text-sm mt-2">ARR projection</div>
          </div>

          <div className="bg-dark-card p-6 rounded-lg border border-gray-800">
            <div className="text-gray-400 text-sm mb-2">Check-ins Today</div>
            <div className="text-4xl font-bold text-blue-400">{data.attendance.today}</div>
            <div className="text-gray-500 text-sm mt-2">Avg: {data.attendance.avgPerDay}/day</div>
          </div>

          <div className="bg-dark-card p-6 rounded-lg border border-gray-800">
            <div className="text-gray-400 text-sm mb-2">Total Members</div>
            <div className="text-4xl font-bold text-purple-400">{data.memberGrowth.total}</div>
            <div className="text-gray-500 text-sm mt-2">{data.memberGrowth.active} active</div>
          </div>
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Revenue Chart */}
          <div className="bg-dark-card p-6 rounded-lg border border-gray-800">
            <h2 className="text-xl font-semibold text-gray-100 mb-4">Revenue (Last 30 Days)</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.revenue.daily}>
                  <defs>
                    <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDate}
                    stroke="#666"
                    tick={{ fill: '#666', fontSize: 12 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    stroke="#666"
                    tick={{ fill: '#666', fontSize: 12 }}
                    tickFormatter={(v) => `$${v}`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1a1a1a',
                      border: '1px solid #333',
                      borderRadius: '8px',
                    }}
                    labelFormatter={formatDate}
                    formatter={(value: number) => [`$${value}`, 'Revenue']}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    fill="url(#revenueGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Attendance Chart */}
          <div className="bg-dark-card p-6 rounded-lg border border-gray-800">
            <h2 className="text-xl font-semibold text-gray-100 mb-4">Attendance (Last 30 Days)</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.attendance.daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDate}
                    stroke="#666"
                    tick={{ fill: '#666', fontSize: 12 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis stroke="#666" tick={{ fill: '#666', fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1a1a1a',
                      border: '1px solid #333',
                      borderRadius: '8px',
                    }}
                    labelFormatter={formatDate}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="checkins"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={false}
                    name="Total Check-ins"
                  />
                  <Line
                    type="monotone"
                    dataKey="unique"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    dot={false}
                    name="Unique Members"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Member Growth Chart */}
          <div className="bg-dark-card p-6 rounded-lg border border-gray-800">
            <h2 className="text-xl font-semibold text-gray-100 mb-4">Member Growth (Last 12 Weeks)</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.memberGrowth.weekly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis
                    dataKey="week"
                    stroke="#666"
                    tick={{ fill: '#666', fontSize: 12 }}
                  />
                  <YAxis stroke="#666" tick={{ fill: '#666', fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1a1a1a',
                      border: '1px solid #333',
                      borderRadius: '8px',
                    }}
                  />
                  <Legend />
                  <Bar dataKey="total" fill="#8b5cf6" name="Total Members" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="new" fill="#22c55e" name="New Members" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Top Members */}
          <div className="bg-dark-card p-6 rounded-lg border border-gray-800">
            <h2 className="text-xl font-semibold text-gray-100 mb-4">Top Members (Last 30 Days)</h2>
            {data.topMembers.length === 0 ? (
              <div className="h-64 flex items-center justify-center">
                <p className="text-gray-500">No check-in data yet</p>
              </div>
            ) : (
              <div className="overflow-y-auto max-h-64">
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-gray-400 text-sm">
                      <th className="pb-3 font-medium">#</th>
                      <th className="pb-3 font-medium">Member</th>
                      <th className="pb-3 font-medium text-right">Check-ins</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topMembers.map((member, index) => (
                      <tr key={member.id} className="border-t border-gray-800">
                        <td className="py-3 text-gray-500">{index + 1}</td>
                        <td className="py-3">
                          <div className="text-gray-100 font-medium">{member.name}</div>
                          <div className="text-gray-500 text-sm">{member.email}</div>
                        </td>
                        <td className="py-3 text-right">
                          <span className="bg-primary/20 text-primary px-3 py-1 rounded-full text-sm font-semibold">
                            {member.checkins}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* 30-Day Summary */}
        <div className="bg-dark-card p-6 rounded-lg border border-gray-800">
          <h2 className="text-xl font-semibold text-gray-100 mb-4">30-Day Summary</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <div className="text-gray-400 text-sm">Total Check-ins</div>
              <div className="text-2xl font-bold text-gray-100">{data.attendance.total30d}</div>
            </div>
            <div>
              <div className="text-gray-400 text-sm">Avg Daily Check-ins</div>
              <div className="text-2xl font-bold text-gray-100">{data.attendance.avgPerDay}</div>
            </div>
            <div>
              <div className="text-gray-400 text-sm">Active Members</div>
              <div className="text-2xl font-bold text-gray-100">{data.memberGrowth.active}</div>
            </div>
            <div>
              <div className="text-gray-400 text-sm">Est. Monthly Revenue</div>
              <div className="text-2xl font-bold text-gray-100">${data.revenue.mrr.toLocaleString()}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
