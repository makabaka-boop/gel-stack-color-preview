import { describe, expect, it } from 'vitest';
import {
  clearStoredBaseline,
  loadScheme,
  saveScheme,
  STORAGE_KEY,
} from '../src/storage';
import { calculateStack } from '../src/color';
import { asHexColor, asTransmittance } from '../src/types';
import type { BaselineSnapshot, StackLayer, StoredScheme } from '../src/types';

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

function makeBaseline(index: number): BaselineSnapshot {
  const layers = [makeLayer(index), makeLayer(index + 1)];
  return {
    savedAt: '2026-09-11T01:00:00.000Z',
    layers,
    result: calculateStack(layers),
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

  it('缺少名称或标识的色片数据不会被恢复，也不会覆盖存储原文', () => {
    const storage = new MemoryStorage();
    saveScheme(storage, [makeLayer(1)]);
    const validRaw = storage.getItem(STORAGE_KEY);

    const brokenLayers: Array<Partial<StackLayer>> = [
      { ...makeLayer(2), id: '' },
      { ...makeLayer(2), id: '   ' },
      { ...makeLayer(2), id: undefined },
      { ...makeLayer(2), name: '' },
      { ...makeLayer(2), name: '   ' },
      { ...makeLayer(2), name: undefined },
    ];

    for (const brokenLayer of brokenLayers) {
      const brokenScheme = makeScheme([brokenLayer as StackLayer]);
      storage.setItem(STORAGE_KEY, JSON.stringify(brokenScheme));
      expect(loadScheme(storage)).toBeNull();
      expect(storage.getItem(STORAGE_KEY)).toBe(
        JSON.stringify(brokenScheme),
      );
    }

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

describe('基准快照存储', () => {
  it('基准随最近有效方案一起写入并恢复', () => {
    const storage = new MemoryStorage();
    const layers = [makeLayer(1), makeLayer(2)];
    const baseline = makeBaseline(3);

    const saved = saveScheme(storage, layers, makeScheme(layers).savedAt, baseline);
    expect(saved?.baseline).toEqual(baseline);

    const loaded = loadScheme(storage);
    expect(loaded?.layers).toEqual(layers);
    expect(loaded?.baseline).toEqual(baseline);
  });

  it('不传基准时存储原文不含 baseline 字段', () => {
    const storage = new MemoryStorage();
    saveScheme(storage, [makeLayer(1)]);

    const parsed = JSON.parse(storage.getItem(STORAGE_KEY)!);
    expect('baseline' in parsed).toBe(false);
  });

  it('兼容仅含 layers 的旧数据，按无基准处理', () => {
    const storage = new MemoryStorage();
    const legacy = makeScheme([makeLayer(1), makeLayer(2)]);
    storage.setItem(STORAGE_KEY, JSON.stringify(legacy));

    const loaded = loadScheme(storage);
    expect(loaded?.layers).toEqual(legacy.layers);
    expect(loaded?.baseline).toBeUndefined();
  });

  it('损坏或越界的基准只被忽略，当前方案照常恢复', () => {
    const storage = new MemoryStorage();
    const layers = [makeLayer(1)];

    const cases: unknown[] = [
      'not-an-object',
      { savedAt: 123, layers: [makeLayer(2)], result: calculateStack([makeLayer(2)]) },
      { ...makeBaseline(2), layers: [] },
      {
        ...makeBaseline(2),
        layers: Array.from({ length: 6 }, (_, i) => makeLayer(i)),
      },
      {
        ...makeBaseline(2),
        layers: [{ ...makeLayer(2), hex: asHexColor('#BADHEX') }],
      },
      {
        ...makeBaseline(2),
        layers: [{ ...makeLayer(2), transmittance: asTransmittance(0) }],
      },
      { ...makeBaseline(2), result: { hex: '#BADHEX' } },
      {
        ...makeBaseline(2),
        result: {
          ...makeBaseline(2).result,
          transmittancePercent: 120,
        },
      },
      {
        ...makeBaseline(2),
        result: { ...makeBaseline(2).result, rgb: [300, 0, 0] },
      },
      {
        ...makeBaseline(2),
        result: { ...makeBaseline(2).result, conclusion: '未知' },
      },
      (() => {
        const baseline = makeBaseline(2);
        return {
          ...baseline,
          result: { ...baseline.result, hex: '#123456' },
        };
      })(),
      (() => {
        const baseline = makeBaseline(2);
        return {
          ...baseline,
          result: { ...baseline.result, rgb: [1, 2, 3] },
        };
      })(),
      (() => {
        const baseline = makeBaseline(2);
        return {
          ...baseline,
          result: { ...baseline.result, transmittancePercent: 12.3 },
        };
      })(),
      (() => {
        const baseline = makeBaseline(2);
        return {
          ...baseline,
          result: { ...baseline.result, conclusion: '可用' },
        };
      })(),
    ];

    for (const broken of cases) {
      storage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...makeScheme(layers), baseline: broken }),
      );
      const loaded = loadScheme(storage);
      expect(loaded?.layers).toEqual(layers);
      expect(loaded?.baseline).toBeUndefined();
    }
  });

  it('清除基准只移除 baseline 字段，保留当前方案', () => {
    const storage = new MemoryStorage();
    const layers = [makeLayer(1), makeLayer(2)];
    saveScheme(storage, layers, makeScheme(layers).savedAt, makeBaseline(4));
    expect(loadScheme(storage)?.baseline).toBeDefined();

    clearStoredBaseline(storage);
    const loaded = loadScheme(storage);
    expect(loaded?.layers).toEqual(layers);
    expect(loaded?.baseline).toBeUndefined();

    // 再次清除或存储损坏时都不报错
    clearStoredBaseline(storage);
    storage.setItem(STORAGE_KEY, '{not-json');
    expect(() => clearStoredBaseline(storage)).not.toThrow();
  });
});
