/**
 * Premium is bought over WhatsApp for now: "Get Premium" opens a chat with TaskTrack
 * with a greeting already typed, and the student just presses send.
 */
export const PREMIUM_WHATSAPP_NUMBER = '919676643800';
const GREETING = 'Hi! I want TaskTrack Premium.';

export function premiumWhatsAppUrl(): string {
  return `https://wa.me/${PREMIUM_WHATSAPP_NUMBER}?text=${encodeURIComponent(GREETING)}`;
}

export function openPremiumWhatsApp(): void {
  const url = premiumWhatsAppUrl();
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  // Pop-up blocked (or in-app browser): go there in this tab instead.
  if (!win) window.location.href = url;
}
