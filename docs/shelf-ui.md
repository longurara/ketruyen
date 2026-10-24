# Kệ sách và trạng thái giao diện

## Kệ của tôi / Khám phá

- **Kệ của tôi** gồm ebook, truyện có nội dung trên thiết bị, sách đang đọc/muốn đọc/đã đọc, yêu thích, nhóm và đánh dấu/ghi chú. Sách đã bỏ trạng thái đọc chỉ còn ở đây nếu có một trong những lý do còn lại; tiến độ được giữ nguyên.
- **Khám phá** hiển thị danh mục online theo nguồn. Ebook cá nhân nằm trong Kệ của tôi. Các lối tắt Yêu thích, Đang đọc, Muốn đọc và Ebook cá nhân đưa người dùng sang kệ cá nhân, không giới hạn theo nguồn truyện.
- App nhớ mục mở gần nhất bằng `ketruyen-shelf-view-v1` trên trình duyệt. Lần đầu chọn kệ cá nhân nếu đã có sách cá nhân, nếu không chọn Khám phá. Đây là lựa chọn giao diện trên máy, không phải hồ sơ tài khoản hoặc thay đổi dữ liệu Supabase.
- Khi mất mạng, bộ lọc Sách trên máy tạm ưu tiên các sách thực sự lưu cục bộ. Chọn Khám phá chủ động tắt bộ lọc; dòng offline vẫn giải thích giới hạn. Không lấy inventory của máy khác làm bằng chứng rằng sách đã có trên máy hiện tại.

## Bố cục

Trang chính giữ một thẻ Đọc tiếp, các cuốn đang đọc khác ở hàng nhỏ. Nhật ký không có lời mời hoàn thành/kỷ niệm hiện một dòng; những mốc có ý nghĩa vẫn có thẻ riêng. Gợi ý sách nằm sau danh sách.

Danh sách hiện 24 sách đầu, nút Xem thêm bổ sung 24 sách mỗi lần. Giữ số sách đang hiện khi cập nhật nền trong cùng bộ lọc; đổi bộ lọc sẽ bắt đầu lại từ 24 sách. Không tự tải liên tục khi cuộn, để người dùng đến được phần gợi ý. Nút bấm và bàn phím tiếp tục truy cập toàn bộ kết quả.

Thẻ sách có vùng cố định cho tên, tác giả, trạng thái trên thiết bị, vị trí đọc, tiến độ chương và hành động Mở sách. Chỉ hiện thanh tiến độ khi có mục lục và dữ liệu chương để tính chính xác. Không tự đặt phần trăm cho sách chưa có dữ liệu.

## Tải, lỗi và đồng bộ

- Nhãn **Trên máy** dựa trên IndexedDB/cache thực tế. Truyện online ghi rõ số tập; **Chưa tải đủ** nghĩa là đã có chữ nhưng thiếu ít nhất một ảnh trong các tập có chữ. Chưa lưu nội dung sẽ hiện **Chưa tải về**.
- Tải mục lục chỉ khóa thẻ đang mở, giữ tìm kiếm và các sách khác hoạt động. Khi lỗi, có Thử lại ngay dưới thẻ; không xóa danh sách hay thay bộ lọc. Màn hình khởi động thất bại có nút thử tải lại.
- Danh mục online lỗi không làm mất ebook trên máy. Khu vực Khám phá có Thử lại, tải lại danh mục tại chỗ và giữ nguyên các sách cá nhân.
- Chuyển ebook báo hoạt động gửi/nhận, chờ máy nhận hoặc lỗi tại thẻ nếu sách đã hiện trên kệ. Lỗi có nút Kiểm tra sách, mở Tình trạng thư viện với tên sách để xử lý. Ebook chưa nhận vẫn được xem trong Tình trạng thư viện; không dựng sách giả vào IndexedDB.
- Đồng bộ thành công chỉ có trạng thái nhỏ ở nút tài khoản; thông tin chi tiết nằm trong bảng Đồng bộ. Lỗi/xung đột cần xử lý có dòng gọn trên trang chính, không chèn vào nội dung đọc. Các thông báo kỹ thuật không tự bật cửa sổ hoặc đổi chương.
- Trạng thái gửi/nhận tạm được xóa khi đổi tài khoản/phiên; callback phiên cũ không thêm lỗi sang tài khoản mới.

## Kiểm thử và triển khai

`test/e2e/shelf-ui.js` kiểm tra ranh giới kệ cá nhân/danh mục, nhớ lựa chọn, phân trang, nhật ký/thẻ đọc tiếp gọn, lỗi tải mục lục và thử lại, danh mục lỗi vẫn giữ ebook, bàn phím, giảm chuyển động và màn hình điện thoại dọc/ngang. Bộ smoke đồng bộ/chuyển ebook và offline vẫn chạy cùng các kiểm tra này.

Không cần migration hoặc bucket mới. Service worker cập nhật phiên bản shell để tải HTML/CSS/JS mới; mục lục và ảnh offline được giữ theo cơ chế nâng cấp cache hiện có. Ảnh chụp giả lập không thay thế nghiệm thu Safari/iPhone và Android thật.
