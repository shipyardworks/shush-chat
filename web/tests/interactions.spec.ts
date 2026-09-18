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

/** Requests live behind an icon in the header, not a permanent section of the sidebar. */
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

const say = async (page: Page, text: string) => {
  await page.locator("#composer").fill(text);
  await page.locator("#send").click();
};

const bubble = (page: Page, text: string) =>
  page.locator("[data-testid=message]").filter({ hasText: text }).first();

test("the sender sees their own image, not just the receiver", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await matchThem(alice, bob);

  await alice.locator("#imageInput").setInputFiles({
    name: "dot.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(alice.locator("#attachmentPreview")).toBeVisible();
  await alice.locator("#sendAttachment").click();

  // The bug: only text was drawn optimistically, so an own image was mapped over nothing and
  // silently never appeared on the sender's own screen.
  await expect(alice.locator("#messages img")).toBeVisible();
  await expect(bob.locator("#messages img")).toBeVisible();
  await expect
    .poll(async () =>
      alice.locator("#messages img").first().evaluate((n: HTMLImageElement) => n.naturalWidth),
    )
    .toBeGreaterThan(0);
});

test("an image is previewed, captioned, and can be abandoned", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await matchThem(alice, bob);

  await alice.locator("#imageInput").setInputFiles({
    name: "dot.png", mimeType: "image/png", buffer: PNG,
  });
  await expect(alice.locator("#attachmentPreview")).toBeVisible();
  await expect(alice.locator("#attachmentImage")).toBeVisible();

  // Choosing the wrong file has to be recoverable, which is the whole reason for a preview.
  await alice.locator("#cancelAttachment").click();
  await expect(alice.locator("#attachmentPreview")).toHaveCount(0);
  await expect(alice.locator("#messages img")).toHaveCount(0);

  await alice.locator("#imageInput").setInputFiles({
    name: "dot.png", mimeType: "image/png", buffer: PNG,
  });
  await alice.locator("#attachmentCaption").fill("look at this");
  await alice.locator("#sendAttachment").click();

  await expect(bob.locator("#messages img")).toBeVisible();
  await expect(bob.locator("#messages")).toContainText("look at this");
});

test("a message appears exactly once on the screen that sent it", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await matchThem(alice, bob);

  await say(alice, "say this once");
  await expect(bob.locator("#messages")).toContainText("say this once");

  // Counted, not "contains". An optimistic bubble that is appended as well as patched shows
  // the message twice, and every containment assertion in this file passes anyway.
  await expect(
    alice.locator("[data-testid=message]").filter({ hasText: "say this once" }),
  ).toHaveCount(1);
  await expect(
    bob.locator("[data-testid=message]").filter({ hasText: "say this once" }),
  ).toHaveCount(1);

  await alice.locator("#imageInput").setInputFiles({
    name: "dot.png", mimeType: "image/png", buffer: PNG,
  });
  await alice.locator("#sendAttachment").click();
  await expect(alice.locator("#messages img")).toHaveCount(1);
  await expect(bob.locator("#messages img")).toHaveCount(1);
});

test("replying quotes the message it answers, on both sides", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await matchThem(alice, bob);

  await say(alice, "the original");
  await expect(bob.locator("#messages")).toContainText("the original");

  await bubble(bob, "the original").click({ button: "right" });
  await bob.locator("[data-testid=menuReply]").click();
  await expect(bob.locator("#replyBar")).toContainText("the original");
  await say(bob, "answering that");

  const quotedForBob = bubble(bob, "answering that").locator("[data-testid=quote]");
  await expect(quotedForBob).toContainText("the original");

  // And it survives the round trip through the log, not just locally.
  const quotedForAlice = bubble(alice, "answering that").locator("[data-testid=quote]");
  await expect(quotedForAlice).toContainText("the original");
});

test("a message opens reactions and three actions together", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await matchThem(alice, bob);
  await say(alice, "four options please");
  await expect(bob.locator("#messages")).toContainText("four options please");

  await bubble(alice, "four options please").click({ button: "right" });
  const menu = alice.locator("[data-testid=messageMenu]");
  await expect(menu.locator("button")).toHaveCount(3);
  // No "React" step: the emoji are already open above the actions.
  await expect(alice.locator("[data-testid=messageActions] [data-testid=emojiPicker]")).toBeVisible();
  await expect(alice.locator("[data-testid=menuReact]")).toHaveCount(0);
  await expect(alice.locator("[data-testid=menuDelete]")).toHaveText("Delete for everyone");

  await alice.keyboard.press("Escape");
  await alice.locator("body").click({ position: { x: 5, y: 5 } });

  // The other person's message offers the same three, with the delete that means the other thing.
  // The dots, not a right-click: both open the same thing.
  await bubble(bob, "four options please").hover();
  await bubble(bob, "four options please")
    .locator("xpath=../..")
    .locator("[data-testid=messageMenuButton]")
    .click();
  await expect(bob.locator("[data-testid=messageActions] [data-testid=emojiPicker]")).toBeVisible();
  await expect(bob.locator("[data-testid=messageMenu]").locator("button")).toHaveCount(3);
  await expect(bob.locator("[data-testid=menuDelete]")).toHaveText("Delete for me");
});

