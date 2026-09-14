import { expect, test, type Page, type Browser } from "@playwright/test";

/** A 32x32 png, small enough to inline and real enough to decode. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAOUlEQVR42u3OMQEAAAgDoK1/aM3g4QcFaEmYs1UEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcGgBXQABBQIcHwAAAABJRU5ErkJggg==",
  "base64",
);

/** A fresh browser context per person: two tabs of one browser share one account. */
const arrive = async (browser: Browser): Promise<Page> => {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/");
  await page.getByRole("link", { name: "Start chatting" }).click();
  await expect(page.locator("#displayName")).toBeVisible();
  return page;
};

/** Requests live behind an icon in the header now, not a permanent section of the sidebar. */
const openRequests = async (page: Page) => {
  await page.locator("#requestsButton").click();
};

const openTab = async (page: Page, tab: "chats" | "friends") => {
  await page.locator(tab === "chats" ? "#tabChats" : "#tabFriends").click();
};

const matchThem = async (a: Page, b: Page) => {
  for (const page of [a, b]) {
    await expect(page.locator("[data-testid=interest]").first()).toBeVisible();
  }
  const id = await a.locator("[data-testid=interest]").first().getAttribute("data-interest-id");
  // Selected, not toggled. A returning visitor arrives with their last interests already on,
  // and clicking blindly turns the shared one off again.
  for (const page of [a, b]) {
    const tile = page.locator(`[data-interest-id="${id}"]`);
    if ((await tile.getAttribute("aria-pressed")) !== "true") {
      await tile.click();
    }
  }
  await a.waitForTimeout(600);
  await a.locator("#findSomeone").click();
  await b.locator("#findSomeone").click();
  await expect(a.locator("#chat")).toBeVisible();
  await expect(b.locator("#chat")).toBeVisible();
};

test("the landing page is server-rendered", async ({ request }) => {
  // Fetched without a browser, so nothing has run any JavaScript. If the copy is in the HTML,
  // it came from the server.
  const html = await (await request.get("/")).text();
  expect(html).toContain("someone new");
  expect(html).toContain("Start chatting");
});

test("two strangers match on a shared interest, talk, and keep each other", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);

  await matchThem(alice, bob);
  // The heading is who you are talking to; why you were put together is underneath it.
  await expect(alice.locator("#chatSub")).toContainText(/you both like/i);
  await expect(alice.locator("#chatSub")).not.toContainText(/random/i);
  await expect(alice.locator("#chatHeading")).not.toHaveText("");

  await alice.locator("#composer").fill("hello from alice");
  await alice.locator("#send").click();
  await expect(bob.locator("#messages")).toContainText("hello from alice");

  await bob.locator("#composer").fill("hello from bob");
  await bob.locator("#send").click();
  await expect(alice.locator("#messages")).toContainText("hello from bob");

  // A day separator, and a time on every bubble.
  await expect(alice.locator("#messages").getByText("Today")).toBeVisible();
  await expect(alice.locator("[data-testid=message]").first()).toContainText(/\d{1,2}[:.]\d{2}/);

  // Ticks: alice's own message is read, because bob has the conversation open.
  await expect(
    alice.locator("[data-testid=message][data-mine=true]").first().locator("[data-testid=ticks]"),
  ).toHaveAttribute("data-state", "read");

  // Asking to keep somebody has to be VISIBLE to them, not merely present in the DOM. The
  // badge on the header icon is what says something is waiting before it is even opened.
  await alice.locator("#addFriend").click();
  await expect(bob.locator("[data-testid=requestCount]")).toBeVisible();
  await openRequests(bob);
  await expect(bob.locator("[data-testid=request]")).toBeVisible();

  await bob.getByRole("button", { name: "Accept" }).click();
  await bob.keyboard.press("Escape");
  await openTab(bob, "friends");
  await openTab(alice, "friends");
  await expect(bob.locator("[data-testid=friend]")).toBeVisible();
  await expect(alice.locator("[data-testid=friend]")).toBeVisible();

  // The friends list is the only route back: matching refuses to pair existing friends.
  await bob.locator("#home").click();
  await expect(bob.locator("#findSomeone")).toBeVisible();
  await openTab(bob, "friends");
  await bob.locator("[data-testid=friend]").first().click();
  await expect(bob.locator("#messages")).toContainText("hello from alice");

  const seqs = await bob.locator("[data-testid=message]").evaluateAll((nodes) =>
    nodes.map((node) => Number((node as HTMLElement).dataset.seq)),
  );
  expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
});

