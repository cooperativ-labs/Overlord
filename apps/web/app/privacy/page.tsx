import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy | Overlord',
  description: 'Privacy Policy for Overlord.'
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Effective date: April 26, 2026</p>

      <div className="mt-8 space-y-8 text-sm leading-7 text-foreground">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">1. Introduction</h2>
          <p>
            Cooperativ, Inc. (&ldquo;Cooperativ,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or
            &ldquo;our&rdquo;) operates the Overlord platform (&ldquo;Service&rdquo;). This Privacy
            Policy describes how we collect, use, and share information about you when you use the
            Service.
          </p>
          <p>
            By using the Service, you consent to the practices described in this Privacy Policy. If
            you do not agree with these practices, please do not use the Service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">2. Information We Collect</h2>
          <p>We collect the following categories of information:</p>

          <h3 className="font-medium mt-4">Account Information</h3>
          <p>
            When you create an account, we collect your email address, name, and any other
            information you provide during registration or onboarding.
          </p>

          <h3 className="font-medium mt-4">Usage Data</h3>
          <p>
            We automatically collect information about how you use the Service, including pages
            visited, features used, tickets created, agent sessions initiated, and time spent on
            the platform.
          </p>

          <h3 className="font-medium mt-4">Content You Submit</h3>
          <p>
            We collect the content of tickets, objectives, agent instructions, and other data you
            input into the Service.
          </p>

          <h3 className="font-medium mt-4">Device and Technical Information</h3>
          <p>
            We collect IP addresses, browser type, operating system, device identifiers, and
            similar technical information when you access the Service.
          </p>

          <h3 className="font-medium mt-4">Integration Data</h3>
          <p>
            If you connect third-party services (such as GitHub, Linear, or AI coding agents), we
            may receive information from those services as permitted by their terms and your
            authorization.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">3. How We Use Your Information</h2>
          <p>We use the information we collect to:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>Provide, maintain, and improve the Service;</li>
            <li>Authenticate users and manage accounts;</li>
            <li>Process transactions and send related information;</li>
            <li>Respond to comments, questions, and support requests;</li>
            <li>
              Send technical notices, updates, security alerts, and administrative messages;
            </li>
            <li>
              Monitor and analyze usage patterns to improve the Service and user experience;
            </li>
            <li>Detect and prevent fraud, abuse, and security incidents;</li>
            <li>Comply with legal obligations.</li>
          </ul>
          <p>
            We do not sell your personal information or use your ticket content to train AI models
            without your explicit consent.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">4. Sharing of Information</h2>
          <p>We may share your information in the following circumstances:</p>

          <h3 className="font-medium mt-4">Service Providers</h3>
          <p>
            We share information with third-party vendors who perform services on our behalf, such
            as hosting (Vercel, Supabase), analytics (Vercel Analytics), error tracking (Sentry),
            and payment processing (Stripe). These providers are contractually obligated to protect
            your information and use it only for the purposes we specify.
          </p>

          <h3 className="font-medium mt-4">Business Transfers</h3>
          <p>
            If Cooperativ is involved in a merger, acquisition, or sale of assets, your information
            may be transferred as part of that transaction. We will notify you of any such change
            and any choices you may have.
          </p>

          <h3 className="font-medium mt-4">Legal Requirements</h3>
          <p>
            We may disclose your information if required by law, regulation, legal process, or
            governmental request, or to protect the rights, property, or safety of Cooperativ,
            our users, or the public.
          </p>

          <h3 className="font-medium mt-4">With Your Consent</h3>
          <p>We may share your information in other ways with your explicit consent.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">5. Data Retention</h2>
          <p>
            We retain your personal information for as long as your account is active or as needed
            to provide the Service. If you delete your account, we will delete or anonymize your
            personal information within 90 days, except where we are required to retain it for
            legal or legitimate business purposes.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">6. Security</h2>
          <p>
            We implement appropriate technical and organizational measures to protect your
            information against unauthorized access, loss, destruction, or alteration. These
            measures include encryption in transit and at rest, access controls, and regular
            security reviews. However, no security system is impenetrable, and we cannot guarantee
            the absolute security of your information.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">7. Cookies and Tracking</h2>
          <p>
            We use cookies and similar tracking technologies to operate the Service, remember your
            preferences, and analyze usage. You can control cookies through your browser settings;
            however, disabling certain cookies may affect the functionality of the Service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">8. Third-Party Services</h2>
          <p>
            The Service integrates with and links to third-party services. This Privacy Policy does
            not apply to those third-party services, and we encourage you to review their privacy
            policies. We are not responsible for the privacy practices of third parties.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">9. Your Rights and Choices</h2>
          <p>Depending on your location, you may have the following rights:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              <strong>Access:</strong> Request a copy of the personal information we hold about
              you;
            </li>
            <li>
              <strong>Correction:</strong> Request correction of inaccurate or incomplete
              information;
            </li>
            <li>
              <strong>Deletion:</strong> Request deletion of your personal information, subject to
              certain exceptions;
            </li>
            <li>
              <strong>Portability:</strong> Receive your data in a machine-readable format;
            </li>
            <li>
              <strong>Objection:</strong> Object to certain processing of your information.
            </li>
          </ul>
          <p>
            To exercise any of these rights, please contact us at{' '}
            <a
              href="mailto:privacy@cooperativ.io"
              className="text-primary underline underline-offset-4"
            >
              privacy@cooperativ.io
            </a>
            . We will respond to your request within 30 days.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">10. Children&apos;s Privacy</h2>
          <p>
            The Service is not directed to children under 13 years of age, and we do not knowingly
            collect personal information from children under 13. If we learn that we have collected
            personal information from a child under 13, we will delete that information promptly.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">11. International Transfers</h2>
          <p>
            Cooperativ is based in the United States, and your information may be stored and
            processed in the United States or other countries where our service providers operate.
            By using the Service, you consent to the transfer of your information to countries that
            may have different data protection laws than your home country.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">12. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of material
            changes by posting the updated policy on the Service or by email at least 30 days
            before the changes take effect. Your continued use of the Service after the effective
            date constitutes your acceptance of the updated policy.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">13. Contact Us</h2>
          <p>
            If you have questions or concerns about this Privacy Policy or our data practices,
            please contact us at:{' '}
            <a
              href="mailto:privacy@cooperativ.io"
              className="text-primary underline underline-offset-4"
            >
              privacy@cooperativ.io
            </a>
          </p>
        </section>

        <p className="border-t pt-6 text-xs text-muted-foreground">
          See also our{' '}
          <Link href="/terms" className="underline underline-offset-4">
            Terms of Service
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
