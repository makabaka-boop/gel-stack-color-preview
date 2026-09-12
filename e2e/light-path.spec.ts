import { expect, test, type Locator, type Page } from '@playwright/test';

const STORAGE_KEY = 'stage-gel-precheck:latest-scheme:v1';

async function addGel(page: Page, name: string) {
  await page
    .getByTestId('catalog-item')
    .filter({ hasText: name })
    .getByRole('button', { name: '加入' })
    .click();
}

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

async function checkpoint(page: Page, index: number): Promise<Locator> {
  return page.getByTestId('light-path-checkpoint').nth(index);
}

test('逐层光路默认收起，展开后按光路顺序显示每张色片后的累计结果', async ({
  page,
}) => {
  await page.goto('/');

  // 空预检台不展示入口
  await expect(page.getByTestId('light-path-toggle')).toHaveCount(0);

  await addGel(page, '正红 R02');
  await addGel(page, '火焰橙 O15');

  // 有色片后入口出现，明细默认收起，维持原结果区布局
  const toggle = page.getByTestId('light-path-toggle');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('light-path-panel')).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  // 光源起点与两个检查点
  await expect(page.getByTestId('light-path-origin')).toBeVisible();
  await expect(page.getByTestId('checkpoint-origin-hex')).toHaveText('#FFFFFF');

  const checkpoints = page.getByTestId('light-path-checkpoint');
  await expect(checkpoints).toHaveCount(2);

  // 首层：正红自身，累计 72.0%，可用
  const first = await checkpoint(page, 0);
  await expect(first).toHaveAttribute('data-layer-order', '1');
  await expect(first.getByTestId('checkpoint-name')).toHaveText('正红 R02');
  await expect(first.getByTestId('checkpoint-hex')).toHaveText('#D82128');
  await expect(first.getByTestId('checkpoint-rgb')).toHaveText(
    'R 216 / G 33 / B 40',
  );
  await expect(first.getByTestId('checkpoint-transmittance')).toHaveText(
    '72.0%',
  );
  await expect(first.getByTestId('checkpoint-conclusion')).toHaveText('可用');

  // 末层：与总结果完全相同
  const last = await checkpoint(page, 1);
  await expect(last).toHaveAttribute('data-layer-order', '2');
  await expect(last.getByTestId('checkpoint-name')).toHaveText('火焰橙 O15');
  await expect(last.getByTestId('checkpoint-hex')).toHaveText('#CD0601');
  await expect(last.getByTestId('checkpoint-rgb')).toHaveText(
    'R 205 / G 6 / B 1',
  );
  await expect(last.getByTestId('checkpoint-transmittance')).toHaveText(
    '49.0%',
  );
  await expect(last.getByTestId('checkpoint-conclusion')).toHaveText('可用');
  await expect(page.getByTestId('final-hex')).toHaveText('#CD0601');
  await expect(page.getByTestId('final-transmittance')).toHaveText('49.0%');

  // 再次点击可收起
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('light-path-panel')).toHaveCount(0);
});

test('拖动换序后检查点顺序与累计数值在同一次更新中同步', async ({
  page,
}) => {
  await page.goto('/');
  await addGel(page, '正红 R02');
  await addGel(page, '火焰橙 O15');
  await page.getByTestId('light-path-toggle').click();

  const stage = page.getByTestId('stage');
  const layers = page.getByTestId('stack-layer');
  await dragTo(page, layers.first(), stage, 0.5);

  // 叠放区顺序已换
  await expect(page.getByTestId('stack-layer').first()).toContainText(
    '火焰橙 O15',
  );

  // 检查点顺序同步换为：火焰橙 → 正红
  const first = await checkpoint(page, 0);
  await expect(first.getByTestId('checkpoint-name')).toHaveText('火焰橙 O15');
  await expect(first.getByTestId('checkpoint-hex')).toHaveText('#F26322');
  await expect(first.getByTestId('checkpoint-rgb')).toHaveText(
    'R 242 / G 99 / B 34',
  );
  await expect(first.getByTestId('checkpoint-transmittance')).toHaveText(
    '68.0%',
  );

  const last = await checkpoint(page, 1);
  await expect(last.getByTestId('checkpoint-name')).toHaveText('正红 R02');
  await expect(last.getByTestId('checkpoint-hex')).toHaveText('#CD0601');
  await expect(last.getByTestId('checkpoint-transmittance')).toHaveText('49.0%');

  // 总结果与末检查点始终一致（线性乘法可交换，最终颜色不变）
  await expect(page.getByTestId('final-hex')).toHaveText('#CD0601');
  await expect(page.getByTestId('final-transmittance')).toHaveText('49.0%');
});

