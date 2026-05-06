# XS-Leak Path Oracle PoC

## Hypothesis

XS-Leak (Cross-Site-Subdomain Leak) exploits timing differences based on alphabetical ordering of subdomains. **Can the same effect be achieved with paths on the same host?**

### Key Differences

| | Subdomain variant | Path variant (this experiment) |
|---|---|---|
| Contention unit | Hostname (incl. DNS resolution) | URLs within the same host |
| Source of timing difference | DNS + TCP + HTTP | HTTP queuing only |
| Likelihood of observable difference | High | TBD |

In the subdomain variant, `admin.example.com` and `app.example.com` are separate hosts, so connection establishment costs amplify timing differences. In the path variant, the key question is how Chromium prioritizes requests to the same host.

---

## Environment

- Bun + Hono
- Chromium-based browser required (Firefox not supported)

## Setup

```bash
bun install
bun run dev
```

Two servers are started within a single file via `Bun.serve`. By default, the attacker server runs on `:3000` and the victim server on `:3001`.

## Access

Open http://localhost:3000 in Chromium.

## Steps

1. **Calibration** — Establish baselines with and without connection pool exhaustion
2. **Oracle execution** — Compare timing differences by switching between `USER_TYPE=admin` and `USER_TYPE=user`
3. **Binary search** — Attempt to infer the actual path

## Endpoints (victim :3001)

| Path | Description |
|---|---|
| `GET /dashboard` | Redirects to `/internal/{role}/dashboard` based on `USER_TYPE` |
| `GET /internal/:role/dashboard` | Role-specific page (50ms artificial delay) |
| `GET /sleep/:ms` | Pool exhaustion endpoint (up to 10s wait) |
| `GET /probe/*` | Timing probe — responds immediately |

## Expected Outcomes

- **If path-based differences are observed**: The hypothesis holds — alphabetical path ordering can serve as an oracle
- **If no differences are observed**: Chromium's same-host queuing likely follows FIFO or another strategy rather than lexicographic ordering

Either outcome is interesting.

# Results

Experiment results are documented in the following file (omitted here to avoid spoilers):

- [Results and Analysis](RESULTS-RN.md)

# References
- For Japanese: [ここから](README.md)
- On XS-Leak: [here](https://blog.babelo.xyz/posts/cross-site-subdomain-leak/)
