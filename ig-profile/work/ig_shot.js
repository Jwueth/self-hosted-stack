const fs = require("fs");
const path = require("path");
const { firefox } = require("playwright");

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "-" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

(async () => {
  const url = process.argv[2];
  const outPng = process.argv[3]; // /work/out/xxx.png
  const outJson = process.argv[4]; // /work/out/xxx.json (optionnel)

  if (!url || !outPng) {
    console.error("Usage: node ig_shot.js <url> <outPng> [outJson]");
    process.exit(1);
  }

  const result = {
    url,
    status: "OK",
    postcount: 0,
    ts: new Date().toISOString(),
  };

  try {
    const context = await firefox.launchPersistentContext(
      "/ig-profile/firefox-profile",
      {
        headless: true,
        viewport: { width: 1280, height: 2200 },
      }
    );

    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(1500);

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);

    const postSel = 'a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]';

    // Quick login wall detection
    const bodyText0 = await page
      .evaluate(() => (document.body ? document.body.innerText || "" : ""))
      .catch(() => "");
    const looksLikeLogin =
      bodyText0.includes("Se connecter") ||
      bodyText0.includes("Connexion") ||
      bodyText0.includes("Log in") ||
      bodyText0.includes("Sign up");

    if (looksLikeLogin) {
      result.status = "LOGIN_WALL";
      await page.screenshot({ path: outPng, fullPage: false });
      await context.close();
    } else {
      // load 6 tiles
      for (let i = 0; i < 6; i++) {
        const count = await page.locator(postSel).count().catch(() => 0);
        result.postcount = count;
        if (count >= 6) break;
        await page.mouse.wheel(0, 700);
        await page.waitForTimeout(900);
      }

      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(400);

      const bodyText = await page
        .evaluate(() => (document.body ? document.body.innerText || "" : ""))
        .catch(() => "");
      if (
        bodyText.includes("Ce compte est privé") ||
        bodyText.includes("This account is private") ||
        bodyText.includes("This Account is Private")
      ) {
        result.status = "PRIVATE";
        const main = await page.$("main").catch(() => null);
        if (main) await main.screenshot({ path: outPng });
        else await page.screenshot({ path: outPng, fullPage: false });
        await context.close();
      } else {
        // clip
        const clip = await page
          .evaluate((postSel) => {
            const mainEl = document.querySelector("main");
            const posts = Array.from(document.querySelectorAll(postSel));
            const sixth = posts[5];
            if (!mainEl) return null;

            const mainRect = mainEl.getBoundingClientRect();
            const y = Math.max(0, mainRect.top + window.scrollY);

            let bottom = mainRect.bottom + window.scrollY;
            if (sixth) {
              const r = sixth.getBoundingClientRect();
              bottom = r.bottom + window.scrollY;
            }
            bottom += 20;

            return {
              x: 0,
              y,
              width: Math.floor(window.innerWidth),
              height: Math.max(200, Math.floor(bottom - y)),
            };
          }, postSel)
          .catch(() => null);

        if (clip) await page.screenshot({ path: outPng, clip });
        else await page.screenshot({ path: outPng, fullPage: false });

        result.status = result.postcount >= 6 ? "OK" : "PARTIAL";
        await context.close();
      }
    }
  } catch (e) {
    result.status = "ERROR";
    result.error = String(e && e.message ? e.message : e);
  }

  // write json result if requested
  if (outJson) {
    fs.mkdirSync(path.dirname(outJson), { recursive: true });
    fs.writeFileSync(outJson, JSON.stringify(result, null, 2), "utf-8");
  }

  // print one-line json for n8n logs
  console.log(JSON.stringify(result));
})();
