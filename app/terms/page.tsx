'use client'

import Link from 'next/link'
import Logo from '@/components/Logo'

export default function TermsOfServicePage() {
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
          <h1 className="text-3xl md:text-4xl font-bold text-theme-heading mb-2">Terms of Service</h1>
          <p className="text-theme-muted mb-8">Last updated: {lastUpdated}</p>

          <div className="prose prose-lg max-w-none space-y-8 text-theme-secondary">
            {/* Agreement */}
            <section>
              <h2 className="text-xl font-semibold text-theme-heading mb-4">1. Agreement to Terms</h2>
              <p>
                These Terms of Service (&quot;Terms&quot;) constitute a legally binding agreement between you (&quot;you,&quot; &quot;your,&quot;
                or &quot;Customer&quot;) and BlueLoom Ventures LLC (d/b/a ClubCheck) (&quot;ClubCheck,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) governing your access
                to and use of the ClubCheck gym management platform, including any associated software, mobile
                applications, and services (collectively, the &quot;Service&quot;).
              </p>
              <p>
                By creating an account, accessing, or using the Service, you agree to be bound by these Terms.
                If you do not agree to these Terms, you may not access or use the Service.
              </p>
            </section>

            {/* Description of Service */}
            <section>
              <h2 className="text-xl font-semibold text-theme-heading mb-4">2. Description of Service</h2>
              <p>
                ClubCheck is a software-as-a-service platform designed for boutique gym owners to manage their
                members, track check-ins, process payments, and grow their business. The Service includes:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Member management and check-in tracking</li>
                <li>QR code generation for contactless check-in</li>
                <li>Self-service kiosk mode</li>
                <li>Analytics and reporting</li>
                <li>Email communications and broadcasts</li>
                <li>Staff management with role-based access</li>
                <li>Invoice generation</li>
              </ul>
            </section>

            {/* Eligibility */}
            <section>
              <h2 className="text-xl font-semibold text-theme-heading mb-4">3. Eligibility</h2>
              <p>
                To use the Service, you must:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Be at least 18 years of age</li>
                <li>Have the legal capacity to enter into a binding contract</li>
                <li>Operate a legitimate fitness business or organization</li>
                <li>Provide accurate and complete registration information</li>
                <li>Maintain the security of your account credentials</li>
              </ul>
            </section>

            {/* Account Registration */}
            <section>
              <h2 className="text-xl font-semibold text-theme-heading mb-4">4. Account Registration</h2>
              <p>
                To access the Service, you must create an account by providing your email address, phone number,
                and a secure password. You agree to:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Provide accurate, current, and complete information</li>
                <li>Verify your email address through our verification process</li>
                <li>Keep your login credentials confidential</li>
                <li>Immediately notify us of any unauthorized access to your account</li>
                <li>Accept responsibility for all activities that occur under your account</li>
              </ul>
            </section>

            {/* Free Trial */}
            <section>
              <h2 className="text-xl font-semibold text-theme-heading mb-4">5. Free Trial</h2>
              <p>
                We offer a 14-day free trial of the Service. During the trial period:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>You have access to all features of the Pro plan</li>
                <li>No payment information is required to start the trial</li>
                <li>The trial begins when you verify your email address</li>
                <li>At the end of the trial, you must subscribe to a paid plan to continue using the Service</li>
                <li>Your data will be retained for 30 days after trial expiration</li>
              </ul>
            </section>

            {/* Subscription and Billing */}
            <section>
              <h2 className="text-xl font-semibold text-theme-heading mb-4">6. Subscription and Billing</h2>

              <h3 className="text-lg font-medium text-theme-heading mt-6 mb-3">6.1 Plans and Pricing</h3>
              <p>
                We offer multiple subscription plans with different features and member limits. Current pricing
                is available at clubcheckapp.com/pricing. We reserve the right to modify pricing with 30 days&apos;
                notice to existing subscribers.
              </p>

              <h3 className="text-lg font-medium text-theme-heading mt-6 mb-3">6.2 Billing Cycle</h3>
              <p>
                Subscriptions are billed in advance on a monthly or annual basis, depending on the billing
                cycle you select. Your subscription will automatically renew unless cancelled.
              </p>

              <h3 className="text-lg font-medium text-theme-heading mt-6 mb-3">6.3 Payment Processing</h3>
              <p>
                All payments are processed by Stripe, Inc. By subscribing, you authorize us to charge your
                designated payment method. You agree to Stripe&apos;s{' '}
                <a href="https://stripe.com/legal" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
                  Terms of Service
                </a>.
              </p>

              <h3 className="text-lg font-medium text-theme-heading mt-6 mb-3">6.4 Failed Payments</h3>
              <p>
                If a payment fails, we will attempt to charge your payment method up to 3 times. During this
                period, your access may be limited. After 7 days of failed payments, your account may be
                suspended until payment is resolved.
              </p>

              <h3 className="text-lg font-medium text-theme-heading mt-6 mb-3">6.5 Refunds</h3>
              <p>
                Monthly subscriptions are non-refundable. Annual subscriptions may be refunded on a prorated
                basis within the first 30 days if you are not satisfied with the Service. Contact
                blueloomventuresllc@gmail.com for refund requests.
              </p>
            </section>

            {/* Acceptable Use */}
            <section>
              <h2 className="text-xl font-semibold text-theme-heading mb-4">7. Acceptable Use</h2>
              <p>You agree NOT to use the Service to:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Violate any applicable law, regulation, or third-party rights</li>
                <li>Send spam, unsolicited communications, or harassing messages</li>
                <li>Upload malicious code, viruses, or harmful content</li>
                <li>Attempt to gain unauthorized access to our systems or other users&apos; accounts</li>
                <li>Reverse engineer, decompile, or disassemble the Service</li>
                <li>Resell, sublicense, or redistribute the Service without authorization</li>
                <li>Circumvent usage limits or access restrictions</li>
                <li>Store or transmit illegal, obscene, or infringing content</li>
              </ul>
            </section>

            {/* Your Data */}
            <section>
              <h2 className="text-xl font-semibold text-theme-heading mb-4">8. Your Data</h2>

              <h3 className="text-lg font-medium text-theme-heading mt-6 mb-3">8.1 Ownership</h3>
              <p>
                You retain all rights to the data you input into the Service (&quot;Customer Data&quot;). You grant
                us a limited license to use Customer Data solely to provide and improve the Service.
              </p>

              <h3 className="text-lg font-medium text-theme-heading mt-6 mb-3">8.2 Your Responsibilities</h3>
              <p>
                You are responsible for the accuracy, quality, and legality of Customer Data and your means
                of acquiring it. You must have all necessary rights and consents to input member information
                into the Service.
              </p>

              <h3 className="text-lg font-medium text-theme-heading mt-6 mb-3">8.3 Data Export</h3>
              <p>
                You may export your data at any time through the Service&apos;s export features. Upon account
                termination, you have 30 days to export your data before it is permanently deleted.
              </p>
            </section>

            {/* Intellectual Property */}
            <section>
              <h2 className="text-xl font-semibold text-theme-heading mb-4">9. Intellectual Property</h2>
              <p>
                The Service, including its design, features, content, and underlying technology, is owned by
                ClubCheck and protected by intellectual property laws. You receive a limited, non-exclusive,
                non-transferable license to use the Service for your internal business purposes.
              </p>
              <p className="mt-4">
                The ClubCheck name, logo, and product names are trademarks of BlueLoom Ventures LLC (d/b/a ClubCheck) You may not use
                these marks without our written permission.
              </p>
            </section>

            {/* No Medical Advice Disclaimer */}
            <section className="bg-theme-lighter border border-theme rounded-xl p-6">
              <h2 className="text-xl font-semibold text-theme-heading mb-4">10. No Medical Advice Disclaimer</h2>
              <p className="font-medium">
                CLUBCHECK IS A BUSINESS MANAGEMENT TOOL, NOT A MEDICAL OR FITNESS ADVICE SERVICE.
              </p>
              <ul className="list-disc pl-6 space-y-2 mt-4">
                <li>
                  The Service does not provide medical advice, diagnosis, or treatment recommendations.
                </li>
                <li>
                  Check-in tracking, streak data, and analytics are for informational purposes only and
                  should not be used as health or fitness prescriptions.
                </li>
                <li>
                  You, as the gym owner, are solely responsible for ensuring your members are medically
                  cleared for exercise and understand the risks of physical activity.
                </li>
                <li>
                  ClubCheck is not liable for any injuries, health issues, or adverse outcomes related to
                  physical activities at your gym.
                </li>
                <li>
                  Any waivers or liability releases you create using the Service are your responsibility
                  to review with qualified legal counsel.
                </li>
              </ul>
            </section>

            {/* Waiver Disclaimer */}
            <section>
              <h2 className="text-xl font-semibold text-theme-heading mb-4">11. Waiver Feature Disclaimer</h2>
              <p>
                ClubCheck provides a waiver feature that allows you to collect electronic signatures from
                gym members. Regarding this feature:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>
                  We provide a template for convenience only. The template is NOT legal advice and may
                  not be suitable for your specific jurisdiction or business needs.
                </li>
                <li>
                  You are solely responsible for ensuring your waiver complies with applicable laws in
                  your state, province, or country.
                </li>
                <li>
                  We strongly recommend having your waiver reviewed by a qualified attorney.
                </li>
                <li>
                  Electronic signatures collected through the Service are stored with timestamps and may
                  be used as evidence, but ClubCheck does not guarantee their legal enforceability.
                </li>
                <li>
                  ClubCheck is not responsible for any claims, damages, or liabilities arising from the
                  use or inadequacy of waivers created using the Service.
                </li>
              </ul>
            </section>

            {/* Disclaimers */}
            <section>
              <h2 className="text-xl font-semibold text-theme-heading mb-4">12. Disclaimers</h2>
              <p className="uppercase font-medium">
                THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF ANY KIND,
                EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY,
                FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
              </p>
              <p className="mt-4">
                We do not warrant that:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>The Service will be uninterrupted, secure, or error-free</li>
                <li>The results obtained from the Service will be accurate or reliable</li>
                <li>Any errors will be corrected</li>
              </ul>
            </section>

            {/* Limitation of Liability */}
            <section>
              <h2 className="text-xl font-semibold text-theme-heading mb-4">13. Limitation of Liability</h2>
              <p className="uppercase font-medium">
                TO THE MAXIMUM EXTENT PERMITTED BY LAW, CLUBCHECK SHALL NOT BE LIABLE FOR ANY INDIRECT,
                INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS OR
                REVENUES, WHETHER INCURRED DIRECTLY OR INDIRECTLY, OR ANY LOSS OF DATA, USE, GOODWILL,
                OR OTHER INTANGIBLE LOSSES.
              </p>
              <p className="mt-4">
                In no event shall ClubCheck&apos;s total liability exceed the amounts paid by you for the
                Service in the twelve (12) months preceding the claim.
              </p>
            </section>

            {/* Indemnification */}
            <section>
              <h2 className="text-xl font-semibold text-theme-heading mb-4">14. Indemnification</h2>
              <p>
                You agree to indemnify, defend, and hold harmless ClubCheck, its officers, directors,
                employees, and agents from and against any claims, liabilities, damages, losses, and
                expenses (including reasonable attorneys&apos; fees) arising out of or related to:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Your use of the Service</li>
                <li>Your violation of these Terms</li>
                <li>Your violation of any third-party rights</li>
                <li>Claims by your gym members or staff</li>
                <li>Your use of the waiver feature</li>
              </ul>
            </section>

            {/* Termination */}
            <section>
              <h2 className="text-xl font-semibold text-theme-heading mb-4">15. Termination</h2>
              <p>
                You may cancel your subscription at any time through your account settings or by contacting
                support. We may terminate or suspend your account if:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>You violate these Terms</li>
                <li>Your payment is overdue</li>
                <li>Required by law</li>
                <li>Your account has been inactive for 12 months</li>
              </ul>
              <p className="mt-4">
                Upon termination, your right to use the Service ceases immediately. We will retain your
                data for 30 days, after which it may be permanently deleted.
              </p>
            </section>

            {/* Governing Law */}
            <section>
              <h2 className="text-xl font-semibold text-theme-heading mb-4">16. Governing Law and Disputes</h2>
              <p>
                These Terms shall be governed by the laws of the State of Delaware, without regard to
                conflict of law principles. Any disputes arising from these Terms or the Service shall
                be resolved through binding arbitration in accordance with the American Arbitration
                Association&apos;s rules, except that either party may seek injunctive relief in court.
              </p>
              <p className="mt-4">
                You agree to waive any right to participate in class action lawsuits against ClubCheck.
              </p>
            </section>

            {/* Changes to Terms */}
            <section>
              <h2 className="text-xl font-semibold text-theme-heading mb-4">17. Changes to Terms</h2>
              <p>
                We may modify these Terms at any time. Material changes will be communicated via email
                or in-app notification at least 30 days before taking effect. Your continued use of the
                Service after changes become effective constitutes acceptance of the modified Terms.
              </p>
            </section>

            {/* General */}
            <section>
              <h2 className="text-xl font-semibold text-theme-heading mb-4">18. General Provisions</h2>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Entire Agreement:</strong> These Terms, together with the Privacy Policy, constitute the entire agreement between you and ClubCheck.</li>
                <li><strong>Severability:</strong> If any provision is found unenforceable, the remaining provisions remain in effect.</li>
                <li><strong>Waiver:</strong> Our failure to enforce any right does not waive that right.</li>
                <li><strong>Assignment:</strong> You may not assign these Terms without our consent. We may assign these Terms in connection with a business transfer.</li>
              </ul>
            </section>

            {/* Contact */}
            <section>
              <h2 className="text-xl font-semibold text-theme-heading mb-4">19. Contact Us</h2>
              <p>If you have questions about these Terms, please contact us:</p>
              <div className="mt-4 p-4 bg-theme-lighter rounded-lg">
                <p><strong>BlueLoom Ventures LLC (d/b/a ClubCheck)</strong></p>
                <p>Email: blueloomventuresllc@gmail.com</p>
                <p>Support: blueloomventuresllc@gmail.com</p>
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
          <p className="mt-4">&copy; {new Date().getFullYear()} BlueLoom Ventures LLC (d/b/a ClubCheck) All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
