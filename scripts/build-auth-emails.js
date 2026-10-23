// Standalone HTML bodies for Supabase Dashboard. No build step in the app.
const fs = require("node:fs"), path = require("node:path");
const directory = path.join(__dirname, "../supabase/email-templates");
const templates = [
  {
    id: "confirm-signup", name: "Confirm sign up", label: "Xác nhận đăng ký", key: "confirmation",
    subject: "Xác nhận email để bắt đầu đọc | Kệ truyện",
    preheader: "Chỉ còn một bước để mang câu chuyện của bạn đến mọi thiết bị.",
    eyebrow: "MỘT KHỞI ĐẦU MỚI", title: "Chào mừng bạn<br>đến Kệ truyện.",
    intro: "Một góc nhỏ dành cho những câu chuyện bạn yêu. Xác nhận địa chỉ email để hoàn tất đăng ký và bắt đầu đọc cùng chúng mình.",
    detail: "Địa chỉ đăng ký", value: "{{ .Email }}", button: "Xác nhận email",
    note: "Sau khi xác nhận, bạn có thể bật đồng bộ để mang vị trí đọc và ghi chú sang thiết bị khác.",
    safety: "Nếu bạn không đăng ký tài khoản này, hãy bỏ qua email."
  },
  {
    id: "invite-user", name: "Invite user", label: "Lời mời tham gia", key: "invite",
    subject: "Một lời mời đến Kệ truyện dành cho bạn",
    preheader: "Nhận lời mời để mở một góc đọc dành riêng cho bạn.",
    eyebrow: "MỘT LỜI MỜI DÀNH RIÊNG", title: "Có một chỗ<br>dành cho bạn.",
    intro: "Bạn được mời tham gia Kệ truyện. Nhận lời mời bên dưới để bắt đầu khám phá thư viện và lưu lại những câu chuyện mình yêu thích.",
    detail: "Lời mời gửi đến", value: "{{ .Email }}", button: "Nhận lời mời",
    note: "Một cuốn sách hay sẽ càng đáng nhớ khi bạn có thể trở lại với nó bất cứ lúc nào.",
    safety: "Nếu bạn không mong đợi lời mời này, bạn có thể bỏ qua email."
  },
  {
    id: "magic-link", name: "Magic link or OTP", label: "Liên kết đăng nhập", key: "magic_link",
    subject: "Liên kết đăng nhập của bạn | Kệ truyện",
    preheader: "Trở về trang sách đang chờ bạn bằng liên kết đăng nhập này.",
    eyebrow: "TRỞ LẠI VỚI CÂU CHUYỆN", title: "Trang sách cũ,<br>đang chờ bạn.",
    intro: "Bạn vừa yêu cầu một liên kết đăng nhập vào Kệ truyện. Bấm nút bên dưới để tiếp tục với tài khoản của mình.",
    detail: "Tài khoản", value: "{{ .Email }}", button: "Đăng nhập Kệ truyện",
    note: "Liên kết chỉ dùng được một lần. Hãy mở liên kết trên thiết bị bạn muốn đăng nhập.",
    safety: "Nếu bạn không yêu cầu đăng nhập, hãy bỏ qua email. Không chuyển tiếp liên kết này cho người khác."
  },
  {
    id: "change-email", name: "Change email address", label: "Thay đổi email", key: "email_change",
    subject: "Xác nhận thay đổi email của bạn | Kệ truyện",
    preheader: "Xác nhận yêu cầu thay đổi địa chỉ email cho tài khoản Kệ truyện.",
    eyebrow: "CẬP NHẬT TÀI KHOẢN", title: "Địa chỉ mới,<br>câu chuyện tiếp nối.",
    intro: "Chúng mình nhận được yêu cầu thay đổi địa chỉ email cho tài khoản Kệ truyện của bạn. Kiểm tra địa chỉ mới bên dưới trước khi xác nhận.",
    detail: "Địa chỉ email mới", value: "{{ .NewEmail }}", button: "Xác nhận thay đổi email",
    note: "Nếu hệ thống yêu cầu xác nhận ở cả hai địa chỉ, hãy hoàn tất bước xác nhận trong từng hộp thư.",
    safety: "Nếu bạn không yêu cầu thay đổi, đừng bấm xác nhận. Hãy mở Kệ truyện để kiểm tra tài khoản của bạn."
  },
  {
    id: "reset-password", name: "Reset password", label: "Đặt lại mật khẩu", key: "recovery",
    subject: "Đặt lại mật khẩu tài khoản | Kệ truyện",
    preheader: "Tạo mật khẩu mới để trở lại với những trang sách của bạn.",
    eyebrow: "TRỞ LẠI THẬT DỄ DÀNG", title: "Một mật khẩu mới.<br>Vẫn là kệ sách của bạn.",
    intro: "Quên mật khẩu cũng không sao. Chúng mình đã nhận được yêu cầu khôi phục tài khoản. Bấm nút bên dưới để chọn mật khẩu mới.",
    detail: "Tài khoản cần khôi phục", value: "{{ .Email }}", button: "Đặt lại mật khẩu",
    note: "Mật khẩu hiện tại chỉ thay đổi sau khi bạn hoàn tất đặt mật khẩu mới. Không chia sẻ liên kết này với người khác.",
    safety: "Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này."
  },
  {
    id: "reauthentication", name: "Reauthentication", label: "Mã xác minh lại", key: "reauthentication",
    subject: "Mã xác minh tài khoản của bạn | Kệ truyện",
    preheader: "Dùng mã trong email để xác nhận thao tác bạn vừa yêu cầu.",
    eyebrow: "THÊM MỘT BƯỚC AN TÂM", title: "Xác nhận là bạn,<br>rồi mình tiếp tục.",
    intro: "Để bảo vệ tài khoản, hãy nhập mã dưới đây vào màn hình đang yêu cầu xác minh trên Kệ truyện.",
    detail: "Xác minh cho", value: "{{ .Email }}", otp: true,
    note: "Mã chỉ dùng được một lần. Nếu mã đã hết hạn, hãy quay lại màn hình xác minh để yêu cầu mã mới.",
    safety: "Không chia sẻ mã với bất kỳ ai. Nếu bạn không thực hiện thao tác này, hãy bỏ qua email."
  },
  {
    id: "password-changed", name: "Password changed", label: "Đã đổi mật khẩu", key: "password_changed_notification", notification: true,
    subject: "Mật khẩu của bạn đã được thay đổi | Kệ truyện",
    preheader: "Thông báo bảo mật: mật khẩu tài khoản Kệ truyện vừa được cập nhật.",
    eyebrow: "THÔNG BÁO BẢO MẬT", title: "Mật khẩu của bạn<br>đã được thay đổi.",
    intro: "Chúng mình gửi email này để thông báo rằng mật khẩu tài khoản Kệ truyện của bạn đã được thay đổi thành công.",
    detail: "Tài khoản được cập nhật", value: "{{ .Email }}", button: "Mở Kệ truyện",
    note: "Nếu bạn vừa đổi hoặc đặt lại mật khẩu, bạn không cần thực hiện thêm bước nào. Hãy dùng mật khẩu mới ở lần đăng nhập tiếp theo.",
    safety: "Nếu không phải bạn thực hiện, hãy mở Kệ truyện và chọn Quên mật khẩu để đặt lại ngay. Không chia sẻ mật khẩu hoặc mã xác minh với người khác."
  },
  {
    id: "email-address-changed", name: "Email address changed", label: "Đã đổi địa chỉ email", key: "email_changed_notification", notification: true,
    subject: "Địa chỉ email tài khoản đã được thay đổi | Kệ truyện",
    preheader: "Thông báo bảo mật: địa chỉ email cho tài khoản Kệ truyện vừa thay đổi.",
    eyebrow: "THÔNG BÁO BẢO MẬT", title: "Email đã thay đổi.<br>Kệ sách vẫn là của bạn.",
    intro: "Địa chỉ email đăng nhập tài khoản Kệ truyện của bạn đã được cập nhật. Thông tin thay đổi được ghi lại bên dưới để bạn kiểm tra.",
    previousDetail: "Địa chỉ email trước đây", previousValue: "{{ .OldEmail }}",
    detail: "Địa chỉ email mới", value: "{{ .Email }}", button: "Mở Kệ truyện",
    note: "Nếu đây là thay đổi của bạn, hãy dùng địa chỉ email mới ở lần đăng nhập tiếp theo. Email này chỉ thông báo, không yêu cầu xác nhận lại.",
    safety: "Nếu bạn không thực hiện thay đổi này, hãy liên hệ người quản trị Kệ truyện để được hỗ trợ kiểm tra và khôi phục tài khoản."
  }
];
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function renderEmail(t) {
  const action = t.otp ? `
                    <p style="margin:0 0 12px;color:#49614e;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;letter-spacing:1px;">MÃ XÁC MINH CỦA BẠN</p>
                    <div style="padding:20px 10px;border:1px solid #ccd8c5;border-radius:12px;background-color:#eef3e9;text-align:center;">
                      <span dir="ltr" style="color:#244735;font-family:'Courier New',monospace;font-size:30px;font-weight:bold;letter-spacing:3px;white-space:nowrap;">{{ .Token }}</span>
                    </div>` : `
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                      <td align="center" bgcolor="#2d513e" style="border-radius:8px;mso-padding-alt:16px 26px;">
                        <a href="${t.notification ? "{{ .SiteURL }}" : "{{ .ConfirmationURL }}"}" style="display:inline-block;padding:16px 26px;border:1px solid #2d513e;border-radius:8px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;line-height:22px;text-align:center;text-decoration:none;">${escape(t.button)} &nbsp; &#8594;</a>
                      </td>
                    </tr></table>`;
  const fallback = t.otp || t.notification ? "" : `
                  <tr><td class="email-pad" style="padding:0 36px 30px;">
                    <p style="margin:0 0 8px;color:#716d64;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:20px;">Nếu nút không mở được, sao chép liên kết này vào trình duyệt:</p>
                    <a href="{{ .ConfirmationURL }}" style="display:block;color:#49614e;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;text-decoration:underline;overflow-wrap:anywhere;word-break:break-all;">{{ .ConfirmationURL }}</a>
                  </td></tr>`;
  return `<!doctype html>
<html lang="vi" xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <meta name="x-apple-disable-message-reformatting">
    <title>${escape(t.subject)}</title>
    <style>
      @media only screen and (max-width:480px) {
        .email-outer { padding:20px 12px !important; }
        .email-pad { padding-left:24px !important; padding-right:24px !important; }
        .email-title { font-size:28px !important; line-height:38px !important; }
        .email-tagline { display:none !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;width:100%;background-color:#f3f0e8;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
    <div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;mso-hide:all;">${escape(t.preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f3f0e8" style="width:100%;background-color:#f3f0e8;">
      <tr><td class="email-outer" align="center" style="padding:36px 16px 28px;">
        <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
          <tr><td style="padding:0 4px 22px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
              <td valign="middle"><a href="{{ .SiteURL }}" style="color:#263c2e;font-family:Arial,'Segoe UI',Tahoma,Helvetica,sans-serif;font-size:26px;font-weight:bold;letter-spacing:normal;line-height:36px;text-decoration:none;">Kệ truyện<span style="color:#8a9f79;">.</span></a></td>
              <td class="email-tagline" align="right" valign="middle" style="color:#77766a;font-family:Arial,'Segoe UI',Tahoma,Helvetica,sans-serif;font-size:12px;line-height:20px;">Mỗi ngày, một trang sách.</td>
            </tr></table>
          </td></tr>
          <tr><td bgcolor="#fffdf8" style="border:1px solid #dedfd3;border-radius:16px;background-color:#fffdf8;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;">
              <tr><td class="email-pad" style="padding:30px 36px 0;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                  <td width="6" height="26" bgcolor="#8ea480" style="width:6px;height:26px;background-color:#8ea480;border-radius:2px;">&nbsp;</td><td width="4" style="width:4px;">&nbsp;</td>
                  <td width="7" height="26" bgcolor="#c6cbae" style="width:7px;height:26px;background-color:#c6cbae;border-radius:2px;">&nbsp;</td><td width="4" style="width:4px;">&nbsp;</td>
                  <td width="6" height="26" bgcolor="#c7ac8c" style="width:6px;height:26px;background-color:#c7ac8c;border-radius:2px;">&nbsp;</td>
                </tr></table>
                <p style="margin:24px 0 14px;color:#66795b;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:bold;letter-spacing:2px;line-height:18px;">${escape(t.eyebrow)}</p>
                <h1 class="email-title" style="margin:0 0 20px;color:#283728;font-family:Arial,'Segoe UI',Tahoma,Helvetica,sans-serif;font-size:34px;font-weight:bold;letter-spacing:normal;line-height:44px;">${t.title}</h1>
                <p style="margin:0 0 26px;color:#57594f;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:25px;">${escape(t.intro)}</p>
              </td></tr>
              <tr><td class="email-pad" style="padding:0 36px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f3f3eb" style="width:100%;table-layout:fixed;background-color:#f3f3eb;border-radius:8px;"><tr><td style="padding:14px 18px;">
                  ${t.previousValue ? `<p style="margin:0 0 5px;color:#767b6b;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;">${escape(t.previousDetail)}</p><p style="margin:0 0 16px;padding-bottom:14px;border-bottom:1px solid #dfe3d6;color:#66705e;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;overflow-wrap:anywhere;word-break:break-all;">${t.previousValue}</p>` : ""}
                  <p style="margin:0 0 5px;color:#767b6b;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;">${escape(t.detail)}</p>
                  <p style="margin:0;color:#35432f;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;overflow-wrap:anywhere;word-break:break-all;">${t.value}</p>
                </td></tr></table>
              </td></tr>
              <tr><td class="email-pad" style="padding:0 36px 24px;">${action}
              </td></tr>
              <tr><td class="email-pad" style="padding:0 36px 26px;">
                <p style="margin:0;color:#74766a;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:22px;">${escape(t.note)}</p>
              </td></tr>${fallback}
              <tr><td class="email-pad" style="padding:22px 36px;border-top:1px solid #e6e6dc;">
                <p style="margin:0;color:#77786d;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:20px;">${escape(t.safety)}</p>
              </td></tr>
            </table>
          </td></tr>
          <tr><td align="center" style="padding:24px 16px 0;">
            <p style="margin:0 0 8px;color:#646c58;font-family:Arial,'Segoe UI',Tahoma,Helvetica,sans-serif;font-size:15px;line-height:24px;">Đọc tiếp câu chuyện của bạn.</p>
            <p style="margin:0;color:#8b8d80;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:20px;">Email tự động từ Kệ truyện &nbsp;&#183;&nbsp; <a href="{{ .SiteURL }}" style="color:#727d65;text-decoration:underline;">Về kệ sách</a></p>
          </td></tr>
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td></tr>
    </table>
  </body>
</html>
`;
}
const emails = templates.map((entry) => {
  const t = Object.fromEntries(Object.entries(entry).map(([key, value]) => [key, typeof value === "string" ? value.normalize("NFC") : value]));
  return { ...t, html: renderEmail(t).normalize("NFC") };
});
fs.mkdirSync(directory, { recursive: true });
for (const t of emails) {
  // Keep authentication links as Supabase variables, with no fabricated
  // lifetime, fixed OTP length or app URL that might bypass verification.
  const variables = [...t.html.matchAll(/{{\s*\.(\w+)\s*}}/g)].map((m) => m[1]);
  if (variables.some((v) => !["SiteURL", "Email", "OldEmail", "NewEmail", "ConfirmationURL", "Token"].includes(v))) throw new Error("Unexpected template variable");
  if (variables.includes("OldEmail") && t.key !== "email_changed_notification") throw new Error("OldEmail is only supported in the email changed notification");
  if (variables.includes("NewEmail") && t.key !== "email_change") throw new Error("NewEmail is only supported in the change email confirmation");
  if (t.notification ? variables.includes("ConfirmationURL") || variables.includes("Token") : t.otp ? !variables.includes("Token") || variables.includes("ConfirmationURL") : !variables.includes("ConfirmationURL")) throw new Error("Invalid email action");
  fs.writeFileSync(path.join(directory, t.id + ".html"), t.html);
}
fs.writeFileSync(path.join(directory, "subjects.json"), JSON.stringify(Object.fromEntries(emails.map((t) => [t.name, { subject: t.subject, file: t.id + ".html", supabaseKey: t.key }])), null, 2) + "\n");
const data = JSON.stringify(emails).replace(/</g, "\\u003c");
fs.writeFileSync(path.join(directory, "preview.html"), `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Email Kệ truyện — Xem trước & sao chép</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#efeee8;color:#29372a;font-family:Arial,Helvetica,sans-serif}button{font:inherit;cursor:pointer}button:focus-visible{outline:3px solid #91ab7c;outline-offset:3px}.layout{max-width:1320px;margin:auto;padding:40px 32px;display:grid;grid-template-columns:268px minmax(0,1fr);gap:48px}aside{padding-top:8px}h1{font:600 34px/1.25 Arial,Helvetica,sans-serif;letter-spacing:normal;margin:0 0 12px}.intro{font-size:13px;line-height:1.8;color:#74796c}.eyebrow{font-size:10px;letter-spacing:2px;color:#77856c;margin:0 0 16px}.nav{display:grid;gap:8px;margin:30px 0}.nav button{border:1px solid transparent;background:transparent;text-align:left;padding:14px;border-radius:12px;color:#58614f}.nav button[aria-pressed=true]{background:#e0e6d8;border-color:#cbd4c0;color:#243e2c}.nav strong{display:block;font-size:14px;margin-bottom:5px}.nav small{font-size:11px;color:#7d8474}.note{padding:16px 0;border-top:1px solid #d5d8cb;font-size:12px;line-height:1.8;color:#7c8174}.toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:0 0 20px;flex-wrap:wrap}.toolbar h2{font:600 22px Arial,Helvetica,sans-serif;margin:0}.modes{display:flex;background:#e2e4da;padding:4px;border-radius:9px;gap:2px}.modes button{background:transparent;border:0;border-radius:6px;padding:8px 11px;color:#68735c;font-size:12px}.modes button[aria-pressed=true]{background:#fffdf8;color:#2d513e;box-shadow:0 1px 3px #28372815}.subject{padding:18px 20px;background:#fffdf8;border:1px solid #dbded1;border-radius:12px;margin-bottom:18px;display:flex;gap:14px;align-items:center;justify-content:space-between}.subject small{display:block;font-size:10px;letter-spacing:1px;color:#8a907e;margin-bottom:8px}.subject strong{font-size:14px;line-height:1.5}.copy{flex-shrink:0;padding:10px 13px;border:1px solid #cdd5c2;border-radius:8px;background:#f3f6ee;color:#36513b;font-size:12px}.stage{display:flex;justify-content:center;align-items:flex-start;background:#e6e8de;border:1px solid #d4d8cb;padding:18px;border-radius:16px}.frame{width:100%;max-width:680px;transition:max-width .15s}.frame.mobile{max-width:375px}iframe{display:block;width:100%;border:0;border-radius:10px;background:#f3f0e8}#code{width:100%;min-height:680px;background:#25352a;color:#e1ead8;border:0;border-radius:10px;padding:22px;font:12px/1.7 Consolas,monospace;resize:vertical}.codebar{display:flex;justify-content:flex-end;margin-bottom:12px}.hint{font-size:11px;color:#7c8471;line-height:1.8;margin:15px 0 0}#feedback{min-height:20px;font-size:12px;color:#36513b}[hidden]{display:none!important}@media(max-width:900px){.layout{grid-template-columns:1fr;padding:24px 16px;gap:14px}.nav{grid-template-columns:repeat(2,minmax(0,1fr));margin:20px 0}.note{display:none}.stage{padding:6px}.toolbar h2{font-size:21px}.subject{padding:14px;align-items:flex-start}.subject strong{font-size:13px}}@media(prefers-reduced-motion:reduce){.frame{transition:none}}
</style></head><body><div class="layout"><aside><p class="eyebrow">THƯ TỪ KỆ TRUYỆN</p><h1>Những lá thư,<br>cùng một chất riêng.</h1><p class="intro">${emails.length} mẫu email cho tài khoản.<br>Nền kem, sắc xanh và một chút bình yên.</p><nav class="nav" aria-label="Chọn mẫu email">${emails.map((t, i) => `<button type="button" data-template="${i}" aria-pressed="${i === 0}"><strong>${escape(t.label)}</strong><small>${escape(t.name)}</small></button>`).join("")}</nav><p class="note">Sao chép tiêu đề và HTML vào đúng mục trong Supabase → Authentication → Email. Mã và liên kết trong bản xem trước là dữ liệu minh họa.</p></aside>
<main><div class="toolbar"><h2 id="name"></h2><div class="modes" aria-label="Chế độ xem"><button type="button" data-mode="desktop" aria-pressed="true">Máy tính</button><button type="button" data-mode="mobile" aria-pressed="false">Điện thoại</button><button type="button" data-mode="code" aria-pressed="false">HTML</button></div></div><div class="subject"><div><small>TIÊU ĐỀ EMAIL</small><strong id="subject"></strong></div><button type="button" class="copy" id="copy-subject">Sao chép</button></div><div class="codebar"><button type="button" class="copy" id="copy-html">Sao chép HTML</button></div><div class="stage" id="stage"><div class="frame" id="frame"><iframe id="email" title="Xem trước email" sandbox="allow-same-origin"></iframe></div></div><textarea id="code" aria-label="Mã HTML để dán vào Supabase" readonly hidden></textarea><p id="feedback" role="status" aria-live="polite"></p><p class="hint">Bản xem trước trên trình duyệt. Hình thức thực tế có thể khác giữa Gmail, Outlook và Apple Mail. Không có email nào được gửi từ trang này.</p></main></div>
<script>
const templates=${data};
let selected=0,mode='desktop';
const $=id=>document.getElementById(id);
function render(){const t=templates[selected];$('name').textContent=t.label;$('subject').textContent=t.subject;$('code').value=t.html;$('feedback').textContent='';document.querySelectorAll('[data-template]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.template)===selected)));document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)));$('stage').hidden=mode==='code';$('code').hidden=mode!=='code';$('frame').classList.toggle('mobile',mode==='mobile');$('email').style.height='100px';$('email').srcdoc=t.html.replaceAll('{{ .ConfirmationURL }}','https://example.invalid/preview-only?type='+t.key+'&token=DEMO').replaceAll('{{ .SiteURL }}','https://www.hikarilong.io.vn').replaceAll('{{ .NewEmail }}','diachimoi@example.com').replaceAll('{{ .OldEmail }}','bandoc@example.com').replaceAll('{{ .Email }}',t.key==='email_changed_notification'?'diachimoi@example.com':'bandoc@example.com').replaceAll('{{ .Token }}','12345678');}
$('email').onload=()=>{const doc=$('email').contentDocument;if(!doc)return;doc.querySelectorAll('a').forEach(a=>a.addEventListener('click',e=>e.preventDefault()));$('email').style.height=doc.documentElement.scrollHeight+'px';};
async function copy(text){try{await navigator.clipboard.writeText(text);$('feedback').textContent='Đã sao chép. Bạn có thể dán vào Supabase.';}catch(_){if(text===templates[selected].subject){const range=document.createRange();range.selectNodeContents($('subject'));const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);$('feedback').textContent='Tiêu đề đã được chọn; nhấn Ctrl+C để sao chép.';}else{mode='code';render();$('code').focus();$('code').select();$('feedback').textContent='HTML đã được chọn; nhấn Ctrl+C để sao chép.';}}}
document.querySelectorAll('[data-template]').forEach(b=>b.onclick=()=>{selected=Number(b.dataset.template);render();});document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;render();});$('copy-html').onclick=()=>copy(templates[selected].html);$('copy-subject').onclick=()=>copy(templates[selected].subject);window.addEventListener('resize',()=>{if(mode!=='code')render();});render();
</script></body></html>
`);
fs.writeFileSync(path.join(directory, "README.md"), `# Email tài khoản Kệ truyện

Mở [preview.html](preview.html) trong trình duyệt để chọn mẫu, xem ở kích thước máy tính/điện thoại và sao chép tiêu đề cùng HTML. Chế độ xem trước thay biến bằng dữ liệu minh họa; nút sao chép giữ nguyên biến thật của Supabase. Trang này không gửi email.

Trong Supabase → Authentication → Email → Templates, mở đúng mục, dán Subject và toàn bộ nội dung file HTML vào Body/Source, rồi Save. Không dán preview.html vào Supabase. [Tài liệu Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates).

| Mục Supabase | Subject | Body HTML |
|---|---|---|
${emails.map((t) => `| ${t.name} | ${t.subject} | [${t.id}.html](${t.id}.html) |`).join("\n")}

## Các luồng xác thực

- Ứng dụng hiện dùng email + mật khẩu. Ưu tiên áp dụng Confirm sign up và Reset password. Các mẫu xác thực khác sẵn cho các luồng tương ứng khi bạn bật hoặc phát triển chúng; thay template không tự thêm tính năng đăng nhập/mời/đổi email vào app.
- Năm mẫu liên kết dùng nguyên biến \`{{ .ConfirmationURL }}\` cho nút và URL dự phòng. Không đổi thành SiteURL hoặc URL website thuần vì sẽ bỏ mất bước xác thực của Supabase.
- Magic link or OTP trong bộ này dùng phiên bản liên kết đăng nhập. Reauthentication dùng \`{{ .Token }}\` để nhập tại màn hình đang yêu cầu xác minh. Không cố định số chữ số hay thời hạn trong bản email thực; thời hạn do cấu hình Supabase quyết định.
- Change email address dùng \`{{ .NewEmail }}\`. Nếu bật Secure email change, có thể cần xác nhận ở cả hộp thư cũ và mới.
- Hai mẫu **Password changed** và **Email address changed** nằm trong mục Security notifications của Supabase. Sau khi dán mẫu, giữ công tắc gửi thông báo ở trạng thái bật. Mẫu chỉ thông báo thay đổi đã xảy ra; nút mở \`{{ .SiteURL }}\`, không dùng ConfirmationURL hoặc OTP.
- **Email address changed** dùng \`{{ .OldEmail }}\` cho email cũ và \`{{ .Email }}\` cho email mới; không dùng NewEmail ở mẫu thông báo này. **Password changed** dùng Email và không chứa mật khẩu.
- Header/footer dùng \`{{ .SiteURL }}\`; đặt Site URL thành website triển khai và cho phép callback \`https://www.hikarilong.io.vn/sync-auth.html\` trong Redirect URLs (và URL không www nếu bạn sử dụng origin đó).
- Trong Resend, tắt click tracking cho tên miền email Auth để giữ nguyên liên kết xác thực. [Lưu ý của Supabase về email tracking](https://supabase.com/docs/guides/auth/auth-email-templates#email-tracking).
- Kiểm tra email thật bằng tài khoản thử do bạn kiểm soát: nội dung, nút, URL dự phòng, thư mục spam và callback. Chưa gửi thử email thật hoặc cập nhật Dashboard trong tác vụ tạo bộ mẫu này.

## Thiết kế và tái tạo

HTML độc lập, bảng layout, style inline, font Arial/Segoe UI/Tahoma và văn bản chuẩn Unicode NFC, không tải ảnh/font ngoài. Media query thu gọn khoảng cách trên điện thoại; phần nội dung vẫn đọc được khi client bỏ CSS trong head. Không dùng mã JavaScript trong email. Các email ngắn dưới 12 KB mỗi mẫu.

Mã nguồn sinh bộ mẫu: \`scripts/build-auth-emails.js\`. Chạy \`node scripts/build-auth-emails.js\` để sinh lại toàn bộ file; sửa nội dung ở script để tránh mất chỉnh sửa khi sinh lại. Các file này không tự triển khai lên Supabase khi push Git.
`);
console.log(`Created ${emails.length} email templates, subjects and preview in supabase/email-templates`);
