from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
    page = b.new_page(viewport={'width':1400,'height':900})
    page.goto('file:///home/claude/hummusfit-warehouse/backstock/backstock_3d.html')
    page.wait_for_timeout(1500)
    page.screenshot(path='backstock_3d_preview.png')
    b.close()
