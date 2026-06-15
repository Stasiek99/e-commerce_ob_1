# Rozszerzona baza pytań rekrutacyjnych — CGI Stażysta Fullstack

**Zakres:** AWS Lambda · Node.js · Angular · Architektura  
**Język:** Polski  
**Format:** Pytanie → Szczegółowa odpowiedź  
**Przeznaczenie:** Uzupełnienie `cgi-interview-prep.md` — pytania na poziomie od junior do mid-level

---

## Część 1 — AWS Lambda

---

### Podstawy

**L-E1**

**P:** Czym różni się AWS Lambda od tradycyjnego serwera webowego?

**O:** Tradycyjny serwer (EC2, VPS) działa 24/7 niezależnie od ruchu — płacisz za cały czas działania, ręcznie zarządzasz skalowaniem i łatkami bezpieczeństwa systemu operacyjnego. Lambda uruchamia się wyłącznie w odpowiedzi na zdarzenie, kończy działanie gdy funkcja zwróci wynik i skaluje automatycznie od zera do tysięcy równoczesnych wywołań. Płacisz tylko za faktyczny czas wykonania (minimum 1 ms). Kluczowe różniczające cechy: brak trwałego stanu między wywołaniami, limit 15 minut na wykonanie, brak zarządzania OS i automatyczne skalowanie horyzontalne. Lambda idealnie nadaje się dla zdarzeń nieregularnych lub "burstowych" — np. przetwarzanie pliku po uploadzie, obsługa żądań REST API.

---

**L-E2**

**P:** Co to jest AWS Lambda Layer i kiedy powinieneś go używać?

**O:** Lambda Layer to archiwum ZIP zawierające biblioteki, niestandardowe runtimes lub pliki konfiguracyjne, które można dołączyć do wielu funkcji Lambda jednocześnie. Layer jest montowany w ścieżce `/opt` wewnątrz środowiska wykonawczego. Używaj Layers gdy: (1) wiele funkcji Lambda współdzieli te same zależności (np. `lodash`, `aws-sdk`) — zamiast pakować je do każdej funkcji osobno, trzymasz je w jednym Layer i aktualizujesz w jednym miejscu; (2) chcesz zmniejszyć rozmiar pakietu wdrożeniowego funkcji, co przyspiesza cold start; (3) chcesz udostępnić własny kod narzędziowy (np. logger, obsługa błędów) między wieloma funkcjami bez kopiowania. Ograniczenie: maksymalnie 5 Layers per funkcja, łączny rozmiar nie przekracza 250 MB rozpakowanych.

---

**L-E3**

**P:** Czym jest Provisioned Concurrency i Reserved Concurrency i jaka jest między nimi różnica?

**O:** **Reserved Concurrency** rezerwuje określoną liczbę równoczesnych wykonań wyłącznie dla danej funkcji — to zarówno gwarancja (funkcja zawsze dostanie tyle zasobów) jak i limit (nie przekroczy tej wartości). Używasz go do izolowania krytycznych funkcji od innych lub do limitowania kosztownych operacji. **Provisioned Concurrency** idzie dalej — Lambda inicjalizuje i utrzymuje gotową pulę środowisk wykonawczych, całkowicie eliminując cold starty. Środowiska są stale "ciepłe" i gotowe do natychmiastowego wywołania. Różnica: Reserved Concurrency to "ile maksymalnie", Provisioned Concurrency to "tyle zawsze gotowych". Provisioned Concurrency kosztuje niezależnie od wywołań (płacisz za sam fakt gotowości), więc używaj go tylko dla funkcji wrażliwych na opóźnienia.

---

**L-E4**

**P:** Co to są Lambda Destinations i czym różnią się od Dead Letter Queue?

**O:** Lambda Destinations to konfiguracja określająca co ma się stać z wynikiem wywołania asynchronicznego — zarówno w przypadku sukcesu jak i porażki. Możesz wysłać wynik na: SQS, SNS, EventBridge lub inną funkcję Lambda. Różnica od DLQ: DLQ przechwytuje tylko niepowodzenia po wyczerpaniu prób (jest związane z oryginalnym zdarzeniem), natomiast Destinations można skonfigurować zarówno dla sukcesu jak i porażki, i przekazują one pełny kontekst wykonania (oryginalny event + wynik + metadane). Destinations to nowszy, bardziej elastyczny mechanizm — AWS zaleca ich używanie zamiast DLQ w nowych implementacjach. Praktyczne zastosowanie: wysyłaj wyniki udanego przetwarzania pliku do SQS dla dalszej obsługi, a błędy do dedykowanej kolejki alertów.

---

**L-E5**

**P:** Jak Lambda obsługuje współbieżność i co oznacza "throttling"?

**O:** Każde równoczesne wywołanie Lambda uruchamia się w osobnym, izolowanym środowisku. Konto AWS ma domyślny łączny limit 1000 równoczesnych wykonań per region, współdzielony między wszystkie funkcje. Gdy liczba równoczesnych żądań przekroczy limit, Lambda zwraca błąd `TooManyRequestsException` — to właśnie throttling. Konsekwencje: wywołania synchroniczne (API Gateway) dostają natychmiastowy błąd 429; wywołania asynchroniczne (SQS, SNS) są kolejkowane i powtarzane. Można zarządzać tym przez: Reserved Concurrency (gwarantuje pulę konkretnej funkcji), zwiększenie limitu przez support AWS, lub zaprojektowanie backendu tak, by gracefully degradował przy 429 (circuit breaker po stronie klienta).

---

**L-E6**

**P:** Co to jest Event Source Mapping i jak działa z SQS?

**O:** Event Source Mapping to wbudowany mechanizm Lambda, który automatycznie polluje źródło zdarzeń (SQS, DynamoDB Streams, Kinesis, MSK) i wywołuje funkcję z zestawem rekordów (batch). Dla SQS: Lambda polluje kolejkę, zbiera do N wiadomości (konfigurowalny `batchSize`) i wywołuje funkcję z tablicą `Records`. Jeśli funkcja zakończy się sukcesem, Lambda usuwa wiadomości z kolejki; jeśli rzuci błęd, wiadomości wracają do kolejki i są ponawiane. Kluczowe ustawienia: `batchSize` (1–10 000 dla standardowych kolejek), `MaximumBatchingWindowInSeconds` (czas oczekiwania na pełny batch), `ReportBatchItemFailures` (umożliwia częściowe powodzenie — funkcja może zwrócić listę nieudanych `itemIdentifiers` zamiast failować cały batch).

---

**L-E7**

**P:** Jak Lambda radzi sobie z VPC (Virtual Private Cloud)? Jakie są koszty i korzyści?

**O:** Domyślnie Lambda działa w sieci zarządzanej przez AWS bez dostępu do zasobów Twojego VPC (np. RDS, ElastiCache w prywatnych podsieciach). Dołączając Lambda do VPC konfigurujesz: Subnet IDs (Lambda tworzy ENI w tych podsieciach) i Security Group IDs. Korzyść: Lambda może bezpośrednio łączyć się z zasobami VPC. Koszty: (1) zimny start wolniejszy o czas inicjalizacji ENI (choć AWS znacząco to poprawił od 2020 r. dzięki Hyperplane ENI), (2) Lambda potrzebuje wystarczającej liczby wolnych adresów IP w podsieci — każde równoczesne wywołanie zużywa jeden IP; (3) bez NAT Gateway Lambda w VPC nie ma dostępu do internetu ani publicznych API AWS. Wskazówka: jeśli Lambda potrzebuje zarówno dostępu do VPC jak i internetu, umieść ją w prywatnej podsieci i dodaj NAT Gateway lub VPC Endpoints dla serwisów AWS.

---

**L-E8**

**P:** Czym jest Lambda SnapStart i dla kogo jest przeznaczony?

**O:** Lambda SnapStart to mechanizm eliminacji cold startów dla funkcji Java (Corretto 11+). Podczas wdrażania Lambda inicjalizuje funkcję, tworzy snapshot stanu pamięci i dysku w momencie po fazie Init i zapisuje go w cache. Kolejne "cold starty" nie inicjalizują JVM od zera — Lambda przywraca snapshot, co skraca czas uruchamiania z kilku sekund (typowe dla Javy) do dziesiątek milisekund. Ważne uwagi: jeśli funkcja generuje losowe tokeny lub kryptograficzne nonce podczas Init, muszą być one generowane nowo przy każdym przywróceniu — Lambda dostarcza hooki `CRaC` (`beforeCheckpoint`/`afterRestore`) do obsługi takich przypadków. SnapStart jest dostępny tylko dla Javy, Node.js i Python nie potrzebują go (mają natywnie szybkie cold starty).

---

**L-E9**

**P:** Co to są Lambda Function URLs i kiedy użyjesz ich zamiast API Gateway?

**O:** Lambda Function URLs to wbudowane endpointy HTTPS dla Lambda, umożliwiające bezpośrednie wywoływanie funkcji bez API Gateway. Dostępne są dwa tryby auth: `AWS_IAM` (wymaga podpisanych żądań SigV4) i `NONE` (publiczny dostęp — zabezpiecz własną autoryzacją w kodzie funkcji). Używaj Function URLs gdy: potrzebujesz prostego, taniego endpointu HTTP dla jednej funkcji (bez kosztów API Gateway), budujesz webhook handler (np. GitHub webhooks), lub potrzebujesz obsługi streaming response (Function URLs jako jedyny mechanizm Lambda obsługują `RESPONSE_STREAM`). Używaj API Gateway gdy: potrzebujesz zaawansowanego routingu, throttlingu, transformacji żądań/odpowiedzi, custom domain, lub integracji z Cognito Authorizer dla wielu endpointów.

---

**L-E10**

**P:** Czym jest Step Functions i kiedy zastępuje Lambda?

