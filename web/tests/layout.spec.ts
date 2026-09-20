import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { crc32, deflateSync } from "zlib";

/**
 * The four aspect ratios, drawn here rather than read off disk.
 *
 * <p>These used to be `readFileSync` against an absolute path under /tmp belonging to the
 * machine they were first written on. The files were never in the repository, so every one of
 * these eight tests failed with ENOENT anywhere else -- including on the next clone of this
 * one. A fixture a test cannot run without belongs either in the repo or in the test; a
 * generated one needs no bytes committed and cannot go missing.
 *
 * <p>What matters to these assertions is the shape, not the picture: a tall image must not
 * push through its caption, a wide one must not run off the side. So it is one flat colour,
 * and the size is the whole point of each.
 */
const SHAPES: Record<string, [number, number]> = {
  "tall.png": [240, 1400],
  "wide.png": [1600, 260],
  "square.png": [900, 900],
  "small.png": [24, 24],
};

/** A minimal, valid PNG: one IHDR, one IDAT of opaque mid-grey, one IEND. */
const png = (width: number, height: number): Buffer => {
  const chunk = (type: string, body: Buffer) => {
    const typed = Buffer.concat([Buffer.from(type, "ascii"), body]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(typed) >>> 0);
    return Buffer.concat([length, typed, checksum]);
  };

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour, no alpha

  // Each scanline is a one-byte filter marker (0, none) then RGB per pixel.
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x60)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

const shape = (name: string) => ({
  name,
  mimeType: "image/png",
  buffer: png(...SHAPES[name]),
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

/* ---------------------------------------------------------------------------
   The phone shell. Everything below runs at iPhone width, because every one of
   these was a bug that only existed there.
   --------------------------------------------------------------------------- */

const arriveOnPhone = async (browser: Browser): Promise<Page> => {
  const page = await (await browser.newContext({ ...devices["iPhone 13"] })).newPage();
  await page.goto("/");
  await page.getByRole("link", { name: "Start chatting" }).click();
  await expect(page.locator("#displayName")).toBeVisible();
  return page;
};

const widerThanTheScreen = (page: Page) =>
  page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    /**
     * Inside something that scrolls sideways on purpose, being wider than the screen is the
     * feature -- the interest strip is a row of tiles far wider than any phone. What matters
     * is whether anything widens the *page*, so an element with a scrolling ancestor is not a
     * culprit however far past the edge it sits.
     */
    const contained = (node: HTMLElement) => {
      // Stops at body: the page-level `overflow-x: hidden` is the backstop this is meant to
      // check is unnecessary, so counting it as containment would make the check vacuous --
      // every element on the page is inside body, and nothing could ever be reported.
      for (let at = node.parentElement; at && at !== document.body; at = at.parentElement) {
        const overflow = getComputedStyle(at).overflowX;
        if (overflow === "auto" || overflow === "scroll" || overflow === "hidden") return true;
      }
      return false;
    };
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: width,
      /** Named rather than counted, so a failure says which element to go and look at. */
      culprits: [...document.querySelectorAll<HTMLElement>("body *")]
        .filter((node) => node.getBoundingClientRect().right > width + 1 && !contained(node))
        .slice(0, 5)
        .map((node) => `${node.tagName.toLowerCase()}#${node.id || "-"}.${node.className || "-"}`),
    };
  });

/**
 * The page is the width of the phone and cannot be dragged sideways.
 *
 * Something wider than the viewport turned the whole document into a horizontally scrollable
 * canvas: the header slid off to the left and the send button sat past the right edge, with
 * nothing on screen to explain it. `overflow-x: hidden` is the backstop; this is the check
 * that nothing is relying on it.
 */
