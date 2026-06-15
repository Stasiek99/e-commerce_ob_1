# CGI Warszawa — Stażysta Fullstack Developer (Angular + Node.js) Przygotowanie do rozmowy

**Rola:** J0526-0284 · Staż studencki · Warszawa  
**Rozmowa:** ~30 minut · Techniczna + krótki HR  
**Tematy potwierdzone:** AWS Lambda · Node.js · Angular · Architektura

---

## 0. Analogie — konceptualne wyjaśnienia

> Zamiast recytować definicję — pokaż, że rozumiesz **po co** coś istnieje. Te analogie to gotowe odpowiedzi na pytania "Czym jest X?" w stylu rozmowy, nie egzaminu.

---

### AWS Lambda — Freelancer na telefon

Wyobraź sobie, że zarządzasz restauracją. Przez 90% dnia nie masz prawie żadnych zamówień, ale w piątkowy wieczór goście dosłownie walą drzwiami.

Masz dwie opcje zatrudnienia kucharza:

**Etat (EC2):** Płacisz kucharzowi za 8 godzin dziennie — nawet gdy przez 6 z nich siedzi i czeka. Serwer działa 24/7, koszt stały.

**Freelancer na telefon (Lambda):** Dzwonisz do kucharza tylko gdy pojawi się zamówienie. Gotuje, wychodzi. Płacisz wyłącznie za czas gotowania. A w piątkowy wieczór? AWS automatycznie powołuje 100 takich freelancerów jednocześnie, żeby obsłużyć wszystkich gości naraz.

Lambda to właśnie taki freelancer. Twój kod "śpi" — żaden serwer nie czeka. Gdy przychodzi żądanie HTTP lub zdarzenie z S3, AWS natychmiast budzi funkcję, wykonuje ją i wyłącza. Płacisz tylko za milisekundy działania.

---

### Cold Start — Kucharz, który nie zna jeszcze kuchni

Ten sam freelancer z poprzedniego przykładu — ale wyobraź sobie, że to jego **pierwsza wizyta** w Twojej kuchni.

Zanim zacznie gotować, musi: znaleźć sprzęt, przeczytać Twoje przepisy, poustawiać składniki. To właśnie **cold start** — Lambda musi zainicjalizować runtime, załadować Twój kod i uruchomić kod inicjalizacyjny od zera. Dodaje to od 100 ms do nawet 1 sekundy **zanim handler w ogóle się wykona**.

Ale jeśli ten kucharz był tu niedawno i wraca do tej samej kuchni? Zna układ, ma rozgrzany piec, zaczyna gotować natychmiast. To **warm start** — zero narzutu, bo środowisko wykonawcze już czeka.

Strategia na cold starty: trzymaj mały pakiet kodu (mniej do "przeczytania"), unikaj ciężkich importów na poziomie modułu, używaj Provisioned Concurrency dla tras wrażliwych na opóźnienia.

---

### API Gateway — Kelner między gościem a kuchnią

Wyobraź sobie, że Twoja aplikacja to wielka restauracja.

Kuchnia (backend, Lambda, bazy danych) przygotowuje dania — ale goście nie wchodzą prosto do kuchni. Dlatego masz kelnera.

**API Gateway to kelner.** Oto co robi:

- **Przyjmuje zamówienia (Interface):** Aplikacja mobilna wysyła żądanie do API Gateway. Nie musi wiedzieć jak działa kuchnia — tylko jak "zawołać kelnera".

- **Sprawdza, kto wchodzi (Security/Auth):** Kelner weryfikuje, czy gość ma rezerwację — czy JWT jest ważny, czy Cognito go zatwierdza. Jeśli nie — nie wpuszcza. Punkt końcowy Lambda w ogóle nie widzi nieautoryzowanego żądania.

- **Zarządza ruchem (Throttling):** Gdy nagle przybędzie 10 000 osób naraz, kelner mówi "spokojnie, wpuszczamy po kolei". API Gateway ma throttling — nie pozwoli, żeby Lambdy i bazy danych padły pod ciężarem.

- **Przekierowuje do właściwego kuchnika (Routing):** Pizza idzie do jednego kucharza, sushi do drugiego. `GET /products` trafia do jednej Lambdy, `POST /orders` do innej.

---

### Node.js Event Loop — Kelner z wieloma stolikami

Wyobraź sobie kelnera obsługującego 50 stolików jednocześnie — sam, bez pomocy.

Jego sekret? Nigdy nie stoi przy jednym stoliku i nie czeka, aż kuchnia skończy gotować. Podchodzi do stolika 1, bierze zamówienie i mówi "poczekajcie, wrócę gdy będzie gotowe". Przechodzi do stolika 2, 3, 4... Gdy kuchnia sygnalizuje "zamówienie stolika 1 gotowe" — kelner wraca z daniem.

**Pętla zdarzeń Node.js działa dokładnie tak.** Jeden wątek obsługuje tysiące równoczesnych żądań HTTP — ale nigdy nie czeka bezczynnie. Gdy żądanie wymaga zapytania do bazy danych, Node mówi "sprawdzę gdy DB skończy" i obsługuje kolejne żądania. Gdy baza zwróci dane, Node wraca z callbackiem/Promisem.

To sprawia, że Node.js jest genialny dla **I/O-bound workloadów** (REST API, handlery Lambda). Ale jeśli kelner musiałby sam ugotować jedno danie (zadanie CPU-intensive), przez cały ten czas blokowałby wszystkie pozostałe stoliki.

---

### Mikroserwisy vs Monolit — Sklep vs Centrum handlowe

**Monolit to jeden duży sklep z wszystkim:**

Jeden budynek, jeden magazyn, jeden sklep. Łatwo zarządzać i debugować — wiesz gdzie wszystko jest. Problem: jeśli do działu obuwniczego przyszło za dużo klientów, nie możesz powiększyć tylko tego działu. Musisz powiększyć cały sklep.

**Mikroserwisy to centrum handlowe:**

Każdy sklep (serwis) jest niezależny — obuwie, elektronika, jedzenie. Jeśli sklep z obuwiem jest oblegany, właściciel otwiera drugą lokalizację (niezależne skalowanie). Każdy sklep ma swoją kasę (własna baza danych), swój personel (oddzielny deployment). Jeśli pali się sklep z elektroniką — reszta centrum działa.

Koszt? Koordynacja między sklepami jest trudniejsza. Zwrot towaru przez kilka sklepów naraz to logistyczne wyzwanie (transakcje rozproszone). I samo centrum handlowe jest droższe w utrzymaniu niż jeden sklep.

**Zasada:** Zacznij od monolitu. Wydzielaj mikroserwisy dopiero gdy konkretna część serwisu nie daje rady pod obciążeniem i masz zespół ≥8 osób do utrzymania.

---

### REST API — Protokół dyplomatyczny

Wyobraź sobie ambasadę. Każdy kraj mówi innym językiem wewnętrznie, ale istnieje protokół dyplomatyczny — zestaw zasad i gestów, które wszyscy rozumieją.

REST to właśnie taki protokół dla aplikacji. Niezależnie od tego, czy klient jest w Angular, React, Swifcie czy Pythonie — wszyscy rozmawiają przez te same "słowa":

- `GET` — "Poproszę o informację" (pobranie, nigdy nie zmienia danych)
- `POST` — "Chcę coś nowego zarejestrować" (tworzenie zasobu)
- `PUT/PATCH` — "Chcę zaktualizować to co istnieje"
- `DELETE` — "Proszę to usunąć"

I jak każdy dobry dyplomata, serwer odpowiada odpowiednim kodem statusu: `200 OK` (sukces), `201 Created` (zasób powstał i masz `Location` header), `400 Bad Request` (źle wypełniłeś formularz), `401 Unauthorized` (nie wiem kim jesteś), `403 Forbidden` (wiem kim jesteś, ale tu nie wejdziesz), `404 Not Found` (nie istnieje).

---

### `async/await` — Barmański notatnik vs. bieganie z pytaniami

Wyobraź sobie barmana w zatłoczonym barze.

**Stary sposób (callback hell):** Za każdym razem gdy potrzebuje czegoś od kuchni, musi wysłać chłopca z wiadomością i czekać na odpowiedź, zanim wyśle kolejnego. Im więcej kroków, tym bardziej zagmatwana sieć posłańców. To właśnie "callback hell" — funkcja w funkcji w funkcji.

**Nowoczesny sposób (async/await):** Barman zapisuje sobie zadania na kartce i mówi "zróbcie to, a ja wrócę po wynik". Czyta karteczkę od góry do dołu jak normalną listę — każde `await` to "poczekaj na wynik tego, potem idź dalej". Kod wygląda jak synchroniczny, ale jest w pełni asynchroniczny pod spodem.

```typescript
// Tak jest pod spodem — Promise
getUser(id).then(user => getOrders(user.id).then(orders => ...))

// Tak to wygląda z async/await — czytelne jak lista kroków
const user = await getUser(id);
const orders = await getOrders(user.id);
```

`async/await` to cukier syntaktyczny nad Promise — pod maską to wciąż `.then()`, ale napisane tak, żeby człowiek mógł to czytać od góry do dołu.

---

### RxJS `switchMap` — Taksówkarz z GPS-em

Zamówiłeś taksówkę i powiedziałeś "jedź na lotnisko". Taksówkarz ruszył. Po 2 minutach dzwonisz i mówisz "nie, jedź do centrum". Co robi dobry taksówkarz? **Natychmiast porzuca trasę na lotnisko i zaczyna nową do centrum.**

`switchMap` działa dokładnie tak. Gdy użytkownik wpisuje nowe słowo w wyszukiwarce, `switchMap` anuluje poprzednie aktywne żądanie HTTP i startuje nowe. Dzięki temu nigdy nie dostajesz odpowiedzi dla starszego, już nieaktualnego zapytania wyświetlonej na ekranie po nowszym.

```typescript
searchInput.valueChanges.pipe(
  debounceTime(300),       // odczekaj zanim użytkownik skończy pisać
  switchMap(q => api.search(q))  // anuluj poprzednie, startuj nowe
)
```

Dla porównania — `mergeMap` to taksówkarz który jedzie na oba adresy jednocześnie (wszystkie równolegle), a `concatMap` to taksówkarz który najpierw dowiezie na lotnisko, a dopiero potem jedzie do centrum (kolejność gwarantowana).

---

### Angular `async` pipe — Asystent z autopilotem

Wyobraź sobie, że masz asystenta, który subskrybuje biuletyny dla Ciebie i automatycznie wypisuje się ze wszystkich gdy kończysz pracę, żebyś nie dostawał spamu po odejściu.

`async` pipe w Angular robi dokładnie to dla Observable/Promise:
1. **Subskrybuje** gdy komponent się pojawia
2. **Renderuje** każdą nową wartość w szablonie automatycznie
3. **Anuluje subskrypcję** gdy komponent jest niszczony — zero wycieków pamięci

Bez `async` pipe — musisz sam pamiętać o `unsubscribe()` w `ngOnDestroy`. Zapomnisz raz i masz wyciek pamięci: komponent jest zniszczony, ale Observable nadal żyje i trzyma referencję do martwego komponentu.

```html
<!-- Wystarczy to - nie potrzebujesz ngOnDestroy -->
<div *ngFor="let product of products$ | async">{{ product.name }}</div>
```

---

### Angular OnPush Change Detection — Audytor który sprawdza tylko zmienione dokumenty

Domyślna strategia Angular to audytor, który sprawdza **każdy dokument w całej firmie** po każdym zdarzeniu — kliknięcie, timer, odpowiedź HTTP. Przy dużej aplikacji to może oznaczać setki komponentów sprawdzanych bez powodu.

`OnPush` to inteligentny audytor: sprawdza dany departament tylko gdy:
1. Ktoś z zewnątrz przyniósł **nowy dokument** (zmiana referencji `@Input`)
2. W tym departamencie **coś się wydarzyło** (zdarzenie z własnego szablonu)
3. Audytor dostał **wezwanie ręczne** (`markForCheck()` lub `async` pipe)

Kompromis: musisz dostarczać **nowe obiekty** zamiast mutować istniejące. `this.items.push(x)` — audytor nie zareaguje, bo referencja tablicy jest ta sama. `this.items = [...this.items, x]` — nowa referencja, audytor sprawdza.

---

### Angular Signals vs Observable — Tablica ogłoszeń vs. prenumerata gazety

**Observable to prenumerata gazety:**
Zapisujesz się do redakcji (`.subscribe()`), a ona wysyła Ci każde nowe wydanie z prądem. Możesz się wypisać (unsubscribe), łączyć kilka prenumerat, filtrować artykuły — masz cały aparat operatorów RxJS. Problem: jeśli chcesz sprawdzić "co jest w dzisiejszej gazecie", musisz czekać aż przyjdzie — nie możesz po prostu podejść i przeczytać.

**Signal to tablica ogłoszeń z powiadomieniami push:**
Tablica zawsze pokazuje aktualną wartość — możesz podejść i odczytać w dowolnym momencie (`signal()`). Gdy zmienisz ogłoszenie, Angular automatycznie wie które komponenty na nie patrzą i odświeża tylko te. `computed()` to ogłoszenie które automatycznie przelicza się gdy zmieni się ogłoszenie bazowe, bez żadnej subskrypcji.

**Praktyczna reguła:** Signals do lokalnego stanu komponentu i pochodnych wartości. Observable do strumieni HTTP, WebSocket i wszędzie gdzie potrzebne są operatory jak `debounceTime`, `switchMap` czy `retry`.

---

### RxJS `mergeMap`, `concatMap`, `exhaustMap` — Cztery style obsługi klientów

Masz cztery podejścia do obsługi nowych klientów wchodzących do banku:

- **`switchMap` (taksówkarz z GPS):** Nowy klient wchodzi — przerywasz obsługę poprzedniego i zajmujesz się nowym. Idealny: wyszukiwarka, gdzie wynik poprzedniego zapytania jest nieaktualny.

- **`mergeMap` (otwierasz nowe okienko dla każdego):** Każdy klient dostaje własnego kasjera natychmiast, wszyscy obsługiwani równolegle. Idealny: wysyłanie eventu analitycznego — liczy się każde zdarzenie, kolejność nieważna.

- **`concatMap` (klasyczna kolejka — jeden po drugim):** Klient 2 czeka aż klient 1 zostanie obsłużony do końca. Idealny: sekwencyjne operacje zapisu, gdzie kolejność jest kluczowa.

