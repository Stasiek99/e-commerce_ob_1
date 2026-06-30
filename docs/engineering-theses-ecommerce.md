# Engineering Theses on E-Commerce Projects — Annotated Directory

> Research goal: find real examples of well-written engineering/bachelor theses describing e-commerce implementations, to use as reference for structure, depth, and scope.
> Researched: 2026-06-29 | Covers: English (open access) + Polish university repositories

---

## How to Read This Document

Each entry includes:
- Direct URL (PDF or metadata page)
- Access status (open / browser-only / metadata-only)
- Technology stack
- Full chapter structure (where extractable)
- Notes on what makes it worth reading

---

## English Theses — Open Access

### 1. Web Performance Optimization and Its Impact on User Experience (BTH Sweden, 2025)

**Authors:** Simon Bosnjak, Abdulrahman Sakah
**University:** Blekinge Institute of Technology, Sweden
**Degree:** Bachelor of Science in Software Engineering
**Year:** June 2025 | **Pages:** 84
**PDF (direct):** https://www.diva-portal.org/smash/get/diva2:1969221/FULLTEXT01.pdf
**Survey raw data:** https://osf.io/hmzqf

**Why read it:** The entire empirical experiment is built as a React 18 e-commerce SPA (product listing, filtering, cart, mock checkout). Three versions were built — unoptimized / moderately optimized / fully optimized — and measured against Core Web Vitals. Best example of a mixed-methods thesis (quantitative Lighthouse + qualitative user study + developer survey, N=32 devs, N=30 users).

**Technologies:** React 18 (concurrent rendering), Vite, Redux Toolkit, React Router, `React.lazy` + Suspense, WebP, IntersectionObserver, Service Workers (Workbox/PWA), Terser, Brotli + Gzip, TypeScript strict, pnpm.

**Chapter structure:**
1. Introduction — research questions RQ1–3
2. Related Work
3. Background — Scope Definition + Key WPO Techniques
4. Method
   - 4.2.1 Survey (N=32 developers)
   - 4.2.2 Controlled experiment (3 e-commerce app versions)
5. Results and Analysis — Lighthouse metric tables per RQ
6. Discussion
7. Conclusions and Future Work
- Appendix A: Full anti-pattern + optimization checklists for all 3 versions
- Appendix B: Full developer survey questionnaire
- Appendix C: Per-participant qualitative feedback (30 participants)
- Appendix D: Lighthouse comparison table (FCP, LCP, TBT, CLS)

**Lighthouse results (Table D.1):**

| Metric | Unoptimized | Moderately Optimized | Fully Optimized |
|---|---|---|---|
| Lighthouse score | 52 | 63 | 90 |
| FCP | 3.9s | 2.1s | 0.2s |
| LCP | 8.4s | 4.6s | 0.2s |
| TBT | 160ms | 120ms | 0ms |
| CLS | 0.039 | 0.039 | 0 |

---

### 2. Design and Development of a Localized E-Commerce Solution — ShareSpace (arXiv, 2024)

**Authors:** Faiz Ahmed, Nitin Kumar Jha, Md Faizan
**Institution:** Vellore Institute of Technology, Chennai, India
**Year:** November 2024
**PDF (direct):** https://arxiv.org/pdf/2411.11527
**GitHub (live code):** https://github.com/nitin611/ShareSpace

**Why read it:** Student-to-student marketplace. Includes AI-gated product listing (Gemini multi-modal), Amazon.in price scraper for compliance, reputation point system. Good example of a thesis with a novel feature (AI moderation) explained from requirements → design → implementation.

**Technologies:** React.js, Node.js, Flask (Python AI microservice), MongoDB (4 collections), JWT + bcrypt, Tailwind CSS, Google Gemini multi-modal API, Amazon.in scraper.

**Chapter structure:**
- Abstract
- Introduction
- 1. Related Work — literature review + feature comparison table vs eBay/OLX/Facebook Marketplace
- 2. Methodology
  - System Design
  - Core Functionalities (auth, product listing, product requests)
  - Database Design (schemas with field types)
  - User Workflow (signup OTP flow, listing flow, transaction flow)
- 3. Challenges Addressed
  - AI-based content moderation (Gemini + blacklist)
  - Reputation point system design
  - Amazon.in price validation (75% of avg refurbished price)
