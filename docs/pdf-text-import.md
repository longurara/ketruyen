# Chuyển PDF thành sách chữ

Trong Nhập ebook, chọn **Khi chọn PDF → Chuyển thành sách chữ**, rồi chọn/kéo thả tệp. Mặc định vẫn là Giữ trang gốc. Áp dụng cho PDF có lớp chữ, không dùng OCR. Tối đa 50 MB/tệp, 500 trang và 20 triệu ký tự. Hủy xử lý dừng worker và không lưu bản đang chuyển vào kệ.

## Xem trước và lưu

- Xem số trang, số dòng đầu/chân trang đã bỏ và cảnh báo trang không có chữ/font bất thường/nhiều cột.
- Nối dòng thành đoạn và loại số trang/đầu chân trang lặp có thể bật/tắt. Mục lục nội bộ được ưu tiên, sau đó tiêu đề Chương/Chapter/Phần. Nếu chưa biết chương thì chia theo trang; có thể chọn một chương duy nhất hoặc các quy tắc TXT.
- Xem trang gốc theo yêu cầu, đối chiếu chữ lấy từ trang; không tạo ảnh cho mọi trang ở chế độ sách chữ. Cột phức tạp cần xem trước, không cam kết khôi phục bố cục hoàn hảo.
- Sửa tên chương, tách/gộp và sửa chữ của chương trong bản nháp. Dựng lại bằng bộ lọc/chế độ chương phải xác nhận khi đã sửa; Hủy giữ bản sửa. Tải TXT UTF-8 lấy nội dung hiện tại của bản nháp.
- Chỉ Thêm vào kệ mới ghi sách. Lỗi quota giữ bản nháp để thử lại. Đổi tùy chọn chuyển đổi khi đang lưu bị khóa.

## Dữ liệu và tương thích

`PdfText` dựng dòng từ tọa độ PDF.js, chuẩn hóa NFC, nhận diện phần lặp ở mép trang và nối đoạn theo khoảng cách/thụt đầu dòng. Không tự sửa chính tả hay dùng quy tắc riêng của một bộ truyện.

Sách chữ có `sourceFormat: PDF-TEXT`; sách trang gốc vẫn là `PDF`. Bản chữ dùng SHA-256 của chuỗi `pdf-text-v1:<SHA-256 tệp gốc>` làm digest; slug vẫn theo quy tắc ebook hiện tại. `sourceDigest` giữ dấu vân tay tệp gốc, `pdfConversion` giữ phiên bản, số trang và tùy chọn. Bản gốc và bản chữ cùng tồn tại; nhập lại cùng loại được báo trùng, không ghi đè tiến độ/ghi chú.

Chỉ chữ đã duyệt và bìa chữ được lưu; bytes PDF gốc, bố cục trích xuất, ảnh so sánh và worker chỉ sống trong bản nháp. Khi muốn chuyển PDF đã nhập trước đó, chọn lại tệp gốc và nhập bản chữ riêng. Không tự chuyển vị trí/ghi chú giữa hai cách chia nội dung khác nhau.

Sao lưu/khôi phục và chuyển ebook dùng schema hiện có, bổ sung metadata nguồn được kiểm tra. Không cần migration Supabase. Đồng bộ chỉ bắt đầu từ sách đã lưu, theo tùy chọn đồng bộ ebook hiện có của tài khoản. Service worker v45 thêm module chuyển đổi, giữ cache sách cũ.

## Kiểm chứng

Unit kiểm tra tiếng Việt phân mảnh/dấu tổ hợp, đoạn xuyên trang, hội thoại, số ở thân bài, phần lặp, mục lục cùng trang, nhiều cột, trang không chữ và metadata sao lưu. Browser smoke in PDF có font tiếng Việt thật vào bộ nhớ rồi đi qua luồng nhập, so sánh, sửa bản nháp, TXT, IndexedDB, ZIP, nhập bản gốc riêng, nhập trùng, tệp lỗi và hủy. Fixture không gửi tệp hay email thật lên dịch vụ bên ngoài. Kiểm thử thiết bị thật và PDF của người dùng vẫn cần kiểm tra riêng.
