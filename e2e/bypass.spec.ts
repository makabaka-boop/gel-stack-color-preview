import { expect, test, type Page } from '@playwright/test';

const STORAGE_KEY = 'stage-gel-precheck:latest-scheme:v1';

async function addGel(page: Page, name: string) {
  await page
    .getByTestId('catalog-item')
    .filter({ hasText: name })
    .getByRole('button', { name: '加入' })
    .click();
}

async function storedRaw(page: Page) {
  return page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
}

test('旁路中间层后总结果、逐层明细与基准差异同步更新，刷新恢复并可再启用', async ({
  page,
}) => {
  await page.goto('/');
  await addGel(page, '正红 R02');
  await addGel(page, '火焰橙 O15');
  await addGel(page, '深黄 Y23');
  await expect(page.getByTestId('stack-layer')).toHaveCount(3);
  await expect(page.getByTestId('final-hex')).toHaveText('#C50400');
  await expect(page.getByTestId('final-transmittance')).toHaveText('41.1%');

  // 三张全参与时建立基准：两项差值为零
  await page.getByTestId('set-baseline').click();
  await expect(page.getByTestId('comparison-verdict')).toHaveText('可替代');
  await expect(page.getByTestId('color-difference')).toHaveText('0.0');

  // 旁路中间层：不删除色片、不改变顺序
  await page.getByRole('button', { name: '旁路 火焰橙 O15' }).click();
  await expect(page.getByTestId('stack-layer')).toHaveCount(3);
  await expect(page.getByTestId('stack-layer').nth(1)).toContainText(
    '火焰橙 O15',
  );
  await expect(page.getByTestId('stack-layer').nth(1)).toContainText('已旁路');
  await expect(
    page.getByRole('button', { name: '启用 火焰橙 O15' }),
  ).toBeVisible();

  // 总结果按剩余两层重算
  await expect(page.getByTestId('final-hex')).toHaveText('#CF1901');
  await expect(page.getByTestId('final-rgb')).toHaveText('R 207 / G 25 / B 1');
  await expect(page.getByTestId('final-transmittance')).toHaveText('60.5%');
  await expect(page.getByTestId('final-conclusion')).toHaveText('可用');

  // 基准差异同步更新：基准色块保持三张时的结果
  await expect(page.getByTestId('baseline-swatch')).toHaveCSS(
    'background-color',
    'rgb(197, 4, 0)',
  );
  await expect(page.getByTestId('color-difference')).toHaveText('3.7');
  await expect(page.getByTestId('transmittance-difference')).toHaveText(
    '19.4 个百分点',
  );
  await expect(page.getByTestId('comparison-verdict')).toHaveText('偏差明显');

  // 逐层明细：旁路层仍占据原检查点，标明未参与，数值继承上一检查点
  await page.getByTestId('light-path-toggle').click();
  const checkpoints = page.getByTestId('light-path-checkpoint');
  await expect(checkpoints).toHaveCount(3);

  const first = checkpoints.nth(0);
  await expect(first).toHaveAttribute('data-participating', 'true');
  await expect(first.getByTestId('checkpoint-hex')).toHaveText('#D82128');
  await expect(first.getByTestId('checkpoint-transmittance')).toHaveText(
    '72.0%',
  );

  const middle = checkpoints.nth(1);
  await expect(middle).toHaveAttribute('data-participating', 'false');
  await expect(middle.getByTestId('checkpoint-name')).toHaveText('火焰橙 O15');
  await expect(middle.getByTestId('checkpoint-bypassed')).toHaveText('未参与');
  await expect(middle.getByTestId('checkpoint-hex')).toHaveText('#D82128');
  await expect(middle.getByTestId('checkpoint-rgb')).toHaveText(
    'R 216 / G 33 / B 40',
  );
  await expect(middle.getByTestId('checkpoint-transmittance')).toHaveText(
    '72.0%',
  );

  const last = checkpoints.nth(2);
  await expect(last).toHaveAttribute('data-participating', 'true');
  await expect(last.getByTestId('checkpoint-hex')).toHaveText('#CF1901');
  await expect(last.getByTestId('checkpoint-transmittance')).toHaveText(
    '60.5%',
  );

  // 旁路状态作为可选属性写入最近有效方案
  await expect
    .poll(async () => (await storedRaw(page))?.includes('"bypassed":true'))
    .toBe(true);

  // 刷新后旁路状态、基准对比与检查点一并恢复
  await page.reload();
  await expect(page.getByTestId('stack-layer')).toHaveCount(3);
  await expect(page.getByTestId('stack-layer').nth(1)).toContainText('已旁路');
  await expect(
    page.getByRole('button', { name: '启用 火焰橙 O15' }),
  ).toBeVisible();
  await expect(page.getByTestId('final-hex')).toHaveText('#CF1901');
  await expect(page.getByTestId('final-transmittance')).toHaveText('60.5%');
  await expect(page.getByTestId('color-difference')).toHaveText('3.7');
  await expect(page.getByTestId('comparison-verdict')).toHaveText('偏差明显');

  await page.getByTestId('light-path-toggle').click();
  const restoredMiddle = page.getByTestId('light-path-checkpoint').nth(1);
  await expect(restoredMiddle).toHaveAttribute('data-participating', 'false');
  await expect(
    restoredMiddle.getByTestId('checkpoint-bypassed'),
  ).toHaveText('未参与');
  await expect(restoredMiddle.getByTestId('checkpoint-hex')).toHaveText(
    '#D82128',
  );

  // 再次启用：恢复参与计算，三项结果回到基准
  await page.getByRole('button', { name: '启用 火焰橙 O15' }).click();
  await expect(page.getByTestId('stack-layer').nth(1)).not.toContainText(
    '已旁路',
  );
  await expect(page.getByTestId('final-hex')).toHaveText('#C50400');
  await expect(page.getByTestId('final-transmittance')).toHaveText('41.1%');
  await expect(page.getByTestId('color-difference')).toHaveText('0.0');
  await expect(page.getByTestId('transmittance-difference')).toHaveText(
    '0.0 个百分点',
  );
  await expect(page.getByTestId('comparison-verdict')).toHaveText('可替代');

  const enabledMiddle = page.getByTestId('light-path-checkpoint').nth(1);
  await expect(enabledMiddle).toHaveAttribute('data-participating', 'true');
  await expect(enabledMiddle.getByTestId('checkpoint-hex')).toHaveText(
    '#CD0601',
  );
  await expect(enabledMiddle.getByTestId('checkpoint-conclusion')).toHaveText(
    '可用',
  );

  // 启用后存储中不再保留旁路字段
  await expect
    .poll(async () => (await storedRaw(page))?.includes('bypassed'))
    .toBe(false);
});