**O:** AWS Step Functions to serwis do orkiestrowania przepływów pracy opartych o stan — definiujesz maszynę stanów (JSON/YAML) z krokami, rozgałęzieniami, pętlami, obsługą błędów i czekaniem. Zastępuje Lambda gdy: (1) potrzebujesz długotrwałych procesów (> 15 min) składających się z wielu kroków — Step Functions może działać do roku, koordynując wywołania Lambda, ECS, DynamoDB, SQS itp.; (2) logika przepływu pracy jest złożona i musisz ją wizualizować — graf maszyny stanów jest samodokumentujący; (3) potrzebujesz wbudowanej obsługi błędów z automatycznym retry i catch per krok; (4) chcesz rozdzielić orkiestrację (Step Functions) od logiki biznesowej (Lambda) — łatwiejsze testowanie i modyfikacja. Przykład e-commerce: "stwórz zamówienie → zarezerwuj stock → nalicz płatność → wyślij email → wygeneruj etykietę" — każdy krok to osobna Lambda, cały przepływ to Step Functions.

---

**L-E11**

**P:** Jak monitorujesz i debugujesz funkcję Lambda w produkcji?

**O:** Trzy główne narzędzia: (1) **CloudWatch Logs** — Lambda automatycznie przesyła stdout/stderr do grup logów; każde wywołanie generuje logi z metadanymi (requestId, czas wykonania, rozmiar pamięci). Używaj strukturyzowanych logów (JSON) żeby łatwo filtrować przez CloudWatch Insights. (2) **CloudWatch Metrics** — wbudowane metryki: `Invocations`, `Errors`, `Throttles`, `Duration`, `ConcurrentExecutions`. Ustaw alarmy na `Errors > 0` i `Throttles > 0`. (3) **AWS X-Ray** — distributed tracing; dodaje `AWSXRay.captureAWSv3Client()` do klientów SDK żeby śledzić wywołania DynamoDB, S3, itp. jako segmenty. Włącza się przez `tracing: Active` w konfiguracji funkcji. Dodatkowo: Lambda Insights (rozszerzone metryki CPU/pamięci/sieci), Third-party APM (Datadog, New Relic, Sentry). Kluczowa praktyka: zawsze loguj `event` (po usunięciu danych wrażliwych), `requestId` (do korelacji z logami klientów) i nieobsłużone błędy ze stack trace.

---

**L-E12**

**P:** Czym jest AWS SAM (Serverless Application Model) i jak pomaga w pracy z Lambda?

**O:** AWS SAM to framework Infrastructure as Code oparty na CloudFormation, specjalizowany pod Lambda i serwisy serverless. Dostarcza uproszczone zasoby YAML (`AWS::Serverless::Function`, `AWS::Serverless::Api`, `AWS::Serverless::SimpleTable`) które SAM transformuje do pełnych zasobów CloudFormation. Kluczowe korzyści: (1) `sam local invoke` — uruchamia Lambda lokalnie z dowolnym event JSON, bez deploymentu; (2) `sam local start-api` — lokalny serwer API Gateway symulujący trasowanie; (3) `sam sync --watch` — automatyczny redeploy przy zmianach kodu (hot reload do chmury); (4) `sam build` — buduje zależności dla każdej funkcji osobno, tree-shaking per Lambda. W porównaniu do Serverless Framework: SAM jest oficjalnym narzędziem AWS bez dodatkowych zależności; Serverless Framework jest bardziej dojrzały i multi-cloud. Oba podejścia są akceptowalne w projektach produkcyjnych.

---

**L-E13**

**P:** Jak zaimplementować idempotentność w funkcji Lambda obsługującej płatności?

**O:** Problem: Lambda może być wywołana więcej niż raz dla tego samego zdarzenia (retries asynchroniczne, duplikaty SQS). Dla płatności to oznacza ryzyko podwójnego obciążenia. Rozwiązanie: (1) **Klucz idempotencji** — każde żądanie zawiera unikalny `idempotencyKey` (UUID wygenerowany po stronie klienta lub `requestId` SQS). (2) **Tabela stanów** — przed przetworzeniem sprawdź w DynamoDB czy `idempotencyKey` już istnieje; jeśli tak, zwróć zapisany wynik bez ponownego przetwarzania; jeśli nie, zapisz klucz z TTL (np. 24h) i przetwórz. (3) **Conditional write** — użyj `ConditionExpression: "attribute_not_exists(pk)"` przy zapisie do DynamoDB, żeby uniknąć race condition między równoczesnymi wywołaniami. AWS oferuje gotową bibliotekę `aws-lambda-powertools` z dekoratorem `@idempotent` obsługującym cały ten wzorzec automatycznie.

---

**L-E14**

**P:** Co to jest Lambda Power Tuning i jak optymalizować konfigurację pamięci?

**O:** Lambda Power Tuning to narzędzie AWS (open source, wdrożone jako Step Functions) które testuje funkcję przy różnych poziomach pamięci (128 MB, 256 MB, 512 MB, itd.) i wizualizuje kompromis między kosztami a wydajnością. Zaskakujący fakt: zwiększenie pamięci często *obniża* koszt, bo CPU skaluje proporcjonalnie — funkcja kończy szybciej i czas-płatny jest krótszy. Zasada: (1) Uruchom Power Tuning z reprezentatywnym eventem. (2) Wybierz "balanced" jeśli koszt i czas są równo ważne, lub "cost" jeśli optymalizujesz tylko koszt. (3) Szczególnie duży efekt dla CPU-bound funkcji (transformacje danych, szyfrowanie) — może dać 60%+ oszczędności. Dla I/O-bound funkcji (czekających na DB/HTTP) wzrost CPU nie pomaga tyle, ale więcej pamięci nadal przyspiesza inicjalizację JVM (Java) lub ładowanie bundla.

---

**L-E15**

**P:** Jak obsługujesz zmienne środowiskowe z sekretami w Lambda? Wymień hierarchię bezpieczeństwa.

**O:** Cztery podejścia od najmniej do najbardziej bezpiecznego: (1) **Zmienne środowiskowe plaintext** — szyfrowane przez KMS w spoczynku, ale widoczne w konsoli AWS dla każdego z dostępem do lambdy. Akceptowalne dla wartości niewrażliwych (URL API, timeouty). (2) **Zmienne środowiskowe szyfrowane Customer Managed Key** — używasz własnego klucza KMS zamiast domyślnego AWS; tylko role z uprawnieniami do tego klucza mogą odszyfrować wartości. Lepsza izolacja. (3) **AWS Systems Manager Parameter Store** — przechowujesz sekrety jako `SecureString`; Lambda pobiera je przez SDK przy starcie lub w runtime. Wersjonowanie, polityki dostępu IAM per parametr. Bezpłatny dla standardowych parametrów. (4) **AWS Secrets Manager** — dedykowane narzędzie do sekretów: automatyczna rotacja (np. hasło RDS co 30 dni), automatyczne propagowanie do Lambda która sekret zużywa, audyt dostępu przez CloudTrail. Droższe (0,40 USD/sekret/miesiąc) ale zalecane dla poświadczeń DB i kluczy API. Najlepsza praktyka: pobieraj sekrety w fazie Init (poza handlerem) i cachuj w zmiennej modułu — jeden odczyt na ciepłe środowisko, nie per wywołanie.

---

## Część 2 — Node.js

---

### Zaawansowane koncepcje

**N-E1**

**P:** Wyjaśnij szczegółowo fazy pętli zdarzeń Node.js: timers, pending callbacks, idle/prepare, poll, check, close callbacks.

**O:** Pętla zdarzeń ma sześć faz wykonywanych cyklicznie: (1) **Timers** — wykonuje callbacki `setTimeout` i `setInterval` których czas minął. Nie wykonuje się dokładnie w ustalonym czasie — tylko jeśli pętla dotarła do tej fazy po upływie czasu. (2) **Pending callbacks** — wykonuje callbacki I/O odroczone do następnej iteracji (np. błędy TCP). (3) **Idle/Prepare** — używane wewnętrznie przez Node. (4) **Poll** — kluczowa faza: pobiera nowe zdarzenia I/O (dane z sieci, odczyty plików) i wykonuje ich callbacki. Blokuje się tu jeśli kolejka jest pusta i nie ma zaplanowanych timerów, czekając na nowe I/O. (5) **Check** — wykonuje callbacki `setImmediate`. Zawsze po fazie Poll, więc `setImmediate` gwarantuje wykonanie po bieżącej iteracji I/O. (6) **Close callbacks** — callbacki dla zdarzeń `close` (np. `socket.on('close')`). Po każdej fazie pętla sprawdza kolejkę mikrozadań (Promise `.then()`, `queueMicrotask()`) i opróżnia ją całkowicie zanim przejdzie do następnej fazy.

---

**N-E2**

**P:** Co to są Worker Threads w Node.js i kiedy ich użyjesz?

**O:** Worker Threads (`worker_threads` moduł) to mechanizm tworzenia prawdziwych wątków OS w Node.js, każdy z własną izolowaną instancją V8 i pętlą zdarzeń. Komunikacja między wątkami przez `postMessage()` / `on('message')` lub `SharedArrayBuffer` dla bezpośredniego dostępu do pamięci. Użyj Worker Threads gdy: masz CPU-intensive task (szyfrowanie, kompresja, parsowanie dużych JSON, obliczenia matematyczne) który blokuje event loop — oddeleguj do workera, główny wątek zostaje responsywny. Nie używaj dla I/O: `fs`, `http`, `net` są już asynchroniczne i obsługiwane przez libuv's thread pool — worker thread tu nic nie pomaga. Praktyczna wskazówka: stwórz pulę workerów (jak `piscina` library) zamiast tworzyć/niszczyć wątki per zadanie — koszt inicjalizacji V8 jest wysoki. Alternatywa dla prostszych przypadków: `child_process.fork()` (osobny proces Node, IPC przez pipe) — lepsza izolacja błędów kosztem większego narzutu pamięci.

---

**N-E3**

