import type { SlidesData } from '@/lib/study-modes';

const NAVY = '243B64';
const TEAL = '5FD3C0';
const INK = '1F2937';

/**
 * Save AI study slides as a PowerPoint file. It opens in PowerPoint, Keynote and
 * Google Slides (File → Import slides, or drop it into Google Drive). The library is
 * loaded only when a student actually downloads, so it never slows the app down.
 */
export async function downloadSlidesPptx(data: SlidesData): Promise<void> {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = data.title || 'Study slides';
  pptx.company = 'TaskTrack';

  // Title slide
  const cover = pptx.addSlide();
  cover.background = { color: NAVY };
  cover.addText(data.title || 'Study slides', {
    x: 0.8, y: 2.3, w: 11.7, h: 1.4, fontSize: 40, bold: true, color: 'FFFFFF', fontFace: 'Arial',
  });
  if (data.subtitle) {
    cover.addText(data.subtitle, { x: 0.8, y: 3.7, w: 11.7, h: 0.8, fontSize: 20, color: TEAL, fontFace: 'Arial' });
  }
  cover.addText('Made with TaskTrack', { x: 0.8, y: 6.6, w: 6, h: 0.4, fontSize: 12, color: 'BFD2F5', fontFace: 'Arial' });

  for (const slide of data.slides) {
    const s = pptx.addSlide();
    s.background = { color: 'FFFFFF' };
    s.addShape('rect', { x: 0, y: 0, w: 13.33, h: 1.2, fill: { color: NAVY } });
    s.addText(slide.heading || '', {
      x: 0.6, y: 0.2, w: 12.1, h: 0.8, fontSize: 28, bold: true, color: 'FFFFFF', fontFace: 'Arial',
    });
    const hasExample = Boolean(slide.example);
    s.addText(
      slide.bullets.map((b) => ({ text: b, options: { bullet: true, paraSpaceAfter: 10 } })),
      { x: 0.7, y: 1.5, w: 11.9, h: hasExample ? 3.9 : 5.4, fontSize: 20, color: INK, fontFace: 'Arial', valign: 'top' }
    );
    if (hasExample) {
      s.addShape('roundRect', { x: 0.7, y: 5.55, w: 11.9, h: 1.55, fill: { color: 'EEF4FF' }, rectRadius: 0.1 });
      s.addText([
        { text: 'Example  ', options: { bold: true, color: '315EDB' } },
        { text: slide.example ?? '', options: { color: INK } },
      ], { x: 0.95, y: 5.65, w: 11.4, h: 1.35, fontSize: 16, fontFace: 'Arial', valign: 'middle' });
    }
  }

  const safe = (data.title || 'study-slides').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'study-slides';
  await pptx.writeFile({ fileName: `${safe}.pptx` });
}
