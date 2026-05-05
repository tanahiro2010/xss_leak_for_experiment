# XS-Leak Path Oracle PoC

## 仮説

XSS-Leak（Cross-Site-Subdomain Leak）はサブドメインの辞書順タイミング差を利用するが、
**パスが異なるだけの同一ホストでも同様の効果が出るか？**

### 前提の違い

| | サブドメイン版 | パス版（本検証） |
|---|---|---|
| 競合単位 | ホスト名（DNS解決含む） | 同一ホスト内のURL |
| タイミング差の源泉 | DNS + TCP + HTTP | HTTPキューイングのみ |
| 差が出やすさ | 出やすい | 要検証 |

サブドメイン版では `admin.example.com` と `app.example.com` は別ホストなので
接続確立コストがタイミング差を増幅する。
パス版では同一ホストへのリクエストをChromiumがどう優先順位付けするかが鍵。

---

## 環境

- Bun + Hono
- Chromiumベースブラウザ必須（Firefoxは対象外）

## 起動

```bash
# 被害者サーバー（admin モード）
cd victim && bun install && bun run start:admin

# 被害者サーバー（user モード）で切り替えて比較
cd victim && USER_TYPE=user bun run start

# 攻撃者サーバー
cd attacker && bun install && bun run start
```

## アクセス

http://localhost:3000 をChromiumで開く。

## 手順

1. **キャリブレーション** — プールあり/なしでベースラインを取る
2. **オラクル実行** — `USER_TYPE=admin` と `USER_TYPE=user` を切り替えてタイミング差を比較
3. **バイナリサーチ** — 実際にパスを推測する

## エンドポイント一覧（victim :3001）

| パス | 説明 |
|---|---|
| `GET /dashboard` | USER_TYPE に応じて `/internal/{role}/dashboard` にリダイレクト |
| `GET /internal/:role/dashboard` | ロール別ページ（50ms遅延） |
| `GET /sleep/:ms` | プール枯渇用（最大10秒待機） |
| `GET /probe/*` | タイミング計測用プローブ（即返答） |

## 期待される観察結果

- **パスベースで差が出る場合**: 仮説が正しく、パスの辞書順もオラクルになり得る
- **差が出ない場合**: Chromiumの同一ホストへのキューイングは辞書順ではなく
  FIFO等の別戦略を取っている可能性がある

どちらに転んでも結果は興味深い。



# 結果
実験の結果は、以下のファイルに記します（ネタバレ防止のため、ここでは詳細を省略します）：
- [実験結果と考察](RESULTS.md)