// 👁️ 눈감음 실제 감지: MediaPipe Face Landmarker의 blendshape(eyeBlinkLeft/Right) 사용
// (카메라/서버 업로드 없이 브라우저 안에서 WASM으로 돌아감 — wedding-photo-select/index.html:1358-1397 포팅)

let faceLandmarkerPromise: Promise<any> | null = null;

function getFaceLandmarker() {
  if (!faceLandmarkerPromise) {
    faceLandmarkerPromise = (async () => {
      // webpackIgnore: Next.js가 이 CDN URL을 번들링하려 시도하지 않고 브라우저가 런타임에
      // 네이티브 ESM으로 직접 fetch하도록 그대로 남겨둔다(빌드 시점엔 존재하지 않아도 되는 모듈).
      // @ts-ignore - CDN 모듈이라 타입 선언이 없음
      const { FilesetResolver, FaceLandmarker } = await import(/* webpackIgnore: true */ 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14');
      const filesetResolver = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
      );
      return FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'IMAGE',
        numFaces: 4,
        outputFaceBlendshapes: true,
      });
    })().catch((err) => {
      console.error('MediaPipe 로드 실패, 눈감음 감지를 건너뜁니다:', err);
      return null;
    });
  }
  return faceLandmarkerPromise;
}

// eyeBlinkLeft/Right 점수(0=뜸, 1=완전히 감음)가 임계값을 넘는 얼굴이 하나라도 있으면 "눈감음 의심"
export async function detectEyesClosed(bitmap: ImageBitmap): Promise<boolean> {
  const landmarker = await getFaceLandmarker();
  if (!landmarker) return false;
  try {
    const result = landmarker.detect(bitmap);
    const faces = result.faceBlendshapes || [];
    for (const face of faces) {
      const cats = face.categories || [];
      const l = cats.find((c: any) => c.categoryName === 'eyeBlinkLeft')?.score || 0;
      const r = cats.find((c: any) => c.categoryName === 'eyeBlinkRight')?.score || 0;
      if (l > 0.6 && r > 0.6) return true;
    }
  } catch {
    /* 감지 실패는 "안 감음"으로 취급 */
  }
  return false;
}