- **`exhaustMap` (obsługuję jedną osobę, reszta musi czekać na zewnątrz):** Gdy przy kasie jest klient, nowe osoby wchodzące są ignorowane. Idealny: przycisk "Zaloguj się" — nie chcesz wysłać 5 żądań logowania bo ktoś klikał nerwowo.

---

### Dependency Injection — Restauracja z dostawcami

Wyobraź sobie restaurację, gdzie każdy kucharz sam hoduje swoje warzywa, sam wytwarza mąkę, sam robi masło. Absurd.

W prawdziwej restauracji kucharz mówi: "potrzebuję świeżych pomidorów" — i dostawca (injector) przynosi je z zewnątrz. Kucharz nie wie jak rosną pomidory, nie dba o to. Po prostu ich używa.

**Dependency Injection w Angular działa tak samo.** Komponent mówi w konstruktorze: "potrzebuję `HttpClient`" — Angular (injector) dostarcza gotową instancję. Komponent nie tworzy jej sam, nie zarządza jej cyklem życia, nie wie skąd pochodzi.

Korzyść: gdy chcesz przetestować komponent, "podmienisz dostawcę" — zamiast prawdziwego `HttpClient` wstrzykniesz mockowy. Restauracja testowa używa plastikowych pomidorów, żeby gotować w kółko bez kosztów.

---

### Webhook vs Polling — Kurier vs. samodzielne odbieranie paczki

Czekasz na paczkę z Amazon. Masz dwie opcje:

**Polling:** Co godzinę jedziesz do magazynu i pytasz "czy moja paczka już dotarła?". 23 razy słyszysz "nie". Nieefektywne, kosztuje Twój czas i czas magazyniera.

**Webhook:** Dajesz Amazon swój adres i mówisz "gdy paczka dotrze, przynieście mi pod drzwi". Kurier przyjeżdża dokładnie raz, gdy zdarzenie nastąpiło. Ty nic nie robisz — czekasz.

Webhook Stripe działa tak samo: zamiast aplikacja co minutę pytać "czy płatność już przeszła?" — Stripe samo wysyła POST na `/payments/webhook` dokładnie gdy `checkout.session.completed` nastąpi.

Kluczowy wymóg bezpieczeństwa: musisz zweryfikować, że to naprawdę Stripe puka do drzwi, a nie ktoś podający się za kuriera. Dlatego Stripe podpisuje każdą "paczkę" podpisem HMAC — porównujesz go z `STRIPE_WEBHOOK_SECRET` i jeśli się zgadza, wpuszczasz.

---

### JWT vs. Uwierzytelnianie sesyjne — Bilet vs. lista gości

**Sesja (lista gości):** Przy wejściu na imprezę ochroniarz zapisuje Cię na liście i daje Ci numerek. Gdy chcesz wejść znowu, podajesz numerek, ochroniarz sprawdza listę i weryfikuje. **Lista jest u ochroniarza (serwer)** — może Cię wykreślić w każdej chwili. Ale każde wejście wymaga sprawdzenia listy.

**JWT (bilet z hologramem):** Dostajesz bilet z Twoim imieniem, miejscem i datą — podpisany przez organizatora. Każdy ochroniarz może sprawdzić podpis (hologram) i wpuścić Cię **bez dzwonienia do centrali**. Jeden serwer wystawił bilet, każdy serwer za load balancerem może go zweryfikować. 

Słabość biletu: jeśli ktoś ukradnie Twój bilet — obowiązuje do wygaśnięcia. Nie możesz "unieważnić hologramu" bez wymiany na wszystkich bramkach. Dlatego bilety JWT mają krótki termin ważności (15 min) + długotrwały refresh token, który możesz unieważnić natychmiastowo w bazie danych.

---

### Indeks bazy danych — Spis treści vs. czytanie całej książki

Masz encyklopedię z 10 000 stron i szukasz artykułu o "Fotosynteza".

**Bez indeksu:** Czytasz od strony 1, przewracasz każdą stronę, szukasz słowa. `SEQUENTIAL SCAN` — Postgres robi dokładnie to dla tabeli bez indeksu: sprawdza każdy wiersz.

**Z indeksem:** Otwierasz spis treści na literę "F", widzisz "Fotosynteza — str. 3847", idziesz bezpośrednio tam. Indeks to osobna, posortowana struktura (B-drzewo) mówiąca Postgresowi "szukasz `slug = 'perfume-xl'`? Wiesz, to wers numer 4829".

Koszt: każde nowe "naklejanie etykietki" na strony (INSERT/UPDATE) wymaga też aktualizacji spisu treści. Tabela z 10 indeksami zapisuje ~10x więcej pracy przy każdej zmianie. Indeksuj kolumny które często pojawiają się w `WHERE`, `JOIN` i `ORDER BY` — `products.slug`, `orders.userId`, `cart_items.cartId`.

---

### Lambda — Bezstanowość — Kelner bez notesu

Wyobraź sobie kelnera, który **nie ma notesu i nie pamięta Twoich poprzednich wizyt**. Przy każdej wizycie zaczyna od zera: "dzień dobry, pierwszy raz?".

Lambda jest dokładnie taka. Każde wywołanie to tabula rasa — nie możesz polegać na zmiennej w pamięci, która przetrwa między wywołaniami. Możesz co prawda liczyć na to że "ciepłe" środowisko zachowa zmienne globalne, ale AWS może w dowolnym momencie "zwolnić kelnera" i zatrudnić nowego.

**Co z tym zrobić?** Wszystko co musi przetrwać między wywołaniami — trzymaj na zewnątrz: baza danych (RDS), cache (ElastiCache/Redis), plik (S3). Lambda to tylko logika, nie magazyn.

---

### CI/CD Pipeline — Taśmociąg w fabryce

Wyobraź sobie fabrykę samochodów. Bez taśmociągu: jeden mechanik robi wszystko sam — od spawania po tapicerowanie. Wolno, błędogennie, nie do skalowania.

Z taśmociągiem każde auto przechodzi kolejno przez wyspecjalizowane stanowiska: spawanie → lakierowanie → montaż silnika → kontrola jakości → dostawa. Każde stanowisko robi jedno i dobrze. Jeśli kontrola jakości wykryje wadę, auto nie jedzie dalej do klienta.

**CI/CD to taśmociąg dla kodu:**

- `Install & Build` — spawalnia: czy kod w ogóle się kompiluje?
- `Lint & Tests` — kontrola jakości: czy logika działa, czy nie psuje poprzednich funkcji?
- `Staging deploy` — jazda próbna: czy działa z prawdziwą infrastrukturą?
- `Production deploy` — dostawa do klienta: ten sam artefakt co był na staging, nie nowy build.

Kluczowa zasada: **ten sam artefakt** idzie ze staging na produkcję — nie przebudujesz kodu przed deploymentem produkcyjnym, bo nowy build mógłby mieć inne wyniki.

---

### TypeScript vs JavaScript — GPS vs. mapa papierowa

Jedziesz autem do nieznanego miasta.

**JavaScript (mapa papierowa):** Masz trasę, ale dopiero gdy skręcisz w zły zaułek — albo skończy się paliwo — dowiesz się że coś poszło nie tak. Błędy wykrywasz w runtime, gdy aplikacja już działa u użytkownika.

**TypeScript (GPS z ostrzeżeniami na żywo):** Jeszcze zanim ruszysz, GPS mówi: "ta trasa jest zablokowana, użyłeś złego skrętu, za 500 m droga nie istnieje". Błędy typów i literówki w nazwach metod wykrywasz w edytorze, zanim kod trafi do użytkownika.

Koszt: musisz "zaprogramować GPS" — napisać typy, interfejsy, annotacje. Na krótkich trasach (małe skrypty) mapa papierowa jest szybsza. Na długich podróżach (duże aplikacje, wiele osób w zespole) GPS ratuje życie.

---

### Kolejka wiadomości (BullMQ/Redis) — Numerki w urzędzie

Wyobraź sobie urząd bez systemu numerków. Każdy klient wchodzi i domaga się obsługi natychmiast — urzędnik obsługuje jednocześnie 50 osób, krzycząc przez chaos. Nic nie działa.

Z numerkami: klient bierze numerek i siada. Urzędnik (worker) obsługuje jedną osobę na raz, we własnym tempie. Jeśli 500 osób przyjdzie naraz, wszyscy dostaną numerki i zostaną obsłużeni — może nie natychmiast, ale nikt nie wychodzi z niczym.

**Kolejka wiadomości w e-commerce działa tak:**

Klient składa zamówienie → endpoint zwraca `201` natychmiast (numer). Wysłanie emaila potwierdzającego, generowanie faktury, powiadomienie magazynu — to wszystko trafia do kolejki BullMQ. Workery przetwarzają w tle, we własnym tempie, z automatycznym ponawianiem jeśli API emaila padnie.

Bez kolejki: endpoint zamówień czeka na API emaila → API emaila jest wolne → klient czeka 5 sekund → timeout. Z kolejką: klient dostaje odpowiedź natychmiast, email idzie gdy serwis emailowy wróci do życia.

---

### SQL vs NoSQL — Arkusz Excela vs. szuflada z różnymi rzeczami

**SQL (PostgreSQL) to arkusz Excela z surową dyscypliną:**
Każdy wiersz musi mieć dokładnie te same kolumny. Chcesz dodać nowe pole? Dodajesz kolumnę dla wszystkich 10 milionów rekordów. Ale zysk: możesz pytać "pokaż mi wszystkie zamówienia użytkownika X z produktami z kategorii Y" — jeden `JOIN` i masz wynik.

**NoSQL (MongoDB, DynamoDB) to szuflada, gdzie każda kartka może być inna:**
Jeden dokument ma 3 pola, drugi 30, trzeci zagnieżdżone tablice. Elastyczny schemat, łatwe skalowanie poziome. Ale jeśli chcesz połączyć dane z dwóch szuflad... musisz to robić w kodzie aplikacji, nie w bazie.

Dla e-commerce: SQL jest domyślnym wyborem. Masz ustrukturyzowane relacje (użytkownicy ↔ zamówienia ↔ produkty), potrzebujesz transakcji ACID ("nalicz płatność I zmniejsz stock, albo żadne z nich"), korzystasz z kaskadowych `JOIN`.

---

### Skalowanie pionowe vs poziome — Jeden silniejszy kucharz vs. więcej kucharzy

**Skalowanie pionowe:** Twój kucharz jest przeciążony — dajesz mu szybszy nóż, większy garnek, silniejszą kuchenkę. Działa do pewnego momentu, ale ma fizyczny sufit. I nadal masz jeden punkt awarii — jeśli kucharz zachoruje, kuchnia stoi.

