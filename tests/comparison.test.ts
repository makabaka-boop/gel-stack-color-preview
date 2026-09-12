import { describe, expect, it } from 'vitest';
import {
  COLOR_DIFFERENCE_LIMIT,
  compareWithBaseline,
  deltaE76,
  hexToLab,
  hexToRgb,
  TRANSMITTANCE_DIFFERENCE_LIMIT,
} from '../src/color';
import { asHexColor } from '../src/types';
import type { StackResult } from '../src/types';

function resultOf(hex: string, transmittancePercent: number): StackResult {
  const normalized = asHexColor(hex);
  return {
    hex: normalized,
    rgb: hexToRgb(normalized),
    transmittancePercent,
    conclusion: '可用',
  };
}

describe('sRGB 转 CIE Lab', () => {
  it('固定颜色锚点：白、黑、纯红、定制蓝', () => {
    const white = hexToLab(asHexColor('#FFFFFF'));
    expect(white.l).toBeCloseTo(100, 4);
    expect(white.a).toBeCloseTo(0, 4);
    expect(white.b).toBeCloseTo(0, 4);

    const black = hexToLab(asHexColor('#000000'));
    expect(black.l).toBeCloseTo(0, 4);
    expect(black.a).toBeCloseTo(0, 4);
    expect(black.b).toBeCloseTo(0, 4);

    const red = hexToLab(asHexColor('#FF0000'));
    expect(red.l).toBeCloseTo(53.2408, 3);
    expect(red.a).toBeCloseTo(80.0925, 3);
    expect(red.b).toBeCloseTo(67.2032, 3);

    const blue = hexToLab(asHexColor('#2A66B1'));
    expect(blue.l).toBeCloseTo(43.0149, 3);
    expect(blue.a).toBeCloseTo(7.3949, 3);
    expect(blue.b).toBeCloseTo(-45.4489, 3);
  });

  it('同一颜色 Delta E 76 为 0，中灰对为纯明度差', () => {
    expect(
      deltaE76(hexToLab(asHexColor('#D82128')), hexToLab(asHexColor('#D82128'))),
    ).toBe(0);

    const distance = deltaE76(
      hexToLab(asHexColor('#808080')),
      hexToLab(asHexColor('#949494')),
    );
    expect(distance).toBeCloseTo(7.7346, 3);
  });
});

describe('替代判定阈值', () => {
  it('颜色差不超过 8 判为可替代，超过则偏差明显', () => {
    const below = compareWithBaseline(
      resultOf('#808080', 50),
      resultOf('#949494', 50),
    );
    expect(below.colorDifference).toBeLessThan(COLOR_DIFFERENCE_LIMIT);
    expect(below.verdict).toBe('可替代');

    const above = compareWithBaseline(
      resultOf('#808080', 50),
      resultOf('#959595', 50),
    );
    expect(above.colorDifference).toBeGreaterThan(COLOR_DIFFERENCE_LIMIT);
    expect(above.verdict).toBe('偏差明显');
  });

  it('亮度差取综合透光率绝对百分点，5.0 以内可替代', () => {
    const atLimit = compareWithBaseline(
      resultOf('#FFFFFF', 50),
      resultOf('#FFFFFF', 55),
    );
    expect(atLimit.transmittanceDifference).toBeCloseTo(
      TRANSMITTANCE_DIFFERENCE_LIMIT,
      6,
    );
    expect(atLimit.verdict).toBe('可替代');

    const overLimit = compareWithBaseline(
      resultOf('#FFFFFF', 50),
      resultOf('#FFFFFF', 55.1),
    );
    expect(overLimit.transmittanceDifference).toBeGreaterThan(
      TRANSMITTANCE_DIFFERENCE_LIMIT,
    );
    expect(overLimit.verdict).toBe('偏差明显');
  });

  it('两项差值各自独立判定，任一超限即偏差明显', () => {
    const same = compareWithBaseline(
      resultOf('#D82128', 49),
      resultOf('#D82128', 49),
    );
    expect(same.colorDifference).toBe(0);
    expect(same.transmittanceDifference).toBe(0);
    expect(same.verdict).toBe('可替代');

    const onlyColorOver = compareWithBaseline(
      resultOf('#808080', 50),
      resultOf('#959595', 50),
    );
    expect(onlyColorOver.transmittanceDifference).toBe(0);
    expect(onlyColorOver.verdict).toBe('偏差明显');

    const onlyTransmittanceOver = compareWithBaseline(
      resultOf('#D82128', 40),
      resultOf('#D82128', 46),
    );
    expect(onlyTransmittanceOver.colorDifference).toBe(0);
    expect(onlyTransmittanceOver.verdict).toBe('偏差明显');
  });
});
