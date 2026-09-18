import { devices, expect, test, type Browser, type Page } from "@playwright/test";

const arrive = async (browser: Browser, phone = false): Promise<Page> => {
  const context = await browser.newContext(phone ? { ...devices["iPhone 13"] } : {});
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("link", { name: "Start chatting" }).click();
  await expect(page.locator("#displayName")).toBeVisible();
  return page;
};

const freezeTicker = (page: Page) =>
  page.evaluate(() => {
    document
      .querySelectorAll<HTMLElement>(".marquee-track")
      .forEach((el) => (el.style.animationPlayState = "paused"));
  });

const matchThem = async (a: Page, b: Page) => {
  for (const page of [a, b]) {
    await expect(page.locator("[data-testid=interest]").first()).toBeVisible();
  }
  const id = await a.locator("[data-testid=interest]").first().getAttribute("data-interest-id");
  for (const page of [a, b]) await freezeTicker(page);
  for (const page of [a, b]) {
    const tile = page.locator(`[data-interest-id="${id}"]`);
    if ((await tile.getAttribute("aria-pressed")) !== "true") await tile.click({ force: true });
  }
  await a.waitForTimeout(600);
  await a.locator("#findSomeone").click();
  await b.locator("#findSomeone").click();
  await expect(a.locator("#chat")).toBeVisible();
  await expect(b.locator("#chat")).toBeVisible();
};

/** A tag nobody else has, so a search on it alone can only ever keep looking. */
const pickUniqueTag = async (page: Page) => {
  await expect(page.locator("[data-testid=interest]").first()).toBeVisible();
  await page.locator("#addInterestInput").fill(`lonely${Date.now()}`);
  await page.locator("#addInterestInput").press("Enter");
  await page.getByRole("button", { name: "Forever" }).click();
};

const scrollLeft = (page: Page) =>
  page.locator("#interestTicker").evaluate((node) => node.scrollLeft);

test("on a phone the interests are the same one-line strip, swiped with one finger", async ({
  browser,
}) => {
  const page = await arrive(browser, true);
  await expect(page.locator("#interestTicker [data-testid=interest]").first()).toBeVisible();

  // One line that scrolls sideways, not a wall of wrapped tiles to scroll down through.
  const strip = page.locator("#interestTicker");
  expect(await strip.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  // ...and it scrolls inside the screen, not by making the page itself wider than the phone.
  const onScreen = (await strip.boundingBox())!;
  expect(onScreen.x + onScreen.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  const rows = await page
    .locator("#interestTicker [data-testid=interest]")
    .evaluateAll((tiles) => new Set(tiles.map((tile) => Math.round(tile.getBoundingClientRect().top))).size);
  expect(rows).toBe(1);

  // It streams on its own.
  const start = await scrollLeft(page);
  await expect.poll(() => scrollLeft(page)).toBeGreaterThan(start + 5);

  // A real touch swipe moves it, and the stream does not snatch it back straight away.
  const box = (await strip.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const before = await scrollLeft(page);
  const y = Math.round(box.y + box.height / 2);
  const fromX = Math.round(box.x + box.width * 0.8);
  const touch = (type: string, x: number) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y }],
    });
  await touch("touchStart", fromX);
  for (let step = 1; step <= 12; step++) {
    await touch("touchMove", fromX - step * 20);
    await page.waitForTimeout(16);
  }
  await touch("touchEnd", fromX - 240);
  const swiped = await scrollLeft(page);
  expect(swiped).toBeGreaterThan(before + 120);
  await page.waitForTimeout(800);
  expect(Math.abs((await scrollLeft(page)) - swiped)).toBeLessThan(6);

  // ...and picks up again from where the finger left it.
  await expect.poll(() => scrollLeft(page), { timeout: 6000 }).toBeGreaterThan(swiped + 5);

  // A tap picks a tile.
  await freezeTicker(page);
  const tile = page.locator("#interestTicker [data-testid=interest]").first();
  const id = await tile.getAttribute("data-interest-id");
  await tile.tap();
  await expect(page.locator(`[data-interest-id="${id}"]`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(`#interestTicker [data-interest-id="${id}"]`)).toHaveCount(0);
});