test('修改光源后各检查点累计颜色同步重算，透光率只由色片决定', async ({
  page,
}) => {
  await page.goto('/');
  await addGel(page, '正红 R02');
  await addGel(page, '火焰橙 O15');
  await page.getByTestId('light-path-toggle').click();

  await page.getByTestId('light-input').fill('#A0C8FF');

  await expect(page.getByTestId('checkpoint-origin-hex')).toHaveText('#A0C8FF');
  const first = await checkpoint(page, 0);
  await expect(first.getByTestId('checkpoint-hex')).toHaveText('#871728');
  await expect(first.getByTestId('checkpoint-rgb')).toHaveText(
    'R 135 / G 23 / B 40',
  );
  await expect(first.getByTestId('checkpoint-transmittance')).toHaveText(
    '72.0%',
  );

  const last = await checkpoint(page, 1);
  await expect(last.getByTestId('checkpoint-hex')).toHaveText('#800401');
  await expect(last.getByTestId('checkpoint-rgb')).toHaveText(
    'R 128 / G 4 / B 1',
  );
  await expect(last.getByTestId('checkpoint-transmittance')).toHaveText('49.0%');

  await expect(page.getByTestId('final-hex')).toHaveText('#800401');
});

test('刷新后按现有记录恢复并重新生成检查点，明细保持收起', async ({
  page,
}) => {
  await page.goto('/');
  await addGel(page, '正红 R02');
  await addGel(page, '火焰橙 O15');
  await page.getByTestId('light-input').fill('#A0C8FF');
  await expect(page.getByTestId('final-hex')).toHaveText('#800401');

  // 展开明细后刷新：展开状态不写入存储，刷新后按现有记录恢复且明细收起
  await page.getByTestId('light-path-toggle').click();
  await expect(page.getByTestId('light-path-panel')).toBeVisible();

  await page.reload();

  await expect(page.getByTestId('light-input')).toHaveValue('#A0C8FF');
  await expect(page.getByTestId('stack-layer')).toHaveCount(2);
  const toggle = page.getByTestId('light-path-toggle');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('light-path-panel')).toHaveCount(0);

  // 展开后检查点由恢复的记录重新生成
  await toggle.click();
  await expect(page.getByTestId('checkpoint-origin-hex')).toHaveText('#A0C8FF');
  const last = await checkpoint(page, 1);
  await expect(last.getByTestId('checkpoint-name')).toHaveText('火焰橙 O15');
  await expect(last.getByTestId('checkpoint-hex')).toHaveText('#800401');
  await expect(last.getByTestId('checkpoint-transmittance')).toHaveText('49.0%');

  // localStorage 中没有为明细新增任何字段
  const raw = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    STORAGE_KEY,
  );
  expect(raw).not.toContain('checkpoint');
  expect(raw).not.toContain('lightPath');
});

test('非法光源期间明细保持最后有效结果，恢复合法输入后同步重算', async ({
  page,
}) => {
  await page.goto('/');
  await addGel(page, '正红 R02');
  await addGel(page, '火焰橙 O15');
  await page.getByTestId('light-input').fill('#A0C8FF');
  await page.getByTestId('light-path-toggle').click();

  await expect(page.getByTestId('checkpoint-origin-hex')).toHaveText('#A0C8FF');
  await expect(
    (await checkpoint(page, 1)).getByTestId('checkpoint-hex'),
  ).toHaveText('#800401');

  // 输入非法光源：拦截规则照常生效，已显示的检查点保持最后有效结果
  await page.getByTestId('light-input').fill('#GG00FF');
  await expect(page.getByTestId('light-error')).toContainText(
    '不是合法六位十六进制颜色',
  );
  await expect(page.getByTestId('checkpoint-origin-hex')).toHaveText('#A0C8FF');
  const checkpoints = page.getByTestId('light-path-checkpoint');
  await expect(checkpoints).toHaveCount(2);
  await expect(
    (await checkpoint(page, 0)).getByTestId('checkpoint-hex'),
  ).toHaveText('#871728');
  await expect(
    (await checkpoint(page, 1)).getByTestId('checkpoint-hex'),
  ).toHaveText('#800401');
  await expect(
    (await checkpoint(page, 1)).getByTestId('checkpoint-transmittance'),
  ).toHaveText('49.0%');
  await expect(page.getByTestId('final-hex')).toHaveText('#800401');

  // 恢复合法输入：明细与总结果在同一次更新中重算
  await page.getByTestId('light-input').fill('#FFFFFF');
  await expect(page.getByTestId('light-error')).toHaveCount(0);
  await expect(page.getByTestId('checkpoint-origin-hex')).toHaveText('#FFFFFF');
  await expect(
    (await checkpoint(page, 0)).getByTestId('checkpoint-hex'),
  ).toHaveText('#D82128');
  await expect(
    (await checkpoint(page, 1)).getByTestId('checkpoint-hex'),
  ).toHaveText('#CD0601');
  await expect(page.getByTestId('final-hex')).toHaveText('#CD0601');
});