**P:** Czym jest clustering w Node.js i jak różni się od Worker Threads?

**O:** `cluster` moduł tworzy wiele procesów Node (forks) współdzielących ten sam port TCP — primary process zarządza workerami, każdy worker ma własną pętlę zdarzeń i pamięć. System operacyjny lub primary process rozdziela połączenia przychodzące między workerami (round-robin lub SO_REUSEPORT). Różnica od Worker Threads: Cluster tworzy osobne procesy Node z własną pamięcią heap (brak współdzielonego stanu bez IPC), Worker Threads to wątki w tym samym procesie (mogą współdzielić SharedArrayBuffer). Kiedy używać Cluster: serwer webowy na maszynie wielordzeniowej — domyślnie Node używa jednego rdzenia, `cluster.fork()` per CPU pozwala w pełni wykorzystać hardware. W praktyce `pm2` (process manager) obsługuje clustering automatycznie przez `pm2 start app.js -i max`. Na Railway / ECS preferuj skalowanie poziome (wiele kontenerów) zamiast clusteru — łatwiejsze zarządzanie.

---

**N-E4**

**P:** Jak działa Node.js Garbage Collector i jakie są typowe przyczyny wycieków pamięci w aplikacjach Node?

**O:** Node.js używa silnika V8 z generacyjnym garbage collectorem: (1) **Young generation** (Scavenger) — szybki, zatrzymuje świat na ~1ms; zbiera krótkotrwałe obiekty. (2) **Old generation** (Mark-Sweep/Mark-Compact) — wolniejszy, zbiera obiekty które przetrwały Young generation. GC uruchamia się automatycznie, ale można do niego zajrzeć przez `--expose-gc` + `global.gc()`. Typowe wycieki pamięci w Node: (1) **Nieusunięte event listenery** — `emitter.on('event', fn)` bez `.removeListener()` trzyma referencje do fn i jej closury. (2) **Globalne zmienne/cache** — `global.cache = {}` rośnie w nieskończoność bez limitu/TTL. (3) **Zamknięcia trzymające duże struktury** — callback trzyma referencję do dużego bufforu przez closure nawet po zakończeniu operacji. (4) **Timers bez clearTimeout** — `setTimeout` / `setInterval` trzymają callback żywy. Diagnoza: `process.memoryUsage()`, `--inspect` + Chrome DevTools heap snapshot, `node --heap-prof`.

---

**N-E5**

**P:** Jak poprawnie pisać testy jednostkowe dla kodu asynchronicznego Node.js w Jest?

**O:** Trzy wzorce: (1) **async/await** — najprostszy; funkcja testu jest `async`, asercje po `await`:
```javascript
test('pobiera użytkownika', async () => {
  const user = await userService.findById(1);
  expect(user.name).toBe('Anna');
});
```
(2) **Zwracanie Promise** — Jest czeka na zwrócony Promise:
```javascript
test('pobiera użytkownika', () => {
  return userService.findById(1).then(user => {
    expect(user.name).toBe('Anna');
  });
});
```
(3) **done callback** — dla starszych API opartych na callbackach:
```javascript
test('pobiera użytkownika', (done) => {
  userService.findById(1, (err, user) => {
    expect(user.name).toBe('Anna');
    done();
  });
});
```
Zawsze ustaw `jest.setTimeout(10000)` dla testów integracyjnych z realnym I/O. Mockuj zewnętrzne zależności przez `jest.spyOn()` lub `jest.mock()` — nigdy nie testuj z realną bazą danych w teście jednostkowym. Ważne: `expect.assertions(n)` gwarantuje że asercje się wykonały — chroni przed testami które przechodzą bo Promise nigdy nie dotarł do asercji.

---

**N-E6**

**P:** Czym jest CORS i jak go poprawnie skonfigurować w aplikacji Express/NestJS?

**O:** CORS (Cross-Origin Resource Sharing) to mechanizm bezpieczeństwa przeglądarek — przeglądarka blokuje żądania XHR/fetch z domeny A do domeny B, chyba że serwer B odpowie nagłówkami CORS zezwalającymi na to. Kluczowe nagłówki: `Access-Control-Allow-Origin` (która domena może wywoływać), `Access-Control-Allow-Methods` (dozwolone metody HTTP), `Access-Control-Allow-Headers` (dozwolone nagłówki żądania), `Access-Control-Allow-Credentials` (czy wysyłać cookies). W Express: `app.use(cors({ origin: 'https://twoja-domena.pl', credentials: true }))`. W NestJS: `app.enableCors({ origin: process.env.FRONTEND_URL, credentials: true })`. Pułapki: (1) `origin: '*'` nie działa z `credentials: true` — musisz podać konkretną domenę; (2) dla preflight (`OPTIONS`) serwer musi odpowiadać 204 z nagłówkami CORS zanim przeglądarka wyśle właściwe żądanie; (3) na Railway/Vercel — `FRONTEND_URL` w env vars musi być dokładnie tą domeną łącznie ze schema (`https://`), bez trailing slash.

---

**N-E7**

**P:** Co to jest rate limiting i jak zaimplementować go w API Node.js?

**O:** Rate limiting ogranicza liczbę żądań jakie klient może wysłać w określonym czasie — chroni przed DDoS, brute-force (logowanie), scrapingiem i nieintencjonalnym przeciążeniem. W Express przez `express-rate-limit`:
```javascript
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minut
  max: 100, // 100 żądań na window
  standardHeaders: true, // Zwraca X-RateLimit-* nagłówki
  legacyHeaders: false,
  keyGenerator: (req) => req.ip, // lub req.user?.id po auth
  handler: (req, res) => res.status(429).json({ error: 'Zbyt wiele żądań' })
});
app.use('/api/', limiter);
```
Dla ograniczenia per użytkownik (nie per IP): użyj `keyGenerator` zwracającego `userId` po przejściu przez middleware auth. W środowisku multi-instancyjnym stan (`windowMs` counter) musi być współdzielony — użyj Redis store (`rate-limit-redis`) zamiast domyślnego przechowywania w pamięci procesu, bo każda instancja ma własne liczniki. NestJS ma `@nestjs/throttler` jako dedykowany moduł z podobnymi opcjami i dekoratorami per endpoint.

---

**N-E8**

**P:** Jak poprawnie zarządzać połączeniami do bazy danych PostgreSQL w aplikacji Node.js/NestJS?

**O:** Kluczowe zasady: (1) **Jeden pool na aplikację** — nie twórz nowego klienta `pg` per żądanie. PostgreSQL ma limit połączeń (~100 na instancji Supabase free tier). Prisma i TypeORM mają wbudowany pool; dostosuj `connection_limit` i `pool_timeout` w connection string. (2) **PgBouncer / RDS Proxy** — dodatkowy pooler między aplikacją a DB; szczególnie ważne dla Lambda (tysiące krótkotrwałych środowisk) i wielu replik Railway. (3) **Właściwa obsługa błędów** — owijaj operacje DB w try/catch, loguj błąd z query info (bez danych użytkownika), zwracaj czyste komunikaty klientowi. (4) **Connection leaks** — zawsze zwalniaj połączenia po użyciu; z Prisma jest to automatyczne przy `$disconnect()` (ale nie wywołuj go per request — tylko przy zamknięciu aplikacji). (5) **Graceful shutdown** — przy `SIGTERM` zakończ otwarte żądania, potem wywołaj `prisma.$disconnect()` lub `pool.end()` — nie ubijaj procesu z otwartymi transakcjami. W NestJS: `onApplicationShutdown()` lifecycle hook to właściwe miejsce.

---

**N-E9**

**P:** Co to jest TypeScript i jakie konkretne korzyści daje w projekcie Node.js/NestJS?

**O:** TypeScript to nadzbiór JavaScript z opcjonalnym statycznym typowaniem, kompilowany do JS. Konkretne korzyści w projekcie backend: (1) **Wykrywanie błędów w czasie kompilacji** — `Cannot read properties of undefined` to najczęstszy runtime error w JS; TypeScript wyłapuje go przy pisaniu kodu. (2) **Autocomplete i nawigacja** — IDE zna typ każdej zmiennej, metody klasy, pól obiektu — ogromna produktywność przy dużych codebasach. (3) **Bezpieczny refaktoring** — zmiana nazwy metody lub sygnatury funkcji powoduje błędy kompilacji wszędzie gdzie jest używana. (4) **Dokumentacja przez typy** — `function createOrder(userId: string, items: OrderItemDto[]): Promise<Order>` jest bardziej czytelna niż JSDoc. (5) **Integracja z NestJS** — dekoratory (`@Injectable`, `@Controller`, `@Get`) działają tylko z TS; DTO z class-validator, Prisma client — wszystko oparte na typach. Ograniczenia: dodatkowy krok kompilacji, learning curve dla devteamu, `any` jako escape hatch może wprowadzać dziury w systemie typów — pilnuj `noImplicitAny: true` w tsconfig.

---

**N-E10**

**P:** Jak działa uwierzytelnianie JWT w Node.js — proces od logowania do weryfikacji tokenu?

**O:** Pełny flow: (1) **Logowanie** — użytkownik wysyła `{email, password}`, serwer pobiera record z DB, porównuje hash bcrypt, generuje access token (JWT podpisany `HMAC-SHA256` lub `RS256` z `iat`, `exp`, `userId`, `role`) i refresh token (długożyjący, zapisany jako hash SHA-256 w DB). (2) **Struktura JWT** — trzy base64url-enkodowane segmenty: `header.payload.signature`. Header: `{"alg":"HS256","typ":"JWT"}`. Payload: `{"sub":"123","role":"USER","iat":..., "exp":...}`. Signature: `HMAC(header + '.' + payload, secret)`. Token nie jest szyfrowany — tylko podpisany; każdy może odczytać payload, ale nie może zmodyfikować bez znajomości sekretu. (3) **Weryfikacja** — `jsonwebtoken.verify(token, secret)` sprawdza podpis i `exp`. W NestJS: `JwtStrategy` (Passport) robi to automatycznie w `@UseGuards(JwtAuthGuard)`. (4) **Odświeżanie** — na 401 klient wysyła refresh token (httpOnly cookie), serwer weryfikuje go przez lookup w DB (hash), wydaje nowy access token, opcjonalnie rotuje refresh token. (5) **Wylogowanie** — usuń refresh token z DB; access token jest bezstanowy i nie może być "cofnięty" do wygaśnięcia — stąd krótkie TTL (15 min).

