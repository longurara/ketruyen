# Nhật ký hành trình đọc và tình trạng thư viện

## Nhật ký đọc

Mở **Kệ truyện → Nhật ký của bạn**, **⋯ → Nhật ký đọc**, menu từng sách hoặc **Tiện ích → Đọc → Nhật ký đọc**. Nhật ký gồm phạm vi cả bộ/từng tập, các lượt đọc độc lập và dòng thời gian. Các sách đã xóa ebook vẫn có thể được chọn từ nhật ký cũ.

**Viết cảm nhận** cho phép chọn lượt, loại cảm nhận (kỳ vọng/khi đang đọc/sau khi đọc), đánh giá 1–5 sao, ngày, nội dung tối đa 12.000 ký tự và tối đa 8 nhãn cảm xúc. Điểm, cảm nhận và cảm xúc có thể để trống. Có thể sửa ngày bắt đầu/hoàn thành; khi chọn Hoàn thành, ngày mặc định là hôm nay và có thể sửa. Không tự dựng lại ngày đọc trong quá khứ.

Đính kèm tối đa 12 trích dẫn, đoạn tô màu, ghi chú hoặc nhân vật đã mở khóa. Nội dung được chụp lại thành văn bản riêng: xóa ghi chú hoặc ebook gốc không xóa bài nhật ký. **Mở đoạn gốc** cần sách/chương còn trên máy hoặc có thể tải về; khi không còn, nội dung đã đính kèm vẫn đọc được. Nhân vật chưa đọc tới không được đưa vào danh sách gợi ý.

**Lượt đọc mới** tạo nhật ký mới, giữ các lượt cũ và tiến độ sách hiện tại. Chọn cả bộ hoặc một tập. Lượt đầu có thể ghi nhận hoàn thành dựa trên tiến độ hiện có khi đọc xong thêm một chương; từ lượt hai, chỉ các chương thực sự hoàn thành trong lượt đó được tính vào mốc hoàn thành. Mở một chương không tự đánh dấu xong. Minh họa không làm chặn mốc hoàn thành.

Khi mở chương, app bắt đầu mốc nhật ký bộ/tập nếu chưa có. Khi đọc hoặc nghe xong, app ghi mốc hoàn thành nếu đủ các chương. Lời mời viết cảm nhận chỉ nằm ở trang chính, có **Để sau**. Tạm dừng, bỏ dở và quay lại có các mốc riêng giữ lý do tại thời điểm đó; đổi trạng thái sau này không làm mất lịch sử.

Dòng thời gian lọc theo sách, bộ/tập, tháng, điểm, cảm xúc và nội dung. Hiện tối đa 100 mốc mới nhất của bộ lọc; lọc theo tháng để xem các mốc cũ. **Tổng kết** hỗ trợ tháng/năm, số lượt đọc xong bộ/tập, điểm trung bình, cảm xúc và trích dẫn đính kèm. Số bộ và số tập được trình bày riêng, không cộng thành một tổng gây trùng. Kỷ niệm trên trang chính lấy các bài/mốc hoàn thành cùng ngày ở năm trước; ngày 29/2 được nhắc vào 1/3 trong năm không nhuận.

## Đồng bộ, lưu trữ và quyền riêng tư

Chạy `supabase/migrations/202610230006_reading_journal.sql` sau 0005. Migration có thể chạy lại; không cần bucket hoặc cron mới. Trước khi chạy, nhật ký vẫn ghi cục bộ và ghi rõ chưa bật đồng bộ; luồng đồng bộ dữ liệu đọc cũ tiếp tục hoạt động. Sau khi chạy, tải lại app trên các máy.

Mỗi mốc/bài là một record cục bộ `tenshi-journal-<UUID>`, nằm trong bản sao lưu ZIP hiện có. Bảng cloud riêng `reader_journal_records` tránh làm các frontend cũ gặp loại record lạ trong dữ liệu đọc. Server tăng revision bằng `reader_journal_apply`, chỉ cho phiên đang đăng nhập, đã đăng ký và chưa bị thu hồi; browser không có quyền ghi trực tiếp bảng. RLS giới hạn theo tài khoản, không có API công khai nhật ký.

Hàng đợi/revision đồng bộ nằm trong IndexedDB, khóa riêng theo tài khoản và nhật ký. Offline vẫn lưu trên máy, có mạng gửi lại. Mốc bắt đầu chung gộp ngày sớm hơn và hợp các chương hoàn thành; các bài viết sửa khác nhau yêu cầu chọn bản giữ lại. Bản cảm nhận còn lại được lưu thành bài riêng trước khi xác nhận lựa chọn. Bản mốc đọc còn lại được giữ dưới dạng bài ghi lại trạng thái/ngày/lý do. Nếu bài đã thay đổi trong lúc đang mở trình sửa, phần viết mới được giữ thành bài riêng.

