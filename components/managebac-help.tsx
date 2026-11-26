'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  HelpCircle,
  ExternalLink,
  Mail,
  Phone,
  Copy,
  Check,
  ShieldAlert,
  LifeBuoy,
} from 'lucide-react';

const SUPPORT_EMAILS = [
  'riaananandm@sis.edu.in',
  'vayung@sis.edu.in',
  'nagasaim@sis.edu.in',
];
const SUPPORT_PHONE = '9676643800';
const MANAGEBAC_HELP_URL = 'https://help.managebac.com/';
const EMAIL_SUBJECT = 'TaskTrack ManageBac integration help';
const EMAIL_BODY = `Hello, I need help connecting ManageBac to TaskTrack.

My issue is:
[Describe the problem here]

I have not included my password, calendar subscription link, reset link, or private account information.`;

const HELP_STEPS = [
  'Open ManageBac and log in.',
  'Go to your Calendar.',
  'Open your full calendar if necessary.',
  'Click “Subscribe to Calendar”.',
  'Copy the calendar subscription link/URL.',
  'Return to TaskTrack.',
  'Paste the link into the ManageBac calendar link field.',
  'Click “Connect ManageBac” or “Import Calendar”.',
  'Wait for TaskTrack to import your deadlines.',
  'Confirm the imported tasks appear in Tasks, Planning, and Calendar.',
];

export function ManageBacHelpButton({
  label,
  variant = 'link',
  className,
}: {
  label: string;
  variant?: 'link' | 'ghost' | 'outline';
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant={variant}
        size="sm"
        className={className}
        onClick={() => setOpen(true)}
      >
        <HelpCircle className="w-3.5 h-3.5 mr-1" />
        {label}
      </Button>
      <ManageBacHelpDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

export function ManageBacHelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);

  const copyEmail = useCallback(async (email: string) => {
    try {
      await navigator.clipboard.writeText(email);
      setCopiedEmail(email);
      setTimeout(() => setCopiedEmail(null), 2000);
    } catch {
      // Clipboard may be blocked; the mailto link still works.
    }
  }, []);

  const mailtoHref = (email: string) =>
    `mailto:${email}?subject=${encodeURIComponent(EMAIL_SUBJECT)}&body=${encodeURIComponent(EMAIL_BODY)}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LifeBuoy className="w-5 h-5 text-primary" />
            Need help connecting ManageBac?
          </DialogTitle>
          <DialogDescription>
            TaskTrack connects to your ManageBac calendar using a subscription link. You do not need to create or copy an API key.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Step-by-step instructions */}
          <div>
            <h3 className="text-sm font-semibold mb-2">Step-by-step guide</h3>
            <ol className="space-y-2">
              {HELP_STEPS.map((step, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>

          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
            Treat your calendar subscription link as private. Do not share it publicly.
          </p>

          {/* Official Help Centre link */}
          <div>
            <a href={MANAGEBAC_HELP_URL} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm">
                <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                Official ManageBac Help Centre
              </Button>
            </a>
          </div>

          {/* Contact TaskTrack help */}
          <Card className="p-4 space-y-3">
            <h3 className="text-sm font-semibold">Need help?</h3>
            <p className="text-xs leading-5 text-muted-foreground">Open ManageBac → Calendar → Subscribe to Calendar → Copy the link → return to TaskTrack and paste it here.</p>
            <p className="text-xs leading-5 text-muted-foreground">If you cannot find Subscribe to Calendar, use your full Calendar view or contact your school or TaskTrack support.</p>

            {/* Emails */}
            <div className="space-y-2">
              {SUPPORT_EMAILS.map((email) => (
                <div key={email} className="flex items-center gap-2">
                  <a
                    href={mailtoHref(email)}
                    className="flex items-center gap-1.5 text-sm text-primary hover:underline flex-1 min-w-0"
                  >
                    <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="truncate">{email}</span>
                  </a>
                  <button
                    onClick={() => copyEmail(email)}
                    className="tap-target p-1 rounded text-muted-foreground hover:bg-accent transition-colors flex-shrink-0"
                    aria-label={`Copy ${email}`}
                    title="Copy email address"
                  >
                    {copiedEmail === email ? (
                      <Check className="w-3.5 h-3.5 text-green-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              ))}
            </div>

            {/* Phone */}
            <div className="flex items-center gap-2 pt-1 border-t border-border">
              <a
                href={`tel:${SUPPORT_PHONE}`}
                className="flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <Phone className="w-3.5 h-3.5" />
                {SUPPORT_PHONE}
              </a>
            </div>
          </Card>

          {/* Privacy reminder */}
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-3">
            <ShieldAlert className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800 dark:text-amber-300">
              Please do not include your password, calendar subscription link, reset link, or private student information in your message.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Shows a one-time dismissible tooltip on first visit.
 * Stores dismissal in localStorage — no database needed.
 */
export function FirstVisitHelpTooltip({ children }: { children: React.ReactNode }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      const seen = localStorage.getItem('tasktrack:managebac-help-tooltip-seen');
      if (!seen) {
        const timer = setTimeout(() => setShow(true), 2000);
        return () => clearTimeout(timer);
      }
    } catch {
      // localStorage blocked — skip tooltip.
    }
  }, []);

  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem('tasktrack:managebac-help-tooltip-seen', 'true');
    } catch {
      // localStorage blocked.
    }
  };

  if (!show) return <>{children}</>;

  return (
    <div className="relative inline-block">
      {children}
      <div className="absolute top-full left-0 mt-2 z-50 w-64 animate-fade-in">
        <div className="rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs p-3 shadow-lg">
          <p className="font-medium mb-1">Confused about setup? Get help here.</p>
          <p className="opacity-80 mb-2">Click this link for step-by-step instructions and contact options.</p>
          <div className="flex justify-end">
            <button
              onClick={dismiss}
              className="text-xs font-medium underline hover:no-underline"
            >
              Got it
            </button>
          </div>
        </div>
        <div className="absolute -top-1 left-4 w-2 h-2 bg-slate-900 dark:bg-slate-100 rotate-45" />
      </div>
    </div>
  );
}