---

**N-E11**

**P:** Co to jest pnpm i jakie ma przewagi nad npm/yarn?

**O:** pnpm (Performant npm) to menedżer pakietów Node z trzema kluczowymi różnicami: (1) **Content-addressable store** — zamiast kopiować pakiety do każdego `node_modules`, pnpm tworzy twarde dowiązania (hard links) do globalnego store (`~/.pnpm-store`). Jeśli 10 projektów używa `react@18.2.0`, jest on przechowywany raz, a każdy projekt ma hard link do tej samej lokalizacji. Oszczędność miejsca: gigabajty. (2) **Phantom dependencies** — npm/yarn "hoistuje" zależności do głównego `node_modules`, więc możesz `require('express')` nawet jeśli go nie masz w swoim `package.json` bo zależy od niego inna paczka. pnpm izoluje zależności — dostęp tylko do tego co zadeklarujesz. Wyłapuje ukryte błędy zależności. (3) **Monorepo support** — `pnpm workspaces` + `workspace:*` protokół do wewnętrznych zależności. `pnpm --filter backend build` uruchamia script tylko w wybranym pakiecie. Szybkość: instalacja jest szybsza od npm (równoległa, bez zbędnych operacji FS) i porównywalna z yarn berry. Używany w tym projekcie (fragrance store monorepo).

---

**N-E12**

**P:** Jak zaimplementować obsługę błędów na poziomie całej aplikacji Express/NestJS, żeby żaden błąd nie "wyciekł" do klienta z pełnym stack trace?

**O:** W Express: (1) Globalny error-handling middleware musi mieć cztery parametry `(err, req, res, next)` i być zarejestrowany **po wszystkich routach**: 
```javascript
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const isProd = process.env.NODE_ENV === 'production';
  logger.error({ err, requestId: req.id });
  res.status(status).json({
    error: isProd ? 'Internal Server Error' : err.message,
    ...(isProd ? {} : { stack: err.stack })
  });
});
```
(2) Dla `async` routehandlerów musisz wywołać `next(err)` — lub użyć `express-async-errors`. W NestJS: domyślny `ExceptionFilter` mapuje `HttpException` na odpowiedź; dla nieobsługiwanych błędów możesz napisać `AllExceptionsFilter` z `@Catch()` który loguje i zwraca bezpieczny komunikat. Kluczowe zasady: (a) nigdy nie wysyłaj stack trace w produkcji, (b) loguj pełny błąd po stronie serwera, (c) zwracaj `requestId` klientowi żeby można było skorelować error report z logiem, (d) rozróżniaj błędy operacyjne (złe wejście, nie znaleziono) od programistycznych (null pointer) — te drugie zawsze powinny dawać 500.

---

**N-E13**

**P:** Co to jest `EventEmitter` w Node.js i jak go używać bezpiecznie?

**O:** `EventEmitter` to implementacja wzorca Observer — obiekty mogą emitować nazwane zdarzenia i nasłuchiwać na nie. Podstawowe API: `emitter.on('event', listener)`, `emitter.emit('event', data)`, `emitter.removeListener('event', listener)`. Używany wszędzie w Node: HTTP server, streams, process (`process.on('uncaughtException')`). Pułapki bezpieczeństwa: (1) **Memory leak** — domyślnie Node ostrzega gdy > 10 listenerów jest podpiętych do jednego zdarzenia (wbudowana ochrona). Ustaw `emitter.setMaxListeners(0)` żeby wyłączyć ostrzeżenie jeśli to celowe. Zawsze usuwaj listenery gdy nie są potrzebne: `emitter.removeListener()` lub `emitter.once()` dla jednorazowych. (2) **Błędy w listenerach** — nieobsłużony wyjątek wewnątrz listenera propaguje przez `throw` i może crash'ować proces. Zawsze owijaj logikę listenera w try/catch. (3) **Zdarzenie 'error'** — jeśli emiter emituje zdarzenie 'error' bez podpiętego listenera, Node rzuca uncaught exception. Zawsze dodaj `emitter.on('error', handler)` dla emiterów mogących produkować błędy.

---

**N-E14**

**P:** Jak poprawnie obsługiwać graceful shutdown w aplikacji Node.js/NestJS?

**O:** Graceful shutdown to zakończenie serwera bez przerywania aktywnych żądań. Kroki: (1) **Przechwytaj sygnały** — `process.on('SIGTERM', gracefulShutdown)` i `process.on('SIGINT', gracefulShutdown)`. Railway/Docker wysyłają `SIGTERM` przed ubiciiem kontenera (30s okno). (2) **Zatrzymaj przyjmowanie nowych połączeń** — `server.close(callback)` — przestaje akceptować nowe, czeka aż istniejące się zakończą. (3) **Zamknij połączenia DB** — `prisma.$disconnect()` lub `pool.end()` po zakończeniu `server.close`. (4) **Zakończ worker processes** — jeśli masz BullMQ workers, wywołaj `worker.close()` żeby nie porzucić aktywnych jobów w połowie. W NestJS: `app.enableShutdownHooks()` + `onApplicationShutdown()` lifecycle hook w serwisach obsługuje to czysto. Timeout: po 30s wymuś exit (`process.exit(1)`) żeby nie czekać w nieskończoność na "wiszące" połączenia.

---

**N-E15**

**P:** Co to jest pipe, filter i interceptor w NestJS i jakie są ich zastosowania?

**O:** Trzy mechanizmy w potoku żądania NestJS: (1) **Pipe** — transformuje lub waliduje dane wejściowe przed dotarciem do handlera. Wbudowane: `ParseIntPipe`, `ValidationPipe` (class-validator DTO). Własne: implementuj `PipeTransform<T, R>`. Przykład: `@Param('id', ParseIntPipe)` — rzuca `400 Bad Request` jeśli `id` nie jest liczbą całkowitą. (2) **Filter** — przechwytuje wyjątki rzucone w handlerze lub serwisie i transformuje je na odpowiedź HTTP. `@Catch(HttpException)` dla konkretnych typów lub `@Catch()` dla wszystkich. Dodaje się per endpoint, per kontroler lub globalnie (`app.useGlobalFilters()`). (3) **Interceptor** — implementuje `NestInterceptor` z metodą `intercept(context, next)`. Może: logować czas odpowiedzi, transformować dane wyjściowe (np. owijać w `{ data: ... }`), cache'ować odpowiedzi, timeout'ować powolne wywołania. Kolejność wykonania: Middleware → Guard → Interceptor (przed) → Pipe → Handler → Interceptor (po) → Filter (przy błędzie).

---

## Część 3 — Angular

---

### Nowe funkcje Angular 17–18

**A-E1**

**P:** Co to jest nowa składnia control flow `@if`, `@for`, `@switch` w Angular 17+ i jakie ma przewagi nad dyrektywami strukturalnymi?

**O:** Angular 17 wprowadził wbudowaną składnię control flow jako alternatywę dla `*ngIf`, `*ngFor`, `*ngSwitch`. Składnia:
```html
@if (user.isAdmin) {
  <admin-panel />
} @else if (user.isPremium) {
  <premium-panel />
} @else {
  <basic-panel />
}

@for (item of items; track item.id) {
  <li>{{ item.name }}</li>
} @empty {
  <li>Brak elementów</li>
}
```
Przewagi nad dyrektywami: (1) **Mniejszy rozmiar bundla** — nie wymaga importowania `CommonModule` ani `NgIf`/`NgFor` w standalone components; compiler inlinuje logikę. (2) **Czytelniejsza składnia** — `@else` zamiast `*ngIf="!condition"` na osobnym elemencie z `ng-template`. (3) **Wymagany `track`** — `@for` wymusza podanie `track`, co eliminuje błąd braku identity tracking. (4) **`@empty` block** — natywne wsparcie dla pustej listy zamiast dodatkowego `*ngIf="items.length === 0"`. (5) **Lepsza type inference** — kompilator Angular lepiej typuje zmienne wewnątrz bloków (np. `@if (item !== null) { item.name }` — TypeScript wie że `item` nie jest null).

---

**A-E2**

**P:** Co to jest blok `@defer` w Angular 17+ i jakie ma opcje wyzwalania?

**O:** `@defer` leniwie ładuje komponenty, dyrektywy i pipe'y owijając je w oddzielny chunk JS pobierany tylko gdy spełniony jest warunek. Składnia:
```html
@defer (on viewport) {
  <heavy-chart-component />
} @placeholder {
  <div>Ładowanie wykresu...</div>
} @loading (minimum 200ms) {
  <spinner />
} @error {
  <p>Nie udało się załadować wykresu</p>
}
```
Dostępne wyzwalacze: `on idle` (gdy przeglądarka jest bezczynna), `on viewport` (gdy element wchodzi w widok), `on interaction` (klik/hover na placeholder), `on hover`, `on immediate` (jak najszybciej, ale asynchronicznie), `on timer(2s)` (po opóźnieniu), `when condition` (po spełnieniu wyrażenia). `prefetch on idle` pobiera chunk w tle bez renderowania. Zastosowania: wykresy, mapy, ciężkie editory, sekcje below-the-fold — wszystko co nie musi być dostępne od razu.

---

**A-E3**

**P:** Jak działają Angular Signals w praktyce? Wyjaśnij `signal()`, `computed()`, `effect()`.

