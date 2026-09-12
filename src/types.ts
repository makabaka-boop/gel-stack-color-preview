export interface Gel {
  id: string;
  name: string;
  hex: HexColor;
  transmittance: Transmittance;
}

export type StackLayer = Gel;

export interface StackResult {
  hex: HexColor;
  rgb: RgbValue;
  transmittancePercent: number;
  conclusion: '可用' | '过暗';
}

export interface LabValue {
  l: number;
  a: number;
  b: number;
}

export interface BaselineSnapshot {
  savedAt: string;
  layers: StackLayer[];
  result: StackResult;
}

export interface SchemeComparison {
  colorDifference: number;
  transmittanceDifference: number;
  verdict: '可替代' | '偏差明显';
}

type Brand<T extends string> = string & { readonly __brand: T };

export type HexColor = Brand<'HexColor'>;
export type Transmittance = number & { readonly __brand: 'Transmittance' };
export type RgbValue = [red: number, green: number, blue: number];

export interface StoredScheme {
  version: 1;
  savedAt: string;
  layers: StackLayer[];
  baseline?: BaselineSnapshot;
}

export function asHexColor(value: string): HexColor {
  return value as HexColor;
}

export function asTransmittance(value: number): Transmittance {
  return value as Transmittance;
}
