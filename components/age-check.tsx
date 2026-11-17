'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Camera, CheckCircle2, EyeOff, Loader2, ScanFace, ShieldCheck, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { acceptTerms, ageChecksLeft, recordAgeCheck, useConsent } from '@/lib/consent';
import { estimateAge, FRAMES_NEEDED, loadFaceModel, type ScanProgress } from '@/lib/face-age';
import { cn } from '@/lib/utils';

type Step = 'consent' | 'scanning' | 'adult' | 'minor' | 'error';

/**
 * Face age check for students who say they're 18 or older. Asks for its own consent
 * (separate from the Terms), runs the estimate on the device, and saves only
 * "18+" or "under 18". Anyone can skip it and continue as under 18 instead.
 */
export function AgeCheck({ compact, onScanStart, onDone }: {
  compact?: boolean;
  /** Called when a scan starts, so a parent screen can stay up to show the result. */
  onScanStart?: () => void;
  /** If given, a Continue button is shown with the result. */
  onDone?: () => void;
}) {
  const { consent } = useConsent();
  const [step, setStep] = useState<Step>('consent');
  const [agreed, setAgreed] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelRef = useRef({ cancelled: false });
  const left = ageChecksLeft(consent);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  useEffect(() => () => {
    cancelRef.current.cancelled = true;
    stopCamera();
  }, []);

  const start = async () => {
    setError(null);
    setProgress(null);
    setStep('scanning');
    onScanStart?.();
    setStatus('Starting your camera…');
    cancelRef.current = { cancelled: false };
    // Start downloading the model while the camera permission prompt is up.
    const model = loadFaceModel();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error('no_video');
      video.srcObject = stream;
      await video.play();
      setStatus('Loading the age model…');
      await model;
      setStatus('Look straight at the camera');
      const age = await estimateAge(video, (p) => { setProgress(p); setStatus(p.message); }, cancelRef.current);
      stopCamera();
      setStatus('Saving the result…');
      const saved = await recordAgeCheck(age);
      if ('error' in saved) {
        setError(saved.error);
        setStep('error');
        return;
      }
      setStep(saved.result);
    } catch (e) {
      stopCamera();
      if (cancelRef.current.cancelled) return;
      const name = e instanceof Error ? e.name : '';
      const msg = e instanceof Error ? e.message : '';
      setError(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Camera access was blocked. Allow the camera for this site in your browser settings, or continue as under 18.'
          : name === 'NotFoundError' || name === 'OverconstrainedError'
            ? 'We couldn’t find a camera on this device. You can continue as under 18 instead.'
            : msg === 'timeout'
              ? 'We couldn’t see a face clearly. Try somewhere brighter, with your face filling the circle.'
              : 'The age check couldn’t run in this browser. Try Chrome or Safari, or continue as under 18.',
      );
      setStep('error');
    }
  };

  const cancel = () => {
    cancelRef.current.cancelled = true;
    stopCamera();
    setStep('consent');
  };

  const continueAsMinor = async () => {
    setSkipping(true);
    const problem = await acceptTerms('minor');
    if (problem) setError(problem);
    setSkipping(false);
  };

  const pct = progress ? Math.round((progress.frames / FRAMES_NEEDED) * 100) : 0;

  return (
    <div className={cn('rounded-2xl border border-border bg-card', compact ? 'p-4 sm:p-5' : 'p-5 sm:p-6')}>
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15">
          <ScanFace className="h-5 w-5 text-primary" />
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold">Quick age check</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            You said you’re 18 or older. Because TaskTrack is mainly used by school students, we check this with a short
            camera scan before unlocking features like Group Study.
          </p>
        </div>
      </div>

      {step === 'consent' && (
        <div className="mt-5 space-y-4">
          <ul className="space-y-2.5 text-sm">
            <li className="flex gap-2.5"><EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-primary" />The scan runs on your device. Your camera image is never uploaded or saved.</li>
            <li className="flex gap-2.5"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />We only keep the result, “18 or older” or “under 18”, and the date.</li>
            <li className="flex gap-2.5"><Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Deleting your account deletes the result too.</li>
            <li className="flex gap-2.5"><Users className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Don’t want a scan? Continue as under 18, and a parent or guardian can OK Group Study instead.</li>
          </ul>

          <label className="flex items-start gap-3 rounded-xl border border-border bg-background p-3 text-sm leading-6">
            <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} className="mt-1" />
            <span>
              I agree to a one-time camera scan to estimate my age, as described above and in the{' '}
              <Link href="/privacy" target="_blank" className="font-medium text-primary underline">Privacy Policy</Link>.
            </span>
          </label>

          {left === 0 && (
            <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
              You’ve used today’s 3 tries. Try again tomorrow, or continue as under 18.
            </p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="sm:flex-1" disabled={!agreed || left === 0} onClick={start}>
              <Camera className="mr-2 h-4 w-4" /> Start the scan
            </Button>
            <Button variant="outline" className="sm:flex-1" disabled={skipping} onClick={continueAsMinor}>
              {skipping && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Skip, continue as under 18
            </Button>
          </div>
          {left > 0 && left < 3 && <p className="text-xs text-muted-foreground">{left} {left === 1 ? 'try' : 'tries'} left today.</p>}
        </div>
      )}

      {/* The video element stays mounted while scanning so the stream can attach to it. */}
      <div className={cn('mt-5 space-y-4', step !== 'scanning' && 'hidden')}>
        <div className="relative mx-auto aspect-square w-full max-w-[280px] overflow-hidden rounded-full bg-muted ring-4 ring-primary/20">
          <video ref={videoRef} playsInline muted className="h-full w-full -scale-x-100 object-cover" />
          <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full -rotate-90" aria-hidden>
            <circle cx="50" cy="50" r="48" fill="none" stroke="hsl(var(--primary))" strokeWidth="3" strokeLinecap="round"
              strokeDasharray={`${(pct / 100) * 301.6} 301.6`} className="transition-[stroke-dasharray] duration-300" />
          </svg>
        </div>
        <p className="text-center text-sm font-medium" aria-live="polite">{status}</p>
        <div className="flex justify-center">
          <Button variant="ghost" size="sm" onClick={cancel}>Cancel</Button>
        </div>
      </div>

      {step === 'adult' && (
        <div className="mt-5 flex items-start gap-3 rounded-xl bg-emerald-500/10 p-4 text-sm">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div>
            <p><strong>All done.</strong> The scan agreed you’re 18 or older. Your camera is off and nothing was saved except the result.</p>
            {onDone && <Button size="sm" className="mt-3" onClick={onDone}>Continue to TaskTrack</Button>}
          </div>
        </div>
      )}

      {step === 'minor' && (
        <div className="mt-5 rounded-xl bg-primary/5 p-4 text-sm">
          <p>
            <strong>The scan suggests you’re under 18.</strong> No problem: you can keep using TaskTrack. For Group Study,
            a parent or guardian just needs to OK it. You’ll find the link for them on the Group Study page.
          </p>
          <p className="mt-2 text-muted-foreground">Think it got it wrong? Scans can be off by a few years. You can try again in better light.</p>
          {left > 0 && (
            <Button variant="outline" size="sm" className="mt-3" onClick={() => { setAgreed(true); setStep('consent'); }}>
              Try again ({left} left today)
            </Button>
          )}
          {onDone && <Button size="sm" className="mt-3 ml-2" onClick={onDone}>Continue to TaskTrack</Button>}
        </div>
      )}

      {step === 'error' && (
        <div className="mt-5 space-y-3">
          <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="sm:flex-1" onClick={() => setStep('consent')}>Back</Button>
            {onDone && consent?.age_check_result && <Button variant="outline" className="sm:flex-1" onClick={onDone}>Continue to TaskTrack</Button>}
            <Button variant="outline" className="sm:flex-1" disabled={skipping} onClick={continueAsMinor}>
              Continue as under 18
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