test('全部旁路时输出光源颜色与 100.0% 透光率', async ({ page }) => {
  await page.goto('/');
  await addGel(page, '正红 R02');
  await addGel(page, '火焰橙 O15');
  await expect(page.getByTestId('final-hex')).toHaveText('#CD0601');

  await page.getByRole('button', { name: '旁路 正红 R02' }).click();
  await page.getByRole('button', { name: '旁路 火焰橙 O15' }).click();

  // 白光下全部旁路：输出光源本身与 100.0%
  await expect(page.getByTestId('final-hex')).toHaveText('#FFFFFF');
  await expect(page.getByTestId('final-rgb')).toHaveText(
    'R 255 / G 255 / B 255',
  );
  await expect(page.getByTestId('final-transmittance')).toHaveText('100.0%');
  await expect(page.getByTestId('final-conclusion')).toHaveText('可用');

  // 逐层明细中两个检查点均未参与，数值等于光源起点
  await page.getByTestId('light-path-toggle').click();
  const checkpoints = page.getByTestId('light-path-checkpoint');
  await expect(checkpoints).toHaveCount(2);
  for (const checkpoint of await checkpoints.all()) {
    await expect(checkpoint).toHaveAttribute('data-participating', 'false');
    await expect(checkpoint.getByTestId('checkpoint-bypassed')).toHaveText(
      '未参与',
    );
    await expect(checkpoint.getByTestId('checkpoint-hex')).toHaveText(
      '#FFFFFF',
    );
    await expect(checkpoint.getByTestId('checkpoint-transmittance')).toHaveText(
      '100.0%',
    );
  }

  // 切换有色光源：全部旁路时输出该光源颜色
  await page.getByTestId('light-input').fill('#A0C8FF');
  await expect(page.getByTestId('final-hex')).toHaveText('#A0C8FF');
  await expect(page.getByTestId('final-transmittance')).toHaveText('100.0%');
  await expect(
    page.getByTestId('light-path-checkpoint').first().getByTestId('checkpoint-hex'),
  ).toHaveText('#A0C8FF');

  // 启用其中一层后立即恢复参与计算
  await page.getByRole('button', { name: '启用 正红 R02' }).click();
  await expect(page.getByTestId('final-hex')).toHaveText('#871728');
  await expect(page.getByTestId('final-transmittance')).toHaveText('72.0%');
});

