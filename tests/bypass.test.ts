import { describe, expect, it } from 'vitest';
import {
  calculateLightPath,
  calculateStack,
  calculateTotalTransmittance,
  stackColor,
} from '../src/color';
import { loadScheme, saveScheme, STORAGE_KEY } from '../src/storage';
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

function layer(
  id: string,
  name: string,
  hex: string,
  transmittance: number,
  bypassed = false,
): StackLayer {
  const base: StackLayer = {
    id,
    name,
    hex: asHexColor(hex),
    transmittance: asTransmittance(transmittance),
  };
  return bypassed ? { ...base, bypassed: true } : base;
}

const RED = layer('primary-red', '正红 R02', '#D82128', 72);
const ORANGE = layer('fire-orange', '火焰橙 O15', '#F26322', 68);
const YELLOW = layer('deep-yellow', '深黄 Y23', '#F5D020', 84);

describe('旁路层参与计算', () => {
  it('混合状态：旁路中间层等价于撤下该层，其余层顺序与结果不变', () => {
    const mixed = [RED, { ...ORANGE, bypassed: true }, YELLOW];
    const removed = calculateStack([RED, YELLOW]);

    // 总结果与“直接撤下中间层”完全一致。
    expect(calculateStack(mixed)).toEqual(removed);
    expect(removed.hex).toBe('#CF1901');
    expect(removed.rgb).toEqual([207, 25, 1]);
    expect(removed.transmittancePercent).toBe(60.5);
    expect(removed.conclusion).toBe('可用');

    // 底层计算函数同样只统计参与层。
    expect(stackColor(mixed)).toEqual(stackColor([RED, YELLOW]));
    expect(calculateTotalTransmittance(mixed)).toBe(60.5);
  });

  it('旁路层仍占据原检查点：标明未参与，数值继承上一检查点', () => {
    const { checkpoints, last } = calculateLightPath([
      RED,
      { ...ORANGE, bypassed: true },
      YELLOW,
    ]);

    expect(checkpoints).toHaveLength(3);
    expect(checkpoints.map((point) => point.participating)).toEqual([
      true,
      false,
      true,
    ]);
    expect(checkpoints.map((point) => point.layerOrder)).toEqual([1, 2, 3]);

    // 中间检查点保留原层名与序号，数值完整继承上一检查点。
    expect(checkpoints[1]).toEqual({
      layerId: 'fire-orange',
      layerName: '火焰橙 O15',
      layerOrder: 2,
      participating: false,
      hex: checkpoints[0].hex,
      rgb: checkpoints[0].rgb,
      transmittancePercent: checkpoints[0].transmittancePercent,
      conclusion: checkpoints[0].conclusion,
    });

    // 后续参与层从继承值继续累计，末检查点即总结果。
    expect(last).toBe(checkpoints[2]);
    expect(last.hex).toBe('#CF1901');
    expect(last.transmittancePercent).toBe(60.5);
  });

  it('首张即旁路时，其检查点继承光源本身与 100.0%', () => {
    const { checkpoints } = calculateLightPath([
      { ...RED, bypassed: true },
      ORANGE,
    ]);

    expect(checkpoints[0]).toEqual({
      layerId: 'primary-red',
      layerName: '正红 R02',
      layerOrder: 1,
      participating: false,
      hex: '#FFFFFF',
      rgb: [255, 255, 255],
      transmittancePercent: 100,
      conclusion: '可用',
    });
    expect(checkpoints[1].hex).toBe('#F26322');
    expect(checkpoints[1].transmittancePercent).toBe(68);
  });

  it('全部旁路时输出光源颜色与 100.0% 透光率', () => {
    const allBypassed = [
      { ...RED, bypassed: true },
      { ...ORANGE, bypassed: true },
    ];

    const white = calculateStack(allBypassed);
    expect(white.hex).toBe('#FFFFFF');
    expect(white.rgb).toEqual([255, 255, 255]);
    expect(white.transmittancePercent).toBe(100);
    expect(white.conclusion).toBe('可用');

    // 有色光源下输出该光源本身。
    const cool = calculateStack(allBypassed, asHexColor('#A0C8FF'));
    expect(cool.hex).toBe('#A0C8FF');
    expect(cool.rgb).toEqual([160, 200, 255]);
    expect(cool.transmittancePercent).toBe(100);

    // 每个检查点都未参与，数值均为光源起点。
    const { checkpoints } = calculateLightPath(
      allBypassed,
      asHexColor('#A0C8FF'),
    );
    for (const checkpoint of checkpoints) {
      expect(checkpoint.participating).toBe(false);
      expect(checkpoint.hex).toBe('#A0C8FF');
      expect(checkpoint.transmittancePercent).toBe(100);
      expect(checkpoint.conclusion).toBe('可用');
    }
  });

  it('旁路状态不影响一至五层数量校验', () => {
    expect(() =>
      calculateStack([{ ...RED, bypassed: true }]),
    ).not.toThrow();
    expect(() =>
      calculateLightPath(
        Array.from({ length: 6 }, (_, index) => ({
          ...layer(`g${index}`, `色片 ${index}`, '#FFFFFF', 50),
          bypassed: true,
        })),
      ),
    ).toThrow(/一至五张/);
  });
});