- 4. Results — screenshots of dashboard, admin panel
- 5. Future Work — mobile app, local AI hosting, multi-campus expansion
- Conclusion + References (7 citations)

---

### 3. E-commerce Application Using MERN Stack — FunkoStore (Theseus Finland, 2020)

**Author:** Quang Nhat Mai
**University:** Metropolia University of Applied Sciences, Finland
**Degree:** Bachelor of Engineering, Information Technology
**Year:** 2020 | **Pages:** 36
**PDF (Theseus — open in browser):** https://www.theseus.fi/bitstream/handle/10024/349838/NhatMai_Thesis.pdf
**Mirror with ToC (direct):** https://docslib.org/doc/935762/e-commerce-application-using-mern-stack

**Why read it:** Classic compact implementation thesis. Stack theory first, then product walkthrough with screenshots. Good model for a concise 36-page praca inżynierska that doesn't overstay its welcome — covers a full working store without trying to be a dissertation.

**Technologies:** MongoDB, Express.js, React.js, Node.js, Braintree (payment gateway).

**Chapter structure:**
1. Introduction
2. E-commerce — Definition, Types, Advantages, Challenges
3. MERN Stack
   - 3.1 JavaScript
   - 3.2 NodeJS
   - 3.3 Express.js
   - 3.4 MongoDB
   - 3.5 ReactJS (Virtual-DOM, Components, Props/State, Pros/Cons)
   - 3.6 MERN Stack in Website Development
4. FunkoStore Application
   - 4.1 Home Page
   - 4.2 Login System
   - 4.3 Dashboard
   - 4.4 Shop Page
   - 4.5 Cart Page
5. Summary
6. References

**Features:** User signup/signin, admin dashboard (user management, store stats), category browsing, product search, shopping cart, Braintree payment gateway.

---

### 4. Developing a Scalable E-Commerce Web Application with ReactJS and Firebase (JETIR, 2024)

**Authors:** Sunny Sharma, Prof. Rashid Patel
**Published in:** JETIR Vol. 11 Issue 9, September 2024
**PDF (direct):** https://www.jetir.org/papers/JETIR2409156.pdf

**Note:** 5-page journal paper, not a full thesis. Useful for seeing a compressed literature survey + problem statement + proposed work structure. No testing chapter.

**Technologies:** React.js, Node.js, Stripe, Firebase (auth + DB + hosting), React Router, React Context API.

---

### 5. More Theseus Theses — Open in Browser (Not Direct-Fetchable)

These are accessible by pasting the URL into a browser:

| Title | Author | Year | Tech | URL |
|---|---|---|---|---|
| Design and Development of a Responsive E-Commerce (clothing store "Kaapor") | Sumiya Chowdhury | 2023 | MERN | http://www.theseus.fi/bitstream/10024/887863/2/Chowdhury_Sumiya.pdf |
| Development of an E-commerce Web Application for Sunrob Robotics Inc. | Uy Tra | 2022 | Not specified | https://www.theseus.fi/bitstream/handle/10024/808286/Tra_Uy.pdf |
| ICT bachelor thesis (React frontend) | Yan Zborovskij | 2024 | React | https://www.theseus.fi/bitstream/handle/10024/863662/Zborovskij_Yan.pdf |
| Online bookstore | Thi Thu Hien Tran | 2022 | Not specified | https://www.theseus.fi/bitstream/handle/10024/752089/Tran_Thi%20Thu%20Hien.pdf |

---

## Polish Theses

### 6. PJATK (Polsko-Japońska Akademia Technik Komputerowych) — Best Polish Repository

**Repository URL:** https://repin.pjwstk.edu.pl/xmlui/

The richest openly searchable collection of Polish engineering theses on e-commerce. Metadata and abstracts are visible without login — most PDFs are not attached to entries, but titles, abstracts, technologies, and keywords are accessible.

**Collection: Praca inżynierska — E-commerce 2022**
https://repin.pjwstk.edu.pl/xmlui/handle/186319/2536

