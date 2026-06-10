# CGI Warsaw — Intern Fullstack Developer (Angular + Node.js) Interview Prep

**Role:** J0526-0284 · Student Internship · Warsaw  
**Interview:** ~30 minutes · Technical + brief HR  
**Topics confirmed:** AWS Lambda · Node.js · Angular · Architecture

---

## 1. Process Overview

Based on Glassdoor reports and CGI's own published guidance:

| Stage | Format | Duration |
|---|---|---|
| 1. HR/recruiter screen | Phone or Teams call — motivation, availability, English level | 15–20 min |
| 2. Technical interview | Live call — rate yourself on each tech (1–5), then questions from those ratings | 20–30 min |
| 3. Offer / feedback | Usually 1–2 weeks later; CGI sends a satisfaction survey regardless |

**CGI-specific signals from candidates:**
- All candidates are asked the **same core questions** (standardised process for fairness).
- Interviewers often open with: *"Rate yourself from 1 to 5 on Angular / Node.js / AWS"* — be honest, questions will come from where you said you're strong.
- The technical round is conversational, not a coding test. No live-coding whiteboard for intern roles.
- STAR method expected for any scenario questions ("Tell me about a time you…").
- Client is Canadian — English fluency is actively assessed throughout.

---

## 2. AWS Lambda (highest-signal topic — listed first in the job ad)

### Core concepts you must be able to explain

**Q: What is AWS Lambda and what problem does it solve?**  
Lambda is a serverless compute service — you upload a function, define a trigger, and AWS handles provisioning, scaling, and server management entirely. You pay only per invocation and execution duration (100 ms increments), not for idle time. It solves the overhead of managing servers for event-driven or intermittent workloads.

**Q: What triggers a Lambda function?**  
Any AWS event source: API Gateway (HTTP), S3 (file upload/delete), DynamoDB Streams, SQS/SNS messages, EventBridge schedules, Cognito, or direct SDK invocations. For this role the most relevant is API Gateway → Lambda (serverless REST API).

**Q: What is a cold start and why does it matter?**  
When no warm execution environment exists, Lambda must initialise the runtime and load your code before running. This adds latency — typically 100 ms–1 s depending on language and package size. Node.js has significantly lower cold start times than Java or .NET. Mitigations: keep bundle small, use Provisioned Concurrency for latency-sensitive paths, avoid heavy `require()` at module top level.

**Q: What are Lambda's hard limits?**  
| Limit | Value |
|---|---|
| Max execution timeout | 15 minutes (900 s) |
| Max memory | 10 240 MB |
| Deployment package (zipped) | 50 MB (250 MB unzipped) |
| Concurrent executions (default) | 1 000 per region (soft limit, can raise) |
| Response payload (sync) | 6 MB |

**Q: What is the difference between synchronous and asynchronous Lambda invocation?**  
- **Synchronous** (API Gateway, SDK `RequestResponse`): caller waits for the result; errors propagate back immediately.  
- **Asynchronous** (S3, SNS, EventBridge): Lambda queues the event; the caller gets an immediate 202. Lambda retries up to 2 times on failure. A Dead Letter Queue (DLQ) or Lambda Destinations can capture failed events.

**Q: How does Lambda scale?**  
Automatically — each concurrent invocation runs in its own isolated execution environment. There is no manual scaling. The account-level concurrency limit (default 1 000) is the ceiling; you can reserve concurrency per function to guarantee or cap it.

**Q: How would you connect Lambda to a database like PostgreSQL?**  
Use RDS Proxy as the connection pooler — Lambda functions can spin up hundreds of concurrent environments, each opening a DB connection, which exhausts Postgres's `max_connections`. RDS Proxy pools and multiplexes those connections. Alternatively, for simple use cases, use a connection inside the handler and rely on execution environment reuse (the function container stays warm for subsequent calls).

**Q: What is the Lambda execution environment lifecycle?**  
`Init` → `Invoke` → (container is frozen) → `Invoke` again (warm) → … → `Shutdown`. Code outside the handler runs once during Init and is reused across warm invocations — good place for DB connections or SDK clients.

**Q: Lambda vs EC2 vs ECS — when would you choose Lambda?**  
Lambda: short-lived, event-driven, variable traffic, < 15 min execution.  
EC2/ECS: long-running processes, persistent connections (WebSockets), CPU-intensive tasks, workloads needing fine-grained OS control.

---

## 3. Node.js

**Q: What is the event loop and why does it matter for Node.js?**  
Node runs on a single thread but delegates I/O (filesystem, network, timers) to `libuv`'s thread pool and OS async APIs. The event loop picks up completed callbacks from a queue. This makes Node excellent for I/O-bound work (REST APIs, Lambda handlers) but poor for CPU-intensive tasks (image processing, encryption at scale) — those block the thread.

