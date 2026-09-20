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

/**
 * Freezes the "what are you into?" ticker for this page.
 *
 * A tile there is a real, clickable button the whole time it streams past -- pausing it here is
 * only about giving a scripted click a still target to land on, the same reason a real person
 * hovers before clicking one. It changes nothing about what is being tested: selection state,
 * not motion.
 */
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
    // "Forever", because these tests are about what happens once two people are talking, not
    // about how long the dial waits. Five seconds is a promise the server now keeps -- it ends
    // the search and says nobody is around -- and under a loaded suite the second click can
    // land after the first one's window has closed, which would fail as "matching is broken".
    await page.getByRole("button", { name: "Forever" }).click();
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
  await expect(bob.locator("#messages")).toContainText(
    `${(await bob.locator("#chatHeading").textContent())!.trim()} left.`,
  );

  // And it is over for both -- no composer to type into.
  for (const page of [alice, bob]) {
    await expect(page.locator("#endedPanel")).toBeVisible();
    await expect(page.locator("#composer")).toHaveCount(0);
    // Asking to keep them is the one thing still on offer.
    await expect(page.locator("#addFriend")).toBeVisible();
    await expect(page.locator("#leave")).toHaveCount(0);
  }
});

test("an ended conversation offers the way to the next one, inside the conversation", async ({
  browser,
}) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await matchThem(alice, bob);
  await alice.locator("#leave").click();
  await expect(bob.locator("#endedPanel")).toBeVisible();

  // Nothing but the fact and a button -- the picker itself is not here, so the ended thread
  // never grows a scrolling picker of its own the way it used to.
  await expect(bob.locator("#endedPanel [data-testid=interest]")).toHaveCount(0);
  await expect(bob.locator("#findSomeoneModal")).toHaveCount(0);

  // That it is over is said once, in the thread -- the footer is only the way on.
  await expect(bob.locator("#endedPanel")).not.toContainText("over");
  await expect(bob.locator("#messages")).toContainText(
    `${(await bob.locator("#chatHeading").textContent())!.trim()} left.`,
  );

  // One click opens the picker -- the same panel the start screen shows, already searching.
  // Escape closes it and stops the search.
  await bob.locator("#findSomeoneNext").click();
  await expect(bob.locator("#findSomeoneModal [data-testid=interest]").first()).toBeVisible();
  await expect(bob.locator("#findSomeoneModal #findSomeone")).toHaveAttribute("aria-busy", "true");
  await expect(bob.locator("#messages")).toBeVisible();
  await bob.keyboard.press("Escape");
  await expect(bob.locator("#findSomeoneModal")).toHaveCount(0);
  await expect(bob.locator("#endedPanel")).toBeVisible();
});

test("the conversation is headed with their name, not 'Someone'", async ({ browser }) => {
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
  await bob.locator("#requestsPanel").getByRole("button", { name: "Accept" }).click();
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

/**
 * A typed tag is a real shared row -- and still nobody else's clutter.
 *
 * <p>It used to be neither: kept in this browser under a negative id that was stripped out
 * before any request, so it could never match anyone. It is created on the server now, which
 * is what lets two people who typed the same word be paired on it
 * (setup.spec.ts, "two people who type the same interest are matched on it"). What has not
 * changed is that it is not *offered* to anyone: nothing typed is put into the catalogue
 * others browse, so Bob's screen is exactly as it was.
 */
test("a typed tag is shared enough to match on, and still not on anybody else's screen", async ({
  browser,
}) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);

  const raw = "Xylophone Repair";
  const normalised = "xylophonerepair";
  await alice.locator("#addInterestInput").fill(raw);
  await alice.locator("#addInterestInput").press("Enter");

  const aliceTile = alice.locator("[data-testid=interest]", { hasText: normalised });
  await expect(aliceTile).toBeVisible();
  await expect(aliceTile).toHaveAttribute("aria-pressed", "true");

  // Bob never typed it, so it is not on his screen: a tag somebody invented is matchable, not
  // promoted into the list of things to pick from.
  await expect(bob.locator("[data-testid=interest]", { hasText: normalised })).toHaveCount(0);

  // This browser remembers it...
  await alice.reload();
  await expect(alice.locator("[data-testid=interest]").first()).toBeVisible();
  await expect(alice.locator("[data-testid=interest]", { hasText: normalised })).toBeVisible();

  // ...until it is removed from this browser's list, which is the only way it leaves the
  // screen -- the row itself stays, because somebody else may be matching on it right now.
  await alice.locator("[data-testid=interest]", { hasText: normalised }).click({ force: true });
  await expect(alice.locator("[data-testid=interest]", { hasText: normalised })).toHaveCount(0);
  await alice.reload();
  await expect(alice.locator("[data-testid=interest]").first()).toBeVisible();
  await expect(alice.locator("[data-testid=interest]", { hasText: normalised })).toHaveCount(0);
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

test("an ended conversation reopened from the list says so in the thread, and only offers add friend", async ({
  browser,
}) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await matchThem(alice, bob);
  await say(alice, "one thing before I go");
  await expect(bob.locator("#messages")).toContainText("one thing before I go");
  await alice.locator("#leave").click();
  await expect(bob.locator("#endedPanel")).toBeVisible();

  // History arrives slowly, so the loading state is there to be seen.
  await bob.route("**/api/conversations/*/messages**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await bob.locator("#home").click();
  await bob.locator("[data-testid=chat]").first().click();
  await expect(bob.locator("#messagesLoading")).toBeVisible();
  await expect(bob.locator("#messages")).toContainText("one thing before I go");
  await expect(bob.locator("#messagesLoading")).toHaveCount(0);

  await expect(bob.locator("#messages")).toContainText("This conversation is over.");
  await expect(bob.locator("#endedPanel")).not.toContainText("over");
  await expect(bob.locator("#composer")).toHaveCount(0);
  await expect(bob.locator("#leave")).toHaveCount(0);
  await expect(bob.locator("#addFriend")).toBeVisible();
});

test("the composer is a text box with icon buttons, and shift-enter makes a new line", async ({
  browser,
}) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await matchThem(alice, bob);

  // A textarea: iOS never offers its password / card / address bar above one.
  expect(await alice.locator("#composer").evaluate((node) => node.tagName)).toBe("TEXTAREA");
  await expect(alice.locator("#send")).toHaveText("");
  await expect(alice.locator("#send")).toHaveAttribute("aria-label", "Send");
  const send = (await alice.locator("#send").boundingBox())!;
  expect(send.width).toBeLessThanOrEqual(44);

  await alice.locator("#composer").click();
  await alice.keyboard.type("first line");
  await alice.keyboard.press("Shift+Enter");
  await alice.keyboard.type("second line");
  await alice.keyboard.press("Enter");
  const message = bob.locator("[data-testid=message]").filter({ hasText: "first line" });
  await expect(message).toContainText("second line");
  const lines = await message.locator("div.whitespace-pre-wrap").evaluate(
    (node) => node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight),
  );
  expect(lines).toBeGreaterThan(1.5);
  await expect(alice.locator("#composer")).toHaveValue("");
});
