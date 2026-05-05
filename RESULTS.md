## パスベースへの応用可能性の検証

(3)の末尾で「パスベースのリダイレクトにも同様のロジックが適用できると考えられる」と述べた。この仮説を実際に検証するため、Bun + Hono で検証環境を構築し、ブラウザから計測を行った。

### 検証環境の設計

victim サーバー（localhost:3001）と attacker サーバー（localhost:3000）の2台構成で実装した。victim サーバーは `GET /dashboard` に対してユーザー種別に応じて `/internal/admin/dashboard` または `/internal/user/dashboard` にリダイレクトする。`GET /sleep/:ms` はプール枯渇用の長時間待機エンドポイントとして機能し、`GET /probe/*` は即座に200を返すタイミング計測用のプローブエンドポイントとして機能する。attacker サーバーはブラウザから実行する PoC ページを配信し、接続プールの枯渇・オラクルの実行・バイナリサーチの3ステップを UI として提供した。

### キャリブレーション結果

まず接続プールを埋めない状態でベースライン計測を行った。

```
/probe/aaaaa:               avg=3.3ms
/probe/zzzzz:               avg=3.1ms
/internal/admin/dashboard:  avg=3.1ms
/internal/user/dashboard:   avg=3.0ms
```

続いて接続プールを5本埋めた状態で同じパスを計測した。

```
/probe/aaaaa (pool満杯):               3.0ms
/probe/zzzzz (pool満杯):               1.7ms
/internal/admin/dashboard (pool満杯):  1.3ms
/internal/user/dashboard (pool満杯):   1.2ms
```

プールを枯渇させても各パスへのレスポンス時間にほぼ変化が見られない。ここで既に仮説の前提が崩れていることが示唆された。

### オラクル実行結果

```
試行1: admin probe=3.2ms  user probe=2.2ms
試行2: admin probe=2.2ms  user probe=5.0ms
試行3: admin probe=3.0ms  user probe=3.0ms
試行4: admin probe=3.1ms  user probe=3.2ms
試行5: admin probe=3.4ms  user probe=3.3ms

平均: admin=3.0ms  user=3.3ms
```

5回の試行を通じて admin と user の probe 時間に一貫した差は見られず、試行2のような逆転も発生した。差の平均は 0.3ms であり、これはノイズの範囲内と判断した。

### なぜパスベースでは機能しないか

サブドメイン版との本質的な違いは、接続プールの管理単位にある。

Chromium の接続プール枯渇攻撃において、リクエストの競合が起きるのは「新規ホストへの接続確立」というコストが同じ土俵に乗るからである。`admin.example.com` と `app.example.com` はそれぞれ DNS 解決から TCP 接続確立まで独立したコストを持つ。接続プールが1本しか空いていないとき、どちらのホストへの接続が先に処理されるかをホスト名の辞書順が決定するというのが原論文の観察である。

一方、パスが異なるだけの同一ホスト（例：`localhost:3001/internal/admin/dashboard` と `localhost:3001/internal/user/dashboard`）へのリクエストは、既存のコネクションを keep-alive で使い回す。「接続確立コスト」が競合する場面が発生しないため、辞書順によるキューイングの差も生まれない。今回の計測でプール満杯時にも遅延が発生しなかったのはこのためである。

### 結論

パスベースのリダイレクト先推測は、少なくとも HTTP/1.1 の接続プール枯渇を利用する XSS-Leak の手法では機能しない。仮説は棄却された。

なお、(3)で言及した自分のサービス（Googleログイン後に `/teacher` または `/student` へリダイレクト）についても、同一ホスト上のパスである限り同じ理由で本攻撃は適用できないと考えられる。この検証を行ったことで、攻撃が成立するための前提条件、すなわち「異なるホストへのリダイレクト」という制約を、実験を通じて理解できた。