**Q: What is the difference between `callback`, `Promise`, and `async/await`?**  
All three handle async operations. Callbacks are the legacy pattern (Node-style `(err, result)`). Promises chain `.then()/.catch()` and are composable. `async/await` is syntactic sugar over Promises — cleaner, try/catch works naturally. For a Lambda handler always return a Promise or use `async`.

**Q: What is middleware in Express.js?**  
A function with signature `(req, res, next)` that sits in the request pipeline. Middleware can read/modify req and res, end the cycle, or call `next()` to pass control forward. Examples: body parsers, authentication checks, CORS headers, error handlers.

**Q: What is the difference between `require()` and `import`?**  
`require()` is CommonJS (Node's historic module system, synchronous). `import` is ES Modules (static, can be tree-shaken by bundlers). For Lambda with Node 18+, either works; `import` requires `"type": "module"` in `package.json` or `.mjs` extension.

**Q: How do you handle errors in an async Express route?**  
Wrap in try/catch and call `next(error)`, or use a wrapper utility. Express 5 handles rejected Promises automatically; Express 4 requires explicit forwarding. A global error middleware `(err, req, res, next)` catches everything.

**Q: What is `process.env` and why is it relevant in Lambda?**  
Environment variables injected at runtime. In Lambda, you configure them in the function's configuration (or via Parameter Store / Secrets Manager for secrets). Never hardcode credentials — always read from `process.env.MY_SECRET`.

**Q: How do you structure a Node.js Lambda function for a REST API endpoint?**  
```
exports.handler = async (event) => {
  const { pathParameters, body } = event;
  // parse, validate, call service, return
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  };
};
```
API Gateway maps the HTTP method/path to this function and converts the response back to HTTP.

---

## 4. Angular

**Q: What is the difference between a Component and a Service in Angular?**  
A **Component** owns a view (template + styles) and handles UI logic. A **Service** is a class that holds business logic, data fetching, or shared state — injected via Angular's DI container. Services are typically singletons (one instance per injector scope).

**Q: What is Angular's Dependency Injection and how does it work?**  
Angular maintains an injector tree. When a class declares a dependency in its constructor (e.g., `constructor(private http: HttpClient)`), Angular resolves it from the nearest injector. `@Injectable({ providedIn: 'root' })` makes the service a singleton across the app.

**Q: What are Standalone Components (Angular 14+/17)?**  
Components declared without `NgModule` — they list their own `imports` array. Angular 17+ uses standalone by default. This is the modern pattern; eliminates the boilerplate of module registration.

**Q: What is the difference between `ngOnInit` and the constructor?**  
Constructor is for DI setup only — Angular hasn't set `@Input()` bindings yet. `ngOnInit` fires after Angular initialises the component and sets all inputs. Data fetching belongs in `ngOnInit`.

**Q: What is `async` pipe and why is it preferred over manual subscriptions?**  
`| async` in a template subscribes to an Observable/Promise, renders the value, and **auto-unsubscribes** on component destroy. Manual subscriptions require `ngOnDestroy` + `unsubscribe()` — forgetting causes memory leaks.

**Q: What is the difference between `Observable` and `Promise`?**  
A Promise resolves once. An Observable emits 0–N values over time and is cancellable. Angular's `HttpClient` returns Observables. Use `firstValueFrom()` to convert to a Promise when needed.

**Q: How does Angular routing work?**  
`RouterModule.forRoot(routes)` registers the route config. `<router-outlet>` is the placeholder where matched components render. `canActivate` guards run before navigation — `authGuard` is the common pattern to protect routes requiring login.

**Q: What is lazy loading a route module?**  
```typescript
{ path: 'account', loadComponent: () => import('./account/account.component') }
```
The bundle for that route is downloaded only when the user navigates there — reduces initial bundle size (important for Core Web Vitals).

**Q: How do you pass data between a parent and child component?**  
- Parent → Child: `@Input()` property binding `[data]="value"`.  
- Child → Parent: `@Output()` EventEmitter `(event)="handler($event)"`.

**Q: What is RxJS and give one practical example?**  
A library for reactive programming with Observables. Practical example: debouncing a search input so the API is called 300 ms after the user stops typing:
```typescript
this.searchControl.valueChanges.pipe(
  debounceTime(300),
  distinctUntilChanged(),
  switchMap(query => this.api.search(query))
).subscribe(results => this.results = results);
```

---

## 5. Architecture

**Q: What is the difference between monolithic and microservices architecture?**  
A **monolith** is one deployable unit — simpler to develop initially, harder to scale independently. **Microservices** split the system into small, independently deployable services each owning its own data. Benefits: independent scaling, isolated failure, polyglot tech. Cost: distributed system complexity (network calls, eventual consistency, observability).

**Q: What is serverless architecture and when would you use it?**  
Functions deployed as Lambda (or equivalent) + managed services for DB, storage, queues. No servers to manage, scales to zero. Best for: variable/unpredictable traffic, event-driven flows, rapid prototyping. Not ideal for: low-latency real-time (cold starts), long-running jobs, WebSocket-heavy apps.

**Q: What is REST and what makes an API RESTful?**  
REST (Representational State Transfer) is an architectural style. Key constraints: stateless (no session on server), resources identified by URIs, HTTP methods (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`) carry semantic meaning, responses are representations (JSON/XML). A RESTful API uses HTTP verbs correctly, returns proper status codes (201 Created, 400 Bad Request, 404 Not Found, etc.), and is stateless.

**Q: What is the difference between SQL and NoSQL databases?**  
SQL (relational): strict schema, ACID transactions, powerful joins. Best when data relationships matter (orders ↔ users ↔ products). NoSQL (document, key-value, graph): flexible schema, horizontal scalability, eventual consistency. Best for high-volume simple reads/writes, unstructured data, or caching (Redis).

**Q: What is API Gateway in the context of AWS?**  
A managed service that sits in front of your Lambda functions (or other backends) and handles: HTTP routing, authentication (Cognito/JWT), throttling, CORS, request/response transformation, and TLS termination. It's the "front door" for serverless REST APIs.

**Q: What is a CI/CD pipeline?**  
Continuous Integration: automated build + tests on every push. Continuous Deployment/Delivery: automatic deployment to staging or production when CI passes. Tools: GitHub Actions, GitLab CI, Jenkins. Key stages: install → build → test → deploy.

**Q: How do you secure a serverless REST API?**  
- JWT Bearer tokens validated by API Gateway (Cognito Authorizer or a Lambda Authorizer).
- HTTPS only (API Gateway enforces TLS).
- IAM roles per Lambda with least-privilege.
- Secrets via AWS Secrets Manager, not environment variable plaintext.
- Rate limiting via API Gateway usage plans.

---

## 6. Likely Rapid-Fire / Soft Questions (30-min format — expect 2–3 of these)

- "Walk me through a project you've built — tech stack, your role, what went wrong."
- "What's the difference between `==` and `===` in JavaScript?" (`===` checks type + value)
- "What is TypeScript and why would you use it over plain JavaScript?" (static typing, IDE support, catches bugs at compile time)
- "How do you approach debugging a failing API call in Angular?" (Network tab, check status code, check request payload, check CORS, check interceptors)
- "What does `async/await` do under the hood?" (syntactic sugar over Promises, returns a Promise, `await` suspends execution within the async function, doesn't block the thread)
- "How would you test an Angular component?" (Jasmine + Karma via `TestBed`, mock services with `jasmine.createSpyObj`)

---

## 7. Questions to Ask the Interviewer (prepare 2–3)

1. "What does the typical first month look like for an intern — is there a structured onboarding or are you immediately put on client projects?"
2. "Which AWS services does the team use most heavily beyond Lambda — API Gateway, DynamoDB, SQS?"
3. "Is the Angular project a new build or an existing codebase? Which version are you on?"
4. "How is code quality enforced — PR reviews, automated linting, test coverage gates?"

---

## 8. 30-Minute Pacing Guide

| Minute | Expected content |
|---|---|
| 0–5 | Intro, background, English-level check ("tell me about yourself") |
| 5–10 | Self-rating on each technology + first Angular question |
| 10–17 | Node.js + AWS Lambda core questions |
| 17–24 | Architecture question (REST, serverless, or microservices) |
| 24–28 | One behavioural / project question |
| 28–30 | Your questions + next steps |

---

## 9. Key Things to Remember About CGI

- Founded 1976, one of the largest IT consulting firms globally (90 000+ employees).
- Warsaw office serves international clients — Canadian client on this role.
- Culture: they call employees "Partners", emphasise ownership and long-term careers.
- They explicitly look for genuine enthusiasm and a growth mindset, not just technical perfection.
- STAR method for any "tell me about a time…" question.

---

*Sources: [CGI Glassdoor reviews](https://www.glassdoor.com/Interview/CGI-Interview-Questions-E8452.htm) · [CGI interview tips (official)](https://www.cgi.com/au/en-au/article/careers/how-ace-your-cgi-interview-tips-our-new-starters) · [InterviewQuery — CGI Software Engineer guide](https://www.interviewquery.com/interview-guides/cgi-software-engineer) · [InterviewBit — AWS Lambda questions](https://www.interviewbit.com/aws-lambda-interview-questions/) · [InterviewBit — Angular questions](https://www.interviewbit.com/angular-interview-questions/) · [GUVI — AWS Lambda 2026](https://www.guvi.in/blog/top-aws-lambda-interview-questions-and-answers/)*
