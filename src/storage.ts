import { calculateStack } from './color';
import type { StackLayer, StoredScheme } from './types';

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
    return parsed as StoredScheme;
  } catch {
    return null;
  }
}

export function saveScheme(
  storage: StorageLike,
  layers: readonly StackLayer[],
  savedAt = new Date().toISOString(),
): StoredScheme | null {
  if (!isValidLayers(layers)) {
    return null;
  }

  const scheme: StoredScheme = {
    version: 1,
    savedAt,
    layers: layers.map((layer) => ({ ...layer })),
  };
  storage.setItem(STORAGE_KEY, JSON.stringify(scheme));
  return scheme;
}