test("nothing on a phone is wider than the phone", async ({ browser }) => {
  const alice = await arriveOnPhone(browser);
  const bob = await arriveOnPhone(browser);

  // Only the named list is meaningful: `document.scrollWidth` is clamped by the page-level
  // clip, so it reads as fitting whether or not anything inside actually does.
  // This check is only worth its green if it can go red, and the page-level clip is exactly
  // the kind of thing that quietly stops it being able to. Prove it on something that really
  // does stick out, then take it away again.
  await alice.evaluate(() => {
    const canary = document.createElement("div");
    canary.id = "overflowCanary";
    canary.style.cssText = "width:3000px;height:4px";
    document.body.append(canary);
  });
  expect(
    (await widerThanTheScreen(alice)).culprits.join(),
    "the check can see something that overflows",
  ).toContain("overflowCanary");
  await alice.evaluate(() => document.querySelector("#overflowCanary")!.remove());

  const onSetup = await widerThanTheScreen(alice);
  expect(onSetup.culprits, "nothing on the setup screen relies on the page clipping it").toEqual([]);

  await matchThem(alice, bob);
  await say(alice, "a message long enough to be worth wrapping in a bubble on a narrow screen");
  // The classic way a chat page ends up wider than the screen: one token with nowhere to
  // break. A link somebody pasted is the everyday version of this.
  await say(alice, `https://example.com/${"a".repeat(180)}`);
  await expect(alice.locator("[data-testid=message]").last()).toBeVisible();

  const inChat = await widerThanTheScreen(alice);
  expect(inChat.culprits, "nothing in a conversation relies on the page clipping it").toEqual([]);

  // The one that gave it away: send was drawn off the right edge and could not be tapped.
  const send = (await alice.locator("#send").boundingBox())!;
  expect(send.x + send.width, "send is on screen").toBeLessThanOrEqual(inChat.clientWidth);
  expect(send.x, "send is not off the left either").toBeGreaterThanOrEqual(0);
});

/** More room for the conversation: the name bar gets out of the way while you read. */
test("the chat header scrolls away on a phone and comes back on the way up", async ({
  browser,
}) => {
  const alice = await arriveOnPhone(browser);
  const bob = await arriveOnPhone(browser);
  await matchThem(alice, bob);

  for (let i = 0; i < 14; i++) await say(alice, `line ${i}`);

  const head = alice.locator(".chat-head");
  // getBoundingClientRect, not boundingBox(): Playwright calls a zero-height element invisible
  // and hands back null, which is the one measurement this test most needs to be able to take.
  const height = () => head.evaluate((node) => node.getBoundingClientRect().height);

  expect(await height(), "the header is there to begin with").toBeGreaterThan(0);

  // A message arriving also scrolls this list, and in the same direction. It must not count:
  // the header vanishing because the other person spoke is not the reader scrolling.
  await say(bob, "and one from the other side");
  await expect(alice.locator("[data-testid=message]").last()).toContainText("other side");
  expect(await height(), "a new message is not someone scrolling").toBeGreaterThan(0);

  // One move at a time, each waited out before the next. Two jumps issued back to back are
  // coalesced into a single scroll event at the final position, and a test that depends on
  // which way the browser felt like reporting that is a test that fails one run in five.
  const messages = alice.locator("#messages");
  const scrollTo = async (where: "top" | "bottom") => {
    await messages.evaluate((node, to) => {
      node.scrollTop = to === "top" ? 0 : node.scrollHeight;
    }, where);
    await expect
      .poll(() =>
        messages.evaluate((node, to) =>
          to === "top" ? node.scrollTop < 1 : node.scrollHeight - node.scrollTop - node.clientHeight < 2,
        where),
      )
      .toBe(true);
    // Two frames, so the scroll event that jump produced has been dispatched and handled.
    await alice.evaluate(
      () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
    );
  };

  await scrollTo("top");
  await scrollTo("bottom");
  await expect(head).toHaveAttribute("data-collapsed", "true");
  await expect.poll(height).toBeLessThan(2);

  // ...and back the moment the reader goes the other way. A header that will not return is
  // worse than one that never left.
  await scrollTo("top");
  await expect(head).toHaveAttribute("data-collapsed", "false");
  await expect.poll(height).toBeGreaterThan(0);
});

/**
 * One control, one meaning. The chat used to offer "<", which promised to leave the
 * conversation and instead opened a drawer over it -- and opening that drawer brought the app
 * header back, so the page appeared to change its header on the way in.
 */
