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

---

## 10. Comprehensive Bilingual Q&A Bank

**Self-rating summary:**

| Technology | Rating | Reasoning |
|---|---|---|
| Angular | 4 / 5 | Real production app — standalone components, interceptors, guards, RxJS, SSR, lazy loading |
| Node.js | 3 / 5 | Via NestJS (Express under the hood); strong async/await, weaker on raw Node internals |
| AWS Lambda | 2 / 5 | Conceptual understanding, no hands-on production experience |
| Architecture | 3 / 5 | Built a real NestJS monolith with REST, webhooks, queues, PostgreSQL, Redis, deployment |

**Format:** Each entry shows the question and answer in English, then in Polish.

---

### Angular — Rating 4/5

---

**A1**

**Q (EN):** What is the difference between Default and OnPush change detection strategies, and when would you choose OnPush?

**Q (PL):** Jaka jest różnica między strategiami wykrywania zmian Default i OnPush i kiedy powinieneś wybrać OnPush?

**A (EN):** Default CD runs a top-down check on the entire component tree after every async event (click, timer, XHR response), regardless of which component actually changed data. OnPush limits checks to three cases only: an `@Input` reference changes, an event originates inside the component's own template, or `ChangeDetectorRef.markForCheck()` / `AsyncPipe` triggers it explicitly. You should default to OnPush for all "dumb" / presentational components with immutable inputs — it dramatically reduces the number of checks at scale. The trade-off is that you must pass new object/array references instead of mutating in place, otherwise Angular never re-checks and the view goes stale. Pair it with `async` pipe or Signals so subscriptions automatically call `markForCheck()` for you.

**A (PL):** Strategia Default sprawdza całe drzewo komponentów od góry po każdym zdarzeniu asynchronicznym (kliknięcie, timer, odpowiedź HTTP), niezależnie od tego, który komponent faktycznie zmienił dane. OnPush ogranicza sprawdzanie do trzech przypadków: zmiana referencji `@Input`, zdarzenie pochodzące z własnego szablonu komponentu lub jawne wywołanie `ChangeDetectorRef.markForCheck()` / `AsyncPipe`. Powinieneś domyślnie stosować OnPush dla wszystkich komponentów prezentacyjnych z niezmiennymi inputami — drastycznie redukuje liczbę sprawdzeń przy skali. Kompromis: musisz przekazywać nowe referencje obiektów/tablic zamiast mutować je w miejscu, inaczej Angular nie wykryje zmiany. Łącz z `async` pipe lub Signals, żeby subskrypcje automatycznie wywoływały `markForCheck()`.

---

**A2**

**Q (EN):** A component using OnPush isn't reflecting data updates from a service subscription. What are the likely causes and how do you fix them?

**Q (PL):** Komponent używający OnPush nie odzwierciedla aktualizacji danych z subskrypcji serwisu. Jakie są prawdopodobne przyczyny i jak je naprawić?

**A (EN):** The two most common causes are (1) mutating an object in place (e.g., `this.items.push(x)`) instead of replacing the reference, and (2) subscribing manually with `.subscribe()` inside the component — Angular's CD runs outside the component's check cycle, so the template never sees the new value. Fix (1) by spreading into a new reference: `this.items = [...this.items, x]`. Fix (2) by either switching to the `async` pipe (which calls `markForCheck()` on every emission), or by injecting `ChangeDetectorRef` and calling `this.cdr.markForCheck()` inside the subscription callback. If the update comes from outside Angular entirely (e.g., a third-party WebSocket library), also confirm `NgZone.run()` wraps the emission so it re-enters the Angular zone before CD fires.

**A (PL):** Dwie najczęstsze przyczyny to: (1) mutowanie obiektu w miejscu (np. `this.items.push(x)`) zamiast zastępowania referencji oraz (2) ręczna subskrypcja przez `.subscribe()` wewnątrz komponentu — Angular sprawdza komponent poza cyklem subskrypcji, więc szablon nigdy nie widzi nowej wartości. Rozwiązanie (1): stwórz nową referencję: `this.items = [...this.items, x]`. Rozwiązanie (2): użyj `async` pipe (który wywołuje `markForCheck()` przy każdej emisji) lub wstrzyknij `ChangeDetectorRef` i wywołaj `this.cdr.markForCheck()` wewnątrz callbacka. Jeśli aktualizacja pochodzi spoza Angular (np. biblioteka WebSocket), upewnij się, że `NgZone.run()` owija emisję, żeby wróciła do strefy Angular przed wywołaniem CD.

---

**A3**

**Q (EN):** How do Angular's HTTP interceptors chain together, and what is the difference between class-based and functional interceptors?

**Q (PL):** Jak interceptory HTTP w Angularze tworzą łańcuch i jaka jest różnica między interceptorami opartymi na klasach a funkcyjnymi?

**A (EN):** Interceptors form a pipeline: each interceptor receives the outgoing `HttpRequest` and a `next` function pointing to the next interceptor (or final handler). Class-based interceptors implement `HttpInterceptor` and are registered via the `HTTP_INTERCEPTORS` multi-provider; their execution order depends on DI resolution order, which can be unpredictable. Functional interceptors (recommended since Angular 15+) are plain functions registered via `withInterceptors([...])` in `provideHttpClient()` and run in the exact declared order — making them easier to reason about and test. The critical rule for both: `HttpRequest` objects are immutable, so you must call `req.clone({ headers: req.headers.set(...) })` to modify them before passing to `next(req)`.

**A (PL):** Interceptory tworzą potok: każdy interceptor otrzymuje wychodzący `HttpRequest` i funkcję `next` wskazującą na następny interceptor. Interceptory oparte na klasach implementują `HttpInterceptor` i są rejestrowane przez multi-provider `HTTP_INTERCEPTORS`; kolejność ich wykonania zależy od kolejności rozwiązywania DI, co może być nieprzewidywalne. Interceptory funkcyjne (zalecane od Angular 15+) to zwykłe funkcje rejestrowane przez `withInterceptors([...])` w `provideHttpClient()` i wykonywane w dokładnie zadeklarowanej kolejności. Kluczowa zasada: obiekty `HttpRequest` są niemutowalne, więc musisz wywołać `req.clone({ headers: req.headers.set(...) })`, żeby je zmodyfikować przed przekazaniem do `next(req)`.

---

**A4**

**Q (EN):** Walk me through implementing a token-refresh interceptor that retries the original request after refreshing an expired access token, without causing an infinite retry loop.

**Q (PL):** Opisz implementację interceptora odświeżającego token, który ponawia pierwotne żądanie po odświeżeniu wygasłego tokenu dostępu, bez powodowania nieskończonej pętli.

**A (EN):** The interceptor catches 401 responses, calls the auth service's `refreshToken()` (Observable), then uses `switchMap` to swap the new token into a cloned request and pass it to `next()`. To prevent an infinite loop, add a `BehaviorSubject` flag (`isRefreshing`) — if a refresh is already in flight, queue subsequent 401s with `switchMap` on that subject instead of calling refresh again. If the refresh itself returns 401, catch that error, clear auth state, redirect to login, and `throwError`. Make sure the interceptor explicitly bypasses the refresh endpoint itself (`req.url.includes('/auth/refresh')`) to avoid recursion.

**A (PL):** Interceptor przechwytuje odpowiedzi 401, wywołuje `refreshToken()` z serwisu auth (Observable), a następnie używa `switchMap`, żeby wstawić nowy token do sklonowanego żądania i przekazać go do `next()`. Żeby zapobiec nieskończonej pętli, dodaj flagę `BehaviorSubject` (`isRefreshing`) — jeśli odświeżanie jest już w toku, kolejne 401 czekają przez `switchMap` na tym Subject zamiast wywoływać odświeżanie ponownie. Jeśli samo odświeżanie zwróci 401, złap błąd, wyczyść stan auth, przekieruj do logowania i użyj `throwError`. Upewnij się, że interceptor jawnie pomija endpoint odświeżania (`req.url.includes('/auth/refresh')`), żeby uniknąć rekurencji.

---

**A5**

**Q (EN):** What is the difference between `switchMap`, `mergeMap`, `concatMap`, and `exhaustMap`? Give a real use case for each.

**Q (PL):** Jaka jest różnica między `switchMap`, `mergeMap`, `concatMap` i `exhaustMap`? Podaj praktyczny przykład użycia każdego.

