export interface Gel {
  id: string;
  name: string;
  hex: HexColor;
  transmittance: Transmittance;
}

export interface StackLayer extends Gel {
  /**
   * 临时旁路：该层不参与颜色与透光率计算，但仍占据原叠放位置与顺序，
   * 再次启用后恢复参与；旧记录没有该字段时视为正常参与。
   */
  bypassed?: boolean;
}

export interface StackResult {
  hex: HexColor;
  rgb: RgbValue;
  transmittancePercent: number;
  conclusion: '可用' | '过暗';
}

/**
 * 逐层光路上的单个检查点：从光源起，经过该层（含）之后的累计颜色、
 * 透光率与明暗结论。与色片层一一对应，末个检查点等于总结果。
 * 旁路层仍占据原检查点：participating 为 false，数值继承上一检查点。
 */
export interface LightPathCheckpoint extends StackResult {
  layerId: string;
  layerName: string;
  /** 该层在实际光路中的序号，从 1 开始（1 为最靠近光源的一张）。 */
  layerOrder: number;
  /** 该层本次是否参与计算；旁路层为 false。 */
  participating: boolean;
}

export interface LabValue {
  l: number;
  a: number;
  b: number;
}

export interface BaselineSnapshot {
  savedAt: string;
  layers: StackLayer[];
  /** 设置基准时的入射光源；旧快照没有该字段，按白光处理。 */
  lightSource?: HexColor;
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
  /** 入射光源颜色；旧记录没有该字段，按白光处理。 */
  lightSource?: HexColor;
  baseline?: BaselineSnapshot;
}

export function asHexColor(value: string): HexColor {
  return value as HexColor;
}

export function asTransmittance(value: number): Transmittance {
  return value as Transmittance;
}
