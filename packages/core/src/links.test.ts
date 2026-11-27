import { describe, expect, it } from "vitest";
import labels from "./fixtures/smsedge-click-labels.json";
import {
  classifyClick,
  classifyDevice,
  clickVerdict,
  generateShortCode,
  isDataCentreNetwork,
  isValidShortCode,
  LINK_URL_PLACEHOLDERS,
  renderLinkUrl,
  SHORT_CODE_ALPHABET,
  SHORT_CODE_LENGTH,
  shortDomainForLap,
} from "./links.js";

describe("SHORT_CODE_ALPHABET", () => {
  it("has no ambiguous characters and no repeats", () => {
    for (const ambiguous of ["0", "O", "1", "l", "I"]) {
      expect(SHORT_CODE_ALPHABET).not.toContain(ambiguous);
    }
    expect(new Set(SHORT_CODE_ALPHABET).size).toBe(SHORT_CODE_ALPHABET.length);
    expect(SHORT_CODE_ALPHABET).toMatch(/^[2-9a-km-zA-HJ-NP-Z]+$/);
    expect(SHORT_CODE_ALPHABET).toHaveLength(57);
  });
});

describe("isValidShortCode", () => {
  it("accepts eight characters from the alphabet", () => {
    expect(isValidShortCode("abcdefgh")).toBe(true);
    expect(isValidShortCode("23456789")).toBe(true);
    expect(isValidShortCode("ABCDEFGH")).toBe(true);
  });

  it("rejects the wrong length", () => {
    expect(isValidShortCode("")).toBe(false);
    expect(isValidShortCode("abcdefg")).toBe(false);
    expect(isValidShortCode("abcdefghj")).toBe(false);
  });

  it("rejects characters outside the alphabet", () => {
    expect(isValidShortCode("abcdefg0")).toBe(false);
    expect(isValidShortCode("abcdefgO")).toBe(false);
    expect(isValidShortCode("abcdefg1")).toBe(false);
    expect(isValidShortCode("abcdefgl")).toBe(false);
    expect(isValidShortCode("abcdefgI")).toBe(false);
    expect(isValidShortCode("abcdefg-")).toBe(false);
    expect(isValidShortCode("abcdefg ")).toBe(false);
    expect(isValidShortCode("../../..")).toBe(false);
  });
});

describe("generateShortCode", () => {
  it("is deterministic given the random source", () => {
    const values = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
    const source = () => {
      let i = 0;
      return () => values[i++ % values.length] ?? 0;
    };
    expect(generateShortCode(source())).toBe(generateShortCode(source()));
  });

  it("maps 0 to the first and almost 1 to the last character", () => {
    expect(generateShortCode(() => 0)).toBe(SHORT_CODE_ALPHABET[0]?.repeat(SHORT_CODE_LENGTH));
    expect(generateShortCode(() => 0.999_999)).toBe(
      SHORT_CODE_ALPHABET[SHORT_CODE_ALPHABET.length - 1]?.repeat(SHORT_CODE_LENGTH),
    );
  });

  it("clamps an out-of-range random value instead of producing undefined", () => {
    expect(generateShortCode(() => 1)).toBe(
      SHORT_CODE_ALPHABET[SHORT_CODE_ALPHABET.length - 1]?.repeat(SHORT_CODE_LENGTH),
    );
    expect(generateShortCode(() => -1)).toBe(SHORT_CODE_ALPHABET[0]?.repeat(SHORT_CODE_LENGTH));
  });

  it("always yields a valid code", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(isValidShortCode(generateShortCode(Math.random))).toBe(true);
    }
  });
});

describe("classifyDevice", () => {
  const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const ANDROID_PHONE =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
  const ANDROID_TABLET =
    "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
  const IPAD =
    "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const WINDOWS =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
  const MAC =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

  it("classifies phones as mobile", () => {
    expect(classifyDevice(IPHONE)).toBe("mobile");
    expect(classifyDevice(ANDROID_PHONE)).toBe("mobile");
    expect(classifyDevice("Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1)")).toBe("mobile");
  });

  it("classifies tablets", () => {
    expect(classifyDevice(IPAD)).toBe("tablet");
    expect(classifyDevice(ANDROID_TABLET)).toBe("tablet");
  });

  it("classifies desktops", () => {
    expect(classifyDevice(WINDOWS)).toBe("desktop");
    expect(classifyDevice(MAC)).toBe("desktop");
    expect(classifyDevice("Mozilla/5.0 (X11; Linux x86_64) Firefox/121.0")).toBe("desktop");
  });

  it("classifies crawlers, link previewers and http libraries as bot", () => {
    expect(
      classifyDevice("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"),
    ).toBe("bot");
    expect(
      classifyDevice("facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"),
    ).toBe("bot");
    expect(classifyDevice("WhatsApp/2.23.20.0 A")).toBe("bot");
    expect(classifyDevice("TelegramBot (like TwitterBot)")).toBe("bot");
    expect(classifyDevice("curl/8.4.0")).toBe("bot");
    expect(classifyDevice("python-requests/2.31")).toBe("bot");
    expect(classifyDevice("Go-http-client/1.1")).toBe("bot");
    expect(
      classifyDevice("Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0 Safari/537.36"),
    ).toBe("bot");
    expect(
      classifyDevice("Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"),
    ).toBe("bot");
  });

  it("returns unknown for empty or unrecognised strings", () => {
    expect(classifyDevice("")).toBe("unknown");
    expect(classifyDevice(undefined)).toBe("unknown");
    expect(classifyDevice(null)).toBe("unknown");
    expect(classifyDevice("Dalvik/2.1.0")).toBe("unknown");
  });
});