test("a burger opens a full-height drawer, and the header does not change under it", async ({
  browser,
}) => {
  const alice = await arriveOnPhone(browser);
  const bob = await arriveOnPhone(browser);

  // The setup screen offers the burger in the app header, and no back arrow of its own.
  await expect(alice.locator("#openDrawer")).toBeVisible();
  await expect(alice.locator("#setupBack")).toHaveCount(0);

  await matchThem(alice, bob);

  const header = alice.locator("header");
  await expect(header, "a conversation owns the phone screen").toBeHidden();

  await alice.locator("#chatBack").click();
  const drawer = alice.locator("#sidebar");
  await expect(drawer).toBeVisible();

  // The whole height, from the very top -- not starting below a header that reappeared to
  // make room for it.
  const box = (await drawer.boundingBox())!;
  expect(box.y, "the drawer starts at the top of the screen").toBeLessThanOrEqual(0);
  expect(box.height).toBeGreaterThanOrEqual(alice.viewportSize()!.height - 1);
  await expect(header, "and the header still has not come back").toBeHidden();
});

/** The message box takes the width; both attachment buttons live inside it. */
test("the paperclip sits inside the message box, beside the camera", async ({ browser }) => {
  const alice = await arriveOnPhone(browser);
  const bob = await arriveOnPhone(browser);
  await matchThem(alice, bob);

  const box = (await alice.locator(".composer").boundingBox())!;
  const attach = (await alice.locator("#attach").boundingBox())!;
  const camera = (await alice.locator("#camera").boundingBox())!;

  for (const [name, button] of [["paperclip", attach], ["camera", camera]] as const) {
    expect(button.x, `${name} is inside the box`).toBeGreaterThanOrEqual(box.x - 1);
    expect(button.x + button.width).toBeLessThanOrEqual(box.x + box.width + 1);
  }
  expect(attach.x, "paperclip is to the left of the camera").toBeLessThan(camera.x);

  // Worth the move: the box is nearly the whole width now.
  expect(box.width).toBeGreaterThan(alice.viewportSize()!.width * 0.7);
});

/**
 * Both icons are built on a person, and each says what it is for beyond that.
 *
 * <p>The requests button used to be a bare person, which named who it was about and nothing
 * about why it was a button -- it now sits in an envelope. Add friend keeps its plus. What
 * this guards is that neither is a plain figure and that they are not the same drawing.
 */
test("the requests and add-friend icons each say more than just person", async ({ browser }) => {
  const alice = await arriveOnPhone(browser);
  const bob = await arriveOnPhone(browser);
  await matchThem(alice, bob);

  const paths = (page: Page, id: string) => page.locator(`${id} svg path`).count();
  // One person in each, drawn the same way: a head, a body, and one mark that says which of
  // the three things this is. Requests carries its mark as a second circle, add-friend as a
  // plus. The envelope this replaced was three shapes fighting for eighteen pixels.
  expect(await alice.locator("#requestsButton svg circle").count(), "a head and a badge").toBe(2);
  expect(await alice.locator("#addFriend svg circle").count()).toBe(1);
  expect(await paths(alice, "#requestsButton"), "the person's body").toBe(1);
  expect(await paths(alice, "#addFriend"), "a plus beside the person").toBeGreaterThan(1);

  const requests = await alice.locator("#requestsButton svg").innerHTML();
  const addFriend = await alice.locator("#addFriend svg").innerHTML();
  expect(requests, "two different jobs should not be one drawing").not.toBe(addFriend);
});

/**
 * No empty band under the composer when the viewport changes size.
 *
 * <p>The shell is sized from `window.visualViewport`, because iOS Safari does not shrink
 * `dvh` for the on-screen keyboard. iOS reports that viewport *during* the keyboard
 * transition, and the bottom browser toolbar collapses on a different frame from the keyboard
 * rising -- so a single reading taken mid-flight is short by about the toolbar's height and
 * the shell keeps it. What that looked like was a strip of dead page between the message box
 * and the keyboard, every time the box was tapped.
 *
 * <p>A headless browser has no keyboard to raise, so this drives the same handler the only
 * other way it is ever driven -- the visible viewport changing height -- and asserts the thing
 * that was actually wrong: the app stops short of the bottom of what can be seen.
 */
