# Công cụ cào dữ liệu Laptop - Mũi Cà Mau

## Cấu trúc thư mục

```text
mcm-laptop-crawler/
├── api/
│   └── laptops.js
├── index.html
└── package.json
```

## Triển khai lên Vercel

1. Giải nén thư mục.
2. Đưa toàn bộ nội dung lên một GitHub repository mới hoặc repository hiện tại.
3. Import repository đó vào Vercel.
4. Framework Preset: Other.
5. Build Command: để trống.
6. Output Directory: để trống.
7. Deploy.

Vercel sẽ tự nhận `api/laptops.js` là Serverless Function. Không cần nhập URL website mỗi lần sử dụng; công cụ đã cấu hình sẵn danh mục Laptop của Mũi Cà Mau.

## Cách sử dụng

Mở tên miền Vercel sau khi deploy, nhấn **Lấy toàn bộ dữ liệu**. Khi quét xong, nhấn **Xuất Excel (.xlsx)**.

## Ghi chú

- API chỉ cho phép truy cập hostname `muicamau.vn` và đường dẫn danh mục Laptop để tránh biến endpoint thành proxy tùy ý.
- Bộ quét đi theo liên kết trang tiếp theo của WooCommerce và dừng khi hết trang hoặc đạt giới hạn 30 trang.
- Nếu website thay đổi cấu trúc HTML hoặc selector phân trang, cần cập nhật `api/laptops.js`.
- Excel được tạo ngay trong trình duyệt bằng SheetJS; thư viện được tải từ CDN nên cần Internet khi xuất file.
- Vercel Function có giới hạn thời gian chạy tùy gói. Danh mục quá lớn có thể cần chuyển sang cơ chế quét từng trang theo nhiều yêu cầu.
