# Kế hoạch tính năng

## Tình trạng thư viện

Trạng thái: đã triển khai ngày 24/10/2026, kiểm thử trình duyệt với hai thiết bị và gói chuyển bị hỏng.

- [x] Xác nhận ebook có trên máy hiện tại bằng IndexedDB thực tế.
- [x] Hiển thị tên máy khác và thời điểm gần nhất xác nhận có sách; không coi dữ liệu từ máy offline là trạng thái hiện tại.
- [x] Hiển thị chờ chuyển/nhận, lỗi và hết hạn; kiểm tra lại hoặc thử nhận lại gói lỗi.
- [x] Lối tắt mở sách và tạo bản sao lưu ZIP; thông tin dung lượng website trên máy.

## Nhật ký hành trình đọc

Trạng thái: đã triển khai P1–P3 trong mã nguồn ngày 24/10/2026. Đồng bộ cần migration `202610230006_reading_journal.sql` trên Supabase và tải lại frontend mới. Mục tiêu là lưu trải nghiệm theo hành trình **Bắt đầu → Cảm nhận khi đọc → Hoàn thành → Đọc lại → Nhìn lại**.

### P1 — Nền tảng

- [x] Nhật ký cho cả bộ, từng tập và từng lượt đọc lại; giữ các lượt cũ để so sánh cảm nhận và điểm đánh giá theo thời gian.
- [x] Cho ghi điểm 1–5 sao, cảm nhận ngắn hoặc dài, nhãn cảm xúc và ngày hoàn thành có thể sửa; các trường đều tùy chọn.
- [x] Đính kèm trích dẫn, đoạn tô màu, ghi chú và nhân vật yêu thích đã lưu; có thể mở lại nguồn khi sách còn trên thiết bị.
- [x] Dòng thời gian nhật ký, xem theo sách hoặc theo tháng; lưu các mốc bắt đầu, hoàn thành và đọc lại.
- [x] Đồng bộ nhật ký giữa các máy cùng tài khoản, hỗ trợ ghi offline và đưa vào sao lưu/khôi phục.

### P2 — Theo suốt quá trình đọc

- [x] Ghi kỳ vọng khi bắt đầu, cảm nhận ở một chương bất kỳ và đánh giá khi kết thúc; liên kết bài viết với vị trí đã đọc.
- [x] Ghi lý do tạm dừng, bỏ dở hoặc quay lại một cuốn sách.
- [x] Lọc nhật ký theo điểm, cảm xúc, sách và thời gian; xem lại các thay đổi qua từng lượt đọc.

### P3 — Nhìn lại và mang theo

- [x] Kỷ niệm đọc như “Một năm trước bạn đọc xong cuốn này”, hiển thị nhẹ nhàng ở trang chính.
- [x] Tổng kết tháng/năm: các cuốn đáng nhớ, cảm xúc nổi bật và tuyển tập trích dẫn yêu thích.
- [x] Xuất nhật ký thành Markdown/PDF và tạo thẻ cảm nhận để chia sẻ; người dùng chủ động chọn từng bài hoặc nội dung muốn chia sẻ.

### Nguyên tắc trải nghiệm và dữ liệu

- Các mốc đọc có thể tự ghi; cảm nhận luôn do người dùng chủ động viết. Khi kết thúc chỉ gợi ý “Ghi lại cảm nhận?”, cho phép bỏ qua và viết sau.
- Nhật ký mặc định chỉ tài khoản xem; không tự công khai bài viết hoặc trích dẫn.
- Giữ nhật ký lâu dài, độc lập với thời hạn lưu thống kê hoạt động và việc xóa tệp ebook khỏi máy. Không yêu cầu giữ ebook lâu dài trên bucket.
- Ưu tiên triển khai nhật ký theo tập/lượt đọc, đính kèm trích dẫn và dòng thời gian trước; bổ sung tổng kết, kỷ niệm và chia sẻ sau.

Chi tiết sử dụng, giới hạn và kiểm thử: [docs/reading-journal.md](docs/reading-journal.md).

## Ưu tiên: trải nghiệm đọc trên điện thoại

Trạng thái: đã triển khai năm mục. Đã kiểm tra trên trình duyệt giả lập điện thoại; cần kiểm tra thêm bàn phím và vùng an toàn trên Android/iPhone thật.

1. **Tiện ích chung**: gộp nhân vật, thống kê, trích dẫn, ghi chú và tiện ích sách vào một bảng, với bốn nhóm Đọc / Tra cứu / Ghi chú / Học từ.
2. **Thanh điều khiển dưới**: bốn nút Mục lục / Chữ / Tiện ích / Nghe. Thanh tiến độ nằm trong thanh này và ẩn cùng nó; bỏ menu tiện ích nổi trên mobile.
3. **Bảng mở từ dưới**: tiện ích và chỉnh chữ có thể kéo xuống để đóng hoặc kéo lên để mở rộng. Khóa cuộn nền, giữ chỗ đọc và điều chỉnh theo phần màn hình còn lại khi bàn phím mở.
4. **Đọc tập trung**: cuộn xuống ẩn header, thanh dưới, tiến độ và nút lên đầu chương. Chạm vùng giữa trang để hiện lại; không chặn chọn chữ hoặc nút tương tác.
5. **Giữ vị trí đọc**: lưu đoạn và vị trí chữ khi thay đổi cỡ chữ/phông/lề hoặc xoay màn hình. Có nút “Về chỗ vừa đọc” trong Mục lục sau khi mở kết quả tìm kiếm, nguồn từ vựng hoặc phần xem trước.

