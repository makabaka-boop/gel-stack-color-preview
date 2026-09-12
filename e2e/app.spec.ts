import { expect, test, type Locator, type Page } from '@playwright/test';

async function dragTo(
  page: Page,
  source: Locator,
  target: Locator,
  targetVerticalRatio = 0.5,
) {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  const startX = sourceBox!.x + sourceBox!.width / 2;
  const startY = sourceBox!.y + sourceBox!.height / 2;
  const endX = targetBox!.x + targetBox!.width / 2;
  const endY = targetBox!.y + targetBox!.height * targetVerticalRatio;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();
}

test('拖拽叠放、调整顺序，并在刷新后恢复最近一次有效方案', async ({ page }) => {
  await page.goto('/');

  const stage = page.getByTestId('stage');
  await expect(page.getByTestId('empty-result')).toBeVisible();

  await dragTo(
    page,
    page.getByTestId('catalog-item').filter({ hasText: '正红 R02' }),
    stage,
  );
  await dragTo(
    page,
    page.getByTestId('catalog-item').filter({ hasText: '火焰橙 O15' }),
    stage,
    0.42,
  );

  let layerNames = page.getByTestId('stack-layer');
  await expect(layerNames).toHaveCount(2);
  await expect(layerNames.first()).toContainText('正红 R02');
  await expect(layerNames.nth(1)).toContainText('火焰橙 O15');
  await expect(page.getByTestId('final-hex')).toHaveText('#CD0601');
  await expect(page.getByTestId('final-rgb')).toHaveText('R 205 / G 6 / B 1');
  await expect(page.getByTestId('final-transmittance')).toHaveText('49.0%');
  await expect(page.getByTestId('final-conclusion')).toHaveText('可用');

  await dragTo(page, layerNames.first(), stage, 0.5);
  layerNames = page.getByTestId('stack-layer');
  await expect(layerNames.first()).toContainText('火焰橙 O15');
  await expect(layerNames.nth(1)).toContainText('正红 R02');

  await page.reload();
  await expect(page).toHaveURL('/');

  const restoredLayers = page.getByTestId('stack-layer');
  await expect(restoredLayers).toHaveCount(2);
  await expect(restoredLayers.first()).toContainText('火焰橙 O15');
  await expect(restoredLayers.nth(1)).toContainText('正红 R02');
  await expect(page.getByTestId('final-hex')).toHaveText('#CD0601');
  await expect(page.getByTestId('final-transmittance')).toHaveText('49.0%');
});

test('非法六位颜色明确报错且不覆盖 localStorage 中有效方案', async ({
  page,
}) => {
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

  const storageKey = 'stage-gel-precheck:latest-scheme:v1';
  await expect
    .poll(async () => {
      const value = await page.evaluate((key) => window.localStorage.getItem(key), storageKey);
      return value !== null && value.includes('火焰橙 O15') && value.includes('#F26322');
    })
    .toBe(true);
  const validScheme = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    storageKey,
  );

  await page.getByTestId('custom-name').fill('错误测试');
  await page.getByTestId('custom-hex').fill('#GG1234');
  await page.getByTestId('custom-transmittance').fill('60');
  await page.getByRole('button', { name: '加入目录', exact: true }).click();

  await expect(page.getByTestId('form-error')).toContainText(
    '不是合法六位十六进制颜色',
  );
  await expect(page.getByTestId('stack-layer')).toHaveCount(2);
  await expect(
    page.evaluate((key) => window.localStorage.getItem(key), storageKey),
  ).resolves.toBe(validScheme);

  await page.reload();
  await expect(page.getByTestId('stack-layer')).toHaveCount(2);
  await expect(page.getByTestId('stack-layer').first()).toContainText('正红 R02');
  await expect(page.getByTestId('form-error')).toHaveCount(0);
});

test('最多叠放五张，五张低透光率色片给出过暗结论', async ({ page }) => {
  await page.goto('/');
  const gelNames = [
    '皇紫 V58',
    '海蓝 B46',
    '叶绿 G38',
    '玫瑰品红 M67',
    '青蓝 C72',
  ];

  for (const gelName of gelNames) {
    await page
      .getByTestId('catalog-item')
      .filter({ hasText: gelName })
      .getByRole('button', { name: '加入' })
      .click();
  }

  await expect(page.getByTestId('stack-layer')).toHaveCount(5);
  await expect(page.getByTestId('final-transmittance')).toHaveText('3.6%');
  await expect(page.getByTestId('final-conclusion')).toHaveText('过暗');

  await page
    .getByTestId('catalog-item')
    .filter({ hasText: '正红 R02' })
    .getByRole('button', { name: '加入' })
    .click();

  await expect(page.getByTestId('stack-layer')).toHaveCount(5);
  await expect(page.getByTestId('notice')).toContainText('最多只能叠放五张');
});
