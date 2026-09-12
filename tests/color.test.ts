import { describe, expect, it } from 'vitest';
import {
  calculateStack,
  calculateTotalTransmittance,
  hexToRgb,
  linearToSrgbChannel,
  normalizeHex,
  parseTransmittance,
  rgbToHex,
  srgbToLinear,
  stackColor,
} from '../src/color';
import { asHexColor, asTransmittance } from '../src/types';
import type { StackLayer } from '../src/types';

function layer(
  hex: string,
  transmittance: number,
  name = '测试色片',
): StackLayer {
  return {
    id: `${hex}-${transmittance}-${Math.random()}`,
    name,
    hex: asHexColor(hex),
    transmittance: asTransmittance(transmittance),
  };
}

describe('sRGB 线性化与逆转换', () => {
  it('覆盖 0.04045 的分段边界', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(255)).toBeCloseTo(1, 12);

    const boundaryChannel = 0.04045 * 255;
    const boundaryLinear = srgbToLinear(boundaryChannel);
    expect(boundaryLinear).toBeCloseTo(0.0031308, 8);

    expect(linearToSrgbChannel(0)).toBe(0);
    expect(linearToSrgbChannel(0.0031308)).toBeCloseTo(0.04045, 6);
    expect(linearToSrgbChannel(1)).toBeCloseTo(1, 12);
  });

  it('低分段与高分段都能往返', () => {
    const lowChannel = 10; // 10/255 = 0.0392，小于 0.04045
    expect(
      linearToSrgbChannel(srgbToLinear(lowChannel)) * 255,
    ).toBeCloseTo(lowChannel, 10);

    const highChannel = 128; // 128/255 大于 0.04045
    expect(
      linearToSrgbChannel(srgbToLinear(highChannel)) * 255,
    ).toBeCloseTo(highChannel, 10);
  });
});

describe('颜色格式', () => {
  it('接受不带井号的六位颜色并规范化为大写带井号形式', () => {
    expect(normalizeHex('a1b2c3')).toBe('#A1B2C3');
    expect(hexToRgb(normalizeHex('#a1b2c3'))).toEqual([161, 178, 195]);
    expect(rgbToHex([161, 178, 195])).toBe('#A1B2C3');
  });

  it.each(['#12ABG1', '#FFF', '12345', '1234567', '#', 'red', ''])(
    '拒绝非法六位颜色：%s',
    (value) => {
      expect(() => normalizeHex(value)).toThrow(/合法六位十六进制颜色/);
    },
  );

  it.each([0, -1, 101, 50.5, Number.NaN, Number.POSITIVE_INFINITY])(
    '拒绝越界或非整数透光率：%s',
    (value) => {
      expect(() => parseTransmittance(value)).toThrow(/1% 至 100%/);
    },
  );

  it('接受 1% 与 100% 两个整数边界', () => {
    expect(parseTransmittance(1)).toBe(1);
    expect(parseTransmittance(100)).toBe(100);
  });
});

describe('多层颜色计算', () => {
  it('单层白色保持白色，黑色保持黑色', () => {
    expect(stackColor([layer('#FFFFFF', 1)]).hex).toBe('#FFFFFF');
    expect(stackColor([layer('#000000', 100)]).hex).toBe('#000000');
  });

  it('单层中灰经线性化逆转换后回到原值', () => {
    expect(stackColor([layer('#808080', 40)]).hex).toBe('#808080');
  });

  it('两张相同中灰在线性空间相乘后按整数 sRGB 输出', () => {
    expect(stackColor([layer('#808080', 100), layer('#808080', 100)])).toEqual({
      hex: '#3D3D3D',
      rgb: [61, 61, 61],
    });
  });

  it('按给定逆公式输出红、绿、蓝三个四舍五入通道', () => {
    const result = stackColor([layer('#D82128', 100), layer('#F26322', 100)]);
    expect(result.rgb).toEqual([205, 6, 1]);
    expect(result.hex).toBe('#CD0601');
  });

  it('只允许一至五张色片', () => {
    expect(() => stackColor([])).toThrow(/一至五张/);
    expect(() =>
      stackColor(Array.from({ length: 6 }, () => layer('#FFFFFF', 1))),
    ).toThrow(/一至五张/);
  });
});

describe('透光率与明暗结论', () => {
  it('逐张百分比相乘并四舍五入到 0.1%', () => {
    expect(
      calculateTotalTransmittance([layer('#FFFFFF', 50), layer('#FFFFFF', 50)]),
    ).toBe(25);
    expect(
      calculateTotalTransmittance([
        layer('#FFFFFF', 60),
        layer('#FFFFFF', 40),
        layer('#FFFFFF', 80),
      ]),
    ).toBe(19.2);
  });

  it('四舍五入后不低于 20.0% 判为可用，否则过暗', () => {
    const usable = calculateStack([
      layer('#FFFFFF', 50),
      layer('#FFFFFF', 40),
    ]);
    expect(usable.transmittancePercent).toBe(20);
    expect(usable.conclusion).toBe('可用');

    const roundedToThreshold = calculateStack([
      layer('#FFFFFF', 21),
      layer('#FFFFFF', 95),
    ]);
    expect(roundedToThreshold.transmittancePercent).toBe(20);
    expect(roundedToThreshold.conclusion).toBe('可用');

    const tooDark = calculateStack([
      layer('#FFFFFF', 60),
      layer('#FFFFFF', 40),
      layer('#FFFFFF', 80),
    ]);
    expect(tooDark.transmittancePercent).toBe(19.2);
    expect(tooDark.conclusion).toBe('过暗');
  });

  it('五张 100% 透光率相乘仍为 100.0%', () => {
    expect(
      calculateStack(Array.from({ length: 5 }, () => layer('#FFFFFF', 100)))
        .transmittancePercent,
    ).toBe(100);
  });
});
