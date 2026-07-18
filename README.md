# TikTok Unfollower

Script to automate unfollowing accounts on TikTok using Playwright.

## How it works

`jcfr-auto.ts` is a utility library that controls Chrome exclusively via **CDP (Chrome DevTools Protocol)**. Chrome is
launched natively with `spawn()` and Playwright attaches to it as an external client — no automation flags are injected,
which makes the script significantly harder to detect as a bot compared to Playwright's default launch method
(`navigator.webdriver = false`).

The entry point `main.ts` defines the script logic and passes it to `withBrowser()`, which handles the full browser
lifecycle: launch, execution, error handling, cleanup, and timing.

## Requirements

- Node.js 24+
- pnpm 11+
- Google Chrome installed on the OS

## Install

```bash
pnpm install
```

## Run

```bash
pnpm run-main
```

## Writing a script

Define an `async function` that receives a Playwright `Page` and pass it to `withBrowser()`:

```typescript
import {Page} from "playwright"
import {withBrowser, wait} from "./jcfr-auto"

async function run(page: Page): Promise<void> {
  await page.goto("https://www.tiktok.com")
  // your automation logic here
  await wait(1000, 4000)
}

await withBrowser(run)
```

`withBrowser` takes care of opening and closing Chrome, catching errors, and logging elapsed time.

A more complete example using additional utilities:

```typescript
import {Page} from "playwright"
import {expect} from "@playwright/test"
import {moveAsHumanThen, waitForEnter, withBrowser, writeToFile} from "./jcfr-auto"

async function run(page: Page): Promise<void> {
  await page.goto('https://www.tiktok.com')

  // standard Playwright assertions work as usual
  await expect(page).toHaveTitle(/.+/)
  const title = await page.title()
  console.log(`title: ${title}`)

  await waitForEnter()              // pause for manual steps before continuing
  await writeToFile('title.txt', title)

  const menuOption = page.locator('button[aria-label="Explore"]')
  await moveAsHumanThen(page, menuOption, () => menuOption.click())  // human-like move + action

  await waitForEnter('Press ENTER to finish:')
}

await withBrowser(run, {port: 9223, profile: '/path/to/chrome-profile'})
```

## Parallel execution

Pass multiple `withBrowser()` calls to `Promise.all()` to run several Chrome instances simultaneously.

Each instance **must** use a different port and profile directory:

- **Port** — each Chrome process binds its CDP server to a single port. Two instances on the same port will conflict and
  the second one will fail to start.
- **Profile** — Chrome places a lock file (`SingletonLock`) inside the profile directory when it opens. If a second
  instance tries to use the same profile, Chrome detects the lock and refuses to launch.

```typescript
await Promise.all([
  withBrowser(run),
  withBrowser(run, {port: 9223, profile: '/path/to/chrome-profile-2'}),
])
```

## API (`jcfr-auto.ts`)

### `withBrowser(fn, options?)`

Runs `fn(page)` inside a managed browser session. Handles launch, cleanup, errors, and timing. Pass `options` to
override the default port and profile for that run.

```typescript
await withBrowser(run)
await withBrowser(run, {port: 9223, profile: "C:\\path\\to\\profile"})
```

### `wait(msMin?, msMax?, traceWaiting?)`

Waits a random number of milliseconds between `msMin` and `msMax`, scaled by `SLEEP_FACTOR`. Defaults to `SLEEP_MIN_MS`
and `SLEEP_MAX_MS`. Pass `false` as the third argument to suppress the log.

```typescript
await wait(1000, 4000)
await wait(10, 25, false)  // silent
```

### `waitForEnter(msg?)`

Pauses execution until the user presses Enter in the terminal. Useful for manual checkpoints.

```typescript
await waitForEnter()
await waitForEnter("Log in and press Enter to continue...")
```

### `moveAsHuman(page, locator)`

Moves the mouse from a random nearby origin to the center of `locator` following a quadratic Bézier curve, simulating a
natural human trajectory. Scrolls the element into view first if needed.

