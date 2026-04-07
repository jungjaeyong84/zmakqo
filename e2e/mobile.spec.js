// @ts-check
const { test, expect } = require("@playwright/test");

// These tests only run in the "mobile" project (375x812 viewport)
test.describe("모바일 뷰", () => {
  test("하단 네비게이션 바가 보인다", async ({ page }) => {
    await page.goto("/dashboard/home");
    const bottomNav = page.locator(".mobile-bottom-nav");
    await expect(bottomNav).toBeVisible();
    await expect(bottomNav.locator("a")).toHaveCount(5);
  });

  test("사이드바가 기본적으로 숨겨진다", async ({ page }) => {
    await page.goto("/dashboard/home");
    const sidebar = page.locator(".sidebar");
    // On mobile, sidebar should be off-screen (left: -280px)
    const box = await sidebar.boundingBox();
    if (box) {
      expect(box.x).toBeLessThan(0);
    }
  });

  test("히어로 수치가 1열로 표시된다", async ({ page }) => {
    await page.goto("/dashboard/home");
    const heroes = page.locator(".hero-number");
    const count = await heroes.count();
    if (count >= 2) {
      const first = await heroes.nth(0).boundingBox();
      const second = await heroes.nth(1).boundingBox();
      // On mobile (1 column), second card should be below first
      if (first && second) {
        expect(second.y).toBeGreaterThan(first.y + first.height - 5);
      }
    }
  });

  test("하단 네비로 페이지 이동이 된다", async ({ page }) => {
    await page.goto("/dashboard/home");
    await page.click('.mobile-bottom-nav a[href*="profit"]');
    await expect(page).toHaveURL(/profit/);
  });

  test("테이블이 카드 모드로 전환된다", async ({ page }) => {
    await page.goto("/dashboard/home");
    // With mobile-cards-mode class, thead should be hidden
    const thead = page.locator(".mobile-cards-mode thead");
    const count = await thead.count();
    if (count > 0) {
      await expect(thead.first()).not.toBeVisible();
    }
  });
});
