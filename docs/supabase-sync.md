# Đồng bộ giữa các máy

## Nâng cấp đa thiết bị (0003 → frontend → 0004)

Không chạy hai migration mới cùng lúc trước khi cập nhật frontend. Bản cũ chưa đăng ký `session_id` sẽ bị chặn sau bước 3.

1. Trong SQL Editor, chạy `supabase/migrations/202610230003_reader_workspace.sql`. Migration này bổ sung bảng/API, chưa chặn các bản frontend cũ đọc tiến độ. Có thể chạy lại.
2. Deploy frontend mới, gồm `reader-workspace.js`, `cloud-workspace.js` và service worker `tenshi-shell-v34`. Tải lại trang trên các máy, bật đồng bộ và mở **Thiết bị** để thấy máy đã đăng ký. Trước 0004, kết nối Presence riêng tư có thể chưa được phép; kiểm tra 20 giây và heartbeat vẫn hoạt động.
3. Chạy `supabase/migrations/202610230004_enforce_reader_devices.sql`. Từ đây dữ liệu đọc và bucket chỉ cho phiên đã đăng ký, còn trong `auth.sessions`, chưa bị thu hồi. Chạy lại file an toàn. Nếu dùng CLI, đừng `db push` cả 0003/0004 trước bước deploy ở giữa.
4. Chạy `supabase/setup/reader-workspace-cleanup.sql`. Job `reader-workspace-cleanup` chạy mỗi giờ, xóa phiên bản ghi chú quá 30 ngày, hoạt động quá 366 ngày và yêu cầu sách quá 30 phút. Giữ job/Edge Function dọn ebook đã thiết lập trước đó; SQL này không thay thế việc xóa object qua Storage API.

Ứng dụng chỉ có anon key và không tự thực hiện các bước quản trị này. Kiểm thử local không chứng minh migration, cron hay cấu hình Auth đã được bật trên project thật.

### Thiết bị, bảo mật và chuyển tiếp

- **Tài khoản → Đồng bộ / Thiết bị / Bảo mật**: đổi tên từng trình duyệt/PWA, xem hoạt động gần nhất, thu hồi một máy hoặc đăng xuất các phiên khác. Một lần đăng nhập mới trên cùng cài đặt thay thế ràng buộc phiên cũ và giữ tên tùy chỉnh.
- Đăng ký gắn với `session_id` trong JWT do Supabase cấp và hàng tương ứng trong `auth.sessions`. Một phiên đã thu hồi không thể đăng ký lại bằng UUID thiết bị khác. Mọi RPC quản lý đều giới hạn trong tài khoản hiện tại. Thu hồi **chặn cloud**, không xóa từ xa sách hay bản đọc đã lưu offline.
- Vị trí văn bản chỉ gửi khi đổi, tối đa mỗi 5 giây; heartbeat mỗi 30 giây khi app đang hiển thị. Máy được xem là offline khi heartbeat quá 90 giây và không có Presence. Trình duyệt có thể tạm dừng timer khi app ở nền.
- Banner đọc tiếp chỉ đưa bạn sang sách/chương sau khi bấm **Đọc tiếp tại đây**. Vị trí gồm sách, chương và neo văn bản; không gửi chiều rộng màn hình hay tọa độ cuộn của máy nguồn. Nếu thiếu ebook, xác nhận gửi yêu cầu đến máy nguồn; máy nguồn chọn sách và bấm **Gửi sách** để chấp thuận.
- Trong **Chuyển ebook**, chọn máy nhận, kể cả máy đang offline. Máy đó có 30 phút để nhận. RLS lọc cả metadata và Storage theo máy gửi/nhận; lưu bền vào IndexedDB thành công rồi mới xác nhận và xóa object.
- Đổi mật khẩu yêu cầu nhập lại và không lưu mật khẩu vào dữ liệu ứng dụng. Khi Supabase bật Secure password change và yêu cầu xác minh lại, bấm **Gửi mã xác minh**, nhập mã email rồi lưu lại. Quên mật khẩu/callback cũ tiếp tục hoạt động.
- Đổi email hiển thị địa chỉ hiện tại và `new_email` đang chờ nếu Supabase trả về. Khi bật Secure email change trong Dashboard, phải xác nhận cả hộp thư cũ lẫn mới. Email xác nhận và thông báo bảo mật vẫn dùng Supabase Auth → Resend và các template trong `supabase/email-templates/`.

