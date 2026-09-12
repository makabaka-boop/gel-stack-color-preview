import { asHexColor, asTransmittance } from './types';
import type {
  HexColor,
  RgbValue,
  StackLayer,
  StackResult,
  Transmittance,
} from './types';

const HEX_PATTERN = /^#?[0-9a-fA-F]{6}$/;

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
    (product, layer) => product * (parseTransmittance(layer.transmittance) / 100),
    1,
  );
  return roundToSingleDecimal(fraction * 100);
}

export function stackColor(layers: readonly StackLayer[]): {
  hex: HexColor;
  rgb: RgbValue;
} {
  validateLayers(layers);

  const linear = hexToRgb(normalizeHex(layers[0].hex)).map((channel) =>
    srgbToLinear(channel),
  );

  for (const layer of layers.slice(1)) {
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

export function calculateStack(layers: readonly StackLayer[]): StackResult {
  const transmittancePercent = calculateTotalTransmittance(layers);
  const color = stackColor(layers);

  return {
    ...color,
    transmittancePercent,
    conclusion: transmittancePercent >= 20.0 ? '可用' : '过暗',
  };
}
