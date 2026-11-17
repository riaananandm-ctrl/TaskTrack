'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Layers, Plus, Trash2, Pencil, Check, X, RefreshCw, Loader2,
  AlertCircle, BookOpen, ChevronDown, ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  listDecks, getDeckWithCards, saveDeck, updateCard, deleteCard,
  renameDeck, deleteDeck, recordReview, listAllCards,
  type ReviewDeck, type ReviewCard, type DeckWithCards,
} from '@/lib/spaced-review';
import { format, parseISO, isValid } from 'date-fns';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/logo';
import { listQuizAttempts } from '@/lib/quiz-attempts';
import { pickDailyReview, DAILY_REVIEW_SIZE } from '@/lib/daily-review';

/**
 * Review page: the student's saved flashcard decks and the due-today queue.
 * The Leitner schedule is shown plainly (box numbers and intervals), so the
 * system is understandable rather than a black box. Accuracy and activity are
 * reported separately and no exam-grade prediction is made anywhere.
 */
export default function ReviewPage() {
  const [decks, setDecks] = useState<ReviewDeck[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setDecks(await listDecks());
      setLoadError(null);
    } catch {
      setLoadError('Your review decks could not be loaded. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Review</h1>
          <p className="text-muted-foreground mt-1">
            Saved flashcard decks that resurface right before you&rsquo;d forget them.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="w-4 h-4" /> New deck
        </Button>
      </div>

      {!loading && decks.length > 0 && <DailyReview onFinished={load} />}

      {loadError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {loadError}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="flex items-center justify-center rounded-xl bg-white p-2 shadow-soft dark:bg-slate-800">
            <Logo size={36} showText={false} />
          </div>
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : decks.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <BookOpen className="w-10 h-10 mx-auto text-muted-foreground mb-4" />
          <h3 className="font-semibold">No review decks yet</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            Save the flashcards you generate in a study session and they&rsquo;ll show up here as a
            daily review queue.
          </p>
          <Button onClick={() => setCreateOpen(true)} className="mt-5 gap-2">
            <Plus className="w-4 h-4" /> Create your first deck
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {decks.map((deck) => (
            <DeckCard key={deck.id} deck={deck} onChanged={load} />
          ))}
        </div>
      )}

      <CreateDeckDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={load}
      />
    </div>
  );
}

/**
 * Today's 5-minute review: up to 15 cards, due cards first, with cards about the
 * topics you got wrong in recent study-session quizzes put to the front.
 */
