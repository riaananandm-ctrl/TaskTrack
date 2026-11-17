import { Flag, Sparkles, Users } from 'lucide-react';
import { GraderIcon, GroupIcon } from '@/components/brand-icons';
import { Reveal } from '@/components/landing/reveal';

/**
 * Homepage section for the AI Grader and Group Study. Both previews are hand-written
 * samples (labelled "Example") showing the shape of what the app produces.
 */

const SAMPLE_CRITERIA = [
  { name: 'Criterion A: Analysing', band: '5–6', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  { name: 'Criterion B: Organising', band: '3–4', tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
  { name: 'Criterion C: Producing text', band: '5–6', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
];

const SAMPLE_CHAT = [
  { who: 'Aarav', text: 'How do I change the base of a log again?' },
  { who: 'Mia', text: 'I always forget this one too 😅' },
  { who: 'TaskTrack AI', text: 'log_b(x) = log(x) ÷ log(b). So log₂(8) = log 8 ÷ log 2 = 3.', ai: true },
];

export function GraderGroupShowcase() {
  return (
    <section id="grader" className="border-b border-slate-200 bg-white py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#315EDB]">Grade check &amp; Group Study</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-[#243B64] sm:text-4xl">
            Check your draft. Study with friends.
          </h2>
          <p className="mt-4 text-lg leading-8 text-slate-600">
            Find out roughly where your work sits before you hand it in, then revise together in a private room.
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          {/* AI Grader */}
          <Reveal className="h-full">
            <div className="flex h-full flex-col rounded-2xl border border-slate-200/80 bg-[#F6F5F1] p-6 sm:p-7">
              <div className="flex items-center gap-3">
                <GraderIcon size={44} />
                <h3 className="text-xl font-semibold text-[#243B64]">AI Grader</h3>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Paste your essay or draft for MYP or DP. Get an estimated level for each IB criterion, evidence from your
                own writing, and the three changes that matter most.
              </p>

              <div className="mt-6 flex-1 rounded-xl border border-slate-200 bg-white p-4" aria-label="Example AI Grader result">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-medium text-[#243B64]">English: comparative essay</p>
                  <span className="text-xs text-slate-400">Example</span>
                </div>
                <div className="space-y-2.5">
                  {SAMPLE_CRITERIA.map((c) => (
                    <div key={c.name} className="flex items-center justify-between gap-3">
                      <p className="text-sm text-slate-700">{c.name}</p>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ring-1 ring-inset ${c.tone}`}>{c.band}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-lg bg-amber-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">To reach the next band</p>
                  <p className="mt-1 text-sm text-amber-900">Link each paragraph back to your thesis so the comparison is clear.</p>
                </div>
              </div>
              <p className="mt-4 text-xs leading-5 text-slate-500">
                An estimate to help you improve, not an official IB grade. Your teacher&rsquo;s marking always comes first.
              </p>
            </div>
          </Reveal>

          {/* Group Study */}
          <Reveal delay={120} className="h-full">
            <div className="flex h-full flex-col rounded-2xl border border-slate-200/80 bg-[#F6F5F1] p-6 sm:p-7">
              <div className="flex items-center gap-3">
                <GroupIcon size={44} />
                <h3 className="text-xl font-semibold text-[#243B64]">Group Study</h3>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Host a private room for up to 8 classmates and share a 6-character code. Anyone in the room can ask the AI
                to help the whole group.
              </p>

              <div className="mt-6 flex-1 rounded-xl border border-slate-200 bg-white p-4" aria-label="Example Group Study room">
                <div className="mb-3 flex items-center justify-between">
                  <p className="flex items-center gap-2 text-sm font-medium text-[#243B64]">
                    <Users className="h-4 w-4 text-slate-400" /> Maths: logarithms revision
                  </p>
                  <span className="font-mono text-xs text-slate-400">ABC-123</span>
                </div>
                <div className="space-y-2.5">
                  {SAMPLE_CHAT.map((m) => (
                    <div key={m.text} className={m.ai ? 'rounded-lg bg-[#22B29E]/10 p-2.5' : 'px-0.5'}>
                      <p className={`flex items-center gap-1 text-xs font-semibold ${m.ai ? 'text-[#178F7F]' : 'text-slate-500'}`}>
                        {m.ai && <Sparkles className="h-3 w-3" />}
                        {m.who}
                      </p>
                      <p className="mt-0.5 text-sm text-slate-700">{m.text}</p>
                    </div>
                  ))}
                </div>
              </div>
              <p className="mt-4 flex items-start gap-1.5 text-xs leading-5 text-slate-500">
                <Flag className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                Swear words are filtered, any message can be reported, and every student needs a parent&rsquo;s OK first.
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
