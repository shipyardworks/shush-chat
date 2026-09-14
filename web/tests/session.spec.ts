import { expect, test, type Browser, type Page } from "@playwright/test";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAOUlEQVR42u3OMQEAAAgDoK1/aM3g4QcFaEmYs1UEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcGgBXQABBQIcHwAAAABJRU5ErkJggg==",
  "base64",
);

const arrive = async (browser: Browser): Promise<Page> => {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/");
  await page.getByRole("link", { name: "Start chatting" }).click();
  await expect(page.locator("#displayName")).toBeVisible();
  return page;
};

const matchThem = async (a: Page, b: Page) => {
  for (const page of [a, b]) {
    await expect(page.locator("[data-testid=interest]").first()).toBeVisible();
  }
  const id = await a.locator("[data-testid=interest]").first().getAttribute("data-interest-id");
  for (const page of [a, b]) {
    const tile = page.locator(`[data-interest-id="${id}"]`);
    if ((await tile.getAttribute("aria-pressed")) !== "true") await tile.click();
  }
  await a.waitForTimeout(600);
  await a.locator("#findSomeone").click();
  await b.locator("#findSomeone").click();
  await expect(a.locator("#chat")).toBeVisible();
  await expect(b.locator("#chat")).toBeVisible();
};

const say = async (page: Page, text: string) => {
  await page.locator("#composer").fill(text);
  await page.locator("#send").click();
};

/** Requests live behind an icon in the header, not a permanent section of the sidebar. */
const openRequests = async (page: Page) => {
  await page.locator("#requestsButton").click();
};

const openTab = async (page: Page, tab: "chats" | "friends") => {
  await page.locator(tab === "chats" ? "#tabChats" : "#tabFriends").click();
};

test("leaving reaches both people and closes the conversation", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await matchThem(alice, bob);
  await say(alice, "before I go");
  await expect(bob.locator("#messages")).toContainText("before I go");

  await alice.locator("#leave").click();

  // The whole bug: one side was sure, the other was never told.
  await expect(alice.locator("#messages")).toContainText("You left");
  await expect(bob.locator("#messages")).toContainText("They have left");

  // And it is over for both -- no composer to type into.
  for (const page of [alice, bob]) {
    await expect(page.locator("#endedPanel")).toBeVisible();
    await expect(page.locator("#composer")).toHaveCount(0);
    // Asking to keep them is the one thing still on offer.
    await expect(page.locator("#addFriend")).toBeVisible();
    await expect(page.locator("#leave")).toHaveCount(0);
  }
});

test("an ended conversation offers the way to the next one", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await matchThem(alice, bob);
  await alice.locator("#leave").click();
  await expect(bob.locator("#endedPanel")).toBeVisible();

  // The card is right there rather than a link to it: one click to the next person.
  await expect(bob.locator("#endedPanel [data-testid=interest]").first()).toBeVisible();
  await expect(bob.locator("#endedPanel #findSomeone")).toBeVisible();
  await bob.locator("#findSomeoneNext").click();
  await expect(bob.locator("#findSomeone")).toBeVisible();
});

test("the conversation is headed with their name, not 'A stranger'", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  // The name alone: the header button also carries an avatar initial.
  const aliceName = (await alice.locator("[data-testid=myName]").innerText()).trim();
  await matchThem(alice, bob);

  await expect(bob.locator("#chatHeading")).toHaveText(aliceName);
  await expect(bob.locator("#chatSub")).toContainText(/you both like|random match/i);
});

test("a friend request says who it is from", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  const aliceName = (await alice.locator("[data-testid=myName]").innerText()).trim();
  await matchThem(alice, bob);

  await alice.locator("#addFriend").click();
  await expect(bob.locator("[data-testid=requestCount]")).toBeVisible();
  await openRequests(bob);
  await expect(bob.locator("[data-testid=request]")).toContainText(aliceName);
  await expect(bob.locator("[data-testid=request]")).not.toContainText("Someone would like");
});

test("an accepted friend is listed once, under Friends", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await matchThem(alice, bob);
  await say(alice, "keeping you");

  await alice.locator("#addFriend").click();
  await openRequests(bob);
  await bob.getByRole("button", { name: "Accept" }).click();
  await bob.keyboard.press("Escape");
  await openTab(bob, "friends");
  await expect(bob.locator("[data-testid=friend]")).toHaveCount(1);

  // Under Friends, and no longer duplicated under Chats.
  await openTab(bob, "chats");
  await expect(bob.locator("[data-testid=chat]")).toHaveCount(0);
});

