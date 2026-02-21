'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState } from 'react'

export default function HomePage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const [yearly, setYearly] = useState(false)

  return (
    <div className="min-h-screen bg-[#0a0a0a] overflow-x-hidden">
      {/* NAV */}
      <nav className="border-b border-gray-800/50 bg-[#0a0a0a]/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2.5">
              <Image src="/logo.png" alt="ClubCheck" width={32} height={32} className="rounded-lg" />
              <span className="text-lg font-bold text-gray-100">ClubCheck</span>
            </div>
            <div className="hidden md:flex items-center gap-8 text-sm">
              <a href="#features" className="text-gray-400 hover:text-gray-200 transition-colors">Features</a>
              <a href="#pricing" className="text-gray-400 hover:text-gray-200 transition-colors">Pricing</a>
              <a href="#faq" className="text-gray-400 hover:text-gray-200 transition-colors">FAQ</a>
            </div>
            <div className="flex gap-3 items-center">
              <Link href="/login" className="text-gray-400 hover:text-gray-200 transition-colors text-sm px-3 py-2">
                Log in
              </Link>
              <Link
                href="/signup"
                className="bg-primary hover:bg-primary-dark text-black font-semibold px-5 py-2 rounded-lg transition-colors text-sm"
              >
                Start Free Trial
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="pt-24 pb-20 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-gray-100 leading-[1.1] tracking-tight mb-6">
            Gym management
            <br />
            <span className="text-primary">without the chaos.</span>
          </h1>
          <p className="text-lg text-gray-400 mb-10 max-w-xl mx-auto leading-relaxed">
            Members, check-ins, payments, and staff — organized in one place.
            Built for boutique gyms. Set up in 10 minutes.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/signup"
              className="bg-primary hover:bg-primary-dark text-black font-semibold px-8 py-3.5 rounded-lg transition-colors text-base"
            >
              Start 14-Day Free Trial
            </Link>
            <a
              href="mailto:blueloomventuresllc@gmail.com?subject=ClubCheck Demo Request"
              className="text-gray-300 hover:text-gray-100 font-medium px-8 py-3.5 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors text-base"
            >
              Book a Demo
            </a>
          </div>
          <p className="text-gray-500 text-sm mt-5">
            No credit card required. Cancel anytime.
          </p>

          {/* Stripe badge + trust signals */}
          <div className="flex flex-col items-center mt-12 gap-4">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-gray-800 bg-[#111]">
              <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span className="text-xs text-gray-400">Secure payments powered by <span className="text-gray-200 font-medium">Stripe</span></span>
            </div>
            <div className="flex flex-wrap justify-center gap-x-8 gap-y-2 text-xs text-gray-500">
              <span>256-bit encryption</span>
              <span>PCI-DSS Level 1 compliant</span>
              <span>BlueLoom Ventures LLC</span>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="py-20 px-4 border-t border-gray-800/50">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-100 text-center mb-14">
            Up and running in three steps.
          </h2>
          <div className="grid md:grid-cols-3 gap-10">
            {[
              {
                step: '01',
                title: 'Create your account',
                desc: 'Sign up with email or Google. Add your gym name. Dashboard ready in under 60 seconds.',
              },
              {
                step: '02',
                title: 'Add your members',
                desc: 'Add members individually or import via CSV. Each one gets a unique QR code emailed automatically.',
              },
              {
                step: '03',
                title: 'Open your kiosk',
                desc: 'Put any tablet at the front desk. Members scan their QR to check in. Done.',
              },
            ].map((item, i) => (
              <div key={i} className="text-center md:text-left">
                <div className="text-primary font-mono text-sm mb-3">{item.step}</div>
                <h3 className="text-gray-100 font-semibold text-lg mb-2">{item.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* BUILT FOR */}
      <section className="py-20 px-4 bg-[#0d0d0d]">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-100 text-center mb-4">
            Built for gyms like yours.
          </h2>
          <p className="text-gray-400 text-center mb-12 max-w-lg mx-auto text-sm">
            If you run a small-to-mid-size fitness facility and want something simple that just works — ClubCheck is for you.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { name: 'Boxing gyms', icon: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z' },
              { name: 'CrossFit boxes', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
              { name: 'MMA & martial arts', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
              { name: 'Personal training studios', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
              { name: 'Yoga & pilates studios', icon: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z' },
              { name: 'Weightlifting clubs', icon: 'M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
            ].map((gym, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-lg border border-gray-800/50 bg-[#111]">
                <svg className="w-5 h-5 text-primary flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={gym.icon} />
                </svg>
                <span className="text-gray-300 text-sm font-medium">{gym.name}</span>
              </div>
            ))}
          </div>
          <p className="text-gray-500 text-center text-xs mt-6">
            Basically any facility with 10–150 members that needs check-ins, payments, and member management without enterprise complexity.
          </p>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-100 text-center mb-4">
            Everything you need. Nothing you don&apos;t.
          </h2>
          <p className="text-gray-400 text-center mb-14 max-w-lg mx-auto text-sm">
            Built for gyms with 10–150 members. No bloat, no learning curve.
          </p>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              {
                title: 'QR code check-ins',
                desc: 'Each member gets a unique QR code. Scan at the kiosk for instant check-in.',
                icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />,
              },
              {
                title: 'Member management',
                desc: 'Add, search, edit, and track members. Status, streaks, and check-in history at a glance.',
                icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />,
              },
              {
                title: 'Payment tracking',
                desc: 'Track member payments (cash, Zelle, Venmo, card). Automatic email reminders before due dates.',
                icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />,
              },
              {
                title: 'Staff accounts',
                desc: 'Front desk and manager roles with scoped permissions. Staff log in with a simple 6-character code.',
                icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />,
              },
              {
                title: 'Dashboard & analytics',
                desc: 'Today\'s check-ins, attendance trends, peak hours, and revenue. Actionable data at a glance.',
                icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />,
              },
              {
                title: 'Member portal',
                desc: 'Each member gets a portal with QR code, check-in history, and streaks. Add to home screen for one-tap access.',
                icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />,
              },
            ].map((feature, i) => (
              <div key={i} className="p-5 rounded-lg border border-gray-800/50 bg-[#111]">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                  <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {feature.icon}
                  </svg>
                </div>
                <h3 className="text-gray-200 font-semibold mb-1.5">{feature.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-100 text-center mb-12">
            Gym owners love ClubCheck.
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="p-6 rounded-lg border border-gray-800 bg-[#111]">
              <div className="flex gap-1 mb-3">
                {[...Array(5)].map((_, i) => (
                  <svg key={i} className="w-4 h-4 text-primary" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                ))}
              </div>
              <p className="text-gray-400 text-sm leading-relaxed mb-4">
                &ldquo;We switched from a paper sign-in sheet and it&apos;s night and day. Members love scanning their QR code, and I can finally see who&apos;s actually showing up. Setup took maybe 15 minutes.&rdquo;
              </p>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold">MR</div>
                <div>
                  <div className="text-gray-200 text-sm font-medium">Marcus R.</div>
                  <div className="text-gray-500 text-xs">Iron Valley Fitness, TX</div>
                </div>
              </div>
            </div>
            <div className="p-6 rounded-lg border border-gray-800 bg-[#111]">
              <div className="flex gap-1 mb-3">
                {[...Array(5)].map((_, i) => (
                  <svg key={i} className="w-4 h-4 text-primary" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                ))}
              </div>
              <p className="text-gray-400 text-sm leading-relaxed mb-4">
                &ldquo;The payment tracking saved me hours every month. I just log who paid cash or Zelle and ClubCheck emails reminders automatically. No more awkward conversations about late payments.&rdquo;
              </p>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold">JT</div>
                <div>
                  <div className="text-gray-200 text-sm font-medium">Jessica T.</div>
                  <div className="text-gray-500 text-xs">Peak Form Boxing, FL</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-100 text-center mb-4">
            Simple, transparent pricing.
          </h2>
          <p className="text-gray-400 text-center mb-8 max-w-lg mx-auto text-sm">
            14-day free trial. No credit card. No contracts. Cancel anytime.
          </p>

          {/* Billing toggle */}
          <div className="flex items-center justify-center gap-3 mb-10">
            <span className={`text-sm ${!yearly ? 'text-gray-100 font-medium' : 'text-gray-500'}`}>Monthly</span>
            <button
              onClick={() => setYearly(!yearly)}
              className={`relative w-12 h-7 rounded-full transition ${yearly ? 'bg-primary' : 'bg-gray-700'}`}
            >
              <div className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all ${yearly ? 'left-6' : 'left-1'}`} />
            </button>
            <span className={`text-sm ${yearly ? 'text-gray-100 font-medium' : 'text-gray-500'}`}>Yearly</span>
            {yearly && (
              <span className="text-xs bg-green-500/10 text-green-400 px-2.5 py-1 rounded-full font-medium">Save ~$100/yr</span>
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
            {/* Starter */}
            <div className="p-6 rounded-lg border border-gray-800 bg-[#111]">
              <h3 className="text-lg font-semibold text-gray-100 mb-1">Starter</h3>
              <p className="text-gray-500 text-sm mb-5">Up to 75 members</p>
              <div className="mb-6">
                <span className="text-4xl font-bold text-gray-100">{yearly ? '$499.99' : '$49.99'}</span>
                <span className="text-gray-500 text-sm">{yearly ? '/year' : '/month'}</span>
                {yearly && (
                  <div className="text-green-400 text-xs mt-1">$41.67/mo — save $99.89/yr</div>
                )}
              </div>
              <ul className="space-y-2.5 mb-6">
                {[
                  'QR check-ins & kiosk mode',
                  'Member management & CSV import',
                  'Payment tracking & reminders',
                  'Dashboard & analytics',
                  'Staff accounts',
                  'Broadcast messaging',
                  'Member portal',
                  'Email support',
                ].map((f, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm">
                    <svg className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-400">{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/signup"
                className="block w-full text-center py-3 rounded-lg border border-gray-700 text-gray-300 hover:text-gray-100 hover:border-gray-600 font-medium text-sm transition-colors"
              >
                Start Free Trial
              </Link>
            </div>

            {/* Pro */}
            <div className="p-6 rounded-lg border border-primary/50 bg-[#111] relative">
              <div className="absolute -top-3 left-5">
                <span className="bg-primary text-black text-xs font-semibold px-3 py-1 rounded-full">Most popular</span>
              </div>
              <h3 className="text-lg font-semibold text-gray-100 mb-1">Pro</h3>
              <p className="text-gray-500 text-sm mb-5">Up to 150 members</p>
              <div className="mb-6">
                <span className="text-4xl font-bold text-gray-100">{yearly ? '$999.99' : '$99.99'}</span>
                <span className="text-gray-500 text-sm">{yearly ? '/year' : '/month'}</span>
                {yearly && (
                  <div className="text-green-400 text-xs mt-1">$83.33/mo — save $199.89/yr</div>
                )}
              </div>
              <ul className="space-y-2.5 mb-6">
                {[
                  'Everything in Starter',
                  'Up to 150 active members',
                  'Priority email support',
                  'Advanced analytics',
                ].map((f, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm">
                    <svg className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-400">{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/signup"
                className="block w-full text-center py-3 rounded-lg bg-primary hover:bg-primary-dark text-black font-medium text-sm transition-colors"
              >
                Start Free Trial
              </Link>
            </div>
          </div>

          <p className="text-center text-gray-500 text-xs mt-8">
            All payments processed securely by Stripe.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-20 px-4 bg-[#0d0d0d]">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-100 text-center mb-12">
            Frequently asked questions
          </h2>

          <div className="space-y-2">
            {[
              {
                q: 'Do I need a credit card to start?',
                a: 'No. Sign up with email or Google and start using ClubCheck immediately. Payment info is only needed when you subscribe after the 14-day trial.',
              },
              {
                q: 'What happens when my trial ends?',
                a: 'Your account switches to read-only. All your data is preserved. Subscribe whenever you\'re ready to continue.',
              },
              {
                q: 'Can I cancel at any time?',
                a: 'Yes. No contracts, no cancellation fees. Cancel from your billing page and keep access through the end of your billing period.',
              },
              {
                q: 'Is my data secure?',
                a: 'Yes. Passwords are hashed with bcrypt, sessions use signed JWT tokens, all connections are encrypted via HTTPS, and payments go through Stripe (PCI-DSS Level 1). Each gym\'s data is fully isolated.',
              },
              {
                q: 'Do members need to download an app?',
                a: 'No. Members get their QR code via email and can access their portal in any browser. They can add it to their home screen for one-tap access.',
              },
              {
                q: 'What equipment do I need?',
                a: 'Any device with a camera and a browser. An iPad or Android tablet at the front desk works perfectly.',
              },
            ].map((item, i) => (
              <div key={i} className="border border-gray-800 rounded-lg overflow-hidden">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-[#111] transition-colors"
                >
                  <span className="text-gray-200 font-medium text-sm pr-4">{item.q}</span>
                  <svg
                    className={`w-4 h-4 text-gray-500 flex-shrink-0 transition-transform ${openFaq === i ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {openFaq === i && (
                  <div className="px-5 pb-4">
                    <p className="text-gray-500 text-sm leading-relaxed">{item.a}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="py-20 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-gray-100 mb-4">
            Ready to simplify your gym?
          </h2>
          <p className="text-gray-400 mb-8 max-w-md mx-auto text-sm">
            14-day free trial. No credit card, no contracts.
          </p>
          <Link
            href="/signup"
            className="inline-block bg-primary hover:bg-primary-dark text-black font-semibold px-8 py-3.5 rounded-lg transition-colors text-base"
          >
            Start Free Trial
          </Link>
          <p className="text-gray-600 text-sm mt-4">
            Questions? <a href="mailto:blueloomventuresllc@gmail.com" className="text-gray-400 hover:text-gray-300 underline">Contact us</a>
          </p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-gray-800/50 py-10 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-col sm:flex-row justify-between items-start gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Image src="/logo.png" alt="ClubCheck" width={24} height={24} className="rounded-md" />
                <span className="text-sm font-semibold text-gray-300">ClubCheck</span>
              </div>
              <p className="text-gray-600 text-xs">Gym management for boutique fitness facilities.</p>
            </div>
            <div className="flex gap-8 text-sm">
              <div className="space-y-2">
                <Link href="/signup" className="block text-gray-500 hover:text-gray-300 transition-colors">Sign Up</Link>
                <Link href="/login" className="block text-gray-500 hover:text-gray-300 transition-colors">Log In</Link>
                <a href="mailto:blueloomventuresllc@gmail.com?subject=ClubCheck Demo Request" className="block text-gray-500 hover:text-gray-300 transition-colors">Book a Demo</a>
              </div>
              <div className="space-y-2">
                <Link href="/privacy" className="block text-gray-500 hover:text-gray-300 transition-colors">Privacy</Link>
                <Link href="/terms" className="block text-gray-500 hover:text-gray-300 transition-colors">Terms</Link>
                <a href="mailto:blueloomventuresllc@gmail.com" className="block text-gray-500 hover:text-gray-300 transition-colors">Contact</a>
              </div>
            </div>
          </div>
          <div className="border-t border-gray-800/50 pt-6 flex flex-col sm:flex-row justify-between items-center gap-3">
            <p className="text-gray-600 text-xs">
              &copy; {new Date().getFullYear()} ClubCheck. Operated by BlueLoom Ventures LLC.
            </p>
            <div className="flex items-center gap-4 text-xs text-gray-600">
              <span className="flex items-center gap-1">
                <svg className="w-3 h-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                Secured by Stripe
              </span>
              <span>Hosted in the United States</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
