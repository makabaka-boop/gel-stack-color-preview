import { calculateStack, normalizeHex } from './color';
import type {
  BaselineSnapshot,
  RgbValue,
  StackLayer,
  StackResult,
  StoredScheme,
} from './types';

export const STORAGE_KEY = 'stage-gel-precheck:latest-scheme:v1';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isValidLayers(layers: unknown): layers is StackLayer[] {
  if (!Array.isArray(layers) || layers.length < 1 || layers.length > 5) {
    return false;
  }

  try {
    calculateStack(layers as StackLayer[]);
    return true;
  } catch {
    return false;
  }
}

function isValidResult(result: unknown): result is StackResult {
  if (typeof result !== 'object' || result === null) {
    return false;
  }
  const candidate = result as Partial<StackResult>;

  const rgbValid =
    Array.isArray(candidate.rgb) &&
    candidate.rgb.length === 3 &&
    candidate.rgb.every(
      (channel) =>
        Number.isInteger(channel) && channel >= 0 && channel <= 255,
    );
  const transmittanceValid =
    typeof candidate.transmittancePercent === 'number' &&
    Number.isFinite(candidate.transmittancePercent) &&
    candidate.transmittancePercent >= 0 &&
    candidate.transmittancePercent <= 100;
  const conclusionValid =
    candidate.conclusion === '可用' || candidate.conclusion === '过暗';

  if (typeof candidate.hex !== 'string') {
    return false;
  }

  try {
    normalizeHex(candidate.hex as StackResult['hex']);
  } catch {
    return false;
  }

  return rgbValid && transmittanceValid && conclusionValid;
}

function isValidBaseline(baseline: unknown): baseline is BaselineSnapshot {
  if (typeof baseline !== 'object' || baseline === null) {
    return false;
  }
  const candidate = baseline as Partial<BaselineSnapshot>;
  return (
    typeof candidate.savedAt === 'string' &&
    isValidLayers(candidate.layers) &&
    isValidResult(candidate.result)
  );
}

function cloneBaseline(baseline: BaselineSnapshot): BaselineSnapshot {
  return {
    savedAt: baseline.savedAt,
    layers: baseline.layers.map((layer) => ({ ...layer })),
    result: {
      ...baseline.result,
      rgb: [...baseline.result.rgb] as RgbValue,
    },
  };
}

export function loadScheme(storage: StorageLike): StoredScheme | null {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredScheme>;
    if (
      parsed.version !== 1 ||
      typeof parsed.savedAt !== 'string' ||
      !isValidLayers(parsed.layers)
    ) {
      return null;
    }

    const scheme: StoredScheme = {
      version: 1,
      savedAt: parsed.savedAt,
      layers: parsed.layers,
    };
    // 旧数据没有 baseline 字段；损坏或越界的基准只被忽略，不影响方案恢复。
    if (isValidBaseline(parsed.baseline)) {
      scheme.baseline = parsed.baseline;
    }
    return scheme;
  } catch {
    return null;
  }
}

export function saveScheme(
  storage: StorageLike,
  layers: readonly StackLayer[],
  savedAt = new Date().toISOString(),
  baseline: BaselineSnapshot | null = null,
): StoredScheme | null {
  if (!isValidLayers(layers)) {
    return null;
  }

  const scheme: StoredScheme = {
    version: 1,
    savedAt,
    layers: layers.map((layer) => ({ ...layer })),
  };
  if (baseline && isValidBaseline(baseline)) {
    scheme.baseline = cloneBaseline(baseline);
  }
  storage.setItem(STORAGE_KEY, JSON.stringify(scheme));
  return scheme;
}

export function clearStoredBaseline(storage: StorageLike): void {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) {
    return;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object' && 'baseline' in parsed) {
      delete parsed.baseline;
      storage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    }
  } catch {
    // 存储原文损坏时无需清理，加载阶段本就会忽略。
  }
}
