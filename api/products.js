
const cheerio = require("cheerio");

const ALLOWED_HOST = "muicamau.vn";
const MAX_PAGES = 30;
const REQUEST_TIMEOUT_MS = 20000;

const CATEGORIES = [
  {
    name: "Laptop",
    slug: "laptop",
    url: "https://muicamau.vn/danh-muc/laptop/"
  },
  {
    name: "PC - Máy tính để bàn",
    slug: "pc-may-tinh-de-ban",
    url: "https://muicamau.vn/danh-muc/pc-may-tinh-de-ban/"
  },
  {
    name: "Camera quan sát",
    slug: "camera-quan-sat",
    url: "https://muicamau.vn/danh-muc/camera-quan-sat/"
  },
  {
    name: "LCD - Màn hình",
    slug: "lcd-man-hinh",
    url: "https://muicamau.vn/danh-muc/lcd-man-hinh/"
  },
  {
    name: "Gear",
    slug: "gear",
    url: "https://muicamau.vn/danh-muc/gear/"
  },
  {
    name: "Linh kiện PC",
    slug: "linh-kien-pc",
    url: "https://muicamau.vn/danh-muc/linh-kien-pc/"
  }
];

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

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
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
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

// Tìm vùng chứa sản phẩm.
// Ưu tiên phần tử có cả hình ảnh và thông tin giá.
function getProductCard($, anchor) {
  let node = $(anchor);
  let bestNode = node;
  let bestScore = -1;

  for (let i = 0; i < 8 && node.length; i++) {
    const hasImage = node.find("img").length > 0;
    const hasPrice = node.find(
      ".price, .woocommerce-Price-amount, .amount"
    ).length > 0;

    const hasTitle = node.find(
      ".woocommerce-loop-product__title, .product-title, h2, h3"
    ).length > 0;

    const score =
      (hasImage ? 2 : 0) +
      (hasPrice ? 3 : 0) +
      (hasTitle ? 1 : 0);

    if (score > bestScore) {
      bestScore = score;
      bestNode = node;
    }

    if (hasImage && hasPrice && hasTitle) {
      return node;
    }

    node = node.parent();
  }

  return bestNode;
}

function getProductFromLink($, anchor, pageUrl, category) {
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

  const titleElement = card.find(
    ".woocommerce-loop-product__title, .product-title, h2, h3"
  ).first();

  const name = cleanText(
    titleElement.text() ||
    a.attr("title") ||
    img.attr("alt") ||
    a.text()
  );

  if (!name || name.length < 3) return null;

  // Lấy ảnh, kể cả ảnh lazy-load.
  let imageCandidate =
    img.attr("data-src") ||
    img.attr("data-lazy-src") ||
    img.attr("data-original") ||
    img.attr("data-large_image") ||
    img.attr("src") ||
    "";

  if (!imageCandidate) {
    const srcset =
      img.attr("data-srcset") ||
      img.attr("srcset") ||
      "";

    if (srcset) {
      imageCandidate = srcset
        .split(",")[0]
        .trim()
        .split(/\s+/)[0];
    }
  }

  const image = absoluteUrl(imageCandidate, pageUrl);

  // Lấy giá sản phẩm.
  const priceElement = card.find(
    ".price ins .amount, " +
    ".price ins, " +
    ".price .amount, " +
    ".woocommerce-Price-amount, " +
    ".price"
  ).first();

  const price =
    cleanText(priceElement.text()) || "Liên hệ";

  return {
    name,
    price,
    image,
    link,
    category: category.name,
    categorySlug: category.slug
  };
}

