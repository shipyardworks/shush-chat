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
  // Come to rest before lifting off. Releasing mid-movement hands Chromium a velocity and it
  // flings, and the drift that follows is the browser's momentum rather than anything this
  // app decided -- which is what the next assertion would then be measuring. On a loaded
  // machine the steps above are slow enough that no fling is generated and it passed by luck;
  // run on its own it is fast enough to fling every time.
  await page.waitForTimeout(150);
  await touch("touchMove", fromX - 240);
  await page.waitForTimeout(150);
  await touch("touchEnd", fromX - 240);
  const swiped = await scrollLeft(page);
  expect(swiped).toBeGreaterThan(before + 120);

  // Timed inside the page, not across the wire. The strip is only promised to stay put for
  // RESUME_AFTER_MS (2.5s); a wall-clock wait plus two round trips can overrun that on a busy
  // machine, and the stream picking up again exactly when it said it would is not a fault.
  // Measuring in one evaluate keeps the sample well inside the window, and `waited` is
  // asserted so a stall fails as a bad measurement rather than as a verdict on the app.
  const held = await page.evaluate(async () => {
    const strip = document.querySelector<HTMLElement>("#interestTicker")!;
    const from = strip.scrollLeft;
    const at = performance.now();
    await new Promise((settle) => setTimeout(settle, 800));
    return { drift: Math.abs(strip.scrollLeft - from), waited: performance.now() - at };
  });
  expect(held.waited, "the sample landed inside the hold window").toBeLessThan(2000);
  expect(held.drift, "the stream does not snatch it back").toBeLessThan(6);

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

test("find someone after a conversation ends is already looking", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await matchThem(alice, bob);
  await alice.locator("#leave").click();
  await expect(bob.locator("#findSomeoneNext")).toHaveText("Find someone");
  await bob.locator("#findSomeoneNext").click();

  // One press: the picker opens on the search itself, not on a second "Find someone".
  const modal = bob.locator("#findSomeoneModal");
  await expect(modal.locator("#findSomeone")).toHaveAttribute("aria-busy", "true");
  await expect(modal.locator("#interestTicker")).toBeVisible();
  // The same button, and pressing it stops the search.
  await modal.locator("#findSomeone").click();
  await expect(modal.locator("#findSomeone")).toHaveText("Find someone");
});

test("find someone in the sidebar starts looking, under one name everywhere", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await matchThem(alice, bob);
  await expect(bob.locator("#newChat")).toHaveText("Find someone");

  await bob.locator("#newChat").click();
  await expect(bob.locator("#findSomeone")).toHaveAttribute("aria-busy", "true");
  await bob.locator("#findSomeone").click();
  await expect(bob.locator("#findSomeone")).toHaveAttribute("aria-busy", "false");
  await expect(bob.locator("body")).not.toContainText("Find someone new");
});

test("typing an interest that is already a tile picks that tile instead of copying it", async ({
  browser,
}) => {
  const page = await arrive(browser);
  const tile = page.locator("#interestTicker [data-testid=interest]").first();
  await expect(tile).toBeVisible();
  const label = (await tile.innerText()).trim();

  // Typed twice, and differently each time -- still one tile, the real one.
  for (const typed of [label.toUpperCase(), ` ${label} `]) {
    await page.locator("#addInterestInput").fill(typed);
    await page.locator("#addInterestInput").press("Enter");
  }
  const chosen = page.locator('#interestTiles [data-testid=interest][aria-pressed="true"]');
  await expect(chosen.filter({ hasText: new RegExp(`^${label}$`) })).toHaveCount(1);
  await expect(page.locator("#addInterestInput")).toHaveValue("");
});

test("a copy of a tile saved by an older version is folded back into the tile", async ({
  browser,
}) => {
  const page = await arrive(browser);
  const tile = page.locator("#interestTicker [data-testid=interest]").first();
  await expect(tile).toBeVisible();
  const label = (await tile.innerText()).trim();

  // What the old client left behind: private copies of a real tile, one of them twice.
  await page.evaluate((word) => {
    localStorage.setItem(
      "shush.customInterests",
      JSON.stringify([
        { id: -1, label: word },
        { id: -2, label: word },
      ]),
    );
    localStorage.setItem("shush.selectedInterests", JSON.stringify([-1, -2]));
  }, label);
  await page.reload();

  const chosen = page.locator('#interestTiles [data-testid=interest][aria-pressed="true"]');
  await expect(chosen.filter({ hasText: new RegExp(`^${label}$`) })).toHaveCount(1);
  expect(Number(await chosen.first().getAttribute("data-interest-id"))).toBeGreaterThan(0);
});

