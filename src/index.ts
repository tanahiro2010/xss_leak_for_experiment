import { Hono } from "hono";
import { cors } from "hono/cors";
import attackApp from "./attack";

const app = new Hono();

// CORSは意図的に緩く設定（検証環境）
app.use("/*", cors({ origin: "*" }));

// ユーザー種別をシミュレート（本来はセッションから判定）
// 環境変数 USER_TYPE=admin or user で切り替え
const USER_TYPE = process.env.USER_TYPE ?? "admin";

/**
 * 内部fetchが飛ぶエンドポイント。
 * ログインユーザーの種別によってリダイレクト先パスが変わる想定。
 *
 *   admin → /internal/admin/dashboard
 *   user  → /internal/user/dashboard
 *
 * これが攻撃者から見えないはずのパス。
 */
app.get("/dashboard", async (c) => {
  const target =
    USER_TYPE === "admin"
      ? "/internal/admin/dashboard"
      : "/internal/user/dashboard";

  // サーバーサイドでの内部fetch（パスが辞書順で判定対象になる部分）
  // ここでは単純にリダイレクトで表現する
  return c.redirect(target, 302);
});

// 内部エンドポイント群（わずかな遅延を入れてタイミング差を強調）
app.get("/internal/:role/dashboard", async (c) => {
  const role = c.req.param("role");
  await new Promise((r) => setTimeout(r, 50)); // 50ms の処理遅延
  return c.json({ role, message: `Welcome, ${role}!` });
});

/**
 * connection pool 枯渇用の長時間待機エンドポイント。
 * 攻撃者がプールを埋めるために使う。
 */
app.get("/sleep/:ms", async (c) => {
  const ms = Number(c.req.param("ms"));
  await new Promise((r) => setTimeout(r, Math.min(ms, 10000)));
  return c.text("ok");
});

/**
 * 攻撃者が辞書順オラクルに使うエンドポイント。
 * パス /probe/:guess に対してすぐ 200 を返す。
 * （レスポンス速度の比較対象）
 */
app.get("/probe/*", (c) => c.text("ok"));

Bun.serve({
  port: 3000,
  fetch: app.fetch,
  development: true,
});
Bun.serve({
  port: 3001,
  fetch: attackApp.fetch,
  development: true,
});