**A (EN):** All four are flattening operators that subscribe to an inner Observable per source emission, but differ in concurrency handling. `switchMap` cancels the previous inner subscription when a new emission arrives — ideal for typeahead search (only the last keystroke's HTTP call matters). `mergeMap` keeps all inner subscriptions alive concurrently — good for fire-and-forget analytics events. `concatMap` queues inner Observables and subscribes to the next only once the previous completes — correct for sequential operations like drag-and-drop reordering. `exhaustMap` ignores new emissions while an inner Observable is still active — the right choice for a login button to prevent double-submit. Always place `takeUntilDestroyed()` **after** the flattening operator, not before.

**A (PL):** Wszystkie cztery to operatory spłaszczające, które subskrybują wewnętrzny Observable przy każdej emisji, różnią się jednak obsługą współbieżności. `switchMap` anuluje poprzednią subskrypcję gdy nadejdzie nowa emisja — idealny do wyszukiwania z podpowiedziami. `mergeMap` utrzymuje wszystkie subskrypcje aktywne jednocześnie — dobre do zdarzeń analitycznych. `concatMap` kolejkuje Observables i subskrybuje następny dopiero gdy poprzedni się zakończy — właściwy dla operacji sekwencyjnych. `exhaustMap` ignoruje nowe emisje gdy aktywny jest wewnętrzny Observable — właściwy dla przycisku logowania (zapobiega podwójnemu wysłaniu). Zawsze umieszczaj `takeUntilDestroyed()` **po** operatorze spłaszczającym, nie przed.

---

**A6**

**Q (EN):** What is the difference between Angular Signals and RxJS Observables, and how do you decide which to reach for?

**Q (PL):** Jaka jest różnica między Angular Signals a RxJS Observables i jak decydujesz, którego użyć?

**A (EN):** Signals are synchronous, pull-based reactive primitives designed to represent current state — you read a signal's value at any time, and Angular's renderer tracks dependencies automatically for fine-grained template updates without Zone.js. Observables are push-based streams representing values over time, with a rich operator algebra for async composition and error handling. Practical heuristic: use Signals for local component state, derived values (`computed()`), and anything you want to read synchronously in the template. Use Observables for HTTP requests, WebSocket streams, router events, and any operation benefiting from `retry`, `debounceTime`, or `combineLatest`. The two integrate cleanly: `toSignal()` converts an Observable to a Signal; `toObservable()` goes the other way.

**A (PL):** Signals to synchroniczne, reaktywne prymitywy "pull-based" do reprezentowania bieżącego stanu — możesz odczytać wartość sygnału w dowolnym momencie, a renderer Angular automatycznie śledzi zależności. Observables to strumienie "push-based" reprezentujące wartości w czasie, z bogatą algebrą operatorów. Praktyczna heurystyka: używaj Signals dla lokalnego stanu komponentu, wartości pochodnych (`computed()`) i wszystkiego, co chcesz odczytać synchronicznie w szablonie. Używaj Observables dla żądań HTTP, strumieni WebSocket, zdarzeń routera i operacji korzystających z `retry`, `debounceTime` lub `combineLatest`. Integrują się czysto: `toSignal()` konwertuje Observable na Signal; `toObservable()` w drugą stronę.

---

**A7**

**Q (EN):** What are the "diamond problem" / glitch implications of using `combineLatest` with two Observables that share a common upstream source, and how do Signals solve it?

**Q (PL):** Jakie są implikacje "problemu diamentu" / glitch przy używaniu `combineLatest` z dwoma Observables ze wspólnym źródłem i jak Signals go rozwiązują?

**A (EN):** When two Observables derived from the same source are combined with `combineLatest`, a single upstream emission causes both derived streams to emit in quick succession, making `combineLatest` fire twice — once with the first update and once with the second. In a template this can cause two re-renders or trigger two API calls. Angular Signals solve it by batching synchronous updates: if two `computed` values both depend on the same signal and you update the root signal, Angular schedules a single synchronous recalculation of all derived values before the effect or template re-renders, guaranteeing exactly one output per logical state change.

**A (PL):** Gdy dwa Observables wywodzące się z tego samego źródła są łączone przez `combineLatest`, jedna emisja nadrzędna powoduje, że oba strumienie pochodne emitują szybko po sobie, co sprawia, że `combineLatest` odpala się dwa razy. W szablonie może to powodować dwa re-rendery lub dwa wywołania API. Angular Signals rozwiązuje to przez grupowanie synchronicznych aktualizacji: jeśli dwie wartości `computed` zależą od tego samego sygnału i zaktualizujesz sygnał źródłowy, Angular planuje jednorazowe synchroniczne przeliczenie wszystkich wartości pochodnych przed re-renderem, gwarantując dokładnie jeden wynik na logiczną zmianę stanu.

---

**A8**

**Q (EN):** How does Angular's `async` pipe manage subscriptions, and what advantage does it have over manual `.subscribe()` in a component?

**Q (PL):** Jak `async` pipe w Angularze zarządza subskrypcjami i jaką przewagę ma nad ręcznym `.subscribe()` w komponencie?

**A (EN):** The `async` pipe subscribes to an Observable (or Promise) when the component initializes and automatically unsubscribes when the component is destroyed — preventing memory leaks without any manual cleanup. When it receives a new emission, it calls `ChangeDetectorRef.markForCheck()` internally, making it fully compatible with `OnPush` components. Manual `.subscribe()` requires explicit unsubscription (via `takeUntilDestroyed()`, `Subject + takeUntil`, or `Subscription.unsubscribe()` in `ngOnDestroy`) and requires storing the value in a component property. The `async` pipe eliminates the intermediate property entirely — you can bind directly in the template.

**A (PL):** `async` pipe subskrybuje Observable (lub Promise) przy inicjalizacji komponentu i automatycznie anuluje subskrypcję, gdy komponent jest niszczony — zapobiega wyciekom pamięci bez żadnego ręcznego czyszczenia. Przy każdej nowej emisji wywołuje wewnętrznie `ChangeDetectorRef.markForCheck()`, co czyni go w pełni kompatybilnym z komponentami `OnPush`. Ręczne `.subscribe()` wymaga jawnego anulowania subskrypcji (przez `takeUntilDestroyed()`, `Subject + takeUntil` lub `Subscription.unsubscribe()` w `ngOnDestroy`) oraz przechowywania wartości w polu komponentu. `async` pipe eliminuje pośrednią właściwość — możesz wiązać bezpośrednio w szablonie.

---

**A9**

**Q (EN):** Explain Angular's dependency injection hierarchy. What is the difference between `providedIn: 'root'`, a feature module, a component's `providers`, and `viewProviders`?

**Q (PL):** Wyjaśnij hierarchię wstrzykiwania zależności w Angularze. Jaka jest różnica między `providedIn: 'root'`, modułem funkcyjnym, `providers` komponentu i `viewProviders`?

**A (EN):** `providedIn: 'root'` registers the service in the root injector — a true singleton across the entire app, tree-shakable if never injected. Providing in a lazy-loaded feature module creates a child injector scoped to that module — a separate instance from the root. Providing in a component's `providers` array creates a new instance for that component and all its children (including content projected via `<ng-content>`); each component instance gets its own service. `viewProviders` is the same but the service is invisible to projected content — only the component's own view tree can inject it, which matters for compound form controls.

**A (PL):** `providedIn: 'root'` rejestruje serwis w głównym injektorze — prawdziwy singleton w całej aplikacji, tree-shakowalny jeśli nigdy nie jest wstrzykiwany. Dostarczanie w lazy-loaded module tworzy child injector ograniczony do tego modułu — oddzielną instancję od root. Dostarczanie w tablicy `providers` komponentu tworzy nową instancję dla tego komponentu i wszystkich jego dzieci (włącznie z content projection przez `<ng-content>`); każda instancja komponentu ma własną instancję serwisu. `viewProviders` działa tak samo, ale serwis jest niewidoczny dla projektowanej treści — tylko drzewo widoku komponentu może go wstrzyknąć, co ma znaczenie dla złożonych kontrolek formularza.

---

**A10**

**Q (EN):** What are `InjectionToken`s and when do you need them over a class-based provider?

**Q (PL):** Czym są `InjectionToken`y i kiedy są potrzebne zamiast providera opartego na klasie?

**A (EN):** `InjectionToken` creates a unique DI token for values that cannot or should not be typed as a class — configuration objects, primitives, interfaces (erased at runtime), or when you want multiple implementations of the same concept. Example: `export const API_URL = new InjectionToken<string>('API_URL')` paired with `{ provide: API_URL, useValue: environment.apiUrl }`. You inject it with `inject(API_URL)` or `@Inject(API_URL)`. Multi-providers (`multi: true`) extend this to collect an array of implementations under one token — the `HTTP_INTERCEPTORS` token uses exactly this pattern.

**A (PL):** `InjectionToken` tworzy unikalny token DI dla wartości, które nie mogą lub nie powinny być typowane jako klasa — obiekty konfiguracyjne, prymitywy, interfejsy (wymazywane w runtime) lub gdy chcesz dostarczyć wiele implementacji tego samego konceptu. Przykład: `export const API_URL = new InjectionToken<string>('API_URL')` sparowany z `{ provide: API_URL, useValue: environment.apiUrl }`. Wstrzykujesz przez `inject(API_URL)` lub `@Inject(API_URL)`. Multi-providerzy (`multi: true`) rozszerzają to do zbierania tablicy implementacji pod jednym tokenem — token `HTTP_INTERCEPTORS` używa dokładnie tego wzorca.

---

**A11**

**Q (EN):** What is a route resolver and how does it differ from loading data inside `ngOnInit`? When would you choose one over the other?

**Q (PL):** Czym jest route resolver i jak różni się od ładowania danych w `ngOnInit`? Kiedy wybrać jeden zamiast drugiego?

**A (EN):** A resolver implements `ResolveFn<T>` and runs before the route is activated — the router waits for the returned Observable/Promise to complete and attaches the result to `route.data`. The component only renders once data is available. The trade-off is that the previous view stays visible until resolution — can feel sluggish on slow networks. `ngOnInit` gives you instant navigation with local loading/error states — better for perceived performance. Choose resolvers when the component cannot render a meaningful skeleton state, or when multiple sibling components in the same route all need the same pre-fetched data.

**A (PL):** Resolver implementuje `ResolveFn<T>` i działa przed aktywacją trasy — router czeka na zakończenie zwróconego Observable/Promise i dołącza wynik do `route.data`. Komponent renderuje się dopiero gdy dane są dostępne. Kompromis: poprzedni widok pozostaje widoczny do czasu rozwiązania, co może sprawiać wrażenie powolności na wolnych łączach. `ngOnInit` zapewnia natychmiastową nawigację z lokalnymi stanami ładowania/błędu — lepsze dla postrzeganej wydajności. Wybierz resolvery gdy komponent nie może sensownie się renderować bez danych lub gdy wiele siostrzanych komponentów na tej samej trasie potrzebuje tych samych wstępnie pobranych danych.

---

**A12**

**Q (EN):** How do lazy-loaded routes improve performance, and what is the difference between `loadChildren` and `loadComponent`?

**Q (PL):** Jak lazy-loaded routes poprawiają wydajność i jaka jest różnica między `loadChildren` a `loadComponent`?

**A (EN):** Lazy loading splits the application into separate JS chunks downloaded only when the user navigates to that route, reducing the initial bundle and improving First Contentful Paint / TTI. `loadChildren` expects a function returning a module-level routes file, which can group many components behind one route prefix. `loadComponent` (Angular 14+) lazy-loads a single standalone component directly — ideal for leaf routes like `/checkout/success`. For further optimization, combine with `PreloadingStrategy`: `PreloadAllModules` fetches all lazy chunks after the initial load; `QuicklinkStrategy` preloads only routes linked by visible anchor tags.

**A (PL):** Lazy loading dzieli aplikację na osobne chunki JS pobierane tylko gdy użytkownik nawiguje do danej trasy, zmniejszając rozmiar początkowego bundla i poprawiając First Contentful Paint / TTI. `loadChildren` oczekuje funkcji zwracającej plik tras na poziomie modułu, który może grupować wiele komponentów pod jednym prefiksem trasy. `loadComponent` (Angular 14+) leniwie ładuje pojedynczy standalone komponent bezpośrednio — idealny dla tras liści jak `/checkout/success`. Dla dalszej optymalizacji łącz z `PreloadingStrategy`: `PreloadAllModules` pobiera wszystkie lazy chunki po załadowaniu początkowym; `QuicklinkStrategy` ładuje wstępnie tylko trasy powiązane widocznymi kotwicami.

---

**A13**

**Q (EN):** What is the difference between reactive forms and template-driven forms, and in what scenario would each be appropriate?

**Q (PL):** Jaka jest różnica między formularzami reaktywnymi a szablonowymi i w jakim scenariuszu każdy jest odpowiedni?

**A (EN):** Reactive forms define the form model in the component class (`FormGroup`, `FormControl`, `FormArray`) and bind it to the template via `[formControl]` / `formControlName` directives — the class is the single source of truth, making logic testable without a DOM. Template-driven forms define the model in the template via `ngModel` and rely on two-way binding — faster for simple forms but harder to unit test. Choose reactive forms for complex forms: dynamic field arrays, cross-field validation, multi-step wizards, or programmatic enable/disable. Template-driven is acceptable for simple contact forms where simplicity outweighs testability.

**A (PL):** Formularze reaktywne definiują model w klasie komponentu (`FormGroup`, `FormControl`, `FormArray`) i wiążą go z szablonem przez dyrektywy `[formControl]` / `formControlName` — klasa jest jedynym źródłem prawdy, co czyni logikę testowalną bez DOM. Formularze szablonowe definiują model w szablonie przez `ngModel` i polegają na wiązaniu dwukierunkowym — szybsze dla prostych formularzy, ale trudniejsze do testowania jednostkowego. Wybierz reaktywne dla złożonych formularzy: dynamiczne tablice pól, walidacja między polami, kreatory wieloetapowe lub programowe włączanie/wyłączanie. Szablonowe są akceptowalne dla prostych formularzy kontaktowych.

---

**A14**

**Q (EN):** How do you implement a custom cross-field validator in a reactive form, and how do you attach it to a `FormGroup` rather than a single control?

**Q (PL):** Jak zaimplementować własny walidator cross-field w formularzu reaktywnym i jak dołączyć go do `FormGroup` zamiast do pojedynczej kontrolki?

**A (EN):** A cross-field validator is a `ValidatorFn` applied at the `FormGroup` level: `fb.group({ password: '', confirm: '' }, { validators: passwordMatchValidator })`. The function receives the `AbstractControl` (the group), reads both child values, and returns either `null` (valid) or an error object (`{ mismatch: true }`). Since the error lives on the group, surface it in the template with `form.errors?.['mismatch']` rather than on an individual control. For async validators (e.g., checking username uniqueness via HTTP), implement `AsyncValidatorFn` returning an `Observable<ValidationErrors | null>`.

**A (PL):** Walidator cross-field to `ValidatorFn` stosowany na poziomie `FormGroup`: `fb.group({ password: '', confirm: '' }, { validators: passwordMatchValidator })`. Funkcja otrzymuje `AbstractControl` (grupę), odczytuje obie wartości potomne i zwraca `null` (poprawny) lub obiekt błędu (`{ mismatch: true }`). Ponieważ błąd żyje na grupie, wyświetlasz go w szablonie przez `form.errors?.['mismatch']`, nie na pojedynczej kontrolce. Dla walidatorów asynchronicznych (np. sprawdzanie unikalności nazwy użytkownika przez HTTP) implementuj `AsyncValidatorFn` zwracający `Observable<ValidationErrors | null>`.

---

**A15**

**Q (EN):** What does `ControlValueAccessor` do, and when would you implement it on a custom component?

**Q (PL):** Co robi `ControlValueAccessor` i kiedy zaimplementowałbyś go na niestandardowym komponencie?

**A (EN):** `ControlValueAccessor` (CVA) is an interface that allows a custom component to act as a first-class form control — compatible with both `[(ngModel)]` and `formControlName`. You implement four methods: `writeValue(val)` (form model pushes a value into your UI), `registerOnChange(fn)` (you call `fn` when the user changes value), `registerOnTouched(fn)` (call `fn` on blur), and `setDisabledState(isDisabled)`. Register with: `{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => MyInputComponent), multi: true }`. Typical use cases: date-picker, phone-number input, star-rating widget, or any compound input that should integrate natively with a parent `FormGroup`.

**A (PL):** `ControlValueAccessor` (CVA) to interfejs pozwalający niestandardowemu komponentowi działać jako kontrolka formularza pierwszej klasy — kompatybilna zarówno z `[(ngModel)]` jak i `formControlName`. Implementujesz cztery metody: `writeValue(val)` (model formularza wstawia wartość do UI), `registerOnChange(fn)` (wywołujesz `fn` gdy użytkownik zmienia wartość), `registerOnTouched(fn)` (wywołaj `fn` przy blur) i `setDisabledState(isDisabled)`. Rejestrujesz przez: `{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => MyComponent), multi: true }`. Typowe przypadki: date-picker, input numeru telefonu, widget oceny gwiazdkowej lub złożony input integrujący się natywnie z nadrzędnym `FormGroup`.

---

**A16**

**Q (EN):** What are common sources of memory leaks in Angular applications, and how do `takeUntilDestroyed()` and the `async` pipe address them?

**Q (PL):** Jakie są typowe źródła wycieków pamięci w aplikacjach Angular i jak `takeUntilDestroyed()` oraz `async` pipe je rozwiązują?

**A (EN):** The most common source is a manual `.subscribe()` on a long-lived Observable (WebSocket, interval) inside a component without unsubscribing on destroy — the subscription keeps the component object alive in memory indefinitely. `takeUntilDestroyed()` (Angular 16+) injects `DestroyRef` and emits a completion signal when the component is destroyed, automatically cleaning up. It must be placed **after** any higher-order operators (`switchMap`, `mergeMap`, etc.) in the pipe chain — placing it before means the inner subscriptions created by those operators are not captured. The `async` pipe handles this entirely automatically and is the preferred approach for template bindings.

**A (PL):** Najczęstszym źródłem jest ręczne `.subscribe()` na długożyjącym Observable (WebSocket, interwał) wewnątrz komponentu bez anulowania przy zniszczeniu — subskrypcja utrzymuje obiekt komponentu w pamięci w nieskończoność. `takeUntilDestroyed()` (Angular 16+) wstrzykuje `DestroyRef` i emituje sygnał zakończenia gdy komponent jest niszczony, automatycznie czyszcząc subskrypcję. Musi być umieszczony **po** operatorach wyższego rzędu (`switchMap`, `mergeMap` itp.) w łańcuchu pipe — umieszczenie przed oznacza, że wewnętrzne subskrypcje nie są przechwytywane. `async` pipe obsługuje to w całości automatycznie i jest preferowanym podejściem dla powiązań szablonu.

---

**A17**

**Q (EN):** What are the key pitfalls when running an Angular app with SSR (`@angular/ssr`), and how do you handle browser-only APIs?

**Q (PL):** Jakie są główne pułapki przy uruchamianiu aplikacji Angular z SSR (`@angular/ssr`) i jak obsługiwać API dostępne tylko w przeglądarce?

**A (EN):** The server-side render runs in Node.js, where browser globals — `window`, `localStorage`, `sessionStorage`, `document`, `navigator` — do not exist; accessing them crashes the SSR render. Guard them with `isPlatformBrowser(PLATFORM_ID)` (inject `PLATFORM_ID` from `@angular/core`) or use `afterNextRender()` which only runs in the browser. A second major issue is duplicate HTTP calls: the server fetches data and renders the HTML, then the browser re-bootstraps Angular and re-executes `ngOnInit` firing the HTTP request again. Solve this with `TransferState` or the `httpTransferCacheInterceptor` from `@angular/ssr` which handles GET requests automatically. Third: third-party libraries assuming `window` is global — wrap them behind `typeof window !== 'undefined'` or dynamic import inside `afterNextRender`.

**A (PL):** Render po stronie serwera działa w Node.js, gdzie globalne zmienne przeglądarki — `window`, `localStorage`, `sessionStorage`, `document`, `navigator` — nie istnieją; dostęp do nich crashuje SSR render. Chroń je przez `isPlatformBrowser(PLATFORM_ID)` (wstrzyknij `PLATFORM_ID` z `@angular/core`) lub użyj `afterNextRender()`, który działa tylko w przeglądarce. Drugi główny problem to zduplikowane wywołania HTTP: serwer pobiera dane i renderuje HTML, potem przeglądarka re-bootstrapuje Angular i ponownie wykonuje `ngOnInit` wywołując żądanie HTTP. Rozwiąż to przez `TransferState` lub `httpTransferCacheInterceptor` z `@angular/ssr` który automatycznie obsługuje żądania GET. Trzecia pułapka: biblioteki zewnętrzne zakładające globalność `window` — owiń je strażnikiem `typeof window !== 'undefined'` lub dynamicznym importem wewnątrz `afterNextRender`.

---

**A18**

**Q (EN):** What is the difference between full hydration and incremental hydration, and what does `@defer` have to do with it?

**Q (PL):** Jaka jest różnica między pełną hydratacją a przyrostową i co ma z tym wspólnego `@defer`?

**A (EN):** Full hydration (Angular 17+, stable in 18) attaches Angular's event listeners and component state to the server-rendered DOM without discarding or re-creating it — avoiding double-parse cost. The browser still needs to download and execute the full JS bundle before any component becomes interactive. Incremental hydration defers hydration of individual component subtrees until their trigger fires (e.g., viewport intersection, user interaction) — components wrapped with `@defer` are shipped as separate lazy chunks. This means above-the-fold content hydrates immediately while off-screen components defer their JS download entirely, improving Time-to-Interactive. `@defer` also enables `placeholder`, `loading`, and `error` blocks as first-class template primitives.

**A (PL):** Pełna hydratacja (Angular 17+, stabilna w 18) dołącza nasłuchiwacze zdarzeń Angular i stan komponentu do DOM renderowanego przez serwer bez jego odrzucania lub ponownego tworzenia. Przeglądarka nadal musi pobrać i wykonać pełny bundle JS zanim którykolwiek komponent stanie się interaktywny. Hydratacja przyrostowa odracza hydratację poszczególnych poddrzew komponentów do momentu odpalenia wyzwalacza (np. przecięcie viewport, interakcja użytkownika) — komponenty owinięte `@defer` są dostarczane jako osobne lazy chunki. Oznacza to, że treść powyżej zakładki jest hydratowana natychmiast, podczas gdy komponenty off-screen odraczają pobieranie JS, poprawiając Time-to-Interactive. `@defer` umożliwia też bloki `placeholder`, `loading` i `error` jako prymitywy szablonu pierwszej klasy.

---

**A19**

**Q (EN):** Explain `trackBy` (and the newer `track` expression in `@for`). What DOM problem does it solve, and what are the pitfalls of `track $index`?

**Q (PL):** Wyjaśnij `trackBy` (i nowsze wyrażenie `track` w `@for`). Jaki problem DOM rozwiązuje i jakie są pułapki `track $index`?

**A (EN):** By default, Angular's `@for` loop compares items by reference. When the array is replaced from a server response — even if the data is identical — all DOM nodes are destroyed and recreated because the references are new objects. `track item.id` tells the differ to use a stable identity, so only genuinely new/removed/moved items touch the DOM. This is critical for performance in large lists and prevents losing focus state, CSS transitions, or component-level state inside repeated items. `track $index` is a pitfall: when an item is removed from the middle of the list, every subsequent item shifts index and is considered "changed," defeating the purpose. Always track by a stable business key (UUID, database ID).

**A (PL):** Domyślnie pętla `@for` Angular porównuje elementy przez referencję. Gdy tablica jest zastępowana odpowiedzią serwera — nawet jeśli dane są identyczne — wszystkie węzły DOM są niszczone i tworzone ponownie, bo referencje to nowe obiekty. `track item.id` mówi różnicownikowi, żeby używał stabilnej tożsamości, więc tylko faktycznie nowe/usunięte/przesunięte elementy dotykają DOM. To kluczowe dla wydajności dużych list i zapobiega utracie stanu fokusu, przejść CSS lub stanu komponentu. `track $index` to pułapka: gdy element jest usuwany ze środka listy, każdy kolejny element przesuwa indeks i jest uważany za "zmieniony," co niweluje cel. Zawsze track po stabilnym kluczu biznesowym (UUID, ID bazy danych).

---

**A20**

**Q (EN):** You have a search input that fires an HTTP request on every keystroke. Walk me through the complete RxJS chain you'd build to avoid hammering the backend, cancel stale requests, and handle errors gracefully.

**Q (PL):** Masz pole wyszukiwania, które wywołuje żądanie HTTP przy każdym naciśnięciu klawisza. Opisz pełny łańcuch RxJS, który zbudujesz, żeby nie bombardować backendu, anulować nieaktualne żądania i elegancko obsługiwać błędy.

**A (EN):** Start with a `Subject<string>` (or `FormControl.valueChanges`) emitting on every keystroke. Pipe through `debounceTime(300)` to wait for the user to pause, then `distinctUntilChanged()` to skip identical consecutive emissions, then `filter(term => term.length >= 2)` to avoid searching on empty input. Then `switchMap(term => this.searchService.search(term).pipe(catchError(() => EMPTY)))` — `switchMap` cancels the previous in-flight HTTP request when a new term arrives; the inner `catchError` returns `EMPTY` so a failed request doesn't terminate the outer stream (a common mistake: outer `catchError` kills the entire subscription on the first error). Subscribe with `takeUntilDestroyed()` or bind via `async` pipe.

**A (PL):** Zacznij od `Subject<string>` (lub `FormControl.valueChanges`) emitującego przy każdym naciśnięciu klawisza. Przepuść przez `debounceTime(300)` by poczekać aż użytkownik skończy pisać, potem `distinctUntilChanged()` żeby pominąć identyczne kolejne emisje, potem `filter(term => term.length >= 2)` żeby nie wyszukiwać pustego inputu. Następnie `switchMap(term => this.searchService.search(term).pipe(catchError(() => EMPTY)))` — `switchMap` anuluje poprzednie aktywne żądanie HTTP gdy nadejdzie nowy termin; wewnętrzny `catchError` zwraca `EMPTY` żeby nieudane żądanie nie przerywało zewnętrznego strumienia (powszechny błąd: zewnętrzny `catchError` zabija całą subskrypcję przy pierwszym błędzie). Subskrybuj przez `takeUntilDestroyed()` lub powiąż przez `async` pipe.

---

### Node.js — Rating 3/5

---

**N1**

**Q (EN):** What is the Node.js event loop and why does it matter for a web server?

**Q (PL):** Czym jest pętla zdarzeń Node.js i dlaczego ma znaczenie dla serwera webowego?

**A (EN):** The event loop is a single-threaded mechanism that continuously checks for pending callbacks and executes them when the main call stack is empty. It allows Node.js to handle thousands of concurrent I/O operations (network requests, DB queries, file reads) without spawning a new thread per request. Node offloads I/O to the OS/libuv, then picks up the result via a callback when it's done — so your server stays responsive even under load.

**A (PL):** Pętla zdarzeń to jednowątkowy mechanizm, który ciągle sprawdza oczekujące callbacki i wykonuje je gdy główny stos wywołań jest pusty. Pozwala Node.js obsługiwać tysiące równoczesnych operacji I/O (żądania sieciowe, zapytania DB, odczyty plików) bez tworzenia nowego wątku na żądanie. Node deleguje I/O do OS/libuv, a wynik odbiera przez callback gdy jest gotowy — serwer pozostaje responsywny nawet pod obciążeniem.

---

**N2**

**Q (EN):** What does "non-blocking I/O" mean in practice? Give a concrete example.

**Q (PL):** Co oznacza "non-blocking I/O" w praktyce? Podaj konkretny przykład.

**A (EN):** Non-blocking means Node does not wait for a slow operation to finish — it registers a callback and moves on to handle other work. Concrete example: calling `fs.readFile()` returns immediately; Node continues processing other requests, and only when the OS signals the file is ready does the callback run. Compare to `fs.readFileSync()`, which freezes the entire process until the read completes — blocking every other request in the meantime.

**A (PL):** Non-blocking oznacza, że Node nie czeka aż wolna operacja się zakończy — rejestruje callback i przechodzi do obsługi innej pracy. Konkretny przykład: wywołanie `fs.readFile()` wraca natychmiast; Node kontynuuje przetwarzanie innych żądań i dopiero gdy OS sygnalizuje gotowość pliku, callback się wykonuje. Porównaj to z `fs.readFileSync()`, który zamraża cały proces do zakończenia odczytu — blokując każde inne żądanie w tym czasie.

---

**N3**

**Q (EN):** What is the difference between a callback, a Promise, and `async/await`? When would you choose each?

**Q (PL):** Jaka jest różnica między callbackiem, Promise a `async/await`? Kiedy wybrać każde?

**A (EN):** Callbacks are plain functions passed as arguments and invoked when an async task finishes — the oldest pattern, but leads to "callback hell" when nested. Promises represent a future value and allow `.then()/.catch()` chaining — more readable but still somewhat noisy. `async/await` is syntactic sugar over Promises that lets you write async code that reads top-to-bottom like synchronous code. In practice, `async/await` is the default today; raw callbacks still appear in older Node core APIs and library internals.

**A (PL):** Callbacki to zwykłe funkcje przekazywane jako argumenty i wywoływane gdy asynchroniczne zadanie się zakończy — najstarszy wzorzec, ale prowadzi do "callback hell" przy zagnieżdżeniu. Promise reprezentuje przyszłą wartość i pozwala na łańcuchowanie `.then()/.catch()` — bardziej czytelne, ale nadal nieco hałaśliwe. `async/await` to cukier syntaktyczny nad Promise, który pozwala pisać kod asynchroniczny czytany od góry do dołu jak synchroniczny. W praktyce `async/await` to dziś domyślny wybór; surowe callbacki pojawiają się jeszcze w starszych API jądra Node.

---

**N4**

**Q (EN):** How do you handle errors in an `async/await` function? What happens if you don't?

**Q (PL):** Jak obsługujesz błędy w funkcji `async/await`? Co się stanie jeśli tego nie zrobisz?

**A (EN):** Wrap the `await` call in a `try/catch` block — the `catch` receives the rejection reason as a regular `Error` object. If you skip error handling and the Promise rejects, Node emits an `unhandledRejection` event; in Node 15+ this terminates the process by default. In Express specifically, you must also call `next(err)` inside the catch so the error reaches your centralized error-handling middleware, otherwise Express hangs the response.

**A (PL):** Owiń wywołanie `await` w blok `try/catch` — `catch` otrzymuje przyczynę odrzucenia jako zwykły obiekt `Error`. Jeśli pominiesz obsługę błędów i Promise zostanie odrzucony, Node emituje zdarzenie `unhandledRejection`; w Node 15+ domyślnie kończy to proces. W Express konkretnie musisz też wywołać `next(err)` wewnątrz catch, żeby błąd dotarł do centralnego middleware obsługi błędów, inaczej Express zawiesza odpowiedź.

---

**N5**

**Q (EN):** How does Express middleware work? Walk through what `(req, res, next)` means.

**Q (PL):** Jak działa middleware Express? Wyjaśnij co oznacza `(req, res, next)`.

**A (EN):** Express middleware is a function with the signature `(req, res, next)`. When a request comes in, Express runs middleware in the order they are registered with `app.use()`. Each function can read/modify `req` and `res`, then either end the cycle by sending a response (`res.json(...)`) or call `next()` to hand control to the next middleware in the chain. Calling `next(err)` with an argument skips normal middleware and jumps straight to the four-argument error handler `(err, req, res, next)`.

**A (PL):** Middleware Express to funkcja z sygnaturą `(req, res, next)`. Gdy przychodzi żądanie, Express uruchamia middleware w kolejności rejestracji przez `app.use()`. Każda funkcja może czytać/modyfikować `req` i `res`, a następnie albo zakończyć cykl wysyłając odpowiedź (`res.json(...)`) albo wywołać `next()` żeby przekazać kontrolę do następnego middleware. Wywołanie `next(err)` z argumentem pomija normalny middleware i skacze bezpośrednio do czteropunktowego handlera błędów `(err, req, res, next)`.

---

**N6**

**Q (EN):** How do you handle errors in async Express route handlers? What breaks if you forget?

**Q (PL):** Jak obsługujesz błędy w asynchronicznych handlerach tras Express? Co się psuje jeśli zapomnisz?

**A (EN):** Express does not automatically catch Promise rejections in route handlers. If you use `async/await`, you must either wrap the handler body in `try/catch` and call `next(err)`, or use a utility like `express-async-errors` that patches Express to forward rejections automatically. Without this, an unhandled rejection in a route silently hangs the request — the client never gets a response and the error is invisible to your error middleware.

**A (PL):** Express nie przechwytuje automatycznie odrzuconych Promise w handlerach tras. Jeśli używasz `async/await`, musisz albo owinąć ciało handlera w `try/catch` i wywołać `next(err)`, albo użyć narzędzia jak `express-async-errors` które łata Express do automatycznego przekazywania odrzuceń. Bez tego odrzucony Promise w trasie cicho zawiesza żądanie — klient nigdy nie otrzymuje odpowiedzi, a błąd jest niewidoczny dla middleware obsługi błędów.

---

**N7**

**Q (EN):** What is `process.env` and how do you use it safely?

**Q (PL):** Czym jest `process.env` i jak bezpiecznie go używać?

**A (EN):** `process.env` is a plain object Node populates from the OS environment at startup — it's how you inject secrets and config without hardcoding them. The standard practice is to use the `dotenv` package, which reads a `.env` file and merges values into `process.env` before your app starts. You should validate that required variables are present at startup (fail fast with a clear message) rather than letting undefined values cause silent bugs deep in production.

**A (PL):** `process.env` to zwykły obiekt, który Node wypełnia ze środowiska OS przy starcie — tak wstrzykujesz sekrety i konfigurację bez hardkodowania. Standardową praktyką jest użycie pakietu `dotenv`, który odczytuje plik `.env` i scala wartości z `process.env` przed startem aplikacji. Powinieneś walidować obecność wymaganych zmiennych przy starcie (fail fast z jasnym komunikatem) zamiast pozwalać wartościom `undefined` powodować ciche błędy w produkcji.

---

**N8**

**Q (EN):** What is the difference between `require()` (CommonJS) and `import` (ESM)?

**Q (PL):** Jaka jest różnica między `require()` (CommonJS) a `import` (ESM)?

**A (EN):** CommonJS (`require`) is Node's original module system — it loads modules synchronously and is still the default in most Node projects. ESM (`import/export`) is the JavaScript standard, loaded asynchronously, and required in `.mjs` files or when `"type": "module"` is set in `package.json`. Practical differences: you cannot use `require` in an ESM module; `import` is statically analyzable (enables tree-shaking); and top-level `await` is only available in ESM. NestJS with TypeScript compiles to CommonJS by default via `tsc`.

**A (PL):** CommonJS (`require`) to oryginalny system modułów Node — ładuje moduły synchronicznie i jest nadal domyślny w większości projektów Node. ESM (`import/export`) to standard JavaScript, ładowany asynchronicznie, wymagany w plikach `.mjs` lub gdy `"type": "module"` jest ustawiony w `package.json`. Praktyczne różnice: nie możesz używać `require` w module ESM; `import` jest statycznie analizowalny (umożliwia tree-shaking); top-level `await` jest dostępny tylko w ESM. NestJS z TypeScript kompiluje domyślnie do CommonJS przez `tsc`.

---

**N9**

**Q (EN):** What is `package.json` `scripts` and what is the difference between `npm` and `npx`?

**Q (PL):** Czym są `scripts` w `package.json` i jaka jest różnica między `npm` a `npx`?

**A (EN):** `scripts` is a map of shorthand commands — `npm run build` executes the shell command defined under `"build"`, with `node_modules/.bin` automatically on the PATH so you can call locally installed CLIs directly. `npm` is the package manager (install, publish, run scripts). `npx` executes a package binary without installing it globally — e.g. `npx prisma generate` runs the Prisma CLI from `node_modules/.bin`, and if the package isn't installed it downloads it temporarily.

**A (PL):** `scripts` to mapa skróconych poleceń — `npm run build` wykonuje polecenie shell zdefiniowane pod kluczem `"build"`, z `node_modules/.bin` automatycznie na PATH, żebyś mógł bezpośrednio wywoływać lokalnie zainstalowane CLI. `npm` to menedżer pakietów (install, publish, uruchamianie skryptów). `npx` uruchamia binarny pakiet bez globalnej instalacji — np. `npx prisma generate` uruchamia Prisma CLI z `node_modules/.bin`, a jeśli pakiet nie jest zainstalowany, pobiera go tymczasowo.

---

**N10**

**Q (EN):** What is a Node.js stream and when should you use one?

**Q (PL):** Czym jest strumień Node.js i kiedy powinieneś go używać?

**A (EN):** A stream is an abstraction for processing data in chunks rather than loading it all into memory at once. Node has four types: Readable, Writable, Duplex (both), and Transform (modify data in transit). Reach for streams when dealing with large files (CSV imports, video), piping HTTP responses, or any situation where the full dataset is too large to buffer. Practically: `fs.createReadStream().pipe(res)` streams a file to the HTTP response without ever holding the whole file in RAM.

**A (PL):** Strumień to abstrakcja do przetwarzania danych w fragmentach zamiast ładowania całości do pamięci naraz. Node ma cztery typy: Readable, Writable, Duplex (oba) i Transform (modyfikacja danych w transporcie). Sięgaj po strumienie przy dużych plikach (import CSV, wideo), potokowaniu odpowiedzi HTTP lub każdej sytuacji gdy pełny zestaw danych jest zbyt duży by go buforować. Praktycznie: `fs.createReadStream().pipe(res)` strumieniuje plik do odpowiedzi HTTP bez trzymania całego pliku w RAM.

---

**N11**

**Q (EN):** What is the microtask queue and how does it relate to `Promise.resolve()` vs `setTimeout()`?

**Q (PL):** Czym jest kolejka mikrozadań i jak odnosi się do `Promise.resolve()` vs `setTimeout()`?

**A (EN):** Resolved Promises go into the microtask queue, while `setTimeout` callbacks go into the macrotask queue. After every task finishes, the event loop drains the entire microtask queue before moving to the next macrotask. This means `Promise.resolve().then(fn)` always runs before a `setTimeout(fn, 0)`, even though both are "asynchronous". Practically: if you chain many `.then()` calls synchronously, they all execute before any timer fires.

**A (PL):** Rozwiązane Promise trafiają do kolejki mikrozadań, natomiast callbacki `setTimeout` do kolejki makrozadań. Po zakończeniu każdego zadania pętla zdarzeń opróżnia całą kolejkę mikrozadań przed przejściem do następnego makrozadania. Oznacza to, że `Promise.resolve().then(fn)` zawsze uruchamia się przed `setTimeout(fn, 0)`, nawet jeśli oba są "asynchroniczne". Praktycznie: jeśli synchronicznie łączysz wiele wywołań `.then()`, wszystkie wykonują się przed odpaleniem jakiegokolwiek timera.

---

**N12**

**Q (EN):** When is Node.js a poor choice for a task, and what do you use instead?

**Q (PL):** Kiedy Node.js jest złym wyborem dla zadania i co zamiast tego używasz?

**A (EN):** Node's single JavaScript thread means CPU-intensive work — image processing, video transcoding, complex cryptography, ML inference, large in-memory data crunching — blocks the event loop and starves all concurrent requests. For those tasks you'd offload to a dedicated service (a Python microservice, a Go worker), use Node's `worker_threads` for truly isolated computation, or push the work into a background queue (like BullMQ) and process it in a separate process.

**A (PL):** Jeden wątek JavaScript Node oznacza, że praca intensywnie korzystająca z CPU — przetwarzanie obrazów, transkodowanie wideo, złożona kryptografia, wnioskowanie ML, duże przetwarzanie danych w pamięci — blokuje pętlę zdarzeń i zagłasza wszystkie równoległe żądania. Dla takich zadań oddelegowujesz do dedykowanego serwisu (mikroserwis Python, worker Go), używasz `worker_threads` Node dla izolowanych obliczeń lub przekazujesz pracę do kolejki w tle (jak BullMQ) i przetwarzasz w osobnym procesie.

---

**N13**

**Q (EN):** What is `process.nextTick()` and how is it different from `setImmediate()`?

**Q (PL):** Czym jest `process.nextTick()` i jak różni się od `setImmediate()`?

**A (EN):** `process.nextTick(fn)` queues a callback to run at the end of the current operation, before the event loop proceeds to the next phase — it fires even before I/O callbacks. `setImmediate(fn)` fires in the check phase of the event loop, after I/O events. Use `process.nextTick` when you need to defer a callback until the current synchronous code finishes but before any I/O; prefer `setImmediate` when you want to give I/O a chance to run first. Overusing `nextTick` in a tight loop can starve I/O.

**A (PL):** `process.nextTick(fn)` kolejkuje callback do uruchomienia na końcu bieżącej operacji, zanim pętla zdarzeń przejdzie do następnej fazy — odpala się nawet przed callbackami I/O. `setImmediate(fn)` odpala w fazie sprawdzania pętli zdarzeń, po zdarzeniach I/O. Używaj `process.nextTick` gdy chcesz odroczyć callback do zakończenia bieżącego kodu synchronicznego ale przed jakimkolwiek I/O; preferuj `setImmediate` gdy chcesz dać I/O szansę na działanie najpierw. Nadużywanie `nextTick` w ścisłej pętli może zagłodzić I/O.

---

**N14**

**Q (EN):** What happens when you `require` the same module twice in different files? Does Node load it twice?

**Q (PL):** Co się dzieje gdy wymagasz tego samego modułu dwa razy w różnych plikach? Czy Node ładuje go dwa razy?

**A (EN):** No — Node caches modules after the first `require`. The first call executes the module file and stores the result in `require.cache` keyed by the resolved file path. All subsequent `require` calls return the cached export without re-executing the file. This is why singletons work naturally in Node (e.g. a single Prisma client instance) — every file that requires it gets the same object.

**A (PL):** Nie — Node buforuje moduły po pierwszym `require`. Pierwsze wywołanie wykonuje plik modułu i przechowuje wynik w `require.cache` indeksowanym przez rozwiązaną ścieżkę pliku. Wszystkie kolejne wywołania `require` zwracają zbuforowany eksport bez ponownego wykonywania pliku. Dlatego singletony działają naturalnie w Node (np. jedna instancja klienta Prisma) — każdy plik który go wymaga dostaje ten sam obiekt.

---

### AWS Lambda — Rating 2/5

---

**L1**

**Q (EN):** What is serverless computing, and what problem does AWS Lambda solve?

**Q (PL):** Czym jest serverless computing i jaki problem rozwiązuje AWS Lambda?

**A (EN):** Serverless means you write and deploy code without provisioning or managing servers — the cloud provider handles the infrastructure, OS patching, and scaling. Lambda solves the problem of operational overhead: instead of running an EC2 instance 24/7 for occasional work, you pay only for the exact compute time your code actually runs (billed in 1 ms increments).

**A (PL):** Serverless oznacza pisanie i wdrażanie kodu bez provisionowania lub zarządzania serwerami — dostawca chmury zajmuje się infrastrukturą, łataniem OS i skalowaniem. Lambda rozwiązuje problem narzutu operacyjnego: zamiast uruchamiać instancję EC2 24/7 dla okazjonalnej pracy, płacisz tylko za dokładny czas obliczeniowy gdy Twój kod faktycznie działa (rozliczany w przyrostach 1 ms).

---

**L2**

**Q (EN):** What are some services that can trigger a Lambda function?

**Q (PL):** Jakie serwisy mogą wyzwalać funkcję Lambda?

**A (EN):** Lambda integrates with many AWS event sources — common ones are API Gateway (HTTP requests), S3 (file uploads), SQS (queue messages), EventBridge (scheduled or event-bus events), SNS (pub/sub notifications), and DynamoDB Streams (table change events). The trigger source also determines whether the invocation is synchronous or asynchronous.

**A (PL):** Lambda integruje się z wieloma źródłami zdarzeń AWS — powszechne to API Gateway (żądania HTTP), S3 (przesyłanie plików), SQS (wiadomości z kolejki), EventBridge (zaplanowane zdarzenia lub event-bus), SNS (powiadomienia pub/sub) i DynamoDB Streams (zdarzenia zmian tabeli). Źródło wyzwalacza determinuje też czy wywołanie jest synchroniczne czy asynchroniczne.

---

**L3**

**Q (EN):** What is a cold start in Lambda, and why does it add latency?

**Q (PL):** Czym jest cold start w Lambda i dlaczego dodaje opóźnienie?

**A (EN):** A cold start occurs when Lambda has no warm (pre-initialized) execution environment available and must create a new one from scratch — downloading your code package, starting the runtime, and running any initialization code outside your handler. This adds overhead ranging from ~100 ms to over 1 second before your handler even executes. Warm invocations skip this phase entirely because Lambda reuses an existing environment.

**A (PL):** Cold start występuje gdy Lambda nie ma dostępnego ciepłego (wstępnie zainicjalizowanego) środowiska wykonawczego i musi stworzyć nowe od zera — pobierając pakiet kodu, uruchamiając runtime i wykonując kod inicjalizacyjny poza handlerem. Dodaje to narzut od ~100 ms do ponad 1 sekundy zanim handler w ogóle się wykona. Ciepłe wywołania całkowicie pomijają tę fazę, bo Lambda ponownie używa istniejącego środowiska.

---

**L4**

**Q (EN):** Walk me through the Lambda execution environment lifecycle.

**Q (PL):** Opisz cykl życia środowiska wykonawczego Lambda.

**A (EN):** There are three phases. In the **Init** phase, Lambda bootstraps the runtime, loads extensions, and runs your static initialization code (imports, DB connection setup). In the **Invoke** phase, Lambda calls your handler function with the event payload. In the **Shutdown** phase, Lambda eventually freezes or terminates the environment after a period of inactivity. On subsequent invocations, if the environment is still warm, Lambda skips Init entirely and goes straight to Invoke — this is a warm start.

**A (PL):** Są trzy fazy. W fazie **Init** Lambda bootstrapuje runtime, ładuje rozszerzenia i uruchamia statyczny kod inicjalizacyjny (importy, konfiguracja połączenia DB). W fazie **Invoke** Lambda wywołuje funkcję handler z payload zdarzenia. W fazie **Shutdown** Lambda ostatecznie zamraża lub kończy środowisko po okresie bezczynności. Przy kolejnych wywołaniach, jeśli środowisko jest nadal ciepłe, Lambda całkowicie pomija Init i przechodzi bezpośrednio do Invoke — to jest warm start.

---

**L5**

**Q (EN):** What are the key hard limits of AWS Lambda you should know?

**Q (PL):** Jakie są kluczowe twarde limity AWS Lambda, które powinieneś znać?

**A (EN):** The maximum execution timeout is **15 minutes** (900 s) — anything longer needs Fargate or Step Functions. Memory is configurable from **128 MB up to 10,240 MB**, and CPU scales proportionally with memory. The deployment package size limit is **50 MB zipped** (250 MB unzipped), or up to 10 GB using a container image. There is also a default concurrency limit of **1,000 simultaneous executions** per AWS account per region (soft limit — can be raised).

**A (PL):** Maksymalny timeout wykonania to **15 minut** (900 s) — cokolwiek dłuższego wymaga Fargate lub Step Functions. Pamięć jest konfigurowalna od **128 MB do 10 240 MB**, a CPU skaluje się proporcjonalnie do pamięci. Limit rozmiaru pakietu wdrożeniowego to **50 MB zspakowane** (250 MB rozpakowane) lub do 10 GB przy użyciu obrazu kontenera. Istnieje też domyślny limit współbieżności **1000 jednoczesnych wykonań** na konto AWS na region (limit miękki — można podnieść).

---

**L6**

**Q (EN):** What is the difference between synchronous and asynchronous Lambda invocation?

**Q (PL):** Jaka jest różnica między synchronicznym a asynchronicznym wywołaniem Lambda?

**A (EN):** In **synchronous** invocation the caller waits for the function to finish and receives the response directly — API Gateway works this way. In **asynchronous** invocation, Lambda queues the event internally and returns an acknowledgment immediately without waiting for execution; the function runs in the background, and Lambda can automatically retry on failure and route failures to a Dead Letter Queue (DLQ). S3 event notifications are a classic example of async invocation.

**A (PL):** Przy **synchronicznym** wywołaniu caller czeka aż funkcja się zakończy i otrzymuje odpowiedź bezpośrednio — API Gateway działa w ten sposób. Przy **asynchronicznym** wywołaniu Lambda wewnętrznie kolejkuje zdarzenie i natychmiast zwraca potwierdzenie bez czekania na wykonanie; funkcja działa w tle, a Lambda może automatycznie ponawiać przy niepowodzeniu i kierować błędy do Dead Letter Queue (DLQ). Powiadomienia o zdarzeniach S3 to klasyczny przykład asynchronicznego wywołania.

---

**L7**

**Q (EN):** When would you choose Lambda over EC2, and when would you choose EC2 over Lambda?

**Q (PL):** Kiedy wybrałbyś Lambda zamiast EC2 i kiedy EC2 zamiast Lambda?

**A (EN):** Lambda is the right choice for event-driven, short-duration workloads with variable or unpredictable traffic — image thumbnailing on S3 upload, REST API endpoints, or scheduled jobs. EC2 is better when you need persistent processes, execution times beyond 15 minutes, fine-grained OS control, or steady high-throughput workloads where per-invocation billing would cost more than a reserved instance running continuously.

**A (PL):** Lambda to właściwy wybór dla sterownych zdarzeniami, krótkotrwałych workloadów ze zmiennym lub nieprzewidywalnym ruchem — tworzenie miniaturek po przesłaniu do S3, endpointy REST API lub zaplanowane zadania. EC2 jest lepsze gdy potrzebujesz trwałych procesów, czasu wykonania powyżej 15 minut, szczegółowej kontroli OS lub stabilnych workloadów wysokiej przepustowości gdzie rozliczanie za wywołanie byłoby droższe niż zarezerwowana instancja działająca ciągłe.

---

**L8**

**Q (EN):** What is Amazon API Gateway and how does it work with Lambda?

**Q (PL):** Czym jest Amazon API Gateway i jak współpracuje z Lambda?

**A (EN):** API Gateway is a managed service that accepts HTTP(S) requests from clients and routes them to backend services. When paired with Lambda, API Gateway translates an incoming HTTP request into an event object and invokes the Lambda function synchronously — the function's return value becomes the HTTP response. This combination is the standard pattern for building serverless REST APIs without managing any web server.

**A (PL):** API Gateway to zarządzany serwis przyjmujący żądania HTTP(S) od klientów i kierujący je do serwisów backend. W połączeniu z Lambda, API Gateway tłumaczy przychodzące żądanie HTTP na obiekt zdarzenia i wywołuje funkcję Lambda synchronicznie — wartość zwrócona przez funkcję staje się odpowiedzią HTTP. Ta kombinacja to standardowy wzorzec budowania bezserwerowych REST API bez zarządzania serwerem webowym.

---

**L9**

**Q (EN):** Why is opening a database connection inside the Lambda handler on every invocation a problem, and how does RDS Proxy address this?

**Q (PL):** Dlaczego otwieranie połączenia z bazą danych w handlerze Lambda przy każdym wywołaniu jest problemem i jak RDS Proxy to rozwiązuje?

**A (EN):** Lambda can scale to thousands of concurrent executions, and each invocation that opens its own connection would quickly exhaust the database's connection limit (PostgreSQL has a relatively low hard cap). RDS Proxy sits between Lambda and the RDS database, maintaining a pool of persistent connections and multiplexing many Lambda invocations over a small number of real DB connections — avoiding connection exhaustion without any code change in the function itself.

**A (PL):** Lambda może skalować do tysięcy równoczesnych wykonań, a każde wywołanie otwierające własne połączenie szybko wyczerpałoby limit połączeń bazy danych (PostgreSQL ma relatywnie niski twardy limit). RDS Proxy siedzi między Lambda a bazą danych RDS, utrzymując pulę trwałych połączeń i multipleksując wiele wywołań Lambda przez małą liczbę rzeczywistych połączeń DB — unikając wyczerpania połączeń bez żadnych zmian kodu w funkcji.

---

**L10**

**Q (EN):** How should you handle secrets and configuration in Lambda — what should you never do?

**Q (PL):** Jak powinieneś obsługiwać sekrety i konfigurację w Lambda — czego nigdy nie robić?

**A (EN):** You should never hardcode secrets (API keys, database passwords) directly in your function's source code, as that exposes credentials in version control and deployment artifacts. The correct approach is to use environment variables for non-sensitive configuration, and reference secrets from **AWS Secrets Manager** or **AWS Systems Manager Parameter Store**. Lambda environment variables are encrypted at rest using AWS KMS.

**A (PL):** Nigdy nie powinieneś hardkodować sekretów (klucze API, hasła do bazy danych) bezpośrednio w kodzie źródłowym funkcji, bo to ujawnia poświadczenia w kontroli wersji i artefaktach wdrożeniowych. Właściwe podejście to używanie zmiennych środowiskowych dla niewrażliwej konfiguracji i odwoływanie się do sekretów z **AWS Secrets Manager** lub **AWS Systems Manager Parameter Store**. Zmienne środowiskowe Lambda są szyfrowane w stanie spoczynku przez AWS KMS.

---

**L11**

**Q (EN):** What strategies can mitigate cold start latency?

**Q (PL):** Jakie strategie mogą łagodzić opóźnienie cold start?

**A (EN):** Three practical ones: (1) **Provisioned Concurrency** — Lambda pre-warms a configurable number of execution environments so they are always ready, eliminating cold starts for those instances entirely; (2) **smaller deployment packages** — less code to download and parse means faster Init; (3) **runtime choice** — Node.js and Python initialize significantly faster than JVM-based runtimes like Java (Java-specific mitigation is Lambda SnapStart).

**A (PL):** Trzy praktyczne: (1) **Provisioned Concurrency** — Lambda wstępnie rozgrzewa konfigurowalną liczbę środowisk wykonawczych żeby były zawsze gotowe, całkowicie eliminując cold starty dla tych instancji; (2) **mniejsze pakiety wdrożeniowe** — mniej kodu do pobrania i parsowania oznacza szybszy Init; (3) **wybór runtime** — Node.js i Python inicjalizują się znacznie szybciej niż runtimes oparte na JVM jak Java (specyficznym dla Javy rozwiązaniem jest Lambda SnapStart).

---

**L12**

**Q (EN):** Lambda is described as "stateless." What does that mean in practice?

**Q (PL):** Lambda jest opisywana jako "bezstanowa". Co to oznacza w praktyce?

**A (EN):** It means you cannot rely on in-memory state persisting between invocations — Lambda may route two consecutive requests to different execution environments, or terminate an environment after inactivity. Any state that needs to survive across invocations must be stored externally: a database (RDS, DynamoDB), a cache (ElastiCache), or object storage (S3). The `/tmp` directory does persist within a warm environment but is considered a transient cache only, not reliable persistent storage.

**A (PL):** Oznacza to, że nie możesz polegać na stanie w pamięci utrzymującym się między wywołaniami — Lambda może kierować dwa kolejne żądania do różnych środowisk wykonawczych lub zakończyć środowisko po bezczynności. Stan który musi przetrwać między wywołaniami musi być przechowywany zewnętrznie: baza danych (RDS, DynamoDB), cache (ElastiCache) lub obiektowa pamięć masowa (S3). Katalog `/tmp` utrzymuje się w ciepłym środowisku, ale jest uważany tylko za cache przejściowy, nie niezawodny trwały magazyn.

---

### Architecture — Rating 3/5

---

**AR1**

**Q (EN):** What is the core trade-off between a monolithic architecture and microservices, and when would you choose one over the other?

**Q (PL):** Jaki jest podstawowy kompromis między architekturą monolityczną a mikroserwisami i kiedy wybrałbyś jedno zamiast drugiego?

**A (EN):** A monolith bundles all functionality into a single deployable unit — simpler to develop, debug, and deploy early on, but harder to scale individual parts independently. Microservices split the system into independently deployable services, enabling per-service scaling and isolated failures, but introduce network latency, distributed tracing complexity, and operational overhead that rarely pays off for small teams. The rule of thumb: start with a monolith, extract services only when a specific bottleneck or team size justifies it. A NestJS app with separate modules (auth, orders, payments) is a well-structured monolith — it can be split later without a full rewrite.

**A (PL):** Monolit pakuje całą funkcjonalność w jedną wdrożeniową jednostkę — prostszy do rozwijania, debugowania i wdrażania na początku, ale trudniejszy do niezależnego skalowania poszczególnych części. Mikroserwisy dzielą system na niezależnie wdrażalne serwisy, umożliwiając skalowanie per-serwis i izolację błędów, ale wprowadzają opóźnienie sieciowe, złożoność rozproszonego śledzenia i narzut operacyjny rzadko opłacalny dla małych zespołów. Zasada: zacznij od monolitu, wydzielaj serwisy tylko gdy konkretne wąskie gardło lub rozmiar zespołu to uzasadnia. Aplikacja NestJS z osobnymi modułami (auth, orders, payments) to dobrze ustrukturyzowany monolit — można go podzielić później bez pełnego przepisania.

---

**AR2**

**Q (EN):** What are the main operational costs of microservices that people underestimate?

**Q (PL):** Jakie są główne koszty operacyjne mikroserwisów, które ludzie niedoceniają?

**A (EN):** Each service needs its own CI/CD pipeline, logging, health checks, and deployment config — what takes one Railway service becomes a dozen. Service-to-service calls fail in ways local function calls never do: you need retries, timeouts, and circuit breakers. Data consistency becomes hard because each service owns its own database, so a multi-step operation (create order + charge payment + reserve stock) can partially fail with no simple rollback. Microservices start paying off only when the team exceeds 8–10 engineers or when specific services have wildly different scaling needs.

**A (PL):** Każdy serwis potrzebuje własnego pipeline CI/CD, logowania, health checków i konfiguracji wdrożenia — co zajmuje jeden serwis Railway staje się tuzinem. Wywołania między serwisami zawodzą w sposób, w jaki lokalne wywołania funkcji nigdy nie zawodzą: potrzebujesz ponowień, timeoutów i circuit breakerów. Spójność danych staje się trudna, bo każdy serwis posiada własną bazę danych, więc wieloetapowa operacja (stwórz zamówienie + nalicz płatność + zarezerwuj stock) może częściowo się nie powieść bez prostego rollbacku. Mikroserwisy zaczynają się opłacać dopiero gdy zespół przekracza 8-10 inżynierów lub gdy konkretne serwisy mają radykalnie różne potrzeby skalowania.

---

**AR3**

**Q (EN):** What HTTP status codes should a REST API return for a successful resource creation, a validation error, an unauthorized request, and a resource not found?

**Q (PL):** Jakie kody statusu HTTP powinien zwracać REST API dla: pomyślnego utworzenia zasobu, błędu walidacji, nieautoryzowanego żądania i nieznalezionego zasobu?

**A (EN):** `201 Created` for a successful POST (often with a `Location` header pointing to the new resource). `400 Bad Request` for validation failures, with a body listing specific fields and messages. `401 Unauthorized` when no valid credentials are present (missing or expired JWT), and `403 Forbidden` when credentials are valid but the user lacks permission (e.g., a regular user hitting an admin endpoint). `404 Not Found` when the resource does not exist — never return `200` with an empty body for a missing record.

**A (PL):** `201 Created` dla pomyślnego POST (często z nagłówkiem `Location` wskazującym na nowy zasób). `400 Bad Request` dla błędów walidacji, z ciałem wymieniającym konkretne pola i komunikaty. `401 Unauthorized` gdy nie ma prawidłowych poświadczeń (brakujący lub wygasły JWT) i `403 Forbidden` gdy poświadczenia są prawidłowe, ale użytkownik nie ma uprawnień (np. zwykły użytkownik próbujący uderzyć w endpoint administratora). `404 Not Found` gdy zasób nie istnieje — nigdy nie zwracaj `200` z pustym ciałem dla brakującego rekordu.

---

**AR4**

**Q (EN):** How would you version a REST API, and what approach would you use in production?

**Q (PL):** Jak wersjonowałbyś REST API i jakie podejście zastosowałbyś w produkcji?

**A (EN):** The three common strategies are URI versioning (`/api/v1/products`), query parameter versioning (`/products?v=2`), and header-based versioning (`Accept: application/vnd.api+json;version=2`). URI versioning is the most practical choice: it is explicit, cache-friendly, and easy to route at the API Gateway or reverse proxy level. Extending an existing `/api` prefix to `/api/v1` costs near zero effort. Avoid versioning by header unless you have a very API-platform-focused product, because it complicates client implementation and debugging.

**A (PL):** Trzy powszechne strategie to wersjonowanie URI (`/api/v1/products`), wersjonowanie przez parametr zapytania (`/products?v=2`) i wersjonowanie przez nagłówek (`Accept: application/vnd.api+json;version=2`). Wersjonowanie URI to najpraktyczniejszy wybór: jest jawne, przyjazne pamięci podręcznej i łatwe do routowania na poziomie API Gateway lub reverse proxy. Rozszerzenie istniejącego prefiksu `/api` do `/api/v1` kosztuje prawie zero wysiłku. Unikaj wersjonowania przez nagłówek chyba że masz produkt bardzo zorientowany na platformę API.

---

**AR5**

**Q (EN):** What does "idempotent" mean in the context of HTTP methods, and which methods should be idempotent?

**Q (PL):** Co oznacza "idempotent" w kontekście metod HTTP i które metody powinny być idempotentne?

**A (EN):** An idempotent operation produces the same result no matter how many times it is called with the same inputs. `GET`, `PUT`, and `DELETE` must be idempotent — fetching a resource twice returns the same data, updating a product's price to 49.99 twice leaves it at 49.99, and deleting an already-deleted record should return `404`. `POST` is explicitly not idempotent — submitting an order form twice creates two orders. This matters practically when building retry logic: you can safely retry a `GET` after a network timeout; retrying a `POST` without an idempotency key risks duplicate payments.

**A (PL):** Idempotentna operacja daje ten sam wynik niezależnie od tego ile razy jest wywoływana z tymi samymi danymi. `GET`, `PUT` i `DELETE` muszą być idempotentne — pobranie zasobu dwa razy zwraca te same dane, aktualizacja ceny do 49,99 dwa razy pozostawia ją na 49,99, a usunięcie już usuniętego rekordu powinno zwrócić `404`. `POST` jest jawnie nieidemp otentny — wysłanie formularza zamówienia dwa razy tworzy dwa zamówienia. Ma to praktyczne znaczenie przy logice ponowień: możesz bezpiecznie ponowić `GET` po timeout; ponowienie `POST` bez klucza idempotencji ryzykuje zduplikowanymi płatnościami.

---

**AR6**

**Q (EN):** What does "stateless" mean for a REST API, and why does it matter for horizontal scaling?

**Q (PL):** Co oznacza "bezstanowy" dla REST API i dlaczego ma znaczenie dla skalowania poziomego?

**A (EN):** Stateless means the server holds no session data between requests — every request carries all the information needed to process it (e.g., a JWT in the `Authorization` header). This matters for scaling because any instance behind a load balancer can handle any request without needing to share memory or sticky sessions. JWT-based auth is correctly stateless; the one exception is the refresh token stored in the DB — that lookup is a single shared data source, not per-instance memory.

**A (PL):** Bezstanowy oznacza, że serwer nie przechowuje danych sesji między żądaniami — każde żądanie niesie wszystkie informacje potrzebne do jego przetworzenia (np. JWT w nagłówku `Authorization`). Ma to znaczenie dla skalowania, bo każda instancja za load balancerem może obsłużyć dowolne żądanie bez potrzeby dzielenia pamięci lub sticky sessions. Uwierzytelnianie oparte na JWT jest poprawnie bezstanowe; jedynym wyjątkiem jest refresh token przechowywany w DB — to jest jedno wspólne źródło danych, nie pamięć per-instancja.

---

**AR7**

**Q (EN):** When would you choose a NoSQL database over PostgreSQL, and what are the trade-offs?

**Q (PL):** Kiedy wybrałbyś bazę danych NoSQL zamiast PostgreSQL i jakie są kompromisy?

**A (EN):** Choose NoSQL (e.g., MongoDB, DynamoDB) when your data has a highly variable or nested schema that does not map cleanly to tables, or when you need horizontal write scaling beyond what a single Postgres primary can handle. PostgreSQL is the right default for e-commerce: you have structured relationships (users, orders, products, variants), need ACID transactions (charge payment + decrement stock atomically), and benefit from strong consistency and `JOIN` queries. The trade-off: NoSQL scales writes more easily across nodes but sacrifices ACID guarantees — a missing foreign key constraint in MongoDB silently orphans data.

**A (PL):** Wybierz NoSQL (np. MongoDB, DynamoDB) gdy dane mają wysoce zmienne lub zagnieżdżone schematy, które nie mapują się czysto na tabele, lub gdy potrzebujesz poziomego skalowania zapisu ponad możliwości pojedynczego primary Postgres. PostgreSQL to właściwy domyślny wybór dla e-commerce: masz ustrukturyzowane relacje (użytkownicy, zamówienia, produkty, warianty), potrzebujesz transakcji ACID (nalicz płatność + zmniejsz stock atomicznie) i korzystasz z silnej spójności i zapytań `JOIN`. Kompromis: NoSQL łatwiej skaluje zapisy między węzłami, ale poświęca gwarancje ACID — brakujące ograniczenie klucza obcego w MongoDB cicho tworzy sieroty danych.

---

**AR8**

**Q (EN):** Describe three layers of caching and where each one fits in a web application.

**Q (PL):** Opisz trzy warstwy buforowania i gdzie każda pasuje w aplikacji webowej.

**A (EN):** **Browser cache** stores static assets (JS, CSS, images) using `Cache-Control: max-age` headers so repeat visits load instantly — Angular's hashed asset filenames (`main.abc123.js`) make this safe to cache for a year. A **CDN** (like Vercel's Edge Network) caches prerendered HTML and static files at edge nodes globally, so a user in Warsaw gets a page from a Frankfurt node, not a US server. **Redis** (application-level cache) stores computed or DB-fetched data server-side — e.g., caching a product catalog query for 60 seconds to avoid hitting Postgres on every request under high traffic. Each layer reduces load on the layer below it.