**Skalowanie poziome:** Zatrudniasz trzech kucharzy i stawiasz load balancer (maitre d'), który kieruje zamówienia po równo do każdego. Może obsłużyć 3x więcej gości. Jeden kucharz zachoruje — pozostałych dwóch przejmuje jego stoliki.

Ale żeby to działało, kucharze nie mogą mieć "tajnych notatek tylko dla siebie" — każdy musi mieć dostęp do tej samej lodówki (baza danych), tego samego regału na wino (Redis). Jeśli jeden kucharz zapisuje przepis na swojej kartce (pamięć lokalna serwera) — drugi go nie zobaczy. Dlatego stan musi żyć w zewnętrznych serwisach.

---

### Angular HTTP Interceptory — Bramki bezpieczeństwa na lotnisku

Wyobraź sobie lotnisko. Między pasażerem (żądanie HTTP) a samolotem (API) stoi kilka bramek.

**Interceptory to te bramki.** Każda bramka robi jedno zadanie:
- Bramka 1 (auth interceptor): "Czy masz ważny bilet (JWT)? Wkładam go do bagażu."
- Bramka 2 (logging interceptor): "Zapisuję, kto leci i o której."
- Bramka 3 (error interceptor): "Jeśli samolot zawróci z kodem 401 — wysyłam Cię po nowy bilet i próbuję ponownie."

Kluczowa zasada: każda bramka dostaje **niezmiennego pasażera** (`HttpRequest` jest immutable). Żeby go zmodyfikować, musisz zrobić klon: `req.clone({ headers: ... })`. To jak przepisanie biletu na nowy — oryginał zostaje bez zmian.

Interceptory funkcyjne (Angular 15+) są rejestrowane w dokładnej kolejności — to jak numerowane bramki. Stara wersja klasowa mogła wykonywać się w nieprzewidywalnej kolejności w zależności od DI — jak bramki bez numerów.

---

### Odświeżanie tokenu w interceptorze — Wachmistrz który wydaje nową przepustkę

Strażnik przy bramie sprawdza Twoją przepustkę (token dostępu). Ważność minęła — nie wpuszcza.

Zamiast odsyłać Cię z niczym, strażnik dyskretnie dzwoni do biura przepustek (endpoint `/auth/refresh`) i prosi o nową. Gdy dostanie — wbija ją do Twojego wniosku i otwiera bramę. Ty nie wiedziałeś, że cokolwiek się stało.

Problem: co jeśli 5 osób naraz trafi na wygasłą przepustkę? Bez synchronizacji — strażnik 5 razy dzwoni do biura. Rozwiązanie: `BehaviorSubject(isRefreshing)` — jeden stróż dzwoni, pozostałe cztery czekają w kolejce. Gdy nowa przepustka wróci, wszyscy dostają ją naraz.

Czego nigdy nie wolno: dać bramie przepisywać przepustki dla samego biura przepustek — to nieskończona pętla. Dlatego interceptor jawnie pomija URL `/auth/refresh`.

---

### Lazy Loading tras Angular — Sklep który zamawia towar dopiero na zamówienie

Wyobraź sobie sklep internetowy. Zły właściciel: zamawia cały asortyment (wszystkie 10 000 SKU) przed otwarciem — sklep ładuje się 30 sekund. Dobry właściciel: wystawia tylko ekspozycję, a pełny magazyn danej kategorii przyjeżdża dopiero gdy klient wejdzie do tego działu.

`loadComponent: () => import('./account/account.component')` to właśnie dobry właściciel. Bundle dla `/account` jest pobierany tylko gdy użytkownik nawiguje pod ten adres. Strona główna ładuje się szybko, bo pobiera tylko swój kod.

Różnica `loadChildren` vs `loadComponent`: `loadChildren` zamawia cały "dział" (plik z wieloma trasami), `loadComponent` zamawia pojedynczy "produkt" (jeden komponent). Użyj `loadComponent` dla tras-liści jak `/checkout/success`.

---

### `trackBy` i `track` w pętli `@for` — Numerki na kartonach

Masz 100 kartonów z zakupami na taśmociągu. Pracownik musi wiedzieć, który karton zmienił zawartość po przetasowaniu.

**Bez numerków (`track $index`):** Pracownik porównuje kartony po pozycji na taśmie. Jeśli wyrzucisz karton ze środka — każdy karton za nim zmienił "pozycję", więc pracownik uważa, że 99 kartonów wymaga ponownego pakowania. DOM niszczy i tworzy 99 węzłów.

**Z numerkami (`track item.id`):** Każdy karton ma przyklejony unikalny numer. Pracownik widzi: "karton #47 zniknął, #12 pojawił się nowy — reszta bez zmian". Dotyka tylko tych dwóch. Reszta DOM jest nieruszona — zachowany fokus, animacje, stan komponentu.

Pułapka `track $index`: gdy usuniesz element ze środka listy, każdy kolejny element zmienia indeks i jest traktowany jako "zmieniony". Zawsze track po stabilnym kluczu biznesowym (UUID, ID z bazy).

---

### Route Resolver vs `ngOnInit` — Maître d' vs. kelner

**`ngOnInit` (kelner):** Sadzasz gości przy stoliku natychmiast. Kelner przynosi menu (komponent się renderuje), a potem idzie do kuchni po danie (pobiera dane). Przez chwilę goście siedzą bez nic — widzisz spinner/skeleton.

**Resolver (maître d'):** Maître d' nie sadza gości, dopóki danie nie jest gotowe. Czekają przy wejściu (poprzednia trasa nadal widoczna), a przy stoliku pojawiają się tylko gdy jedzenie czeka. Komponent renderuje się z gotowymi danymi — zero spinnera.

Kompromis: z resolverem poprzednia strona "zamrożona" przez cały czas ładowania — może sprawiać wrażenie że aplikacja jest wolna. Z `ngOnInit` nawigacja jest natychmiastowa, ale komponent musi obsłużyć stan ładowania. Na szybkich łączach resolver jest elegancki; na wolnych — `ngOnInit` ze skeleton daje lepsze UX.

---

### Reaktywne Formularze vs. Szablonowe — Plan architektoniczny vs. szkic odręczny

**Formularz szablonowy (`ngModel`) to szkic na serwetce:**
Rysujesz coś szybko — łatwe do zrozumienia na pierwszy rzut oka, szybkie dla prostych przypadków. Ale gdy ktoś mówi "a teraz dodaj drugie piętro i kondygnację podziemną" — szkic zaczyna się nie nadawać.

**Formularz reaktywny (`FormGroup/FormControl`) to plan architektoniczny:**
Model jest w klasie, oddzielony od widoku. Możesz programowo dodawać/usuwać pola (`FormArray`), włączać/wyłączać kontrolki, walidować jedno pole w zależności od wartości innego — wszystko w TypeScript, z pełnym wsparciem IDE i testowalności jednostkowej bez dotykania DOM.

Wybierz formularz reaktywny gdy: dynamiczne pola, walidacja cross-field (hasło == potwierdzenie), kreatory wieloetapowe. Formularz szablonowy dla prostych 2–3 pól bez logiki.

---

### `ControlValueAccessor` — Adapter do gniazdka

Masz urządzenie z wtyczką angielską i gniazdko polskie. Adapter konwertuje kształty — urządzenie nie zmienia się, gniazdko nie zmienia się, adapter robi tłumaczenie.

`ControlValueAccessor` to adapter między niestandardowym komponentem UI (np. date picker, input numeru telefonu) a systemem formularzy Angular (`ngModel` / `formControlName`). Angular mówi "mam wartość, weź ją" (`writeValue`) — adapter ją wstawia do UI. UI mówi "użytkownik coś zmienił" (`registerOnChange`) — adapter powiadamia Angular.

Bez CVA: Twój date picker nie "rozmawia" z `FormGroup`. Z CVA: Angular traktuje go jak każdą inną kontrolkę formularza, kompletnie nie wiedząc jak jest zbudowany w środku.

---

### Wycieki pamięci i `takeUntilDestroyed()` — Kran bez zaworu

Wyobraź sobie kran w łazience. Gdy wychodzisz z pokoju hotelowego (komponent niszczony) — oczekujesz, że woda przestaje lecieć.

Ręczna subskrypcja Observable bez anulowania to kran, który zapominasz zakręcić. Observable żyje dalej po zniszczeniu komponentu, trzyma referencję do martwego obiektu — wyciek pamięci. Przez godzinę pracy aplikacja zużywa coraz więcej RAM.

`takeUntilDestroyed()` to automatyczny zawór z czujnikiem obecności: gdy komponent znika — zawór sam się zamyka. Musisz go tylko umieścić w odpowiednim miejscu rurociągu — **po** operatorach wyższego rzędu jak `switchMap`, nigdy przed. Inaczej zatykasz rurę przed rozgałęzieniem, a boczne gałęzie (wewnętrzne subskrypcje) nadal ciekną.

---

### Angular SSR — Serwer bez okien

Serwer Node.js to pokój bez okien. Nie ma `window`, nie ma `localStorage`, nie ma `document`. Angular SSR renderuje Twoje komponenty w tym pokoju — jeśli komponent próbuje otworzyć okno (`window.localStorage.getItem()`), dostaje błąd: "nie ma tu okna".

Trzy reguły przeżycia w SSR:
1. **`isPlatformBrowser()`** — sprawdź czy jesteś w pokoju z oknem, zanim sięgniesz po `localStorage`.
2. **`afterNextRender()`** — hook który odpali się tylko w przeglądarce, nigdy na serwerze.
3. **`TransferState`** — serwer pobiera dane z API, zapisuje na "kartce" i wkłada do HTML. Przeglądarka czyta kartę zamiast ponownie odpytywać API (unikasz podwójnego żądania HTTP).

---

### Hydratacja Angular — Meble wstawione vs. zburzone i postawione od nowa

Serwer renderuje HTML — to jakby ktoś urządził pokój. Przeglądarka go pobiera i wyświetla. Teraz Angular musi "ożywić" ten pokój (podłączyć nasłuchiwacze zdarzeń, przypiąć stan).

**Bez hydratacji (stara metoda):** Angular wchodzi do pokoju i mówi "zburzę wszystko i postawię od nowa, tak jak umiem". Miga — DOM zniszczony i odtworzony, użytkownik widzi flash of content.

**Pełna hydratacja (Angular 17+):** Angular wchodzi i mówi "ten mebel to `mat-button`, podepnę do niego `click` listener — ale nie ruszam mebla". DOM z serwera zostaje, Angular tylko "podłącza kabelki".

**Hydracja przyrostowa z `@defer`:** Kabelki do mebli w dalszych pokojach (poniżej zakładki) są podłączane dopiero gdy użytkownik tam wejdzie (lub przewinie viewport). Mniej JS na starcie = lepsze TTI.

---

### Node.js Streams — Rura z wodą vs. beczka

Masz plik CSV z 10 GB danych i chcesz go przetworzyć.

**Bez strumienia:** "Przelej całą beczulę do pamięci" — `fs.readFile()`. Twój serwer próbuje trzymać 10 GB w RAM. Prawdopodobnie zabraknie.

**Ze strumieniem:** Traktujesz plik jak rurę z wodą. Przetwarzasz po jednej "szklance" (chunk) na raz — `fs.createReadStream()`. RAM zużywa tylko tyle, ile mieści jeden chunk (kilka KB), niezależnie od rozmiaru pliku.

```typescript
// Strumieniowanie odpowiedzi HTTP bez ładowania pliku do pamięci:
fs.createReadStream('large-file.csv').pipe(res);
```

Cztery typy strumieni: Readable (rura tylko do czytania), Writable (rura tylko do zapisywania), Duplex (dwukierunkowy — jak WebSocket), Transform (filtr który modyfikuje wodę w transporcie — np. gzip).

---

### Kolejka mikrozadań vs. makrozadań — VIP a zwykła kolejka

Na koncercie masz dwie kolejki do baru: VIP i zwykłą.

**Mikrozadania (Promise `.then()`, MutationObserver)** to kolejka VIP. Po każdym "numerze" (zakończonym zadaniu synchronicznym) barman obsługuje **całą** kolejkę VIP do końca, zanim ktokolwiek ze zwykłej kolejki dostanie drinka.

**Makrozadania (`setTimeout`, `setInterval`, I/O callback)** to zwykła kolejka. Barman obsługuje jedną osobę, potem wraca sprawdzić VIP, potem obsługuje następną osobę ze zwykłej.

```javascript
setTimeout(() => console.log('makrozadanie'), 0);
Promise.resolve().then(() => console.log('mikrozadanie'));
// Wynik: "mikrozadanie", potem "makrozadanie"
// Mimo że setTimeout przyszedł pierwszy
```

Praktycznie: `Promise.resolve().then()` odpali się przed `setTimeout(fn, 0)`, nawet przy zerowym opóźnieniu.

---

### `process.nextTick` vs. `setImmediate` — Doskoczyć do szefa przed wyjściem vs. wrócić następnego dnia

Wychodzisz z biura (kończysz synchroniczny kod). Masz dwie opcje przekazania wiadomości szefowi:

**`process.nextTick(fn)`** — "zaczekam przy drzwiach i powiem szefowi zanim wyjdzie". Callback odpala się na końcu bieżącej operacji, **przed** jakimkolwiek I/O. Szef jest jeszcze w biurze, poczta nie dotarła.

**`setImmediate(fn)`** — "zostawię notatkę na biurku na jutro". Callback odpala się w następnej iteracji pętli zdarzeń, **po** zdarzeniach I/O. Poczta zdążyła dotrzeć.

Pułapka: nadużywanie `nextTick` w pętli to jak ciągłe zaczepianie szefa przy drzwiach — on nigdy nie wychodzi, poczta (I/O) nigdy nie dociera.

---

### Buforowanie modułów Node.js (`require` cache) — Bibliotekarz z katalogiem

Bibliotekarz jest zapytany o książkę "Prisma Guide". Idzie na półkę, przynosi ją, zapisuje w katalogu: "Prisma Guide — już wydana, leży przy ladzie".

Gdy drugi czytelnik pyta o tę samą książkę — bibliotekarz nie idzie po nią ponownie. Podaje tę samą kopię z lady.

`require()` działa identycznie. Pierwsze wywołanie: Node wykonuje plik modułu i zapamiętuje wynik w `require.cache`. Każde kolejne `require` w dowolnym pliku: zwraca ten sam zapamiętany obiekt. Dlatego **singletony działają w Node naturalnie** — `PrismaClient` załadowany raz jest tym samym obiektem dla każdego pliku który go importuje.

---

### `npm` vs. `npx` — Sklep narzędziowy vs. wypożyczalnia

**`npm install`** to wizyta w sklepie narzędziowym — kupujesz narzędzie i zostawiasz je w szufladzie (`node_modules`). Używasz go wielokrotnie.

**`npx prisma generate`** to wypożyczalnia. Mówisz "potrzebuję narzędzia Prisma CLI, teraz, na chwilę". Jeśli masz je w `node_modules` — bierze stamtąd. Jeśli nie — pobiera tymczasowo, uruchamia, sprząta po sobie. Nie zaśmieca globalnej przestrzeni.

Kiedy używać `npx`: jednorazowe CLI, narzędzia do scaffoldingu (`npx create-react-app`), gdy nie chcesz instalować czegoś globalnie i zaśmiecać PATH.

---

### Idempotentność — Przycisk windy

Stoisz przy windzie i naciskasz przycisk "3. piętro". Efekt: winda jedzie na 3. piętro.

Naciskasz przycisk 10 razy z nerwów — winda **nadal** jedzie na 3. piętro. Nie jedzie 10 razy. Wynik jest identyczny niezależnie od liczby naciśnięć.

**Idempotentne metody HTTP działają tak samo.** `GET /products/123` wywołany 10 razy zwraca ten sam produkt 10 razy — bez efektów ubocznych. `DELETE /products/123` wywołany dwa razy: raz usuwa, drugi raz zwraca `404` — ale baza danych jest w tym samym stanie (produkt nie istnieje).

`POST` jest **nieidempotentny** — to jak przycisk "wyślij wiadomość". Każde naciśnięcie wysyła nową wiadomość. Dlatego ponowienie nieudanego `POST /orders` bez klucza idempotencji tworzy zduplikowane zamówienie. Rozwiązanie: klient generuje UUID i wysyła w nagłówku `Idempotency-Key` — serwer rozpoznaje zduplikowane żądanie i zwraca ten sam wynik bez tworzenia nowego rekordu.

---

### Wersjonowanie API — Wersje formularza podatkowego

Urząd skarbowy co roku wydaje nowy formularz PIT. Problem: miliony podatników wypełniają jeszcze stary PIT-37 za poprzedni rok, a jednocześnie nowi składają PIT-40.

Urząd nie może po prostu usunąć starego formularza — musi obsługiwać oba równolegle.

Wersjonowanie URI (`/api/v1/`, `/api/v2/`) to właśnie utrzymywanie obu okienek:
- Stary klient (app mobilna z zeszłego roku) trafia do `v1` — dostaje stary format odpowiedzi
- Nowy klient trafia do `v2` — dostaje nowy format z dodatkowymi polami

Praktycznie: wersjonuj URI gdy zmieniasz **kształt odpowiedzi** (dodajesz/usuwasz pola, zmieniasz typy). Nie musisz wersjonować dla dodania nowych endpointów — to nie jest breaking change. Usuwaj stare wersje po poinformowaniu klientów z wyprzedzeniem (deprecation notice).

---

### Unieważnianie cache — Produkt z datą ważności

Sklep zamówił 100 paczek mleka z datą ważności jutro. Dziś sprzedał 50 — ale na półce nadal stoi 100. Klient kupuje "świeże mleko", dostaje stare.

Cache bez unieważniania działa tak samo. Buforujesz "Stan magazynowy: 15 szt." na 60 sekund. W tym czasie ktoś kupuje ostatnią sztukę — baza mówi 0, cache nadal mówi 15. Następny klient widzi "W magazynie" i składa zamówienie... którego nie możesz zrealizować.

Trzy strategie:
- **TTL (krótka data ważności):** Cache wygasa po 60s — prosto, ale przez 59s możesz pokazywać nieaktualne dane. Akceptowalne dla rzadko zmieniających się danych (kategorie, opisy).
- **Write-through:** Gdy zapis do DB — natychmiast aktualizuj cache. Spójne, ale każdy zapis jest wolniejszy. Akceptowalne dla produktów premium.
- **Cache-aside z jawnym usunięciem:** Gdy sprzedajesz ostatnią sztukę — `cache.del('stock:product-123')`. Następny odczyt trafi do DB i wypełni cache świeżą wartością. Najczęstszy wzorzec w NestJS + Redis.

---

### Mikroserwisy — Koszty ukryte w centrum handlowym

Centrum handlowe brzmi świetnie — dopóki nie zostaniesz zarządcą.

- Każdy sklep potrzebuje osobnego alarmu, osobnego sprzątacza, osobnej ochrony (**per-serwis CI/CD, monitoring, logging**).
- Gdy klient chce zwrócić buty kupione kartą z jednego sklepu i wymienić na towar z drugiego — musisz koordynować dwie kasy (**transakcje rozproszone — brak prostego rollbacka**).
- Jeśli sklep z elektroniką nie odpowiada — musisz zadecydować: czy cała galeria stoi, czy pozostałe sklepy nadal działają? (**circuit breaker, timeout, retry policy**).
- Nowy pracownik musi nauczyć się 10 różnych systemów zamiast jednego (**złożoność onboardingu**).

Mikroserwisy zaczynają się opłacać gdy różne "sklepy" mają **radykalnie różne potrzeby skalowania** (kasa fiskalna vs. dział z ubraniami) lub gdy **różne zespoły** nie mogą synchronizować deploymentów. Dla startupu lub małego zespołu — dobrze ustrukturyzowany monolit bije centrum handlowe przez 3–4 lata.

---

### Trzy warstwy cache — Magazyn, oddział, kieszeń

Zamawiasz produkt z odległego magazynu centralnego (baza danych). Trzy poziomy gdzie może czekać:

**Baza danych = magazyn centralny:** Zawsze aktualne, ale transport trwa — `SELECT` z Postgressa to podróż przez sieć do bazy.

**Redis (cache serwera) = oddział regionalny:** Zamawiałeś ten produkt tydzień temu — oddział ma go na stanie. Odpowiedź w < 1 ms zamiast 20 ms do bazy. TTL decyduje kiedy "produkt wychodzi z obrotu" i musi być zamówiony świeży.

**CDN + przeglądarka = kieszeń:** Statyczne zasoby (logo, CSS, JS) masz już na telefonie. Nie wysyłasz nawet żądania — czytasz z lokalnego cache. Haszowane nazwy plików (`main.abc123.js`) pozwalają trzymać je rok z `max-age=31536000`.

Każda warstwa redukuje obciążenie warstwy poniżej. Cel: większość żądań odpada na przeglądarce lub CDN, zanim dotrą do serwera. Do bazy trafia tylko to, czego naprawdę nie ma nigdzie bliżej.

---

## 1. Przebieg procesu

Na podstawie recenzji Glassdoor i opublikowanych wskazówek CGI:

| Etap | Format | Czas trwania |
|---|---|---|
| 1. Rozmowa HR/rekruter | Telefon lub Teams — motywacja, dostępność, poziom angielskiego | 15–20 min |
| 2. Rozmowa techniczna | Rozmowa na żywo — oceń siebie w każdej technologii (1–5), potem pytania z tych ocen | 20–30 min |
| 3. Oferta / informacja zwrotna | Zazwyczaj 1–2 tygodnie później; CGI wysyła ankietę satysfakcji bez względu na wynik |

**Sygnały CGI-specific od kandydatów:**
- Wszyscy kandydaci otrzymują **te same podstawowe pytania** (wystandaryzowany proces dla zachowania uczciwości).
- Rekruterzy często zaczynają od: *"Oceń siebie od 1 do 5 w Angular / Node.js / AWS"* — bądź szczery, pytania będą dotyczyć Twoich mocnych stron.
- Runda techniczna ma charakter konwersacyjny, nie jest testem kodowania. Dla stażystów nie ma live-codingu na tablicy.
- Metoda STAR oczekiwana przy wszelkich pytaniach scenariuszowych ("Opowiedz mi o sytuacji kiedy…").
- Klient jest kanadyjski — płynność angielskiego jest aktywnie oceniana przez całą rozmowę.

---

## 2. AWS Lambda (temat o najwyższym priorytecie — wymieniony pierwszy w ofercie pracy)

### Podstawowe koncepcje, które musisz umieć wyjaśnić

**P: Czym jest AWS Lambda i jaki problem rozwiązuje?**  
Lambda to bezserwerowy serwis obliczeniowy — przesyłasz funkcję, definiujesz wyzwalacz, a AWS całkowicie zarządza provisionowaniem, skalowaniem i serwerami. Płacisz tylko za wywołanie i czas wykonania (przyrosty 100 ms), nie za czas bezczynności. Rozwiązuje narzut zarządzania serwerami dla workloadów sterowanych zdarzeniami lub nieregularnych.

**P: Co wyzwala funkcję Lambda?**  
Dowolne źródło zdarzeń AWS: API Gateway (HTTP), S3 (przesyłanie/usuwanie pliku), DynamoDB Streams, wiadomości SQS/SNS, harmonogramy EventBridge, Cognito lub bezpośrednie wywołania SDK. Dla tej roli najbardziej istotne jest API Gateway → Lambda (bezserwerowe REST API).

**P: Czym jest cold start i dlaczego ma znaczenie?**  
Gdy nie istnieje ciepłe środowisko wykonawcze, Lambda musi zainicjalizować runtime i załadować kod przed uruchomieniem. Dodaje to opóźnienie — zazwyczaj 100 ms–1 s w zależności od języka i rozmiaru pakietu. Node.js ma znacznie niższe czasy cold start niż Java lub .NET. Sposoby łagodzenia: utrzymuj mały bundle, używaj Provisioned Concurrency dla ścieżek wrażliwych na opóźnienia, unikaj ciężkich `require()` na poziomie modułu.

**P: Jakie są twarde limity Lambda?**  
| Limit | Wartość |
|---|---|
| Maksymalny timeout wykonania | 15 minut (900 s) |
| Maksymalna pamięć | 10 240 MB |
| Pakiet wdrożeniowy (zspakowany) | 50 MB (250 MB rozpakowany) |
| Równoczesne wykonania (domyślnie) | 1 000 na region (limit miękki, można podnieść) |
| Payload odpowiedzi (synchroniczny) | 6 MB |

**P: Jaka jest różnica między synchronicznym a asynchronicznym wywołaniem Lambda?**  
- **Synchroniczne** (API Gateway, SDK `RequestResponse`): caller czeka na wynik; błędy są natychmiast propagowane.  
- **Asynchroniczne** (S3, SNS, EventBridge): Lambda kolejkuje zdarzenie; caller otrzymuje natychmiastowe 202. Lambda ponawia do 2 razy przy niepowodzeniu. Dead Letter Queue (DLQ) lub Lambda Destinations może przechwytywać nieudane zdarzenia.

**P: Jak skaluje Lambda?**  
Automatycznie — każde równoczesne wywołanie działa we własnym izolowanym środowisku. Brak ręcznego skalowania. Limit współbieżności na poziomie konta (domyślnie 1 000) jest pułapem; możesz zarezerwować współbieżność per funkcja, żeby ją zagwarantować lub ograniczyć.

**P: Jak połączyć Lambda z bazą danych jak PostgreSQL?**  
Użyj RDS Proxy jako poolera połączeń — funkcje Lambda mogą uruchamiać setki równoczesnych środowisk, każde otwierające połączenie DB, co wyczerpuje `max_connections` Postgres. RDS Proxy buforuje i multipleksuje te połączenia. Alternatywnie, dla prostych przypadków, użyj połączenia wewnątrz handlera i polegaj na ponownym użyciu środowiska wykonawczego.

**P: Jaki jest cykl życia środowiska wykonawczego Lambda?**  
`Init` → `Invoke` → (kontener zamrożony) → `Invoke` ponownie (ciepły) → … → `Shutdown`. Kod poza handlerem wykonuje się raz podczas Init i jest ponownie używany między ciepłymi wywołaniami — dobre miejsce dla połączeń DB lub klientów SDK.

**P: Lambda vs EC2 vs ECS — kiedy wybrałbyś Lambda?**  
Lambda: krótkotrwałe, sterowane zdarzeniami, zmienny ruch, < 15 min wykonania.  
EC2/ECS: długotrwałe procesy, trwałe połączenia (WebSockets), zadania intensywne CPU, workloady wymagające precyzyjnej kontroli OS.

---

## 3. Node.js

**P: Czym jest pętla zdarzeń i dlaczego ma znaczenie dla Node.js?**  
Node działa na jednym wątku, ale deleguje I/O (system plików, sieć, timery) do puli wątków `libuv` i asynchronicznych API OS. Pętla zdarzeń pobiera zakończone callbacki z kolejki. To czyni Node doskonałym dla pracy I/O-bound (REST API, handlery Lambda), ale słabym dla zadań intensywnych CPU (przetwarzanie obrazów, szyfrowanie w skali) — te blokują wątek.

**P: Jaka jest różnica między `callback`, `Promise` i `async/await`?**  
Wszystkie trzy obsługują operacje asynchroniczne. Callbacki to stary wzorzec (Node-style `(err, result)`). Promise łączy `.then()/.catch()` i jest kompozycyjny. `async/await` to cukier syntaktyczny nad Promise — czystszy, try/catch działa naturalnie. Dla handlera Lambda zawsze zwracaj Promise lub używaj `async`.

**P: Czym jest middleware w Express.js?**  
Funkcja z sygnaturą `(req, res, next)` siedząca w potoku żądań. Middleware może czytać/modyfikować req i res, kończyć cykl lub wywoływać `next()`, żeby przekazać kontrolę dalej. Przykłady: parsery ciała, sprawdzanie uwierzytelniania, nagłówki CORS, handlery błędów.

**P: Jaka jest różnica między `require()` a `import`?**  
`require()` to CommonJS (historyczny system modułów Node, synchroniczny). `import` to ES Modules (statyczny, może być tree-shakowany przez bundlery). Dla Lambda z Node 18+, oba działają; `import` wymaga `"type": "module"` w `package.json` lub rozszerzenia `.mjs`.

**P: Jak obsługujesz błędy w asynchronicznej trasie Express?**  
Owiń w try/catch i wywołaj `next(error)`, lub użyj wrappera. Express 5 obsługuje odrzucone Promise automatycznie; Express 4 wymaga jawnego przekazywania. Globalny middleware błędów `(err, req, res, next)` przechwytuje wszystko.

**P: Czym jest `process.env` i dlaczego jest istotne w Lambda?**  
Zmienne środowiskowe wstrzykiwane w runtime. W Lambda konfigurujesz je w konfiguracji funkcji (lub przez Parameter Store / Secrets Manager dla sekretów). Nigdy nie hardkoduj poświadczeń — zawsze odczytuj z `process.env.MY_SECRET`.

**P: Jak strukturyzujesz funkcję Lambda Node.js dla endpointu REST API?**  
```
exports.handler = async (event) => {
  const { pathParameters, body } = event;
  // parsuj, waliduj, wywołaj serwis, zwróć
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  };
};
```
API Gateway mapuje metodę HTTP/ścieżkę na tę funkcję i konwertuje odpowiedź z powrotem na HTTP.

---

## 4. Angular

**P: Jaka jest różnica między Component a Service w Angular?**  
**Component** posiada widok (szablon + style) i obsługuje logikę UI. **Service** to klasa przechowująca logikę biznesową, pobieranie danych lub współdzielony stan — wstrzykiwana przez kontener DI Angular. Serwisy są zazwyczaj singletonami (jedna instancja na zakres injektora).

**P: Czym jest Dependency Injection Angular i jak działa?**  
Angular utrzymuje drzewo injektorów. Gdy klasa deklaruje zależność w konstruktorze (np. `constructor(private http: HttpClient)`), Angular rozwiązuje ją z najbliższego injektora. `@Injectable({ providedIn: 'root' })` czyni serwis singletonem w całej aplikacji.

**P: Czym są Standalone Components (Angular 14+/17)?**  
Komponenty deklarowane bez `NgModule` — mają własną tablicę `imports`. Angular 17+ używa standalone domyślnie. To nowoczesny wzorzec; eliminuje boilerplate rejestracji modułu.

**P: Jaka jest różnica między `ngOnInit` a konstruktorem?**  
Konstruktor służy tylko do konfiguracji DI — Angular nie ustawił jeszcze powiązań `@Input()`. `ngOnInit` odpala po tym jak Angular zainicjalizuje komponent i ustawi wszystkie inputy. Pobieranie danych należy do `ngOnInit`.

**P: Czym jest `async` pipe i dlaczego jest preferowany nad ręcznymi subskrypcjami?**  
`| async` w szablonie subskrybuje Observable/Promise, renderuje wartość i **automatycznie anuluje subskrypcję** przy zniszczeniu komponentu. Ręczne subskrypcje wymagają `ngOnDestroy` + `unsubscribe()` — zapomnienie powoduje wycieki pamięci.

**P: Jaka jest różnica między `Observable` a `Promise`?**  
Promise rozwiązuje się raz. Observable emituje 0–N wartości w czasie i jest anulowalny. `HttpClient` Angular zwraca Observables. Użyj `firstValueFrom()`, żeby skonwertować na Promise gdy potrzeba.

**P: Jak działa routing Angular?**  
`RouterModule.forRoot(routes)` rejestruje konfigurację tras. `<router-outlet>` to miejsce gdzie renderują się dopasowane komponenty. Guardy `canActivate` działają przed nawigacją — `authGuard` to powszechny wzorzec chroniący trasy wymagające logowania.

**P: Czym jest lazy loading modułu trasy?**  
```typescript
{ path: 'account', loadComponent: () => import('./account/account.component') }
```
Bundle dla tej trasy jest pobierany dopiero gdy użytkownik tam nawiguje — redukuje rozmiar początkowego bundla (ważne dla Core Web Vitals).

**P: Jak przekazujesz dane między komponentem nadrzędnym a potomnym?**  
- Nadrzędny → Potomny: property binding `@Input()` `[data]="value"`.  
- Potomny → Nadrzędny: `@Output()` EventEmitter `(event)="handler($event)"`.

**P: Czym jest RxJS i podaj jeden praktyczny przykład?**  
Biblioteka do reaktywnego programowania z Observables. Praktyczny przykład: debouncing inputu wyszukiwania, żeby API było wywoływane 300 ms po zatrzymaniu pisania przez użytkownika:
```typescript
this.searchControl.valueChanges.pipe(
  debounceTime(300),
  distinctUntilChanged(),
  switchMap(query => this.api.search(query))
).subscribe(results => this.results = results);
```

---

## 5. Architektura

**P: Jaka jest różnica między architekturą monolityczną a mikroserwisami?**  
**Monolit** to jedna wdrożeniowa jednostka — prostsza do rozwijania początkowo, trudniejsza do niezależnego skalowania. **Mikroserwisy** dzielą system na małe, niezależnie wdrażalne serwisy, każdy posiadający własne dane. Korzyści: niezależne skalowanie, izolowane awarie, polieglotyczne technologie. Koszt: złożoność systemu rozproszonego (wywołania sieciowe, ostateczna spójność, obserwowalność).

**P: Czym jest architektura serverless i kiedy byś jej użył?**  
Funkcje wdrożone jako Lambda (lub odpowiednik) + zarządzane serwisy dla DB, storage, kolejek. Brak serwerów do zarządzania, skaluje do zera. Najlepsze dla: zmiennego/nieprzewidywalnego ruchu, przepływów sterowanych zdarzeniami, szybkiego prototypowania. Nie idealny dla: niskoopóźnieniowego czasu rzeczywistego (cold starty), długotrwałych zadań, aplikacji intensywnie używających WebSocket.

**P: Czym jest REST i co czyni API RESTful?**  
REST (Representational State Transfer) to styl architektoniczny. Kluczowe ograniczenia: bezstanowy (brak sesji na serwerze), zasoby identyfikowane przez URI, metody HTTP (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`) niosą semantyczne znaczenie, odpowiedzi to reprezentacje (JSON/XML). RESTful API używa poprawnie czasowników HTTP, zwraca właściwe kody statusu (201 Created, 400 Bad Request, 404 Not Found, itp.) i jest bezstanowy.

**P: Jaka jest różnica między bazami SQL a NoSQL?**  
SQL (relacyjne): sztywny schemat, transakcje ACID, potężne joiny. Najlepsze gdy relacje danych mają znaczenie (zamówienia ↔ użytkownicy ↔ produkty). NoSQL (dokumentowe, klucz-wartość, grafowe): elastyczny schemat, pozioma skalowalność, ostateczna spójność. Najlepsze dla dużego wolumenu prostych odczytów/zapisów, nieustrukturyzowanych danych lub buforowania (Redis).

**P: Czym jest API Gateway w kontekście AWS?**  
Zarządzany serwis siedzący przed funkcjami Lambda (lub innymi backendami) obsługujący: routing HTTP, uwierzytelnianie (Cognito/JWT), throttling, CORS, transformację żądań/odpowiedzi i terminację TLS. To "przednie drzwi" dla bezserwerowych REST API.

**P: Czym jest pipeline CI/CD?**  
Continuous Integration: automatyczny build + testy przy każdym push. Continuous Deployment/Delivery: automatyczne wdrożenie na staging lub produkcję gdy CI przejdzie. Narzędzia: GitHub Actions, GitLab CI, Jenkins. Kluczowe etapy: install → build → test → deploy.

**P: Jak zabezpieczysz bezserwerowe REST API?**  
- Tokeny JWT Bearer walidowane przez API Gateway (Cognito Authorizer lub Lambda Authorizer).
- Tylko HTTPS (API Gateway wymusza TLS).
- Role IAM per Lambda z zasadą najmniejszych uprawnień.
- Sekrety przez AWS Secrets Manager, nie zmienne środowiskowe plaintext.
- Rate limiting przez plany użycia API Gateway.

---

## 6. Prawdopodobne pytania szybkie / miękkie (format 30-min — spodziewaj się 2–3 z tych)

- "Oprowadź mnie przez projekt który zbudowałeś — stack technologiczny, Twoja rola, co poszło nie tak."
- "Jaka jest różnica między `==` a `===` w JavaScript?" (`===` sprawdza typ + wartość)
- "Czym jest TypeScript i dlaczego go używać zamiast zwykłego JavaScript?" (statyczne typowanie, wsparcie IDE, łapie błędy w czasie kompilacji)
- "Jak podchodzisz do debugowania nieudanego wywołania API w Angular?" (zakładka Network, sprawdź kod statusu, sprawdź payload żądania, sprawdź CORS, sprawdź interceptory)
- "Co robi `async/await` pod maską?" (cukier syntaktyczny nad Promise, zwraca Promise, `await` zawiesza wykonanie wewnątrz funkcji async, nie blokuje wątku)
- "Jak byś testował komponent Angular?" (Jasmine + Karma przez `TestBed`, mock serwisów przez `jasmine.createSpyObj`)

---

## 7. Pytania do zadania rekruterowi (przygotuj 2–3)

1. "Jak wygląda typowy pierwszy miesiąc dla stażysty — jest strukturyzowany onboarding czy od razu trafia się na projekty klientów?"
2. "Jakich serwisów AWS zespół używa najczęściej poza Lambda — API Gateway, DynamoDB, SQS?"
3. "Czy projekt Angular to nowy build czy istniejąca codebase? Na której wersji jesteście?"
4. "Jak egzekwowana jest jakość kodu — przeglądy PR, automatyczny linting, progi pokrycia testami?"

---

## 8. Przewodnik czasowy rozmowy 30-minutowej

| Minuta | Oczekiwana treść |
|---|---|
| 0–5 | Intro, background, sprawdzenie poziomu angielskiego ("opowiedz mi o sobie") |
| 5–10 | Samoocena każdej technologii + pierwsze pytanie Angular |
| 10–17 | Node.js + kluczowe pytania AWS Lambda |
| 17–24 | Pytanie architektoniczne (REST, serverless lub mikroserwisy) |
| 24–28 | Jedno pytanie behawioralne / projektowe |
| 28–30 | Twoje pytania + następne kroki |

---

## 9. Kluczowe rzeczy do zapamiętania o CGI

- Założona w 1976, jedna z największych globalnych firm konsultingowych IT (90 000+ pracowników).
- Biuro w Warszawie obsługuje klientów międzynarodowych — klient kanadyjski przy tej roli.
- Kultura: nazywają pracowników "Partnerami", kładą nacisk na własność i długoterminowe kariery.
- Jawnie poszukują autentycznego entuzjazmu i nastawienia na rozwój, nie tylko technicznej perfekcji.
- Metoda STAR dla wszelkich pytań "opowiedz mi o sytuacji gdy…".

---

## 10. Baza pytań i odpowiedzi (wyłącznie po polsku)

**Samoocena:**

| Technologia | Ocena | Uzasadnienie |
|---|---|---|
| Angular | 4 / 5 | Prawdziwa aplikacja produkcyjna — standalone components, interceptory, guardy, RxJS, SSR, lazy loading |
| Node.js | 3 / 5 | Przez NestJS (Express pod spodem); silne async/await, słabsze znajomość wewnętrznych mechanizmów Node |
| AWS Lambda | 2 / 5 | Rozumienie konceptualne, brak praktycznego doświadczenia produkcyjnego |
| Architektura | 3 / 5 | Zbudowałem prawdziwy monolit NestJS z REST, webhookami, kolejkami, PostgreSQL, Redis, wdrożeniem |

---

### Angular — Ocena 4/5

---

**A1**

**P:** Jaka jest różnica między strategiami wykrywania zmian Default i OnPush i kiedy powinieneś wybrać OnPush?

**O:** Strategia Default sprawdza całe drzewo komponentów od góry po każdym zdarzeniu asynchronicznym (kliknięcie, timer, odpowiedź HTTP), niezależnie od tego, który komponent faktycznie zmienił dane. OnPush ogranicza sprawdzanie do trzech przypadków: zmiana referencji `@Input`, zdarzenie pochodzące z własnego szablonu komponentu lub jawne wywołanie `ChangeDetectorRef.markForCheck()` / `AsyncPipe`. Powinieneś domyślnie stosować OnPush dla wszystkich komponentów prezentacyjnych z niezmiennymi inputami — drastycznie redukuje liczbę sprawdzeń przy skali. Kompromis: musisz przekazywać nowe referencje obiektów/tablic zamiast mutować je w miejscu, inaczej Angular nie wykryje zmiany. Łącz z `async` pipe lub Signals, żeby subskrypcje automatycznie wywoływały `markForCheck()`.

---

**A2**

**P:** Komponent używający OnPush nie odzwierciedla aktualizacji danych z subskrypcji serwisu. Jakie są prawdopodobne przyczyny i jak je naprawić?

**O:** Dwie najczęstsze przyczyny to: (1) mutowanie obiektu w miejscu (np. `this.items.push(x)`) zamiast zastępowania referencji oraz (2) ręczna subskrypcja przez `.subscribe()` wewnątrz komponentu — Angular sprawdza komponent poza cyklem subskrypcji, więc szablon nigdy nie widzi nowej wartości. Rozwiązanie (1): stwórz nową referencję: `this.items = [...this.items, x]`. Rozwiązanie (2): użyj `async` pipe (który wywołuje `markForCheck()` przy każdej emisji) lub wstrzyknij `ChangeDetectorRef` i wywołaj `this.cdr.markForCheck()` wewnątrz callbacka. Jeśli aktualizacja pochodzi spoza Angular (np. biblioteka WebSocket), upewnij się, że `NgZone.run()` owija emisję, żeby wróciła do strefy Angular przed wywołaniem CD.

---

**A3**

**P:** Jak interceptory HTTP w Angularze tworzą łańcuch i jaka jest różnica między interceptorami opartymi na klasach a funkcyjnymi?

**O:** Interceptory tworzą potok: każdy interceptor otrzymuje wychodzący `HttpRequest` i funkcję `next` wskazującą na następny interceptor. Interceptory oparte na klasach implementują `HttpInterceptor` i są rejestrowane przez multi-provider `HTTP_INTERCEPTORS`; kolejność ich wykonania zależy od kolejności rozwiązywania DI, co może być nieprzewidywalne. Interceptory funkcyjne (zalecane od Angular 15+) to zwykłe funkcje rejestrowane przez `withInterceptors([...])` w `provideHttpClient()` i wykonywane w dokładnie zadeklarowanej kolejności. Kluczowa zasada: obiekty `HttpRequest` są niemutowalne, więc musisz wywołać `req.clone({ headers: req.headers.set(...) })`, żeby je zmodyfikować przed przekazaniem do `next(req)`.

---

**A4**

**P:** Opisz implementację interceptora odświeżającego token, który ponawia pierwotne żądanie po odświeżeniu wygasłego tokenu dostępu, bez powodowania nieskończonej pętli.

**O:** Interceptor przechwytuje odpowiedzi 401, wywołuje `refreshToken()` z serwisu auth (Observable), a następnie używa `switchMap`, żeby wstawić nowy token do sklonowanego żądania i przekazać go do `next()`. Żeby zapobiec nieskończonej pętli, dodaj flagę `BehaviorSubject` (`isRefreshing`) — jeśli odświeżanie jest już w toku, kolejne 401 czekają przez `switchMap` na tym Subject zamiast wywoływać odświeżanie ponownie. Jeśli samo odświeżanie zwróci 401, złap błąd, wyczyść stan auth, przekieruj do logowania i użyj `throwError`. Upewnij się, że interceptor jawnie pomija endpoint odświeżania (`req.url.includes('/auth/refresh')`), żeby uniknąć rekurencji.

---

**A5**

**P:** Jaka jest różnica między `switchMap`, `mergeMap`, `concatMap` i `exhaustMap`? Podaj praktyczny przykład użycia każdego.

**O:** Wszystkie cztery to operatory spłaszczające, które subskrybują wewnętrzny Observable przy każdej emisji, różnią się jednak obsługą współbieżności. `switchMap` anuluje poprzednią subskrypcję gdy nadejdzie nowa emisja — idealny do wyszukiwania z podpowiedziami. `mergeMap` utrzymuje wszystkie subskrypcje aktywne jednocześnie — dobre do zdarzeń analitycznych. `concatMap` kolejkuje Observables i subskrybuje następny dopiero gdy poprzedni się zakończy — właściwy dla operacji sekwencyjnych. `exhaustMap` ignoruje nowe emisje gdy aktywny jest wewnętrzny Observable — właściwy dla przycisku logowania (zapobiega podwójnemu wysłaniu). Zawsze umieszczaj `takeUntilDestroyed()` **po** operatorze spłaszczającym, nie przed.

---

**A6**

**P:** Jaka jest różnica między Angular Signals a RxJS Observables i jak decydujesz, którego użyć?

**O:** Signals to synchroniczne, reaktywne prymitywy "pull-based" do reprezentowania bieżącego stanu — możesz odczytać wartość sygnału w dowolnym momencie, a renderer Angular automatycznie śledzi zależności. Observables to strumienie "push-based" reprezentujące wartości w czasie, z bogatą algebrą operatorów. Praktyczna heurystyka: używaj Signals dla lokalnego stanu komponentu, wartości pochodnych (`computed()`) i wszystkiego, co chcesz odczytać synchronicznie w szablonie. Używaj Observables dla żądań HTTP, strumieni WebSocket, zdarzeń routera i operacji korzystających z `retry`, `debounceTime` lub `combineLatest`. Integrują się czysto: `toSignal()` konwertuje Observable na Signal; `toObservable()` w drugą stronę.

---

**A7**

**P:** Jakie są implikacje "problemu diamentu" / glitch przy używaniu `combineLatest` z dwoma Observables ze wspólnym źródłem i jak Signals go rozwiązują?

**O:** Gdy dwa Observables wywodzące się z tego samego źródła są łączone przez `combineLatest`, jedna emisja nadrzędna powoduje, że oba strumienie pochodne emitują szybko po sobie, co sprawia, że `combineLatest` odpala się dwa razy. W szablonie może to powodować dwa re-rendery lub dwa wywołania API. Angular Signals rozwiązuje to przez grupowanie synchronicznych aktualizacji: jeśli dwie wartości `computed` zależą od tego samego sygnału i zaktualizujesz sygnał źródłowy, Angular planuje jednorazowe synchroniczne przeliczenie wszystkich wartości pochodnych przed re-renderem, gwarantując dokładnie jeden wynik na logiczną zmianę stanu.

---

**A8**

**P:** Jak `async` pipe w Angularze zarządza subskrypcjami i jaką przewagę ma nad ręcznym `.subscribe()` w komponencie?

**O:** `async` pipe subskrybuje Observable (lub Promise) przy inicjalizacji komponentu i automatycznie anuluje subskrypcję, gdy komponent jest niszczony — zapobiega wyciekom pamięci bez żadnego ręcznego czyszczenia. Przy każdej nowej emisji wywołuje wewnętrznie `ChangeDetectorRef.markForCheck()`, co czyni go w pełni kompatybilnym z komponentami `OnPush`. Ręczne `.subscribe()` wymaga jawnego anulowania subskrypcji (przez `takeUntilDestroyed()`, `Subject + takeUntil` lub `Subscription.unsubscribe()` w `ngOnDestroy`) oraz przechowywania wartości w polu komponentu. `async` pipe eliminuje pośrednią właściwość — możesz wiązać bezpośrednio w szablonie.

---

**A9**

**P:** Wyjaśnij hierarchię wstrzykiwania zależności w Angularze. Jaka jest różnica między `providedIn: 'root'`, modułem funkcyjnym, `providers` komponentu i `viewProviders`?

**O:** `providedIn: 'root'` rejestruje serwis w głównym injektorze — prawdziwy singleton w całej aplikacji, tree-shakowalny jeśli nigdy nie jest wstrzykiwany. Dostarczanie w lazy-loaded module tworzy child injector ograniczony do tego modułu — oddzielną instancję od root. Dostarczanie w tablicy `providers` komponentu tworzy nową instancję dla tego komponentu i wszystkich jego dzieci (włącznie z content projection przez `<ng-content>`); każda instancja komponentu ma własną instancję serwisu. `viewProviders` działa tak samo, ale serwis jest niewidoczny dla projektowanej treści — tylko drzewo widoku komponentu może go wstrzyknąć, co ma znaczenie dla złożonych kontrolek formularza.

---

**A10**

**P:** Czym są `InjectionToken`y i kiedy są potrzebne zamiast providera opartego na klasie?

**O:** `InjectionToken` tworzy unikalny token DI dla wartości, które nie mogą lub nie powinny być typowane jako klasa — obiekty konfiguracyjne, prymitywy, interfejsy (wymazywane w runtime) lub gdy chcesz dostarczyć wiele implementacji tego samego konceptu. Przykład: `export const API_URL = new InjectionToken<string>('API_URL')` sparowany z `{ provide: API_URL, useValue: environment.apiUrl }`. Wstrzykujesz przez `inject(API_URL)` lub `@Inject(API_URL)`. Multi-providerzy (`multi: true`) rozszerzają to do zbierania tablicy implementacji pod jednym tokenem — token `HTTP_INTERCEPTORS` używa dokładnie tego wzorca.

---

**A11**

**P:** Czym jest route resolver i jak różni się od ładowania danych w `ngOnInit`? Kiedy wybrać jeden zamiast drugiego?

**O:** Resolver implementuje `ResolveFn<T>` i działa przed aktywacją trasy — router czeka na zakończenie zwróconego Observable/Promise i dołącza wynik do `route.data`. Komponent renderuje się dopiero gdy dane są dostępne. Kompromis: poprzedni widok pozostaje widoczny do czasu rozwiązania, co może sprawiać wrażenie powolności na wolnych łączach. `ngOnInit` zapewnia natychmiastową nawigację z lokalnymi stanami ładowania/błędu — lepsze dla postrzeganej wydajności. Wybierz resolvery gdy komponent nie może sensownie się renderować bez danych lub gdy wiele siostrzanych komponentów na tej samej trasie potrzebuje tych samych wstępnie pobranych danych.

---

**A12**

**P:** Jak lazy-loaded routes poprawiają wydajność i jaka jest różnica między `loadChildren` a `loadComponent`?

**O:** Lazy loading dzieli aplikację na osobne chunki JS pobierane tylko gdy użytkownik nawiguje do danej trasy, zmniejszając rozmiar początkowego bundla i poprawiając First Contentful Paint / TTI. `loadChildren` oczekuje funkcji zwracającej plik tras na poziomie modułu, który może grupować wiele komponentów pod jednym prefiksem trasy. `loadComponent` (Angular 14+) leniwie ładuje pojedynczy standalone komponent bezpośrednio — idealny dla tras liści jak `/checkout/success`. Dla dalszej optymalizacji łącz z `PreloadingStrategy`: `PreloadAllModules` pobiera wszystkie lazy chunki po załadowaniu początkowym; `QuicklinkStrategy` ładuje wstępnie tylko trasy powiązane widocznymi kotwicami.

---

**A13**

**P:** Jaka jest różnica między formularzami reaktywnymi a szablonowymi i w jakim scenariuszu każdy jest odpowiedni?

**O:** Formularze reaktywne definiują model w klasie komponentu (`FormGroup`, `FormControl`, `FormArray`) i wiążą go z szablonem przez dyrektywy `[formControl]` / `formControlName` — klasa jest jedynym źródłem prawdy, co czyni logikę testowalną bez DOM. Formularze szablonowe definiują model w szablonie przez `ngModel` i polegają na wiązaniu dwukierunkowym — szybsze dla prostych formularzy, ale trudniejsze do testowania jednostkowego. Wybierz reaktywne dla złożonych formularzy: dynamiczne tablice pól, walidacja między polami, kreatory wieloetapowe lub programowe włączanie/wyłączanie. Szablonowe są akceptowalne dla prostych formularzy kontaktowych.

---

**A14**

**P:** Jak zaimplementować własny walidator cross-field w formularzu reaktywnym i jak dołączyć go do `FormGroup` zamiast do pojedynczej kontrolki?

**O:** Walidator cross-field to `ValidatorFn` stosowany na poziomie `FormGroup`: `fb.group({ password: '', confirm: '' }, { validators: passwordMatchValidator })`. Funkcja otrzymuje `AbstractControl` (grupę), odczytuje obie wartości potomne i zwraca `null` (poprawny) lub obiekt błędu (`{ mismatch: true }`). Ponieważ błąd żyje na grupie, wyświetlasz go w szablonie przez `form.errors?.['mismatch']`, nie na pojedynczej kontrolce. Dla walidatorów asynchronicznych (np. sprawdzanie unikalności nazwy użytkownika przez HTTP) implementuj `AsyncValidatorFn` zwracający `Observable<ValidationErrors | null>`.

---

**A15**

**P:** Co robi `ControlValueAccessor` i kiedy zaimplementowałbyś go na niestandardowym komponencie?

**O:** `ControlValueAccessor` (CVA) to interfejs pozwalający niestandardowemu komponentowi działać jako kontrolka formularza pierwszej klasy — kompatybilna zarówno z `[(ngModel)]` jak i `formControlName`. Implementujesz cztery metody: `writeValue(val)` (model formularza wstawia wartość do UI), `registerOnChange(fn)` (wywołujesz `fn` gdy użytkownik zmienia wartość), `registerOnTouched(fn)` (wywołaj `fn` przy blur) i `setDisabledState(isDisabled)`. Rejestrujesz przez: `{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => MyComponent), multi: true }`. Typowe przypadki: date-picker, input numeru telefonu, widget oceny gwiazdkowej lub złożony input integrujący się natywnie z nadrzędnym `FormGroup`.

---

**A16**

**P:** Jakie są typowe źródła wycieków pamięci w aplikacjach Angular i jak `takeUntilDestroyed()` oraz `async` pipe je rozwiązują?

**O:** Najczęstszym źródłem jest ręczne `.subscribe()` na długożyjącym Observable (WebSocket, interwał) wewnątrz komponentu bez anulowania przy zniszczeniu — subskrypcja utrzymuje obiekt komponentu w pamięci w nieskończoność. `takeUntilDestroyed()` (Angular 16+) wstrzykuje `DestroyRef` i emituje sygnał zakończenia gdy komponent jest niszczony, automatycznie czyszcząc subskrypcję. Musi być umieszczony **po** operatorach wyższego rzędu (`switchMap`, `mergeMap` itp.) w łańcuchu pipe — umieszczenie przed oznacza, że wewnętrzne subskrypcje nie są przechwytywane. `async` pipe obsługuje to w całości automatycznie i jest preferowanym podejściem dla powiązań szablonu.

---

**A17**

**P:** Jakie są główne pułapki przy uruchamianiu aplikacji Angular z SSR (`@angular/ssr`) i jak obsługiwać API dostępne tylko w przeglądarce?

**O:** Render po stronie serwera działa w Node.js, gdzie globalne zmienne przeglądarki — `window`, `localStorage`, `sessionStorage`, `document`, `navigator` — nie istnieją; dostęp do nich crashuje SSR render. Chroń je przez `isPlatformBrowser(PLATFORM_ID)` (wstrzyknij `PLATFORM_ID` z `@angular/core`) lub użyj `afterNextRender()`, który działa tylko w przeglądarce. Drugi główny problem to zduplikowane wywołania HTTP: serwer pobiera dane i renderuje HTML, potem przeglądarka re-bootstrapuje Angular i ponownie wykonuje `ngOnInit` wywołując żądanie HTTP. Rozwiąż to przez `TransferState` lub `httpTransferCacheInterceptor` z `@angular/ssr` który automatycznie obsługuje żądania GET. Trzecia pułapka: biblioteki zewnętrzne zakładające globalność `window` — owiń je strażnikiem `typeof window !== 'undefined'` lub dynamicznym importem wewnątrz `afterNextRender`.

---

**A18**

**P:** Jaka jest różnica między pełną hydratacją a przyrostową i co ma z tym wspólnego `@defer`?

**O:** Pełna hydratacja (Angular 17+, stabilna w 18) dołącza nasłuchiwacze zdarzeń Angular i stan komponentu do DOM renderowanego przez serwer bez jego odrzucania lub ponownego tworzenia. Przeglądarka nadal musi pobrać i wykonać pełny bundle JS zanim którykolwiek komponent stanie się interaktywny. Hydratacja przyrostowa odracza hydratację poszczególnych poddrzew komponentów do momentu odpalenia wyzwalacza (np. przecięcie viewport, interakcja użytkownika) — komponenty owinięte `@defer` są dostarczane jako osobne lazy chunki. Oznacza to, że treść powyżej zakładki jest hydratowana natychmiast, podczas gdy komponenty off-screen odraczają pobieranie JS, poprawiając Time-to-Interactive. `@defer` umożliwia też bloki `placeholder`, `loading` i `error` jako prymitywy szablonu pierwszej klasy.

---

**A19**

**P:** Wyjaśnij `trackBy` (i nowsze wyrażenie `track` w `@for`). Jaki problem DOM rozwiązuje i jakie są pułapki `track $index`?

**O:** Domyślnie pętla `@for` Angular porównuje elementy przez referencję. Gdy tablica jest zastępowana odpowiedzią serwera — nawet jeśli dane są identyczne — wszystkie węzły DOM są niszczone i tworzone ponownie, bo referencje to nowe obiekty. `track item.id` mówi różnicownikowi, żeby używał stabilnej tożsamości, więc tylko faktycznie nowe/usunięte/przesunięte elementy dotykają DOM. To kluczowe dla wydajności dużych list i zapobiega utracie stanu fokusu, przejść CSS lub stanu komponentu. `track $index` to pułapka: gdy element jest usuwany ze środka listy, każdy kolejny element przesuwa indeks i jest uważany za "zmieniony", co niweluje cel. Zawsze track po stabilnym kluczu biznesowym (UUID, ID bazy danych).

---

**A20**

**P:** Masz pole wyszukiwania, które wywołuje żądanie HTTP przy każdym naciśnięciu klawisza. Opisz pełny łańcuch RxJS, który zbudujesz, żeby nie bombardować backendu, anulować nieaktualne żądania i elegancko obsługiwać błędy.

**O:** Zacznij od `Subject<string>` (lub `FormControl.valueChanges`) emitującego przy każdym naciśnięciu klawisza. Przepuść przez `debounceTime(300)` by poczekać aż użytkownik skończy pisać, potem `distinctUntilChanged()` żeby pominąć identyczne kolejne emisje, potem `filter(term => term.length >= 2)` żeby nie wyszukiwać pustego inputu. Następnie `switchMap(term => this.searchService.search(term).pipe(catchError(() => EMPTY)))` — `switchMap` anuluje poprzednie aktywne żądanie HTTP gdy nadejdzie nowy termin; wewnętrzny `catchError` zwraca `EMPTY` żeby nieudane żądanie nie przerywało zewnętrznego strumienia (powszechny błąd: zewnętrzny `catchError` zabija całą subskrypcję przy pierwszym błędzie). Subskrybuj przez `takeUntilDestroyed()` lub powiąż przez `async` pipe.

---

### Node.js — Ocena 3/5

---

**N1**

**P:** Czym jest pętla zdarzeń Node.js i dlaczego ma znaczenie dla serwera webowego?

**O:** Pętla zdarzeń to jednowątkowy mechanizm, który ciągle sprawdza oczekujące callbacki i wykonuje je gdy główny stos wywołań jest pusty. Pozwala Node.js obsługiwać tysiące równoczesnych operacji I/O (żądania sieciowe, zapytania DB, odczyty plików) bez tworzenia nowego wątku na żądanie. Node deleguje I/O do OS/libuv, a wynik odbiera przez callback gdy jest gotowy — serwer pozostaje responsywny nawet pod obciążeniem.

---

**N2**

**P:** Co oznacza "non-blocking I/O" w praktyce? Podaj konkretny przykład.

**O:** Non-blocking oznacza, że Node nie czeka aż wolna operacja się zakończy — rejestruje callback i przechodzi do obsługi innej pracy. Konkretny przykład: wywołanie `fs.readFile()` wraca natychmiast; Node kontynuuje przetwarzanie innych żądań i dopiero gdy OS sygnalizuje gotowość pliku, callback się wykonuje. Porównaj to z `fs.readFileSync()`, który zamraża cały proces do zakończenia odczytu — blokując każde inne żądanie w tym czasie.

---

**N3**

**P:** Jaka jest różnica między callbackiem, Promise a `async/await`? Kiedy wybrać każde?

**O:** Callbacki to zwykłe funkcje przekazywane jako argumenty i wywoływane gdy asynchroniczne zadanie się zakończy — najstarszy wzorzec, ale prowadzi do "callback hell" przy zagnieżdżeniu. Promise reprezentuje przyszłą wartość i pozwala na łańcuchowanie `.then()/.catch()` — bardziej czytelne, ale nadal nieco hałaśliwe. `async/await` to cukier syntaktyczny nad Promise, który pozwala pisać kod asynchroniczny czytany od góry do dołu jak synchroniczny. W praktyce `async/await` to dziś domyślny wybór; surowe callbacki pojawiają się jeszcze w starszych API jądra Node.

---

**N4**

**P:** Jak obsługujesz błędy w funkcji `async/await`? Co się stanie jeśli tego nie zrobisz?

**O:** Owiń wywołanie `await` w blok `try/catch` — `catch` otrzymuje przyczynę odrzucenia jako zwykły obiekt `Error`. Jeśli pominiesz obsługę błędów i Promise zostanie odrzucony, Node emituje zdarzenie `unhandledRejection`; w Node 15+ domyślnie kończy to proces. W Express konkretnie musisz też wywołać `next(err)` wewnątrz catch, żeby błąd dotarł do centralnego middleware obsługi błędów, inaczej Express zawiesza odpowiedź.

---

**N5**

**P:** Jak działa middleware Express? Wyjaśnij co oznacza `(req, res, next)`.

**O:** Middleware Express to funkcja z sygnaturą `(req, res, next)`. Gdy przychodzi żądanie, Express uruchamia middleware w kolejności rejestracji przez `app.use()`. Każda funkcja może czytać/modyfikować `req` i `res`, a następnie albo zakończyć cykl wysyłając odpowiedź (`res.json(...)`) albo wywołać `next()` żeby przekazać kontrolę do następnego middleware. Wywołanie `next(err)` z argumentem pomija normalny middleware i skacze bezpośrednio do czteropunktowego handlera błędów `(err, req, res, next)`.

---

**N6**

**P:** Jak obsługujesz błędy w asynchronicznych handlerach tras Express? Co się psuje jeśli zapomnisz?

**O:** Express nie przechwytuje automatycznie odrzuconych Promise w handlerach tras. Jeśli używasz `async/await`, musisz albo owinąć ciało handlera w `try/catch` i wywołać `next(err)`, albo użyć narzędzia jak `express-async-errors` które łata Express do automatycznego przekazywania odrzuceń. Bez tego odrzucony Promise w trasie cicho zawiesza żądanie — klient nigdy nie otrzymuje odpowiedzi, a błąd jest niewidoczny dla middleware obsługi błędów.

---

**N7**

**P:** Czym jest `process.env` i jak bezpiecznie go używać?

**O:** `process.env` to zwykły obiekt, który Node wypełnia ze środowiska OS przy starcie — tak wstrzykujesz sekrety i konfigurację bez hardkodowania. Standardową praktyką jest użycie pakietu `dotenv`, który odczytuje plik `.env` i scala wartości z `process.env` przed startem aplikacji. Powinieneś walidować obecność wymaganych zmiennych przy starcie (fail fast z jasnym komunikatem) zamiast pozwalać wartościom `undefined` powodować ciche błędy w produkcji.

---

**N8**

**P:** Jaka jest różnica między `require()` (CommonJS) a `import` (ESM)?

**O:** CommonJS (`require`) to oryginalny system modułów Node — ładuje moduły synchronicznie i jest nadal domyślny w większości projektów Node. ESM (`import/export`) to standard JavaScript, ładowany asynchronicznie, wymagany w plikach `.mjs` lub gdy `"type": "module"` jest ustawiony w `package.json`. Praktyczne różnice: nie możesz używać `require` w module ESM; `import` jest statycznie analizowalny (umożliwia tree-shaking); top-level `await` jest dostępny tylko w ESM. NestJS z TypeScript kompiluje domyślnie do CommonJS przez `tsc`.

---

**N9**

**P:** Czym są `scripts` w `package.json` i jaka jest różnica między `npm` a `npx`?

**O:** `scripts` to mapa skróconych poleceń — `npm run build` wykonuje polecenie shell zdefiniowane pod kluczem `"build"`, z `node_modules/.bin` automatycznie na PATH, żebyś mógł bezpośrednio wywoływać lokalnie zainstalowane CLI. `npm` to menedżer pakietów (install, publish, uruchamianie skryptów). `npx` uruchamia binarny pakiet bez globalnej instalacji — np. `npx prisma generate` uruchamia Prisma CLI z `node_modules/.bin`, a jeśli pakiet nie jest zainstalowany, pobiera go tymczasowo.

---

**N10**

**P:** Czym jest strumień Node.js i kiedy powinieneś go używać?

**O:** Strumień to abstrakcja do przetwarzania danych w fragmentach zamiast ładowania całości do pamięci naraz. Node ma cztery typy: Readable, Writable, Duplex (oba) i Transform (modyfikacja danych w transporcie). Sięgaj po strumienie przy dużych plikach (import CSV, wideo), potokowaniu odpowiedzi HTTP lub każdej sytuacji gdy pełny zestaw danych jest zbyt duży by go buforować. Praktycznie: `fs.createReadStream().pipe(res)` strumieniuje plik do odpowiedzi HTTP bez trzymania całego pliku w RAM.

---

**N11**

**P:** Czym jest kolejka mikrozadań i jak odnosi się do `Promise.resolve()` vs `setTimeout()`?

**O:** Rozwiązane Promise trafiają do kolejki mikrozadań, natomiast callbacki `setTimeout` do kolejki makrozadań. Po zakończeniu każdego zadania pętla zdarzeń opróżnia całą kolejkę mikrozadań przed przejściem do następnego makrozadania. Oznacza to, że `Promise.resolve().then(fn)` zawsze uruchamia się przed `setTimeout(fn, 0)`, nawet jeśli oba są "asynchroniczne". Praktycznie: jeśli synchronicznie łączysz wiele wywołań `.then()`, wszystkie wykonują się przed odpaleniem jakiegokolwiek timera.

---

**N12**

**P:** Kiedy Node.js jest złym wyborem dla zadania i co zamiast tego używasz?

**O:** Jeden wątek JavaScript Node oznacza, że praca intensywnie korzystająca z CPU — przetwarzanie obrazów, transkodowanie wideo, złożona kryptografia, wnioskowanie ML, duże przetwarzanie danych w pamięci — blokuje pętlę zdarzeń i zagłasza wszystkie równoległe żądania. Dla takich zadań oddelegowujesz do dedykowanego serwisu (mikroserwis Python, worker Go), używasz `worker_threads` Node dla izolowanych obliczeń lub przekazujesz pracę do kolejki w tle (jak BullMQ) i przetwarzasz w osobnym procesie.

---

**N13**

**P:** Czym jest `process.nextTick()` i jak różni się od `setImmediate()`?

**O:** `process.nextTick(fn)` kolejkuje callback do uruchomienia na końcu bieżącej operacji, zanim pętla zdarzeń przejdzie do następnej fazy — odpala się nawet przed callbackami I/O. `setImmediate(fn)` odpala w fazie sprawdzania pętli zdarzeń, po zdarzeniach I/O. Używaj `process.nextTick` gdy chcesz odroczyć callback do zakończenia bieżącego kodu synchronicznego ale przed jakimkolwiek I/O; preferuj `setImmediate` gdy chcesz dać I/O szansę na działanie najpierw. Nadużywanie `nextTick` w ścisłej pętli może zagłodzić I/O.

---

**N14**

**P:** Co się dzieje gdy wymagasz tego samego modułu dwa razy w różnych plikach? Czy Node ładuje go dwa razy?

**O:** Nie — Node buforuje moduły po pierwszym `require`. Pierwsze wywołanie wykonuje plik modułu i przechowuje wynik w `require.cache` indeksowanym przez rozwiązaną ścieżkę pliku. Wszystkie kolejne wywołania `require` zwracają zbuforowany eksport bez ponownego wykonywania pliku. Dlatego singletony działają naturalnie w Node (np. jedna instancja klienta Prisma) — każdy plik który go wymaga dostaje ten sam obiekt.

---

### AWS Lambda — Ocena 2/5

---

**L1**

**P:** Czym jest serverless computing i jaki problem rozwiązuje AWS Lambda?

**O:** Serverless oznacza pisanie i wdrażanie kodu bez provisionowania lub zarządzania serwerami — dostawca chmury zajmuje się infrastrukturą, łataniem OS i skalowaniem. Lambda rozwiązuje problem narzutu operacyjnego: zamiast uruchamiać instancję EC2 24/7 dla okazjonalnej pracy, płacisz tylko za dokładny czas obliczeniowy gdy Twój kod faktycznie działa (rozliczany w przyrostach 1 ms).

---

**L2**

**P:** Jakie serwisy mogą wyzwalać funkcję Lambda?

**O:** Lambda integruje się z wieloma źródłami zdarzeń AWS — powszechne to API Gateway (żądania HTTP), S3 (przesyłanie plików), SQS (wiadomości z kolejki), EventBridge (zaplanowane zdarzenia lub event-bus), SNS (powiadomienia pub/sub) i DynamoDB Streams (zdarzenia zmian tabeli). Źródło wyzwalacza determinuje też czy wywołanie jest synchroniczne czy asynchroniczne.

---

**L3**

**P:** Czym jest cold start w Lambda i dlaczego dodaje opóźnienie?

**O:** Cold start występuje gdy Lambda nie ma dostępnego ciepłego (wstępnie zainicjalizowanego) środowiska wykonawczego i musi stworzyć nowe od zera — pobierając pakiet kodu, uruchamiając runtime i wykonując kod inicjalizacyjny poza handlerem. Dodaje to narzut od ~100 ms do ponad 1 sekundy zanim handler w ogóle się wykona. Ciepłe wywołania całkowicie pomijają tę fazę, bo Lambda ponownie używa istniejącego środowiska.

---

**L4**

**P:** Opisz cykl życia środowiska wykonawczego Lambda.

**O:** Są trzy fazy. W fazie **Init** Lambda bootstrapuje runtime, ładuje rozszerzenia i uruchamia statyczny kod inicjalizacyjny (importy, konfiguracja połączenia DB). W fazie **Invoke** Lambda wywołuje funkcję handler z payload zdarzenia. W fazie **Shutdown** Lambda ostatecznie zamraża lub kończy środowisko po okresie bezczynności. Przy kolejnych wywołaniach, jeśli środowisko jest nadal ciepłe, Lambda całkowicie pomija Init i przechodzi bezpośrednio do Invoke — to jest warm start.

---

**L5**

**P:** Jakie są kluczowe twarde limity AWS Lambda, które powinieneś znać?

**O:** Maksymalny timeout wykonania to **15 minut** (900 s) — cokolwiek dłuższego wymaga Fargate lub Step Functions. Pamięć jest konfigurowalna od **128 MB do 10 240 MB**, a CPU skaluje się proporcjonalnie do pamięci. Limit rozmiaru pakietu wdrożeniowego to **50 MB zspakowane** (250 MB rozpakowane) lub do 10 GB przy użyciu obrazu kontenera. Istnieje też domyślny limit współbieżności **1000 jednoczesnych wykonań** na konto AWS na region (limit miękki — można podnieść).

---

**L6**

**P:** Jaka jest różnica między synchronicznym a asynchronicznym wywołaniem Lambda?

**O:** Przy **synchronicznym** wywołaniu caller czeka aż funkcja się zakończy i otrzymuje odpowiedź bezpośrednio — API Gateway działa w ten sposób. Przy **asynchronicznym** wywołaniu Lambda wewnętrznie kolejkuje zdarzenie i natychmiast zwraca potwierdzenie bez czekania na wykonanie; funkcja działa w tle, a Lambda może automatycznie ponawiać przy niepowodzeniu i kierować błędy do Dead Letter Queue (DLQ). Powiadomienia o zdarzeniach S3 to klasyczny przykład asynchronicznego wywołania.

---

**L7**

**P:** Kiedy wybrałbyś Lambda zamiast EC2 i kiedy EC2 zamiast Lambda?

**O:** Lambda to właściwy wybór dla sterownych zdarzeniami, krótkotrwałych workloadów ze zmiennym lub nieprzewidywalnym ruchem — tworzenie miniaturek po przesłaniu do S3, endpointy REST API lub zaplanowane zadania. EC2 jest lepsze gdy potrzebujesz trwałych procesów, czasu wykonania powyżej 15 minut, szczegółowej kontroli OS lub stabilnych workloadów wysokiej przepustowości gdzie rozliczanie za wywołanie byłoby droższe niż zarezerwowana instancja działająca ciągle.

---

**L8**

**P:** Czym jest Amazon API Gateway i jak współpracuje z Lambda?

**O:** API Gateway to zarządzany serwis przyjmujący żądania HTTP(S) od klientów i kierujący je do serwisów backend. W połączeniu z Lambda, API Gateway tłumaczy przychodzące żądanie HTTP na obiekt zdarzenia i wywołuje funkcję Lambda synchronicznie — wartość zwrócona przez funkcję staje się odpowiedzią HTTP. Ta kombinacja to standardowy wzorzec budowania bezserwerowych REST API bez zarządzania serwerem webowym.

---

**L9**

**P:** Dlaczego otwieranie połączenia z bazą danych w handlerze Lambda przy każdym wywołaniu jest problemem i jak RDS Proxy to rozwiązuje?

**O:** Lambda może skalować do tysięcy równoczesnych wykonań, a każde wywołanie otwierające własne połączenie szybko wyczerpałoby limit połączeń bazy danych (PostgreSQL ma relatywnie niski twardy limit). RDS Proxy siedzi między Lambda a bazą danych RDS, utrzymując pulę trwałych połączeń i multipleksując wiele wywołań Lambda przez małą liczbę rzeczywistych połączeń DB — unikając wyczerpania połączeń bez żadnych zmian kodu w funkcji.

---

**L10**

**P:** Jak powinieneś obsługiwać sekrety i konfigurację w Lambda — czego nigdy nie robić?

**O:** Nigdy nie powinieneś hardkodować sekretów (klucze API, hasła do bazy danych) bezpośrednio w kodzie źródłowym funkcji, bo to ujawnia poświadczenia w kontroli wersji i artefaktach wdrożeniowych. Właściwe podejście to używanie zmiennych środowiskowych dla niewrażliwej konfiguracji i odwoływanie się do sekretów z **AWS Secrets Manager** lub **AWS Systems Manager Parameter Store**. Zmienne środowiskowe Lambda są szyfrowane w stanie spoczynku przez AWS KMS.

---

**L11**

**P:** Jakie strategie mogą łagodzić opóźnienie cold start?

**O:** Trzy praktyczne: (1) **Provisioned Concurrency** — Lambda wstępnie rozgrzewa konfigurowalną liczbę środowisk wykonawczych żeby były zawsze gotowe, całkowicie eliminując cold starty dla tych instancji; (2) **mniejsze pakiety wdrożeniowe** — mniej kodu do pobrania i parsowania oznacza szybszy Init; (3) **wybór runtime** — Node.js i Python inicjalizują się znacznie szybciej niż runtimes oparte na JVM jak Java (specyficznym dla Javy rozwiązaniem jest Lambda SnapStart).

---

**L12**

**P:** Lambda jest opisywana jako "bezstanowa". Co to oznacza w praktyce?

**O:** Oznacza to, że nie możesz polegać na stanie w pamięci utrzymującym się między wywołaniami — Lambda może kierować dwa kolejne żądania do różnych środowisk wykonawczych lub zakończyć środowisko po bezczynności. Stan który musi przetrwać między wywołaniami musi być przechowywany zewnętrznie: baza danych (RDS, DynamoDB), cache (ElastiCache) lub obiektowa pamięć masowa (S3). Katalog `/tmp` utrzymuje się w ciepłym środowisku, ale jest uważany tylko za cache przejściowy, nie niezawodny trwały magazyn.

---

### Architektura — Ocena 3/5

---

**AR1**

**P:** Jaki jest podstawowy kompromis między architekturą monolityczną a mikroserwisami i kiedy wybrałbyś jedno zamiast drugiego?

**O:** Monolit pakuje całą funkcjonalność w jedną wdrożeniową jednostkę — prostszy do rozwijania, debugowania i wdrażania na początku, ale trudniejszy do niezależnego skalowania poszczególnych części. Mikroserwisy dzielą system na niezależnie wdrażalne serwisy, umożliwiając skalowanie per-serwis i izolację błędów, ale wprowadzają opóźnienie sieciowe, złożoność rozproszonego śledzenia i narzut operacyjny rzadko opłacalny dla małych zespołów. Zasada: zacznij od monolitu, wydzielaj serwisy tylko gdy konkretne wąskie gardło lub rozmiar zespołu to uzasadnia. Aplikacja NestJS z osobnymi modułami (auth, orders, payments) to dobrze ustrukturyzowany monolit — można go podzielić później bez pełnego przepisania.

---

**AR2**

**P:** Jakie są główne koszty operacyjne mikroserwisów, które ludzie niedoceniają?

**O:** Każdy serwis potrzebuje własnego pipeline CI/CD, logowania, health checków i konfiguracji wdrożenia — co zajmuje jeden serwis Railway staje się tuzinem. Wywołania między serwisami zawodzą w sposób, w jaki lokalne wywołania funkcji nigdy nie zawodzą: potrzebujesz ponowień, timeoutów i circuit breakerów. Spójność danych staje się trudna, bo każdy serwis posiada własną bazę danych, więc wieloetapowa operacja (stwórz zamówienie + nalicz płatność + zarezerwuj stock) może częściowo się nie powieść bez prostego rollbacku. Mikroserwisy zaczynają się opłacać dopiero gdy zespół przekracza 8-10 inżynierów lub gdy konkretne serwisy mają radykalnie różne potrzeby skalowania.

---

**AR3**

**P:** Jakie kody statusu HTTP powinien zwracać REST API dla: pomyślnego utworzenia zasobu, błędu walidacji, nieautoryzowanego żądania i nieznalezionego zasobu?

**O:** `201 Created` dla pomyślnego POST (często z nagłówkiem `Location` wskazującym na nowy zasób). `400 Bad Request` dla błędów walidacji, z ciałem wymieniającym konkretne pola i komunikaty. `401 Unauthorized` gdy nie ma prawidłowych poświadczeń (brakujący lub wygasły JWT) i `403 Forbidden` gdy poświadczenia są prawidłowe, ale użytkownik nie ma uprawnień (np. zwykły użytkownik próbujący uderzyć w endpoint administratora). `404 Not Found` gdy zasób nie istnieje — nigdy nie zwracaj `200` z pustym ciałem dla brakującego rekordu.

---

**AR4**

**P:** Jak wersjonowałbyś REST API i jakie podejście zastosowałbyś w produkcji?

**O:** Trzy powszechne strategie to wersjonowanie URI (`/api/v1/products`), wersjonowanie przez parametr zapytania (`/products?v=2`) i wersjonowanie przez nagłówek (`Accept: application/vnd.api+json;version=2`). Wersjonowanie URI to najpraktyczniejszy wybór: jest jawne, przyjazne pamięci podręcznej i łatwe do routowania na poziomie API Gateway lub reverse proxy. Rozszerzenie istniejącego prefiksu `/api` do `/api/v1` kosztuje prawie zero wysiłku. Unikaj wersjonowania przez nagłówek chyba że masz produkt bardzo zorientowany na platformę API.

---

**AR5**

**P:** Co oznacza "idempotent" w kontekście metod HTTP i które metody powinny być idempotentne?

**O:** Idempotentna operacja daje ten sam wynik niezależnie od tego ile razy jest wywoływana z tymi samymi danymi. `GET`, `PUT` i `DELETE` muszą być idempotentne — pobranie zasobu dwa razy zwraca te same dane, aktualizacja ceny do 49,99 dwa razy pozostawia ją na 49,99, a usunięcie już usuniętego rekordu powinno zwrócić `404`. `POST` jest jawnie nieidempotentny — wysłanie formularza zamówienia dwa razy tworzy dwa zamówienia. Ma to praktyczne znaczenie przy logice ponowień: możesz bezpiecznie ponowić `GET` po timeout; ponowienie `POST` bez klucza idempotencji ryzykuje zduplikowanymi płatnościami.

---

**AR6**

**P:** Co oznacza "bezstanowy" dla REST API i dlaczego ma znaczenie dla skalowania poziomego?

**O:** Bezstanowy oznacza, że serwer nie przechowuje danych sesji między żądaniami — każde żądanie niesie wszystkie informacje potrzebne do jego przetworzenia (np. JWT w nagłówku `Authorization`). Ma to znaczenie dla skalowania, bo każda instancja za load balancerem może obsłużyć dowolne żądanie bez potrzeby dzielenia pamięci lub sticky sessions. Uwierzytelnianie oparte na JWT jest poprawnie bezstanowe; jedynym wyjątkiem jest refresh token przechowywany w DB — to jest jedno wspólne źródło danych, nie pamięć per-instancja.

---

**AR7**

**P:** Kiedy wybrałbyś bazę danych NoSQL zamiast PostgreSQL i jakie są kompromisy?

**O:** Wybierz NoSQL (np. MongoDB, DynamoDB) gdy dane mają wysoce zmienne lub zagnieżdżone schematy, które nie mapują się czysto na tabele, lub gdy potrzebujesz poziomego skalowania zapisu ponad możliwości pojedynczego primary Postgres. PostgreSQL to właściwy domyślny wybór dla e-commerce: masz ustrukturyzowane relacje (użytkownicy, zamówienia, produkty, warianty), potrzebujesz transakcji ACID (nalicz płatność + zmniejsz stock atomicznie) i korzystasz z silnej spójności i zapytań `JOIN`. Kompromis: NoSQL łatwiej skaluje zapisy między węzłami, ale poświęca gwarancje ACID — brakujące ograniczenie klucza obcego w MongoDB cicho tworzy sieroty danych.

---

**AR8**

**P:** Opisz trzy warstwy buforowania i gdzie każda pasuje w aplikacji webowej.

**O:** **Cache przeglądarki** przechowuje statyczne zasoby (JS, CSS, obrazy) używając nagłówków `Cache-Control: max-age` — hashowane nazwy plików Angular (`main.abc123.js`) czynią to bezpiecznym do buforowania przez rok. **CDN** (jak Vercel's Edge Network) buforuje prerenderowany HTML i pliki statyczne w węzłach edge globalnie, więc użytkownik w Warszawie dostaje stronę z węzła we Frankfurcie. **Redis** (cache na poziomie aplikacji) przechowuje obliczone lub pobrane z DB dane po stronie serwera — np. buforowanie zapytania katalogu produktów przez 60 sekund żeby uniknąć uderzania w Postgres przy każdym żądaniu. Każda warstwa redukuje obciążenie warstwy poniżej.

---

**AR9**

**P:** Czym jest strategia unieważniania cache i jaki problem powodują nieaktualne dane konkretnie w e-commerce?

**O:** Unieważnianie cache to proces usuwania lub aktualizowania buforowanych danych gdy zmienia się źródłowe źródło. W e-commerce nieaktualne dane są niebezpieczne: jeśli buforujesz stan magazynowy produktu i klient kupuje ostatnią jednostkę, użytkownicy nadal widzą "W magazynie" do wygaśnięcia cache. Powszechne strategie: **wygasanie oparte na TTL** (cache auto-wygasa po N sekundach — prosta, ale może pokazywać nieaktualne dane), **write-through** (aktualizuj cache natychmiast przy zapisie DB — spójne ale dodaje opóźnienie zapisu), **cache-aside z jawnym unieważnianiem** (usuń klucz cache przy zapisie; następny odczyt uzupełnia — najpowszechniejsze w NestJS/Redis).

---

**AR10**

**P:** Dlaczego używać kolejki wiadomości jak BullMQ/Redis do wysyłania emaili transakcyjnych zamiast wywoływać API emaila bezpośrednio w handlerze żądania?

**O:** Wysyłanie emaila inline blokuje odpowiedź HTTP w oczekiwaniu na API emaila — jeśli serwis jest wolny lub niedostępny, endpoint zamówień zwraca 500. Kolejka rozsprzęga akcję: endpoint kolejkuje zadanie i odpowiada `201` natychmiast; worker przetwarza zadanie asynchronicznie. Kolejki dają też automatyczne ponawianie z backoffem (jeśli API zawiedzie, ponów po 30s, 5m, 1h) bez żadnej logiki ponowień w kontrolerze. To szczególnie ważne przy skokach ruchu — możesz przetwarzać tysiące potwierdzeń zamówień w kontrolowanym tempie zamiast uderzać w API emaila jednocześnie.

---

**AR11**

**P:** Jaka jest różnica między webhookiem a pollingiem i jakie są wymagania bezpieczeństwa dla endpointu webhooka?

**O:** Polling oznacza, że Twój serwer cyklicznie wywołuje API zewnętrzne ("jakieś nowe zdarzenia?") — rozrzutny i dodaje opóźnienie proporcjonalne do interwału. Webhook to odwrotność: zewnętrzna strona wywołuje Twój endpoint w momencie wystąpienia zdarzenia (np. Stripe wysyła POST na `/payments/webhook` gdy płatność zostanie ukończona). Krytycznym wymogiem bezpieczeństwa jest **weryfikacja podpisu**: Stripe dołącza podpis HMAC w nagłówku `Stripe-Signature`; Twój endpoint musi go ponownie obliczyć używając surowego ciała żądania i `STRIPE_WEBHOOK_SECRET`, odrzucając żądania które nie pasują. Bez tego ktokolwiek może wysłać fałszywe zdarzenia `checkout.session.completed` żeby wywołać realizację zamówień bez płacenia.

---

**AR12**

**P:** Jaka jest różnica między skalowaniem pionowym a poziomym i jakie ograniczenie architektoniczne musi być spełnione dla działania skalowania poziomego?

**O:** Skalowanie pionowe oznacza dodawanie więcej CPU/RAM do istniejącego serwera — proste ale ma fizyczny sufit i tworzy pojedynczy punkt awarii. Skalowanie poziome oznacza dodawanie więcej instancji serwera za load balancerem — teoretycznie nieograniczone, ale wymaga **bezstanowości** aplikacji (brak sesji w pamięci, brak lokalnych zapisów plików). Gdyby aplikacja NestJS zapisywała przesłane obrazy do lokalnego systemu plików, druga instancja nie miałaby tych plików — dlatego używa się Supabase Storage jako współdzielonego zewnętrznego magazynu. Railway obsługuje skalowanie poziome przez liczbę replik, ale działa poprawnie tylko jeśli cały stan współdzielony żyje w zewnętrznych serwisach jak Postgres, Redis i Supabase.

---

**AR13**

**P:** Jakie etapy zawiera podstawowy pipeline CI/CD i jaki jest cel każdego etapu?

**O:** Typowy pipeline ma cztery etapy. **Install & build** uruchamia `pnpm install` i kompiluje TypeScript — wykrywa błędy importu i niepowodzenia typów zanim dotrą do produkcji. **Lint & test** uruchamia ESLint i testy jednostkowe/integracyjne — zapobiega regresjom i automatycznie wymusza styl kodu. **Staging deploy** wypycha build do środowiska staging żeby zmiana mogła być przetestowana z prawdziwą infrastrukturą. **Production deploy** promuje ten sam artefakt build (nie rebuild) do produkcji, zazwyczaj gateowany przez ręczną akceptację lub testy smoke. Uruchomienie `prisma migrate deploy` jako pre-deploy hook to etap migracji DB blokujący deploy przy niepowodzeniu migracji.

---

**AR14**

**P:** Czym jest indeks bazy danych, kiedy powinieneś go dodać i jaki jest koszt nadmiernego indeksowania?

**O:** Indeks to osobna struktura danych (zazwyczaj B-drzewo), która pozwala Postgres znaleźć wiersze pasujące do klauzuli `WHERE` bez skanowania każdego wiersza — kluczowe gdy tabela ma tysiące rekordów. Dodawaj indeksy na kolumnach używanych w częstych warunkach `WHERE`, kluczach `JOIN` i klauzulach `ORDER BY`: np. `products.slug` (wyszukiwany na każdej stronie produktu), `orders.userId` (pobierany per użytkownik) i `cart_items.cartId`. Koszt nadmiernego indeksowania: każdy `INSERT` lub `UPDATE` musi też aktualizować każdy indeks na tej tabeli. Tabela z 10 indeksami zapisuje ok. 10x więcej danych na zmianę wiersza. Zasada: indeksuj dla wzorców odczytu, ale profiluj przez `EXPLAIN ANALYZE` przed spekulatywnym dodawaniem indeksów.

---

**AR15**

**P:** Jakie są kluczowe różnice między uwierzytelnianiem opartym na JWT a sesyjnym i jaka jest największa słabość JWT?

**O:** Uwierzytelnianie sesyjne przechowuje stan logowania po stronie serwera (rekord sesji w DB lub Redis) i daje klientowi tylko nieprzezroczysty ID sesji w ciasteczku — stanowe, ale natychmiast odwoływalne przez usunięcie rekordu. JWT umieszcza wszystkie twierdzenia (userId, rola, wygaśnięcie) w podpisanym tokenie przechowywanym przez klienta; serwer weryfikuje tylko podpis bez wyszukiwania w DB, co czyni go bezstanowym i poziomo skalowalnym. Największą słabością JWT jest **unieważnianie**: nie możesz unieważnić tokenu przed jego wygaśnięciem bez implementacji czarnej listy (co ponownie wprowadza stan po stronie serwera). Łagodz to krótkim TTL tokenu dostępu (15 min) i haszowanym refresh tokenem przechowywany w DB, który może być natychmiast unieważniony.

---

*Tłumaczenie na podstawie oryginału: CGI Warsaw — Intern Fullstack Developer Interview Prep*
