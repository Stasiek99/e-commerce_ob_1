
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://localhost:4200', { waitUntil: 'domcontentloaded' });
  // Force the scroll animation to complete
  await page.evaluate(() => {
    const comp = document.querySelector('app-home');
    if (comp) {
      // Force Angular component's scrollProgress to 1
      window.scrollY;
      // Dispatch wheel events to complete the animation
      for (let i = 0; i < 20; i++) {
        window.dispatchEvent(new WheelEvent('wheel', { deltaY: 600, bubbles: true }));
      }
    }
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshot_home_expanded.png', fullPage: false });
  await browser.close();
  console.log('done');
})().catch(e => { console.error(e); process.exit(1); });