test("an image reaches the other person and actually loads", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await matchThem(alice, bob);

  await alice.locator("#imageInput").setInputFiles({
    name: "dot.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  // Choosing a file is no longer the same act as sending it: it opens a preview first.
  await expect(alice.locator("#attachmentPreview")).toBeVisible();
  await alice.locator("#sendAttachment").click();

  const delivered = bob.locator("#messages img").first();
  await expect(delivered).toBeVisible();
  // Rendered, not merely present: a 401 or a 400 leaves an <img> in the DOM with no pixels.
  await expect
    .poll(async () => delivered.evaluate((node: HTMLImageElement) => node.naturalWidth))
    .toBeGreaterThan(0);
});

test("unread counts, and removing a friend makes them matchable again", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await matchThem(alice, bob);

  await alice.locator("#addFriend").click();
  await openRequests(bob);
  await bob.getByRole("button", { name: "Accept" }).click();
  await bob.keyboard.press("Escape");
  await openTab(bob, "friends");
  await expect(bob.locator("[data-testid=friend]")).toBeVisible();

  // Bob looks away, so what arrives is waiting for him rather than read.
  await bob.locator("#home").click();
  await alice.locator("#composer").fill("while you were out");
  await alice.locator("#send").click();
  await expect(bob.locator("[data-testid=unread]")).toHaveText("1");

  // Removing the friendship is the only way back to being matchable with that person.
  await bob.locator("[data-testid=friend]").first().click();
  await bob.locator("#chatAvatar").click();
  await expect(bob.locator("#removeFriend")).toBeVisible();
  await bob.locator("#removeFriend").click();
  await expect(bob.locator("[data-testid=friend]")).toHaveCount(0);

  await alice.locator("#home").click();
  await bob.locator("#home").click();
  await matchThem(alice, bob);
});

test("every interest is in one scrollable list, not five behind a toggle", async ({ browser }) => {
  const page = await arrive(browser);
  const tiles = page.locator("[data-testid=interest]");
  await expect(tiles.first()).toBeVisible();
  const count = await tiles.count();
  expect(count).toBeGreaterThan(5);

  // The list fits in a fixed-height box and scrolls rather than expanding the page --
  // "Show more" is gone, and there is nothing to click to reveal the rest.
  const overflows = await page
    .locator("#interestTiles")
    .evaluate((node) => node.scrollHeight > node.clientHeight);
  expect(overflows).toBe(true);
  await expect(page.locator("#showOthers")).toHaveCount(0);
});

test("typing a tag and pressing Enter adds it as an ordinary interest", async ({ browser }) => {
  const page = await arrive(browser);
  // #displayName is visible as soon as the session exists, which is before the interest
  // catalogue has finished loading -- counting tiles here without waiting for the first one
  // races that load and can capture zero.
  await expect(page.locator("[data-testid=interest]").first()).toBeVisible();
  const before = await page.locator("[data-testid=interest]").count();

  // A tag nobody has typed before, in this process or an earlier run of this test: the
  // interests table is real, shared, and permanent, so "Competitive Origami" from the last
  // time this suite ran is still sitting in it -- creating it again is a no-op by design (the
  // dedupe test above already proves that) and would leave this count unchanged rather than +1.
  const label = `Competitive Origami ${Date.now()}`;
  await page.locator("#addInterestInput").fill(label);
  await page.locator("#addInterestInput").press("Enter");

  const created = page.locator("[data-interest-id]", { hasText: label });
  await expect(created).toBeVisible();
  // The same element, the same class, the same everything a curated tile gets -- there is no
  // second kind of tile to look different or carry an "x" of its own.
  await expect(created).toHaveAttribute("data-testid", "interest");
  await expect(created).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-testid=interest]")).toHaveCount(before + 1);

  // The box is empty again and ready for the next one -- no separate "Add" button was clicked.
  await expect(page.locator("#addInterestInput")).toHaveValue("");
});