test("the requests button is a person and, once someone asks, a count", async ({ browser }) => {
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
  // At the foot of the sidebar, where "Signed in" appears once it is saved.
  await expect(page.locator("#sidebar #saveStrip")).toBeVisible();
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

test("stopping a search before it reaches the server leaves nobody waiting", async ({ browser }) => {
  const ghost = await arrive(browser);
  const seeker = await arrive(browser);
  await expect(ghost.locator("#interestTicker [data-testid=interest]").first()).toBeVisible();
  const id = await ghost
    .locator("#interestTicker [data-testid=interest]")
    .first()
    .getAttribute("data-interest-id");
  for (const page of [ghost, seeker]) {
    await freezeTicker(page);
    const tile = page.locator(`[data-interest-id="${id}"]`);
    if ((await tile.getAttribute("aria-pressed")) !== "true") await tile.click({ force: true });
    await page.getByRole("button", { name: "Forever" }).click();
  }

  // Saving the interests is slow, and the search is stopped while it is still in flight --
  // the stop reaches the server before the find it was stopping.
  await ghost.route("**/api/interests/mine", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await ghost.locator("#findSomeone").click();
  await ghost.locator("#findSomeone").click();
  await expect(ghost.locator("#findSomeone")).toHaveAttribute("aria-busy", "false");
  await ghost.waitForTimeout(2000);

  // Somebody with the same interest searches. The ghost must not be in the pool to be found.
  await seeker.locator("#findSomeone").click();
  await seeker.waitForTimeout(4000);
  await expect(ghost.locator("#chat")).toHaveCount(0);
  await seeker.locator("#findSomeone").click();
});

/**
 * The bug this exists for: two people typed the same word and were never matched on it.
 *
 * A typed tag used to live in one browser under a negative id, which `find` filtered out
 * before sending. Searching with only a typed tag selected therefore sent an empty interest
 * list -- which the server rejects -- so both people sat on "Looking" indefinitely and neither
 * was ever a candidate for the other. Nothing on either screen said so.
 */
test("two people who type the same interest are matched on it", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);

  // Fresh, so no earlier run's users are waiting on it and the match can only be this pair.
  const tag = `bandersnatch${Date.now()}`;
  for (const page of [alice, bob]) {
    await expect(page.locator("[data-testid=interest]").first()).toBeVisible();
    await page.locator("#addInterestInput").fill(tag);
    await page.locator("#addInterestInput").press("Enter");
    await expect(page.locator("[data-testid=interest]", { hasText: tag })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Only ever someone who actually shares it: a random match would pass this test while the
    // interest did nothing, which is the whole failure being guarded against.
    await page.getByRole("button", { name: "Forever" }).click();
  }

  await alice.locator("#findSomeone").click();
  await bob.locator("#findSomeone").click();

  for (const page of [alice, bob]) {
    await expect(page.locator("#chat")).toBeVisible();
    // Named, not merely matched. The tag is deliberately absent from the browsable catalogue,
    // so a header built only from that list says "You both like" and then nothing.
    await expect(page.locator("#chatSub")).toContainText(`You both like ${tag}`);
  }
});

test("a typed interest is lowercased as it is typed, and is the same row either way", async ({
  browser,
}) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);

  const tag = `snapdragon${Date.now()}`;
  await expect(alice.locator("[data-testid=interest]").first()).toBeVisible();
  await alice.locator("#addInterestInput").fill(tag.toUpperCase());
  // What is on screen while typing is what will be created -- not a capitalised spelling that
  // quietly becomes something else on the way out.
  await expect(alice.locator("#addInterestInput")).toHaveValue(tag);
  await alice.locator("#addInterestInput").press("Enter");

  await expect(bob.locator("[data-testid=interest]").first()).toBeVisible();
  await bob.locator("#addInterestInput").fill(tag);
  await bob.locator("#addInterestInput").press("Enter");

  for (const page of [alice, bob]) {
    await page.getByRole("button", { name: "Forever" }).click();
  }
  await alice.locator("#findSomeone").click();
  await bob.locator("#findSomeone").click();

  // One typed it shouting and one typed it quietly: still one interest, so still a match.
  for (const page of [alice, bob]) {
    await expect(page.locator("#chatSub")).toContainText(`You both like ${tag}`);
  }
});