Chi tiết: [docs/reader-workbench.md](docs/reader-workbench.md).

## Tiện ích tham khảo từ máy đọc sách

Trạng thái: đã triển khai cả chín mục. Đã kiểm tra logic và các luồng chính trên trình duyệt ở kích thước máy tính/điện thoại, gồm nhập PDF và đọc lại offline.

1. **Page Flip**: xem trước chương và minh họa trong khung riêng; đóng để về chỗ đang đọc, hoặc bấm “Đọc từ đây” để chuyển vị trí.
2. **X-Ray**: tìm lần xuất hiện của nhân vật, thống kê số lần/chương và hiện trích đoạn; chỉ quét đến chương xa nhất đã mở khóa. Thông báo kết quả chưa đầy đủ khi không tải được chương.
3. **Word Wise**: chú giải do người dùng tạo, bật/tắt hiển thị nghĩa ngắn ngay trên từ/tên; giữ nguyên văn bản gốc cho chọn chữ, ghi chú và nghe đọc.
4. **Vocabulary Builder**: lưu nghĩa và câu gốc, mở lại nguồn; thẻ ôn tập có hiện nghĩa, đánh giá và lịch ôn.
5. **Book Map**: thanh chương theo độ dài, tiến độ đọc, dấu bookmark và ghi chú; chọn chương để xem trước.
6. **Skim Widget**: thanh vị trí toàn sách, chuyển chương xem trước và chọn bookmark/ghi chú đã lưu.
7. **Quick Menu / Profiles**: tùy chọn nút menu nhanh; lưu, cập nhật, áp dụng và xóa hồ sơ cài đặt đọc.
8. **Thanh trạng thái**: chọn phần trăm toàn sách, phần trăm chương, thời gian còn lại hoặc ẩn hoàn toàn.
9. **PDF**: nhập trên thiết bị, vừa chiều rộng, hai trang, kéo chọn vùng để zoom, đặt lại zoom, chuyển sang văn bản co giãn; hỗ trợ sao lưu và offline.

Giới hạn: chú giải không tự dịch; X-Ray dựa vào danh sách nhân vật và tên khác hiện có. PDF tối đa 50 MB/tệp, 500 trang, 150 MB nội dung sau nhập; trang gốc lưu dưới dạng ảnh raster. PDF có mật khẩu và OCR chưa hỗ trợ; văn bản nhiều cột có thể không giữ đúng thứ tự. Cần thử thêm PDF phức tạp và thao tác zoom trên điện thoại thật.

Chi tiết sử dụng: [docs/reader-workbench.md](docs/reader-workbench.md).

## Điều khiển bằng tay qua camera — Beta

Trạng thái: đã triển khai bản Beta dành cho máy tính, gồm các chế độ bổ sung; cần đánh giá thêm nhận diện với webcam thật.

- Chụm ngón cái và ngón trỏ để giữ trang, kéo tay lên/xuống để di chuyển nội dung theo tay, mở ngón để thả.
- Mở bàn tay, giữ một nhịp rồi phất lên/xuống để cuộn nửa hoặc một màn hình; chỉnh độ nhạy.
- Dùng webcam, nhận diện ngay trên thiết bị, mặc định tắt và chỉ xin quyền khi bấm bật. Không hỗ trợ điện thoại/máy tính bảng.
- Đặt khung xem trước, cài đặt, thu gọn và nút tắt trong thanh trái; tạm dừng khi mở cài đặt/chọn chữ, tắt camera khi rời trang đọc, chuyển ứng dụng hoặc thanh trái bị ẩn do thu nhỏ cửa sổ.
- Cài đặt được lưu và sao lưu cùng dữ liệu đọc; bộ nhận diện tải khi sử dụng lần đầu và có cache offline.
- Đã bổ sung: hiệu chỉnh cá nhân hai tư thế chụm/mở; phất ngang chuyển chương; giơ ngón cái lưu vị trí có hoàn tác; nắm/mở tay để dừng/tiếp tục; tự cuộn theo vị trí tay với giới hạn tốc độ; con trỏ ngón trỏ và chụm để bấm các nút đọc. Các chế độ có lựa chọn riêng để tránh trùng thao tác.
- Việc tiếp theo: thử webcam trên máy tính ở nhiều điều kiện ánh sáng, tinh chỉnh ngưỡng và tốc độ kéo theo phản hồi. Cân nhắc tốc độ kéo tùy chỉnh và chế độ tiết kiệm pin sau khi đánh giá Beta.

