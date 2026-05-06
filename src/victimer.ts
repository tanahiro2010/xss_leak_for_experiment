import { Hono } from "hono";
import { cors } from "hono/cors";

const victimer = new Hono();

// CORSは意図的に緩く設定（検証環境）
victimer.use("/*", cors({ origin: "*" }));

// ユーザー種別をシミュレート（本来はセッションから判定）
// 環境変数 USER_TYPE=admin or user で切り替え
const USER_TYPE = process.env.USER_TYPE === "user" ? "user" : "admin";

/**
 * 内部fetchが飛ぶエンドポイント。
 * ログインユーザーの種別によってリダイレクト先パスが変わる想定。
 *
 *   admin → /internal/admin/dashboard
 *   user  → /internal/user/dashboard
 *
 * これが攻撃者から見えないはずのパス。
 */
victimer.get("/dashboard", async (c) => {
  const target =
    USER_TYPE === "admin"
      ? "/internal/admin/dashboard"
      : "/internal/user/dashboard";

  // サーバーサイドでの内部fetch（パスが辞書順で判定対象になる部分）
  // ここでは単純にリダイレクトで表現する
  return c.redirect(target, 302);
});

// 内部エンドポイント群（わずかな遅延を入れてタイミング差を強調）
victimer.get("/internal/:role/dashboard", async (c) => {
  const role = c.req.param("role");
  await new Promise((r) => setTimeout(r, 50)); // 50ms の処理遅延
  return c.json({ role, message: `Welcome, ${role}!` });
});

/**
 * connection pool 枯渇用の長時間待機エンドポイント。
 * 攻撃者がプールを埋めるために使う。
 */
victimer.get("/sleep/:ms", async (c) => {
  const ms = Number(c.req.param("ms"));
  await new Promise((r) => setTimeout(r, Math.min(ms, 10000)));
  return c.text("ok");
});

/**
 * 攻撃者が辞書順オラクルに使うエンドポイント。
 * パス /probe/:guess に対してすぐ 200 を返す。
 * （レスポンス速度の比較対象）
 */
victimer.get("/probe/*", (c) => c.text("ok"));

export { victimer };