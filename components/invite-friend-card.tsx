'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Gift, MessageCircle, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { getMyInvite, inviteLink, inviteMessage, type MyInvite } from '@/lib/invite';

/** Dashboard card: share your invite link; you and your friend both get bonus AI credits. */
export function InviteFriendCard() {
  const [invite, setInvite] = useState<MyInvite | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    getMyInvite().then(setInvite).catch(() => setFailed(true));
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  // Attribution is optional: if the code can't load, show nothing rather than an error.
  if (failed || !invite) return null;

  const link = inviteLink(window.location.origin, invite.code);
  const message = inviteMessage(link, invite.rewardCredits);
  const full = invite.friendsJoined >= invite.maxRewarded;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Leave the link on screen so it can be copied by hand.
    }
  };

  const share = async () => {
    try {
      await navigator.share({ title: 'TaskTrack', text: message });
    } catch {
      // The student closed the share sheet.
    }
  };

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
          <Gift className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-[12rem] flex-1">
          <h2 className="font-semibold">Invite a friend, you both get {invite.rewardCredits} AI credits</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {full
              ? `${invite.friendsJoined} friends joined. Thanks! That's the most that earn credits, but they can still use your link.`
              : invite.friendsJoined > 0
                ? `${invite.friendsJoined} ${invite.friendsJoined === 1 ? 'friend has' : 'friends have'} joined with your link. Credits are added for this month.`
                : 'When a friend makes a new account with your link, you each get extra credits for this month.'}
          </p>
          <p className="mt-2 break-all rounded bg-muted/60 px-2 py-1.5 font-mono text-xs" aria-label="Your invite link">{link}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={copy} className="gap-1.5">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'Copied' : 'Copy link'}
            </Button>
            <Button size="sm" variant="outline" asChild className="gap-1.5">
              <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
              </a>
            </Button>
            {canShare && (
              <Button size="sm" variant="outline" onClick={share} className="gap-1.5">
                <Share2 className="h-3.5 w-3.5" /> Share
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