**O:** Signals to reaktywny system stanu wprowadzony stabilnie w Angular 17: (1) **`signal(initialValue)`** — tworzy writable signal. Odczyt: `count()` (wywołanie jako funkcja). Zapis: `count.set(5)`, `count.update(v => v + 1)`, `count.mutate(arr => arr.push(item))`. (2) **`computed(fn)`** — readonly signal wyliczany lazily na podstawie innych signals. Angular automatycznie śledzi zależności — przelicza tylko gdy któryś dependency signal się zmieni:
```typescript
const total = computed(() => items().reduce((s, i) => s + i.price, 0));
```
(3) **`effect(fn)`** — uruchamia efekt uboczny gdy dowolny signal użyty wewnątrz się zmieni. Podobne do `subscribe` dla Observables, ale automatyczna śledzenie zależności:
```typescript
effect(() => {
  localStorage.setItem('cart', JSON.stringify(cart()));
});
```
Effects muszą być tworzone w injection context (konstruktor, `inject()`). Kluczowe różnice od Observables: signals są synchroniczne, zawsze mają wartość (nie możesz mieć `undefined` dopóki nie zainicjalizujesz), automatyczne unsubscribe w `effect`, brak operatorów — do transformacji używaj `computed`.

---

**A-E4**

**P:** Co to jest `DestroyRef` i jak go używać razem z `takeUntilDestroyed()`?

**O:** `DestroyRef` to token DI (Angular 16+) dający dostęp do lifecycle destroy bez implementowania `OnDestroy`. Można go wstrzyknąć w dowolnym injection context — konstruktorze, factory function, podczas inicjalizacji serwisu. API: `destroyRef.onDestroy(() => cleanup())`. `takeUntilDestroyed(destroyRef?)` to operator RxJS który używa `DestroyRef` pod spodem:
```typescript
// W komponencie — automatycznie pobiera DestroyRef
this.service.data$.pipe(
  takeUntilDestroyed()
).subscribe(data => this.data = data);

// Poza injection context — przekaż destroyRef jawnie
const destroyRef = inject(DestroyRef);
someStream$.pipe(takeUntilDestroyed(destroyRef)).subscribe(...);
```
Przewaga nad `Subject + takeUntil + ngOnDestroy`: zero boilerplate — nie musisz deklarować `private destroy$ = new Subject<void>()`, nie musisz implementować `OnDestroy`, operator sam wie kiedy komponent jest niszczony. Ważne: `takeUntilDestroyed()` musi być wywołany w injection context (lub przekaż `destroyRef` jawnie do użycia poza nim).

---

**A-E5**

**P:** Co to jest Angular CDK (Component Dev Kit) i kiedy po niego sięgnąć?

**O:** CDK to biblioteka prymitywów UI bez narzuconego stylu — abstrahuje złożone zachowania interaktywne, pozwalając budować własne komponenty bez implementowania od zera. Kluczowe moduły: (1) **Overlay** — pozycjonowanie popupów/tooltipów/dropdownów z automatyczną obsługą viewport (flip, offset); podstawa Angular Material dialogs/selects. (2) **DragDrop** — drag and drop między listami, sortowanie; `cdkDragHandle`, `cdkDropList`. (3) **Virtual Scrolling** — renderuje tylko widoczne wiersze dużych list (`CdkVirtualScrollViewport`); kluczowe dla list 10k+ elementów. (4) **A11y** — `FocusTrap`, `LiveAnnouncer` dla czytników ekranu, `AriaDescriber`. (5) **Portal** — renderowanie komponentu w dowolnym miejscu DOM (poza drzewem komponentu). (6) **Table/Selection** — DataSource abstraction, `SelectionModel` do zaznaczania wierszy. Zasada: jeśli Angular Material nie pasuje stylowo lub chcesz własny design system, CDK daje Ci zachowanie bez wyglądu.

---

**A-E6**

**P:** Jak testować komponenty Angular z TestBed — wyjaśnij konfigurację i mockowanie serwisów?

**O:** Pełny przykład testu komponentu ze standalone setup:
```typescript
describe('ProductCardComponent', () => {
  let component: ProductCardComponent;
  let fixture: ComponentFixture<ProductCardComponent>;
  let cartService: jasmine.SpyObj<CartService>;

  beforeEach(async () => {
    const spy = jasmine.createSpyObj('CartService', ['addItem']);
    
    await TestBed.configureTestingModule({
      imports: [ProductCardComponent], // standalone component
      providers: [
        { provide: CartService, useValue: spy }
      ]
    }).compileComponents();

    cartService = TestBed.inject(CartService) as jasmine.SpyObj<CartService>;
    fixture = TestBed.createComponent(ProductCardComponent);
    component = fixture.componentInstance;
    component.product = mockProduct; // @Input
    fixture.detectChanges();
  });

  it('dodaje produkt do koszyka po kliknięciu', () => {
    const button = fixture.nativeElement.querySelector('[data-testid="add-to-cart"]');
    button.click();
    expect(cartService.addItem).toHaveBeenCalledWith(mockProduct);
  });
});
```
Kluczowe: `fixture.detectChanges()` wyzwala `ngOnInit` i CD; `fixture.debugElement.query(By.css('...'))` bezpieczniejszy niż `nativeElement.querySelector`; dla async operacji używaj `fakeAsync + tick()` lub `async + whenStable()`.

---

**A-E7**

**P:** Co to są Content Projection i `ng-content` oraz jak działają wielokrotne sloty projekcji?

**O:** Content projection pozwala przekazać szablony HTML z zewnątrz do wnętrza komponentu — komponent definiuje "sloty" przez `<ng-content>`, a rodzic "wkłada" treść między tagi komponentu. Wielokrotne sloty przez selektor `select`:
```html
<!-- W komponencie Card -->
<div class="card">
  <div class="card-header">
    <ng-content select="[card-title]"></ng-content>
  </div>
  <div class="card-body">
    <ng-content></ng-content> <!-- domyślny slot -->
  </div>
  <div class="card-footer">
    <ng-content select="[card-actions]"></ng-content>
  </div>
</div>

<!-- Użycie -->
<app-card>
  <h2 card-title>Tytuł produktu</h2>
  <p>Opis produktu...</p>
  <button card-actions>Kup teraz</button>
</app-card>
```
`ContentChild`/`ContentChildren` dekoratory pozwalają komponentowi hostowi uzyskać referencje do projektowanych elementów. Różnica od `ViewChild`: `ViewChild` odpytuje własny szablon komponentu, `ContentChild` odpytuje projektowaną zawartość z zewnątrz.

---

**A-E8**

**P:** Czym są Pure i Impure Pipes w Angular i kiedy użyjesz Impure?

**O:** **Pure pipe** (domyślne `pure: true`) jest wywoływany tylko gdy Angular wykryje zmianę referencji lub prymitywu w argumentach wejściowych — nie przelicza przy mutacji tablicy/obiektu. To ogromna optymalizacja wydajności. Przykład: `DatePipe`, `CurrencyPipe`, własny `TruncatePipe`. **Impure pipe** (`pure: false`) jest wywoływany przy każdym cyklu change detection, niezależnie od zmian inputu — może znacząco spowalniać aplikację. Kiedy użyć: (1) `AsyncPipe` jest impure — musi sprawdzać nowe emisje Observable co każdy CD cycle; (2) własny pipe filtrujący tablicę mutowaną in-place (zamiast tego lepiej użyć immutable update + pure pipe); (3) pipe zależny od globalnego stanu (bieżąca data, i18n locale) — zmienia wartość bez zmiany inputu. Zasada: unikaj impure pipes w krytycznych ścieżkach rendering. Jeśli potrzebujesz reaktywności na mutacje — wróć do Observable/Signal zamiast impure pipe.

---

**A-E9**

**P:** Jak działa Angular Router w trybie hash vs HTML5 (PathLocationStrategy)?

**O:** **HTML5 LocationStrategy** (domyślna) używa History API przeglądarki — URL wygląda jak `/products/123`, przeglądarka nie wysyła żądania do serwera przy nawigacji SPA. Problem: bezpośrednie wejście na `/products/123` lub odświeżenie strony wysyła żądanie HTTP na ten URL do serwera — który musi zwrócić `index.html` (fallback routing). Konfiguracja: Nginx `try_files $uri /index.html`, Vercel `rewrites`, AWS S3 `error document = index.html`. **HashLocationStrategy** dodaje `#` przed ścieżką: `/#/products/123`. Hash nie jest wysyłany do serwera, więc odświeżenie zawsze trafia na `index.html`. Brak konfiguracji serwera. Minus: wygląda brzydziej, problemy z SEO (część crawlerów ignoruje hash). Jak zmienić: `provideRouter(routes, withHashLocation())`. Zalecenie: zawsze używaj HTML5 z właściwie skonfigurowanym serwerem — clean URLs i lepszy SEO.

---

**A-E10**

**P:** Co to jest `NgZone` i czym jest zoneless Angular?

**O:** `NgZone` to wrapper Angular nad `zone.js` — bibliotekę patchującą browser API (setTimeout, Promise, XHR, addEventListener) żeby poinformować Angular gdy coś asynchronicznego się wydarzyło i należy uruchomić change detection. Bez zone.js Angular nie wiedziałby kiedy odświeżyć widok. **Zoneless Angular** (eksperymentalne w Angular 18, stabilne planowane w 19) eliminuje zone.js całkowicie — zamiast globalnego patching, Angular bazuje wyłącznie na: Signals, `markForCheck()`, `AsyncPipe`. Korzyści zoneless: (1) mniejszy bundle (zone.js to ~30KB gzipped); (2) lepszy debugger experience (brak "magicznej" interceptacji callów); (3) lepsza kompatybilność z micro-frontends (zone.js globalnie patchuje — dwa Angular apps na stronie mogą się blokować); (4) przewidywalne zachowanie CD. Migracja: dodaj `provideExperimentalZonelessChangeDetection()` i stopniowo konwertuj komponenty na Signals. `NgZone.run()` jest potrzebny gdy integrujesz biblioteki zewnętrzne poza Angular — bez zone.js musisz używać `ChangeDetectorRef.markForCheck()` ręcznie.