**A (PL):** **Cache przeglądarki** przechowuje statyczne zasoby (JS, CSS, obrazy) używając nagłówków `Cache-Control: max-age` — hashowane nazwy plików Angular (`main.abc123.js`) czynią to bezpiecznym do buforowania przez rok. **CDN** (jak Vercel's Edge Network) buforuje prerenderowany HTML i pliki statyczne w węzłach edge globalnie, więc użytkownik w Warszawie dostaje stronę z węzła we Frankfurcie. **Redis** (cache na poziomie aplikacji) przechowuje obliczone lub pobrane z DB dane po stronie serwera — np. buforowanie zapytania katalogu produktów przez 60 sekund żeby uniknąć uderzania w Postgres przy każdym żądaniu. Każda warstwa redukuje obciążenie warstwy poniżej.

---

**AR9**

**Q (EN):** What is a cache invalidation strategy, and what problem does stale data cause in e-commerce specifically?

**Q (PL):** Czym jest strategia unieważniania cache i jaki problem powodują nieaktualne dane konkretnie w e-commerce?

**A (EN):** Cache invalidation is the process of removing or updating cached data when the underlying source changes. In e-commerce, stale data is dangerous: if you cache a product's stock count and a customer buys the last unit, users still see "In Stock" until the cache expires. Common strategies: **TTL-based expiration** (cache auto-expires after N seconds — simple but can show stale data), **write-through** (update cache immediately when DB is written — consistent but adds write latency), and **cache-aside with explicit invalidation** (delete the cache key on write; next read repopulates — most common in NestJS/Redis setups).

**A (PL):** Unieważnianie cache to proces usuwania lub aktualizowania buforowanych danych gdy zmienia się źródłowe źródło. W e-commerce nieaktualne dane są niebezpieczne: jeśli buforujesz stan magazynowy produktu i klient kupuje ostatnią jednostkę, użytkownicy nadal widzą "W magazynie" do wygaśnięcia cache. Powszechne strategie: **wygasanie oparte na TTL** (cache auto-wygasa po N sekundach — prosta, ale może pokazywać nieaktualne dane), **write-through** (aktualizuj cache natychmiast przy zapisie DB — spójne ale dodaje opóźnienie zapisu), **cache-aside z jawnym unieważnianiem** (usuń klucz cache przy zapisie; następny odczyt uzupełnia — najpowszechniejsze w NestJS/Redis).

---

**AR10**

**Q (EN):** Why use a message queue like BullMQ/Redis for sending transactional emails instead of calling the email API directly in the request handler?

**Q (PL):** Dlaczego używać kolejki wiadomości jak BullMQ/Redis do wysyłania emaili transakcyjnych zamiast wywoływać API emaila bezpośrednio w handlerze żądania?

**A (EN):** Sending email inline blocks the HTTP response waiting for the email API — if the service is slow or down, your order endpoint returns a 500. A queue decouples the action: the order endpoint enqueues a job and responds `201` immediately; a worker processes the job asynchronously. Queues also give you automatic retries with backoff (if the API fails, retry in 30s, 5m, 1h) without any custom retry logic in your controller. This is especially important during traffic spikes — you can process thousands of order confirmations at a controlled rate rather than hammering the email API concurrently.

**A (PL):** Wysyłanie emaila inline blokuje odpowiedź HTTP w oczekiwaniu na API emaila — jeśli serwis jest wolny lub niedostępny, endpoint zamówień zwraca 500. Kolejka rozsprzęga akcję: endpoint kolejkuje zadanie i odpowiada `201` natychmiast; worker przetwarza zadanie asynchronicznie. Kolejki dają też automatyczne ponawianie z backoffem (jeśli API zawiedzie, ponów po 30s, 5m, 1h) bez żadnej logiki ponowień w kontrolerze. To szczególnie ważne przy skokach ruchu — możesz przetwarzać tysiące potwierdzeń zamówień w kontrolowanym tempie zamiast uderzać w API emaila jednocześnie.

---

**AR11**

**Q (EN):** What is the difference between a webhook and polling, and what are the security requirements for a webhook endpoint?

**Q (PL):** Jaka jest różnica między webhookiem a pollingiem i jakie są wymagania bezpieczeństwa dla endpointu webhooka?

**A (EN):** Polling means your server repeatedly calls a third-party API on a schedule ("any new events?") — wasteful and adds latency proportional to your poll interval. A webhook is the inverse: the third party calls your endpoint the moment an event occurs (e.g., Stripe POSTs to `/payments/webhook` when a payment completes). The critical security requirement is **signature verification**: Stripe includes an HMAC signature in the `Stripe-Signature` header; your endpoint must recompute it using the raw request body and `STRIPE_WEBHOOK_SECRET`, rejecting any request that does not match. Without this, anyone can POST fake `checkout.session.completed` events to trigger order fulfillment without paying.

**A (PL):** Polling oznacza, że Twój serwer cyklicznie wywołuje API zewnętrzne ("jakieś nowe zdarzenia?") — rozrzutny i dodaje opóźnienie proporcjonalne do interwału. Webhook to odwrotność: zewnętrzna strona wywołuje Twój endpoint w momencie wystąpienia zdarzenia (np. Stripe wysyła POST na `/payments/webhook` gdy płatność zostanie ukończona). Krytycznym wymogiem bezpieczeństwa jest **weryfikacja podpisu**: Stripe dołącza podpis HMAC w nagłówku `Stripe-Signature`; Twój endpoint musi go ponownie obliczyć używając surowego ciała żądania i `STRIPE_WEBHOOK_SECRET`, odrzucając żądania które nie pasują. Bez tego ktokolwiek może wysłać fałszywe zdarzenia `checkout.session.completed` żeby wywołać realizację zamówień bez płacenia.

---

**AR12**

**Q (EN):** What is the difference between vertical and horizontal scaling, and what architectural constraint must be in place for horizontal scaling to work?

**Q (PL):** Jaka jest różnica między skalowaniem pionowym a poziomym i jakie ograniczenie architektoniczne musi być spełnione dla działania skalowania poziomego?

**A (EN):** Vertical scaling means adding more CPU/RAM to the existing server — simple but has a physical ceiling and creates a single point of failure. Horizontal scaling means adding more server instances behind a load balancer — theoretically unlimited, but requires your application to be **stateless** (no in-memory session, no local file writes). If a NestJS app writes uploaded images to the local filesystem, the second instance would not have those files — that is why Supabase Storage is used as a shared external store. Railway supports horizontal scaling via replica count, but it only works correctly if all shared state lives in external services like Postgres, Redis, and Supabase.

**A (PL):** Skalowanie pionowe oznacza dodawanie więcej CPU/RAM do istniejącego serwera — proste ale ma fizyczny sufit i tworzy pojedynczy punkt awarii. Skalowanie poziome oznacza dodawanie więcej instancji serwera za load balancerem — teoretycznie nieograniczone, ale wymaga **bezstanowości** aplikacji (brak sesji w pamięci, brak lokalnych zapisów plików). Gdyby aplikacja NestJS zapisywała przesłane obrazy do lokalnego systemu plików, druga instancja nie miałaby tych plików — dlatego używa się Supabase Storage jako współdzielonego zewnętrznego magazynu. Railway obsługuje skalowanie poziome przez liczbę replik, ale działa poprawnie tylko jeśli cały stan współdzielony żyje w zewnętrznych serwisach jak Postgres, Redis i Supabase.

---

**AR13**

**Q (EN):** What stages does a basic CI/CD pipeline include, and what is the purpose of each stage?

**Q (PL):** Jakie etapy zawiera podstawowy pipeline CI/CD i jaki jest cel każdego etapu?

**A (EN):** A typical pipeline has four stages. **Install & build** runs `pnpm install` and compiles TypeScript — catches import errors and type failures before they reach production. **Lint & test** runs ESLint and unit/integration tests — prevents regressions and enforces code style automatically. **Staging deploy** pushes the build to a staging environment so the change can be smoke-tested with real infrastructure. **Production deploy** promotes the same build artifact (not a rebuild) to production, typically gated by a manual approval or a passing smoke test. Running `prisma migrate deploy` as a pre-deploy hook is the database migration stage that blocks a deploy if migrations fail.

**A (PL):** Typowy pipeline ma cztery etapy. **Install & build** uruchamia `pnpm install` i kompiluje TypeScript — wykrywa błędy importu i niepowodzenia typów zanim dotrą do produkcji. **Lint & test** uruchamia ESLint i testy jednostkowe/integracyjne — zapobiega regresjom i automatycznie wymusza styl kodu. **Staging deploy** wypycha build do środowiska staging żeby zmiana mogła być przetestowana z prawdziwą infrastrukturą. **Production deploy** promuje ten sam artefakt build (nie rebuild) do produkcji, zazwyczaj gateowany przez ręczną akceptację lub testy smoke. Uruchomienie `prisma migrate deploy` jako pre-deploy hook to etap migracji DB blokujący deploy przy niepowodzeniu migracji.

---

**AR14**

**Q (EN):** What is a database index, when should you add one, and what is the cost of over-indexing?

**Q (PL):** Czym jest indeks bazy danych, kiedy powinieneś go dodać i jaki jest koszt nadmiernego indeksowania?

**A (EN):** An index is a separate data structure (typically a B-tree) that lets Postgres find rows matching a `WHERE` clause without scanning every row in the table — critical once a table has thousands of records. Add indexes on columns used in frequent `WHERE` conditions, `JOIN` keys, and `ORDER BY` clauses: e.g., `products.slug` (looked up on every product page), `orders.userId` (fetched per user), and `cart_items.cartId`. The cost of over-indexing: every `INSERT` or `UPDATE` must also update each index on that table. A table with 10 indexes writes roughly 10x more data per row change. Rule: index for your read patterns, but profile with `EXPLAIN ANALYZE` before adding indexes speculatively.

**A (PL):** Indeks to osobna struktura danych (zazwyczaj B-drzewo), która pozwala Postgres znaleźć wiersze pasujące do klauzuli `WHERE` bez skanowania każdego wiersza — kluczowe gdy tabela ma tysiące rekordów. Dodawaj indeksy na kolumnach używanych w częstych warunkach `WHERE`, kluczach `JOIN` i klauzulach `ORDER BY`: np. `products.slug` (wyszukiwany na każdej stronie produktu), `orders.userId` (pobierany per użytkownik) i `cart_items.cartId`. Koszt nadmiernego indeksowania: każdy `INSERT` lub `UPDATE` musi też aktualizować każdy indeks na tej tabeli. Tabela z 10 indeksami zapisuje ok. 10x więcej danych na zmianę wiersza. Zasada: indeksuj dla wzorców odczytu, ale profiluj przez `EXPLAIN ANALYZE` przed spekulatywnym dodawaniem indeksów.

---

**AR15**

**Q (EN):** What are the key differences between JWT-based authentication and session-based authentication, and what is JWT's biggest weakness?

**Q (PL):** Jakie są kluczowe różnice między uwierzytelnianiem opartym na JWT a sesyjnym i jaka jest największa słabość JWT?

**A (EN):** Session-based auth stores login state server-side (a session record in DB or Redis) and gives the client only an opaque session ID in a cookie — stateful, but immediately revocable by deleting the server record. JWT embeds all claims (userId, role, expiry) in a signed token the client holds; the server verifies only the signature without a DB lookup, making it stateless and horizontally scalable. JWT's biggest weakness is **revocation**: you cannot invalidate a token before it expires without implementing a blacklist (which re-introduces server-side state). Mitigate with a short access token TTL (15 min) and a hashed refresh token stored in the DB, which can be revoked immediately.

**A (PL):** Uwierzytelnianie sesyjne przechowuje stan logowania po stronie serwera (rekord sesji w DB lub Redis) i daje klientowi tylko nieprzezroczysty ID sesji w ciasteczku — stanowe, ale natychmiast odwoływalne przez usunięcie rekordu. JWT umieszcza wszystkie twierdzenia (userId, rola, wygaśnięcie) w podpisanym tokenie przechowywanym przez klienta; serwer weryfikuje tylko podpis bez wyszukiwania w DB, co czyni go bezstanowym i poziomo skalowalnym. Największą słabością JWT jest **unieważnianie**: nie możesz unieważnić tokenu przed jego wygaśnięciem bez implementacji czarnej listy (co ponownie wprowadza stan po stronie serwera). Łagodz to krótkim TTL tokenu dostępu (15 min) i haszowanym refresh tokenem przechowywany w DB, który może być natychmiast unieważniony.

---

*Q&A bank generated from research across: [Angular Space — Senior Interview Q&A](https://www.angularspace.com/senior-angular-interview-questions/), [InterviewBit — Angular](https://www.interviewbit.com/angular-interview-questions/), [InterviewBit — Node.js](https://www.interviewbit.com/node-js-interview-questions/), [roadmap.sh — Node.js Q&A](https://roadmap.sh/questions/nodejs), [AWS Lambda Docs — Execution Environment](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html), [InterviewBit — AWS Lambda](https://www.interviewbit.com/aws-lambda-interview-questions/), [Adaface — Software Architecture](https://www.adaface.com/blog/software-architecture-interview-questions/), [InterviewBit — REST API](https://www.interviewbit.com/rest-api-interview-questions/)*
