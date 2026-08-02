# AWS Learning Migration — Parallel Sandbox for Aromaterie

## Context

Stan wants to learn AWS tooling hands-on by standing up a **parallel** deployment of this
e-commerce app on AWS, using **AWS CDK (TypeScript)** as the IaC tool. Production stays
exactly where it is (Railway + Vercel + Supabase) — nothing here touches `main`'s live
infra, DNS, or Stripe live keys. This is a sandbox to learn real AWS services end-to-end,
not a cutover.

Current architecture (confirmed via codebase inventory):
- **Backend**: NestJS 10, containerizes already (`backend/Dockerfile` exists, multi-stage,
  but pinned to `node:20-alpine` while the repo standard is `22.20.0` — first fix).
  Stateful pieces: BullMQ email queue+worker on Redis, 11 `@Cron` jobs plus a separate
  `@Interval(30_000)` outbox processor — all already Redis-NX-lock-guarded, meaning the
  codebase already assumes safe multi-replica execution — AdminJS with Postgres-backed
  `express-session` (also already horizontal-scale-safe, no sticky sessions needed).
- **Frontend**: Angular 18 SSR, Express server (`frontend/src/server.ts`), currently split
  by Vercel into CDN-served prerendered static routes (`/`, `/legal/*`) + a serverless
  function (`api/ssr.mjs`) for everything else. This request/response shape maps cleanly
  onto Lambda.
- **Data**: Postgres via Supabase (pooled `DATABASE_URL` + direct `DIRECT_URL`), 32 Prisma
  models, GDPR-sensitive PII (addresses, IBANs — AES-256-GCM encrypted, retention crons).
- **Storage**: Supabase Storage, 3 buckets (`product-images` public, `shipping-labels` +
  `invoices` signed-URL-only).
- **Queue/cache**: Redis (BullMQ, cron locks, OAuth nonce store).
- **Webhook**: Stripe requires the exact raw request body for signature verification
  (`main.ts` custom body-parser `verify` hook) — any AWS ingress must preserve it untouched.
- Stan mentioned Lambda/API Gateway/Cognito/DynamoDB are used at his job — this plan uses
  each of those where it's a *genuine* fit for a piece of this app, not force-fit everywhere.

**Guiding decisions from Stan:**
1. Scope: parallel learning sandbox, not a cutover.
2. IaC: AWS CDK, TypeScript.
3. Backend compute: undecided, mentioned Lambda/API Gateway/Cognito/DynamoDB from work.

**Recommendation on #3, confirmed by a 5-agent stochastic-consensus review**: run the
**backend on ECS Fargate**, not Lambda — it already has 11 in-process cron jobs and a
long-lived BullMQ worker, both awkward on Lambda without a bigger rewrite (would mean
ripping `@nestjs/schedule` out for EventBridge and BullMQ out for SQS). The **frontend
SSR**, by contrast, is a stateless request/response Express app already split into
CDN-static + function-per-request by Vercel — that's a *natural* Lambda + API Gateway fit,
so that's where this plan puts Lambda to use the way Stan already knows it from work.
Cognito and DynamoDB don't map onto anything that needs replacing here (auth is a working
custom JWT system; the data model is relational), so they're scoped as **isolated stretch
exercises** in Phase 11 — real hands-on practice without risking the working parts.

**Changed after the consensus review**: the backend runs as **one combined ECS service**
(not split into `api`/`worker`) — 3 of 5 reviewers independently pushed back on the
original two-service plan: the codebase's existing Redis-lock pattern already makes
cron/worker logic safe on a shared task, no autoscaling policy was ever planned to exercise
the "independent scaling" benefit, and doubling task defs/log groups/IAM roles for a
near-zero-traffic sandbox teaches CDK repetition, not a new concept. The two-service split
is still worth learning — it's now an explicit Phase 11 stretch exercise instead of being
on the critical path. Several other consensus findings below are folded into the relevant
phases (Phase 0, 1, 2, 3, 5, 8, 10).

---

## Repo changes

New top-level pnpm workspace member: **`infra/`** (add to `pnpm-workspace.yaml` alongside
`packages/*`, `backend`, `frontend`, `e2e`). Contains one CDK TypeScript app with several
small, independently deployable stacks (not one monolith — matches CDK best practice and
gives cleaner learning checkpoints):