---

**A-E11**

**P:** Jak zaimplementować własną dyrektywę atrybutu i czym różni się od dyrektywy strukturalnej?

**O:** **Dyrektywa atrybutu** modyfikuje wygląd lub zachowanie elementu bez zmiany struktury DOM:
```typescript
@Directive({ selector: '[appHighlight]', standalone: true })
export class HighlightDirective {
  @Input() appHighlight = 'yellow';
  
  constructor(private el: ElementRef, private renderer: Renderer2) {}
  
  @HostListener('mouseenter') onEnter() {
    this.renderer.setStyle(this.el.nativeElement, 'backgroundColor', this.appHighlight);
  }
  @HostListener('mouseleave') onLeave() {
    this.renderer.removeStyle(this.el.nativeElement, 'backgroundColor');
  }
}
```
**Dyrektywa strukturalna** zmienia strukturę DOM — dodaje/usuwa/podmienia węzły. Używa `*` prefiksu będącego cukrem syntaktycznym nad `ng-template`. Implementuje `TemplateRef` i `ViewContainerRef`:
```typescript
@Directive({ selector: '[appUnless]', standalone: true })
export class UnlessDirective {
  @Input() set appUnless(condition: boolean) {
    if (!condition) {
      this.vc.createEmbeddedView(this.template);
    } else {
      this.vc.clear();
    }
  }
  constructor(private template: TemplateRef<any>, private vc: ViewContainerRef) {}
}
// Użycie: <div *appUnless="isLoggedIn">Zaloguj się</div>
```
Kluczowa różnica: atrybutowa działa na istniejącym elemencie, strukturalna operuje na `<ng-template>` który może być tworzony/usuwany z DOM.

---

**A-E12**

**P:** Czym jest Angular Universal / @angular/ssr i jak poprawnie zainicjalizować dane przed renderem serwera?

**O:** `@angular/ssr` (dawniej Angular Universal) umożliwia Server-Side Rendering — Angular renderuje HTML na serwerze Node.js zamiast tylko w przeglądarce. Inicjalizacja danych dla SSR: (1) **`APP_INITIALIZER`** — token DI wykonujący factory function zwracającą Promise/Observable przed bootstrapem. Problem: blokuje bootstrap aż dane zostaną pobrane; (2) **`TransferState`** — preferowane rozwiązanie. Serwer pobiera dane, serializuje do `<script type="application/json">` w HTML, przeglądarka odczytuje te dane przy re-hydratacji bez ponownego HTTP call:
```typescript
// Serwer / browser — wspólny kod w serwisie:
getProducts(): Observable<Product[]> {
  const key = makeStateKey<Product[]>('products');
  const cached = this.transferState.get(key, null);
  if (cached) return of(cached);
  return this.http.get<Product[]>('/api/products').pipe(
    tap(data => this.transferState.set(key, data))
  );
}
```
Alternatywa dla prostych przypadków: `httpTransferCacheInterceptor` z `@angular/ssr` automatycznie cachuje GET requesty między SSR a hydratacją bez ręcznego `TransferState`.

---

**A-E13**

**P:** Jak działa optymalizacja wydajności Angular pod kątem Core Web Vitals?

**O:** Kluczowe techniki dla LCP, CLS, INP: (1) **LCP (Largest Contentful Paint)** — prerender statycznych stron (Angular SSR), `preload` kluczowych assetów przez `<link rel="preload">`, `NgOptimizedImage` dla obrazów (automatyczny `loading="lazy"`, `srcset`, wykrywanie LCP image i dodawanie `fetchpriority="high"`); (2) **CLS (Cumulative Layout Shift)** — zawsze deklaruj wymiary obrazów (`width`/`height`), używaj `aspect-ratio` CSS, unikaj wstrzykiwania treści powyżej istniejącej; (3) **INP (Interaction to Next Paint)** — minimalizuj pracę w handlerach zdarzeń, używaj OnPush CD żeby Angular nie sprawdzał niezmienionego drzewa komponentów; `@defer` dla ciężkich komponentów below-the-fold; `scheduler.postTask()` lub `setTimeout(0)` żeby odroczyć niekrytyczne obliczenia po renderze; (4) **Bundle size** — lazy loading tras, tree-shaking (`sideEffects: false` w library packages), `source-map-explorer` do analizy bundla, usunięcie nieużywanych importów z Angular Material/CDK przez treeshakeable providers.

---

**A-E14**

**P:** Jak konfigurować environment-specific zmienne w Angular (nie używając `environment.ts`)?

**O:** Stary wzorzec `environment.ts` / `environment.prod.ts` z `fileReplacements` w `angular.json` nadal działa, ale ma wady: wymaga rebuild dla każdego środowiska, wartości są "zburnowane" w bundle (tajne dane nie nadają się tutaj). Nowoczesne alternatywy: (1) **Build-time injection przez `window.__env`** — serwer Node/Express wstrzykuje `window.__env = { apiUrl: '...' }` do HTML przed wysłaniem; Angular odczytuje przez `inject(DOCUMENT).defaultView.__env.apiUrl`. Pozwala zmieniać konfigurację bez rebuildu. (2) **Runtime config endpoint** — `APP_INITIALIZER` fetcher pobiera `/config.json` (statyczny plik serwowany przez nginx, nie w bundlu Angular) przed bootstrapem:
```typescript
export function configFactory(http: HttpClient) {
  return () => http.get('/assets/config.json').pipe(
    tap(config => AppConfig.set(config))
  ).toPromise();
}
```
(3) **Transfer State z SSR** — w przypadku Angular SSR backend może wstrzyknąć konfigurację per-request do Transfer State. Zasada: nigdy nie wkładaj sekretów API do Angular bundle — są widoczne w przeglądarce.

---

**A-E15**

**P:** Czym jest NgRx i kiedy jego użycie jest uzasadnione?

**O:** NgRx to implementacja wzorca Redux dla Angular — scentralizowany, niemutowalny store stanu aplikacji oparty na RxJS. Kluczowe elementy: **Store** (jedyne źródło prawdy), **Actions** (zdarzenia opisujące co się stało), **Reducers** (czyste funkcje `(state, action) => newState`), **Selectors** (memoizowane zapytania do store), **Effects** (obsługa efektów ubocznych jak HTTP). Kiedy NgRx się opłaca: (1) wiele niespokrewnionych komponentów potrzebuje dostępu do tego samego stanu i synchronizacji zmian; (2) złożone przepływy danych z wieloma aktorami (websocket + http + user interactions aktualizują ten sam model); (3) potrzeba time-travel debugging (Redux DevTools), replay zdarzeń, rehydratacji stanu z localStorage. Kiedy **nie** używać: dla lokalnego stanu komponentu używaj Signals lub serwisu z `BehaviorSubject`; dla stanu formularza używaj reactive forms; dla async data fetching i cache rozważ `@ngrx/component-store` (lżejszy) lub `TanStack Query` zamiast pełnego Store. Koszt NgRx: duży boilerplate, stroma krzywa uczenia, over-engineering dla małych aplikacji.

---

**A-E16**

**P:** Jak działa Angular's `HttpClient` pod maską i jakie ma opcje konfiguracyjne?

**O:** `HttpClient` to wrapper Angular nad `XMLHttpRequest` / `fetch` API z automatyczną serializacją/deserializacją JSON i obsługą Observables. Konfiguracja przez `provideHttpClient(...)`:
- `withInterceptors([...])` — funkyjne interceptory (Angular 15+, zalecane)
- `withFetch()` — używa `fetch` API zamiast XHR (Angular 18, ważne dla SSR bo Node ma fetch)
- `withRequestsMadeViaParent()` — dla child injector kontekstu
- `withJsonpSupport()` — JSONP support
- `withNoXsrfProtection()` — wyłącza domyślny XSRF interceptor

Zaawansowane opcje per-request:
```typescript
this.http.get<Product[]>('/api/products', {
  params: new HttpParams().set('category', 'perfumes'),
  headers: new HttpHeaders().set('X-Custom', 'value'),
  observe: 'response', // otrzymujesz HttpResponse z headers i status
  responseType: 'blob', // dla plików do pobrania
  context: new HttpContext().set(CACHE_TTL, 60) // custom context dla interceptorów
})
```
`HttpContext` to type-safe sposób przekazywania metadanych do interceptorów — lepsza alternatywa dla dodawania custom headers które mogą "wyciec" do zewnętrznych API.

---

## Część 4 — Architektura

---

### Wzorce projektowe i systemowe

**AR-E1**

**P:** Wyjaśnij zasady SOLID i podaj przykład każdej w kontekście NestJS.

**O:** (1) **Single Responsibility** — klasa ma jeden powód do zmiany. `OrdersService` obsługuje logikę zamówień; wysyłkę emaila deleguje do `EmailService`. Nie miesza HTTP z logiką domeny. (2) **Open/Closed** — otwarte na rozszerzenie, zamknięte na modyfikację. Zamiast `if (carrier === 'inpost') {...} else if (carrier === 'dhl') {...}` w jednym serwisie — interfejs `ICarrierService` z oddzielnymi implementacjami; nowy przewoźnik dodaje nową klasę, nie modyfikuje istniejących. (3) **Liskov Substitution** — każda podklasa musi być zastępowalna przez klasę bazową. Jeśli `AdminUser extends User`, każde miejsce które akceptuje `User` musi działać poprawnie z `AdminUser`. (4) **Interface Segregation** — małe, specjalizowane interfejsy zamiast jednego dużego. `IReadableStore` i `IWritableStore` zamiast jednego `IStore` z wszystkimi metodami. (5) **Dependency Inversion** — moduły wysokiego poziomu zależą od abstrakcji, nie konkretów. `OrdersService` wstrzykuje `IPaymentGateway`, nie bezpośrednio `StripeService` — łatwy mock w testach.