describe("renderLinkUrl", () => {
  const vars = {
    dynamic: "dyn-42",
    geo: "ES",
    campaign_id: "cmp-1",
    list_id: "lst-1",
    route_name: "23telecom",
    phone: "+34612345678",
  };

  it("lists the standard placeholders", () => {
    expect(LINK_URL_PLACEHOLDERS).toEqual([
      "dynamic",
      "geo",
      "campaign_id",
      "list_id",
      "route_name",
      "phone",
    ]);
  });

  it("replaces every standard placeholder, url-encoded", () => {
    expect(
      renderLinkUrl(
        "https://x.example/?d={{dynamic}}&g={{geo}}&c={{campaign_id}}&l={{list_id}}&r={{route_name}}&p={{phone}}",
        vars,
      ),
    ).toBe("https://x.example/?d=dyn-42&g=ES&c=cmp-1&l=lst-1&r=23telecom&p=%2B34612345678");
  });

  it("replaces custom placeholders and tolerates spaces inside the braces", () => {
    expect(
      renderLinkUrl("https://x.example/{{ dynamic }}/{{custom1}}", { ...vars, custom1: "a b" }),
    ).toBe("https://x.example/dyn-42/a%20b");
  });

  it("leaves unknown placeholders empty", () => {
    expect(renderLinkUrl("https://x.example/?a={{nope}}&b={{dynamic}}", vars)).toBe(
      "https://x.example/?a=&b=dyn-42",
    );
    expect(renderLinkUrl("https://x.example/?a={{dynamic}}", {})).toBe("https://x.example/?a=");
  });

  it("replaces a placeholder that occurs more than once", () => {
    expect(renderLinkUrl("{{geo}}-{{geo}}", vars)).toBe("ES-ES");
  });

  it("takes three braces, the way SMS Edge writes them, with no brace left behind (D4-21)", () => {
    expect(renderLinkUrl("https://t.example/click?o=125&a=35&sub_id1={{{dynamic}}}", vars)).toBe(
      "https://t.example/click?o=125&a=35&sub_id1=dyn-42",
    );
    expect(renderLinkUrl("https://x.example/?d={{{ dynamic }}}&g={{geo}}", vars)).toBe(
      "https://x.example/?d=dyn-42&g=ES",
    );
    // An unknown name in three braces is emptied whole as well.
    expect(renderLinkUrl("https://x.example/?a={{{nope}}}", vars)).toBe("https://x.example/?a=");
  });

  it("leaves single braces alone", () => {
    expect(renderLinkUrl("https://x.example/{dynamic}/{{geo}}", vars)).toBe(
      "https://x.example/{dynamic}/ES",
    );
  });

  it("returns a template without placeholders unchanged", () => {
    expect(renderLinkUrl("https://x.example/plain?q=1", vars)).toBe("https://x.example/plain?q=1");
  });
});

describe("shortDomainForLap", () => {
  const domains = ["cc.test", "aa.test", "bb.test"];

  it("gives each lap of a campaign the next domain, in a stable order", () => {
    expect(shortDomainForLap(domains, 0)).toBe("aa.test");
    expect(shortDomainForLap(domains, 1)).toBe("bb.test");
    expect(shortDomainForLap(domains, 2)).toBe("cc.test");
    // The order the shortener lists them in does not matter.
    expect(shortDomainForLap([...domains].reverse(), 0)).toBe("aa.test");
  });

  it("starts over when a campaign has more laps than there are domains", () => {
    expect(shortDomainForLap(domains, 3)).toBe("aa.test");
    expect(shortDomainForLap(domains, 7)).toBe("bb.test");
  });

  it("is null when there is no domain to use", () => {
    expect(shortDomainForLap([], 0)).toBeNull();
    expect(shortDomainForLap(["", "  "], 2)).toBeNull();
  });

  it("ignores case, blanks and repeats, and treats a bad lap number as the first lap", () => {
    expect(shortDomainForLap([" CC.test ", "cc.test", "aa.test"], 1)).toBe("cc.test");
    expect(shortDomainForLap(domains, -1)).toBe("aa.test");
    expect(shortDomainForLap(domains, 1.5)).toBe("aa.test");
  });
});

