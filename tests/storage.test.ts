import { describe, expect, it } from 'vitest';
import { loadScheme, saveScheme, STORAGE_KEY } from '../src/storage';
import { asHexColor, asTransmittance } from '../src/types';
import type { StackLayer, StoredScheme } from '../src/types';

class MemoryStorage {
  values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.has(key) ? this.values.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function makeLayer(index: number): StackLayer {
  return {
    id: `layer-${index}`,
    name: `色片 ${index}`,
    hex: asHexColor(index % 2 ? '#123456' : '#654321'),
    transmittance: asTransmittance(40 + index),
  };
}

function makeScheme(layers: StackLayer[]): StoredScheme {
  return {
    version: 1,
    savedAt: '2026-09-11T00:00:00.000Z',
    layers,
  };
}

describe('最近一次有效方案', () => {
  it('保存并恢复有效方案', () => {
    const storage = new MemoryStorage();
    const layers = [makeLayer(1), makeLayer(2)];
    const saved = saveScheme(storage, layers, makeScheme(layers).savedAt);

    expect(saved).not.toBeNull();
    expect(loadScheme(storage)?.layers).toEqual(layers);
  });

  it('空方案或六张以上方案不会覆盖已有有效方案', () => {
    const storage = new MemoryStorage();
    const layers = [makeLayer(1)];
    saveScheme(storage, layers, '2026-01-01T00:00:00.000Z');
    const validRaw = storage.getItem(STORAGE_KEY);

    expect(saveScheme(storage, [])).toBeNull();
    expect(
      saveScheme(storage, Array.from({ length: 6 }, (_, i) => makeLayer(i))),
    ).toBeNull();
    expect(storage.getItem(STORAGE_KEY)).toBe(validRaw);
  });

  it('含非法六位颜色或非法透光率的数据不会被恢复，也不会覆盖存储原文', () => {
    const storage = new MemoryStorage();
    saveScheme(storage, [makeLayer(1)]);
    const validRaw = storage.getItem(STORAGE_KEY);

    const invalidColor = makeScheme([
      { ...makeLayer(2), hex: asHexColor('#BADHEX') },
    ]);
    storage.setItem(STORAGE_KEY, JSON.stringify(invalidColor));
    expect(loadScheme(storage)).toBeNull();
    expect(storage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify(invalidColor),
    );

    const invalidTransmittance = makeScheme([
      { ...makeLayer(2), transmittance: asTransmittance(0) },
    ]);
    storage.setItem(STORAGE_KEY, JSON.stringify(invalidTransmittance));
    expect(loadScheme(storage)).toBeNull();
    expect(validRaw).not.toBeNull();
  });

  it('损坏 JSON 或未知版本按无方案处理', () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, '{not-json');
    expect(loadScheme(storage)).toBeNull();

    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...makeScheme([makeLayer(1)]), version: 2 }),
    );
    expect(loadScheme(storage)).toBeNull();
  });
});
