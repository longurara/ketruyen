# Email tài khoản Kệ truyện

Mở [preview.html](preview.html) trong trình duyệt để chọn mẫu, xem ở kích thước máy tính/điện thoại và sao chép tiêu đề cùng HTML. Chế độ xem trước thay biến bằng dữ liệu minh họa; nút sao chép giữ nguyên biến thật của Supabase. Trang này không gửi email.

Trong Supabase → Authentication → Email → Templates, mở đúng mục, dán Subject và toàn bộ nội dung file HTML vào Body/Source, rồi Save. Không dán preview.html vào Supabase. [Tài liệu Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates).

| Mục Supabase | Subject | Body HTML |
|---|---|---|
| Confirm sign up | Xác nhận email để bắt đầu đọc | Kệ truyện | [confirm-signup.html](confirm-signup.html) |
| Invite user | Một lời mời đến Kệ truyện dành cho bạn | [invite-user.html](invite-user.html) |
| Magic link or OTP | Liên kết đăng nhập của bạn | Kệ truyện | [magic-link.html](magic-link.html) |
| Change email address | Xác nhận thay đổi email của bạn | Kệ truyện | [change-email.html](change-email.html) |
| Reset password | Đặt lại mật khẩu tài khoản | Kệ truyện | [reset-password.html](reset-password.html) |
| Reauthentication | Mã xác minh tài khoản của bạn | Kệ truyện | [reauthentication.html](reauthentication.html) |
| Password changed | Mật khẩu của bạn đã được thay đổi | Kệ truyện | [password-changed.html](password-changed.html) |
| Email address changed | Địa chỉ email tài khoản đã được thay đổi | Kệ truyện | [email-address-changed.html](email-address-changed.html) |

## Các luồng xác thực

- Ứng dụng hiện dùng email + mật khẩu. Ưu tiên áp dụng Confirm sign up và Reset password. Các mẫu xác thực khác sẵn cho các luồng tương ứng khi bạn bật hoặc phát triển chúng; thay template không tự thêm tính năng đăng nhập/mời/đổi email vào app.
- Năm mẫu liên kết dùng nguyên biến `{{ .ConfirmationURL }}` cho nút và URL dự phòng. Không đổi thành SiteURL hoặc URL website thuần vì sẽ bỏ mất bước xác thực của Supabase.
- Magic link or OTP trong bộ này dùng phiên bản liên kết đăng nhập. Reauthentication dùng `{{ .Token }}` để nhập tại màn hình đang yêu cầu xác minh. Không cố định số chữ số hay thời hạn trong bản email thực; thời hạn do cấu hình Supabase quyết định.
- Change email address dùng `{{ .NewEmail }}`. Nếu bật Secure email change, có thể cần xác nhận ở cả hộp thư cũ và mới.
- Hai mẫu **Password changed** và **Email address changed** nằm trong mục Security notifications của Supabase. Sau khi dán mẫu, giữ công tắc gửi thông báo ở trạng thái bật. Mẫu chỉ thông báo thay đổi đã xảy ra; nút mở `{{ .SiteURL }}`, không dùng ConfirmationURL hoặc OTP.
- **Email address changed** dùng `{{ .OldEmail }}` cho email cũ và `{{ .Email }}` cho email mới; không dùng NewEmail ở mẫu thông báo này. **Password changed** dùng Email và không chứa mật khẩu.
- Header/footer dùng `{{ .SiteURL }}`; đặt Site URL thành website triển khai và cho phép callback `https://www.hikarilong.io.vn/sync-auth.html` trong Redirect URLs (và URL không www nếu bạn sử dụng origin đó).
- Trong Resend, tắt click tracking cho tên miền email Auth để giữ nguyên liên kết xác thực. [Lưu ý của Supabase về email tracking](https://supabase.com/docs/guides/auth/auth-email-templates#email-tracking).
- Kiểm tra email thật bằng tài khoản thử do bạn kiểm soát: nội dung, nút, URL dự phòng, thư mục spam và callback. Chưa gửi thử email thật hoặc cập nhật Dashboard trong tác vụ tạo bộ mẫu này.

## Thiết kế và tái tạo

HTML độc lập, bảng layout, style inline, font Arial/Segoe UI/Tahoma và văn bản chuẩn Unicode NFC, không tải ảnh/font ngoài. Media query thu gọn khoảng cách trên điện thoại; phần nội dung vẫn đọc được khi client bỏ CSS trong head. Không dùng mã JavaScript trong email. Các email ngắn dưới 12 KB mỗi mẫu.

Mã nguồn sinh bộ mẫu: `scripts/build-auth-emails.js`. Chạy `node scripts/build-auth-emails.js` để sinh lại toàn bộ file; sửa nội dung ở script để tránh mất chỉnh sửa khi sinh lại. Các file này không tự triển khai lên Supabase khi push Git.
