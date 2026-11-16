import asyncio
from playwright.async_api import async_playwright

async def check():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, args=['--no-sandbox', '--disable-gpu'])
        page = await b.new_page(viewport={'width': 1920, 'height': 1080})
        await page.goto('http://localhost:5173/')
        await page.wait_for_timeout(3000)

        # 1. Click Forecast
        await page.click("nav.tabs button:has-text('Forecast')")
        await page.wait_for_timeout(1000)
        fc_canvas = await page.locator('canvas').count()
        fc_maphost = await page.locator('.map-host canvas').count()
        print('In Forecast: total canvas:', fc_canvas, '| map-host canvas:', fc_maphost)

        # 2. Click Run report
        await page.click("nav.tabs button:has-text('Run report')")
        await page.wait_for_timeout(1000)
        rep_canvas = await page.locator('canvas').count()
        rep_maphost = await page.locator('.map-host canvas').count()
        rep_visible = await page.locator('.map-host').is_visible()
        print('In Run report: total canvas:', rep_canvas, '| map-host visible:', rep_visible)

        # 3. Click Methods
        await page.click("nav.tabs button:has-text('Methods')")
        await page.wait_for_timeout(1000)
        m_canvas = await page.locator('canvas').count()
        m_visible = await page.locator('.map-host').is_visible()
        print('In Methods: total canvas:', m_canvas, '| map-host visible:', m_visible)

        # 4. Switch back to Live map
        await page.click("nav.tabs button:has-text('Live map')")
        await page.wait_for_timeout(1500)
        live_canvas = await page.locator('.map-host canvas').count()
        live_visible = await page.locator('.map-host').is_visible()
        print('Back in Live map: canvas count:', live_canvas, '| map-host visible:', live_visible)

if __name__ == '__main__':
    asyncio.run(check())
