const { chromium } = require("playwright-core");

async function main(stations) {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PM25_CHROMIUM_PATH
      ? { executablePath: process.env.PM25_CHROMIUM_PATH }
      : { channel: "chrome" }),
  });
  try {
    const page = await browser.newPage();
    await page.goto("https://air4thai.pcd.go.th/webV3/#/StationDetail", {
      waitUntil: "domcontentloaded", timeout: 30000
    });
    const selector = page.getByRole("combobox");
    const table = page.locator("table tbody");
    await table.locator("tr").first().waitFor({ timeout: 20000 });
    const available = new Set(await selector.locator("option").evaluateAll(
      options => options.map(option => option.value)
    ));
    const output = {};
    for (const id of stations) {
      if (!available.has(id)) continue;
      try {
        const previous = await table.innerText();
        await selector.selectOption(id);
        await page.waitForFunction(
          ({ id, previous }) => {
            const select = document.querySelector("select");
            const body = document.querySelector("table tbody");
            return select?.value === id && /\d+\s+[^\d]+\s+\d{4}/.test(
              body?.rows[0]?.cells[0]?.innerText ?? ""
            ) && body.innerText !== previous;
          }, { id, previous }, { timeout: 6500 }
        );
        const headers = await page.locator("table").textContent();
        if (!headers.includes("Avg 24Hr") || !/PM(?:₂\.?₅|2\.?5)/.test(headers)) continue;
        output[id] = await table.locator("tr").evaluateAll(rows =>
          rows.map(row => Array.from(row.cells).slice(0, 2).map(cell => {
            // Responsive table labels may be rendered on narrow screens.
            return cell.innerText.trim().split("\n").at(-1).trim();
          }))
        );
      } catch (error) {
        console.error(id + ": " + error.message.split("\n")[0]);
      }
    }
    process.stdout.write(JSON.stringify(output));
  } finally {
    await browser.close();
  }
}

main(process.argv.slice(2)).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
