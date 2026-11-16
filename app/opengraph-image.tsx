import { ImageResponse } from 'next/server';

/** The preview picture shown when someone shares a TaskTrack link (WhatsApp, Instagram DMs, iMessage…). */
export const runtime = 'edge';
export const alt = 'TaskTrack: know what’s due, be ready for it';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const CHIPS = ['ManageBac sync', 'AI study sessions', 'AI Grader', 'Group Study'];

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px 80px',
          color: 'white',
          backgroundColor: '#243B64',
          backgroundImage:
            'radial-gradient(circle at 100% 0%, rgba(49,94,219,0.75), transparent 55%), radial-gradient(circle at 0% 100%, rgba(34,178,158,0.45), transparent 55%)',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundImage: 'linear-gradient(135deg, #3B6FF0, #14B8A6, #62CC6A)',
            }}
          >
            <svg width="38" height="38" viewBox="0 0 24 24" fill="none">
              <path d="M5 12.5l4.5 4.5L19 7.5" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>TaskTrack</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05 }}>Know what’s due.</div>
          <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05, color: '#5FD3C0' }}>
            Be ready for it.
          </div>
          <div style={{ marginTop: 24, fontSize: 30, color: '#DBEAFE' }}>
            The free study planner for IB students.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 14 }}>
          {CHIPS.map((c) => (
            <div
              key={c}
              style={{
                display: 'flex',
                padding: '10px 22px',
                borderRadius: 999,
                border: '2px solid rgba(255,255,255,0.25)',
                backgroundColor: 'rgba(255,255,255,0.10)',
                fontSize: 24,
              }}
            >
              {c}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