Realtime chỉ đăng ký bảng `reader_signals` (user ID và bộ đếm); Presence chỉ có UUID thiết bị. Không phát nội dung ghi chú, sách hay mật khẩu lên kênh. Khi kênh mất kết nối, vòng kiểm tra 20 giây vẫn đọc dữ liệu qua API/RLS. Đổi tài khoản/phiên sẽ hủy kênh, đổi chủ hàng đợi và chặn kết quả đang chờ của phiên cũ.

### Thống kê và mục tiêu

Khoảng đọc/nghe có UUID riêng, UTC, sách, thiết bị, lần tương tác gần nhất và ID mục tiêu. Mỗi khoảng tối đa 30 giây, được ghi IndexedDB mỗi nhịp 5 giây và gửi lại cùng ID khi mất mạng. Server tuần tự hóa revision theo tài khoản; frontend đọc đến watermark cố định để không bỏ sót lần ghi đồng thời.

Bộ tổng hợp lấy hợp các khoảng thời gian. Phần giao nhau thuộc lần tương tác mới nhất, sau đó phân xử bằng ID ổn định; không cộng bộ đếm từ từng máy. Mục tiêu chỉ đồng bộ định nghĩa (`id`, loại, đích, thời điểm bắt đầu) qua CAS; tiến độ lấy từ hoạt động và tập ID chương hoàn thành. Hai máy sửa cùng mục tiêu sẽ hiện lựa chọn bản giữ lại.

**Thống kê** có lịch 366 ngày và chuỗi ngày đạt ít nhất một phút đọc/nghe. Múi giờ tài khoản thống nhất `Asia/Ho_Chi_Minh`. Cài đặt đọc, danh sách nhân vật và các tiện ích khác không được tải nguyên trạng lên server.

Khi nâng cấp, máy đóng băng một bản thống kê cũ riêng trước nhịp hoạt động mới. Tại **Đồng bộ → Thống kê trước khi đồng bộ**, chọn **Dùng thống kê cũ của máy này** trên đúng máy gốc. Server chỉ nhận một lần, lưu mốc trước đồng bộ; số liệu từ máy khác vẫn ở cục bộ, không tự cộng vào tài khoản. Khi chưa chọn máy gốc, thống kê cloud chỉ hiển thị hoạt động mới.

### Thùng rác và lịch sử ghi chú

Trong **Ghi chú**, mở **Thùng rác** hoặc **Lịch sử chỉnh sửa** của một đánh dấu, tô màu hay ghi chú. Lưu/xóa mới ghi lịch sử; gõ từng phím không tạo revision. Phiên bản cục bộ và nội dung ghi chú được lưu trong cùng một lần ghi, nên lỗi quota không xác nhận mất dữ liệu thành công.

Khôi phục giữ ID và neo văn bản, tạo revision mới. Khôi phục/xóa trên cloud dùng revision dự kiến; nếu máy khác đã thay đổi ghi chú, thao tác bị chặn để người dùng kiểm tra đồng bộ và chọn bản giữ lại. Khi offline vẫn lưu lịch sử và cho khôi phục cục bộ; xóa vĩnh viễn được xếp hàng và phải kiểm tra xung đột khi có mạng, giao diện báo đang chờ thay vì xác nhận đã xóa trên cloud.

