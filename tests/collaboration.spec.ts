// tests/collaboration.spec.ts
import { test, expect, type Browser } from "@playwright/test";

const TEST_DOC_ID = "playwright-test-doc";
const TEST_BYPASS_HEADER = "x-playwright-test-bypass";
const TEST_BYPASS_SECRET = process.env.TEST_AUTH_BYPASS_SECRET ?? "local-test-only-secret-not-for-prod";

async function openDocAs(browser: Browser, userId: string, userName: string) {
  const context = await browser.newContext({
    extraHTTPHeaders: {
      [TEST_BYPASS_HEADER]: TEST_BYPASS_SECRET,
    },
  });
  const page = await context.newPage();
  await page.goto(`/doc/${TEST_DOC_ID}?userId=${userId}&name=${encodeURIComponent(userName)}`);
  return { context, page };
}

test("edits in one browser context appear in another within 2 seconds", async ({ browser }) => {
  // Two fully isolated browser contexts = two genuinely separate clients,
  // each with their own cookies/storage — not just two tabs sharing state,
  // which would prove nothing about real multi-user sync.
  const { context: contextA, page: pageA } = await openDocAs(
    browser,
    "playwright-user-a",
    "Playwright User A"
  );
  const { context: contextB, page: pageB } = await openDocAs(
    browser,
    "playwright-user-b",
    "Playwright User B"
  );

  const editorA = pageA.locator(".ProseMirror");
  const editorB = pageB.locator(".ProseMirror");

  await expect(editorA).toBeVisible();
  await expect(editorB).toBeVisible();

  // Wait for both to actually report "Connected" before typing — typing
  // before the WebSocket handshake completes would be testing a race
  // condition, not real sync behavior.
  await expect(pageA.getByText("Connected")).toBeVisible({ timeout: 10_000 });
  await expect(pageB.getByText("Connected")).toBeVisible({ timeout: 10_000 });

  const testPhrase = `Sync test ${Date.now()}`;

  await editorA.click();
  await editorA.pressSequentially(testPhrase);

  // The actual assertion this whole test exists for: content typed in
  // context A must appear in context B's DOM within 2 seconds, with zero
  // manual synchronization on our part — proving the WebSocket + Yjs +
  // Redis pipeline built across Phases 2-3 genuinely propagates edits
  // between two independent clients, not just within one page's local state.
  await expect(editorB).toContainText(testPhrase, { timeout: 2000 });

  await contextA.close();
  await contextB.close();
});