function DailyReview({ onFinished }: { onFinished: () => void }) {
  const [cards, setCards] = useState<ReviewCard[] | null>(null);
  const [weakTopics, setWeakTopics] = useState<string[]>([]);
  const [practising, setPractising] = useState(false);
  const [finished, setFinished] = useState(false);
  const reviewed = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listAllCards(),
      listQuizAttempts({ limit: 10 }).catch(() => []),
    ])
      .then(([all, attempts]) => {
        if (cancelled) return;
        const topics = Array.from(new Set(attempts.flatMap((a) => a.weak_topics))).slice(0, 20);
        setWeakTopics(topics);
        setCards(pickDailyReview(all, topics, new Date(), DAILY_REVIEW_SIZE));
      })
      .catch(() => !cancelled && setCards([]));
    return () => {
      cancelled = true;
    };
  }, []);

  if (cards === null) return null;

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
      {practising ? (
        <PracticeSession
          cards={cards}
          exitLabel="Done"
          onExit={() => {
            setPractising(false);
            const left = cards.filter((c) => !reviewed.current.has(c.id));
            setCards(left);
            if (left.length === 0) setFinished(true);
            onFinished();
          }}
          onCardReviewed={(c) => reviewed.current.add(c.id)}
          onFinished={() => {}}
        />
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <p className="font-semibold">Today&rsquo;s 5-minute review</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {finished
                ? 'Done for today. Nice work! Cards come back on their schedule.'
                : cards.length === 0
                  ? 'Nothing due today. Your cards come back on their schedule.'
                  : `${cards.length} card${cards.length === 1 ? '' : 's'}${weakTopics.length ? ', starting with topics you got wrong in recent quizzes' : ', hardest first'}.`}
            </p>
            {!finished && weakTopics.length > 0 && cards.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1 truncate">Weak topics: {weakTopics.slice(0, 4).join(', ')}</p>
            )}
          </div>
          {!finished && cards.length > 0 && (
            <Button onClick={() => setPractising(true)} className="gap-1.5">
              <RefreshCw className="w-4 h-4" /> Start
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function DeckCard({ deck, onChanged }: { deck: ReviewDeck; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [deckData, setDeckData] = useState<DeckWithCards | null>(null);
  const [loadingDeck, setLoadingDeck] = useState(false);

  const openDeck = async () => {
    setOpen((o) => {
      const next = !o;
      if (next && !deckData) {
        setLoadingDeck(true);
        getDeckWithCards(deck.id)
          .then(setDeckData)
          .catch(() => setDeckData(null))
          .finally(() => setLoadingDeck(false));
      }
      return next;
    });
  };

  const dueCount = deckData?.dueCount ?? 0;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button onClick={openDeck} className="w-full text-left px-4 py-3.5" aria-expanded={open}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold truncate">{deck.title}</p>
          <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform flex-shrink-0', open && 'rotate-180')} />
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {deckData ? `${deckData.cards.length} cards` : 'Tap to load'}
          {deckData && dueCount > 0 && (
            <span className="ml-2 inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5 font-medium">
              {dueCount} due
            </span>
          )}
        </p>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-border pt-3">
          {loadingDeck ? (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          ) : deckData ? (
            <DeckDetail deck={deckData} onChanged={onChanged} />
          ) : (
            <p className="text-xs text-destructive">This deck could not be loaded.</p>
          )}
        </div>
      )}
    </div>
  );
}

function DeckDetail({ deck, onChanged }: { deck: DeckWithCards; onChanged: () => void }) {
  const [practising, setPractising] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(deck.title);
  const [cards, setCards] = useState<ReviewCard[]>(deck.cards);

  const commitRename = async () => {
    const title = renameValue.trim();
    if (!title || title === deck.title) {
      setRenaming(false);
      return;
    }
    try {
      await renameDeck(deck.id, title);
      setRenaming(false);
      onChanged();
    } catch {
      setRenaming(false);
    }
  };

  const removeDeck = async () => {
    try {
      await deleteDeck(deck.id);
      onChanged();
    } catch {
      // leave the deck in place on failure
    }
  };

  if (practising) {
    return (
      <PracticeSession
        cards={cards}
        onExit={() => setPractising(false)}
        onCardReviewed={(updated) => {
          setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
        }}
        onFinished={() => onChanged()}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {renaming ? (
          <div className="flex flex-1 items-center gap-1.5">
            <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} className="h-8 text-sm" />
            <button onClick={commitRename} aria-label="Save name" className="tap-target p-1.5 rounded hover:bg-accent">
              <Check className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setRenaming(false)} aria-label="Cancel rename" className="tap-target p-1.5 rounded hover:bg-accent">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <>
            <Button size="sm" onClick={() => setPractising(true)} disabled={cards.length === 0} className="gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" /> Practise
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setRenameValue(deck.title); setRenaming(true); }} className="gap-1.5">
              <Pencil className="w-3.5 h-3.5" /> Rename
            </Button>
            <Button size="sm" variant="outline" onClick={removeDeck} className="gap-1.5 text-destructive hover:text-destructive">
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </Button>
          </>
        )}
      </div>

      <ul className="divide-y divide-border rounded-lg border border-border bg-background">
        {cards.map((card) => (
          <CardRow
            key={card.id}
            card={card}
            deckId={deck.id}
            onChanged={(updated) => {
              setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
              onChanged();
            }}
          />
        ))}
      </ul>
    </div>
  );
}

