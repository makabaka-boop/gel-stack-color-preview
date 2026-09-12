import { expect, test } from '@playwright/test';

const STORAGE_KEY = 'stage-gel-precheck:latest-scheme:v1';

test('建立基准后替换一层得到可替代结论，刷新后恢复对比', async ({ page }) => {
  await page.goto('/');

  await page
    .getByTestId('catalog-item')
    .filter({ hasText: '正红 R02' })
    .getByRole('button', { name: '加入' })
    .click();
  await page
    .getByTestId('catalog-item')
    .filter({ hasText: '火焰橙 O15' })
    .getByRole('button', { name: '加入' })
    .click();
  await expect(page.getByTestId('final-hex')).toHaveText('#CD0601');

  // 建立基准：基准与当前一致，两项差值为零
  await page.getByTestId('set-baseline').click();
  await expect(page.getByTestId('baseline-swatch')).toBeVisible();
  await expect(page.getByTestId('baseline-swatch')).toHaveCSS(
    'background-color',
    'rgb(205, 6, 1)',
  );
  await expect(page.getByTestId('comparison-verdict')).toHaveText('可替代');
  await expect(page.getByTestId('color-difference')).toHaveText('0.0');
  await expect(page.getByTestId('transmittance-difference')).toHaveText(
    '0.0 个百分点',
  );

  // 基准快照随最近有效方案写入 localStorage
  await expect
    .poll(async () =>
      page.evaluate((key) => {
        const raw = window.localStorage.getItem(key);
        return raw !== null && raw.includes('"baseline"');
      }, STORAGE_KEY),
    )
    .toBe(true);

  // 替换一层：移除火焰橙，录入颜色相近的自定义色片
  await page.getByRole('button', { name: '移除 火焰橙 O15' }).click();
  await page.getByTestId('custom-name').fill('替代橙');
  await page.getByTestId('custom-hex').fill('#E85A20');
  await page.getByTestId('custom-transmittance').fill('68');
  await page.getByRole('button', { name: '加入目录', exact: true }).click();
  await page
    .getByTestId('catalog-item')
    .filter({ hasText: '替代橙' })
    .getByRole('button', { name: '加入' })
    .click();

  await expect(page.getByTestId('stack-layer')).toHaveCount(2);
  await expect(page.getByTestId('final-hex')).toHaveText('#C40501');
  await expect(page.getByTestId('comparison-verdict')).toHaveText('可替代');
  await expect(page.getByTestId('color-difference')).toHaveText('3.5');
  await expect(page.getByTestId('transmittance-difference')).toHaveText(
    '0.0 个百分点',
  );
  // 基准色块保持原方案颜色
  await expect(page.getByTestId('baseline-swatch')).toHaveCSS(
    'background-color',
    'rgb(205, 6, 1)',
  );

  // 刷新后基准与对比结果一并恢复
  await page.reload();
  await expect(page.getByTestId('stack-layer')).toHaveCount(2);
  await expect(page.getByTestId('stack-layer').nth(1)).toContainText('替代橙');
  await expect(page.getByTestId('baseline-swatch')).toBeVisible();
  await expect(page.getByTestId('comparison-verdict')).toHaveText('可替代');
  await expect(page.getByTestId('color-difference')).toHaveText('3.5');
});

test('层内容与结果矛盾的基准快照不会恢复对比展示', async ({ page }) => {
  const layer = {
    id: 'primary-red',
    name: '正红 R02',
    hex: '#D82128',
    transmittance: 72,
  };
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        savedAt: '2026-09-12T00:00:00.000Z',
        layers: [layer],
        baseline: {
          savedAt: '2026-09-12T01:00:00.000Z',
          layers: [layer],
          result: {
            hex: '#00FF00',
            rgb: [0, 255, 0],
            transmittancePercent: 72,
            conclusion: '可用',
          },
        },
      }),
    ],
  );

  await page.goto('/');
  await expect(page.getByTestId('stack-layer')).toHaveCount(1);
  await expect(page.getByTestId('baseline-swatch')).toHaveCount(0);
  await expect(page.getByTestId('color-difference')).toHaveCount(0);
  await expect(page.getByTestId('transmittance-difference')).toHaveCount(0);
  await expect(page.getByTestId('comparison-verdict')).toHaveCount(0);
  await expect(page.getByTestId('clear-baseline')).toHaveCount(0);
  await expect(page.getByTestId('final-hex')).toHaveText('#D82128');
});

test('空方案不能设为基准，清除基准后回到单方案流程', async ({ page }) => {
  await page.goto('/');

  // 空预检台直接设为基准：明确提示且不产生基准
  await page.getByTestId('set-baseline').click();
  await expect(page.getByTestId('notice')).toContainText('无法设为基准');
  await expect(page.getByTestId('baseline-swatch')).toHaveCount(0);
  await expect(page.getByTestId('empty-result')).toBeVisible();

  // 建立有效基准
  await page
    .getByTestId('catalog-item')
    .filter({ hasText: '正红 R02' })
    .getByRole('button', { name: '加入' })
    .click();
  await page.getByTestId('set-baseline').click();
  await expect(page.getByTestId('baseline-swatch')).toBeVisible();
  await expect(page.getByTestId('comparison-verdict')).toHaveText('可替代');

  // 清空后再次设为基准：提示且不改写已有基准
  await page.getByRole('button', { name: '清空' }).click();
  await expect(page.getByTestId('stack-layer')).toHaveCount(0);
  await page.getByTestId('set-baseline').click();
  await expect(page.getByTestId('notice')).toContainText('无法设为基准');
  await expect(page.getByTestId('baseline-swatch')).toBeVisible();
  await expect(page.getByTestId('baseline-swatch')).toHaveCSS(
    'background-color',
    'rgb(216, 33, 40)',
  );

  // 刷新后基准与原方案一起恢复，未被空方案改写
  await page.reload();
  await expect(page.getByTestId('stack-layer')).toHaveCount(1);
  await expect(page.getByTestId('baseline-swatch')).toBeVisible();
  await expect(page.getByTestId('comparison-verdict')).toHaveText('可替代');

  // 清除基准，回到单方案展示
  await page.getByTestId('clear-baseline').click();
  await expect(page.getByTestId('baseline-swatch')).toHaveCount(0);
  await expect(page.getByTestId('comparison-verdict')).toHaveCount(0);
  await expect(page.getByTestId('clear-baseline')).toHaveCount(0);
  await expect(page.getByTestId('final-swatch')).toBeVisible();
  await expect(page.getByTestId('final-hex')).toHaveText('#D82128');
  await expect
    .poll(async () =>
      page.evaluate((key) => {
        const raw = window.localStorage.getItem(key);
        return raw !== null && !raw.includes('"baseline"');
      }, STORAGE_KEY),
    )
    .toBe(true);

  // 刷新后仍是单方案流程
  await page.reload();
  await expect(page.getByTestId('baseline-swatch')).toHaveCount(0);
  await expect(page.getByTestId('final-swatch')).toBeVisible();
  await expect(page.getByTestId('final-hex')).toHaveText('#D82128');
});
