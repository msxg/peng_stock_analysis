import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:8900';
const outputDir = path.resolve(process.cwd(), 'tmp', 'artifacts', 'focus-news');

fs.mkdirSync(outputDir, { recursive: true });

function file(name) {
  return path.join(outputDir, name);
}

async function waitForProviderTabActive(page, testId) {
  await page.waitForFunction((id) => {
    const tab = document.querySelector(`[data-testid="${id}"]`);
    if (!tab) return false;
    const className = tab.getAttribute('class') || '';
    return className.includes('bg-primary');
  }, testId, { timeout: 20000 });
}

async function waitDrawerDetached(page) {
  await page.waitForSelector('[data-testid="focus-news-detail-drawer"]', {
    state: 'detached',
    timeout: 15000,
  });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1600, height: 1200 },
  deviceScaleFactor: 1,
});

try {
  await page.goto(`${baseUrl}/focus-news`, {
    waitUntil: 'networkidle',
    timeout: 60000,
  });

  await page.waitForSelector('text=焦点资讯', { timeout: 30000 });
  await page.waitForSelector('text=资讯列表', { timeout: 30000 });

  const drawerInitialCount = await page.locator('[data-testid="focus-news-detail-drawer"]').count();
  assert.equal(drawerInitialCount, 0, '初始状态不应渲染资讯详情窗');

  const providerTabs = page.locator('[data-testid^="focus-news-provider-tab-"]');
  const providerTabCount = await providerTabs.count();
  assert(providerTabCount >= 1, '未找到资讯来源标签');

  const autoRefreshTrigger = page.getByTestId('focus-news-auto-refresh-trigger');
  await autoRefreshTrigger.waitFor({ state: 'visible', timeout: 20000 });
  const autoRefreshBefore = ((await autoRefreshTrigger.textContent()) || '').trim();
  assert(autoRefreshBefore.includes('关闭'), '自动刷新默认应为关闭');
  await autoRefreshTrigger.click();
  await page.waitForSelector('[data-testid="focus-news-auto-refresh-item-30000"]', { timeout: 10000 });
  await page.$eval('[data-testid="focus-news-auto-refresh-item-30000"]', (el) => el.click());
  const autoRefreshAfter = ((await autoRefreshTrigger.textContent()) || '').trim();
  assert(autoRefreshAfter.includes('30 秒'), '自动刷新频率切换失败');
  await autoRefreshTrigger.click();
  await page.waitForSelector('[data-testid="focus-news-auto-refresh-item-0"]', { timeout: 10000 });
  await page.$eval('[data-testid="focus-news-auto-refresh-item-0"]', (el) => el.click());

  const selectCount = await page.locator('select').count();
  assert.equal(selectCount, 0, '焦点资讯页不应再使用下拉框切换新闻源');

  await page.screenshot({
    path: file('focus-news-source-tabs.png'),
    fullPage: true,
  });

  const xueqiuTab = page.getByTestId('focus-news-provider-tab-xueqiu');
  let providerSwitched = false;
  let switchedProviderTabId = '';
  if (await xueqiuTab.count()) {
    await xueqiuTab.click();
    await waitForProviderTabActive(page, 'focus-news-provider-tab-xueqiu');
    providerSwitched = true;
    switchedProviderTabId = 'focus-news-provider-tab-xueqiu';
  } else if (providerTabCount >= 2) {
    const nextProviderTab = providerTabs.nth(1);
    const nextProviderTabId = (await nextProviderTab.getAttribute('data-testid')) || '';
    assert(nextProviderTabId, '未找到可切换的来源标签');
    await nextProviderTab.click();
    await waitForProviderTabActive(page, nextProviderTabId);
    providerSwitched = true;
    switchedProviderTabId = nextProviderTabId;
  }
  if (providerSwitched) {
    const switchedTabClassName = (await page.getByTestId(switchedProviderTabId).getAttribute('class')) || '';
    assert(switchedTabClassName.includes('bg-primary'), '点击来源标签后，标签未进入激活态');
  }

  await page.screenshot({
    path: file('focus-news-after-provider-switch.png'),
    fullPage: true,
  });

  const storyButtons = page.locator('[data-focus-news-detail-trigger="true"]');
  const triggerCount = await storyButtons.count();
  assert(triggerCount >= 2, `可点击资讯条目数量不足，count=${triggerCount}`);

  const firstStoryButton = storyButtons.first();
  await firstStoryButton.waitFor({ state: 'visible', timeout: 20000 });
  const firstStoryLabel = ((await firstStoryButton.textContent()) || '').trim().replace(/\s+/g, ' ');
  assert(firstStoryLabel, '未找到可点击的首条资讯');
  await firstStoryButton.click();

  const drawer = page.getByTestId('focus-news-detail-drawer');
  await drawer.waitFor({ state: 'visible', timeout: 20000 });

  const drawerBox = await drawer.boundingBox();
  assert(drawerBox, '资讯详情抽屉未渲染');
  assert(drawerBox.x > 900, `资讯详情抽屉未从右侧展开，x=${drawerBox.x}`);
  assert(drawerBox.y > 0, `资讯详情窗高度未留边距，y=${drawerBox.y}`);
  assert(drawerBox.height < 1200, `资讯详情窗不应顶天立地，高度=${drawerBox.height}`);

  const publishedAt = page.getByTestId('focus-news-detail-published-at');
  await publishedAt.waitFor({ state: 'visible', timeout: 15000 });
  const publishedAtText = ((await publishedAt.textContent()) || '').trim();
  assert(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/.test(publishedAtText), '详情窗未显示具体发布时间');

  const drawerTitle = page.getByTestId('focus-news-detail-title');
  const detailTitleBefore = ((await drawerTitle.textContent()) || '').trim();

  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.mouse.move(420, 980);
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(300);
  const scrollAfter = await page.evaluate(() => window.scrollY);
  assert(scrollAfter > scrollBefore, `详情打开后页面未能滚动列表，before=${scrollBefore}, after=${scrollAfter}`);

  let nextIndex = 1;
  let nextStoryLabel = '';
  for (let i = 1; i < triggerCount; i += 1) {
    const text = ((await storyButtons.nth(i).textContent()) || '').trim().replace(/\s+/g, ' ');
    if (text && text !== firstStoryLabel) {
      nextIndex = i;
      nextStoryLabel = text;
      break;
    }
  }
  await storyButtons.nth(nextIndex).click();
  await drawer.waitFor({ state: 'visible', timeout: 20000 });

  const detailMetaBefore = publishedAtText;
  await page.waitForFunction((payload) => {
    const title = (document.querySelector('[data-testid="focus-news-detail-title"]')?.textContent || '').trim();
    const published = (document.querySelector('[data-testid="focus-news-detail-published-at"]')?.textContent || '').trim();
    return title.length > 0 && (title !== payload.title || published !== payload.published);
  }, {
    title: detailTitleBefore,
    published: detailMetaBefore,
  }, { timeout: 20000 });

  const detailTitleAfter = ((await drawerTitle.textContent()) || '').trim();
  assert(detailTitleAfter, '切换资讯后详情标题为空');

  const drawerCountAfterSwitch = await page.locator('[data-testid="focus-news-detail-drawer"]').count();
  assert.equal(drawerCountAfterSwitch, 1, '点击另一条资讯时不应关闭详情窗');

  await page.screenshot({
    path: file('focus-news-detail-drawer.png'),
    fullPage: true,
  });

  await page.getByTestId('focus-news-detail-close').click();
  await waitDrawerDetached(page);

  await firstStoryButton.click();
  await drawer.waitFor({ state: 'visible', timeout: 20000 });
  await page.mouse.click(420, 140);
  await waitDrawerDetached(page);

  await page.screenshot({
    path: file('focus-news-detail-closed.png'),
    fullPage: true,
  });

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    providerTabCount,
    providerSwitched,
    screenshots: [
      file('focus-news-source-tabs.png'),
      file('focus-news-after-provider-switch.png'),
      file('focus-news-detail-drawer.png'),
      file('focus-news-detail-closed.png'),
    ],
    clickedStory: firstStoryLabel.slice(0, 80),
    switchedStory: nextStoryLabel.slice(0, 80),
    drawerX: drawerBox.x,
    drawerY: drawerBox.y,
    drawerHeight: drawerBox.height,
    listScrollWorksWhenDrawerOpen: scrollAfter > scrollBefore,
    switchStoryKeepsDrawerOpen: true,
    closeByIconWorks: true,
    closeByOutsideClickWorks: true,
    timeFound: true,
  }, null, 2));
} finally {
  await page.close().catch(() => {});
  await browser.close().catch(() => {});
}
