// FOR GLOBAL USAGE (no package.json required):
//   npm install -g tsx playwright @playwright/test @types/node
//   tsx main.ts
//
// FOR LOCAL USAGE (with package.json, copy this file into an existing project):
//   npm install playwright @playwright/test @types/node
//
// CERTIFICATED VERSIONS:
// tsx             : ^4.19.4
// playwright      : ^1.61.1
// @playwright/test: ^1.61.1
// @types/node     : ^26.1.1
// typescript      : ^7.0.2

import {Browser, BrowserContext, chromium, Locator, Page} from "playwright"
import {spawn} from "child_process"
import * as readline from "readline"
import assert from "node:assert"
import path from "path";
import fs from "fs/promises";

export const CHROME_PATHS = {
  WINDOWS: '/Program Files/Google/Chrome/Application/chrome.exe',
  MAC_OS: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  LINUX_01: '/usr/bin/google-chrome',     // Ubuntu/Debian - google-chrome-stable
  LINUX_02: '/usr/bin/chromium-browser',  // Ubuntu/Debian - chromium-browser
  LINUX_03: '/usr/bin/chromium',          // Arch/Fedora - chromium
} as const

// CONFIGURATION:
// Chrome is launched natively via spawn() — no automation flags injected.
// Playwright then attaches via CDP (Chrome DevTools Protocol), making the script
// significantly harder to detect as a bot (navigator.webdriver = false).
//
// CHROME_PROFILE_DIR: path to a dedicated Chrome profile folder.
// Before running the script for the first time, open Chrome with this profile,
// log in to the target website and complete any 2FA. The session is stored in the profile
// and reused automatically on every subsequent run.

const CHROME_PORT = 9222                                   // remote debugging CDP port Chrome listens on (9222-9228)
const CHROME_PATH = CHROME_PATHS.WINDOWS                   // path to Chrome executable
const CHROME_WAIT_MS = 2000                                // ms to wait for Chrome to be ready before attaching
const CHROME_PROFILE_DIR = "/profiles/custom-profile"      // dedicated profile directory — keeps login sessions
const SLEEP_FACTOR = 1.0                                   // scale factor for all wait times (>1 = slower)
const SLEEP_MIN_MS = 1000                                  // minimum random wait between human-like actions
const SLEEP_MAX_MS = 2000                                  // maximum random wait between human-like actions
const TRACE_STACK = true                                   // print stack trace on error
const TRACE_WAITING = true                                 // print waiting times

export interface BrowserOptions {
  port: number
  profile: string
}

// BROWSER:
// launches Chrome via CDP and returns the active page
export async function openBrowser(options?: BrowserOptions): Promise<Page> {
  await launchCDP(options)
  return await attachCDP(options)
}

// closes Chrome gracefully via CDP
export async function closeBrowser(page: Page | null): Promise<void> {
  try {
    if (page) {
      // newCDPSession opens a temporary communication channel to Chrome (existing channels are unaffected)
      // Browser.close shuts down Chrome gracefully — closes all contexts, tabs and frames
      const session = await page.context().newCDPSession(page)
      await session.send('Browser.close')
    }
  } catch {
    console.warn('closeBrowser() - CDP session failed - Chrome may have already closed')
  }
}

// SCRIPT
// runs fn(page) inside a managed browser session — handles launch, errors, cleanup, and timing
export async function withBrowser(fn: (page: Page) => Promise<void>, options?: BrowserOptions): Promise<void> {
  const start = Date.now()
  let page: Page | null = null
  try {
    console.info('withBrowser() - started\n')
    page = await openBrowser(options)
    await fn(page)
    console.info('\nwithBrowser() - completed successfully')
  } catch (error) {
    handleError('withBrowser() - failed', error)
  } finally {
    await closeBrowser(page)
    console.info(`withBrowser() - elapsed in ${((Date.now() - start) / 1000).toFixed(2)}s`)
  }
}

// launches Chrome natively via spawn() with the CDP remote debugging port open
// detached: true so Chrome runs independently of the Node.js process
async function launchCDP(options?: BrowserOptions): Promise<void> {
  const port = options?.port ?? CHROME_PORT
  const profile = options?.profile ?? CHROME_PROFILE_DIR

  const args = [
    `--remote-debugging-port=${port}`,
    '--start-maximized',
    '--no-first-run',
    '--no-default-browser-check',
  ]
  if (profile) {
    args.push(`--user-data-dir=${profile}`)
  }
  const pid = spawn(CHROME_PATH, args, {detached: true}).pid ?? null
  assert(pid, `Failed to launch Chrome: ${CHROME_PATH}`)
  await wait(CHROME_WAIT_MS)
}