test("reacting shows on both sides and replaces rather than accumulates", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await matchThem(alice, bob);
  await say(alice, "react to me");
  await expect(bob.locator("#messages")).toContainText("react to me");

  await bubble(bob, "react to me").click({ button: "right" });
  await expect(bob.locator("[data-testid=emojiPicker]")).toBeVisible();
  await bob.locator("[data-testid=emojiOption]").first().click();

  await expect(bubble(bob, "react to me").locator("[data-testid=reactions]")).toBeVisible();
  await expect(bubble(alice, "react to me").locator("[data-testid=reactions]")).toBeVisible();

  // Five to start with, and the rest behind a plus.
  await bubble(bob, "react to me").locator("[data-testid=reactions]").click();
  await expect(bob.locator("[data-testid=emojiOption]")).toHaveCount(5);
  await bob.locator("[data-testid=moreEmoji]").click();
  expect(await bob.locator("[data-testid=emojiOption]").count()).toBeGreaterThan(5);
});

test("double click reacts with a heart", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await matchThem(alice, bob);
  await say(alice, "heart me");
  await expect(bob.locator("#messages")).toContainText("heart me");

  await bubble(bob, "heart me").dblclick();
  await expect(bubble(bob, "heart me").locator("[data-testid=reactions]")).toContainText("❤️");
  await expect(bubble(alice, "heart me").locator("[data-testid=reactions]")).toContainText("❤️");
});

test("deleting your own message removes the words for both people", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await matchThem(alice, bob);
  await say(alice, "something regrettable");
  await expect(bob.locator("#messages")).toContainText("something regrettable");

  await bubble(alice, "something regrettable").click({ button: "right" });
  await alice.locator("[data-testid=menuDelete]").click();

  for (const page of [alice, bob]) {
    await expect(page.locator("#messages")).toContainText("This message was deleted");
    await expect(page.locator("#messages")).not.toContainText("something regrettable");
  }
});

test("hiding someone else's message affects only you", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await matchThem(alice, bob);
  await say(alice, "bob will hide this");
  await expect(bob.locator("#messages")).toContainText("bob will hide this");

  await bubble(bob, "bob will hide this").click({ button: "right" });
  await bob.locator("[data-testid=menuDelete]").click();

  // Gone for bob with no placeholder, and untouched for alice.
  await expect(bob.locator("#messages")).not.toContainText("bob will hide this");
  await expect(bob.locator("#messages")).not.toContainText("This message was deleted");
  await expect(alice.locator("#messages")).toContainText("bob will hide this");
});

test("swiping a message opens a reply", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await matchThem(alice, bob);
  await say(alice, "swipe me");
  await expect(bob.locator("#messages")).toContainText("swipe me");

  // Theirs pulls right; the direction is the side the bubble sits on.
  const target = bubble(bob, "swipe me");
  const box = (await target.boundingBox())!;
  await bob.mouse.move(box.x + 20, box.y + box.height / 2);
  await bob.mouse.down();
  await bob.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 10 });
  await bob.mouse.up();
  await expect(bob.locator("#replyBar")).toContainText("swipe me");

  await bob.locator("#cancelReply").click();
  await expect(bob.locator("#replyBar")).toHaveCount(0);

  // And your own pulls the other way.
  await say(bob, "my own message");
  const mine = bubble(bob, "my own message");
  const own = (await mine.boundingBox())!;
  await bob.mouse.move(own.x + own.width - 20, own.y + own.height / 2);
  await bob.mouse.down();
  await bob.mouse.move(own.x + own.width - 120, own.y + own.height / 2, { steps: 10 });
  await bob.mouse.up();
  await expect(bob.locator("#replyBar")).toContainText("my own message");
});

test("every conversation is history, friends or not", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await matchThem(alice, bob);
  await say(alice, "we never became friends");
  await expect(bob.locator("#messages")).toContainText("we never became friends");

  // Nobody kept anybody, and it is still in the list.
  await bob.locator("#home").click();
  await expect(bob.locator("[data-testid=chat]")).toHaveCount(1);
  await expect(bob.locator("[data-testid=chat]").first()).toContainText("we never became friends");
  await openTab(bob, "friends");
  await expect(bob.locator("[data-testid=friend]")).toHaveCount(0);
  await openTab(bob, "chats");

  await bob.locator("[data-testid=chat]").first().click();
  await expect(bob.locator("#messages")).toContainText("we never became friends");
});

test("removing a friend leaves them in the chat list", async ({ browser }) => {
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

  await bob.locator("#chatAvatar").click();
  await bob.locator("#removeFriend").click();

  await expect(bob.locator("[data-testid=friend]")).toHaveCount(0);
  // Not gone -- moved. The friendship ended, the history did not.
  await openTab(bob, "chats");
  await expect(bob.locator("[data-testid=chat]")).toHaveCount(1);
  await expect(bob.locator("#messages")).toContainText("keeping you");
  await expect(bob.locator("#addFriend")).toBeVisible();
});