function CardRow({
  card,
  deckId,
  onChanged,
}: {
  card: ReviewCard;
  deckId: string;
  onChanged: (card: ReviewCard) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const [saving, setSaving] = useState(false);

  const due = parseISO(card.due_at);
  const dueLabel = isValid(due)
    ? due.getTime() <= Date.now()
      ? 'Due now'
      : format(due, 'd MMM')
    : '';

  const save = async () => {
    if (!front.trim() || !back.trim()) return;
    setSaving(true);
    try {
      await updateCard(deckId, card.id, front.trim(), back.trim());
      setEditing(false);
      onChanged({ ...card, front: front.trim(), back: back.trim() });
    } catch {
      // keep the editor open on failure
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await deleteCard(deckId, card.id);
      onChanged({ ...card, front: '' }); // parent filters by existence below
    } catch {
      // leave the row on failure
    }
  };

  if (editing) {
    return (
      <li className="px-3 py-2.5 space-y-2">
        <Input value={front} onChange={(e) => setFront(e.target.value)} placeholder="Front" className="text-sm" />
        <Input value={back} onChange={(e) => setBack(e.target.value)} placeholder="Back" className="text-sm" />
        <div className="flex gap-2">
          <Button size="sm" onClick={save} disabled={saving || !front.trim() || !back.trim()}>Save</Button>
          <Button size="sm" variant="outline" onClick={() => { setEditing(false); setFront(card.front); setBack(card.back); }}>Cancel</Button>
        </div>
      </li>
    );
  }

  return (
    <li className="px-3 py-2.5 flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{card.front}</p>
        <p className="text-xs text-muted-foreground truncate">{card.back}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Box {card.box} · {dueLabel} · {card.times_correct} right / {card.times_wrong} wrong
        </p>
      </div>
      <button onClick={() => setEditing(true)} aria-label={`Edit ${card.front}`} className="tap-target p-1.5 rounded hover:bg-accent flex-shrink-0">
        <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
      </button>
      <button onClick={remove} aria-label={`Delete ${card.front}`} className="tap-target p-1.5 rounded hover:bg-accent flex-shrink-0">
        <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
      </button>
    </li>
  );
}

/** One card at a time; the answer reveal is manual, then correct/incorrect
 * drives the Leitner reschedule shown on the card. */
function PracticeSession({
  cards,
  onExit,
  onCardReviewed,
  onFinished,
  exitLabel = 'Back to deck',
}: {
  cards: ReviewCard[];
  onExit: () => void;
  onCardReviewed: (card: ReviewCard) => void;
  onFinished: () => void;
  exitLabel?: string;
}) {
  const queue = useMemo(() => cards.filter((c) => c.front), [cards]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);

  const card = queue[index];

  const answer = async (correct: boolean) => {
    if (!card) return;
    try {
      const updated = await recordReview({ card, correct });
      onCardReviewed(updated);
    } catch {
      // Still advance; the next sync of the page refreshes true state.
    }
    setReviewedCount((n) => n + 1);
    if (correct) setCorrectCount((n) => n + 1);
    setRevealed(false);
    if (index + 1 >= queue.length) {
      onFinished();
    }
    setIndex((i) => i + 1);
  };

  if (!card) {
    return (
      <div className="text-center py-4 space-y-2">
        <p className="text-sm font-semibold">Round done</p>
        <p className="text-xs text-muted-foreground">
          {reviewedCount === 0
            ? 'Nothing to review right now — cards return on their schedule.'
            : `${reviewedCount} reviewed, ${correctCount} correct${correctCount > 0 ? ` (+${correctCount * 3} XP)` : ''}. Cards you got wrong come back tomorrow; the rest later.`}
        </p>
        <Button size="sm" variant="outline" onClick={onExit}>{exitLabel}</Button>
      </div>
    );
  }

  const nextBoxPreview = card.box >= 5 ? 5 : card.box + 1;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Card {index + 1} of {queue.length}</span>
        <span>Box {card.box} → {nextBoxPreview} if correct</span>
        <button onClick={onExit} className="hover:text-foreground">Exit</button>
      </div>

      <button
        onClick={() => setRevealed((r) => !r)}
        className="w-full min-h-[120px] rounded-xl border-2 border-border bg-background hover:border-primary/30 p-4 text-left transition-all"
      >
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
          {revealed ? 'Back' : 'Front'}
        </p>
        <p className="text-sm font-medium leading-relaxed">{revealed ? card.back : card.front}</p>
      </button>

      {revealed ? (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1 text-red-600 hover:text-red-700" onClick={() => answer(false)}>
            <X className="w-3.5 h-3.5 mr-1" /> Didn&rsquo;t know it
          </Button>
          <Button size="sm" className="flex-1" onClick={() => answer(true)}>
            <Check className="w-3.5 h-3.5 mr-1" /> Knew it
          </Button>
        </div>
      ) : (
        <Button size="sm" className="w-full" onClick={() => setRevealed(true)}>
          Reveal answer
        </Button>
      )}
    </div>
  );
}

function CreateDeckDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [cards, setCards] = useState<{ front: string; back: string }[]>([
    { front: '', back: '' },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle('');
      setCards([{ front: '', back: '' }]);
      setError(null);
    }
  }, [open]);

  const filled = cards.filter((c) => c.front.trim() && c.back.trim());

  const create = async () => {
    if (!title.trim() || filled.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await saveDeck({ title: title.trim(), cards: filled });
      onCreated();
      onClose();
    } catch {
      setError('The deck could not be saved. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New review deck</DialogTitle>
          <DialogDescription>
            Write your own cards now, or save flashcards from a study session later.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Deck name (e.g. Biology — cells)"
          />

          <ul className="space-y-2">
            {cards.map((card, i) => (
              <li key={i} className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Input
                    value={card.front}
                    onChange={(e) =>
                      setCards((prev) => prev.map((c, j) => (j === i ? { ...c, front: e.target.value } : c)))
                    }
                    placeholder="Front"
                    className="text-sm"
                  />
                  <button
                    onClick={() => setCards((prev) => prev.filter((_, j) => j !== i))}
                    aria-label={`Remove card ${i + 1}`}
                    className="tap-target p-1.5 rounded hover:bg-accent flex-shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                </div>
                <Input
                  value={card.back}
                  onChange={(e) =>
                    setCards((prev) => prev.map((c, j) => (j === i ? { ...c, back: e.target.value } : c)))
                  }
                  placeholder="Back"
                  className="text-sm"
                />
              </li>
            ))}
          </ul>

          <button
            onClick={() => setCards((prev) => [...prev, { front: '', back: '' }])}
            className="text-xs font-medium text-primary hover:underline"
          >
            + Add another card
          </button>

          {error && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 text-destructive px-3 py-2 text-xs">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <Button
            onClick={create}
            disabled={saving || !title.trim() || filled.length === 0}
            className="w-full gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Save deck ({filled.length} {filled.length === 1 ? 'card' : 'cards'})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
