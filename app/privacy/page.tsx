'use client'

import Link from 'next/link'
import Logo from '@/components/Logo'

export default function PrivacyPolicyPage() {
  const lastUpdated = 'February 7, 2026'

  return (
    <div className="min-h-screen bg-theme">
      {/* Header */}
      <header className="border-b border-theme bg-theme-card">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <Logo size="md" linkToHome />
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 py-12">
        <div className="bg-theme-card border border-theme rounded-2xl p-8 md:p-12">
          <h1 className="text-3xl md:text-4xl font-bold text-theme-heading mb-2">Privacy Policy</h1>
          <p className="text-theme-muted mb-8">Last updated: {lastUpdated}</p>

          <div className="prose prose-lg max-w-none space-y-8 text-theme-secondary">
            {/* Introduction */}
            <section>
              <h2 className="text-xl font-semibold text-theme-heading mb-4">1. Introduction</h2>
              <p>
                ClubCheck, Inc. (&quot;ClubCheck,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) is committed to protecting your privacy.
                This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use
                our gym management software-as-a-service platform (the &quot;Service&quot;).
              </p>
              <p>
                By accessing or using ClubCheck, you agree to this Privacy Policy. If you do not agree with the terms
                of this Privacy Policy, please do not access or use our Service.
              </p>
            </section>

            {/* Information We Collect */}
            <section>
              <h2 className="text-xl font-semibold text-theme-heading mb-4">2. Information We Collect</h2>

              <h3 className="text-lg font-medium text-theme-heading mt-6 mb-3">2.1 Information You Provide</h3>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Account Information:</strong> Name, email address, phone number, and password when you create an account.</li>
                <li><strong>Gym Profile Information:</strong> Gym name, logo, address, and business details.</li>
                <li><strong>Member Data:</strong> Information about your gym members that you input, including names, contact information, membership status, and check-in history.</li>
                <li><strong>Payment Information:</strong> Billing details processed securely through Stripe (see Section 5).</li>
                <li><strong>Communications:</strong> Feedback, support requests, and other communications you send to us.</li>
              </ul>

              <h3 className="text-lg font-medium text-theme-heading mt-6 mb-3">2.2 Information Collected Automatically</h3>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Usage Data:</strong> Pages visited, features used, time spent on the Service.</li>
                <li><strong>Device Information:</strong> IP address, browser type, operating system, device identifiers.</li>
                <li><strong>Cookies:</strong> Session cookies for authentication and preferences (see Section 6).</li>
              </ul>
            </section>

            {/* How We Use Your Information */}
            <section>
              <h2 className="text-xl font-semibold text-theme-heading mb-4">3. How We Use Your Information</h2>
              <p>We use the information we collect to:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Provide, maintain, and improve the Service</li>
                <li>Process transactions and send related information</li>
                <li>Send administrative notifications (account verification, security alerts, billing)</li>
                <li>Respond to your comments, questions, and support requests</li>
                <li>Monitor and analyze usage patterns to improve user experience</li>
                <li>Detect, prevent, and address technical issues and security threats</li>
                <li>Comply with legal obligations</li>
              </ul>
            </section>

            {/* Data Retention */}
            <section>
              <h2 className="text-xl font-semibold text-theme-heading mb-4">4. Data Retention</h2>
              <p>
                We retain your information for as long as your account is active or as needed to provide you with the Service.
                Specifically:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Account Data:</strong> Retained until you delete your account, plus 30 days for recovery purposes.</li>
                <li><strong>Member Data:</strong> Retained until you delete the member record or your account.</li>
                <li><strong>Check-in History:</strong> Retained for 3 years for analytics and reporting purposes.</li>
                <li><strong>Billing Records:</strong> Retained for 7 years as required for tax and legal compliance.</li>
                <li><strong>Audit Logs:</strong> Retained for 1 year for security purposes.</li>
              </ul>
              <p className="mt-4">
                After account deletion, we may retain anonymized, aggregated data for analytical purposes.
                You may request complete data deletion by contacting privacy@clubcheckapp.com.
              </p>
            </section>

            {/* Payment Processing & PCI Compliance */}
            <section>
              <h2 className="text-xl font-semibold text-theme-heading mb-4">5. Payment Processing & PCI Compliance</h2>
              <p>
                All payment processing is handled by Stripe, Inc., a PCI-DSS Level 1 certified payment processor.
                ClubCheck does not store, process, or transmit cardholder data.
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Your payment card information is entered directly into Stripe&apos;s secure payment form.</li>
                <li>We only receive a tokenized reference to your payment method, not your actual card details.</li>
                <li>Stripe&apos;s security practices are detailed at <a href="https://stripe.com/docs/security" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">stripe.com/docs/security</a>.</li>
              </ul>
              <p className="mt-4">
                By using our paid services, you also agree to Stripe&apos;s{' '}
                <a href="https://stripe.com/privacy" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
                  Privacy Policy
                </a>{' '}
                and{' '}
                <a href="https://stripe.com/legal" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
                  Terms of Service
                </a>.
              </p>
            </section>

            {/* Cookies */}
            <section>
              <h2 className="text-xl font-semibold text-theme-heading mb-4">6. Cookies and Tracking Technologies</h2>
              <p>We use the following types of cookies:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Essential Cookies:</strong> Required for authentication and basic functionality. These cannot be disabled.</li>
                <li><strong>Preference Cookies:</strong> Store your settings like theme preference (light/dark mode).</li>
                <li><strong>Analytics Cookies:</strong> Help us understand how users interact with our Service.</li>
              </ul>
              <p className="mt-4">
                You can control cookies through your browser settings. Note that disabling essential cookies will prevent you from using the Service.
              </p>
            </section>

            {/* Data Sharing */}
            <section>
              <h2 className="text-xl font-semibold text-theme-heading mb-4">7. Information Sharing and Disclosure</h2>
              <p>We do not sell your personal information. We may share information in the following circumstances:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Service Providers:</strong> With third-party vendors who assist us in operating our Service (Stripe, email providers, hosting).</li>
                <li><strong>Legal Requirements:</strong> If required by law, subpoena, or other legal process.</li>
                <li><strong>Protection of Rights:</strong> To protect our rights, privacy, safety, or property.</li>
                <li><strong>Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets.</li>
              </ul>
            </section>

            {/* Data Security */}
            <section>
              <h2 className="text-xl font-semibold text-theme-heading mb-4">8. Data Security</h2>
              <p>We implement industry-standard security measures including:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>TLS/SSL encryption for all data in transit</li>
                <li>Encryption at rest for stored data</li>
                <li>Secure password hashing using bcrypt</li>
                <li>Regular security audits and vulnerability assessments</li>
                <li>Role-based access controls for staff accounts</li>
              </ul>
              <p className="mt-4">
                While we strive to protect your information, no method of transmission over the Internet is 100% secure.
                You are responsible for maintaining the confidentiality of your account credentials.
              </p>
            </section>

            {/* Your Rights */}
            <section>
              <h2 className="text-xl font-semibold text-theme-heading mb-4">9. Your Rights</h2>
              <p>Depending on your location, you may have the right to:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Access:</strong> Request a copy of your personal data.</li>
                <li><strong>Correction:</strong> Request correction of inaccurate data.</li>
                <li><strong>Deletion:</strong> Request deletion of your personal data.</li>
                <li><strong>Portability:</strong> Receive your data in a structured, machine-readable format.</li>
                <li><strong>Opt-out:</strong> Unsubscribe from marketing communications.</li>
              </ul>
              <p className="mt-4">
                To exercise these rights, contact us at privacy@clubcheckapp.com. We will respond within 30 days.
              </p>
            </section>

            {/* California Residents */}
            <section>
              <h2 className="text-xl font-semibold text-theme-heading mb-4">10. California Privacy Rights (CCPA)</h2>
              <p>
                If you are a California resident, you have additional rights under the California Consumer Privacy Act (CCPA):
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Right to know what personal information is collected, used, shared, or sold</li>
                <li>Right to delete personal information held by businesses</li>
                <li>Right to opt-out of the sale of personal information (note: we do not sell personal information)</li>
                <li>Right to non-discrimination for exercising your CCPA rights</li>
              </ul>
            </section>

            {/* Children's Privacy */}
            <section>
              <h2 className="text-xl font-semibold text-theme-heading mb-4">11. Children&apos;s Privacy</h2>
              <p>
                ClubCheck is not intended for children under 13 years of age. We do not knowingly collect personal
                information from children under 13. If you become aware that a child has provided us with personal
                information, please contact us at privacy@clubcheckapp.com.
              </p>
            </section>

            {/* Changes to Policy */}
            <section>
              <h2 className="text-xl font-semibold text-theme-heading mb-4">12. Changes to This Privacy Policy</h2>
              <p>
                We may update this Privacy Policy from time to time. We will notify you of material changes by
                posting the new Privacy Policy on this page and updating the &quot;Last updated&quot; date. We encourage
                you to review this Privacy Policy periodically.
              </p>
            </section>

            {/* Contact */}
            <section>
              <h2 className="text-xl font-semibold text-theme-heading mb-4">13. Contact Us</h2>
              <p>If you have questions about this Privacy Policy, please contact us:</p>
              <div className="mt-4 p-4 bg-theme-lighter rounded-lg">
                <p><strong>ClubCheck, Inc.</strong></p>
                <p>Email: privacy@clubcheckapp.com</p>
                <p>Address: [Your Business Address]</p>
              </div>
            </section>
          </div>

          {/* Back Link */}
          <div className="mt-12 pt-8 border-t border-theme">
            <Link href="/" className="text-primary hover:underline flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to Home
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-theme py-8">
        <div className="max-w-4xl mx-auto px-4 text-center text-theme-muted text-sm">
          <div className="flex justify-center gap-6">
            <Link href="/privacy" className="hover:text-primary">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-primary">Terms of Service</Link>
          </div>
          <p className="mt-4">&copy; {new Date().getFullYear()} ClubCheck, Inc. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
