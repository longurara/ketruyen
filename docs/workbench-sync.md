# Đồng bộ sổ từ, chú giải và hồ sơ đọc

## Sử dụng

Bật **Tài khoản → Bật đồng bộ cho máy này** trên các máy cùng tài khoản. Trong **Tiện ích → Chú giải từ / Sổ từ vựng / Hồ sơ đọc**, trạng thái cho biết đã đồng bộ, đang chờ, chưa có migration hoặc cần chọn bản giữ lại.

- Chú giải mang theo từ, nghĩa, câu gốc, mã sách và vị trí nguồn.
- Sổ từ mang theo mức ghi nhớ, thời điểm thêm và lịch ôn. Hai máy ôn cùng thẻ khi offline và cho kết quả khác nhau sẽ hỏi chọn bản giữ lại, không tự cộng mức ghi nhớ hay đoán lịch ôn.
- Các hồ sơ đã lưu mang theo tên và bộ cài đặt. Nhận hồ sơ không đổi cỡ chữ/giao diện hiện tại; người dùng bấm **Áp dụng** trên từng máy.
- Bật/tắt chú giải trong trang đọc, menu nhanh, footer, camera và cài đặt đang dùng trên máy không đi theo luồng này.

Thay đổi tự kiểm tra sau khoảng một giây và theo vòng đồng bộ 20 giây khi app đang hiển thị; tín hiệu Realtime hiện có có thể kích hoạt sớm hơn. Khi offline, dữ liệu vẫn lưu trên máy. IndexedDB giữ hàng đợi/revision riêng theo tài khoản; lượt đồng bộ lưu hàng đợi trước khi gọi mạng. Đăng xuất/đổi tài khoản/thu hồi phiên chặn kết quả đang chờ của phiên trước. Khi chủ động bật đồng bộ tài khoản khác trên cùng trình duyệt, dữ liệu tiện ích trên máy kết hợp với tài khoản mới giống thư viện hiện có; đăng xuất không xóa dữ liệu cục bộ.

## Xung đột và giới hạn

Mỗi chú giải, từ và hồ sơ là một record theo ID. Thêm các mục khác nhau trên hai máy được kết hợp. Sửa hoặc xóa cạnh tranh cùng mục hiển thị **Giữ bản trên máy / Dùng bản đám mây**, có nội dung để so sánh. Nút **Kiểm tra sổ từ & hồ sơ** ở Tài khoản mở trực tiếp danh sách xung đột. Lựa chọn này thay thế bản còn lại của chính mục đó; ZIP vẫn là cách giữ bản sao độc lập.

Không thay form đang gõ khi có dữ liệu đến. Nếu mục gốc thay đổi trong lúc người dùng đang soạn rồi bấm lưu, bản đang soạn được lưu thành mục có ID mới, giữ bản gốc mới nhận. Các mục đồng bộ độc lập không bị ghi đè bởi một bản giao diện cũ. Xóa một mục đã thay đổi trong lúc giao diện đang mở bị chặn để kiểm tra lại.

Giới hạn vẫn là 1.000 chú giải, 1.000 từ và 12 hồ sơ. Nếu kết hợp vượt hạn, thao tác bị từ chối trước khi ghi, không cắt bớt dữ liệu. Xuất ZIP, giảm số mục rồi thử lại. Hai máy độc lập thêm cùng từ có ID khác nhau được giữ thành hai mục, không tự gộp nghĩa/lịch ôn. Xóa tạo tombstone lâu dài để máy cũ không tự làm mục đã xóa xuất hiện lại; sửa cạnh tranh cần quyết định rõ ràng.

## Thiết lập máy chủ

1. Sau migration 0006, chạy `supabase/migrations/202610250007_workbench_sync.sql` trong Supabase SQL Editor. Có thể chạy lại.
2. Triển khai frontend gồm `workbench-sync.js`, các module đã sửa và service worker `tenshi-shell-v50`. Tải lại app trên các máy.
3. Dùng hai thiết bị thử: thêm chú giải + học từ, ôn trên máy kia, lưu/áp dụng hồ sơ, thử xóa và sửa offline cạnh tranh. Kiểm tra tài khoản thứ hai không đọc được dữ liệu và phiên thu hồi bị chặn.

Migration tạo `reader_workbench_records` và RPC `reader_workbench_apply`, kiểm tra đầy đủ định dạng/giới hạn, CAS và khóa theo tài khoản. Browser chỉ có quyền SELECT qua RLS; ghi qua RPC kiểm tra `reader_require_device()`. Trigger tăng `reader_signals` hiện có, không thêm subscription phát nội dung từ/câu gốc. Không cần bucket, cron hay Edge Function mới. Bản app cũ không đọc bảng mới nên vẫn tương thích.

Khi chưa có 0007, dữ liệu giữ cục bộ và hiện hướng dẫn; tiến độ/ghi chú/nhật ký khác vẫn chạy. ZIP vẫn chứa dữ liệu tiện ích theo định dạng hiện tại. Kiểm thử cục bộ không chứng minh migration đã chạy trên project thật.

## Kiểm tra

`npm run check` gồm kiểm tra schema PostgreSQL/PGlite: chạy lại migration, tài khoản riêng, phiên thu hồi, CAS/tombstone, dữ liệu sai và hạn mức. Các test logic kiểm tra hàng đợi offline, lịch ôn cạnh tranh, lưu form khi nhận cập nhật, quota và hủy kết quả sau đổi tài khoản.

`npm run test:e2e` có luồng hai trình duyệt với SDK Supabase thật và HTTP fixture: chú giải/sổ từ/hồ sơ, lịch ôn, áp dụng hồ sơ chủ động, giữ bản nháp đang gõ, xung đột offline, xóa/tải lại và fallback khi thiếu migration. Không thay đổi tài khoản thật hoặc gửi email. Có ảnh desktop/mobile trong `output/playwright/workbench-sync/`; chưa thay thế nghiệm thu điện thoại thật.
