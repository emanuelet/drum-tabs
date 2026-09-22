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
});