// Chỉ lấy URL Next có thật trong HTML.
// Không tự tạo /page/2/, /page/3/...
function getNextPage($, currentUrl, category) {
  const selectors = [
    "a[rel='next']",
    ".woocommerce-pagination a.next",
    ".pagination a.next",
    "a.page-numbers.next",
    "a.next"
  ];

  for (const selector of selectors) {
    const href = $(selector).first().attr("href");

    if (!href) continue;

    const next = absoluteUrl(href, currentUrl);

    if (!next) continue;

    const parsed = new URL(next);

    if (
      parsed.hostname !== ALLOWED_HOST ||
      !parsed.pathname.startsWith(
        `/danh-muc/${category.slug}`
      )
    ) {
      continue;
    }

    if (next === currentUrl) continue;

    return next;
  }

  return null;
}

async function crawlCategory(category) {
  const productsByLink = new Map();
  const visited = new Set();
  const pageDetails = [];

  let currentUrl = category.url;
  let error = null;

  while (
    currentUrl &&
    visited.size < MAX_PAGES
  ) {
    if (visited.has(currentUrl)) break;

    const parsed = new URL(currentUrl);

    if (
      parsed.hostname !== ALLOWED_HOST ||
      !parsed.pathname.startsWith(
        `/danh-muc/${category.slug}`
      )
    ) {
      break;
    }

    visited.add(currentUrl);

    try {
      const html = await fetchHtml(currentUrl);
      const $ = cheerio.load(html);

      const anchors = $('a[href*="/san-pham/"]');

      let pageProductCount = 0;

      anchors.each((index, anchor) => {
        const product = getProductFromLink(
          $,
          anchor,
          currentUrl,
          category
        );

        if (!product) return;

        if (!productsByLink.has(product.link)) {
          productsByLink.set(product.link, product);
          pageProductCount++;
        }
      });

      pageDetails.push({
        page: visited.size,
        url: currentUrl,
        productLinksFound: anchors.length,
        productsFound: pageProductCount
      });

      // Trang không có sản phẩm mới thì dừng.
      if (pageProductCount === 0) break;

      const nextPage = getNextPage(
        $,
        currentUrl,
        category
      );

      if (!nextPage || visited.has(nextPage)) break;

      currentUrl = nextPage;

    } catch (err) {
      error = err.message || "Không tải được danh mục.";

      pageDetails.push({
        page: visited.size,
        url: currentUrl,
        error
      });

      break;
    }
  }

  return {
    category: category.name,
    categorySlug: category.slug,
    totalProducts: productsByLink.size,
    pagesScanned: visited.size,
    reachedPageLimit: visited.size >= MAX_PAGES,
    error,
    pageDetails,
    products: Array.from(productsByLink.values())
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");

    return res.status(405).json({
      success: false,
      error: "Chỉ hỗ trợ phương thức GET."
    });
  }

  const requestedCategory =
    String(req.query.category || "all").trim();

  const categories =
    requestedCategory === "all"
      ? CATEGORIES
      : CATEGORIES.filter(
          item => item.slug === requestedCategory
        );

  if (!categories.length) {
    return res.status(400).json({
      success: false,
      error: "Danh mục không hợp lệ.",
      availableCategories: CATEGORIES.map(item => ({
        name: item.name,
        slug: item.slug
      }))
    });
  }

  try {
    const results = [];

    // Quét lần lượt từng danh mục.
    for (const category of categories) {
      results.push(await crawlCategory(category));
    }

    const products = results.flatMap(
      result => result.products
    );

    const totalPages = results.reduce(
      (sum, result) => sum + result.pagesScanned,
      0
    );

    const errors = results
      .filter(result => result.error)
      .map(result => ({
        category: result.category,
        error: result.error
      }));

    return res.status(200).json({
      success: true,
      totalProducts: products.length,
      totalPages,
      categories: results.map(result => ({
        name: result.category,
        slug: result.categorySlug,
        totalProducts: result.totalProducts,
        pagesScanned: result.pagesScanned,
        reachedPageLimit: result.reachedPageLimit,
        error: result.error
      })),
      errors,
      products
    });

  } catch (error) {
    console.error("MCM product crawler:", error);

    return res.status(502).json({
      success: false,
      error: error.message || "Không thể lấy dữ liệu."
    });
  }
};
