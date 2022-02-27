const puppeteer = require("puppeteer");
const slackNotify = require("slack-notify");

const {
  EACH_N_SEC = "60",
  SLACK_WEBHOOK_URL,
  FEIDE_USERNAME,
  FEIDE_PASSWORD,
  ONLY_INCLUDE_TAKE_HOME_ITEMS
} = process.env;
if (!SLACK_WEBHOOK_URL || !FEIDE_PASSWORD || !FEIDE_USERNAME) {
  console.error("Env vars missing");
  return 2;
}

const destinationUrl = ONLY_INCLUDE_TAKE_HOME_ITEMS ?
	"https://www.ntnu.no/nettbutikk/gjenbruk/produktkategori/ta-med-hjem/" :
	"https://www.ntnu.no/nettbutikk/gjenbruk/torget/";

const slack = slackNotify(SLACK_WEBHOOK_URL);
const seen = new Set();
function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}
let isFirst = true;
(async () => {
  while (true) {
    let browser;
    try {
      browser = await puppeteer.launch({
        headless: true,
        devtools: false,
        executablePath: "/usr/bin/chromium-browser",
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage"
        ]
      });
      const page = await browser.newPage();
      page.setDefaultTimeout(60000);
      await page.goto(destinationUrl, {
        waitUntil: "load"
      });
      await page.waitForSelector('input[id="username"]')
      await page.evaluate(vars => {
        document.querySelector('input[id="username"]').value = vars.FEIDE_USERNAME;
        document.querySelector('input[id="password"]').value = vars.FEIDE_PASSWORD;
        document.querySelector('button[type="submit"]').click();
      }, { FEIDE_USERNAME, FEIDE_PASSWORD });
      await page.waitForSelector('main[role="main"]');
      const result = await page.evaluate(() => {
        const things = document.getElementsByClassName("product");
        const result = [];
        for (let thing of things) {
          const id = thing.children[1].getAttribute("data-product_id");
          const url = thing.children[0].getAttribute("href");
          const img = thing.children[0].children[0].getAttribute("src");
          const txt = thing.children[0].children[1].textContent;
          const txt2 = thing.children[0].children[2].textContent;
          result.push({ id, url, img, txt, txt2 });
        }
        return result;
      });

      result.forEach(({ id, url, img, txt, txt2 }) => {
        console.log("Found id", id);
        if (seen.has(id)) {
          console.log(`- Was already seen`);
          return;
        }
        seen.add(id);
        if (isFirst) {
          return;
        }

        console.log("- Notifying about it:", txt, txt2, id, url, img);
        slack.send({
          text: txt,
          unfurl_links: 1,
          icon_url:
            "http://engineering-team.net/wp-content/uploads/2015/12/logo_ntnu.png",
          username: "NTNU",
          blocks: [
            {
              type: "section",
              block_id: "section567",
              text: {
                type: "mrkdwn",
                text: `${txt} (${txt2}), ${url}`
              },
              accessory: {
                type: "image",
                image_url: img,
                alt_text: txt
              }
            }
          ]
        });
      });
      isFirst = false;
    } catch (e) {
    } finally {
      if (browser) {
        browser.close();
      }
    }
    await sleep(parseInt(EACH_N_SEC, 10) * 1000);
  }
})();
