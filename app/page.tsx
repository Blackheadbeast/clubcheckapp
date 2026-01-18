import Link from 'next/link'

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-dark via-dark to-dark-lighter overflow-x-hidden">
      {/* Background gradient effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl"></div>
        <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 left-1/3 w-96 h-96 bg-primary/10 rounded-full blur-3xl"></div>
      </div>

      {/* Navigation */}
      <nav className="relative border-b border-gray-800/50 bg-dark-card/30 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-20">
            <div className="flex items-center">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 bg-gradient-to-br from-primary to-primary-dark rounded-lg flex items-center justify-center">
                  <span className="text-black font-bold text-xl">C</span>
                </div>
                <span className="text-2xl font-bold bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
                  ClubCheck
                </span>
              </div>
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
                className="relative group bg-gradient-to-r from-primary to-primary-dark hover:from-primary-dark hover:to-primary text-black font-semibold px-8 py-3 rounded-xl transition-all duration-300 shadow-lg shadow-primary/20 hover:shadow-primary/40 hover:scale-105"
              >
                <span className="relative z-10">Start Free Trial</span>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-40 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-5xl mx-auto">
            <div className="inline-block mb-6">
              <span className="bg-primary/10 text-primary px-6 py-2 rounded-full text-sm font-semibold border border-primary/20">
                🎉 14-Day Free Trial • No Credit Card Required
              </span>
            </div>
            <h1 className="text-6xl md:text-8xl font-black mb-8 leading-tight">
              <span className="bg-gradient-to-r from-primary via-primary-light to-primary bg-clip-text text-transparent">
                Gym Management
              </span>
              <br />
              <span className="text-gray-100">Made Simple</span>
            </h1>
            <p className="text-xl md:text-2xl text-gray-300 mb-12 max-w-3xl mx-auto leading-relaxed">
              Stop wrestling with spreadsheets. Start managing members, tracking check-ins, 
              and growing your gym—all in one beautiful platform.
            </p>
            <div className="flex flex-col sm:flex-row gap-6 justify-center items-center">
              <Link 
                href="/signup" 
                className="group relative bg-gradient-to-r from-primary to-primary-dark text-black font-bold text-lg px-12 py-5 rounded-2xl transition-all duration-300 shadow-2xl shadow-primary/30 hover:shadow-primary/50 hover:scale-105"
              >
                <span className="flex items-center gap-2">
                  Start Free Trial
                  <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </span>
              </Link>
              <a 
                href="#pricing" 
                className="group text-gray-100 font-semibold text-lg px-12 py-5 rounded-2xl border-2 border-gray-700 hover:border-primary transition-all duration-300 hover:bg-primary/5"
              >
                View Pricing
              </a>
            </div>
            <div className="mt-8 flex items-center justify-center gap-8 text-sm text-gray-400">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-primary" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span>14-day trial</span>
              </div>
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-primary" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span>No credit card</span>
              </div>
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-primary" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span>Cancel anytime</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="relative py-32 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-20">
            <h2 className="text-5xl md:text-6xl font-black mb-6">
              <span className="bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
                Everything You Need.
              </span>
              <br />
              <span className="text-gray-100">Nothing You Don&apos;t.</span>
            </h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              Purpose-built for gym owners who want results, not complexity.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                icon: '⚡',
                title: 'QR Code Check-Ins',
                description: 'Members scan their unique code at the door. Instant check-in. Zero friction. That simple.',
                gradient: 'from-primary/20 to-primary/5'
              },
              {
                icon: '👥',
                title: 'Member Management',
                description: 'Add, edit, or deactivate members in seconds. See who owes money. Track everything.',
                gradient: 'from-primary/20 to-primary/5'
              },
              {
                icon: '📊',
                title: 'Real-Time Dashboard',
                description: 'Daily check-ins. Monthly revenue. Failed payments. All the metrics that matter.',
                gradient: 'from-primary/20 to-primary/5'
              },
              {
                icon: '💳',
                title: 'Stripe Payments',
                description: 'Secure billing built-in. Set it once, get paid monthly. Automated and reliable.',
                gradient: 'from-primary/20 to-primary/5'
              },
              {
                icon: '🚀',
                title: 'Lightning Fast',
                description: 'No bloat. No lag. Built for speed. Your time is valuable—we respect that.',
                gradient: 'from-primary/20 to-primary/5'
              },
              {
                icon: '🔒',
                title: 'Bank-Level Security',
                description: 'Encrypted data. Secure infrastructure. Your members trust you—we protect that trust.',
                gradient: 'from-primary/20 to-primary/5'
              },
            ].map((feature, i) => (
              <div 
                key={i}
                className="group relative bg-gradient-to-br from-dark-card to-dark-lighter p-8 rounded-2xl border border-gray-800 hover:border-primary/50 transition-all duration-300 hover:scale-105 hover:shadow-xl hover:shadow-primary/10"
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${feature.gradient} rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300`}></div>
                <div className="relative">
                  <div className="w-16 h-16 bg-gradient-to-br from-primary/20 to-primary/5 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                    <span className="text-4xl">{feature.icon}</span>
                  </div>
                  <h3 className="text-2xl font-bold mb-4 text-primary group-hover:text-primary-light transition-colors">
                    {feature.title}
                  </h3>
                  <p className="text-gray-400 leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="relative py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="bg-gradient-to-br from-dark-card to-dark-lighter p-12 rounded-3xl border border-gray-800 shadow-2xl">
            <div className="grid md:grid-cols-3 gap-12">
              <div className="text-center">
                <div className="text-5xl font-black bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent mb-2">
                  10min
                </div>
                <div className="text-gray-400">Setup Time</div>
              </div>
              <div className="text-center">
                <div className="text-5xl font-black bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent mb-2">
                  99.9%
                </div>
                <div className="text-gray-400">Uptime</div>
              </div>
              <div className="text-center">
                <div className="text-5xl font-black bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent mb-2">
                  24/7
                </div>
                <div className="text-gray-400">Support</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="relative py-32 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-20">
            <h2 className="text-5xl md:text-6xl font-black mb-6">
              <span className="bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
                Simple Pricing.
              </span>
              <br />
              <span className="text-gray-100">Zero Surprises.</span>
            </h2>
            <p className="text-xl text-gray-400">
              Try free for 14 days. No credit card required. Cancel anytime.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            {/* Starter Plan */}
            <div className="relative group bg-gradient-to-br from-dark-card to-dark-lighter p-10 rounded-3xl border-2 border-gray-800 hover:border-gray-700 transition-all duration-300 hover:scale-105 hover:shadow-2xl">
              <div className="mb-8">
                <h3 className="text-3xl font-bold text-gray-100 mb-2">Starter</h3>
                <p className="text-gray-400">Perfect for small gyms</p>
              </div>
              <div className="mb-8">
                <span className="text-6xl font-black bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
                  $49.99
                </span>
                <span className="text-gray-400 text-xl">/month</span>
                <div className="mt-2 text-sm text-gray-500">after 14-day free trial</div>
              </div>
              <ul className="space-y-4 mb-10">
                {[
                  'Up to 75 active members',
                  'QR code check-ins',
                  'Member management',
                  'Real-time dashboard',
                  'Email support',
                  'Secure payments'
                ].map((feature, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <svg className="w-5 h-5 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span className="text-gray-300">{feature}</span>
                  </li>
                ))}
              </ul>
              <Link 
                href="/signup" 
                className="block w-full bg-dark-lighter hover:bg-gray-800 text-gray-100 font-bold py-4 px-6 rounded-xl border-2 border-gray-700 hover:border-primary transition-all duration-300 text-center group-hover:scale-105"
              >
                Start Free Trial
              </Link>
            </div>

            {/* Pro Plan */}
            <div className="relative group bg-gradient-to-br from-primary/10 via-dark-card to-dark-lighter p-10 rounded-3xl border-2 border-primary hover:border-primary-light transition-all duration-300 hover:scale-105 shadow-2xl shadow-primary/20 hover:shadow-primary/30">
              <div className="absolute -top-5 left-1/2 transform -translate-x-1/2">
                <span className="bg-gradient-to-r from-primary to-primary-dark text-black text-sm font-bold px-6 py-2 rounded-full shadow-lg">
                  MOST POPULAR
                </span>
              </div>
              <div className="mb-8">
                <h3 className="text-3xl font-bold text-gray-100 mb-2">Pro</h3>
                <p className="text-gray-400">For growing gyms</p>
              </div>
              <div className="mb-8">
                <span className="text-6xl font-black bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
                  $99.99
                </span>
                <span className="text-gray-400 text-xl">/month</span>
                <div className="mt-2 text-sm text-gray-500">after 14-day free trial</div>
              </div>
              <ul className="space-y-4 mb-10">
                {[
                  'Up to 150 active members',
                  'QR code check-ins',
                  'Member management',
                  'Real-time dashboard',
                  'Priority email support',
                  'Secure payments',
                  'Advanced analytics',
                  'Custom reporting'
                ].map((feature, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <svg className="w-5 h-5 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span className="text-gray-300">{feature}</span>
                  </li>
                ))}
              </ul>
              <Link 
                href="/signup" 
                className="block w-full bg-gradient-to-r from-primary to-primary-dark hover:from-primary-dark hover:to-primary text-black font-bold py-4 px-6 rounded-xl transition-all duration-300 text-center shadow-lg shadow-primary/30 hover:shadow-primary/50 group-hover:scale-105"
              >
                Start Free Trial
              </Link>
            </div>
          </div>

          <p className="text-center text-gray-500 mt-12 text-lg">
            Both plans include a 14-day free trial. No credit card required to start.
          </p>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative py-32 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="bg-gradient-to-br from-primary/20 via-dark-card to-dark-lighter p-16 rounded-3xl border border-primary/30 shadow-2xl shadow-primary/20">
            <h2 className="text-5xl md:text-6xl font-black mb-6">
              <span className="bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
                Ready to Transform
              </span>
              <br />
              <span className="text-gray-100">Your Gym?</span>
            </h2>
            <p className="text-xl text-gray-300 mb-10 max-w-2xl mx-auto">
              Join gym owners who have ditched the spreadsheets and reclaimed their time.
            </p>
            <Link 
              href="/signup" 
              className="inline-flex items-center gap-3 bg-gradient-to-r from-primary to-primary-dark text-black font-bold text-xl px-14 py-6 rounded-2xl transition-all duration-300 shadow-2xl shadow-primary/30 hover:shadow-primary/50 hover:scale-110"
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
              <div className="flex items-center gap-2 mb-4">
                <div className="w-10 h-10 bg-gradient-to-br from-primary to-primary-dark rounded-lg flex items-center justify-center">
                  <span className="text-black font-bold text-xl">C</span>
                </div>
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
                <li><Link href="/signup" className="hover:text-primary transition-colors">Sign Up</Link></li>
                <li><Link href="/login" className="hover:text-primary transition-colors">Log In</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-gray-100 font-bold mb-4">Support</h4>
              <ul className="space-y-3 text-gray-400 text-sm">
                <li><a href="mailto:support@clubcheck.com" className="hover:text-primary transition-colors">Email Support</a></li>
                <li><a href="#" className="hover:text-primary transition-colors">Help Center</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-gray-100 font-bold mb-4">Legal</h4>
              <ul className="space-y-3 text-gray-400 text-sm">
                <li><a href="#" className="hover:text-primary transition-colors">Privacy Policy</a></li>
                <li><a href="#" className="hover:text-primary transition-colors">Terms of Service</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800/50 pt-8 text-center">
            <p className="text-gray-500 text-sm">
              © 2026 ClubCheck. All rights reserved. Built for real gyms.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}