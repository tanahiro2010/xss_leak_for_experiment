import { victimer } from "./victimer";
import { attacker } from "./attacker";

// 攻撃者サーバー（ポート3000）と被害者サーバー（ポート3001）を起動
Bun.serve({
  port: 3000,
  fetch: attacker.fetch,
});

Bun.serve({
  port: 3001,
  fetch: victimer.fetch,
});