test("the shell fills the visible viewport after it changes size", async ({ browser }) => {
  const alice = await arriveOnPhone(browser);
  const bob = await arriveOnPhone(browser);
  await matchThem(alice, bob);

  const reachesTheBottom = async () =>
    alice.evaluate(() => {
      const seen = window.visualViewport?.height ?? window.innerHeight;
      const declared = getComputedStyle(document.documentElement).getPropertyValue("--app-height");
      const composer = document.querySelector("#composer")!.getBoundingClientRect();
      return { seen, declared: parseFloat(declared), gapUnderComposer: seen - composer.bottom };
    });

  for (const height of [420, 560, 664]) {
    await alice.setViewportSize({ width: 390, height });
    await expect
      .poll(async () => Math.abs((await reachesTheBottom()).declared - height) < 2)
      .toBe(true);

    const state = await reachesTheBottom();
    expect(state.declared, `sized to what is visible at ${height}`).toBeCloseTo(state.seen, 0);
    // The composer is the last thing in the shell, so anything below it is the dead band.
    expect(state.gapUnderComposer, `no empty band under the composer at ${height}`).toBeLessThan(24);
  }
});

/**
 * "Asked already" has to be legible on a phone, where the words are not there to say it.
 *
 * <p>The button was disabled the whole time -- the server has always deduped a second ask --
 * but on a narrow screen the only sign of it was a greyed-out plus, which reads as "not
 * available" rather than "you already did this". So the plus becomes a tick, and the greying
 * goes: a dimmed control says the app is refusing, and this one is reporting.
 */
test("on a phone, asking to keep someone turns the plus into a tick", async ({ browser }) => {
  const alice = await arriveOnPhone(browser);
  const bob = await arriveOnPhone(browser);
  await matchThem(alice, bob);

  const button = alice.locator("#addFriend");
  const plus = await button.locator("svg").innerHTML();
  await expect(button).toBeEnabled();
  await expect(button).toHaveAttribute("data-sent", "false");
  // The words are the desktop half of this, and they are not on screen here.
  await expect(button.locator("span")).toBeHidden();

  await button.click();

  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute("data-sent", "true");
  await expect(button).toHaveAttribute("aria-label", "Request sent");
  const tick = await button.locator("svg").innerHTML();
  expect(tick, "a different icon, not the same one greyed out").not.toBe(plus);
  // Readable, not faded into the header -- being told is not the same as being blocked.
  const opacity = await button.evaluate((node) => parseFloat(getComputedStyle(node).opacity));
  expect(opacity).toBeGreaterThan(0.9);
});

/** The same state, said in words, on a screen wide enough to hold them. */
test("on a wide screen, asking to keep someone says so in words", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await matchThem(alice, bob);

  const button = alice.locator("#addFriend");
  await expect(button).toContainText("Add friend");
  await button.click();
  await expect(button).toContainText("Request sent");
  await expect(button).toBeDisabled();
});

/**
 * The picker's close shares the heading's line.
 *
 * <p>It used to sit on a row of its own above it. On a 390px screen that row is a band of
 * nothing with one button in it, above a panel that is already fighting for height against the
 * interests, the patience dial and the button underneath them.
 */
test("the picker's close button sits on the heading's own line", async ({ browser }) => {
  const alice = await arriveOnPhone(browser);
  const bob = await arriveOnPhone(browser);
  await matchThem(alice, bob);
  await alice.locator("#leave").click();
  await bob.locator("#findSomeoneNext").click();

  const modal = bob.locator("#findSomewhereElse");
  await expect(modal).toBeVisible();
  const close = (await modal.locator("#closePicker").boundingBox())!;
  const heading = (await modal.getByText("What are you into?").boundingBox())!;

  // Same line: each one's vertical span overlaps the other's.
  expect(close.y).toBeLessThan(heading.y + heading.height);
  expect(heading.y).toBeLessThan(close.y + close.height);
  // And the close is the thing on the right of it, not stacked above.
  expect(close.x).toBeGreaterThan(heading.x + heading.width);

  await modal.locator("#closePicker").click();
  await expect(modal).toHaveCount(0);
});

/** Nothing above the photo but a way out of it. */
test("the image viewer offers only close", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await matchThem(alice, bob);

  await alice.locator("#imageInput").setInputFiles(shape("square.png"));
  await alice.locator("#sendAttachment").click();
  await expect(alice.locator("#messages img")).toBeVisible();
  await alice.locator("[data-testid=openImage]").first().click();

  const viewer = alice.locator("#imageViewer");
  await expect(viewer).toBeVisible();
  await expect(viewer.locator("#closeImageViewer")).toBeVisible();
  await expect(viewer.getByRole("link", { name: "Open" })).toHaveCount(0);
  await expect(viewer.locator("a")).toHaveCount(0);
});