test("a photo opens full size", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await matchThem(alice, bob);

  await alice.locator("#imageInput").setInputFiles({
    name: "dot.png", mimeType: "image/png", buffer: PNG,
  });
  await alice.locator("#sendAttachment").click();
  await expect(bob.locator("#messages img")).toBeVisible();

  await bob.locator("[data-testid=openImage]").first().click();
  await expect(bob.locator("#imageViewer")).toBeVisible();
  await bob.keyboard.press("Escape");
  await expect(bob.locator("#imageViewer")).toHaveCount(0);
});

test("a custom tag is shared, not local, and two people typing it are matched on it", async ({
  browser,
}) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);

  // Nothing on this screen claims otherwise any more -- a tag typed here is exactly as shared
  // as a curated one, so there is nothing here to say it is not.
  await expect(alice.locator("text=Only you see these")).toHaveCount(0);
  await expect(alice.locator("text=not used for matching")).toHaveCount(0);

  // A different spelling of the same tag, from someone who has never seen alice's tile.
  await alice.locator("#addInterestInput").fill("Xylophone Repair");
  await alice.locator("#addInterestInput").press("Enter");
  await bob.locator("#addInterestInput").fill("  xylophone repair  ");
  await bob.locator("#addInterestInput").press("Enter");

  const aliceTile = alice.locator("[data-interest-id]", { hasText: "Xylophone Repair" });
  const bobTile = bob.locator("[data-interest-id]", { hasText: "Xylophone Repair" });
  await expect(aliceTile).toBeVisible();
  await expect(bobTile).toBeVisible();
  expect(await aliceTile.getAttribute("data-interest-id")).toBe(
    await bobTile.getAttribute("data-interest-id"),
  );

  // Selected the moment it is created, on both sides, and that shared id is exactly what
  // matching needs -- so the two of them find each other on the strength of it alone.
  await alice.waitForTimeout(400);
  await alice.locator("#findSomeone").click();
  await bob.locator("#findSomeone").click();
  await expect(alice.locator("#chat")).toBeVisible();
  await expect(bob.locator("#chat")).toBeVisible();
  await expect(alice.locator("#chatSub")).toContainText(/you both like/i);
});

test("there is no way to shuffle a name", async ({ browser }) => {
  const page = await arrive(browser);
  await expect(page.locator("#shuffleName")).toHaveCount(0);
  await page.locator("#displayName").click();
  await expect(page.locator("#profileBackdrop")).toBeVisible();
  await expect(page.locator("#shuffleName")).toHaveCount(0);
});

test("the camera control is offered next to the paperclip", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await matchThem(alice, bob);

  await expect(alice.locator("#attach")).toBeVisible();
  await expect(alice.locator("#camera")).toBeVisible();

  // It opens a camera. A file input with capture= only does that on a phone; on a desktop the
  // attribute is ignored and you get the ordinary file picker, which is not a camera.
  await alice.locator("#camera").click();
  await expect(alice.locator("#cameraCapture")).toBeVisible();
  await expect(alice.locator("#shutter")).toBeVisible();
  await alice.locator("#closeCamera").click();
  await expect(alice.locator("#cameraCapture")).toHaveCount(0);
});

test("the message menu opens towards the space that exists", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await matchThem(alice, bob);

  // The last message sits at the bottom of the window, where a menu anchored below would be
  // off-screen -- which is exactly the message people act on most.
  await say(alice, "the very last one");
  await expect(bob.locator("#messages")).toContainText("the very last one");

  const bubble = alice.locator("[data-testid=message]").filter({ hasText: "the very last one" }).first();
  await bubble.click({ button: "right" });
  const menu = alice.locator("[data-testid=messageMenu]");
  await expect(menu).toBeVisible();

  const box = (await menu.boundingBox())!;
  const viewport = alice.viewportSize()!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

  // And it opens beside the dots that summoned it, not across the bubble.
  const dots = (await alice.locator("[data-testid=messageMenuButton]").last().boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - (dots.x + dots.width / 2))).toBeLessThan(220);
});