test('非法光源期间可切换旁路更新预览，但不覆盖最近有效方案并提示未保存', async ({
  page,
}) => {
  await page.goto('/');
  await addGel(page, '正红 R02');
  await addGel(page, '火焰橙 O15');
  await page.getByTestId('light-input').fill('#A0C8FF');
  await expect(page.getByTestId('final-hex')).toHaveText('#800401');
  await expect
    .poll(async () => (await storedRaw(page))?.includes('#A0C8FF'))
    .toBe(true);
  const validScheme = await storedRaw(page);

  // 输入非法光源：提示本次状态尚未保存
  await page.getByTestId('light-input').fill('#GG00FF');
  await expect(page.getByTestId('light-error')).toContainText(
    '不是合法六位十六进制颜色',
  );
  await expect(page.getByTestId('notice')).toContainText(
    '尚未写入最近一次有效方案',
  );

  // 期间切换旁路：预览照常更新
  await page.getByRole('button', { name: '旁路 正红 R02' }).click();
  await expect(page.getByTestId('final-hex')).toHaveText('#984C22');
  await expect(page.getByTestId('final-rgb')).toHaveText('R 152 / G 76 / B 34');
  await expect(page.getByTestId('final-transmittance')).toHaveText('68.0%');
  await expect(page.getByTestId('notice')).toContainText(
    '尚未写入最近一次有效方案',
  );

  // 但最近有效方案不被覆盖
  expect(await storedRaw(page)).toBe(validScheme);

  // 恢复合法光源：立即保存当前状态，未保存提示消失
  await page.getByTestId('light-input').fill('#A0C8FF');
  await expect(page.getByTestId('light-error')).toHaveCount(0);
  await expect(page.getByTestId('notice')).toHaveCount(0);
  await expect
    .poll(async () => (await storedRaw(page))?.includes('"bypassed":true'))
    .toBe(true);

  // 刷新后按新状态恢复
  await page.reload();
  await expect(page.getByTestId('stack-layer').first()).toContainText('已旁路');
  await expect(page.getByTestId('final-hex')).toHaveText('#984C22');
});

test('旧方案缺少旁路属性时按正常参与恢复，且可直接旁路', async ({ page }) => {
  const red = {
    id: 'primary-red',
    name: '正红 R02',
    hex: '#D82128',
    transmittance: 72,
  };
  const orange = {
    id: 'fire-orange',
    name: '火焰橙 O15',
    hex: '#F26322',
    transmittance: 68,
  };
  await page.addInitScript(
    ([key, value]) => {
      // 只在首次进入时写入旧记录；之后刷新保留页面自己保存的状态。
      if (window.localStorage.getItem(key) === null) {
        window.localStorage.setItem(key, value);
      }
    },
    [
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        savedAt: '2026-09-12T00:00:00.000Z',
        layers: [red, orange],
      }),
    ],
  );

  await page.goto('/');
  const layers = page.getByTestId('stack-layer');
  await expect(layers).toHaveCount(2);
  await expect(layers.first()).not.toContainText('已旁路');
  await expect(page.getByTestId('final-hex')).toHaveText('#CD0601');
  await expect(page.getByTestId('final-transmittance')).toHaveText('49.0%');

  // 每层都提供旁路操作，切换后按新状态重算
  await expect(
    page.getByRole('button', { name: '旁路 正红 R02' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '旁路 正红 R02' }).click();
  await expect(page.getByTestId('final-hex')).toHaveText('#F26322');
  await expect(page.getByTestId('final-transmittance')).toHaveText('68.0%');
  await expect
    .poll(async () => (await storedRaw(page))?.includes('"bypassed":true'))
    .toBe(true);

  await page.reload();
  await expect(page.getByTestId('stack-layer').first()).toContainText('已旁路');
  await expect(page.getByTestId('final-hex')).toHaveText('#F26322');
});