---

**AR-E2**

**P:** Co to jest wzorzec Repository i jak go zaimplementować z Prisma w NestJS?

**O:** Repository to warstwa abstrakcji między logiką domeny a bazą danych — enkapsuluje zapytania i operacje trwałości. Korzyści: logiką domenową jest odizolowana od ORM-a (Prisma), łatwy mock w testach (podstaw `FakeOrderRepository`), można zmienić ORM bez zmiany logiki domeny.
```typescript
// Interfejs
interface IOrderRepository {
  findById(id: string): Promise<Order | null>;
  findByUserId(userId: string, pagination: Pagination): Promise<Order[]>;
  save(order: CreateOrderDto): Promise<Order>;
  updateStatus(id: string, status: OrderStatus): Promise<void>;
}

// Implementacja
@Injectable()
class PrismaOrderRepository implements IOrderRepository {
  constructor(private prisma: PrismaService) {}
  findById(id: string) {
    return this.prisma.order.findUnique({ where: { id }, include: { items: true } });
  }
  // ...
}

// Rejestracja
{ provide: 'IOrderRepository', useClass: PrismaOrderRepository }
```
W małych projektach Repository bywa over-engineeringiem — Prisma jest już dobrym query builderem. Uzasadniony gdy: masz złożone zapytania wymagające testowania jednostkowego bez DB lub planujesz zmianę ORM.

---

**AR-E3**

**P:** Co to jest wzorzec CQRS i kiedy warto go zastosować?

**O:** CQRS (Command Query Responsibility Segregation) rozdziela operacje odczytu (Query) od zapisu (Command) — mogą używać różnych modeli, serwisów, a nawet różnych baz danych. **Command** — zmienia stan, nie zwraca danych (`PlaceOrderCommand`). **Query** — zwraca dane, nie zmienia stanu (`GetOrderDetailsQuery`). Kiedy CQRS się opłaca: (1) asymetria read/write (99% traffic to odczyty — oddzielna baza read-only replica zoptymalizowana pod queries); (2) złożone reguły domeny przy zapisie (walidacja, agregaty domenowe) vs. proste denormalizowane widoki przy odczycie; (3) Event Sourcing — naturalnie paruje się z CQRS. NestJS CQRS: `@nestjs/cqrs` moduł z `CommandBus.execute(new PlaceOrderCommand(...))` i QueryBus. Ostrzeżenie: CQRS znacząco komplikuje architekturę. Dla większości aplikacji CRUD jest to nadmierna inżynieria — uzasadniony przy naprawdę złożonej domenie (bank, system rezerwacji lotów).

---

**AR-E4**

**P:** Czym jest Event-Driven Architecture i jak różni się od request/response?

**O:** W architekturze sterowanej zdarzeniami komponenty komunikują się przez publikowanie i konsumowanie zdarzeń za pośrednictwem message brokera (RabbitMQ, Kafka, AWS EventBridge, Redis Streams), zamiast bezpośrednich wywołań HTTP/RPC. Różnice: (1) **Sprzężenie** — request/response jest synchroniczne i ściśle sprzężone (nadawca czeka, zna adresata). EDA jest asynchroniczne i luźno sprzężone (publisher nie wie kto przetwarza zdarzenie). (2) **Odporność** — w request/response awaria odbiorcy = błąd nadawcy. W EDA zdarzenia są trwałe w kolejce — odbiorca może być chwilowo niedostępny i przetworzy zdarzenia po powrocie. (3) **Skalowalność** — wielu konsumentów może niezależnie skalować przetwarzanie zdarzeń. Zastosowanie w e-commerce: `OrderPlaced` → PersonalizationService (aktualizuj rekomendacje) + EmailService (wyślij potwierdzenie) + InventoryService (zmniejsz stock) + AnalyticsService (log zdarzenie). Każdy serwis subskrybuje niezależnie — dodanie nowego konsumenta nie wymaga zmiany producenta.

---

**AR-E5**

**P:** Czym jest Circuit Breaker pattern i jak chroni przed kaskadowymi awariami?

**O:** Circuit Breaker to wzorzec odporności na błędy inspirowany bezpiecznikiem elektrycznym. Gdy zależny serwis (np. API płatności) zaczyna zwracać błędy lub odpowiadać zbyt wolno, circuit breaker "otwiera obwód" — przez pewien czas wszystkie wywołania natychmiastowo zwracają błąd bez czekania na timeout. Trzy stany: (1) **Closed** (normalny) — żądania przechodzą normalnie; liczy błędy. Gdy próg błędów przekroczony (np. 5 na 10) → Open. (2) **Open** (zepsuty) — wszystkie żądania natychmiast kończą się błędem `CircuitBreakerOpenError`; po `resetTimeout` (np. 30s) przechodzi do Half-Open. (3) **Half-Open** (testuje) — przepuszcza jeden test żądanie; jeśli sukces → Closed; jeśli błąd → Open. Korzyści: oszczędzasz zasoby nie czekając na timeouty (30s * 1000 req = 30 000 zablokowanych wątków), dasz serwisowi czas na odzyskanie, możesz zwrócić fallback (cached data, degraded response). W Node.js: biblioteka `opossum` lub `cockatiel`. Szczególnie ważne w mikroserwisach.

---

**AR-E6**

**P:** Czym jest wzorzec Saga dla rozproszonych transakcji i jakie są dwa główne typy?

**O:** Saga to wzorzec zarządzania transakcjami rozproszonymi bez użycia 2-phase commit. Zamiast atomicznej transakcji, definiujesz sekwencję lokalnych transakcji każda z kompensacyjną "undo" operacją. Dwa typy: (1) **Choreography Saga** — każdy serwis emituje zdarzenie po zakończeniu swojego kroku; następny serwis reaguje na zdarzenie. Brak centralnego koordynatora. Pro: luźne sprzężenie. Con: trudny w debugowaniu (przepływ rozproszony między serwisami, brak jednego miejsca widoku). (2) **Orchestration Saga** — centralny orkiestrator (np. Step Functions) wywołuje serwisy sekwencyjnie i obsługuje kompensacje. Pro: łatwy do debugowania i modyfikacji. Con: orkiestrator staje się "bogiem" który zna wszystkie serwisy. Przykład e-commerce: PlaceOrder → ReserveInventory → ChargePayment → UpdateOrderStatus. Jeśli ChargePayment zawiedzie: CompensateInventoryReservation (przywróć stock) + MarkOrderFailed. Saga **nie** zapewnia pełnej izolacji jak ACID — inne transakcje mogą widzieć częściowy stan.

---

**AR-E7**

**P:** Co to jest Domain-Driven Design (DDD) i które koncepcje są praktycznie użyteczne w NestJS?

**O:** DDD to podejście do projektowania oprogramowania skupione na modelu domeny biznesowej. Pełne DDD jest skomplikowane i rzadko wdrażane całkowicie, ale kilka konceptów jest praktycznie użytecznych: (1) **Bounded Context** — wyraźna granica w której dany model jest spójny. W monolicie NestJS: moduły `OrdersModule`, `InventoryModule` są oddzielnymi bounded contexts — każdy ma własną reprezentację "Product" (zamówienia widzą snapshot cenowy, inventory widzi aktualny stock). (2) **Aggregate** — klaster powiązanych obiektów traktowanych jako jednostka dla zmian stanu. `Order` z `OrderItems` to agregat — `OrderItem` nie modyfikuje się bez `Order`. (3) **Value Object** — niemutowalny obiekt identyfikowany wartością, nie tożsamością. `Money { amount: 49.99, currency: 'PLN' }` zamiast `price: number`. Enkapsuluje walidację i operacje. (4) **Domain Events** — fakty który wydarzyły się w domenie: `OrderPlaced`, `PaymentConfirmed`. Oddziela serwisy bez bezpośrednich wywołań. Praktyczna zasada: nie wdrażaj DDD dla CRUD — ma sens gdy logika domenowa jest naprawdę złożona.

---

**AR-E8**

**P:** Jakie są różnice między GraphQL a REST i kiedy wybrać każde z nich?

**O:** REST i GraphQL to alternatywne podejścia do API: **REST**: (1) Zasoby identyfikowane URL-ami (`/products/123`, `/orders`); (2) Over-fetching (endpoint zwraca wszystkie pola nawet jeśli klient potrzebuje tylko 2); (3) Under-fetching (potrzeba wielu żądań żeby zebrać dane: `/product` + `/reviews` + `/seller`); (4) Proste, powszechnie znane, doskonała kompatybilność z HTTP cache/CDN, czytelne URL-e. **GraphQL**: (1) Jeden endpoint (`/graphql`), klient precyzyjnie specyfikuje jakich pól potrzebuje; (2) Eliminuje over/under-fetching — idealne dla mobile (ograniczone dane); (3) Silny system typów, auto-generowanie klientów; (4) N+1 problem (rozwiązywalny przez DataLoader); (5) Trudniejszy caching (POST z body, nie GET). Kiedy REST: CRUD API dla jednego klienta, publiczne API (cache przez CDN), prostota priorytetem. Kiedy GraphQL: wiele klientów o różnych potrzebach danych (web vs mobile vs kiosk), aggregate query (sklej dane z wielu źródeł), BFF (Backend for Frontend) pattern.

---

**AR-E9**

**P:** Co to jest CAP theorem i co oznacza w praktyce dla systemu e-commerce?