describe("data-centre networks (D5-13)", () => {
  it("recognises the cloud and hosting networks automated link scanners click from", () => {
    for (const network of [
      "Google LLC",
      "GOOGLE-CLOUD-PLATFORM",
      "YouTube, LLC",
      "DigitalOcean, LLC",
      "M247 LTD Manchester Infrastructure",
      "M247 LTD Tokyo Infrastructure",
      "Amazon.com, Inc.",
      "AMAZON-02",
      "Microsoft Corporation",
      "OVH SAS",
      "Hetzner Online GmbH",
      "Akamai Connected Cloud",
      "Transip B.V.",
      "Oracle Corporation",
      "The Constant Company, LLC",
      "Contabo GmbH",
      "LeaseWeb Netherlands B.V.",
    ]) {
      expect(isDataCentreNetwork(network), network).toBe(true);
    }
  });

  it("leaves home, mobile and privacy networks that real people use alone", () => {
    for (const network of [
      "Virgin Media Limited",
      "Vodafone Spain",
      "EE Limited",
      "Verizon Business",
      "RCN",
      "Google Fiber Inc.",
      // iCloud Private Relay and Cloudflare WARP carry real iPhone and app users.
      "Akamai Technologies, Inc.",
      "Cloudflare, Inc.",
      "Fastly, Inc.",
    ]) {
      expect(isDataCentreNetwork(network), network).toBe(false);
    }
    // "AWS" only as a word: a network whose name merely starts with those letters is not AWS.
    expect(isDataCentreNetwork("AWS EC2")).toBe(true);
    expect(isDataCentreNetwork("Awsat Telecom")).toBe(false);
    expect(isDataCentreNetwork(null)).toBe(false);
    expect(isDataCentreNetwork(undefined)).toBe(false);
    expect(isDataCentreNetwork("")).toBe(false);
  });

  it("classifies a click from a data-centre network as a bot, whatever browser it claims", () => {
    const linuxChrome =
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
    const android =
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
    expect(classifyClick(linuxChrome, "Google LLC")).toBe("bot");
    expect(classifyClick(android, "DigitalOcean, LLC")).toBe("bot");
    expect(classifyClick(android, "Virgin Media Limited")).toBe("mobile");
    expect(classifyClick(linuxChrome, null)).toBe("desktop");
  });
});

describe("clickVerdict: carrier scanners and other countries (D5-22)", () => {
  const phone =
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36";

  it("takes a carrier's spam filter for a robot", () => {
    expect(clickVerdict({ userAgent: "antispam/1.0.0", network: "Virgin Media Limited" })).toBe(
      "bot",
    );
  });

  it("takes a desktop Linux or Windows browser opening an SMS link for a scanner", () => {
    const linux =
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
    const windows =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";
    expect(clickVerdict({ userAgent: linux, network: "Virgin Media Limited" })).toBe("bot");
    expect(clickVerdict({ userAgent: windows, network: "BT" })).toBe("bot");
  });

  it("takes a click from a proxy or hosting network for a robot", () => {
    expect(clickVerdict({ userAgent: phone, network: "LonConnect Ltd" })).toBe("bot");
  });

  it("does not count a click from another country than the phone's", () => {
    expect(
      clickVerdict({
        userAgent: phone,
        network: "Bouygues Telecom SA",
        clickCountry: "FR",
        phoneCountry: "GB",
      }),
    ).toBe("other_country");
    expect(
      clickVerdict({
        userAgent: phone,
        network: "EE Limited",
        clickCountry: "GB",
        phoneCountry: "GB",
      }),
    ).toBe("mobile");
  });

  it("keeps a phone on a phone network, or with an unknown country", () => {
    expect(clickVerdict({ userAgent: phone, network: "Hutchison 3G UK Limited" })).toBe("mobile");
    expect(
      clickVerdict({ userAgent: phone, network: null, clickCountry: null, phoneCountry: "GB" }),
    ).toBe("mobile");
  });

  it("agrees with SMS Edge's own verdicts on its labelled clicks", () => {
    const { clicks } = labels as {
      clicks: {
        ua: string;
        network: string | null;
        clickCountry: string | null;
        phoneCountry: string | null;
        label: "real" | "bot";
      }[];
    };
    let realKept = 0;
    let realTotal = 0;
    let botCaught = 0;
    let botTotal = 0;
    for (const c of clicks) {
      const verdict = clickVerdict({
        userAgent: c.ua,
        network: c.network,
        clickCountry: c.clickCountry,
        phoneCountry: c.phoneCountry,
      });
      const counted = verdict !== "bot" && verdict !== "other_country";
      if (c.label === "real") {
        realTotal += 1;
        if (counted) realKept += 1;
      } else {
        botTotal += 1;
        if (!counted) botCaught += 1;
      }
    }
    // Measured on this set: see the D5-22 PR. Counting rules alone cannot reach SMS Edge's
    // in-browser check, so the bar is what the rules reach, not 100%.
    expect(realKept / realTotal).toBeGreaterThanOrEqual(0.75);
    expect(botCaught / botTotal).toBeGreaterThanOrEqual(0.93);
  });
});
