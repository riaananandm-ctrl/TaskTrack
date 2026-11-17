'use client';

/**
 * On-device age estimate from the camera.
 *
 * Everything runs in the browser: the model files are served from TaskTrack's own
 * site (/models/face) and no image or video frame ever leaves the device. The model
 * library is loaded only when a scan starts, so other pages don't pay for it.
 *
 * Accuracy: typically within a few years for adults, worse for teenagers. It's used to
 * catch obvious mismatches (someone claiming 18+ who looks clearly younger), not as proof.
 */

type FaceApi = typeof import('@vladmandic/face-api/dist/face-api.esm.js');

let loading: Promise<FaceApi> | null = null;

export function loadFaceModel(): Promise<FaceApi> {
  if (!loading) {
    loading = (async () => {
      const faceapi = await import('@vladmandic/face-api/dist/face-api.esm.js');
      // TensorFlow.js picks the fastest backend available (WebGL, else CPU) on its own.
      await (faceapi.tf as unknown as { ready: () => Promise<void> }).ready();
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri('/models/face'),
        faceapi.nets.ageGenderNet.loadFromUri('/models/face'),
      ]);
      return faceapi;
    })().catch((e) => {
      loading = null;
      throw e;
    });
  }
  return loading;
}

export type ScanProgress = { frames: number; needed: number; message: string };

export const FRAMES_NEEDED = 12;

/** The face must fill at least this share of the frame width, so the model sees detail. */
const MIN_FACE_WIDTH = 0.22;
/** Detector confidence needed before a frame counts. */
const MIN_SCORE = 0.7;

/**
 * Reads frames from a playing <video> until it has FRAMES_NEEDED clear readings of exactly
 * one face, then returns a cautious estimate: the 25th percentile rather than the median.
 * This model tends to guess teenagers a few years too old, so leaning low makes it much
 * harder for a younger student to pass. Gives up after `timeoutMs`.
 */
export async function estimateAge(
  video: HTMLVideoElement,
  onProgress: (p: ScanProgress) => void,
  signal: { cancelled: boolean },
  timeoutMs = 30000,
): Promise<number> {
  const faceapi = await loadFaceModel();
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 });
  const ages: number[] = [];
  const started = Date.now();
  const say = (message: string) => onProgress({ frames: ages.length, needed: FRAMES_NEEDED, message });

  while (ages.length < FRAMES_NEEDED) {
    if (signal.cancelled) throw new Error('cancelled');
    if (Date.now() - started > timeoutMs) throw new Error('timeout');

    const faces = await faceapi.detectAllFaces(video, options).withAgeAndGender();
    const width = video.videoWidth || 640;
    if (faces.length === 0) {
      say('Look straight at the camera');
    } else if (faces.length > 1) {
      say('Only one face in view, please');
    } else {
      const { box, score } = faces[0].detection;
      const centre = (box.x + box.width / 2) / width;
      if (box.width / width < MIN_FACE_WIDTH) say('Move a little closer');
      else if (centre < 0.25 || centre > 0.75) say('Move your face into the middle');
      else if (score < MIN_SCORE) say('Face the camera in good light');
      else {
        ages.push(faces[0].age);
        say('Hold still…');
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  const sorted = [...ages].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor((sorted.length - 1) * 0.25)] * 10) / 10;
}
