'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/logo';
import { Reveal, ScrollProgress } from '@/components/landing/reveal';
import { ManageBacShowcase } from '@/components/landing/managebac-showcase';
import { StudyShowcase } from '@/components/landing/study-showcase';
import { GraderGroupShowcase } from '@/components/landing/grader-group-showcase';
import { HeroDemo } from '@/components/landing/hero-demo';
import { ProblemPicker } from '@/components/landing/problem-picker';
import { Spotlight } from '@/components/fx/spotlight';
import { CalendarCheckIcon, SlidesIcon } from '@/components/brand-icons';
import { PLANS, planPriceLine } from '@/lib/entitlements';
import { RELEASES } from '@/lib/whats-new';
import {
  ArrowRight,
  Check,
  Menu,
  X,
} from 'lucide-react';

const navLinks = [
  { label: 'ManageBac', href: '#managebac' },
  { label: 'AI study', href: '#study' },
  { label: 'Grader', href: '#grader' },
  { label: "What's new", href: '#whats-new' },
  { label: 'Features', href: '#features' },
  { label: 'Plans', href: '#plans' },
  { label: 'Contact', href: '#contact' },
];

const workflow = [
  { number: '01', title: 'Add your work', description: 'Create subjects and tasks, or connect ManageBac and Google Classroom to import deadlines automatically.' },
  { number: '02', title: 'Get reminded', description: 'Every task gets a reminder the day before it is due. Add your own reminders whenever you want more.' },
  { number: '03', title: 'Study and finish', description: 'Revise with quizzes and flashcards, check your draft with the AI Grader, or study with friends, then tick it off.' },
];

