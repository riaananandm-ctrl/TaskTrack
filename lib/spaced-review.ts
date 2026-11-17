'use client';

import { supabase } from '@/lib/supabase/client';
import type { Flashcard } from '@/lib/study-modes';

/**
 * Persistent spaced review. Flashcard decks are saved independently of the
 * study session that produced them, and every card is scheduled with a
 * Leitner box system (see SCHEDULING below) so revision material comes back
 * just before a student would naturally forget it.
 *
 * SCHEDULING ALGORITHM (Leitner boxes, documented because the UI shows it):
 * - Every card sits in a box from 1 (hardest) to 5 (easiest).
 * - Answer correctly: the card moves up one box (capped at 5) and its next due
 *   date moves out to that box's interval (1, 2, 4, 7, 14 days).
 * - Answer wrongly: the card drops back to box 1 and is due again tomorrow.
 * - New cards start in box 1, due immediately.
 * The algorithm is deliberately simple and explainable to a student; it is not
 * an exam-grade predictor, only a sensible revision queue.
 */

export const BOX_INTERVALS_DAYS: Record<number, number> = {
  1: 1,
  2: 2,
  3: 4,
  4: 7,
  5: 14,
};

export const MIN_BOX = 1;
export const MAX_BOX = 5;

export interface ReviewCard {
  id: string;
  deck_id: string;
  user_id: string;
  front: string;
  back: string;
  box: number;
  due_at: string;
  last_reviewed_at: string | null;
  times_correct: number;
  times_wrong: number;
}

