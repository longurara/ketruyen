# Kệ sách và trạng thái giao diện

## Giao diện gọn và số liệu thống nhất

Đọc tiếp ở đầu kệ là một hàng có bìa nhỏ, tên, vị trí và nút mở. Menu chi tiết chứa số mục đã đọc xong và thao tác bỏ trạng thái; các sách đang đọc khác nằm trong mục thu gọn. Thanh kệ gồm Tất cả / Đang đọc / Yêu thích / Thêm; Thêm chứa Muốn đọc, Ebook cá nhân và Ghi chú. Chọn nguồn/phân loại trong Khám phá dùng bộ chọn có đủ tên thay cho hàng cuộn ngang. Bộ lọc Sách trên máy nằm trong Lọc; khi đang bật hoặc offline có lối tắt hiện rõ.

Phần trăm/thanh hoàn thành đếm mục thực sự đã đánh dấu xong, tách với vị trí đang đọc. Truyện tách chương chữ và phần minh họa; PDF đếm trang. Tập toàn minh họa có đơn vị riêng. Chỉ thay cách trình bày/tính số hiển thị, không đánh lại mã chương, ghi chú hay vị trí đã lưu.

Danh mục bổ sung `storyChapters`, `illustrations`; giữ trường `chapters` cũ. Metadata được cập nhật từ mục lục có sẵn bằng `node scripts/update-reading-counts.js`, không tạo lại ảnh hoặc nội dung. Pipeline build cũng phát sinh hai trường mới; `npm run check-data` đối chiếu với từng mục lục. Cache cũ thiếu trường mới dùng mục lục đã nạp hoặc chỉ hiện số tập, không nạp hàng nghìn mục lục lúc khởi động.

Trang bộ truyện thu gọn tên khác và metadata vào Thông tin sách. Mục lục ưu tiên chương truyện, riêng tập toàn minh họa/PDF vẫn mở đúng loại nội dung. Đọc lại từ đầu là thao tác mở lại, phân biệt với đặt lại tiến độ.

## Tiện ích, bản nháp và cỡ chữ

Nút Tiện ích ở thanh đọc/sidebar mở Hay dùng + tìm chức năng không phân biệt dấu. Hay dùng lấy từ các lối tắt đã cấu hình; Tất cả tiện ích chia nhóm trong một danh sách. Mỗi mục có tên và nút Về tiện ích; `openHome()` mở trang đầu, `open(tab, argument)` giữ các liên kết trực tiếp hiện có. Biểu tượng thống kê ở đầu trang luôn mở thống kê; biểu tượng tài khoản mở Tài khoản & đồng bộ.

Nhật ký giữ tìm kiếm ngoài vùng lọc thu gọn. Số điều kiện đang áp dụng và nút Xóa bộ lọc hiện rõ; đóng vùng lọc không xóa lựa chọn. Biểu mẫu ưu tiên cảm nhận, đánh giá và cảm xúc; ngày tháng/lượt đọc/đính kèm nằm trong Thông tin bổ sung. Các mốc và bài viết vẫn dùng luồng lưu/đồng bộ hiện có.

Nhóm sách dùng thẻ chọn/tạo bằng Enter hoặc dấu phẩy, có gợi ý nhóm cũ; giữ giới hạn 10 nhóm và 60 ký tự/nhóm. Form ghi chú/quản lý có bản nháp chưa lưu giữ nguyên khi thử quay về/đóng bảng, kèm hướng dẫn lưu hoặc Huỷ thay đổi. Nút huỷ không ghi bản nháp vào dữ liệu.

Vào Cài đặt → Hiển thị → Cỡ chữ giao diện để chọn Tiêu chuẩn/Lớn. Chữ phụ giao diện từ 13 px; chế độ Lớn tăng chữ menu và điều khiển, độc lập với chữ trong truyện. Lựa chọn `tenshi-ui-size-v1` lưu trên thiết bị và nằm trong ZIP sao lưu đầy đủ; gói chuyển ebook vẫn không mang theo cài đặt. Bản sao lưu chứa nhật ký được kiểm tra trong trình duyệt thật, gồm thứ tự nạp module nhật ký trước trình đọc ZIP.

Nghiệm thu bằng Chromium: với một sách đang đọc và nhật ký trống, thẻ sách đầu nằm trong 480 px trên mobile và 560 px trên desktop ở cỡ Tiêu chuẩn. Thử cả sáng/giấy/tối, Lớn, bàn phím và giảm chuyển động; chưa thay thế nghiệm thu vùng an toàn/bàn phím trên điện thoại thật.

## Kệ của tôi / Khám phá

- **Kệ của tôi** gồm ebook, truyện có nội dung trên thiết bị, sách đang đọc/muốn đọc/đã đọc, yêu thích, nhóm và đánh dấu/ghi chú. Sách đã bỏ trạng thái đọc chỉ còn ở đây nếu có một trong những lý do còn lại; tiến độ được giữ nguyên.
- **Khám phá** hiển thị danh mục online theo nguồn. Ebook cá nhân nằm trong Kệ của tôi. Các lối tắt Yêu thích, Đang đọc, Muốn đọc và Ebook cá nhân đưa người dùng sang kệ cá nhân, không giới hạn theo nguồn truyện.
- App nhớ mục mở gần nhất bằng `ketruyen-shelf-view-v1` trên trình duyệt. Lần đầu chọn kệ cá nhân nếu đã có sách cá nhân, nếu không chọn Khám phá. Đây là lựa chọn giao diện trên máy, không phải hồ sơ tài khoản hoặc thay đổi dữ liệu Supabase.
- Khi mất mạng, bộ lọc Sách trên máy tạm ưu tiên các sách thực sự lưu cục bộ. Chọn Khám phá chủ động tắt bộ lọc; dòng offline vẫn giải thích giới hạn. Không lấy inventory của máy khác làm bằng chứng rằng sách đã có trên máy hiện tại.

## Bố cục

Trang chính giữ một hàng Đọc tiếp, các cuốn đang đọc khác ở vùng thu gọn. Nhật ký không có lời mời hoàn thành/kỷ niệm hiện một dòng; những mốc có ý nghĩa vẫn có thẻ riêng. Gợi ý sách nằm sau danh sách.

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