```
infra/
  bin/aws-sandbox.ts
  lib/network-stack.ts        # VPC, subnets, SGs, VPC endpoints
  lib/data-stack.ts           # RDS Postgres, Secrets Manager, ElastiCache Redis
  lib/storage-stack.ts        # S3 buckets, CloudFront
  lib/backend-stack.ts        # ECR, ECS Fargate service + task defs, ALB
  lib/cron-stack.ts           # EventBridge Scheduler + Lambda (reconcile job)
  lib/frontend-stack.ts       # S3 (static) + CloudFront + Lambda (SSR) + API Gateway
  lib/cicd-stack.ts           # GitHub OIDC IAM role for Actions deploy
  lib/observability-stack.ts  # CloudWatch dashboards, alarms, budget alarm
```

Also touches, incrementally, as each phase needs it:
- `backend/Dockerfile` — bump `node:20-alpine` → `node:22.20.0-alpine` (fixes an existing
  drift from the repo's pinned Node version, independent bug worth fixing regardless).
- `backend/src/modules/storage/` — introduce a `StorageProvider` interface with the
  existing Supabase implementation and a new `S3StorageService`, selected by config, so
  prod (Supabase) and the AWS sandbox (S3) can both run from the same codebase without
  deleting the working Supabase path.
- `frontend/src/server.ts` — no logic changes needed; reused as-is inside both the ECS-less
  Lambda packaging (via AWS Lambda Web Adapter) for the frontend.
- New `.github/workflows/deploy-aws-sandbox.yml` — separate from the existing
  Railway/Vercel-triggering CI, manually triggered (`workflow_dispatch`) so it never
  interferes with the real deploy pipeline.

---

## Phases

### Phase 0 — Account guardrails (no infra cost)
- Enable IAM Identity Center (SSO) for your own login instead of long-lived IAM user
  access keys — this is current AWS best practice and worth building the right habit from
  day one.
- Root account: enable MFA, stop using root for anything after this.
- Create an AWS Budget with a low threshold (e.g. $15/$25) **and a Budget Action that
  auto-stops compute past a hard ceiling**, not just an email alarm — an alarm is reactive
  (fires after the spend already happened) and is the only backstop on a solo personal AWS
  account with no other guardrail.
- `cdk bootstrap` the target account/region, with an explicit env/qualifier so it can't
  collide with anything else in the account later.
- **Checkpoint:** understand IAM Identity Center permission sets vs. classic IAM users.

### Phase 1 — Networking (`network-stack.ts`)
- VPC with public + private subnets across 2 AZs.
- Use **VPC Gateway Endpoint for S3** (free) and **Interface Endpoints for Secrets Manager
  and both ECR endpoints — `ecr.api` AND `ecr.dkr`** (missing `ecr.dkr` is a common cause of
  silent image-pull timeouts that look like a networking bug) — instead of a NAT Gateway.
  Note this isn't automatically free: Interface Endpoints bill per-AZ per-hour
  (~$7-14/mo each across 2 AZs), so it's a real cost/learning trade-off against the NAT
  Gateway's ~$32/mo, not a strictly-cheaper default.
- Security groups: ALB (public 443), ECS tasks (from ALB only), RDS (from ECS SG only),
  ElastiCache (from ECS SG only).
- **Checkpoint:** understand why RDS/ElastiCache should never be in a public subnet.

### Phase 2 — Data layer (`data-stack.ts`)
- RDS PostgreSQL (smallest burstable class, e.g. `db.t4g.micro`), private subnet, with
  `RemovalPolicy.DESTROY` and `deletionProtection: false` set explicitly — CDK's default
  can retain the instance/snapshot on `cdk destroy`, which is the single most common
  "why is my bill still $40" surprise. One connection string is enough here (no
  pgbouncer-equivalent needed — RDS with a single combined ECS task doesn't have Supabase's
  pooling constraint that motivated the `DATABASE_URL`/`DIRECT_URL` split in prod).
- Secrets Manager secret for the DB credentials, auto-generated + rotatable.
- **Every secret this sandbox uses must be freshly generated here, never copied from
  prod** — this was the single most-repeated finding across the consensus review. Generate
  a distinct sandbox-only AES-256-GCM key for the IBAN field encryption, distinct Stripe
  *test-mode* keys, and distinct JWT secrets. Reusing prod's encryption key would mean a
  sandbox compromise could decrypt real ciphertext even with zero real PII physically
  present. Add a startup guard to the seed/migrate script that asserts the target host is
  NOT the Supabase project ref, so a copy-pasted `DATABASE_URL` fails loudly instead of
  quietly running against prod.
- Schema migration: run `prisma migrate deploy` against the new RDS instance — **schema
  only**. Do **not** copy production customer data (PII, addresses, encrypted IBANs) into
  the sandbox — this repo has GDPR retention crons and encryption specifically because that
  data is sensitive; seed the sandbox with the existing `pnpm prisma:seed` /
  `backend/prisma/seed-images.ts` fake catalog data instead. This rule applies even to
  encrypted/redacted exports — never load anything derived from a production DB dump.
- **Checkpoint:** understand Secrets Manager rotation vs. plain env vars.

### Phase 3 — Object storage (`storage-stack.ts`)
- 3 S3 buckets mirroring Supabase: `product-images` (public read via CloudFront OAC),
  `shipping-labels` + `invoices` (private, signed URLs only via `GetObject` presigning —
  same shape as today's Supabase `createSignedUrl`).
- CloudFront distribution in front of `product-images`.
- Implement `S3StorageService` behind the new `StorageProvider` interface
  (`backend/src/modules/storage/`), config-switched — don't touch the existing
  `storage.service.ts` Supabase path prod depends on. This refactor ships to code prod
  depends on, so the config switch must **fail closed**: throw on an unrecognized or
  missing `STORAGE_PROVIDER` value rather than silently falling through to S3, and default
  explicitly to `'supabase'`. Cover both paths with a unit test before merging to `develop`.
- Migrate existing product images: `aws s3 sync` from a Supabase Storage export (or a small
  script iterating `ProductImage` rows) into the new bucket — sandbox-only data, doesn't
  need to be exhaustive.
- **Checkpoint:** understand Origin Access Control vs. a fully public bucket policy.

### Phase 4 — Cache/queue (`data-stack.ts`, extended)
- ElastiCache for Redis (`cache.t4g.micro`), private subnet, reused for BullMQ + cron
  distributed locks + OAuth nonce store — same Redis usage patterns as today, just a
  different endpoint.
- **Checkpoint:** none new — this is the "boring but necessary" step.

### Phase 5 — Backend on ECS Fargate (`backend-stack.ts`)
- Fix `backend/Dockerfile` Node version mismatch first.
- ECR repo, push the existing Dockerfile image (CI already builds it in principle — reuse,
  don't reinvent).
- **One combined ECS Fargate service** (changed from the original two-service api/worker
  split after the consensus review — see the note under Context) running the HTTP server,
  the BullMQ processor, and all 11 in-process `@Cron` jobs plus the outbox `@Interval`
  processor in the same task, behind an ALB (health check → existing `/health` endpoint,
  which already checks Postgres + Redis + queue depth — reuse as-is). The existing
  Redis-NX-lock pattern already makes this safe if the task ever runs >1 replica.
- **ALB TLS fix**: ACM cannot issue a certificate for `*.elb.amazonaws.com`, so
  `https://<alb-dns>/health` as originally written will not work. Put CloudFront in front
  of the ALB (free `*.cloudfront.net` cert, and consistent with Phase 7's frontend
  approach) — or explicitly test over plain HTTP for this sandbox and say so, don't leave
  it ambiguous.
- **Hard rule: never register this sandbox's URL as a real Stripe webhook endpoint, not
  even in test mode.** ALB/CloudFront/API Gateway can each re-encode or mangle the request
  body before it reaches Nest's `verify` hook that populates `req.rawBody`
  (`main.ts`), silently breaking signature verification in a way that looks like a config
  bug. There's no need to receive live webhooks in a learning sandbox anyway — replay a
  captured payload locally instead if you want to exercise that code path.
- Task role: least-privilege — Secrets Manager read (DB/Redis creds), S3 read/write scoped
  to the 3 buckets, nothing else.
- Because ECS tasks don't sleep like Railway's hobby tier, the existing
  `PAYMENTS_RECONCILE_SECRET` external-pinger workaround becomes unnecessary here — but see
  Phase 6, which deliberately pulls just the reconcile job out anyway as a Lambda exercise.
- **Checkpoint:** understand task role vs. execution role, and why a combined task is the
  right call here even though splitting api/worker is the "more realistic" production
  pattern (see Phase 11 for that exercise).

### Phase 6 — Cron via Lambda (`cron-stack.ts`)
- Deliberately **don't** move all 11 crons here — most depend directly on Nest's DI
  container and are simplest left running in-process inside the combined ECS service.
- Do move the payments-reconcile job specifically: EventBridge Scheduler (every 10 min) →
  small Lambda that calls the existing `POST /payments/reconcile` endpoint with the
  `PAYMENTS_RECONCILE_SECRET` bearer token — this is a clean, low-risk, already-decoupled
  HTTP endpoint, good isolated first Lambda.
- **Checkpoint:** EventBridge Scheduler vs. EventBridge Rules (cron), and Lambda
  invoke-and-forget vs. request/response.

### Phase 7 — Frontend SSR via Lambda + API Gateway (`frontend-stack.ts`)
- Static/prerendered routes (`/`, `/legal/*`) → S3 + CloudFront, same content
  `prerender-routes.txt` already produces.
- Dynamic SSR routes → package `frontend/src/server.ts`'s Express app with **AWS Lambda Web
  Adapter** (no code changes needed — it adapts an existing Express app to Lambda's
  invoke model) behind an **API Gateway HTTP API**. This is the same architectural shape as
  today's `api/ssr.mjs` Vercel function, just on AWS's equivalent primitives — the most
  direct, low-risk way to learn Lambda + API Gateway on code that's already
  request/response-shaped.
- CloudFront in front of both: static origin (S3) + dynamic origin (API Gateway), mirroring
  Vercel's own static-vs-function routing split.
- Carry over the existing `ssrSecurityHeaders`/CSP middleware unchanged.
- **Checkpoint:** understand Lambda Web Adapter vs. rewriting the app for Lambda handlers
  natively — and why frontend suits this pattern while the backend doesn't.

### Phase 8 — CI/CD (`cicd-stack.ts`, `.github/workflows/deploy-aws-sandbox.yml`)
- IAM role trusted via GitHub OIDC (no long-lived AWS keys in GitHub secrets), scoped to
  the specific stacks/resource ARNs it deploys — not an `AdministratorAccess`-equivalent
  role, which would turn "learning sandbox" into "blast radius = whole AWS account."
- New, manually-triggered (`workflow_dispatch`) workflow: build+push backend image to ECR,
  build frontend, `cdk deploy` the relevant stacks. Fully separate from the existing
  `ci.yml`/Railway/Vercel auto-deploy — never runs on a normal push.
- **Checkpoint:** understand OIDC federation vs. static access keys in CI.

### Phase 9 — Observability (`observability-stack.ts`)
- CloudWatch Logs for ECS tasks + Lambda, a basic dashboard (ALB latency/5xx, ECS CPU/mem,
  Lambda errors/duration, RDS connections).
- CloudWatch Alarms → SNS → email for the essentials (ALB 5xx rate, ECS task failures).
- Sentry needs no infra changes — already DSN-based/hosting-agnostic (confirmed in both
  `backend/src/instrument.ts` and `frontend/src/main.ts`); reuse the same DSN or a
  separate Sentry project for the sandbox, your choice.
- **Checkpoint:** CloudWatch alarms vs. what Sentry already gives you — where's the overlap.

### Phase 10 — Cost control & teardown runbook
- Document (in `infra/README.md`) exactly what to `cdk destroy` between learning sessions
  vs. what's cheap to leave running. The standing-cost list, by size: **ALB (~$16-20/mo
  fixed, even idle)**, RDS, ElastiCache, Interface VPC Endpoints (~$7-14/mo each), and
  **Secrets Manager (~$0.40/secret/mo — 6-10 secrets ≈ $3-4/mo, and this does NOT shrink
  when the stack is destroyed unless the secrets themselves are explicitly deleted**, not
  just the CDK stack that created them).
- If OAuth is ever exercised against the sandbox: note that ALB/CloudFront DNS names churn
  on every `cdk destroy` + redeploy cycle, which breaks Google's whitelisted redirect URI
  until it's manually updated in Google Cloud Console — either scope OAuth testing out of
  the sandbox entirely, or accept this as a manual step in the teardown/rebuild cycle.
- Prefer Fargate Spot for the ECS service (fine for a non-production sandbox).
- **Checkpoint:** the actual dollar cost of each always-on piece, so future architecture
  decisions are cost-informed, not guessed.

### Phase 11 — Optional stretch exercises (explicitly isolated, not on the critical path)
- **Cognito**: stand up a User Pool + Google IdP federation as a throwaway side exercise
  (a tiny separate test page, not swapped into the real login flow) — learn user
  pools/app clients/hosted UI/JWT claims without touching the working custom
  JWT+bcrypt+refresh-token system or risking existing users' password hashes.
- **DynamoDB**: reimplement one genuinely NoSQL-shaped piece as new, net-new
  functionality — the OAuth nonce store or a "recently viewed products" feature are good
  candidates (single-table design, TTL attribute, one GSI) — without touching the 32-model
  relational Prisma schema.
- **API Gateway + Lambda authorizer**: front 1-2 read-only backend endpoints with API
  Gateway using a Lambda authorizer that validates the existing JWT — an isolated
  experiment, not a replacement for the ALB-fronted ECS API from Phase 5.
- **api/worker service split**: the original Phase 5 design — break the combined ECS task
  into separate `api` and `worker` services from the same image. Worth doing specifically
  to learn independent ECS scaling and per-role IAM scoping (a real production pattern),
  but do it as a deliberate exercise with an actual autoscaling policy attached — otherwise
  it's just duplicated CDK constructs with nothing to observe. If you do this, add a
  worker-liveness signal (e.g. a last-cron-run timestamp surfaced to CloudWatch) — a
  crashed worker task would otherwise fail silently while the `api` service's `/health`
  keeps reporting green.

---

## Stochastic-consensus review outcome

Reviewed by 5 independent agents (Domain Expert, Skeptic, Pragmatist, First-Principles,
Risk Analyst) against the original 5 open questions. Result, folded into the phases above:

1. **ECS Fargate + Lambda split — confirmed as-is**, unanimous. Matches workload shape
   (stateful crons/queue vs. stateless SSR), not chosen for variety's sake. Known
   trade-off worth expecting: Lambda cold starts for SSR will be slower than Vercel's warm
   functions on first request.
2. **api/worker split — reversed.** Majority (3/5) argued against splitting on the critical
   path: the codebase's existing Redis-lock pattern already makes a combined task safe, no
   autoscaling was planned to exercise the split's actual benefit, and it doubles CDK
   surface for a near-zero-traffic sandbox. Now a single combined service in Phase 5; the
   split moved to Phase 11 as a labeled stretch exercise.
3. **No Route 53/domain — confirmed**, plus a bug caught by review: ACM can't cert
   `*.elb.amazonaws.com`, so the plan's own `https://<alb-dns>/health` verification step
   wouldn't have worked as originally written. Fixed in Phase 5 (CloudFront in front of the
   ALB, or explicit HTTP for the sandbox).
4. **Schema-only + fake seed data — confirmed**, and hardened: all 5 reviewers
   independently flagged the same gap — the plan never required a sandbox-only encryption
   key/secrets, only "no PII." Fixed in Phase 2 (fresh secrets, never copied from prod,
   plus a host-assertion guard in the seed/migrate script).
5. **Cognito/DynamoDB as Phase-11-only stretch — confirmed.** Swapping a working custom JWT
   system for Cognito mid-migration is scope creep with no functional upside; isolated
   exercises deliver the same hands-on reps without the risk.

**New findings from the review, now folded into the plan**: Stripe webhook must never
target the sandbox (raw-body mangling risk via ALB/CloudFront/API Gateway) — Phase 5;
`StorageProvider` config switch must fail closed since it ships to prod code — Phase 3;
explicit RDS `RemovalPolicy.DESTROY` to avoid a silent-retain cost trap — Phase 2; missing
`ecr.dkr` VPC endpoint and non-trivial Interface Endpoint cost — Phase 1; GitHub OIDC role
scoping — Phase 8; full standing-cost list (ALB/RDS/ElastiCache/endpoints/Secrets Manager)
plus a Budget *action* instead of just an alarm, and OAuth redirect-URI churn on
teardown/rebuild — Phase 0 and Phase 10.

## Verification (per phase, not just at the end)

Each phase should end with something concretely checkable, not just "resources exist":
- Phase 1: `aws ec2 describe-vpcs` shows the VPC; a `ping`/`curl` from a bastion or SSM
  Session Manager into the private subnet confirms routing.
- Phase 2: `psql` (via SSM port-forward, not a public endpoint) connects and
  `prisma migrate status` shows the schema applied.
- Phase 3: an uploaded test image is reachable via the CloudFront URL; a signed
  invoice/label URL expires correctly.
- Phase 5: `curl` the health endpoint through whichever TLS path Phase 5 settles on
  (CloudFront-fronted ALB, or plain HTTP for the sandbox) returns 200 with `db`/`redis`
  both healthy.
- Phase 6: manually trigger the EventBridge schedule once, confirm a
  `ProcessedStripeEvent`-adjacent log line / CloudWatch log shows the reconcile ran.
- Phase 7: load the CloudFront URL, confirm static routes serve from S3 (check
  `X-Cache: Hit from cloudfront`) and a dynamic route (e.g. `/products/<slug>`) renders via
  the Lambda/API Gateway path.
- Phase 8: push a manual `workflow_dispatch` run, confirm it deploys without touching
  `main`'s Railway/Vercel pipeline.
