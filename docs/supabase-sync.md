# Đồng bộ giữa các máy

Mở biểu tượng đám mây trên thanh đầu trang hoặc **Thư viện → ⋯ → Đồng bộ giữa các máy**. Đăng nhập bằng email và mật khẩu; nếu chưa có tài khoản, bấm **Tạo tài khoản** và xác nhận email nếu project yêu cầu. Sau khi đăng nhập, bấm **Bật đồng bộ cho máy này**. Làm tương tự trên thiết bị thứ hai với cùng tài khoản.

Mật khẩu do Supabase Auth băm bằng bcrypt với salt phía server; ứng dụng không lưu mật khẩu trong localStorage, IndexedDB hay bảng đồng bộ. Đăng ký và đổi mật khẩu yêu cầu ít nhất 8 ký tự, tối đa 72 byte theo giới hạn bcrypt. Phiên đăng nhập/refresh token do SDK quản lý riêng. Nếu quên mật khẩu, nhập email rồi chọn **Quên mật khẩu?**, mở email khôi phục và nhập mật khẩu mới hai lần. Liên kết xác nhận/khôi phục chạy qua trang `sync-auth.html`, cho phép mở email trên trình duyệt khác.

Đồng bộ vị trí đang đọc, vị trí trong từng chương, dấu đã đọc, lịch sử gần đây, yêu thích, trạng thái/nhóm sách và đánh dấu/ghi chú. Tệp ebook không tự động tải lên cùng tiến độ. Bạn có thể chủ động **Chuyển ebook sang máy khác** bằng bucket tạm; mã sách theo digest được giữ để tiến độ tiếp tục khớp. Tệp tải offline của truyện có sẵn và cài đặt riêng của máy không được tải lên.

## Chuyển ebook bằng bucket tạm

Sau khi bật đồng bộ, mở **Chuyển ebook sang máy khác**, chọn một ebook đã nhập trên máy và bấm **Gửi sách**. Máy còn lại đăng nhập cùng tài khoản, mở mục này và bấm **Nhận sách**. Sau khi tải lên hoàn tất, máy gửi có thể đóng ứng dụng; máy nhận có 30 phút để nhận. Danh sách cập nhật mỗi 10 giây khi hộp thoại/mục chuyển đang mở, hoặc bằng **Kiểm tra sách chờ nhận**.

- Bucket `ebook-transfers` là riêng tư. Đường dẫn cố định `<user-id>/<transfer-id>/book.zip`; RLS giới hạn theo tài khoản và phiên còn hiệu lực. Không dùng link public hoặc signed URL. Không được ghi đè object đã tải lên.
- Chuyển gói ZIP nội bộ chứa đúng một ebook đã phân tích cùng bìa, ảnh, định dạng và thay đổi chương TXT; không gửi nguyên bản EPUB/PDF gốc, cài đặt, ghi chú, token hay mật khẩu. Ghi chú/tiến độ vẫn dùng luồng đồng bộ riêng. Giới hạn gói 50 MB, nội dung giải nén 150 MB.
- Máy nhận kiểm tra dung lượng, SHA-256 của gói và cấu trúc nội dung, lưu IndexedDB rồi đọc lại xác nhận. Chỉ sau bước này mới gửi biên nhận cho server, gọi Storage API xóa object và cuối cùng xóa metadata. Mã sách/digest được giữ. Nếu sách đã có, giữ bản cục bộ thay vì ghi đè chỉnh sửa.
- Khi đã nhận, có nút **Mở sách vừa nhận** và sách xuất hiện trong **Ebook cá nhân**. Nhận sách không tự chuyển chương của người đang đọc.
- Tải hỏng/hết quota không gửi biên nhận, không xóa bản trên bucket. Nếu xóa bị lỗi, sách đã lưu vẫn đọc được, metadata giữ trạng thái đã nhận và có nút **Xóa bản tạm** để thử lại. **Hủy gửi/Từ chối** xóa bản tạm, giữ sách đã có trên thiết bị.
- Mỗi phiên dành cho một máy nhận. Muốn gửi tới máy thứ ba thì gửi lại từ một máy đã có sách.
- Tệp hết hạn bị chặn tải sau 30 phút. Để xóa vật lý khi mọi máy đã đóng app, cần triển khai tác vụ phía server bên dưới. Tác vụ chạy mỗi phút, xử lý cả phiên đã nhận chưa dọn được, phiên tải lên dở và object mồ côi. Xóa vật lý diễn ra ở lượt dọn kế tiếp, không phải đúng giây hết hạn; lỗi máy chủ sẽ thử lại lượt sau.