// connects Playwright to the already-running Chrome instance via CDP,
// returns the first open page, or opens a new one if none exists
async function attachCDP(options?: BrowserOptions): Promise<Page> {
  const port = options?.port ?? CHROME_PORT

  const browser: Browser = await chromium.connectOverCDP(`http://localhost:${port}`)
  assert(browser.contexts(), 'There must be at least one context')
  const context: BrowserContext = browser.contexts()[0]
  return context.pages().length > 0 ? context.pages()[0] : await context.newPage()
}

// ERRORS:
// logs an error safely from an unknown catch value; set traceStack=true to also print the stack
export function handleError(context: string, error: unknown, traceStack: boolean = TRACE_STACK): void {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`${context}:`, message)
  if (traceStack && error instanceof Error && error.stack) {
    console.error(error.stack)
  }
}

// WAITS:
// waits a random number of milliseconds between msMin and msMax, scaled by SLEEP_FACTOR
export function wait(msMin: number = SLEEP_MIN_MS, msMax: number = SLEEP_MAX_MS, traceWaiting: boolean = TRACE_WAITING): Promise<void> {
  const randomRange = Math.floor(Math.random() * (msMax - msMin + 1)) + msMin
  const milliseconds = Math.round(SLEEP_FACTOR * randomRange)
  if (traceWaiting) {
    console.log(`waiting ${timeToString(milliseconds)}`)
  }
  return new Promise<void>(resolve => setTimeout(resolve, milliseconds))
}

// pauses execution until the user presses Enter in the terminal — useful for manual checkpoints
export async function waitForEnter(msg: string = 'Press ENTER to continue: '): Promise<void> {
  const rl = readline.createInterface({input: process.stdin, output: process.stdout})
  return new Promise(resolve => {
    rl.question(msg, () => {
      rl.close()
      resolve()
    })
  })
}

// HUMAN ACTIONS:
// moves the mouse from a random nearby origin to the center of the locator
// following a quadratic Bézier curve to simulate a natural human trajectory
export async function moveAsHuman(page: Page, locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  assert(box, 'No se pudo obtener boundingBox del elemento')

  const targetX = box.x + box.width / 2
  const targetY = box.y + box.height / 2

  const originX = targetX + (Math.random() * 200 - 100)
  const originY = targetY + (Math.random() * 200 - 100)

  // control point offset from the midpoint — defines the curve shape
  const controlX = (originX + targetX) / 2 + (Math.random() * 100 - 50)
  const controlY = (originY + targetY) / 2 + (Math.random() * 100 - 50)

  await page.mouse.move(originX, originY)
  await wait(80, 200, false)

  const steps = 15 + Math.floor(Math.random() * 10)
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const x = (1 - t) ** 2 * originX + 2 * (1 - t) * t * controlX + t ** 2 * targetX
    const y = (1 - t) ** 2 * originY + 2 * (1 - t) * t * controlY + t ** 2 * targetY
    await page.mouse.move(x, y)
    await wait(10, 25, false)
  }
  await wait(100, 300, false)
}

// same as moveAsHuman, then executes fn after arriving at the element
export async function moveAsHumanThen(page: Page, locator: Locator, fn: () => Promise<void>): Promise<void> {
  await moveAsHuman(page, locator)
  await fn()
}

// OTHERS
// writes text to a file relative to the project root; creates intermediate directories if needed
export async function writeToFile(filename: string, text: string): Promise<void> {
  const rootPath = path.resolve(process.cwd())
  const filePath = path.join(rootPath, filename)
  const dirPath = path.dirname(filePath)
  try {
    await fs.access(dirPath)
  } catch {
    await fs.mkdir(dirPath, {recursive: true})
  }
  await fs.writeFile(filePath, text, 'utf-8')
}

// converts milliseconds to a human-readable string (e.g. '1 minute, 30 seconds')
export function timeToString(timeMilliseconds: number): string {
  const total = Math.max(0, Math.floor(timeMilliseconds))

  const milliSeconds = total % 1000
  const totalSeconds = Math.floor(total / 1000)
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)

  const parts = []

  if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`)
  if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`)
  if (seconds > 0) parts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`)
  if (milliSeconds > 0 || parts.length === 0) parts.push(`${milliSeconds} millisecond${milliSeconds !== 1 ? 's' : ''}`)

  return parts.join(', ')
}