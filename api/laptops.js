const cheerio = require("cheerio");

const CATEGORY_URL = "https://muicamau.vn/danh-muc/laptop/";
const ALLOWED_HOST = "muicamau.vn";
const MAX_PAGES = 30;
const REQUEST_TIMEOUT_MS = 20000;

function absoluteUrl(value, base) {
  if (!value) return "";
  try {
    const url = new URL(value, base);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.href;
  } catch {
    return "";
  }
}

function getProductFromNode($, node, pageUrl) {
  const item = $(node);
  const titleEl = item.find(
    ".woocommerce-loop-product__title, .name a, h3 a, h2 a"
  ).first();

  const name = titleEl.text().replace(/\s+/g, " ").trim();
  if (!name) return null;

  const linkEl = titleEl.is("a") ? titleEl : item.find("a[href]").first();
  const link = absoluteUrl(linkEl.attr("href"), pageUrl);

  // Ưu tiên giá khuyến mãi; nếu không có thì lấy giá thường.
  const salePrice = item.find(".price ins .amount, .price ins").first();
  const regularPrice = item.find(".price .amount, .price").first();
  const priceEl = salePrice.length ? salePrice : regularPrice;
  const price = priceEl.text().replace(/\s+/g, " ").trim() || "Liên hệ";

  const img = item.find("img").first();
  const imageCandidate =
    img.attr("data-src") ||
    img.attr("data-lazy-src") ||
    img.attr("data-original") ||
    img.attr("src") ||
    (img.attr("srcset") || "").split(",")[0].trim().split(/\s+/)[0] ||
    "";
  const image = absoluteUrl(imageCandidate, pageUrl);

  return { name, price, link, image };
}

function getNextPage($, currentUrl) {
  const candidates = [
    ".woocommerce-pagination a.next",
    ".pagination a.next",
    "a.page-numbers.next",
    "a.next"
  ];

  for (const selector of candidates) {
    const href = $(selector).first().attr("href");
    if (!href) continue;

    const next = absoluteUrl(href, currentUrl);
    if (!next) continue;

    const parsed = new URL(next);
    if (parsed.hostname !== ALLOWED_HOST) continue;
    if (!parsed.pathname.startsWith("/danh-muc/laptop")) continue;
    if (next === currentUrl) continue;
    return next;
  }
  return "";
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MCMProductCatalog/1.0)",
        "Accept": "text/html,application/xhtml+xml"
      }
    });

    if (!response.ok) {
      throw new Error(`Không tải được ${url} (HTTP ${response.status})`);
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
    return res.status(405).json({ error: "Chỉ hỗ trợ phương thức GET." });
  }

  try {
    const productsByLink = new Map();
    const visited = new Set();
    let currentUrl = CATEGORY_URL;

    while (currentUrl && visited.size < MAX_PAGES) {
      const normalized = new URL(currentUrl);
      if (normalized.hostname !== ALLOWED_HOST ||
          !normalized.pathname.startsWith("/danh-muc/laptop")) {
        break;
      }

      if (visited.has(currentUrl)) break;
      visited.add(currentUrl);

      const html = await fetchHtml(currentUrl);
      const $ = cheerio.load(html);

      const nodes = $(".products .product, ul.products li.product, .product-small");
      nodes.each((_, node) => {
        const product = getProductFromNode($, node, currentUrl);
        if (!product) return;

        const key = product.link || `${product.name}|${product.price}`;
        if (!productsByLink.has(key)) {
          productsByLink.set(key, product);
        }
      });

      currentUrl = getNextPage($, currentUrl);
    }

    const products = Array.from(productsByLink.values());

    return res.status(200).json({
      success: true,
      source: CATEGORY_URL,
      pagesScanned: visited.size,
      totalProducts: products.length,
      reachedPageLimit: visited.size >= MAX_PAGES && Boolean(currentUrl),
      products
    });
  } catch (error) {
    console.error("MCM laptop crawler:", error);
    return res.status(502).json({
      error: error.name === "AbortError"
        ? "Website phản hồi quá lâu. Vui lòng thử lại."
        : error.message || "Không thể lấy dữ liệu từ website."
    });
  }
};