test("find someone turns into the search itself, and tapping it again stops it", async ({ browser }) => {
  const page = await arrive(browser);
  await pickUniqueTag(page);
  const find = page.locator("#findSomeone");
  const idle = (await find.boundingBox())!;

  await find.click();
  await expect(find).toHaveAttribute("aria-busy", "true");
  await expect(find).toContainText("Looking");
  // Nothing pops up beside it, and the button does not jump around.
  await expect(page.locator("#findStatus")).toHaveCount(0);
  const busy = (await find.boundingBox())!;
  expect(Math.abs(busy.x - idle.x)).toBeLessThan(1);
  expect(Math.abs(busy.width - idle.width)).toBeLessThan(2);

  // After a while, a short hint under it -- small, and below rather than beside.
  await expect(page.locator("#findStatus")).toBeVisible({ timeout: 15_000 });
  await expect(find).toContainText("Still looking");
  // Measured now: the panel is centred, so it grows around the hint once that appears.
  const button = (await find.boundingBox())!;
  const hint = (await page.locator("#findStatus").boundingBox())!;
  expect(hint.y).toBeGreaterThanOrEqual(button.y + button.height);
  const size = await page.locator("#findStatus").evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
  expect(size).toBeLessThanOrEqual(12);

  await find.click();
  await expect(find).toHaveAttribute("aria-busy", "false");
  await expect(find).toHaveText("Find someone");
  await expect(page.locator("#findStatus")).toHaveCount(0);
});

test("the same find button is used in the picker after a conversation ends", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await matchThem(alice, bob);
  await alice.locator("#leave").click();
  await bob.locator("#findSomeoneNext").click();

  const modal = bob.locator("#findSomeoneModal");
  await expect(modal.locator("#interestTicker")).toBeVisible();
  await pickUniqueTag(bob);
  await modal.locator("#findSomeone").click();
  await expect(modal.locator("#findSomeone")).toHaveAttribute("aria-busy", "true");
  await modal.locator("#findSomeone").click();
  await expect(modal.locator("#findSomeone")).toHaveText("Find someone");
});

test("the request count sits inside the requests icon", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await matchThem(alice, bob);
  await expect(bob.locator("#requestsButton [data-testid=requestCount]")).toHaveCount(0);

  await alice.locator("#addFriend").click();
  await expect(bob.locator("#requestsButton [data-testid=requestCount]")).toHaveText("1");
  await expect(bob.locator("#requestsButton")).toHaveAttribute("aria-label", "Requests (1)");
});

test("the word 'stranger' never reaches the screen", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await matchThem(alice, bob);
  await alice.locator("#composer").fill("hello");
  await alice.locator("#send").click();

  // Reopened from the list, which is where "A stranger you talked to" used to appear...
  await bob.locator("#home").click();
  await bob.locator("[data-testid=chat]").first().click();
  await expect(bob.locator("#chatHeading")).toBeVisible();
  await expect(bob.locator("body")).not.toContainText(/stranger/i);

  // ...and on their profile.
  await bob.locator("#chatWho").click();
  await expect(bob.locator("#profileName")).toBeVisible();
  await expect(bob.locator("body")).not.toContainText(/stranger/i);
});

test("an unsaved account gets one plain line and a button, not a form", async ({ browser }) => {
  const page = await arrive(browser);
  await expect(page.locator("#saveStrip")).toBeVisible();
  await expect(page.locator("#saveWarning")).toContainText("will be lost");
  await expect(page.locator("#email")).toHaveCount(0);

  await page.locator("#openSave").click();
  await expect(page.locator("#saveBox #email")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#saveBox")).toHaveCount(0);

  await page.locator("#openSave").click();
  await page.locator("#email").fill(`saved${Date.now()}@example.com`);
  await page.locator("#password").fill("correct horse battery");
  await page.locator("#saveAccount").click();
  await expect(page.locator("#saveStrip")).toHaveCount(0);
  await expect(page.locator("#accountBox")).toBeVisible();
});