/**
 * A long press on a message belongs to the app, not to the browser.
 *
 * <p>Holding a bubble opens reactions and the actions menu. iOS Safari's own long press
 * selects the word under the finger and raises Copy | Search with Google over the top of it,
 * so both menus opened at once and the app's was the one that went away. Copy is already in
 * the app's menu and copies the whole message rather than one word, so nothing is lost by
 * taking the gesture -- on touch. A mouse keeps native selection, which is a different gesture
 * with nothing to collide with.
 */
test("a message bubble is not selectable by a long press on touch", async ({ browser }) => {
  const alice = await arriveOnPhone(browser);
  const bob = await arriveOnPhone(browser);
  await matchThem(alice, bob);
  await say(alice, "hold me");

  const bubble = alice.locator("#messages .bubble").last();
  await expect(bubble).toBeVisible();
  const style = await bubble.evaluate((node) => {
    const own = getComputedStyle(node);
    const inner = node.querySelector("div");
    return {
      select: own.userSelect || own.webkitUserSelect,
      innerSelect: inner ? getComputedStyle(inner).userSelect : "none",
    };
  });
  expect(style.select).toBe("none");
  expect(style.innerSelect, "the text inside it too, not just the box").toBe("none");

  /*
   * `-webkit-touch-callout` is the half of this only iOS can enforce -- Blink does not
   * implement it, so `getComputedStyle` here reports nothing whatever the stylesheet says.
   * What is checkable in this browser is that the declaration actually shipped: it is the
   * rule that stops iOS raising a share sheet over a photo being tapped, and a build step
   * quietly dropping it as unknown is exactly the failure this would otherwise miss.
   */
  const declared = await alice.evaluate(async () => {
    // The served bytes, not the CSSOM: Blink drops a declaration it does not implement while
    // parsing, so `cssRules` cannot see this one however correctly it shipped.
    const sheets = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')];
    const bodies = await Promise.all(sheets.map((link) => fetch(link.href).then((r) => r.text())));
    return bodies.some((css) => css.includes("-webkit-touch-callout"));
  });
  expect(declared, "the iOS-only half of this is in the stylesheet").toBe(true);

  // And the app's own menu is what a long press produces.
  await bubble.dispatchEvent("pointerdown", { pointerType: "touch", clientX: 40, clientY: 40 });
  await expect(alice.getByRole("button", { name: "Reply" })).toBeVisible();
});

/** A mouse is a different gesture, and copying part of a message is a real thing people do. */
test("a message bubble stays selectable with a mouse", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await matchThem(alice, bob);
  await say(alice, "select me");

  const bubble = alice.locator("#messages .bubble").last();
  const select = await bubble.evaluate((node) => getComputedStyle(node).userSelect);
  expect(select).not.toBe("none");
});

/**
 * A photo that is gone on purpose says so.
 *
 * <p>A shared image is deleted once its retention window is up -- `shush.storage.*-retention`
 * in `application.yml`. So a photo that will not load has often not failed at all, it has
 * expired; and "Photo unavailable" over a deliberate expiry reads as the app being broken,
 * which is how it was reported. The window itself is guarded in `RetentionJobsIT`; what is
 * guarded here is only what the bubble says when the object is gone.
 *
 * <p>The API answering 404 is what "the object has been reaped" looks like from the browser
 * (`unknown_media`), so that is what is served here. Nothing about the client is stubbed.
 */
test("an expired photo says it expired, not that it is unavailable", async ({ browser }) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await bob.route("**/api/media/**", (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: '{"code":"unknown_media"}' }),
  );
  await matchThem(alice, bob);

  await alice.locator("#imageInput").setInputFiles(shape("square.png"));
  await alice.locator("#sendAttachment").click();

  const fallback = bob.locator("[data-testid=imageFallback]");
  await expect(fallback).toBeVisible();
  await expect(fallback).toHaveText(/expired/i);
});

