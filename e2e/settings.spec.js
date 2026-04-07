// @ts-check
const { test, expect } = require("@playwright/test");

test.describe("설정 페이지", () => {
  test("리스크 탭이 기본으로 렌더링된다", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await expect(page.locator(".tabs")).toBeVisible();
    await expect(page.locator('.tabs a.active')).toContainText("리스크");
  });

  test("시스템 탭으로 전환된다", async ({ page }) => {
    await page.goto("/dashboard/settings?tab=system");
    await expect(page.locator('.tabs a.active')).toContainText("시스템");
    await expect(page.locator("#system-card")).toBeVisible();
  });

  test("리포트(AI) 탭으로 전환된다", async ({ page }) => {
    await page.goto("/dashboard/settings?tab=ai");
    await expect(page.locator('.tabs a.active')).toContainText("리포트");
    await expect(page.locator("#ai-card")).toBeVisible();
  });

  test("거래소 탭으로 전환된다", async ({ page }) => {
    await page.goto("/dashboard/settings?tab=exchanges");
    await expect(page.locator('.tabs a.active')).toContainText("거래소");
    await expect(page.locator("#ex-card")).toBeVisible();
  });
});