Xóa bài tạo tombstone. Nhật ký và tombstone không có thời hạn 30/366 ngày và không bị tác vụ dọn ghi chú/thống kê xóa. Xóa ebook chỉ xóa tệp của thiết bị đó. Đổi tài khoản/đăng xuất/thu hồi chặn kết quả và hàng đợi của phiên cũ theo luồng tài khoản hiện có. Khi chủ động bật đồng bộ ở một tài khoản khác trên cùng trình duyệt, dữ liệu cục bộ được kết hợp với tài khoản đã chọn, giống thư viện và ghi chú.

## Xuất / Chia sẻ

Chọn **Xuất / Chia sẻ** trên một bài hoặc **Xuất nhật ký** sau khi lọc. Người dùng chọn từng bài; trích dẫn/ghi chú/nhân vật đính kèm mặc định không đưa ra ngoài, có lựa chọn kèm theo.

- **Tải Markdown** tạo tệp `.md` từ các bài đã chọn.
- **In / Lưu PDF** mở bản in chỉ gồm các bài đã chọn; dùng chức năng Lưu PDF của trình duyệt/hệ điều hành. Cần cho phép cửa sổ in mở từ thao tác bấm nút.
- **Tạo thẻ PNG** dùng đúng một bài, có xem trước và tải ảnh 1080×1350. Nội dung dài được rút gọn với dấu … trên thẻ; Markdown/PDF giữ đầy đủ bài viết. Phông và giãn dòng hỗ trợ dấu tiếng Việt.

Không tạo link công khai và không tự đăng bài. Tệp được tạo ngay trên thiết bị.

## Tình trạng thư viện

Mở **Kệ truyện → ⋯ → Tình trạng thư viện** hoặc nút cùng tên trong phần Đồng bộ ebook. Màn hình có tìm sách, kiểm tra lại, thử nhận lại gói lỗi, mở sách và tạo bản sao lưu ZIP.

- **Có trên máy này** dựa vào IndexedDB thực tế trên máy hiện tại.
- Máy khác hiển thị **đã xác nhận có sách lúc…**, kèm tên và thời điểm xác nhận. Đây là quan sát trong quá khứ; thiết bị offline có thể đã xóa sách sau đó. Thu hồi quyền cloud không chứng minh sách offline trên thiết bị đã biến mất.
- Hiển thị gói đang tải lên, chờ nhận, đã nhận chờ dọn, hết hạn và lỗi nhận/gửi đã ghi nhận trong phiên. Lỗi lưu hoặc gói hỏng không được coi là đã nhận; bản tạm được giữ để thử lại hoặc dọn theo hạn.
- Thông tin dung lượng là mức sử dụng toàn website theo Storage API, không phải dung lượng riêng ebook. Tình trạng giữ dữ liệu offline được hiển thị nếu trình duyệt cung cấp; ZIP vẫn là bản sao lưu người dùng chủ động giữ.

Migration 0006 thêm `confirmed_at` và nhãn sách vào inventory. Ghi xác nhận định kỳ không phát Realtime nếu nội dung danh sách không đổi, tránh vòng lặp thông báo giữa các máy. Nhãn chỉ có tên/tác giả, không chứa nội dung ebook. Bucket chuyển sách vẫn là tạm thời và xóa sau khi máy nhận lưu thành công.

## Kiểm thử

`npm test` kiểm tra định dạng, ghi nguyên tử và rollback khi quota lỗi, đồng bộ CAS/offline/tombstone, mốc lượt đọc lại, lịch Việt Nam, năm nhuận, xuất có chọn, trạng thái inventory cũ và SQL/RLS hai tài khoản/phiên bị thu hồi. Tác vụ housekeeping được kiểm tra không xóa nhật ký lâu năm/tombstone.

`npm run test:e2e` gồm SDK/browser thật với HTTP fixture hai thiết bị, sửa offline cạnh tranh và giữ cả hai bài, lượt đọc/trạng thái, lọc/tổng kết, Markdown/PDF/PNG chỉ chứa nội dung đã chọn, ebook đã xóa vẫn giữ nhật ký, xác nhận máy khác và gói nhận hỏng. Các luồng đọc và chuyển ebook cũ vẫn chạy trong cùng bộ smoke. Không gửi email hoặc sửa tài khoản thật.

Kiểm tra kích thước điện thoại và WebKit không thay thế nghiệm thu bàn phím/vùng an toàn, in/chia sẻ file và hành vi chạy nền trên iPhone/Android thật. Các việc nghiệm thu thiết bị thật đang giữ trong kế hoạch dự án.

WebKit trên môi trường Windows: biên soạn nhật ký, dấu tiếng Việt, cuộn dọc/ngang và đóng bằng bàn phím đã qua. Bài thử lưu Blob ebook gặp `UnknownError` của IndexedDB trên runtime này; chưa coi luồng lưu ebook là đã nghiệm thu trên Safari/iPhone thật.
