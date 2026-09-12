import {
  calculateStack,
  DEFAULT_LIGHT_SOURCE,
  normalizeHex,
  parseTransmittance,
} from './color';
import type {
  BaselineSnapshot,
  HexColor,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidLayer(layer: unknown): layer is StackLayer {
  if (!isRecord(layer)) {
    return false;
  }

  if (
    typeof layer.id !== 'string' ||
    layer.id.trim().length === 0 ||
    typeof layer.name !== 'string' ||
    layer.name.trim().length === 0 ||
    typeof layer.hex !== 'string' ||
    typeof layer.transmittance !== 'number'
  ) {
    return false;
  }

  try {
    normalizeHex(layer.hex);
    parseTransmittance(layer.transmittance);
    return true;
  } catch {
    return false;
  }
}

function isValidLayers(layers: unknown): layers is StackLayer[] {
  if (!Array.isArray(layers) || layers.length < 1 || layers.length > 5) {
    return false;
  }

  return layers.every(isValidLayer);
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
  if (!isRecord(baseline)) {
    return false;
  }
  const candidate = baseline as Partial<BaselineSnapshot>;

  if (
    typeof candidate.savedAt !== 'string' ||
    !isValidLayers(candidate.layers) ||
    !isValidResult(candidate.result)
  ) {
    return false;
  }

  // 可选光源字段：缺失按白光处理；存在但非法时整个基准视为损坏。
  let lightSource: HexColor = DEFAULT_LIGHT_SOURCE;
  if (candidate.lightSource !== undefined) {
    if (typeof candidate.lightSource !== 'string') {
      return false;
    }
    try {
      lightSource = normalizeHex(candidate.lightSource);
    } catch {
      return false;
    }
  }

  const calculated = calculateStack(candidate.layers, lightSource);
  const result = candidate.result;
  return (
    normalizeHex(result.hex) === calculated.hex &&
    result.rgb.length === calculated.rgb.length &&
    result.rgb.every((channel, index) => channel === calculated.rgb[index]) &&
    result.transmittancePercent === calculated.transmittancePercent &&
    result.conclusion === calculated.conclusion
  );
}

function cloneBaseline(baseline: BaselineSnapshot): BaselineSnapshot {
  const clone: BaselineSnapshot = {
    savedAt: baseline.savedAt,
    layers: baseline.layers.map((layer) => ({ ...layer })),
    result: {
      ...baseline.result,
      rgb: [...baseline.result.rgb] as RgbValue,
    },
  };
  if (baseline.lightSource !== undefined) {
    clone.lightSource = normalizeHex(baseline.lightSource);
  }
  return clone;
}

// 方案级光源是可选字段：旧记录没有它，按白光处理；字段损坏时仅忽略该字段。
function parseStoredLightSource(value: unknown): HexColor | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  try {
    return normalizeHex(value);
  } catch {
    return undefined;
  }
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
    const lightSource = parseStoredLightSource(parsed.lightSource);
    if (lightSource) {
      scheme.lightSource = lightSource;
    }
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
  lightSource: HexColor | null = null,
): StoredScheme | null {
  if (!isValidLayers(layers)) {
    return null;
  }

  const scheme: StoredScheme = {
    version: 1,
    savedAt,
    layers: layers.map((layer) => ({ ...layer })),
  };
  if (lightSource) {
    scheme.lightSource = normalizeHex(lightSource);
  }
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