### Thiết lập chuyển sách trên Supabase

Phần này cần quyền quản trị project; anon key không thể tạo bucket/policy hoặc triển khai Edge Function. Browser chỉ dùng anon key và phiên của người dùng.

1. Chạy `supabase/migrations/202610230002_ebook_transfers.sql` trong SQL Editor. File tạo bucket riêng tư, bảng, các RPC và RLS; có thể chạy lại. Các helper operation của Storage phải có theo phiên bản Supabase hiện tại.
2. Triển khai `supabase/functions/cleanup-ebook-transfers/index.ts` thành Edge Function **cleanup-ebook-transfers**. Qua CLI đã đăng nhập: `supabase functions deploy cleanup-ebook-transfers --project-ref nwcprblwytxqgheflnfy --no-verify-jwt`. Có thể tạo function cùng tên bằng Dashboard và dùng nội dung file. Function dùng header bí mật riêng nên cần tắt **Verify JWT** cho function này.
3. Tạo chuỗi bí mật ngẫu nhiên ít nhất 32 byte; lưu trong **Edge Functions → Secrets** với tên `EBOOK_CLEANUP_SECRET`, đồng thời lưu cùng giá trị trong **Vault** với tên `ebook_cleanup_secret`. Không đưa chuỗi này vào repo hoặc frontend. `SUPABASE_URL` và `SUPABASE_SERVICE_ROLE_KEY` là biến có sẵn của Edge Function; tuyệt đối không đặt service-role key trong `sync-config.js`.
4. Chạy `supabase/setup/ebook-transfer-cleanup.sql` để bật Cron/pg_net và đặt lịch dọn mỗi phút. File đã điền URL project hiện tại; đổi URL nếu dùng project khác. Script từ chối tạo lịch khi thiếu Vault secret. Kiểm tra Cron và Edge Function Logs có HTTP 200; không coi việc chỉ có mã nguồn là tác vụ đã triển khai.

Nếu chưa triển khai function/lịch, xóa sau khi nhận vẫn chạy từ browser khi Storage hoạt động; tệp bị bỏ dở **chưa được bảo đảm tự xóa** khi mọi máy đóng. Đây là bước cấu hình cần hoàn tất trước khi phát hành tính năng.

## Cấu hình Supabase

1. Chạy `supabase/migrations/202610230001_reader_sync.sql` trong SQL Editor. Migration tạo bảng và RPC; có thể chạy lại.
2. Trong **Authentication → URL Configuration**, đặt **Site URL** thành địa chỉ website đã triển khai. Thêm URL callback của từng môi trường vào **Redirect URLs**, gồm `http://localhost:3000/sync-auth.html` khi phát triển và `https://<domain>/sync-auth.html` khi triển khai.
3. Giữ Email provider và các mẫu email **Confirm signup / Reset password** với liên kết xác nhận mặc định `{{ .ConfirmationURL }}`. Ứng dụng dùng Supabase Auth implicit flow cho SPA, nhận phiên trên trang callback riêng trước khi về kệ; fragment chứa token được xóa. Trang gốc cũng chuyển fragment Auth về callback để hỗ trợ Site URL mặc định.
4. URL/anon key công khai ở `public/sync-config.js`. Browser không dùng service-role key. SDK khóa phiên bản trong `package.json`; chạy `npm run vendor-sync` để cập nhật bản UMD và giấy phép trong `public/vendor/supabase/`.