Xóa vĩnh viễn cần xác nhận, xóa các bản lưu trữ và giữ tombstone hiện tại cùng mốc purge. Máy cũ không được tự gửi một bản ghi đã bị purge trở lại. Lịch sử chỉ có từ lần nâng cấp này, hết hạn sau 30 ngày (RLS ẩn ngay khi hết hạn; cron xóa vật lý ở lượt kế tiếp).

### Kiểm tra trước khi mở rộng cho người dùng

`npm test` chạy Postgres/PGlite với cả bốn migration, chạy lại migration để kiểm tra tính lặp, hai tài khoản/ba phiên, JWT còn hạn bị thu hồi, Storage đúng máy nhận, CAS khôi phục/xóa và hàng đợi hoạt động trùng ID. Các test thuần kiểm tra giao nhau, phân xử ổn định, mốc nửa đêm Việt Nam, chuỗi ngày, mục tiêu cạnh tranh và mốc nhập thống kê.

`npm run test:e2e` dùng SDK browser thật với HTTP/WebSocket fixture: không tạo tài khoản và không gửi email thật. Bao gồm desktop/mobile, đổi tên/thu hồi máy, OTP xác thực lại khi đổi mật khẩu, đổi email, callback khôi phục, đọc tiếp khi khác kích thước màn hình, thiếu ebook, khôi phục ghi chú, lịch đọc và gửi ZIP đến máy offline đã chọn. Tải hỏng/quota/xóa bucket lỗi được kiểm tra riêng.

Trên Supabase thật, dùng hai tài khoản thử và hai máy để xác nhận RLS/Storage, thu hồi với JWT chưa hết hạn, thư xác minh trong cả hai hộp thư, Realtime riêng tư và các lượt cron. Thử này cần thao tác quản trị thực tế; không được suy ra từ kết quả fixture.

Mở biểu tượng đám mây trên thanh đầu trang hoặc **Thư viện → ⋯ → Đồng bộ giữa các máy**. Đăng nhập bằng email và mật khẩu; nếu chưa có tài khoản, bấm **Tạo tài khoản** và xác nhận email nếu project yêu cầu. Sau khi đăng nhập, bấm **Bật đồng bộ cho máy này**. Làm tương tự trên thiết bị thứ hai với cùng tài khoản.

Mật khẩu do Supabase Auth băm bằng bcrypt với salt phía server; ứng dụng không lưu mật khẩu trong localStorage, IndexedDB hay bảng đồng bộ. Đăng ký và đổi mật khẩu yêu cầu ít nhất 8 ký tự, tối đa 72 byte theo giới hạn bcrypt. Phiên đăng nhập/refresh token do SDK quản lý riêng. Nếu quên mật khẩu, nhập email rồi chọn **Quên mật khẩu?**, mở email khôi phục và nhập mật khẩu mới hai lần. Liên kết xác nhận/khôi phục chạy qua trang `sync-auth.html`, cho phép mở email trên trình duyệt khác.

Đồng bộ vị trí đang đọc, vị trí trong từng chương, dấu đã đọc, lịch sử gần đây, yêu thích, trạng thái/nhóm sách và đánh dấu/ghi chú. Tệp ebook không tự động tải lên cùng tiến độ. Bạn có thể chủ động **Chuyển ebook sang máy khác** bằng bucket tạm; mã sách theo digest được giữ để tiến độ tiếp tục khớp. Tệp tải offline của truyện có sẵn và cài đặt riêng của máy không được tải lên.

## Chuyển ebook bằng bucket tạm

Sau khi bật đồng bộ, mở **Chuyển ebook sang máy khác**, chọn một ebook đã nhập trên máy, chọn thiết bị nhận và bấm **Gửi sách**. Máy còn lại đăng nhập cùng tài khoản, mở mục này và bấm **Nhận sách**. Sau khi tải lên hoàn tất, máy gửi có thể đóng ứng dụng; máy nhận có 30 phút để nhận. Danh sách cập nhật mỗi 10 giây khi hộp thoại/mục chuyển đang mở, hoặc bằng **Kiểm tra sách chờ nhận**.

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
