import { asHexColor, asTransmittance } from './types';
import type {
  HexColor,
  LabValue,
  LightPathCheckpoint,
  RgbValue,
  SchemeComparison,
  StackLayer,
  StackResult,
  Transmittance,
} from './types';

const HEX_PATTERN = /^#?[0-9a-fA-F]{6}$/;

export const DEFAULT_LIGHT_SOURCE = asHexColor('#FFFFFF');

export function normalizeHex(value: string): HexColor {
  const normalized = value.trim();
  if (!HEX_PATTERN.test(normalized)) {
    throw new Error(`“${value}”不是合法六位十六进制颜色，请输入形如 #2A66B1 的颜色。`);
  }

  return asHexColor(`#${normalized.replace(/^#/, '').toUpperCase()}`);
}

export function parseTransmittance(value: number): Transmittance {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error('透光率必须是 1% 至 100% 之间的整数。');
  }
  return asTransmittance(value);
}

export function hexToRgb(hex: HexColor): RgbValue {
  const digits = normalizeHex(hex).slice(1);
  return [
    Number.parseInt(digits.slice(0, 2), 16),
    Number.parseInt(digits.slice(2, 4), 16),
    Number.parseInt(digits.slice(4, 6), 16),
  ];
}

export function rgbToHex(rgb: RgbValue): HexColor {
  return asHexColor(
    `#${rgb
      .map((channel) => channel.toString(16).padStart(2, '0').toUpperCase())
      .join('')}`,
  );
}