Chi tiết: [docs/hand-camera.md](docs/hand-camera.md).

## Điều khiển bằng cảm biến chuyển động trên điện thoại

Trạng thái: đã triển khai đủ P1–P3. Đã kiểm tra bằng cảm biến giả lập trên trình duyệt; còn nghiệm thu trên điện thoại Android/iPhone thật.

Chi tiết sử dụng và kiểm tra: [docs/motion-controls.md](docs/motion-controls.md).

Mục tiêu: hỗ trợ đọc bằng một tay, giảm thao tác vuốt và lưu nhanh vị trí đang đọc bằng cảm biến chuyển động/hướng máy.

### Danh sách tính năng

| Ưu tiên | Thao tác | Hành vi dự kiến |
| --- | --- | --- |
| P1 | Nghiêng máy để tự cuộn | Lấy tư thế cầm máy làm mốc. Nghiêng để cuộn, nghiêng thêm để tăng tốc; đưa về tư thế ban đầu để dừng. Cho phép chỉnh tốc độ tối đa. |
| P1 | Lắc nhẹ để bookmark | Lưu vị trí đang đọc vào danh sách bookmark hiện có. Hiện thông báo và nút hoàn tác để xử lý thao tác nhầm. |
| P2 | Úp máy để tạm dừng | Tạm dừng nghe truyện hoặc tự cuộn khi máy được úp xuống ổn định. Không tự phát lại âm thanh khi ngửa máy. |
| P2 | Nghiêng trái/phải để lật trang | Chuyển tới vùng đọc trước/sau bằng một tay. Mỗi lần nghiêng chỉ chuyển một lần; phải đưa máy về mốc trước thao tác tiếp theo. |
| P2 | Lắc để gia hạn hẹn giờ ngủ | Khi đang nghe và hẹn giờ sắp hết, cho phép lắc để cộng thêm thời gian đã chọn. Không đồng thời tạo bookmark. |
| P3 | Nghiêng để tạo chiều sâu cho bìa/minh họa | Dịch chuyển nhẹ ảnh theo góc máy. Có tùy chọn riêng và tôn trọng thiết lập giảm chuyển động. |

### Cài đặt và hành vi chung

- Thêm mục **Điều khiển bằng chuyển động** trong cài đặt đọc; mặc định tắt.
- Cho phép bật/tắt từng tính năng, chỉnh độ nhạy và lấy lại tư thế cầm máy làm mốc.
- Tự cuộn và lật trang bằng nghiêng là hai chế độ thay thế nhau, tránh kích hoạt cùng lúc.
- Khi bật, kiểm tra cảm biến và dữ liệu thực tế; thông báo rõ nếu thiết bị/trình duyệt không hỗ trợ hoặc quyền bị từ chối.
- Xin quyền cảm biến từ thao tác bấm nút của người dùng trên trình duyệt yêu cầu quyền; dùng HTTPS khi triển khai.
- Lọc rung nhẹ, yêu cầu cử chỉ đủ rõ và có khoảng nghỉ giữa hai lần kích hoạt.
- Tạm dừng điều khiển khi người dùng chọn chữ, mở cửa sổ tiện ích/cài đặt, rời trang đọc hoặc chuyển ứng dụng. Không dựa vào cảm biến để điều khiển khi đã khóa màn hình.
- Hiệu chỉnh lại hướng/mốc khi đổi giữa màn hình dọc và ngang; dừng thao tác đang chạy trong lúc hiệu chỉnh.
- Lưu lựa chọn cùng cài đặt đọc và đưa vào sao lưu/khôi phục hiện có.
- Tái sử dụng luồng bookmark, chuyển trang, nghe truyện và hẹn giờ hiện có.

### Thứ tự triển khai

1. Khả năng truy cập cảm biến, xin quyền, cài đặt và hiệu chỉnh.
2. Tự cuộn bằng nghiêng và bookmark bằng lắc.
3. Úp máy để tạm dừng, nghiêng để lật trang và gia hạn hẹn giờ ngủ.
4. Hiệu ứng chiều sâu cho bìa/minh họa.

### Tiêu chí nghiệm thu

- Kiểm tra trên điện thoại Android và iPhone với trình duyệt hỗ trợ, gồm cấp quyền, từ chối quyền và thiếu dữ liệu cảm biến.
- Cử chỉ rõ chỉ kích hoạt một lần; rung nhẹ hoặc đổi hướng màn hình không tự tạo bookmark/chuyển trang.
- Tự cuộn dừng đúng lúc, không làm mất vị trí đọc và không thao tác phía sau cửa sổ đang mở.
- Bookmark có thể hoàn tác; gia hạn hẹn giờ không tạo bookmark và chỉ hoạt động khi có hẹn giờ nghe.
- Khi tắt tính năng hoặc rời trang đọc, ngừng xử lý cảm biến; các thao tác đọc thông thường tiếp tục dùng được.

### Tài liệu tham khảo

- [Device orientation events — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Device_orientation_events)
- [DeviceMotionEvent.requestPermission — MDN](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/requestPermission_static)
