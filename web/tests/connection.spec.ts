import {
  devices,
  expect,
  test,
  type Browser,
  type Page,
  type WebSocketRoute,
} from "@playwright/test";

/**
 * The live socket, and what happens to it when the network does what networks do.
 *
 * <p>These exist because of one line: `socket.current?.send(...)` against a socket nothing ever
 * reopened. A websocket that has closed accepts `send()`, throws nothing, and delivers nothing
 * -- so after the first disconnect the app looked completely normal and was deaf. Every HTTP
 * call still worked, because fetch opens its own connection each time, which is what made it so
 * hard to see: `PUT /api/interests/mine` landed and wrote its row, and the `find` frame behind
 * it went nowhere at all. On the deployed site that read as "matching is broken for everyone".
 *
 * <p>Nothing here mocks a socket. A real one is opened to the real server and then severed,
 * which is what a phone does every time it is locked, carried between rooms, or moved from
 * wifi to mobile data.
 */

/**
 * Cuts the websocket without touching anything else, and puts it back.
 *
 * <p>Deliberately not `context.setOffline`, which does not close an already-established
 * websocket in Chromium -- the socket stays open and nothing under test ever happens. It is
 * also the wrong shape: the failure being guarded against is a socket that is gone while HTTP
 * still works perfectly, which is precisely why it went unnoticed for so long. Severing the
 * transport and leaving fetch alone reproduces that exactly.
 *
 * <p>While severed, every reconnect attempt is refused as well, so "still down" is a real
 * state rather than a gap between two attempts.
 */
const socketUnderTest = async (page: Page) => {
  const open: WebSocketRoute[] = [];
  let severed = false;

  await page.routeWebSocket(/\/ws\/chat/, (route) => {
    if (severed) {
      // 1006, the code a connection that dropped rather than closed politely reports.
      route.close({ code: 1006 });
      return;
    }
    route.connectToServer();
    open.push(route);
  });

  return {
    async cut() {
      severed = true;
      for (const route of open.splice(0)) await route.close({ code: 1006 });
      await expect(page.locator("#reconnecting")).toBeVisible();
    },
    async restore() {
      severed = false;
      await expect(page.locator("#reconnecting")).toHaveCount(0);
    },
  };
};

/** The route has to be in place before the page loads, or the first socket bypasses it. */
const arrive = async (browser: Browser, phone = false) => {
  const context = await browser.newContext(phone ? { ...devices["iPhone 13"] } : {});
  const page = await context.newPage();
  const socket = await socketUnderTest(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Start chatting" }).click();
  await expect(page.locator("#displayName")).toBeVisible();
  return { page, socket };
};

const freezeTicker = (page: Page) =>
  page.evaluate(() => {
    document
      .querySelectorAll<HTMLElement>(".marquee-track")
      .forEach((el) => (el.style.animationPlayState = "paused"));
  });

/** Puts the same catalogue tile on both, so a search can only be waiting on the transport. */
const pickTheSameTile = async (a: Page, b: Page) => {
  for (const page of [a, b]) {
    await expect(page.locator("[data-testid=interest]").first()).toBeVisible();
    await freezeTicker(page);
  }
  const id = await a.locator("[data-testid=interest]").first().getAttribute("data-interest-id");
  for (const page of [a, b]) {
    const tile = page.locator(`[data-interest-id="${id}"]`);
    if ((await tile.getAttribute("aria-pressed")) !== "true") await tile.click({ force: true });
    // "Forever", so nothing in this file depends on how long a patience window is. These tests
    // cut the connection and put it back, which takes as long as it takes; with the five-second
    // dial the server would rightly give up mid-test and the failure would look like the
    // reconnection being broken rather than the search having simply ended.
    await page.getByRole("button", { name: "Forever" }).click();
  }
  await a.waitForTimeout(400);
};

test("the connection comes back on its own after it drops", async ({ browser }) => {
  const { socket } = await arrive(browser);
  await socket.cut();
  await socket.restore();
});

test("a search survives losing the connection and finds somebody", async ({ browser }) => {
  const a = await arrive(browser);
  const b = await arrive(browser);
  await pickTheSameTile(a.page, b.page);

  await a.page.locator("#findSomeone").click();
  await expect(a.page.locator("#findSomeone")).toHaveAttribute("aria-busy", "true");

  // Alice loses signal mid-search. The server drops a disconnected socket from the wait pool,
  // so coming back is not enough on its own -- the search has to be put back into it.
  await a.socket.cut();
  await a.socket.restore();

  await b.page.locator("#findSomeone").click();
  await expect(a.page.locator("#chat")).toBeVisible();
  await expect(b.page.locator("#chat")).toBeVisible();
});

/**
 * The exact shape of the reported bug: the press lands while the socket is already gone.
 *
 * <p>This is what a phone in a pocket does. `PUT /api/interests/mine` goes over HTTP and
 * succeeds, so the server has the selection and nothing looks wrong; the `find` frame is the
 * only part that needed the socket, and it was the only part that vanished. Before the fix
 * this test sat on "Looking" until it timed out, with the server never having heard of it.
 */
test("find pressed while the connection is down is not lost", async ({ browser }) => {
  const a = await arrive(browser, true);
  const b = await arrive(browser);
  await pickTheSameTile(a.page, b.page);

  await a.socket.cut();
  await a.page.locator("#findSomeone").click();
  await expect(a.page.locator("#findSomeone")).toHaveAttribute("aria-busy", "true");

  await a.socket.restore();
  await b.page.locator("#findSomeone").click();

  await expect(a.page.locator("#chat")).toBeVisible();
  await expect(b.page.locator("#chat")).toBeVisible();
});

test("a message sent while the connection is down arrives once it is back", async ({
  browser,
}) => {
  const a = await arrive(browser);
  const b = await arrive(browser);
  await pickTheSameTile(a.page, b.page);
  await a.page.locator("#findSomeone").click();
  await b.page.locator("#findSomeone").click();
  await expect(a.page.locator("#chat")).toBeVisible();
  await expect(b.page.locator("#chat")).toBeVisible();

  await a.socket.cut();
  await a.page.locator("#composer").fill("sent from a tunnel");
  await a.page.locator("#send").click();
  await a.socket.restore();

  await expect(b.page.locator("#messages")).toContainText("sent from a tunnel");
});

/** While it is down, the app says so -- the whole failure was that it did not. */
test("a dropped connection is visible rather than silent", async ({ browser }) => {
  const { page, socket } = await arrive(browser, true);
  await expect(page.locator("#reconnecting")).toHaveCount(0);
  await socket.cut();
  await expect(page.locator("#reconnecting")).toHaveText(/reconnecting/i);
  await socket.restore();
});