export function srgbToLinear(channel: number): number {
  const value = channel / 255;
  if (value <= 0.04045) {
    return value / 12.92;
  }
  return ((value + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgbChannel(linear: number): number {
  const clipped = Math.min(1, Math.max(0, linear));
  if (clipped <= 0.0031308) {
    return clipped * 12.92;
  }
  return 1.055 * clipped ** (1 / 2.4) - 0.055;
}

function validateLayers(layers: readonly StackLayer[]): void {
  if (layers.length < 1 || layers.length > 5) {
    throw new Error('叠放方案必须包含一至五张色片。');
  }

  layers.forEach((layer) => {
    normalizeHex(layer.hex);
    parseTransmittance(layer.transmittance);
  });
}

function roundToSingleDecimal(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

export function calculateTotalTransmittance(
  layers: readonly StackLayer[],
): number {
  validateLayers(layers);
  const fraction = layers.reduce(
    (product, layer) =>
      layer.bypassed
        ? product
        : product * (parseTransmittance(layer.transmittance) / 100),
    1,
  );
  return roundToSingleDecimal(fraction * 100);
}

export function stackColor(
  layers: readonly StackLayer[],
  lightSource: HexColor = DEFAULT_LIGHT_SOURCE,
): {
  hex: HexColor;
  rgb: RgbValue;
} {
  validateLayers(layers);

  // 光源按同一 sRGB 分段公式线性化，作为叠色链的起点。
  const linear = hexToRgb(normalizeHex(lightSource)).map((channel) =>
    srgbToLinear(channel),
  );

  for (const layer of layers) {
    if (layer.bypassed) continue;
    const rgb = hexToRgb(normalizeHex(layer.hex));
    for (let channel = 0; channel < 3; channel += 1) {
      linear[channel] *= srgbToLinear(rgb[channel]);
    }
  }

  const rgb = linear.map((value) =>
    Math.round(linearToSrgbChannel(value) * 255),
  ) as RgbValue;

  return { hex: rgbToHex(rgb), rgb };
}

export function calculateStack(
  layers: readonly StackLayer[],
  lightSource: HexColor = DEFAULT_LIGHT_SOURCE,
): StackResult {
  // 总结果直接取逐层光路的最后一个检查点，保证两处展示永远一致。
  const last = calculateLightPath(layers, lightSource).last;
  return {
    hex: last.hex,
    rgb: last.rgb,
    transmittancePercent: last.transmittancePercent,
    conclusion: last.conclusion,
  };
}

/**
 * 从当前光源开始，每经过一张色片生成一个检查点：累计色块、RGB、
 * 累计透光率和明暗结论。检查点顺序与实际光路（光源侧 → 输出侧）一致，
 * 复用与 {@link calculateStack} 完全相同的线性叠色与透光率规则；
 * 最后一个检查点即总结果。返回与色片层一一对应的数组。
 * 旁路层不参与乘法：其检查点标明未参与，颜色、透光率与结论继承上一
 * 检查点（首张旁路时即光源本身与 100.0%）；全部旁路时总结果即光源
 * 颜色与 100.0% 透光率。
 */
export function calculateLightPath(
  layers: readonly StackLayer[],
  lightSource: HexColor = DEFAULT_LIGHT_SOURCE,
): { checkpoints: LightPathCheckpoint[]; last: LightPathCheckpoint } {
  validateLayers(layers);

  // 光源按同一 sRGB 分段公式线性化，作为叠色链的起点。
  const linear = hexToRgb(normalizeHex(lightSource)).map((channel) =>
    srgbToLinear(channel),
  );

  let transmittanceFraction = 1;
  const checkpoints: LightPathCheckpoint[] = layers.map((layer, index) => {
    const participating = layer.bypassed !== true;
    if (participating) {
      const rgb = hexToRgb(normalizeHex(layer.hex));
      for (let channel = 0; channel < 3; channel += 1) {
        linear[channel] *= srgbToLinear(rgb[channel]);
      }
      transmittanceFraction *= parseTransmittance(layer.transmittance) / 100;
    }

    const transmittancePercent = roundToSingleDecimal(
      transmittanceFraction * 100,
    );
    const stackedRgb = linear.map((value) =>
      Math.round(linearToSrgbChannel(value) * 255),
    ) as RgbValue;

    return {
      layerId: layer.id,
      layerName: layer.name,
      layerOrder: index + 1,
      participating,
      hex: rgbToHex(stackedRgb),
      rgb: stackedRgb,
      transmittancePercent,
      conclusion: transmittancePercent >= 20.0 ? '可用' : '过暗',
    };
  });

  return { checkpoints, last: checkpoints[checkpoints.length - 1] };
}

const D65_WHITE = { x: 0.95047, y: 1, z: 1.08883 } as const;
const LAB_DELTA = 6 / 29;

function labPivot(value: number): number {
  if (value > LAB_DELTA ** 3) {
    return Math.cbrt(value);
  }
  return value / (3 * LAB_DELTA ** 2) + 4 / 29;
}

export function hexToLab(hex: HexColor): LabValue {
  const [r, g, b] = hexToRgb(normalizeHex(hex)).map(srgbToLinear);

  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;

  const fx = labPivot(x / D65_WHITE.x);
  const fy = labPivot(y / D65_WHITE.y);
  const fz = labPivot(z / D65_WHITE.z);

  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

export function deltaE76(first: LabValue, second: LabValue): number {
  return Math.hypot(first.l - second.l, first.a - second.a, first.b - second.b);
}

export const COLOR_DIFFERENCE_LIMIT = 8;
export const TRANSMITTANCE_DIFFERENCE_LIMIT = 5.0;

export function compareWithBaseline(
  baseline: StackResult,
  current: StackResult,
): SchemeComparison {
  const colorDifference = deltaE76(
    hexToLab(baseline.hex),
    hexToLab(current.hex),
  );
  const transmittanceDifference = Math.abs(
    baseline.transmittancePercent - current.transmittancePercent,
  );

  const verdict =
    colorDifference <= COLOR_DIFFERENCE_LIMIT &&
    transmittanceDifference <= TRANSMITTANCE_DIFFERENCE_LIMIT
      ? '可替代'
      : '偏差明显';

  return { colorDifference, transmittanceDifference, verdict };
}
