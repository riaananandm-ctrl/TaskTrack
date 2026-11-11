'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/logo';
import { PLANS, planPriceLine } from '@/lib/entitlements';
import {
  ArrowRight,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  Clock3,
  Layers3,
  ListTodo,
  Menu,
  X,
} from 'lucide-react';

const navLinks = [
  { label: 'Features', href: '#features' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Plans', href: '#plans' },
  { label: 'Contact', href: '#contact' },
];

const featureCards = [
  {
    icon: ListTodo,
    title: 'Tasks',
    description: 'Every assignment and due date in one list, organised by subject.',
  },
  {
    icon: Layers3,
    title: 'ManageBac',
    description: 'Subscribe to your ManageBac calendar and its deadlines import into TaskTrack.',
  },
  {
    icon: BookOpen,
    title: 'Study tools',
    description: 'Turn a task into explanations, quizzes, flashcards, and a study plan.',
  },
  {
    icon: Bell,
    title: 'Reminders',
    description: 'Get a notification before a deadline sneaks up on you.',
  },
];

const workflow = [
  { number: '01', title: 'Add your work', description: 'Create subjects and tasks, or connect ManageBac to import deadlines.' },
  { number: '02', title: 'Set reminders', description: 'TaskTrack suggests reminder times before each due date.' },
  { number: '03', title: 'Study and finish', description: 'Open a study session, review with quizzes and flashcards, then tick it off.' },
];

export default function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const closeMenu = () => setMobileMenuOpen(false);
  const free = PLANS.free;
  const premium = PLANS.pro;

  return (
    <div className="min-h-screen bg-[#F6F5F1] text-slate-800 [font-family:var(--font-inter),ui-sans-serif,system-ui,sans-serif]">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 border-b border-white/10 bg-[#243B64]">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" aria-label="TaskTrack home"><Logo size={36} tone="light" /></Link>
          <div className="hidden items-center gap-7 md:flex">
            {navLinks.map((l) => (
              <a key={l.href} href={l.href} className="text-sm font-medium text-blue-100 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
                {l.label}
              </a>
            ))}
            <Link href="/login"><Button variant="ghost" size="sm" className="text-blue-100 hover:bg-white/10 hover:text-white">Log in</Button></Link>
            <Link href="/signup"><Button size="sm" className="bg-[#315EDB] text-white hover:bg-[#274DBE]">Get started</Button></Link>
          </div>
          <button
            className="rounded-md p-2 text-blue-100 transition-colors hover:bg-white/10 md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {mobileMenuOpen && (
          <div className="border-t border-white/10 bg-[#243B64] px-4 py-4 md:hidden">
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
        <section className="bg-[#243B64] pb-16 pt-12 lg:pb-24 lg:pt-16">
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1fr_0.95fr] lg:px-8">
            <div className="max-w-2xl">
              <h1 className="max-w-xl text-4xl font-semibold leading-[1.15] tracking-tight text-white sm:text-5xl lg:text-[3.5rem] lg:leading-[1.1]">Know what&rsquo;s due. Be ready for it.</h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-blue-100">Bring school deadlines, study plans, and timely reminders into one clear workspace.</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/signup"><Button size="lg" className="w-full bg-[#315EDB] text-base text-white hover:bg-[#274DBE] sm:w-auto">Get started free <ArrowRight className="ml-2 h-4 w-4" /></Button></Link>
                <a href="#how-it-works"><Button size="lg" variant="outline" className="w-full border-white/25 bg-transparent text-base text-white hover:bg-white/10 sm:w-auto">See how it works</Button></a>
              </div>
              <p className="mt-5 text-sm text-blue-200">Free to start. No card required.</p>
            </div>

            {/* Example workspace — synthetic, illustrative data */}
            <div className="rounded-2xl border border-slate-200 bg-[#FDFCF9] p-4 shadow-xl shadow-[#1a2d4d]/30 sm:p-5" aria-label="Example TaskTrack workspace">
              <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Example workspace</p>
                  <p className="mt-1 text-lg font-semibold text-[#243B64]">This week at a glance</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-2 text-[#315EDB]"><CalendarDays className="h-5 w-5" /></div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-xs text-slate-500">ManageBac deadlines</p>
                  <p className="mt-2 text-2xl font-semibold text-[#243B64]">4</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-xs text-slate-500">Tasks due</p>
                  <p className="mt-2 text-2xl font-semibold text-[#243B64]">3</p>
                </div>
              </div>
              <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-medium text-[#243B64]">Next up</p>
                  <span className="text-xs text-slate-400">Sample</span>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="h-8 w-1 rounded-full bg-[#315EDB]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-700">English — comparative essay</p>
                      <p className="text-xs text-slate-500">Due in 3 days · Draft outline</p>
                    </div>
                    <Clock3 className="h-4 w-4 text-slate-400" />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="h-8 w-1 rounded-full bg-amber-500" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-700">Mathematics — problem set</p>
                      <p className="text-xs text-slate-500">Due Friday · 6 questions</p>
                    </div>
                    <ListTodo className="h-4 w-4 text-slate-400" />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="h-8 w-1 rounded-full bg-emerald-600" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-700">Chemistry — topic review</p>
                      <p className="text-xs text-slate-500">Study session · 45 min</p>
                    </div>
                    <BookOpen className="h-4 w-4 text-slate-400" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="border-b border-slate-200 bg-[#F6F5F1] py-20 lg:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#315EDB]">Features</p>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-[#243B64] sm:text-4xl">Everything in one place.</h2>
            </div>
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {featureCards.map((feature) => {
                const Icon = feature.icon;
                return (
                  <div key={feature.title} className="rounded-xl border border-slate-200 bg-white p-6 transition-colors hover:border-[#315EDB]/40">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#315EDB]/10 text-[#315EDB]"><Icon className="h-5 w-5" /></div>
                    <h3 className="mt-5 text-lg font-semibold text-[#243B64]">{feature.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{feature.description}</p>
                  </div>
                );
              })}
            </div>
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
              {workflow.map((step) => (
                <div key={step.number} className="border-t-2 border-[#315EDB]/40 pt-5">
                  <p className="text-sm font-semibold text-[#315EDB]">{step.number}</p>
                  <h3 className="mt-4 text-xl font-semibold text-[#243B64]">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{step.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Integrations */}
        <section className="border-b border-slate-200 bg-[#F6F5F1] py-20 lg:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#315EDB]">Integrations</p>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-[#243B64] sm:text-4xl">Works with what your school uses.</h2>
            </div>
            <div className="mt-10 grid gap-5 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-white p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#315EDB]/10 text-[#315EDB]"><Layers3 className="h-5 w-5" /></div>
                  <div>
                    <p className="font-semibold text-[#243B64]">ManageBac</p>
                    <p className="text-xs font-medium text-emerald-700">Available</p>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600">Paste your ManageBac calendar link once. Deadlines import automatically and stay up to date each time your calendar syncs.</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-400"><CalendarDays className="h-5 w-5" /></div>
                  <div>
                    <p className="font-semibold text-[#243B64]">Google Classroom</p>
                    <p className="text-xs font-medium text-amber-700">Coming soon</p>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600">Keeping Classroom schoolwork together in TaskTrack is planned but not available yet.</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-400"><BookOpen className="h-5 w-5" /></div>
                  <div>
                    <p className="font-semibold text-[#243B64]">Google Slides &amp; uploads</p>
                    <p className="text-xs font-medium text-amber-700">Coming soon</p>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600">Slide export and document uploads are planned but not available yet.</p>
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
                    '7 AI messages per day',
                    'Quizzes (5 questions) and flashcards (5 cards)',
                    'ManageBac connection',
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
                    '100 AI messages per day',
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
                  q: 'How do reminders work?',
                  a: 'When you set a reminder, TaskTrack suggests times before the due date and sends you a push notification at those times. Email reminders and automatic reminders for every test are planned, not available yet.',
                },
                {
                  q: 'Does TaskTrack alert me when teachers change something?',
                  a: 'Your ManageBac deadlines update in TaskTrack each time your calendar syncs. There are no real-time notifications when a teacher changes a task.',
                },
                {
                  q: 'What does Premium add?',
                  a: 'More daily AI messages, unlimited tasks and reminders, worked examples, personalized study plans, and larger quizzes and flashcard sets. Checkout is not open yet.',
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
              <Link href="/" aria-label="TaskTrack home"><Logo size={36} /></Link>
              <p className="mt-4 max-w-xs text-sm leading-6 text-slate-600">Deadlines, study plans, and reminders in one clear workspace.</p>
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
          <div className="mt-12 border-t border-slate-200 pt-6 text-xs text-slate-500">&copy; {new Date().getFullYear()} TaskTrack. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
}
