import { expect, test, type Browser, type Page } from "@playwright/test";
import { readFileSync } from "fs";

const SHAPES = "/tmp/claude-1000/-home-syam-dev-shush-chat/f1bdcb88-be1c-4dd2-bb2b-dcc1436d3936/scratchpad";
const shape = (name: string) => ({
  name,
  mimeType: "image/png",
  buffer: readFileSync(`${SHAPES}/${name}`),
});

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

/**
 * Every shape, and the caption bar is the thing it must not touch. A grid row sized to its
 * content let a tall photo push straight through it, which no amount of looking at one
 * screenshot of one image would have caught.
 */
for (const file of ["tall.png", "wide.png", "square.png", "small.png"]) {
  test(`the attachment preview fits a ${file.replace(".png", "")} image above the caption`, async ({
    browser,
  }) => {
    const alice = await arrive(browser);
    const bob = await arrive(browser);
    await matchThem(alice, bob);

    await alice.locator("#imageInput").setInputFiles(shape(file));
    await expect(alice.locator("#attachmentPreview")).toBeVisible();
    const image = alice.locator("#attachmentImage");
    await expect(image).toBeVisible();
    await expect.poll(async () => image.evaluate((n: HTMLImageElement) => n.naturalWidth)).toBeGreaterThan(0);

    const shot = (await image.boundingBox())!;
    const caption = (await alice.locator("#attachmentCaption").boundingBox())!;
    const viewport = alice.viewportSize()!;

    expect.soft(shot.y, "top edge on screen").toBeGreaterThanOrEqual(0);
    expect(shot.y + shot.height, "bottom edge clears the caption box").toBeLessThanOrEqual(caption.y);
    expect(shot.x, "left edge on screen").toBeGreaterThanOrEqual(0);
    expect(shot.x + shot.width, "right edge on screen").toBeLessThanOrEqual(viewport.width);
    // A gap, not merely "not overlapping".
    expect(caption.y - (shot.y + shot.height), "gap above the caption").toBeGreaterThanOrEqual(4);
  });
}

for (const file of ["tall.png", "wide.png", "square.png", "small.png"]) {
  test(`a sent ${file.replace(".png", "")} image sits clear of the composer`, async ({ browser }) => {
    const alice = await arrive(browser);
    const bob = await arrive(browser);
    await matchThem(alice, bob);

    await alice.locator("#imageInput").setInputFiles(shape(file));
    await alice.locator("#sendAttachment").click();
    await expect(bob.locator("#messages img")).toBeVisible();

    for (const page of [alice, bob]) {
      const bubble = page.locator("[data-testid=message]").last();
      const box = (await bubble.boundingBox())!;
      const composer = (await page.locator("#composer").boundingBox())!;
      const list = (await page.locator("#messages").boundingBox())!;

      expect(box.height, "bubble fits the message area").toBeLessThanOrEqual(list.height);
      expect(box.y + box.height, "bubble clears the composer").toBeLessThanOrEqual(composer.y);
    }
  });
}

test("the menu opens away from the bubble and stays on screen, wherever the message is", async ({
  browser,
}) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await matchThem(alice, bob);

  // Enough messages that the first is at the top of the viewport and the last at the bottom.
  await say(alice, "the first one");
  for (let i = 0; i < 14; i += 1) await say(alice, `filler ${i}`);
  await say(bob, "theirs at the bottom");
  await expect(alice.locator("#messages")).toContainText("theirs at the bottom");

  const check = async (page: Page, text: string, mine: boolean) => {
    const bubble = page.locator("[data-testid=message]").filter({ hasText: text }).first();
    await bubble.scrollIntoViewIfNeeded();
    await bubble.hover();
    const dots = bubble.locator("xpath=../..").locator("[data-testid=messageMenuButton]");
    await dots.click();

    const menu = page.locator("[data-testid=messageMenu]");
    await expect(menu).toBeVisible();
    const box = (await menu.boundingBox())!;
    const dotsBox = (await dots.boundingBox())!;
    const viewport = page.viewportSize()!;

    // Fully on screen, both axes.
    expect.soft(box.x, `${text}: left edge`).toBeGreaterThanOrEqual(0);
    expect.soft(box.x + box.width, `${text}: right edge`).toBeLessThanOrEqual(viewport.width);
    expect.soft(box.y, `${text}: top edge`).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, `${text}: bottom edge`).toBeLessThanOrEqual(viewport.height);

    // And on the side away from the bubble.
    if (mine) {
      expect(box.x + box.width, `${text}: opens left of the dots`).toBeLessThanOrEqual(dotsBox.x + 2);
    } else {
      expect(box.x, `${text}: opens right of the dots`).toBeGreaterThanOrEqual(dotsBox.x + dotsBox.width - 2);
    }

    await page.keyboard.press("Escape");
    await page.locator("#messages").click({ position: { x: 5, y: 5 } });
  };

  await check(alice, "theirs at the bottom", false); // their message, bottom of the screen
  await check(alice, "filler 13", true); // mine, near the bottom
  await check(alice, "the first one", true); // mine, scrolled to the top
});

test("jumping to a quoted message does not snap back to the bottom", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await matchThem(alice, bob);

  await say(alice, "the very first thing");
  for (let i = 0; i < 16; i += 1) await say(alice, `filler ${i}`);
  await expect(bob.locator("#messages")).toContainText("filler 15");

  const original = bob.locator("[data-testid=message]").filter({ hasText: "the very first thing" }).first();
  await original.scrollIntoViewIfNeeded();
  await original.click({ button: "right" });
  await bob.locator("[data-testid=menuReply]").click();
  await say(bob, "answering the first");

  await bob
    .locator("[data-testid=message]")
    .filter({ hasText: "answering the first" })
    .first()
    .locator("[data-testid=quote]")
    .click();

  await expect.poll(async () => original.evaluate((n) => n.getBoundingClientRect().top)).toBeGreaterThan(0);

  // Wait for the smooth scroll to stop before recording where it landed. Reading mid-flight
  // and comparing later is a race in the test, not a snap-back in the app.
  const settled = async () => {
    let previous = -1;
    for (let i = 0; i < 40; i += 1) {
      const now = await bob.locator("#messages").evaluate((n) => n.scrollTop);
      if (now === previous) return now;
      previous = now;
      await bob.waitForTimeout(100);
    }
    return previous;
  };
  const landed = await settled();

  // The flash clears on a timer; the list used to follow it straight back down.
  await bob.waitForTimeout(2600);
  const after = await bob.locator("#messages").evaluate((n) => n.scrollTop);
  expect(Math.abs(after - landed), "stayed where it was put").toBeLessThan(40);
});

test("the camera button opens a camera, not a file picker", async ({ browser }) => {
  const context = await browser.newContext({ permissions: ["camera"] });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("link", { name: "Start chatting" }).click();
  const other = await arrive(browser);
  await matchThem(page, other);

  await page.locator("#camera").click();
  await expect(page.locator("#cameraCapture")).toBeVisible();
  await expect(page.locator("#cameraPreview")).toBeVisible();
  await expect(page.locator("#shutter")).toBeVisible();

  // A live frame, from the fake device the browser was started with.
  await expect
    .poll(async () => page.locator("#cameraPreview").evaluate((n: HTMLVideoElement) => n.videoWidth), {
      timeout: 15000,
    })
    .toBeGreaterThan(0);

  await page.locator("#shutter").click();
  // Straight into the same preview every other image goes through.
  await expect(page.locator("#attachmentPreview")).toBeVisible();
  await page.locator("#sendAttachment").click();
  await expect(other.locator("#messages img")).toBeVisible();
});
