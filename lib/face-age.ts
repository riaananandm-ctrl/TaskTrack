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

export const FRAMES_NEEDED = 7;

/**
 * Reads frames from a playing <video> until it has FRAMES_NEEDED estimates with exactly
 * one face in view, then returns the median age. Gives up after `timeoutMs`.
 */
export async function estimateAge(
  video: HTMLVideoElement,
  onProgress: (p: ScanProgress) => void,
  signal: { cancelled: boolean },
  timeoutMs = 20000,
): Promise<number> {
  const faceapi = await loadFaceModel();
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
  const ages: number[] = [];
  const started = Date.now();

  while (ages.length < FRAMES_NEEDED) {
    if (signal.cancelled) throw new Error('cancelled');
    if (Date.now() - started > timeoutMs) throw new Error('timeout');

    const faces = await faceapi.detectAllFaces(video, options).withAgeAndGender();
    if (faces.length === 0) {
      onProgress({ frames: ages.length, needed: FRAMES_NEEDED, message: 'Look straight at the camera' });
    } else if (faces.length > 1) {
      onProgress({ frames: ages.length, needed: FRAMES_NEEDED, message: 'Only one face in view, please' });
    } else {
      ages.push(faces[0].age);
      onProgress({ frames: ages.length, needed: FRAMES_NEEDED, message: 'Hold still…' });
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  const sorted = [...ages].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10;
}
