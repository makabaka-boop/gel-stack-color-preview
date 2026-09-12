import type { Gel } from './types';
import { asHexColor, asTransmittance } from './types';

function gel(
  id: string,
  name: string,
  hex: string,
  transmittance: number,
): Gel {
  return {
    id,
    name,
    hex: asHexColor(hex),
    transmittance: asTransmittance(transmittance),
  };
}

export const CATALOG: readonly Gel[] = [
  gel('primary-red', '正红 R02', '#D82128', 72),
  gel('fire-orange', '火焰橙 O15', '#F26322', 68),
  gel('deep-yellow', '深黄 Y23', '#F5D020', 84),
  gel('leaf-green', '叶绿 G38', '#1F9D4D', 56),
  gel('ocean-blue', '海蓝 B46', '#1377BE', 52),
  gel('royal-violet', '皇紫 V58', '#603E96', 42),
  gel('rose-magenta', '玫瑰品红 M67', '#C13B8F', 48),
  gel('cyan', '青蓝 C72', '#12A8B5', 61),
  gel('warm-pink', '暖粉 P81', '#F081A5', 76),
  gel('pale-amber', '浅琥珀 A90', '#F8C56A', 91),
];
