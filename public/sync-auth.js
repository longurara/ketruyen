(async function () {
  "use strict";
  const params = new URLSearchParams(location.hash.slice(1)), recovery = params.get("type") === "recovery";
  try {
    const client = window.supabase.createClient(window.ReaderSyncConfig.url, window.ReaderSyncConfig.key,
      { auth: { storageKey: "ketruyen-auth-v1", flowType: "implicit", persistSession: true, detectSessionInUrl: true } });
    const { data, error } = await client.auth.getSession();
    if (error || !data.session) throw error || new Error("Liên kết chưa hợp lệ hoặc đã hết hạn.");
    if (recovery) sessionStorage.setItem("ketruyen-password-recovery", "1");
    history.replaceState(null, "", location.pathname);
    location.replace("/?auth_complete=1");
  } catch (_) {
    history.replaceState(null, "", location.pathname);
    document.getElementById("auth-status").textContent = "Liên kết chưa hợp lệ hoặc đã hết hạn. Về kệ truyện để yêu cầu lại.";
  }
})();
