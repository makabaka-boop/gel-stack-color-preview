import { expect, test, type Page } from '@playwright/test';

const STORAGE_KEY = 'stage-gel-precheck:latest-scheme:v1';

async function addGel(page: Page, name: string) {
  await page
    .getByTestId('catalog-item')
    .filter({ hasText: name })
    .getByRole('button', { name: '加入' })
    .click();
}

async function storedScheme(page: Page) {
  const raw = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    STORAGE_KEY,
  );
  return raw ? JSON.parse(raw) : null;
}

test('有色光源参与计算并随方案保存，刷新后恢复', async ({ page }) => {
  await page.goto('/');

  // 默认白光，行为与旧版一致
  await expect(page.getByTestId('light-input')).toHaveValue('#FFFFFF');
  await addGel(page, '正红 R02');
  await addGel(page, '火焰橙 O15');
  await expect(page.getByTestId('final-hex')).toHaveText('#CD0601');

  // 切换冷色 LED 光源：最终色块按新光源重算
  await page.getByTestId('light-input').fill('#A0C8FF');
  await expect(page.getByTestId('final-hex')).toHaveText('#800401');
  await expect(page.getByTestId('final-rgb')).toHaveText('R 128 / G 4 / B 1');
  // 透光率与明暗结论只由色片决定，不随光源变化
  await expect(page.getByTestId('final-transmittance')).toHaveText('49.0%');
  await expect(page.getByTestId('final-conclusion')).toHaveText('可用');
  await expect(page.getByTestId('light-source-hex')).toHaveText('#A0C8FF');

  // 光源随最近有效方案写入 localStorage
  await expect
    .poll(async () => (await storedScheme(page))?.lightSource)
    .toBe('#A0C8FF');

  // 刷新后恢复自定义光源与对应结果
  await page.reload();
  await expect(page.getByTestId('light-input')).toHaveValue('#A0C8FF');
  await expect(page.getByTestId('light-swatch')).toHaveCSS(
    'background-color',
    'rgb(160, 200, 255)',
  );
  await expect(page.getByTestId('stack-layer')).toHaveCount(2);
  await expect(page.getByTestId('final-hex')).toHaveText('#800401');
  await expect(page.getByTestId('final-transmittance')).toHaveText('49.0%');
});

test('仅改变光源即可更新两项差值与替代结论', async ({ page }) => {
  await page.goto('/');
  await addGel(page, '正红 R02');
  await addGel(page, '火焰橙 O15');
  await expect(page.getByTestId('final-hex')).toHaveText('#CD0601');

  // 白光下建立基准：两项差值为零
  await page.getByTestId('set-baseline').click();
  await expect(page.getByTestId('baseline-swatch')).toBeVisible();
  await expect(page.getByTestId('color-difference')).toHaveText('0.0');
  await expect(page.getByTestId('transmittance-difference')).toHaveText(
    '0.0 个百分点',
  );
  await expect(page.getByTestId('comparison-verdict')).toHaveText('可替代');

  // 只把光源换成冷色 LED：当前色块、两项差值与替代结论随之更新
  await page.getByTestId('light-input').fill('#A0C8FF');
  await expect(page.getByTestId('final-hex')).toHaveText('#800401');
  await expect(page.getByTestId('baseline-swatch')).toHaveCSS(
    'background-color',
    'rgb(205, 6, 1)',
  );
  await expect(page.getByTestId('color-difference')).toHaveText('32.4');
  await expect(page.getByTestId('transmittance-difference')).toHaveText(
    '0.0 个百分点',
  );
  await expect(page.getByTestId('comparison-verdict')).toHaveText('偏差明显');

  // 基准快照记录当时的白光，当前方案记录有色光源
  await expect
    .poll(async () => {
      const scheme = await storedScheme(page);
      return (
        scheme?.lightSource === '#A0C8FF' &&
        scheme?.baseline?.lightSource === '#FFFFFF'
      );
    })
    .toBe(true);

  // 刷新后自定义光源及其基准对比一并恢复
  await page.reload();
  await expect(page.getByTestId('light-input')).toHaveValue('#A0C8FF');
  await expect(page.getByTestId('final-hex')).toHaveText('#800401');
  await expect(page.getByTestId('baseline-swatch')).toHaveCSS(
    'background-color',
    'rgb(205, 6, 1)',
  );
  await expect(page.getByTestId('color-difference')).toHaveText('32.4');
  await expect(page.getByTestId('transmittance-difference')).toHaveText(
    '0.0 个百分点',
  );
  await expect(page.getByTestId('comparison-verdict')).toHaveText('偏差明显');
});

test('非法光源只提示格式问题，结果不跳变，刷新仍恢复最后有效方案', async ({
  page,
}) => {
  await page.goto('/');
  await addGel(page, '正红 R02');
  await addGel(page, '火焰橙 O15');
  await page.getByTestId('light-input').fill('#A0C8FF');
  await expect(page.getByTestId('final-hex')).toHaveText('#800401');
  await expect
    .poll(async () => (await storedScheme(page))?.lightSource)
    .toBe('#A0C8FF');

  // 输入非法光源：输入处说明格式问题，计算与本地记录沿用上一次有效颜色
  await page.getByTestId('light-input').fill('#GG00FF');
  await expect(page.getByTestId('light-error')).toContainText(
    '不是合法六位十六进制颜色',
  );
  await expect(page.getByTestId('final-hex')).toHaveText('#800401');
  await expect(page.getByTestId('final-transmittance')).toHaveText('49.0%');
  await expect(page.getByTestId('light-source-hex')).toHaveText('#A0C8FF');
  expect((await storedScheme(page))?.lightSource).toBe('#A0C8FF');

  // 错误期间刷新，仍恢复最后有效方案，且不残留错误提示
  await page.reload();
  await expect(page.getByTestId('light-input')).toHaveValue('#A0C8FF');
  await expect(page.getByTestId('light-error')).toHaveCount(0);
  await expect(page.getByTestId('final-hex')).toHaveText('#800401');

  // 恢复白光：立即重算并保存
  await page.getByTestId('reset-light').click();
  await expect(page.getByTestId('light-input')).toHaveValue('#FFFFFF');
  await expect(page.getByTestId('final-hex')).toHaveText('#CD0601');
  await expect(page.getByTestId('final-transmittance')).toHaveText('49.0%');
  await expect
    .poll(async () => (await storedScheme(page))?.lightSource)
    .toBe('#FFFFFF');

  await page.reload();
  await expect(page.getByTestId('light-input')).toHaveValue('#FFFFFF');
  await expect(page.getByTestId('final-hex')).toHaveText('#CD0601');
});

test('旧记录没有光源字段时按白光恢复', async ({ page }) => {
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
      }),
    ],
  );

  await page.goto('/');
  await expect(page.getByTestId('light-input')).toHaveValue('#FFFFFF');
  await expect(page.getByTestId('final-hex')).toHaveText('#D82128');
  await expect(page.getByTestId('light-source-hex')).toHaveText('#FFFFFF');
});
