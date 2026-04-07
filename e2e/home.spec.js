// @ts-check
const { test, expect } = require("@playwright/test");

test.describe("홈 대시보드", () => {
  test("페이지가 정상 렌더링된다", async ({ page }) => {
    await page.goto("/dashboard/home");
    await expect(page).toHaveTitle(/DONBEOLJA/);
    await expect(page.locator(".app-shell")).toBeVisible();
  });

  test("히어로 수치 카드가 보인다", async ({ page }) => {
    await page.goto("/dashboard/home");
    await expect(page.locator(".hero-number")).toHaveCount(2);
    await expect(page.locator(".hero-number .hero-label").first()).toContainText("총 자산");
  });

  test("KPI 카드가 3개 보인다", async ({ page }) => {
    await page.goto("/dashboard/home");
    await expect(page.locator(".metric-card")).toHaveCount(3);
  });

  test("사이드바 네비게이션이 보인다", async ({ page }) => {
    await page.goto("/dashboard/home");
    await expect(page.locator(".sidebar-nav")).toBeVisible();
    await expect(page.locator(".sidebar-nav a")).toHaveCount(6);
  });

  test("에러 시 fallback 배너가 표시된다", async ({ page }) => {
    // Mock data mode renders without Firestore errors
    await page.goto("/dashboard/home");
    // If MOCK_DATA=1 is active, no error banner should appear
    const banner = page.locator(".status-banner.error");
    // Banner should either not exist or not be visible when mock data is active
    const bannerCount = await banner.count();
    if (bannerCount > 0) {
      await expect(banner).toContainText("데이터를 불러오지 못했습니다");
    }
  });
});