```typescript
await moveAsHuman(page, page.locator('button[aria-label="For You"]'))
```

### `moveAsHumanThen(page, locator, fn)`

Same as `moveAsHuman`, then executes `fn` after arriving at the element. Use for move + action pairs.

```typescript
await moveAsHumanThen(page, menuOption, () => menuOption.click())
await moveAsHumanThen(page, menuOption, () => menuOption.dblclick())
```

### `handleError(context, error, traceStack?)`

Logs an error safely from an `unknown` catch value. Pass `traceStack: true` to also print the stack trace. Controlled
globally by `TRACE_STACK`.

```typescript
handleError("my context", error)
handleError("my context", error, true)
```

### `writeToFile(filename, text)`

Writes text to a file relative to the project root. Creates intermediate directories if needed.

```typescript
await writeToFile("output/result.txt", "hello")
```

### `timeToString(ms)`

Converts a millisecond value to a human-readable string.

```typescript
timeToString(3661000) // "1 hour, 1 minute, 1 second"
```

### `openBrowser(options?)` / `closeBrowser(page)`

Low-level functions used internally by `withBrowser`. Available for manual browser management if needed.

## Configuration

All configuration is done at the top of `jcfr-auto.ts`:

```typescript
const CHROME_PORT = 9222
const CHROME_PATH = CHROME_PATHS.WINDOWS
const CHROME_WAIT_MS = 2000
const CHROME_PROFILE_DIR = "/profiles/custom-profile"
const SLEEP_FACTOR = 1.0
const SLEEP_MIN_MS = 1000
const SLEEP_MAX_MS = 2000
const TRACE_STACK = true
const TRACE_WAITING = true
```

### Chrome Path

Use the `CHROME_PATHS` constant for common OS paths:

```typescript
CHROME_PATHS.WINDOWS  // /Program Files/Google/Chrome/Application/chrome.exe
CHROME_PATHS.MAC_OS   // /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
CHROME_PATHS.LINUX_01 // /usr/bin/google-chrome       (Ubuntu/Debian - google-chrome-stable)
CHROME_PATHS.LINUX_02 // /usr/bin/chromium-browser    (Ubuntu/Debian - chromium-browser)
CHROME_PATHS.LINUX_03 // /usr/bin/chromium            (Arch/Fedora - chromium)
```

### User Data Directory (Recommended)

Set `CHROME_PROFILE_DIR` to a dedicated Chrome profile folder. This profile stores cookies, sessions, and authentication
state between runs.

If the target website requires login or 2FA, using a dedicated profile is strongly recommended — authenticate once
manually and every subsequent run reuses the saved session automatically.

**First time setup:**

1. Run the script once — Chrome will open with the empty profile
2. Log in to the target website manually
3. Complete any 2FA challenges
4. Close Chrome

From the second run onwards, the saved session is reused automatically — no login required.

Using a dedicated profile also allows the script to run while your regular Chrome remains open, since each profile can
only be used by one Chrome instance at a time.

### Configuration Reference

| Constant             | Default                | Description                                             |
|----------------------|------------------------|---------------------------------------------------------|
| `CHROME_PORT`        | `9222`                 | Remote debugging port Chrome listens on                 |
| `CHROME_PATH`        | `CHROME_PATHS.WINDOWS` | Path to Chrome executable                               |
| `CHROME_WAIT_MS`     | `2000`                 | Wait time (ms) after launching Chrome before connecting |
| `CHROME_PROFILE_DIR` | `""`                   | Chrome profile directory (empty = OS default profile)   |
| `SLEEP_FACTOR`       | `1.0`                  | Scale factor for all wait times (>1 = slower)           |
| `SLEEP_MIN_MS`       | `1000`                 | Default minimum wait between actions (ms)               |
| `SLEEP_MAX_MS`       | `2000`                 | Default maximum wait between actions (ms)               |
| `TRACE_STACK`        | `true`                 | Print stack trace on error                              |
| `TRACE_WAITING`      | `true`                 | Print wait durations to console                         |
