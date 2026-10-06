import { expect, test } from "@playwright/test";

test("accepts a six-digit PIN across grouped inputs", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
        window.isDemo = false;
    });
    await page.getByRole("link", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/login$/);

    const digits = page.getByLabel(/PIN digit/);
    for (let index = 0; index < 6; index++) {
        await digits.nth(index).fill(String(index + 1));
        if (index < 5) {
            await expect(digits.nth(index + 1)).toBeFocused();
        }
    }

    for (let index = 0; index < 6; index++) {
        await expect(digits.nth(index)).toHaveValue(String(index + 1));
    }

    await digits.nth(5).press("Backspace");
    await digits.nth(5).press("Backspace");
    await expect(digits.nth(4)).toHaveValue("");
    await expect(digits.nth(4)).toBeFocused();

    await digits.nth(0).evaluate((input) => {
        const clipboardData = new DataTransfer();
        clipboardData.setData("text", "987654");
        input.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
    });
    for (const [index, value] of ["9", "8", "7", "6", "5", "4"].entries()) {
        await expect(digits.nth(index)).toHaveValue(value);
    }

    await page.locator('input[name="password"]').fill("987654");
    for (const [index, value] of ["9", "8", "7", "6", "5", "4"].entries()) {
        await expect(digits.nth(index)).toHaveValue(value);
    }
});

test("opens navigation links from the mobile menu", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");

    const menu = page.getByRole("button", { name: "Menu" });
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Drum Metronome" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
});
