import { chromium } from '@playwright/test';

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    
    // Navigate to help page
    await page.goto('http://localhost:3001/help');
    await page.waitForLoadState('networkidle');
    
    // Take screenshot
    await page.screenshot({ path: 'help-screenshot.png', fullPage: true });
    
    await browser.close();
    console.log('Screenshot saved as help-screenshot.png');
})();