| Tytuł | Autor | Rok | Technologie | Link |
|---|---|---|---|---|
| Sklep internetowy (platforma obuwnicza) | Kotowski, Piotr | 2022 | .NET backend, MS SQL Server, HTML/CSS/Bootstrap/JS | https://repin.pjwstk.edu.pl/xmlui/handle/186319/1630 |
| Reklama płatna dla sklepów e-commerce | Łukaszewski, Filip | 2023 | Google Ads, Facebook Ads | — |
| Współpraca UX Designera z Developerem — sklep w Shopify | Banasik & Mieszkowski | 2023 | Shopify | — |
| Projekt i rola systemu ERP dla sklepu internetowego | Michalski, Cezary | 2023 | Analiza ERP | — |

**Collection: Praca inżynierska — Baza Danych 2022**
https://repin.pjwstk.edu.pl/xmlui/handle/186319/2258

| Tytuł | Autor | Rok | Technologie | Link |
|---|---|---|---|---|
| Aplikacja internetowa do obsługi sklepu muzycznego | Łoszewski, Robert | 2023 | Java, Spring Boot, Thymeleaf, MySQL | https://repin.pjwstk.edu.pl/xmlui/handle/186319/2260 |
| Projekt bazy danych oraz sklepu internetowego dla HIGH LOOK | Smereczyński, Ernest | 2023 | MySQL, WordPress | https://repin.pjwstk.edu.pl/xmlui/handle/186319/2706 |
| Concept of e-commerce boilerplate with dynamical fields | Zieliński, Robert | 2023 | Nie podano w abstrakcie | — |
| Zautomatyzowany system do obsługi paczek (e-commerce) | Kravets, Diana | 2023 | Java, Spring Boot, H2, Docker, Maven | https://repin.pjwstk.edu.pl/xmlui/handle/186319/2371 |

**Collection: Programowanie Aplikacji Biznesowych 2021**
https://repin.pjwstk.edu.pl/xmlui/handle/186319/870

| Tytuł | Autor | Rok | Uwagi |
|---|---|---|---|
| Sklep internetowy z wykorzystaniem chatbota | Yakushenko, Andrii | 2022 | Pełny sklep + chatbot |

---

### 7. AGH Kraków — Otwarta Praca (Open Access)

**Tytuł:** Projekt i implementacja strony sklepu internetowego z użyciem systemu Wordpress
**Autor:** Kędzior, Rafał
**Uczelnia:** AGH Akademia Górniczo-Hutnicza, Wydział Zarządzania
**Rok:** 2018 | Licencjat
**Technologie:** WordPress
**URL:** https://repo.agh.edu.pl/entities/publication/22431953-600f-42c8-9cba-64293d070061

Jedyna w pełni otwarta praca znaleziona w repo AGH (licencja AGH Fair Use). Reszta jest zrestryktowana — metadane widoczne:

| Tytuł | Autor | Rok | Technologie | URL |
|---|---|---|---|---|
| Projekt aplikacja sklepu internetowego | Błaszczyk, Michał | 2021 | Mobile app + e-commerce | https://repo.agh.edu.pl/entities/publication/7c41bfe5-5a04-4bec-acff-5e29b3445001 |
| Projekt i implementacja aplikacji sklepu internetowego | Mamla, Damian | 2016 | B2C flow (oferty→zamówienia→płatności) | https://repo.agh.edu.pl/entities/publication/49b968a3-9530-45cf-b307-b08a026c554b |
| Internetowy sklep minerałów i skał | Szczupak, Łukasz | 2013 | Java, HTML5, PrimeFaces SPA | https://repo.agh.edu.pl/entities/publication/4622b953-f5f9-4831-93fd-5c15e546373c |

**Pełne wyniki wyszukiwania AGH dla "sklep internetowy":**
https://repo.agh.edu.pl/search?query=sklep+internetowy&filter_field_1=type&filter_type_1=equals&filter_value_1=Thesis

---

### 8. AGH — Praca Dostępna Bezpośrednio przez Stronę Promotora (PDF)

**Tytuł:** Samoadaptacyjny sklep internetowy obsługiwany przez inteligentnego asystenta
**Autorzy:** Magierski & Miklaszewski
**Uczelnia:** AGH Kraków
**Rok:** 2009 | Praca magisterska
**PDF (bezpośredni):** https://home.agh.edu.pl/~horzyk/pracedyplom/2009magierskimiklaszewskiprmagist.pdf

