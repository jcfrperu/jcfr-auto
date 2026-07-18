import {Page} from "playwright"
import {expect} from "@playwright/test"
import {moveAsHumanThen, waitForEnter, withBrowser, writeToFile} from "./jcfr-auto"

// example usage of jcfr-auto library
async function runThis(page: Page): Promise<void> {
  await page.goto('https://www.tiktok.com')
  await expect(page).toHaveTitle(/.+/)
  const title = await page.title()
  console.log(`title: ${title}`)

  await waitForEnter()             // pause for manual steps before continuing
  await writeToFile('output/result.txt', title)

  const menuOption = page.locator('button[aria-label="Explore"]')
  await moveAsHumanThen(page, menuOption, () => menuOption.click())  // human-like move + action

  // or invoke 2 functions it as usual
  // await moveAsHuman(page, menuOption)
  // await menuOption.click()

  await waitForEnter('Press ENTER to finish:')
}

// single execution
// await withBrowser(runThis)
await withBrowser(runThis, {port: 9223, profile: '/jcfr/temp/tiktok-profile'})

// parallel execution: make sure ports and profiles are different
// await Promise.all([
//   withBrowser(runThis),
//   withBrowser(runThis, {port: 9223, profile: '/jcfr/temp/tiktok-profile'}),
// ])
