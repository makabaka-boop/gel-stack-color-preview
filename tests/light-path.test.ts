import { describe, expect, it } from 'vitest';
import {
  calculateLightPath,
  calculateStack,
} from '../src/color';
import { asHexColor, asTransmittance } from '../src/types';
import type { StackLayer } from '../src/types';

function layer(
  id: string,
  name: string,
  hex: string,
  transmittance: number,
): StackLayer {
  return {
    id,
    name,
    hex: asHexColor(hex),
    transmittance: asTransmittance(transmittance),
  };
}

const RED = layer('primary-red', '正红 R02', '#D82128', 72);
const ORANGE = layer('fire-orange', '火焰橙 O15', '#F26322', 68);

describe('逐层光路累计契约', () => {
  it('两层固定样例：首层只经过一张色片，末层为总结果', () => {
    const { checkpoints, last } = calculateLightPath([RED, ORANGE]);

    expect(checkpoints).toHaveLength(2);

    // 首层：只经过正红，颜色即色片本身，累计透光率 72%。
    expect(checkpoints[0]).toEqual({
      layerId: 'primary-red',
      layerName: '正红 R02',
      layerOrder: 1,
      participating: true,
      hex: '#D82128',
      rgb: [216, 33, 40],
      transmittancePercent: 72,
      conclusion: '可用',
    });

    // 末层：与现有总结果完全相同。
    expect(last).toBe(checkpoints[1]);
    expect(checkpoints[1]).toEqual({
      layerId: 'fire-orange',
      layerName: '火焰橙 O15',
      layerOrder: 2,
      participating: true,
      hex: '#CD0601',
      rgb: [205, 6, 1],
      transmittancePercent: 49,
      conclusion: '可用',
    });
  });

  it('换序后检查点顺序随实际光路变化，末检查点仍与总结果一致', () => {
    const reversed = calculateLightPath([ORANGE, RED]);

    expect(reversed.checkpoints).toHaveLength(2);

    // 首层变成火焰橙：检查点与色片层一一对应。
    expect(reversed.checkpoints[0]).toMatchObject({
      layerId: 'fire-orange',
      layerName: '火焰橙 O15',
      layerOrder: 1,
      hex: '#F26322',
      rgb: [242, 99, 34],
      transmittancePercent: 68,
    });

    // 线性乘法可交换：换序不改变最终颜色与累计透光率。
    expect(reversed.last.hex).toBe('#CD0601');
    expect(reversed.last.rgb).toEqual([205, 6, 1]);
    expect(reversed.last.transmittancePercent).toBe(49);

    // 最后一个检查点必须与现有总结果（去除层关联字段后）完全相同。
    const total = calculateStack([ORANGE, RED]);
    expect({
      hex: reversed.last.hex,
      rgb: reversed.last.rgb,
      transmittancePercent: reversed.last.transmittancePercent,
      conclusion: reversed.last.conclusion,
    }).toEqual(total);

    // 两种顺序的末检查点结果一致。
    const original = calculateLightPath([RED, ORANGE]);
    expect(original.last.hex).toBe(reversed.last.hex);
    expect(original.last.transmittancePercent).toBe(
      reversed.last.transmittancePercent,
    );
  });

  it('每层都复用线性叠色与透光率规则：颜色随光源、透光率只由色片决定', () => {
    const white = calculateLightPath([RED, ORANGE]);
    const cool = calculateLightPath([RED, ORANGE], asHexColor('#A0C8FF'));

    // 冷色 LED 光源下，首层颜色随之改变，但透光率与明暗结论不变。
    expect(cool.checkpoints[0].hex).toBe('#871728');
    expect(cool.checkpoints[0].rgb).toEqual([135, 23, 40]);
    expect(cool.checkpoints[0].transmittancePercent).toBe(72);
    expect(cool.last.hex).toBe('#800401');
    expect(cool.last.rgb).toEqual([128, 4, 1]);

    expect(cool.checkpoints.map((point) => point.transmittancePercent)).toEqual(
      white.checkpoints.map((point) => point.transmittancePercent),
    );
    expect(
      cool.checkpoints.map((point) => point.conclusion),
    ).toEqual(white.checkpoints.map((point) => point.conclusion));
  });

  it('累计透光率逐层相乘并按 20.0% 判定线给出逐层明暗结论', () => {
    const dark = [
      layer('a', '甲', '#FFFFFF', 60),
      layer('b', '乙', '#FFFFFF', 40),
      layer('c', '丙', '#FFFFFF', 80),
    ];
    const { checkpoints } = calculateLightPath(dark);

    expect(checkpoints.map((point) => point.transmittancePercent)).toEqual([
      60, 24, 19.2,
    ]);
    expect(checkpoints.map((point) => point.conclusion)).toEqual([
      '可用',
      '可用',
      '过暗',
    ]);
    expect(checkpoints.at(-1)?.conclusion).toBe(
      calculateStack(dark).conclusion,
    );
  });

  it('检查点与色片层一一对应且沿用现有一至五层校验', () => {
    const { checkpoints } = calculateLightPath([RED, ORANGE]);
    expect(checkpoints.map((point) => point.layerId)).toEqual([
      'primary-red',
      'fire-orange',
    ]);
    expect(checkpoints.map((point) => point.layerOrder)).toEqual([1, 2]);

    expect(() => calculateLightPath([])).toThrow(/一至五张/);
    expect(() =>
      calculateLightPath(
        Array.from({ length: 6 }, (_, index) =>
          layer(`g${index}`, `色片 ${index}`, '#FFFFFF', 1),
        ),
      ),
    ).toThrow(/一至五张/);
  });
});
