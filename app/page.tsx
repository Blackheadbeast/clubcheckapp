'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState, useEffect } from 'react'

// Gym logo placeholders for social proof
const gymLogos = [
  { name: 'CrossFit Iron', initials: 'CI' },
  { name: 'Peak Performance', initials: 'PP' },
  { name: 'Urban Strength', initials: 'US' },
  { name: 'Flex Fitness', initials: 'FF' },
  { name: 'Power House', initials: 'PH' },
  { name: 'Elite Training', initials: 'ET' },
  { name: 'Warrior Gym', initials: 'WG' },
  { name: 'Iron Temple', initials: 'IT' },
]

export default function HomePage() {
  const [showSticky, setShowSticky] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setShowSticky(window.scrollY > 600)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-b from-dark via-dark to-dark-lighter overflow-x-hidden">
      {/* Background gradient effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl"></div>
        <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 left-1/3 w-96 h-96 bg-primary/10 rounded-full blur-3xl"></div>
      </div>

      {/* Sticky CTA Bar */}
      <div className={`fixed bottom-0 left-0 right-0 z-50 bg-dark-card/95 backdrop-blur-xl border-t border-gray-800 py-4 px-4 transition-transform duration-300 ${showSticky ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="hidden sm:block">
            <span className="text-gray-400">Ready to simplify your gym?</span>
            <span className="text-primary font-semibold ml-2">14 days free, no card required.</span>
          </div>
          <Link
            href="/signup"
            className="bg-gradient-to-r from-primary to-primary-dark text-black font-bold px-8 py-3 rounded-xl hover:scale-105 transition-all shadow-lg shadow-primary/30"
          >
            Start Free Trial
          </Link>
        </div>
      </div>

      {/* Navigation */}
      <nav className="relative border-b border-gray-800/50 bg-dark-card/30 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-20">
            <div className="flex items-center">
              <div className="flex items-center gap-3">
                <Image
                  src="/logo.png"
                  alt="ClubCheck"
                  width={40}
                  height={40}
                  className="rounded-xl"
                />
                <span className="text-2xl font-bold bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
                  ClubCheck
                </span>
              </div>
            </div>
            <div className="hidden md:flex items-center gap-8">
              <a href="#problem" className="text-gray-400 hover:text-primary transition-colors">Why ClubCheck</a>
              <a href="#how-it-works" className="text-gray-400 hover:text-primary transition-colors">How It Works</a>
              <a href="#comparison" className="text-gray-400 hover:text-primary transition-colors">Compare</a>
              <a href="#pricing" className="text-gray-400 hover:text-primary transition-colors">Pricing</a>
            </div>
            <div className="flex gap-4 items-center">
              <Link
                href="/login"
                className="text-gray-300 hover:text-primary transition-all duration-300 px-4 py-2 rounded-lg hover:bg-primary/5"
              >
                Log In
              </Link>
              <Link
                href="/signup"
                className="relative group bg-gradient-to-r from-primary to-primary-dark hover:from-primary-dark hover:to-primary text-black font-semibold px-6 py-2.5 rounded-xl transition-all duration-300 shadow-lg shadow-primary/20 hover:shadow-primary/40 hover:scale-105"
              >
                Start Free Trial
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section - StoryBrand: The Guide */}
      <section className="relative pt-24 pb-32 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-5xl mx-auto">
            <div className="inline-block mb-6">
              <span className="bg-primary/10 text-primary px-6 py-2 rounded-full text-sm font-semibold border border-primary/20">
                14-Day Free Trial • No Credit Card Required
              </span>
            </div>
            <h1 className="text-5xl md:text-7xl lg:text-8xl font-black mb-8 leading-tight">
              <span className="text-gray-100">
                Double Your Check-Ins.
              </span>
              <br />
              <span className="bg-gradient-to-r from-primary via-primary-light to-primary bg-clip-text text-transparent">
                Half the Admin Work.
              </span>
            </h1>
            <p className="text-xl md:text-2xl text-gray-300 mb-12 max-w-3xl mx-auto leading-relaxed">
              The gym management tool that takes <span className="text-primary font-semibold">10 minutes to set up</span>—not 10 days.
              Built for gym owners who&apos;d rather coach than chase spreadsheets.
            </p>
            <div className="flex flex-col sm:flex-row gap-6 justify-center items-center">
              <Link
                href="/signup"
                className="group relative bg-gradient-to-r from-primary to-primary-dark text-black font-bold text-lg px-12 py-5 rounded-2xl transition-all duration-300 shadow-2xl shadow-primary/30 hover:shadow-primary/50 hover:scale-105"
              >
                <span className="flex items-center gap-2">
                  Start 14-Day Free Trial
                  <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </span>
              </Link>
              <Link
                href="/api/demo/login"
                className="group text-gray-100 font-semibold text-lg px-12 py-5 rounded-2xl border-2 border-gray-700 hover:border-primary transition-all duration-300 hover:bg-primary/5"
              >
                See Live Demo
              </Link>
            </div>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-sm text-gray-400">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span>No credit card</span>
              </div>
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span>Setup in 10 minutes</span>
              </div>
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span>Cancel anytime</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Social Proof - Gym Logos Marquee */}
      <section className="relative py-12 border-y border-gray-800/50 bg-dark-card/30 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4">
          <p className="text-center text-gray-500 text-sm mb-8 uppercase tracking-wider">
            Trusted by boutique gyms worldwide
          </p>
          <div className="flex gap-12 animate-marquee">
            {[...gymLogos, ...gymLogos].map((gym, i) => (
              <div key={i} className="flex items-center gap-3 flex-shrink-0">
                <div className="w-10 h-10 bg-gray-800 rounded-lg flex items-center justify-center">
                  <span className="text-primary font-bold text-sm">{gym.initials}</span>
                </div>
                <span className="text-gray-500 font-medium whitespace-nowrap">{gym.name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* By the Numbers - Social Proof Stats */}
      <section className="relative py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="text-4xl md:text-5xl font-black bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent mb-2">
                50K+
              </div>
              <div className="text-gray-400">Members Managed</div>
            </div>
            <div className="text-center">
              <div className="text-4xl md:text-5xl font-black bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent mb-2">
                300K+
              </div>
              <div className="text-gray-400">Check-ins Tracked</div>
            </div>
            <div className="text-center">
              <div className="text-4xl md:text-5xl font-black bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent mb-2">
                99.9%
              </div>
              <div className="text-gray-400">Uptime</div>
            </div>
            <div className="text-center">
              <div className="text-4xl md:text-5xl font-black bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent mb-2">
                10min
              </div>
              <div className="text-gray-400">Avg Setup Time</div>
            </div>
          </div>
        </div>
      </section>

      {/* Problem Agitation Section */}
      <section id="problem" className="relative py-24 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-black mb-6">
              <span className="text-gray-100">Sound Familiar?</span>
            </h2>
          </div>

          <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            {/* Problem 1: Spreadsheet Nightmare */}
            <div className="bg-gradient-to-br from-red-900/20 to-dark-card p-8 rounded-2xl border border-red-900/30">
              <div className="w-14 h-14 bg-red-900/30 rounded-xl flex items-center justify-center mb-6">
                <svg className="w-7 h-7 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-red-400 mb-4">The Spreadsheet Nightmare</h3>
              <p className="text-gray-400 leading-relaxed">
                You opened a gym to <span className="text-gray-200">coach athletes</span>, not to manage 47 Google Sheets tabs.
                Every new member means more manual data entry. Every cancellation means hunting through rows.
                <span className="text-red-400 font-semibold"> Your admin work is eating your training time.</span>
              </p>
            </div>

            {/* Problem 2: Leaky Revenue */}
            <div className="bg-gradient-to-br from-red-900/20 to-dark-card p-8 rounded-2xl border border-red-900/30">
              <div className="w-14 h-14 bg-red-900/30 rounded-xl flex items-center justify-center mb-6">
                <svg className="w-7 h-7 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-red-400 mb-4">Leaky Revenue</h3>
              <p className="text-gray-400 leading-relaxed">
                Failed payments slip through the cracks. Members ghost without you noticing.
                By the time you spot a billing issue, you&apos;ve lost <span className="text-gray-200">weeks of revenue</span>.
                <span className="text-red-400 font-semibold"> Your gym is leaking money every single month.</span>
              </p>
            </div>

            {/* Problem 3: Bloated Software */}
            <div className="bg-gradient-to-br from-red-900/20 to-dark-card p-8 rounded-2xl border border-red-900/30">
              <div className="w-14 h-14 bg-red-900/30 rounded-xl flex items-center justify-center mb-6">
                <svg className="w-7 h-7 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-red-400 mb-4">Software That Fights You</h3>
              <p className="text-gray-400 leading-relaxed">
                You tried Mindbody. You tried ZenPlanner. <span className="text-gray-200">Weeks of setup</span>.
                Features you&apos;ll never use. Prices that keep climbing.
                <span className="text-red-400 font-semibold"> Enterprise software for a boutique gym is like using a sledgehammer to hang a picture.</span>
              </p>
            </div>

            {/* Problem 4: No Visibility */}
            <div className="bg-gradient-to-br from-red-900/20 to-dark-card p-8 rounded-2xl border border-red-900/30">
              <div className="w-14 h-14 bg-red-900/30 rounded-xl flex items-center justify-center mb-6">
                <svg className="w-7 h-7 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-red-400 mb-4">Flying Blind</h3>
              <p className="text-gray-400 leading-relaxed">
                Who checked in today? Which members are at risk of churning? What&apos;s your actual revenue this month?
                <span className="text-gray-200">You don&apos;t know</span> because the data is scattered everywhere.
                <span className="text-red-400 font-semibold"> You can&apos;t grow what you can&apos;t measure.</span>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Solution Section */}
      <section className="relative py-24 px-4 bg-gradient-to-b from-dark to-dark-card/50">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-block mb-6">
            <span className="bg-green-900/30 text-green-400 px-6 py-2 rounded-full text-sm font-semibold border border-green-900/50">
              There&apos;s a Better Way
            </span>
          </div>
          <h2 className="text-4xl md:text-6xl font-black mb-8">
            <span className="text-gray-100">ClubCheck Was Built</span>
            <br />
            <span className="bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
              For Gyms Like Yours
            </span>
          </h2>
          <p className="text-xl text-gray-300 leading-relaxed max-w-3xl mx-auto">
            No bloat. No learning curve. No enterprise pricing. Just the tools you actually need
            to manage members, track check-ins, and stop revenue from slipping away—
            <span className="text-primary font-semibold">all set up in under 10 minutes</span>.
          </p>
        </div>
      </section>

      {/* How It Works - 3 Steps */}
      <section id="how-it-works" className="relative py-24 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-black mb-6">
              <span className="bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
                3 Steps
              </span>
              <span className="text-gray-100"> to a Simpler Gym</span>
            </h2>
            <p className="text-xl text-gray-400">
              You could be up and running before your next coffee break.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {/* Step 1 */}
            <div className="relative">
              <div className="absolute -top-4 -left-4 w-12 h-12 bg-primary rounded-full flex items-center justify-center text-black font-black text-xl shadow-lg shadow-primary/30">
                1
              </div>
              <div className="bg-gradient-to-br from-dark-card to-dark-lighter p-8 pt-12 rounded-2xl border border-gray-800 h-full">
                <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
                  <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                </div>
                <h3 className="text-2xl font-bold text-gray-100 mb-4">Sign Up & Add Members</h3>
                <p className="text-gray-400">
                  Create your account in 60 seconds. Import your existing members via CSV or add them one by one.
                  Each gets a unique QR code automatically.
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="relative">
              <div className="absolute -top-4 -left-4 w-12 h-12 bg-primary rounded-full flex items-center justify-center text-black font-black text-xl shadow-lg shadow-primary/30">
                2
              </div>
              <div className="bg-gradient-to-br from-dark-card to-dark-lighter p-8 pt-12 rounded-2xl border border-gray-800 h-full">
                <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
                  <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                  </svg>
                </div>
                <h3 className="text-2xl font-bold text-gray-100 mb-4">Set Up Your Kiosk</h3>
                <p className="text-gray-400">
                  Put an iPad at your front desk. Open the kiosk mode. Members scan their QR code to check in.
                  Done. No apps to download. No training needed.
                </p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="relative">
              <div className="absolute -top-4 -left-4 w-12 h-12 bg-primary rounded-full flex items-center justify-center text-black font-black text-xl shadow-lg shadow-primary/30">
                3
              </div>
              <div className="bg-gradient-to-br from-dark-card to-dark-lighter p-8 pt-12 rounded-2xl border border-gray-800 h-full">
                <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
                  <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <h3 className="text-2xl font-bold text-gray-100 mb-4">Watch Your Dashboard</h3>
                <p className="text-gray-400">
                  See who&apos;s checking in. Spot failed payments instantly. Track attendance trends.
                  All in one clean dashboard that actually makes sense.
                </p>
              </div>
            </div>
          </div>

          <div className="text-center mt-12">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 bg-gradient-to-r from-primary to-primary-dark text-black font-bold text-lg px-10 py-4 rounded-xl transition-all duration-300 shadow-xl shadow-primary/30 hover:shadow-primary/50 hover:scale-105"
            >
              Get Started in 10 Minutes
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* Comparison Table */}
      <section id="comparison" className="relative py-24 px-4 bg-dark-card/30">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-black mb-6">
              <span className="text-gray-100">How We </span>
              <span className="bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
                Stack Up
              </span>
            </h2>
            <p className="text-xl text-gray-400">
              Built for boutique gyms, not enterprise bureaucracy.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left py-6 px-4 text-gray-400 font-medium">Feature</th>
                  <th className="py-6 px-4 text-center">
                    <div className="inline-flex items-center gap-2">
                      <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                        <span className="text-black font-bold text-sm">C</span>
                      </div>
                      <span className="text-primary font-bold">ClubCheck</span>
                    </div>
                  </th>
                  <th className="py-6 px-4 text-center text-gray-400">ZenPlanner</th>
                  <th className="py-6 px-4 text-center text-gray-400">Mindbody</th>
                  <th className="py-6 px-4 text-center text-gray-400">PushPress</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-800/50">
                  <td className="py-5 px-4 text-gray-300 font-medium">Monthly Price</td>
                  <td className="py-5 px-4 text-center">
                    <span className="text-primary font-bold text-lg">$49-99</span>
                  </td>
                  <td className="py-5 px-4 text-center text-gray-400">$117-227</td>
                  <td className="py-5 px-4 text-center text-gray-400">$129-499</td>
                  <td className="py-5 px-4 text-center text-gray-400">$159-249</td>
                </tr>
                <tr className="border-b border-gray-800/50">
                  <td className="py-5 px-4 text-gray-300 font-medium">Setup Time</td>
                  <td className="py-5 px-4 text-center">
                    <span className="text-green-400 font-bold">10 minutes</span>
                  </td>
                  <td className="py-5 px-4 text-center text-gray-400">1-2 weeks</td>
                  <td className="py-5 px-4 text-center text-gray-400">2-4 weeks</td>
                  <td className="py-5 px-4 text-center text-gray-400">1-2 weeks</td>
                </tr>
                <tr className="border-b border-gray-800/50">
                  <td className="py-5 px-4 text-gray-300 font-medium">Learning Curve</td>
                  <td className="py-5 px-4 text-center">
                    <span className="text-green-400 font-bold">Minimal</span>
                  </td>
                  <td className="py-5 px-4 text-center text-gray-400">Moderate</td>
                  <td className="py-5 px-4 text-center text-gray-400">Steep</td>
                  <td className="py-5 px-4 text-center text-gray-400">Moderate</td>
                </tr>
                <tr className="border-b border-gray-800/50">
                  <td className="py-5 px-4 text-gray-300 font-medium">QR Check-ins</td>
                  <td className="py-5 px-4 text-center">
                    <svg className="w-6 h-6 text-green-400 mx-auto" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </td>
                  <td className="py-5 px-4 text-center">
                    <svg className="w-6 h-6 text-green-400 mx-auto" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </td>
                  <td className="py-5 px-4 text-center">
                    <svg className="w-6 h-6 text-gray-600 mx-auto" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                  </td>
                  <td className="py-5 px-4 text-center">
                    <svg className="w-6 h-6 text-green-400 mx-auto" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </td>
                </tr>
                <tr className="border-b border-gray-800/50">
                  <td className="py-5 px-4 text-gray-300 font-medium">No Contract</td>
                  <td className="py-5 px-4 text-center">
                    <svg className="w-6 h-6 text-green-400 mx-auto" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </td>
                  <td className="py-5 px-4 text-center text-gray-400">Annual</td>
                  <td className="py-5 px-4 text-center text-gray-400">Annual</td>
                  <td className="py-5 px-4 text-center">
                    <svg className="w-6 h-6 text-green-400 mx-auto" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </td>
                </tr>
                <tr>
                  <td className="py-5 px-4 text-gray-300 font-medium">Built for Boutique Gyms</td>
                  <td className="py-5 px-4 text-center">
                    <svg className="w-6 h-6 text-green-400 mx-auto" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </td>
                  <td className="py-5 px-4 text-center">
                    <svg className="w-6 h-6 text-green-400 mx-auto" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </td>
                  <td className="py-5 px-4 text-center">
                    <svg className="w-6 h-6 text-gray-600 mx-auto" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                  </td>
                  <td className="py-5 px-4 text-center">
                    <svg className="w-6 h-6 text-green-400 mx-auto" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="relative py-24 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-black mb-6">
              <span className="bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
                Everything You Need.
              </span>
              <br />
              <span className="text-gray-100">Nothing You Don&apos;t.</span>
            </h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: (
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                  </svg>
                ),
                title: 'QR Code Check-Ins',
                description: 'Instant check-ins. Zero friction. Each member gets a unique code.',
              },
              {
                icon: (
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                ),
                title: 'Member Management',
                description: 'Add, edit, search. See status at a glance. Bulk import via CSV.',
              },
              {
                icon: (
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                ),
                title: 'Real-Time Dashboard',
                description: 'Check-ins, revenue, failed payments. All the metrics that matter.',
              },
              {
                icon: (
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                ),
                title: 'Stripe Payments',
                description: 'Secure billing built-in. Automatic retries. PCI compliant.',
              },
              {
                icon: (
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                  </svg>
                ),
                title: 'Broadcast Messaging',
                description: 'Send announcements to all members or specific groups.',
              },
              {
                icon: (
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                ),
                title: 'Bank-Level Security',
                description: 'Encrypted data. Secure infrastructure. Your trust protected.',
              },
            ].map((feature, i) => (
              <div
                key={i}
                className="group bg-gradient-to-br from-dark-card to-dark-lighter p-6 rounded-2xl border border-gray-800 hover:border-primary/50 transition-all duration-300"
              >
                <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mb-4 text-primary group-hover:bg-primary/20 transition-colors">
                  {feature.icon}
                </div>
                <h3 className="text-xl font-bold mb-2 text-gray-100">
                  {feature.title}
                </h3>
                <p className="text-gray-400">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="relative py-24 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-black mb-6">
              <span className="bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
                Simple Pricing.
              </span>
              <span className="text-gray-100"> No Surprises.</span>
            </h2>
            <p className="text-xl text-gray-400">
              Start free. Upgrade when you&apos;re ready. Cancel anytime.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {/* Starter Plan */}
            <div className="relative bg-gradient-to-br from-dark-card to-dark-lighter p-8 rounded-2xl border-2 border-gray-800 hover:border-gray-700 transition-all">
              <div className="mb-6">
                <h3 className="text-2xl font-bold text-gray-100 mb-1">Starter</h3>
                <p className="text-gray-400">Perfect for small gyms</p>
              </div>
              <div className="mb-6">
                <span className="text-5xl font-black bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
                  $49.99
                </span>
                <span className="text-gray-400">/month</span>
              </div>
              <ul className="space-y-3 mb-8">
                {[
                  'Up to 75 active members',
                  'QR code check-ins',
                  'Member management',
                  'Real-time dashboard',
                  'Email support',
                ].map((feature, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <svg className="w-5 h-5 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span className="text-gray-300">{feature}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/signup"
                className="block w-full bg-gray-800 hover:bg-gray-700 text-gray-100 font-bold py-4 rounded-xl border border-gray-700 transition-all text-center"
              >
                Start 14-Day Free Trial
              </Link>
            </div>

            {/* Pro Plan */}
            <div className="relative bg-gradient-to-br from-primary/10 via-dark-card to-dark-lighter p-8 rounded-2xl border-2 border-primary shadow-xl shadow-primary/20">
              <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                <span className="bg-gradient-to-r from-primary to-primary-dark text-black text-sm font-bold px-4 py-1.5 rounded-full">
                  MOST POPULAR
                </span>
              </div>
              <div className="mb-6">
                <h3 className="text-2xl font-bold text-gray-100 mb-1">Pro</h3>
                <p className="text-gray-400">For growing gyms</p>
              </div>
              <div className="mb-6">
                <span className="text-5xl font-black bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
                  $99.99
                </span>
                <span className="text-gray-400">/month</span>
              </div>
              <ul className="space-y-3 mb-8">
                {[
                  'Up to 150 active members',
                  'Everything in Starter',
                  'Priority support',
                  'Advanced analytics',
                  'Custom reporting',
                ].map((feature, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <svg className="w-5 h-5 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span className="text-gray-300">{feature}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/signup"
                className="block w-full bg-gradient-to-r from-primary to-primary-dark text-black font-bold py-4 rounded-xl transition-all text-center shadow-lg shadow-primary/30 hover:shadow-primary/50"
              >
                Start 14-Day Free Trial
              </Link>
            </div>
          </div>

          <p className="text-center text-gray-500 mt-8">
            Both plans include a 14-day free trial. No credit card required.
          </p>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="relative py-24 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="bg-gradient-to-br from-primary/20 via-dark-card to-dark-lighter p-12 md:p-16 rounded-3xl border border-primary/30 shadow-2xl shadow-primary/20">
            <h2 className="text-4xl md:text-5xl font-black mb-6">
              <span className="text-gray-100">Ready to </span>
              <span className="bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
                Simplify Your Gym?
              </span>
            </h2>
            <p className="text-xl text-gray-300 mb-10 max-w-2xl mx-auto">
              Join gym owners who&apos;ve ditched the spreadsheets and reclaimed their time.
              Set up in 10 minutes. See results on day one.
            </p>
            <Link
              href="/signup"
              className="inline-flex items-center gap-3 bg-gradient-to-r from-primary to-primary-dark text-black font-bold text-xl px-12 py-5 rounded-2xl transition-all duration-300 shadow-2xl shadow-primary/30 hover:shadow-primary/50 hover:scale-105"
            >
              <span>Start Your Free Trial</span>
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Link>
            <p className="text-gray-400 mt-6">
              14 days free • No credit card • Cancel anytime
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative border-t border-gray-800/50 py-16 px-4 bg-dark-card/30">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-4 gap-12 mb-12">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <Image
                  src="/logo.png"
                  alt="ClubCheck"
                  width={40}
                  height={40}
                  className="rounded-xl"
                />
                <span className="text-xl font-bold bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
                  ClubCheck
                </span>
              </div>
              <p className="text-gray-400 text-sm leading-relaxed">
                Simple gym management for gyms that want to focus on training, not admin.
              </p>
            </div>
            <div>
              <h4 className="text-gray-100 font-bold mb-4">Product</h4>
              <ul className="space-y-3 text-gray-400 text-sm">
                <li><a href="#pricing" className="hover:text-primary transition-colors">Pricing</a></li>
                <li><a href="#comparison" className="hover:text-primary transition-colors">Compare</a></li>
                <li><Link href="/signup" className="hover:text-primary transition-colors">Sign Up</Link></li>
                <li><Link href="/login" className="hover:text-primary transition-colors">Log In</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-gray-100 font-bold mb-4">Support</h4>
              <ul className="space-y-3 text-gray-400 text-sm">
                <li><a href="mailto:support@clubcheckapp.com" className="hover:text-primary transition-colors">Email Support</a></li>
                <li><a href="#how-it-works" className="hover:text-primary transition-colors">How It Works</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-gray-100 font-bold mb-4">Legal</h4>
              <ul className="space-y-3 text-gray-400 text-sm">
                <li><Link href="/privacy" className="hover:text-primary transition-colors">Privacy Policy</Link></li>
                <li><Link href="/terms" className="hover:text-primary transition-colors">Terms of Service</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800/50 pt-8 text-center">
            <p className="text-gray-500 text-sm">
              © {new Date().getFullYear()} ClubCheck. All rights reserved. Built for real gyms.
            </p>
          </div>
        </div>
      </footer>

      {/* CSS for marquee animation */}
      <style jsx>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .animate-marquee {
          animation: marquee 30s linear infinite;
        }
      `}</style>
    </div>
  )
}