export default function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const closeMenu = () => setMobileMenuOpen(false);
  const free = PLANS.free;
  const premium = PLANS.pro;

  return (
    <div className="min-h-screen bg-[#F6F5F1] text-slate-800 [font-family:var(--font-inter),ui-sans-serif,system-ui,sans-serif]">
      <ScrollProgress />
      {/* Navigation */}
      <nav className="sticky top-0 z-50 border-b border-white/10 bg-[#243B64]/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" aria-label="TaskTrack home" className="flex items-center gap-2.5">
            <Logo size={34} />
            <span className="text-lg font-bold tracking-tight text-white">TaskTrack</span>
          </Link>
          <div className="hidden items-center gap-6 lg:flex">
            {navLinks.map((l) => (
              <a key={l.href} href={l.href} className="text-sm font-medium text-blue-100 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
                {l.label}
              </a>
            ))}
            <Link href="/login"><Button variant="ghost" size="sm" className="text-blue-100 hover:bg-white/10 hover:text-white">Log in</Button></Link>
            <Link href="/signup"><Button size="sm" className="bg-[#315EDB] text-white hover:bg-[#274DBE]">Get started</Button></Link>
          </div>
          <button
            className="rounded-md p-2 text-blue-100 transition-colors hover:bg-white/10 lg:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {mobileMenuOpen && (
          <div className="border-t border-white/10 bg-[#243B64] px-4 py-4 lg:hidden">
            <div className="space-y-3">
              {navLinks.map((l) => (
                <a key={l.href} href={l.href} onClick={closeMenu} className="block rounded-md px-2 py-1.5 text-sm text-blue-100 hover:bg-white/5 hover:text-white">
                  {l.label}
                </a>
              ))}
              <div className="flex gap-2 border-t border-white/10 pt-3">
                <Link href="/login" className="flex-1"><Button variant="outline" size="sm" className="w-full border-white/25 bg-transparent text-blue-100 hover:bg-white/10">Log in</Button></Link>
                <Link href="/signup" className="flex-1"><Button size="sm" className="w-full bg-[#315EDB] text-white hover:bg-[#274DBE]">Get started</Button></Link>
              </div>
            </div>
          </div>
        )}
      </nav>

      <main>
        {/* Hero */}
        <Spotlight className="overflow-hidden bg-[#1F3459]">
        <section className="relative overflow-hidden pb-16 pt-12 lg:pb-24 lg:pt-16">
          <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1fr_0.95fr] lg:px-8">
            <div className="max-w-2xl">
              <h1 className="max-w-xl text-4xl font-semibold leading-[1.15] tracking-tight text-white sm:text-5xl lg:text-[3.5rem] lg:leading-[1.1]">Know what&rsquo;s due. <span className="text-[#5FD3C0]">Be ready for it.</span></h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-blue-100">TaskTrack pulls your ManageBac and Google Classroom deadlines into one list, helps you study for each one with AI, checks your drafts against the IB criteria, and lets you revise with friends.</p>
              <div className="mt-6 flex flex-wrap gap-2.5">
                <a href="#managebac" className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-white/20">
                  <span className="h-2 w-2 rounded-full bg-[#5FD3C0]" /> ManageBac sync
                </a>
                <a href="#integrations" className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-white/20">
                  <span className="h-2 w-2 rounded-full bg-[#5FD3C0]" /> Google Classroom
                </a>
                <a href="#study" className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-white/20">
                  <span className="h-2 w-2 rounded-full bg-[#5FD3C0]" /> AI study sessions
                </a>
                <a href="#features" className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-white/20">
                  <span className="h-2 w-2 rounded-full bg-[#5FD3C0]" /> Day-before reminders
                </a>
                <a href="#grader" className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-white/20">
                  <span className="h-2 w-2 rounded-full bg-[#5FD3C0]" /> AI Grader
                </a>
                <a href="#grader" className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-white/20">
                  <span className="h-2 w-2 rounded-full bg-[#5FD3C0]" /> Group Study
                </a>
              </div>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/signup"><Button size="lg" className="btn-shine group w-full bg-[#315EDB] text-base text-white shadow-lg shadow-[#315EDB]/30 hover:bg-[#274DBE] sm:w-auto">Get started free <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" /></Button></Link>
                <a href="#study"><Button size="lg" variant="outline" className="w-full border-white/25 bg-transparent text-base text-white hover:bg-white/10 sm:w-auto">Try the AI now, no sign-up</Button></a>
              </div>
              <p className="mt-5 text-sm text-blue-200">Free to start. No card required.</p>
            </div>

            {/* Example workspace: synthetic, illustrative data, interactive */}
            <div className="animate-float-slow lg:animate-none">
              <HeroDemo />
            </div>
          </div>
        </section>
        </Spotlight>

        <ManageBacShowcase />
        <StudyShowcase />
        <GraderGroupShowcase />

        {/* Recently added */}
        <section id="whats-new" className="border-b border-slate-200 bg-white py-16 lg:py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#315EDB]">Recently added</p>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-[#243B64] sm:text-4xl">New in TaskTrack.</h2>
            </div>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {RELEASES.flatMap((r) => r.items).slice(0, 6).map((item, i) => (
                <Reveal key={item.title} delay={i * 70} className="h-full">
                  <div className="h-full rounded-2xl border border-slate-200/80 bg-[#F6F5F1] p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-[#5FD3C0]/25 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#17604F]">New</span>
                      {item.tag && <span className="rounded-full border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-600">{item.tag}</span>}
                    </div>
                    <h3 className="mt-3 font-semibold text-[#243B64]">{item.title}</h3>
                    <p className="mt-1.5 text-sm leading-6 text-slate-600">{item.description}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="border-b border-slate-200 bg-[#F6F5F1] py-20 lg:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-semibold tracking-tight text-[#243B64] sm:text-4xl">What&rsquo;s going wrong this week?</h2>
              <p className="mt-3 text-lg text-slate-600">Pick the one that sounds like you.</p>
            </div>
            <ProblemPicker />
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="border-b border-slate-200 bg-white py-20 lg:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#315EDB]">How it works</p>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-[#243B64] sm:text-4xl">Three steps to a clearer week.</h2>
            </div>
            <div className="mt-12 grid gap-8 md:grid-cols-3">
              {workflow.map((step, i) => (
                <Reveal key={step.number} delay={i * 120}>
                <div className="border-t-2 border-[#315EDB]/40 pt-5">
                  <p className="text-sm font-semibold text-[#315EDB]">{step.number}</p>
                  <h3 className="mt-4 text-xl font-semibold text-[#243B64]">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{step.description}</p>
                </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Integrations */}
        <section id="integrations" className="border-b border-slate-200 bg-[#F6F5F1] py-20 lg:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#315EDB]">Integrations</p>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-[#243B64] sm:text-4xl">Works with what your school uses.</h2>
            </div>
            <div className="mt-10 grid gap-5 md:grid-cols-3">
              <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_2px_rgba(23,38,75,0.04),0_1px_3px_rgba(23,38,75,0.05)]">
                <div className="flex items-center gap-3">
                  <CalendarCheckIcon size={40} />
                  <div>
                    <p className="font-semibold text-[#243B64]">ManageBac</p>
                    <p className="text-xs font-medium text-emerald-700">Available</p>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600">Paste your ManageBac calendar link once. Deadlines import automatically and stay up to date each time your calendar syncs.</p>
              </div>
              <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_2px_rgba(23,38,75,0.04),0_1px_3px_rgba(23,38,75,0.05)]">
                <div className="flex items-center gap-3">
                  <CalendarCheckIcon size={40} />
                  <div>
                    <p className="font-semibold text-[#243B64]">Google Classroom</p>
                    <p className="text-xs font-medium text-emerald-700">Available · Beta</p>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600">Connect your school Google account once. Assignments with due dates import as tasks, sync every 10 minutes, and tick off when you turn them in. Read-only.</p>
              </div>
              <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_2px_rgba(23,38,75,0.04),0_1px_3px_rgba(23,38,75,0.05)]">
                <div className="flex items-center gap-3">
                  <SlidesIcon size={40} />
                  <div>
                    <p className="font-semibold text-[#243B64]">Google Slides &amp; uploads</p>
                    <p className="text-xs font-medium text-emerald-700">Available</p>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600">Upload PDFs and text notes and the AI studies from them. Turn any topic into study slides and download them for Google Slides or PowerPoint.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Plans */}
        <section id="plans" className="border-b border-slate-200 bg-white py-20 lg:py-24">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#315EDB]">Plans</p>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-[#243B64] sm:text-4xl">Start free. Upgrade for more study support.</h2>
            </div>
            <div className="mt-12 grid gap-6 md:grid-cols-2">
              {/* Free */}
              <div className="flex flex-col rounded-2xl border border-slate-200 bg-[#F6F5F1] p-7">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-semibold text-[#243B64]">Free</h3>
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">Included</span>
                </div>
                <p className="mt-3 text-3xl font-bold text-[#243B64]">{planPriceLine(free)}</p>
                <ul className="mt-6 flex-1 space-y-3 text-sm text-slate-700">
                  {[
                    'Tasks, subjects, and planning',
                    'Calendar and reminders',
                    '100 AI credits a month',
                    'Quizzes (5 questions) and flashcards (5 cards)',
                    'ManageBac and Google Classroom connections',
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />{item}</li>
                  ))}
                </ul>
                <Link href="/signup"><Button className="mt-7 w-full bg-[#315EDB] text-white hover:bg-[#274DBE]">Get started free</Button></Link>
              </div>
              {/* Premium */}
              <div className="flex flex-col rounded-2xl border-2 border-[#315EDB]/30 bg-white p-7 shadow-lg shadow-[#315EDB]/5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-semibold text-[#243B64]">Premium</h3>
                  <span className="rounded-full border border-[#315EDB]/30 bg-[#315EDB]/10 px-3 py-1 text-xs font-medium text-[#315EDB]">More study support</span>
                </div>
                <p className="mt-3 text-3xl font-bold text-[#243B64]">{planPriceLine(premium)}</p>
                <p className="mt-1 text-sm text-slate-600">Billed every 3 months.</p>
                <ul className="mt-6 flex-1 space-y-3 text-sm text-slate-700">
                  {[
                    'Everything in Free',
                    '2,000 AI credits a month',
                    'Unlimited tasks and reminders',
                    'Worked examples and study plans',
                    'Bigger quizzes and flashcard sets',
                    'Advanced study insights',
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#315EDB]" />{item}</li>
                  ))}
                </ul>
                <div className="mt-7 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Premium checkout is coming soon — you cannot be charged yet.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="border-b border-slate-200 bg-[#F6F5F1] py-20 lg:py-24">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#315EDB]">FAQ</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-[#243B64] sm:text-4xl">Quick answers.</h2>
            <div className="mt-10 space-y-4">
              {[
                {
                  q: 'Do I need ManageBac?',
                  a: 'No. TaskTrack works on its own. If your school uses ManageBac, paste your calendar link once and its deadlines import into TaskTrack.',
                },
                {
                  q: 'Does it work with Google Classroom?',
                  a: 'Yes, in beta. Connect your school Google account in Settings → Integrations. TaskTrack can only read your classes and your own assignments, never change them. Some schools need their IT admin to allow TaskTrack first.',
                },
                {
                  q: 'How do reminders work?',
                  a: 'Every task automatically gets a reminder the day before it is due, at your default reminder time (8:00 unless you change it). You can add your own reminders too, and TaskTrack suggests good times. Reminders arrive as notifications in TaskTrack and as push notifications when you allow them. Email reminders are coming soon.',
                },
                {
                  q: 'Does TaskTrack alert me when teachers change something?',
                  a: 'ManageBac syncs every 5 minutes and Google Classroom every 10 minutes, so changed due dates show up quickly. If you already edited a task yourself, your edit is kept. There are no instant alerts when a teacher changes something.',
                },
                {
                  q: 'How do AI credits work?',
                  a: 'Every AI action uses credits: a chat message or explanation is 1, a quiz, flashcards or study plan is 2, a slide deck is 3, and an AI Grader check is 5. Free accounts get 100 credits a month and Premium gets 2,000. They refill on the 1st of every month, and if the AI fails you get them back.',
                },
                {
                  q: 'What does Premium add?',
                  a: '20 times more AI credits (2,000 a month), unlimited tasks and reminders, worked examples, personalized study plans, and larger quizzes and flashcard sets. Checkout is not open yet.',
                },
              ].map((item) => (
                <details key={item.q} className="group rounded-xl border border-slate-200 bg-white p-5 open:shadow-sm">
                  <summary className="cursor-pointer list-none text-base font-semibold text-[#243B64] transition-colors group-open:text-[#315EDB]">
                    {item.q}
                    <span className="float-right text-slate-400 transition-transform group-open:rotate-45" aria-hidden>+</span>
                  </summary>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="bg-[#243B64] py-20">
          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
            <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Know what&rsquo;s due. Be ready for it.</h2>
            <Link href="/signup"><Button size="lg" className="mt-8 bg-[#315EDB] text-base text-white hover:bg-[#274DBE]">Get started free <ArrowRight className="ml-2 h-4 w-4" /></Button></Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer id="contact" className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="grid gap-10 md:grid-cols-[1fr_1fr_1.2fr]">
            <div>
              <Link href="/" aria-label="TaskTrack home" className="inline-flex items-center gap-2.5">
                <Logo size={34} />
                <span className="text-lg font-bold tracking-tight text-[#243B64]">TaskTrack</span>
              </Link>
              <p className="mt-4 max-w-xs text-sm leading-6 text-slate-600">Deadlines, AI study tools, grade checks and group study in one clear workspace.</p>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#243B64]">Explore</h2>
              <div className="mt-4 grid gap-3 text-sm text-slate-600">
                <Link href="/terms" className="hover:text-[#243B64]">Terms of Service</Link>
                <Link href="/privacy" className="hover:text-[#243B64]">Privacy Policy</Link>
                <a href="#features" className="hover:text-[#243B64]">Features</a>
                <Link href="/login" className="hover:text-[#243B64]">Login</Link>
                <Link href="/signup" className="hover:text-[#243B64]">Sign up</Link>
              </div>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#243B64]">Contact</h2>
              <div className="mt-4 grid gap-1 text-sm text-[#315EDB]">
                <a href="mailto:riaananandm@sis.edu.in" className="hover:underline">riaananandm@sis.edu.in</a>
                <a href="mailto:vayung@sis.edu.in" className="hover:underline">vayung@sis.edu.in</a>
                <a href="mailto:nagasaim@sis.edu.in" className="hover:underline">nagasaim@sis.edu.in</a>
              </div>
              <p className="mt-4 max-w-sm text-xs leading-5 text-slate-500">Please do not send passwords, ManageBac API tokens, reset links, or private student information.</p>
            </div>
          </div>
          <div className="mt-12 space-y-2 border-t border-slate-200 pt-6 text-xs leading-5 text-slate-500">
            <p>&copy; {new Date().getFullYear()} TaskTrack. All rights reserved.</p>
            <p>
              TaskTrack is an independent student project, not affiliated with or endorsed by the International
              Baccalaureate Organization (IB) or ManageBac. AI grade estimates are not official IB grades.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