describe('旁路状态存储', () => {
  function makeScheme(layers: StackLayer[]): StoredScheme {
    return {
      version: 1,
      savedAt: '2026-09-12T00:00:00.000Z',
      layers,
    };
  }

  it('旁路状态作为可选属性随最近有效方案写入并恢复', () => {
    const storage = new MemoryStorage();
    const layers = [RED, { ...ORANGE, bypassed: true }, YELLOW];
    saveScheme(storage, layers, '2026-09-12T01:00:00.000Z');

    const raw = storage.getItem(STORAGE_KEY)!;
    expect(raw).toContain('"bypassed":true');

    const loaded = loadScheme(storage);
    expect(loaded?.layers).toEqual(layers);
    expect(loaded?.layers[1].bypassed).toBe(true);
  });

  it('旧记录缺少旁路属性时视为正常参与，存储原文也不新增字段', () => {
    const storage = new MemoryStorage();
    const legacyLayers = [RED, ORANGE];
    storage.setItem(STORAGE_KEY, JSON.stringify(makeScheme(legacyLayers)));

    const loaded = loadScheme(storage);
    expect(loaded?.layers).toEqual(legacyLayers);
    expect(loaded?.layers.every((item) => item.bypassed === undefined)).toBe(
      true,
    );

    // 照常保存后，未旁路的层不写入 bypassed 字段。
    saveScheme(storage, legacyLayers, '2026-09-12T02:00:00.000Z');
    expect(storage.getItem(STORAGE_KEY)).not.toContain('bypassed');
  });

  it('旁路属性非布尔时整份记录视为损坏，不会恢复', () => {
    const storage = new MemoryStorage();
    const broken = makeScheme([
      { ...RED, bypassed: 'yes' as unknown as boolean },
    ]);
    storage.setItem(STORAGE_KEY, JSON.stringify(broken));

    expect(loadScheme(storage)).toBeNull();
    expect(storage.getItem(STORAGE_KEY)).toBe(JSON.stringify(broken));
  });

  it('基准快照保留设置当时的旁路状态，并按同一规则校验结果', () => {
    const storage = new MemoryStorage();
    const baselineLayers = [RED, { ...ORANGE, bypassed: true }];
    const baseline: BaselineSnapshot = {
      savedAt: '2026-09-12T01:00:00.000Z',
      layers: baselineLayers,
      result: calculateStack(baselineLayers),
    };
    saveScheme(storage, [YELLOW], '2026-09-12T02:00:00.000Z', baseline);

    const loaded = loadScheme(storage);
    expect(loaded?.baseline).toEqual(baseline);
    // 基准结果就是“撤下火焰橙”后的结果：白光下的正红本身。
    expect(loaded?.baseline?.result.hex).toBe('#D82128');
    expect(loaded?.baseline?.result.transmittancePercent).toBe(72);
  });

  it('基准结果忽略旁路状态计算时视为矛盾，只忽略基准', () => {
    const storage = new MemoryStorage();
    const baselineLayers = [RED, { ...ORANGE, bypassed: true }];
    const mismatched: BaselineSnapshot = {
      savedAt: '2026-09-12T01:00:00.000Z',
      layers: baselineLayers,
      // 声称火焰橙被旁路，结果却是两张都参与计算的值。
      result: calculateStack([RED, ORANGE]),
    };
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...makeScheme([YELLOW]), baseline: mismatched }),
    );

    const loaded = loadScheme(storage);
    expect(loaded?.layers).toEqual([YELLOW]);
    expect(loaded?.baseline).toBeUndefined();
  });

  it('基准层缺少旁路属性的旧快照按正常参与校验并恢复', () => {
    const storage = new MemoryStorage();
    const legacyBaseline = {
      savedAt: '2026-09-12T01:00:00.000Z',
      layers: [RED, ORANGE],
      result: calculateStack([RED, ORANGE]),
    };
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...makeScheme([YELLOW]), baseline: legacyBaseline }),
    );

    expect(loadScheme(storage)?.baseline).toEqual(legacyBaseline);
  });
});
