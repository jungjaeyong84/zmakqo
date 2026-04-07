// @ts-check
const { test, expect } = require("@playwright/test");

const PAGES = [
  { path: "/dashboard/home", title: /DONBEOLJA/, heading: "홈" },
  { path: "/dashboard/profit", title: /DONBEOLJA/, heading: "수익" },
  { path: "/dashboard/cashflow", title: /DONBEOLJA/, heading: "입출금" },
  { path: "/dashboard/trading", title: /DONBEOLJA/, heading: "거래기록" },
  { path: "/dashboard/recovery", title: /DONBEOLJA/, heading: "전략상태" },
  { path: "/dashboard/settings", title: /DONBEOLJA/, heading: "설정" },
];

test.describe("페이지 네비게이션", () => {
  for (const page_def of PAGES) {
    test(`${page_def.heading} 페이지가 렌더링된다 (${page_def.path})`, async ({ page }) => {
      const response = await page.goto(page_def.path);
      expect(response.status()).toBeLessThan(500);
      await expect(page).toHaveTitle(page_def.title);
      await expect(page.locator(".app-shell")).toBeVisible();
    });
  }

  test("사이드바 링크로 페이지 이동이 된다", async ({ page }) => {
    await page.goto("/dashboard/home");
    await page.click('.sidebar-nav a[href*="profit"]');
    await expect(page).toHaveURL(/profit/);
  });
});
