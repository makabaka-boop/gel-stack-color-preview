import { expect, test, type Page } from '@playwright/test';

const STORAGE_KEY = 'stage-gel-precheck:latest-scheme:v1';

async function addGel(page: Page, name: string) {
  await page
    .getByTestId('catalog-item')
    .filter({ hasText: name })
    .getByRole('button', { name: '加入' })
    .click();
}

async function setupTwoLayers(page: Page) {
  await page.goto('/');
  await addGel(page, '正红 R02');
  await addGel(page, '火焰橙 O15');
  await expect(page.getByTestId('stack-layer')).toHaveCount(2);
}

test('普通单击叠放中的第二张色片不会改变叠放顺序', async ({ page }) => {
  await setupTwoLayers(page);

  await page.getByTestId('stack-layer').nth(1).click();

  const layers = page.getByTestId('stack-layer');
  await expect(layers).toHaveCount(2);
  await expect(layers.first()).toContainText('正红 R02');
  await expect(layers.nth(1)).toContainText('火焰橙 O15');
});

test('普通单击与叠放区同高的目录卡片不会插入色片', async ({ page }) => {
  await setupTwoLayers(page);

  const stageBox = await page.getByTestId('stage').boundingBox();
  const catalogCard = page.getByTestId('catalog-item').first();
  const cardBox = await catalogCard.boundingBox();
  expect(stageBox).not.toBeNull();
  expect(cardBox).not.toBeNull();
  expect(cardBox!.y).toBeGreaterThanOrEqual(stageBox!.y);
  expect(cardBox!.y).toBeLessThanOrEqual(stageBox!.y + stageBox!.height);

  await catalogCard.click();

  const layers = page.getByTestId('stack-layer');
  await expect(layers).toHaveCount(2);
  await expect(layers.first()).toContainText('正红 R02');
  await expect(layers.nth(1)).toContainText('火焰橙 O15');
});

test('拖动换序被浏览器或设备取消时保留取消前的层次顺序', async ({ page }) => {
  await setupTwoLayers(page);

  const layers = page.getByTestId('stack-layer');
  const source = layers.nth(1);
  const stage = page.getByTestId('stage');
  const sourceBox = await source.boundingBox();
  const stageBox = await stage.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(stageBox).not.toBeNull();

  await page.evaluate(() => {
    window.addEventListener('pointerdown', (event) => {
      Object.assign(window, { __lastPointerId: event.pointerId });
    });
  });

  const startX = sourceBox!.x + sourceBox!.width / 2;
  const startY = sourceBox!.y + sourceBox!.height / 2;
  const endY = stageBox!.y + 18;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, endY, { steps: 10 });

  await page.evaluate(
    ([x, y]) => {
      const pointerId = (
        window as typeof window & { __lastPointerId: number }
      ).__lastPointerId;
      window.dispatchEvent(
        new PointerEvent('pointercancel', {
          bubbles: true,
          cancelable: true,
          pointerId,
          clientX: x,
          clientY: y,
        }),
      );
    },
    [startX, endY],
  );
  await page.mouse.up();

  await expect(page.getByTestId('stack-layer')).toHaveCount(2);
  await expect(page.getByTestId('stack-layer').first()).toContainText(
    '正红 R02',
  );
  await expect(page.getByTestId('stack-layer').nth(1)).toContainText(
    '火焰橙 O15',
  );
});

test('光源输入非法期间移除色片不会覆盖最近一次完整有效方案', async ({
  page,
}) => {
  await setupTwoLayers(page);
  await page.getByTestId('light-input').fill('#A0C8FF');

  await expect
    .poll(async () => {
      const raw = await page.evaluate(
        (key) => window.localStorage.getItem(key),
        STORAGE_KEY,
      );
      return raw !== null && raw.includes('#A0C8FF') && raw.includes('火焰橙 O15');
    })
    .toBe(true);
  const validScheme = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    STORAGE_KEY,
  );

  await page.getByTestId('light-input').fill('#GG00FF');
  await expect(page.getByTestId('light-error')).toBeVisible();
  await page.getByRole('button', { name: '移除 火焰橙 O15' }).click();

  await expect(page.getByTestId('stack-layer')).toHaveCount(1);
  await expect(
    page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY),
  ).resolves.toBe(validScheme);

  await page.reload();
  const layers = page.getByTestId('stack-layer');
  await expect(layers).toHaveCount(2);
  await expect(layers.first()).toContainText('正红 R02');
  await expect(layers.nth(1)).toContainText('火焰橙 O15');
  await expect(page.getByTestId('light-input')).toHaveValue('#A0C8FF');
});