export interface ReviewDeck {
  id: string;
  user_id: string;
  task_id: string | null;
  session_id: string | null;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface DeckWithCards extends ReviewDeck {
  cards: ReviewCard[];
  dueCount: number;
}

/** Next due date for a card that was answered `correct` in `box`. */
export function nextDueFor(boxAfter: number, now: Date = new Date()): Date {
  const interval = BOX_INTERVALS_DAYS[boxAfter] ?? 1;
  const due = new Date(now);
  due.setDate(due.getDate() + interval);
  return due;
}

/** Box transition for a review result. */
export function nextBox(current: number, correct: boolean): number {
  if (correct) return Math.min(current + 1, MAX_BOX);
  return MIN_BOX;
}

const CARD_COLUMNS = 'id, deck_id, user_id, front, back, box, due_at, last_reviewed_at, times_correct, times_wrong';

export async function listDecks(): Promise<ReviewDeck[]> {
  const { data, error } = await supabase
    .from('review_decks')
    .select('id, user_id, task_id, session_id, title, created_at, updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listDueCards(limit = 50): Promise<ReviewCard[]> {
  const { data, error } = await supabase
    .from('review_cards')
    .select(CARD_COLUMNS)
    .lte('due_at', new Date().toISOString())
    .order('due_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** All the student's cards (newest decks first), for picking the daily review. */
export async function listAllCards(limit = 1000): Promise<ReviewCard[]> {
  const { data, error } = await supabase
    .from('review_cards')
    .select(CARD_COLUMNS)
    .order('due_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function getDeckWithCards(deckId: string): Promise<DeckWithCards | null> {
  const { data: deck, error } = await supabase
    .from('review_decks')
    .select('id, user_id, task_id, session_id, title, created_at, updated_at')
    .eq('id', deckId)
    .maybeSingle();
  if (error) throw error;
  if (!deck) return null;

  const { data: cards, error: cardsError } = await supabase
    .from('review_cards')
    .select(CARD_COLUMNS)
    .eq('deck_id', deckId)
    .order('created_at', { ascending: true });
  if (cardsError) throw cardsError;

  const now = Date.now();
  const list = cards ?? [];
  return {
    ...deck,
    cards: list,
    dueCount: list.filter((c) => new Date(c.due_at).getTime() <= now).length,
  };
}

/** Save a generated (or hand-written) flashcard set as a durable review deck. */
export async function saveDeck(params: {
  title: string;
  cards: Flashcard[];
  taskId?: string | null;
  sessionId?: string | null;
}): Promise<ReviewDeck> {
  const { data: deck, error } = await supabase
    .from('review_decks')
    .insert({
      title: params.title,
      task_id: params.taskId ?? null,
      session_id: params.sessionId ?? null,
    })
    .select('id, user_id, task_id, session_id, title, created_at, updated_at')
    .maybeSingle();
  if (error) throw error;
  if (!deck) throw new Error('The deck could not be saved.');

  if (params.cards.length > 0) {
    const { error: cardsError } = await supabase.from('review_cards').insert(
      params.cards.map((c) => ({ deck_id: deck.id, front: c.front, back: c.back }))
    );
    if (cardsError) throw cardsError;
  }
  return deck as ReviewDeck;
}

export async function updateCard(deckId: string, cardId: string, front: string, back: string): Promise<void> {
  const { error } = await supabase
    .from('review_cards')
    .update({ front, back, updated_at: new Date().toISOString() })
    .eq('id', cardId)
    .eq('deck_id', deckId);
  if (error) throw error;
}

export async function deleteCard(deckId: string, cardId: string): Promise<void> {
  const { error } = await supabase
    .from('review_cards')
    .delete()
    .eq('id', cardId)
    .eq('deck_id', deckId);
  if (error) throw error;
}

export async function renameDeck(deckId: string, title: string): Promise<void> {
  const { error } = await supabase
    .from('review_decks')
    .update({ title, updated_at: new Date().toISOString() })
    .eq('id', deckId);
  if (error) throw error;
}

export async function deleteDeck(deckId: string): Promise<void> {
  const { error } = await supabase.from('review_decks').delete().eq('id', deckId);
  if (error) throw error;
}

/** Record one review and reschedule the card. Appends to the log first; if the
 * log write fails the card is still updated so the queue stays accurate. */
export async function recordReview(params: {
  card: ReviewCard;
  correct: boolean;
  now?: Date;
}): Promise<ReviewCard> {
  const at = params.now ?? new Date();
  const box = nextBox(params.card.box, params.correct);
  const due = nextDueFor(box, at);

  try {
    await supabase.from('review_log').insert({
      card_id: params.card.id,
      deck_id: params.card.deck_id,
      was_correct: params.correct,
      reviewed_at: at.toISOString(),
    });
  } catch {
    // The queue must stay accurate even if history could not be appended.
  }

  const { data, error } = await supabase
    .from('review_cards')
    .update({
      box,
      due_at: due.toISOString(),
      last_reviewed_at: at.toISOString(),
      times_correct: params.card.times_correct + (params.correct ? 1 : 0),
      times_wrong: params.card.times_wrong + (params.correct ? 0 : 1),
      updated_at: at.toISOString(),
    })
    .eq('id', params.card.id)
    .select(CARD_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('The card could not be updated.');
  return data as ReviewCard;
}

/** Aggregate accuracy over the recent log, for progress that separates
 * activity (reviews done) from accuracy (share correct). */
export async function getReviewStats(): Promise<{
  totalReviews: number;
  correctReviews: number;
  dueNow: number;
  decks: number;
  cards: number;
}> {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [logResult, dueResult, deckResult, cardResult] = await Promise.all([
    supabase
      .from('review_log')
      .select('was_correct, reviewed_at')
      .gte('reviewed_at', weekAgo.toISOString()),
    supabase
      .from('review_cards')
      .select('id', { count: 'exact', head: true })
      .lte('due_at', new Date().toISOString()),
    supabase.from('review_decks').select('id', { count: 'exact', head: true }),
    supabase.from('review_cards').select('id', { count: 'exact', head: true }),
  ]);

  const log = (logResult.data ?? []) as Array<{ was_correct: boolean }>;
  return {
    totalReviews: log.length,
    correctReviews: log.filter((r) => r.was_correct).length,
    dueNow: dueResult.count ?? 0,
    decks: deckResult.count ?? 0,
    cards: cardResult.count ?? 0,
  };
}