**Technologie:** Ruby on Rails, MySQL, MVC, automaty Mealy'ego (chatbot), AIML/A.L.I.C.E, TTS Ivona, plugin Substruct.

**Struktura rozdziałów:**
1. Wstęp
2. Teoria — Web 2.0, historia CRM, technologie chatbot
3. Opis systemu — architektura MVC, automaty konwersacyjne, rozpoznawanie wypowiedzi
4. Demonstracja systemu — panele admina, interfejsy użytkownika
5. Podsumowanie

---

### 9. GitHub — Praca Inżynierska: Sklep na Ethereum

**Tytuł:** Sklep internetowy oparty na blockchainie Ethereum
**Autor:** Mikołaj Walkowiak
**GitHub:** https://github.com/Mikolaj-Walkowiak/Sklep-ethereum-praca-inzynierska
**Technologie:** Solidity (smart contracts), React, Firebase, JavaScript

Repozytorium z kodem do pracy inżynierskiej. Dobry przykład sklepu z niestandardowym mechanizmem płatności (kryptowaluta).

---

## Przegląd Repozytoriów — Status Dostępu

| Repozytorium | Status | Uwagi |
|---|---|---|
| DIVA portal (Skandynawia) | Otwarte — PDF bezpośredni | Najlepsze dla angielskich prac |
| arXiv | Otwarte — PDF bezpośredni | Głównie artykuły, ale zdarzają się prace projektowe |
| Theseus.fi (Finlandia) | Przeglądarka — PDF działa w przeglądarce, nie w scraperze | Duży zasób z politechnik UAS |
| JETIR | Otwarte — PDF bezpośredni | Artykuły, nie pełne prace |
| PJATK DSpace | Metadane otwarte, PDF brak | Najlepszy polski katalog |
| AGH repo.agh.edu.pl | Metadane otwarte, PDF zrestryktowane (1 wyjątek) | 14 trafień dla "sklep internetowy" |
| APD UW (apd.uw.edu.pl) | Wymaga logowania | Niedostępne bez konta |
| Repozytorium PW | PDF obrazkowe, nie indeksowane | Niedostępne |
| ORPPD (polon.nauka.gov.pl) | Wymaga logowania instytucjonalnego | 3,3 mln prac, największy zasób |
| DART-Europe | Zamknięte (przekierowanie na UCL) | Niedziałające |

---

## Wzorzec Technologiczny w Znalezionych Pracach

| Epoka | Typowe technologie |
|---|---|
| 2009–2013 | Ruby on Rails, Java EE, JSF/PrimeFaces, LAMP |
| 2016–2018 | WordPress/WooCommerce, .NET, MySQL |
| 2020 | MERN stack (MongoDB, Express, React, Node) |
| 2022–2024 | Java Spring Boot, React + Firebase, Next.js, Solidity, AI integrations |

**Uwaga:** Żadnej polskiej pracy z Angular/React dostępnej jako otwarty PDF nie znaleziono w przeszukanych repozytoriach — nowoczesne prace JS istnieją (widoczne w GitHub i na forach), ale nie są deponowane z otwartym dostępem PDF.

---

## Struktura "Dobrej" Pracy Inżynierskiej — Wzorzec z Analizy

Na podstawie znalezionych przykładów typowa dobrze oceniana praca inżynierska opisująca sklep internetowy zawiera:

1. **Wstęp** — cel i zakres pracy, motywacja, struktura dokumentu
2. **Przegląd literatury / Related Work** — istniejące rozwiązania, porównanie podejść, miejsce projektu w kontekście
3. **Wymagania** — funkcjonalne (user stories lub lista funkcji) i niefunkcjonalne (wydajność, bezpieczeństwo)
4. **Projekt systemu** — architektura (diagram), model danych (ERD), schemat API lub przepływ danych
5. **Implementacja** — wybór technologii z uzasadnieniem, opis kluczowych modułów
6. **Prezentacja systemu** — zrzuty ekranu lub demo, opis każdego widoku
7. **Testy** — manualne lub automatyczne, wyniki (często pomijane w słabszych pracach)
8. **Podsumowanie i perspektywy** — co zrobiono, co można rozwinąć
9. **Bibliografia**

Prace z Theseus (Finland) i DIVA (Sweden) zazwyczaj mają też dodatki z kwestionariuszami i surowymi danymi pomiarowymi.
