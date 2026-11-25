
const cheerio = require("cheerio");

const CATEGORY_URL = "https://muicamau.vn/danh-muc/laptop/";
const ALLOWED_HOST = "muicamau.vn";
const MAX_PAGES = 30;
const REQUEST_TIMEOUT_MS = 20000;

function absoluteUrl(value, base) {
  if (!value) return "";

  try {
    const url = new URL(value, base);

    if (!["http:", "https:"].includes(url.protocol)) {
      return "";
    }

    return url.href;
  } catch {
    return "";
  }
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

// Tìm vùng chứa sản phẩm từ đường dẫn sản phẩm.
function getProductCard($, anchor) {
  let node = $(anchor);

  for (let i = 0; i < 7 && node.length; i++) {
    if (node.find("img").length > 0) {
      return node;
    }

    node = node.parent();
  }

  return $(anchor).parent();
}

function getProductFromLink($, anchor, pageUrl) {
  const a = $(anchor);

  const link = absoluteUrl(a.attr("href"), pageUrl);

  if (!link) return null;

  const parsed = new URL(link);

  if (
    parsed.hostname !== ALLOWED_HOST ||
    !parsed.pathname.includes("/san-pham/")
  ) {
    return null;
  }

  const card = getProductCard($, anchor);

  const img = card.find("img").first();

  const name = cleanText(
    a.attr("title") ||
    img.attr("alt") ||
    a.text()
  );

  if (!name || name.length < 5) return null;

  // Lấy hình ảnh.
  const imageCandidate =
    img.attr("data-src") ||
    img.attr("data-lazy-src") ||
    img.attr("data-original") ||
    img.attr("data-large_image") ||
    img.attr("src") ||
    (img.attr("srcset") || "")
      .split(",")[0]
      .trim()
      .split(/\s+/)[0] ||
    "";

  const image = absoluteUrl(imageCandidate, pageUrl);

  // Lấy giá bán.
  const priceEl = card.find(
    ".price ins .amount, .price ins, .price .amount, .woocommerce-Price-amount, .price"
  ).first();

  const price = cleanText(priceEl.text()) || "Liên hệ";

  return {
    name,
    price,
    link,
    image
  };
}

// Tìm liên kết trang tiếp theo.
function getNextPage($, currentUrl) {
  const selectors = [
    ".woocommerce-pagination a.next",
    ".pagination a.next",
    "a.page-numbers.next",
    "a.next",
    "a[rel='next']"
  ];

  for (const selector of selectors) {
    const href = $(selector).first().attr("href");

    if (!href) continue;

    const next = absoluteUrl(href, currentUrl);

    if (!next) continue;

    const parsed = new URL(next);

    if (parsed.hostname !== ALLOWED_HOST) continue;

    if (!parsed.pathname.startsWith("/danh-muc/laptop")) {
      continue;
    }

    if (next === currentUrl) continue;

    return next;
  }

  // Dự phòng: thử cấu trúc URL phân trang WordPress.
  const current = new URL(currentUrl);
  const match = current.pathname.match(/\/page\/(\d+)\/?$/);

  const nextPage = match
    ? Number(match[1]) + 1
    : 2;

  return `${CATEGORY_URL}page/${nextPage}/`;
}

async function fetchHtml(url) {
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  );

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml"
      }
    });

    if (!response.ok) {
      throw new Error(
        `Không tải được ${url} (HTTP ${response.status})`
      );
    }

    return await response.text();

  } finally {
    clearTimeout(timeout);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");

    return res.status(405).json({
      error: "Chỉ hỗ trợ phương thức GET."
    });
  }

  try {
    const productsByLink = new Map();
    const visited = new Set();
    const pageDetails = [];

    let currentUrl = CATEGORY_URL;

    while (currentUrl && visited.size < MAX_PAGES) {
      const normalized = new URL(currentUrl);

      if (
        normalized.hostname !== ALLOWED_HOST ||
        !normalized.pathname.startsWith("/danh-muc/laptop")
      ) {
        break;
      }

      if (visited.has(currentUrl)) break;

      visited.add(currentUrl);

      const html = await fetchHtml(currentUrl);
      const $ = cheerio.load(html);

      // Tìm tất cả liên kết sản phẩm.
      const anchors = $('a[href*="/san-pham/"]');

      let pageProductCount = 0;

      anchors.each((_, anchor) => {
        const product = getProductFromLink(
          $,
          anchor,
          currentUrl
        );

        if (!product) return;

        const key = product.link;

        if (!productsByLink.has(key)) {
          productsByLink.set(key, product);
          pageProductCount++;
        }
      });

      pageDetails.push({
        page: visited.size,
        productsFound: pageProductCount,
        url: currentUrl
      });

      // Nếu trang không có sản phẩm thì dừng.
      if (pageProductCount === 0) break;

      const nextPage = getNextPage($, currentUrl);

      if (!nextPage || visited.has(nextPage)) break;

      currentUrl = nextPage;
    }

    const products = Array.from(
      productsByLink.values()
    );

    return res.status(200).json({
      success: true,
      source: CATEGORY_URL,
      pagesScanned: visited.size,
      totalProducts: products.length,
      pageDetails,
      reachedPageLimit: visited.size >= MAX_PAGES,
      products
    });

  } catch (error) {
    console.error("MCM laptop crawler:", error);

    return res.status(502).json({
      error:
        error.name === "AbortError"
          ? "Website phản hồi quá lâu."
          : error.message || "Không thể lấy dữ liệu."
    });
  }
};