Project hiện đã được kiểm tra kết nối đến Auth và đã có bảng; người chưa đăng nhập không có quyền đọc bảng. Việc gửi email thực và đăng nhập trên thiết bị thật cần kiểm tra với cấu hình redirect/email của project. Các kiểm tra tự động chặn toàn bộ yêu cầu Supabase bằng fixture, không gửi email thật.

## Hành vi đồng bộ

- Tự đồng bộ sau khi thay đổi khoảng một giây, khi mở lại tab, khi có mạng trở lại và mỗi 20 giây trong tab đang hiển thị. Có nút **Kiểm tra đồng bộ** để chạy ngay.
- **Kiểm tra đồng bộ** thực sự đọc dữ liệu đám mây và gửi các thay đổi đang chờ. Biểu tượng xoay trong lúc chờ phản hồi, hiện dấu tích khi mọi mục đã khớp; có giờ thành công gần nhất, số mục đã gửi/nhận và số mục đang chờ. Trạng thái offline, lỗi và xung đột dùng màu/ký hiệu riêng; thông báo lỗi không cập nhật giờ thành công. Yêu cầu sync hết hạn sau 15 giây để tránh xoay mãi. Hiệu ứng tắt theo cài đặt giảm chuyển động của hệ điều hành.
- Mỗi vị trí đọc, chương, ghi chú và trường yêu thích/trạng thái/nhóm là một record riêng. Không đẩy nguyên file backup hoặc ghi đè toàn bộ thư viện.
- Mỗi record có revision do server tăng. RPC chỉ cập nhật khi revision gốc vẫn khớp. Khi hai máy thay đổi cùng record, cả hai phiên bản được giữ: người dùng chọn **Giữ trên máy này** hoặc **Nhận từ đám mây**. Nếu có thay đổi mới trong lúc chọn, ứng dụng kiểm tra revision lần nữa.
- Xóa ghi chú hoặc đặt lại tiến độ tạo tombstone để máy cũ không làm dữ liệu đã xóa xuất hiện lại. Không có quyền xóa vật lý record từ browser.
- Dữ liệu đọc vẫn lưu cục bộ khi offline. Nhật ký revision/outbox nằm trong IndexedDB `ketruyen-sync-v1`; phiên đăng nhập dùng key `ketruyen-auth-v1`, ngoài phạm vi sao lưu `tenshi-*`.
- Web Locks tránh hai tab cùng đồng bộ một lượt khi trình duyệt hỗ trợ; CAS trên server vẫn kiểm tra mọi lần ghi.
- Đăng xuất ngừng tự đồng bộ trên máy và giữ bản đọc cục bộ. Đổi tài khoản cần bấm bật đồng bộ riêng; nút này kết hợp dữ liệu cục bộ với tài khoản đang hiển thị.
- Nhận dữ liệu cập nhật kệ/tiến độ/ghi chú trong bộ nhớ, không tự chuyển chương hay đưa người đang đọc sang vị trí khác.

## Kiểm tra

`npm test` gồm thử merge hai máy, xóa/reset, offline, mất quota, thay đổi trong lúc chờ mạng và cạnh tranh RPC. Migration được chạy thật trong PGlite/PostgreSQL để kiểm tra phân quyền hai tài khoản, thay đổi chủ sở hữu, CAS và tombstone. `npm run test:e2e` dùng SDK browser thật với HTTP fixture để thử desktop/mobile, opt-in, đăng ký/đăng nhập mật khẩu, khôi phục tài khoản, tải dữ liệu, chọn xung đột, đăng xuất và đổi tài khoản.

Tài liệu tham khảo: [Password security](https://supabase.com/docs/guides/auth/password-security), [Password authentication](https://supabase.com/docs/guides/auth/passwords), [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).
