import type { Metadata } from 'next';
import Link from 'next/link';

import { HomepageFooter } from '@/components/marketing/HomepageFooter';
import { HomepageHeader } from '@/components/marketing/HomepageHeader';

export const metadata: Metadata = {
  title: 'About | Overlord',
  description:
    'Overlord is a hobby project by Jacob Chase-Lubitz, a full-stack software engineer building tools that help people stay on top of AI agent work.'
};

export default function AboutPage() {
  return (
    <div className="min-h-dvh flex flex-col bg-[#020817] text-white overflow-y-auto">
      <div className="mx-auto w-full max-w-[1800px] px-6 sm:px-8 lg:px-12">
        <HomepageHeader />
      </div>
      <main className="mx-auto h-full max-w-3xl px-6 py-12 sm:px-8 lg:px-12">
        <h1 className="font-display text-3xl font-bold tracking-tight">About Overlord</h1>
        <p className="mt-2 text-sm text-slate-400">
          A hobby project by{' '}
          <Link
            href="https://jacobchaselubitz.com&utm_source=overlord"
            className="text-sky-400 underline underline-offset-4 hover:text-sky-300"
          >
            Jacob Chase-Lubitz
          </Link>
        </p>

        <div className="mt-8 space-y-8 text-sm leading-7 text-slate-300">
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-white">What Overlord is</h2>
            <p>
              Overlord is a platform that integrates deeply with your existing AI coding tools to
              help you organize and stay on top of agent work. It started as a hobby project,
              scratching a personal itch: as agents took on more of my day-to-day engineering, I
              needed a way to plan their tasks, watch them run, and keep all of that context in one
              place instead of scattered across terminals, IDEs, and chat windows.
            </p>
            <p>
              The product is still evolving in the open. If you want to follow along or try it, the
              best place to start is the{' '}
              <Link href="/" className="text-sky-400 underline underline-offset-4 hover:text-sky-300">
                homepage
              </Link>{' '}
              or the{' '}
              <Link
                href="/docs"
                className="text-sky-400 underline underline-offset-4 hover:text-sky-300"
              >
                docs
              </Link>
              .
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-white">About Jacob</h2>
            <p>
              I&rsquo;m Jacob Chase-Lubitz, a full-stack software engineer with more than a decade
              of experience across engineering and product strategy. I&rsquo;ve built complex web
              applications from the ground up in domains ranging from brick-and-mortar retail
              operations to blockchain and finance to LLM-powered education tools.
            </p>
            <p>
              As a former founder, I gravitate toward roles that combine technical depth with
              product ownership and initiative &mdash; places where I can influence both the
              architecture of a system and the design of the experience users actually feel.
              Overlord is the project where those interests collide right now: a tool I&rsquo;m
              building because I want to use it.
            </p>
            <p>
              You can read more about me and my other work at{' '}
              <a
                href="https://jacobchaselubitz.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-400 underline underline-offset-4 hover:text-sky-300"
              >
                jacobchaselubitz.com
              </a>
              .
            </p>
          </section>

          {/* <section className="space-y-3">
          <h2 className="text-lg font-semibold">Get in touch</h2>
          <p>
            Questions, ideas, or feedback? I&rsquo;d love to hear them. Reach out at{' '}
            <a
              href="mailto:jake@cooperativ.io"
              className="text-primary underline underline-offset-4"
            >
              jake@cooperativ.io
            </a>
            .
          </p>
          </section> */}
        </div>
      </main>
      <HomepageFooter />
    </div>
  );
}
