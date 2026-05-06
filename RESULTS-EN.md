## Validating the Applicability to Path-Based Oracles

At the end of section (3), I noted that "the same logic could potentially apply to path-based redirects." To actually test this hypothesis, I built a test environment using Bun + Hono and ran measurements from the browser.

### Test Environment Design

The setup consists of two servers: a victim server (localhost:3001) and an attacker server (localhost:3000). The victim server responds to `GET /dashboard` by redirecting to either `/internal/admin/dashboard` or `/internal/user/dashboard` depending on user type. `GET /sleep/:ms` serves as a long-polling endpoint for pool exhaustion, and `GET /probe/*` is a timing probe that returns 200 immediately. The attacker server delivers the PoC page executed in the browser, providing a UI for the three steps: connection pool exhaustion, oracle execution, and binary search.

### Calibration Results

First, baseline measurements were taken without filling the connection pool.

```
/probe/aaaaa:               avg=3.3ms
/probe/zzzzz:               avg=3.1ms
/internal/admin/dashboard:  avg=3.1ms
/internal/user/dashboard:   avg=3.0ms
```

Then the same paths were measured with 5 connections filling the pool.

```
/probe/aaaaa (pool full):               3.0ms
/probe/zzzzz (pool full):               1.7ms
/internal/admin/dashboard (pool full):  1.3ms
/internal/user/dashboard (pool full):   1.2ms
```

Even with the pool exhausted, response times showed almost no change across paths. This already suggested the foundational assumption of the hypothesis was breaking down.

### Oracle Execution Results

```
Trial 1: admin probe=3.2ms  user probe=2.2ms
Trial 2: admin probe=2.2ms  user probe=5.0ms
Trial 3: admin probe=3.0ms  user probe=3.0ms
Trial 4: admin probe=3.1ms  user probe=3.2ms
Trial 5: admin probe=3.4ms  user probe=3.3ms

Average: admin=3.0ms  user=3.3ms
```

Across 5 trials, no consistent difference was observed between admin and user probe times, with reversals like trial 2 occurring. The average difference was 0.3ms, which was judged to be within noise.

### Why Path-Based Doesn't Work

The fundamental difference from the subdomain variant lies in how connection pools are managed.

In the subdomain-based connection pool exhaustion attack, request contention arises because "establishing a connection to a new host" is a cost that all requests compete for on equal footing. `admin.example.com` and `app.example.com` each carry independent costs from DNS resolution through TCP connection establishment. The original paper's observation is that when only one pool slot is available, the lexicographic ordering of hostnames determines which host's connection gets processed first.

By contrast, requests to the same host that differ only in path — e.g., `localhost:3001/internal/admin/dashboard` vs. `localhost:3001/internal/user/dashboard` — reuse existing connections via keep-alive. There is no "connection establishment cost" to compete over, so no queuing difference based on lexicographic ordering arises. This is why no delay was observed even with a full pool.

### Conclusion

Path-based redirect destination inference does not work, at least not via the XS-Leak technique that exploits HTTP/1.1 connection pool exhaustion. The hypothesis is rejected.

As for the service mentioned in section (3) — which redirects to `/teacher` or `/student` after Google login — the same reasoning applies: as long as both paths are on the same host, this attack cannot be applied. Running this experiment gave a concrete, hands-on understanding of the prerequisite for the attack to work: redirection across different hosts.

---

### Appendix
Actual log from the experiment run

```
=== Calibration Start ===
Measuring baseline without filling the pool...
  /probe/aaaaa: avg=3.1ms min=2.5ms max=5.6ms
  /probe/zzzzz: avg=2.8ms min=2.6ms max=3.0ms
  /internal/admin/dashboard: avg=2.9ms min=2.1ms max=3.3ms
  /internal/user/dashboard: avg=2.9ms min=2.5ms max=3.2ms

Measuring with pool filled...
  [pool] 5 connections acquired
  /probe/aaaaa (pool full): 2.9ms
  /probe/zzzzz (pool full): 1.7ms
  /internal/admin/dashboard (pool full): 1.2ms
  /internal/user/dashboard (pool full): 1.3ms
Calibration complete

=== Oracle Execution ===
Accessing VICTIM /dashboard to infer internal redirect destination
probe: /internal/admin/dashboard vs /internal/user/dashboard

Trial 1/5...
  [pool] 5 connections acquired
  [pool] 5 connections acquired
  admin probe: 3.4ms  user probe: 2.8ms
Trial 2/5...
  [pool] 5 connections acquired
  [pool] 5 connections acquired
  admin probe: 3.8ms  user probe: 4.1ms
Trial 3/5...
  [pool] 5 connections acquired
  [pool] 5 connections acquired
  admin probe: 3.8ms  user probe: 4.3ms
Trial 4/5...
  [pool] 5 connections acquired
  [pool] 5 connections acquired
  admin probe: 3.6ms  user probe: 3.8ms
Trial 5/5...
  [pool] 5 connections acquired
  [pool] 5 connections acquired
  admin probe: 4.0ms  user probe: 3.6ms

Average: admin=3.7ms  user=3.7ms
Difference too small (< 20ms). Lexicographic ordering effect likely absent for path-based variant.

=== Binary Search (Path Inference) ===
Target: infer ??? in /internal/{???}/dashboard

Measuring threshold...
Threshold: 4.6ms

Binary search start...
  [pool] 5 connections acquired
  probe /internal/m: 3.8ms (threshold=4.649999991059303)
  [pool] 5 connections acquired
  probe /internal/t: 1.9ms (threshold=4.649999991059303)
  [pool] 5 connections acquired
  probe /internal/w: 1.2ms (threshold=4.649999991059303)
  [pool] 5 connections acquired
  probe /internal/y: 1.8ms (threshold=4.649999991059303)
  [pool] 5 connections acquired
  probe /internal/z: 1.8ms (threshold=4.649999991059303)

Inferred result: /internal//dashboard
```
