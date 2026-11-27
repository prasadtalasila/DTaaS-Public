# Security of `./manager.sh admit p-2 cardiology`

The manager signs one request, the runner checks it, and the reply and
the notifications come back. The request is signed; the HTTP reply is
not. Sources: `tools/sign.mjs`, `src/auth/access.guard.ts`,
`src/auth/claims.ts`, `src/auth/roles.ts`, [SECURITY-MODEL.md](../../SECURITY-MODEL.md).

![Security of the admit request](manager-security.png)

```mermaid
sequenceDiagram
    autonumber
    participant M as manager.sh<br/>(manager-1, run/keys/manager-1.key)
    participant G as Runner access guard<br/>(hospital-1, port 5100)
    participant S as admit script<br/>(child process)
    participant B as MQTT broker / webhook
    participant W as Manager's subscriber

    Note over M: Body = admit command with patient p-2 and ward cardiology<br/>JWS header alg Ed25519 and kid manager-1<br/>claims: aud=hospital-1, htm=POST, htu=/,<br/>bh=SHA-256(body), iat, exp=iat+30 s, jti=random
    Note over M: sign with the Ed25519 private key
    M->>G: POST /  Authorization: Bearer JWS  +  body<br/>(plain HTTP, no TLS)

    rect rgb(235, 245, 255)
    Note over G: Request checks, in order
    Note over G: 1. kid names a principal in auth.principals,<br/>verify the signature with its public key
    Note over G: 2. aud = hospital-1, lifetime ≤ 60 s,<br/>iat/exp within 30 s skew
    Note over G: 3. htm, htu and bh match this request<br/>(a changed method, path or body is refused)
    Note over G: 4. jti not seen before (in-memory replay cache)
    Note over G: 5. role manager may call POST /,<br/>and admit is in manager.commands
    end
    G--xM: any failure: 401 (credential) or 403 (role), no script runs

    G->>S: run admit, input on stdin,<br/>env RUNNER_TOKEN (script token, role script)
    S-->>G: exit code, stdout, stderr
    G-->>M: 200 status success and result<br/>(not signed, integrity relies on the network)

    G->>B: notifications (state, properties), each a JWS signed with<br/>hospital-1.key (kid = hospital-1)
    B->>W: signed notification
    Note over W: verify with run/keys/hospital-1.pub<br/>marks verified, INVALID or UNSIGNED
```

## What each scheme protects

| Step | Scheme | Stops |
| :--- | :----- | :---- |
| Signature | Ed25519 JWS, key of `manager-1` | a caller who is not a listed principal |
| `aud` | token names `hospital-1` | a token sent to another DT |
| `htm`, `htu`, `bh` | token binds method, path and body hash | tampering with, or re-pointing, the request |
| `iat`, `exp`, `jti` | at most 60 s, once only | replay of a captured request |
| Role | `manager`; `admit` is listed in `manager.commands` | the manager steering the DT beyond its rights (`/fsm/transition` gives 403) |
| `RUNNER_TOKEN` | random token, role `script` | scripts calling the runner as anyone else |
| Signed output | `auth.key` of the DT | forged notifications, MQTT replies and wills |

## What it does not cover

- The HTTP reply to the manager is not signed, and the runner serves
  plain HTTP. Anyone on the path can read the request and reply, or alter
  the reply. Put the runner behind TLS or a trusted network.
- The signed request is readable, so the body and token are visible,
  but the token is useless after one use or 30 s.
- A compromised runner process, or its scripts running as the same
  account, can read the signing key; see SECURITY-MODEL.md.
