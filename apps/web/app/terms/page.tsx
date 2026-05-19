import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service | Overlord',
  description: 'Terms of Service for Overlord.'
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight">Terms of Service</h1>
      <p className="mt-2 text-sm text-muted-foreground">Effective date: April 26, 2026</p>

      <div className="mt-8 space-y-8 text-sm leading-7 text-foreground">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">1. Acceptance of Terms</h2>
          <p>
            By accessing or using Overlord (&ldquo;Service&rdquo;), operated by Cooperativ, Inc.
            (&ldquo;Cooperativ,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;),
            you agree to be bound by these Terms of Service (&ldquo;Terms&rdquo;). If you do not
            agree to these Terms, do not use the Service.
          </p>
          <p>
            These Terms constitute a legally binding agreement between you and Cooperativ. If you
            are using the Service on behalf of an organization, you represent that you have
            authority to bind that organization to these Terms.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">2. Description of Service</h2>
          <p>
            Overlord is a management and work coordination platform for AI-assisted engineering work. The Service
            includes a web application, desktop application, command-line interface, and related
            APIs that allow users to manage tickets, organize agent work, and integrate with
            third-party AI coding assistants.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">3. Eligibility</h2>
          <p>
            You must be at least 18 years old and capable of forming a legally binding contract to
            use the Service. The Service is intended for use by software engineers, development
            teams, and technology organizations.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">4. Accounts and Access</h2>
          <p>
            You are responsible for maintaining the confidentiality of your account credentials and
            for all activities that occur under your account. You agree to notify us immediately of
            any unauthorized use of your account. We reserve the right to suspend or terminate
            accounts that violate these Terms.
          </p>
          <p>
            You may not share, sell, or transfer access to your account to any third party without
            our prior written consent.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">5. Acceptable Use</h2>
          <p>You agree not to use the Service to:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>Violate any applicable law or regulation;</li>
            <li>Infringe the intellectual property rights or privacy of any third party;</li>
            <li>Upload or transmit malware, viruses, or other malicious code;</li>
            <li>
              Attempt to gain unauthorized access to the Service, its systems, or other users&apos;
              accounts;
            </li>
            <li>Interfere with or disrupt the integrity or performance of the Service;</li>
            <li>
              Use automated means to access the Service in ways that violate these Terms or exceed
              reasonable usage limits;
            </li>
            <li>Resell or sublicense the Service without our prior written consent.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">6. Intellectual Property</h2>
          <p>
            The Service and all associated software, design, text, graphics, logos, and other
            content are owned by Cooperativ or its licensors and are protected by intellectual
            property laws. You are granted a limited, non-exclusive, non-transferable license to
            access and use the Service for its intended purpose.
          </p>
          <p>
            You retain ownership of any content you submit to the Service (&ldquo;User
            Content&rdquo;). By submitting User Content, you grant Cooperativ a worldwide,
            royalty-free license to use, store, and process that content solely to provide and
            improve the Service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">7. Third-Party Integrations</h2>
          <p>
            The Service integrates with third-party tools including AI coding agents (Claude,
            Cursor, OpenAI Codex), version control systems, and project management platforms. Your
            use of third-party services is subject to their respective terms and privacy policies.
            Cooperativ is not responsible for the practices or content of third-party services.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">8. Subscription and Payment</h2>
          <p>
            Access to certain features may require a paid subscription. Subscription fees are billed
            in advance on a monthly or annual basis and are non-refundable except as required by
            applicable law. We reserve the right to change our pricing with 30 days notice. Failure
            to pay may result in suspension or termination of your access.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">9. Disclaimers</h2>
          <p>
            THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo; WITHOUT
            WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED. COOPERATIV DOES NOT WARRANT THAT THE SERVICE
            WILL BE UNINTERRUPTED, ERROR-FREE, OR FREE OF VIRUSES. YOUR USE OF THE SERVICE IS AT
            YOUR OWN RISK.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">10. Limitation of Liability</h2>
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, COOPERATIV SHALL NOT BE LIABLE FOR ANY INDIRECT,
            INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS OR
            REVENUES, WHETHER INCURRED DIRECTLY OR INDIRECTLY, OR ANY LOSS OF DATA, USE, GOODWILL,
            OR OTHER INTANGIBLE LOSSES, RESULTING FROM YOUR USE OF OR INABILITY TO USE THE SERVICE.
          </p>
          <p>
            IN NO EVENT SHALL COOPERATIV&apos;S TOTAL LIABILITY TO YOU EXCEED THE GREATER OF (A) THE
            AMOUNTS YOU PAID TO COOPERATIV IN THE 12 MONTHS PRIOR TO THE CLAIM OR (B) ONE HUNDRED
            DOLLARS ($100).
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">11. Indemnification</h2>
          <p>
            You agree to defend, indemnify, and hold harmless Cooperativ and its officers,
            directors, employees, and agents from any claims, damages, liabilities, costs, and
            expenses (including reasonable attorneys&apos; fees) arising out of your use of the
            Service, your User Content, or your violation of these Terms.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">12. Termination</h2>
          <p>
            We may suspend or terminate your access to the Service at any time, with or without
            cause, upon notice. You may terminate your account at any time by contacting us. Upon
            termination, your right to use the Service ceases immediately.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">13. Changes to Terms</h2>
          <p>
            We may update these Terms from time to time. We will notify you of material changes by
            posting the new Terms on the Service or by email. Your continued use of the Service
            after changes become effective constitutes your acceptance of the updated Terms.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">14. Governing Law</h2>
          <p>
            These Terms are governed by the laws of the United States and the State of Delaware,
            without regard to its conflict of law provisions. Any disputes arising under these Terms
            shall be resolved in the state or federal courts located in Delaware.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">15. Contact</h2>
          <p>
            If you have questions about these Terms, please contact us at{' '}
            <a
              href="mailto:legal@cooperativ.io"
              className="text-primary underline underline-offset-4"
            >
              legal@cooperativ.io
            </a>
            .
          </p>
        </section>

        <p className="border-t pt-6 text-xs text-muted-foreground">
          See also our{' '}
          <Link href="/privacy" className="underline underline-offset-4">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