/** Anything else is still just "unavailable" -- the app must not blame retention for a fault. */
test("a photo that fails for any other reason does not claim to have expired", async ({
  browser,
}) => {
  const alice = await arrive(browser);
  const bob = await arrive(browser);
  await bob.route("**/api/media/**", (route) => route.fulfill({ status: 500, body: "" }));
  await matchThem(alice, bob);

  await alice.locator("#imageInput").setInputFiles(shape("square.png"));
  await alice.locator("#sendAttachment").click();

  const fallback = bob.locator("[data-testid=imageFallback]");
  await expect(fallback).toBeVisible();
  await expect(fallback).toHaveText(/unavailable/i);
});

/**
 * Leave is at the near edge of the conversation, not out in the far corner.
 *
 * <p>Leaving is the first half of finding somebody else, and the two presses that end one
 * conversation and start the next should be next to each other. On a phone the right-hand end
 * of a header is the corner a thumb reaches last.
 */
test("leave sits at the left of the chat, before the name", async ({ browser }) => {
  const alice = await arriveOnPhone(browser);
  const bob = await arriveOnPhone(browser);
  await matchThem(alice, bob);

  const leave = (await alice.locator("#leave").boundingBox())!;
  const avatar = (await alice.locator("#chatAvatar").boundingBox())!;
  const addFriend = (await alice.locator("#addFriend").boundingBox())!;

  expect(leave.x + leave.width).toBeLessThanOrEqual(avatar.x + 1);
  expect(leave.x).toBeLessThan(addFriend.x);
  // And it is still gone once the conversation is over -- there is nothing left to leave.
  await alice.locator("#leave").click();
  await expect(alice.locator("#leave")).toHaveCount(0);
});

/**
 * A text field on a phone is 16px, and the page therefore does not zoom when one is focused.
 *
 * <p>iOS Safari scales the whole page up when a field smaller than that takes focus, and does
 * not scale back afterwards -- which is why the header buttons ended up half off the right
 * edge the moment somebody started typing, with nothing about the layout actually wrong. The
 * body text here is 15px, so every field has to say otherwise for itself.
 */
test("a phone's text fields are big enough not to trigger a zoom", async ({ browser }) => {
  const alice = await arriveOnPhone(browser);
  const bob = await arriveOnPhone(browser);

  const size = (page: Page, selector: string) =>
    page.locator(selector).evaluate((node) => parseFloat(getComputedStyle(node).fontSize));

  expect(await size(alice, "#addInterestInput")).toBeGreaterThanOrEqual(16);

  await matchThem(alice, bob);
  expect(await size(alice, "#composer")).toBeGreaterThanOrEqual(16);

  // Focusing it changes nothing about the width of the page, which is what a zoom would.
  const before = await alice.evaluate(() => document.documentElement.clientWidth);
  await alice.locator("#composer").tap();
  await alice.locator("#composer").fill("hi");
  expect(await alice.evaluate(() => document.documentElement.clientWidth)).toBe(before);
});

/**
 * Light mode has a page, a card on it, and controls on the card -- three steps you can see.
 *
 * <p>It was drawn at about two percent between the page and the panel, so a card that is
 * genuinely raised off the page read as a hand-drawn rectangle and every tile on it looked
 * flat. Luminance rather than any particular colour: the rule is that the steps exist.
 */
test("light mode separates the page, the panel and the controls", async ({ browser }) => {
  const page = await arrive(browser);
  await page.locator("#themeToggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  // Chrome reports a color-mix() background as `color(srgb 1 1 1 / 0.92)` -- components on a
  // 0-1 scale -- and a plain one as `rgb(230, 233, 243)`. Both are read here, because getting
  // that wrong reports a white panel as almost black and the test then "passes" on nonsense.
  const luminance = async (selector: string) =>
    page.locator(selector).evaluate((node) => {
      const parts = getComputedStyle(node).backgroundColor.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      const [r, g, b] = parts.every((one) => one <= 1) ? parts.map((one) => one * 255) : parts;
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    });

  const body = await luminance("body");
  const panel = await luminance(".panel");
  const tile = await luminance("#interestTicker [data-testid=interest] >> nth=0");

  expect(panel, "the card is lighter than the page it sits on").toBeGreaterThan(body + 0.02);
  expect(tile, "and a control on the card is darker than the card").toBeLessThan(panel - 0.01);
});