**O:** CAP Theorem (Brewer) mówi, że rozproszony system może zagwarantować co najwyżej **dwie** z trzech właściwości: (1) **Consistency (C)** — każdy odczyt zwraca ostatnio zapisaną wartość lub błąd; (2) **Availability (A)** — każde żądanie dostaje odpowiedź (sukces lub błąd, ale bez timeout); (3) **Partition Tolerance (P)** — system działa mimo utraty komunikacji między węzłami. Ponieważ partycje sieciowe są nieuniknione, praktyczny wybór to CP lub AP: **CP** (PostgreSQL z replikacją synchroniczną) — przy partycji niedostępny jest bardziej niż niedokładny. Właściwe dla: stanu inventory, transakcji finansowych, danych wymagających spójności. **AP** (DynamoDB, Cassandra eventual consistency) — przy partycji odpowiada z potencjalnie nieaktualnymi danymi. Właściwe dla: liczników wyświetleń, koszyk użytkownika, rekomendacje. W e-commerce: koszyk może być AP (chwilowe niespójności akceptowalne), ale finalizacja zamówienia i stan magazynowy muszą być CP (nie możesz sprzedać tego samego towaru dwa razy).

---

**AR-E10**

**P:** Jak zaprojektujesz system kolejkowania zadań (job queue) dla e-commerce — wybór narzędzi i wzorce?

**O:** System kolejkowania dla e-commerce potrzebuje obsłużyć: emaile transakcyjne (potwierdzenie zamówienia, faktura, powiadomienie o wysyłce), generowanie dokumentów PDF, wywołania zewnętrznych API (carrier labels), eksport danych. Architektura: (1) **Broker** — Redis (BullMQ): prosty, szybki, dobrze znany; RabbitMQ: więcej gwarancji dostarczenia, routing przez exchanges; Kafka: event log, bardzo wysoka przepustowość. Dla sklepu polecam BullMQ + Redis — wbudowany w NestJS, doskonała dokumentacja, dashboardy (Bull Board). (2) **Wzorce odporności** — `attempts: 3` z exponential backoff `(2^attempt * 1000)ms`; DLQ (Dead Letter Queue) dla jobów które wyczerpały próby — alert + ręczna inspekcja; `timeout` per job type (email: 30s, PDF: 60s, external API: 10s). (3) **Priorytety** — `priority: 1` dla krytycznych (potwierdzenie zamówienia), `priority: 10` dla nieważnych (email marketingowy). (4) **Idempotencja** — każdy job ma unikalny `jobId`; worker sprawdza czy job nie był już przetworzony zanim wykona operację. (5) **Monitoring** — metryki kolejki (długość, age of oldest job, failure rate) w dashboardzie lub Grafana.

---

**AR-E11**

**P:** Jak działają indeksy złożone (composite indexes) w PostgreSQL i kiedy mają przewagę nad pojedynczymi?

**O:** Złożony indeks obejmuje wiele kolumn w jednym B-drzewie: `CREATE INDEX idx_orders_user_status ON orders(user_id, status)`. Zasada lewego prefiksu: indeks `(a, b, c)` może być użyty dla zapytań filtrujących po `a`, `(a, b)` lub `(a, b, c)` — nigdy tylko po `b` lub `c` bez `a`. Kiedy złożony jest lepszy od dwóch osobnych: (1) **Często łączone filtry** — `WHERE user_id = ? AND status = 'PENDING'` — jeden skan vs. dwa skany + bitmap AND; (2) **Index-only scan** — jeśli SELECT pobiera tylko kolumny będące w indeksie, Postgres nie sięga do tabeli; (3) **ORDER BY + WHERE** — `WHERE user_id = ? ORDER BY created_at DESC` — indeks `(user_id, created_at)` eliminuje sort. Kolejność kolumn w indeksie złożonym ma znaczenie: kolumna o najwyższej selektywności (user_id: 1 z miliona) jako pierwsza. Kolumna range lub ORDER BY jako ostatnia. Narzędzie do analizy: `EXPLAIN (ANALYZE, BUFFERS) SELECT ...` — szukaj `Index Scan using idx_...` zamiast `Seq Scan`.

---

**AR-E12**

**P:** Co to jest N+1 query problem i jak go rozwiązać w Prisma/TypeORM?

**O:** N+1 pojawia się gdy pobierasz N rekordów a potem dla każdego z N wykonujesz dodatkowe zapytanie — zamiast jednego JOIN-a masz N+1 zapytań do DB. Przykład (Prisma bez include):
```typescript
// N+1 — źle:
const orders = await prisma.order.findMany(); // 1 query
for (const order of orders) {
  const items = await prisma.orderItem.findMany({ where: { orderId: order.id } }); // N queries
}

// Rozwiązanie — eager loading z include:
const orders = await prisma.order.findMany({
  include: { items: { include: { product: true } } } // 1 query (lub kilka z JOIN)
});
```
W GraphQL N+1 jest powszechny bo resolver dla każdego obiektu wywołuje osobny fetch — rozwiązanie: **DataLoader** (batching i caching per request — zbiera wszystkie potrzebne IDs z jednego cyklu renderowania i wywołuje jedno zapytanie `WHERE id IN (...)`). Wykrywanie: logowanie zapytań (`prisma.$on('query', ...)`, query count middleware) + sprawdzanie wzorców w logach dev. Zasada: zawsze analizuj ile zapytań generuje endpoint dla typowych scenariuszy (zamówienie z 10 pozycjami = ilu queries?).

---

**AR-E13**

**P:** Jak zaprojektujesz system uwierzytelniania dla aplikacji obsługującej tysiące użytkowników?

**O:** Architektura auth dla skali: (1) **Access Token** — JWT z krótkim TTL (5–15 min), asymetryczne podpisywanie RS256 (zamiast HS256) — serwisy resource mogą weryfikować token bez dostępu do sekretu, tylko pubkey. Payload: `{ sub, role, sessionId, iat, exp }`. (2) **Refresh Token** — długożyjący (7–30 dni), opaque token (losowy UUID), hashowany SHA-256 przed zapisem w DB. Token rotation: każde odświeżenie tworzy nowy refresh token, poprzedni unieważniany — wykrywa kradzież (jeśli skradziony token jest użyty po rotacji, legalny użytkownik dostał nowy, wykryjesz dwukrotne użycie). (3) **Współdzielony state auth** — lista unieważnionych sesji w Redis (blacklist) z TTL = TTL access tokenu — minimalizuje rozmiar blacklisty. (4) **Skalowanie** — bez sticky sessions (JWT bezstanowy dla access), Redis dla blacklisty i refresh tokens jest współdzielony między replikami; (5) **Ochrona** — rate limit na `/auth/login` (5 prób na minutę per IP), `Argon2id` zamiast bcrypt (odporniejszy na GPU), `secure; httpOnly; samesite=Strict` dla refresh token cookie, CSP headers żeby mitygować XSS.

---

**AR-E14**

**P:** Jak podejść do projektowania systemu powiadomień (notifications) skalowalnego do milionów użytkowników?

**O:** System powiadomień ma trzy kanały: email, push (mobile/web), in-app. Architektura: (1) **Warstwowa logika** — `NotificationService.send(userId, type, data)` przyjmuje abstrakcyjne zdarzenie; internal resolver sprawdza preferencje użytkownika (email: tak, push: nie) i deleguje do właściwych adapterów. (2) **Queue per kanał** — osobne kolejki BullMQ dla `email`, `push`, `webhook`; różne priorytety, raty wysyłki (email providers mają limity: 100 req/s dla Resend). (3) **Template engine** — szablony emaili/push oddzielone od kodu, przechowywane per locale (i18n); React Email dla HTML emaili (komponenty TS → HTML). (4) **Deduplication** — przed wysłaniem sprawdź `sentNotifications` table (userId + notificationType + window 24h) żeby nie spamować przy zdarzeniach burstowych. (5) **Preferences** — tabela `user_notification_preferences` per kanał per typ; UI w ustawieniach konta. (6) **Observability** — metryki: delivered, failed, bounced (email bounce handler przez webhook Resend), unsubscribed. (7) **Skalowanie** — przy milionach użytkowników: Kafka zamiast Redis (trwały log, consumer groups, replay), dedykowany serwis notification z SLO gwarantującym dostarczenie.

---

**AR-E15**

**P:** Jak zabezpieczyć aplikację e-commerce przed OWASP Top 10 — wymień konkretne środki zaradcze?

**O:** Kluczowe zagrożenia OWASP i obrona: (1) **Injection (SQL/NoSQL)** — Prisma parametryzuje automatycznie; nigdy nie interpoluj danych użytkownika do surowych zapytań `prisma.$queryRaw`. (2) **Broken Authentication** — bcrypt/Argon2 dla haseł, krótkie TTL tokenów, refresh token rotation, rate limiting logowania, MFA dla kont admin. (3) **Sensitive Data Exposure** — HTTPS wszędzie, `httpOnly; Secure; SameSite` dla cookies, PII w DB zaszyfrowane w spoczynku (Supabase + Transparent Data Encryption), nie loguj kart kredytowych ani haseł. (4) **XML External Entities (XXE)** — unikaj parsowania XML; jeśli konieczne, wyłącz external entities. (5) **Broken Access Control** — walidacja autoryzacji per endpoint (nie tylko auth guard), sprawdzanie `userId` z tokenu vs. parametru trasy (`order.userId !== req.user.id → 403`). (6) **Security Misconfiguration** — `helmet()` w Express/NestJS (X-Frame-Options, X-Content-Type-Options, CSP, HSTS), wyłącz stack trace w produkcji, zaktualizowane dependencies (`dependabot`). (7) **XSS** — sanityzacja danych wejściowych (DOMPurify po stronie frontu), CSP header, Angular escapes HTML automatycznie. (8) **CSRF** — `SameSite=Strict` na cookies, double-submit cookie pattern lub CSRF token dla nieciasteczkowych żądań. (9) **Vulnerable Components** — `pnpm audit` + Dependabot + `npm audit` w CI. (10) **Insufficient Logging** — każde żądanie z `userId`, `requestId`, status; alert przy anomaliach (nagłe 401, brute force).

---

*Ostatnia aktualizacja: 2026-06-11 · Przygotowane dla rozmowy CGI Warsaw — Stażysta Fullstack Developer*
