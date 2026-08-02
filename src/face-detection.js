import { loadFaceModels } from './ai.js';
import {
  FACE_DETECT_INPUT_SIZE,
  FACE_DETECT_THRESHOLD,
} from './constants.js';
import { logEvent, serializeErrorForTelemetry } from './telemetry.js';

function finitePoint(point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return { x: point.x, y: point.y };
}

function normalizePoints(points) {
  if (!Array.isArray(points)) return [];
  return points.map(finitePoint).filter(Boolean);
}

function getEyePoints(landmarks, side) {
  const method = side === 'left' ? 'getLeftEye' : 'getRightEye';
  if (typeof landmarks?.[method] === 'function') {
    return normalizePoints(landmarks[method]());
  }

  const positions = normalizePoints(landmarks?.positions);
  if (positions.length < 48) return [];
  return side === 'left' ? positions.slice(36, 42) : positions.slice(42, 48);
}

function normalizeBox(box) {
  if (!box) return null;
  const width = box.width ?? box.w;
  const height = box.height ?? box.h;
  if (
    !Number.isFinite(box.x)
    || !Number.isFinite(box.y)
    || !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
  ) {
    return null;
  }
  return { x: box.x, y: box.y, width, height };
}

function normalizeDetection(result) {
  const box = normalizeBox(result?.detection?.box ?? result?.box);
  if (!box) return null;
  const score = result?.detection?.score ?? result?.score ?? 0;
  const leftEye = getEyePoints(result?.landmarks, 'left');
  const rightEye = getEyePoints(result?.landmarks, 'right');
  const allEyePoints = [...leftEye, ...rightEye];
  const eyeLineY = allEyePoints.length
    ? allEyePoints.reduce((sum, point) => sum + point.y, 0) / allEyePoints.length
    : null;

  return {
    box,
    score: Number.isFinite(score) ? score : 0,
    eyeLineY,
    landmarks: { leftEye, rightEye },
  };
}

/**
 * Chuẩn hóa kết quả face-api.js và chọn khuôn mặt chính theo diện tích lớn nhất.
 * Số lượng khuôn mặt vẫn được giữ để compliance engine có thể cảnh báo ảnh có
 * nhiều người. Khi hai khuôn mặt có cùng diện tích, ưu tiên score cao hơn.
 *
 * @param {Array<object>} detections
 * @returns {{box: object, score: number, faceCount: number, eyeLineY: number|null, landmarks: object}|null}
 */
export function extractFaceGeometry(detections) {
  if (!Array.isArray(detections)) {
    throw new TypeError('detections phải là một mảng.');
  }

  const normalized = detections.map(normalizeDetection).filter(Boolean);
  if (!normalized.length) return null;

  normalized.sort((a, b) => {
    const areaDiff = b.box.width * b.box.height - a.box.width * a.box.height;
    return areaDiff || b.score - a.score;
  });

  return {
    ...normalized[0],
    faceCount: normalized.length,
  };
}

/**
 * Nhận diện tất cả khuôn mặt và landmarks mắt trong canvas bằng model đã được
 * load bởi ai.js. Hàm trả về khuôn mặt chính cùng tổng số khuôn mặt phát hiện.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<ReturnType<typeof extractFaceGeometry>>}
 */
export async function detectFacesWithLandmarks(canvas) {
  const ready = await loadFaceModels();
  const faceApi = globalThis.faceapi;
  if (!ready || !faceApi) return null;

  try {
    const detections = await faceApi
      .detectAllFaces(
        canvas,
        new faceApi.TinyFaceDetectorOptions({
          inputSize: FACE_DETECT_INPUT_SIZE,
          scoreThreshold: FACE_DETECT_THRESHOLD,
        }),
      )
      .withFaceLandmarks(true);

    return extractFaceGeometry(detections);
  } catch (err) {
    logEvent('ai.face_landmarks_detect_failed', {
      error: serializeErrorForTelemetry(err, { fallbackMessage: 'Face landmarks detection failed' }),
    }, 'warn');
    return null;
  }
}
