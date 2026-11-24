const { chromium } = require("playwright-core");

async function readDaily(stationId, start, end) {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PM25_CHROMIUM_PATH
      ? { executablePath: process.env.PM25_CHROMIUM_PATH }
      : { channel: "chrome" }),
  });
  try {
    const page = await browser.newPage();
    const url = "https://aqmthai.pcd.go.th/main/index.html";
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.locator("#table-search").fill(stationId);
    await page.locator("#station-table tbody tr").filter({ hasText: stationId }).click({ timeout: 20000 });
    await page.getByRole("button", { name: "รายวัน", exact: true }).click();
    for (const [side, date] of [["start", start], ["end", end]]) {
      const [year, month, day] = date.split("-");
      await page.locator("#hist-" + side + "-year").selectOption(year);
      await page.locator("#hist-" + side + "-month").selectOption(String(Number(month)));
      await page.locator("#hist-" + side + "-day").selectOption(String(Number(day)));
    }
    const submit = page.locator("#history-submit");
    await submit.click();
    await page.locator("#history-table thead").waitFor({ state: "visible", timeout: 20000 });
    const heading = await page.locator("#history-table thead").innerText();
    if (!heading.includes("วันที่") || !heading.includes("PM2.5") || !heading.includes("µg/m³")) {
      throw new Error("Unexpected AQMThai daily table or unit");
    }
    const dialog = page.getByText(stationId + " · กรุงเทพมหานคร", { exact: true }).filter({ visible: true });
    if (!(await dialog.count())) throw new Error("AQMThai station could not be verified");
    const rows = await page.locator("#history-table tbody tr").evaluateAll(
      items => items.map(row => Array.from(row.cells, cell => cell.innerText.trim()).slice(0, 2))
    );
    process.stdout.write(JSON.stringify(rows));
  } finally {
    await browser.close();
  }
}

readDaily(process.argv[2], process.argv[3], process.argv[4]).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
