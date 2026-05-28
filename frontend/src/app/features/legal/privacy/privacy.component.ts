import { Component } from '@angular/core';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-privacy',
  standalone: true,
  imports: [],
  template: `
    <div class="legal-page">
      <h1>Polityka prywatności</h1>
      <p class="version">Wersja 1.0 &mdash; obowiązuje od 2026-04-09</p>

      <section>
        <h2>1. Administrator danych osobowych</h2>
        <p>Administratorem Twoich danych osobowych jest <strong>{{ s.legalName }}</strong>, z siedzibą w {{ s.street }}, {{ s.postalCode }} {{ s.city }}, NIP: {{ s.nip }} (dalej: <strong>Administrator</strong>).</p>
        <p>Kontakt w sprawach ochrony danych osobowych: <strong>{{ s.rodoEmail }}</strong></p>
      </section>

      <section>
        <h2>2. Podstawa prawna i cel przetwarzania</h2>
        <p>Przetwarzamy Twoje dane w następujących celach i na podstawie wskazanych podstaw prawnych:</p>
        <ul>
          <li><strong>Realizacja umowy sprzedaży</strong> — imię, nazwisko, adres, e-mail, telefon — podstawa: art. 6 ust. 1 lit. b RODO (niezbędność do wykonania umowy).</li>
          <li><strong>Obsługa konta użytkownika</strong> — e-mail, hasło (przechowywane w formie skrótu kryptograficznego) — podstawa: art. 6 ust. 1 lit. b RODO.</li>
          <li><strong>Wystawianie dokumentów księgowych</strong> — dane zakupu — podstawa: art. 6 ust. 1 lit. c RODO (obowiązek prawny).</li>
          <li><strong>Marketingowe (za zgodą)</strong> — e-mail — podstawa: art. 6 ust. 1 lit. a RODO.</li>
          <li><strong>Dochodzenie lub obrona roszczeń</strong> — podstawa: art. 6 ust. 1 lit. f RODO (prawnie uzasadniony interes Administratora).</li>
        </ul>
      </section>

      <section>
        <h2>3. Odbiorcy danych</h2>
        <p>Twoje dane mogą być przekazywane następującym kategoriom podmiotów:</p>
        <ul>
          <li>Operatorzy płatności — Stripe Payments Europe Ltd., w zakresie niezbędnym do realizacji płatności.</li>
          <li>Przewoźnicy — InPost, DHL, GLS, w zakresie niezbędnym do dostarczenia przesyłki.</li>
          <li>Dostawcy usług IT — Supabase Inc. (hosting bazy danych), Resend Inc. (wysyłka e-mail) — jako podmioty przetwarzające na podstawie umów powierzenia.</li>
          <li>Organy państwowe — wyłącznie na żądanie uprawnionego organu i w zakresie wymaganym przez prawo.</li>
        </ul>
        <p>Dane nie są przekazywane do państw trzecich poza EOG bez zapewnienia odpowiednich zabezpieczeń (standardowe klauzule umowne).</p>
      </section>

      <section>
        <h2>4. Okres przechowywania danych</h2>
        <ul>
          <li>Dane związane z zamówieniami — przez okres 5 lat od końca roku kalendarzowego, w którym wystawiono fakturę (obowiązek podatkowy).</li>
          <li>Dane konta użytkownika — do czasu usunięcia konta, nie dłużej niż 3 lata od ostatniego logowania.</li>
          <li>Dane marketingowe — do wycofania zgody.</li>
        </ul>
      </section>

      <section>
        <h2>5. Twoje prawa</h2>
        <p>Na podstawie RODO przysługują Ci następujące prawa:</p>
        <ul>
          <li><strong>Prawo dostępu</strong> do Twoich danych (art. 15 RODO).</li>
          <li><strong>Prawo do sprostowania</strong> danych nieprawidłowych lub niekompletnych (art. 16 RODO).</li>
          <li><strong>Prawo do usunięcia</strong> danych („prawo do bycia zapomnianym") — w przypadkach określonych w art. 17 RODO.</li>
          <li><strong>Prawo do ograniczenia</strong> przetwarzania (art. 18 RODO).</li>
          <li><strong>Prawo do przenoszenia</strong> danych (art. 20 RODO).</li>
          <li><strong>Prawo do sprzeciwu</strong> wobec przetwarzania (art. 21 RODO).</li>
          <li><strong>Prawo do cofnięcia zgody</strong> w dowolnym momencie, bez wpływu na zgodność z prawem przetwarzania dokonanego przed cofnięciem.</li>
        </ul>
        <p>Wnioski prosimy kierować na adres: <strong>{{ s.rodoEmail }}</strong>. Odpowiadamy w terminie 30 dni.</p>
        <p>Masz prawo wniesienia skargi do Prezesa Urzędu Ochrony Danych Osobowych (ul. Stawki 2, 00-193 Warszawa, <a href="https://uodo.gov.pl" target="_blank" rel="noopener noreferrer">uodo.gov.pl</a>).</p>
      </section>

      <section>
        <h2>5a. Procedura usunięcia danych (art. 17 RODO)</h2>
        <p>Aby skorzystać z prawa do usunięcia danych, prześlij żądanie na adres <strong>{{ s.rodoEmail }}</strong> z tytułem <em>„Żądanie usunięcia danych — RODO art. 17"</em>. Podaj adres email powiązany z kontem. Odpowiemy w ciągu 30 dni od daty weryfikacji tożsamości.</p>
        <p><strong>Co zostaje usunięte:</strong> dane konta (email, imię, nazwisko, telefon, hasło, dane Google OAuth), adresy dostawy, tokeny sesji i weryfikacji, dane osobowe w migawkach zamówień (imię, nazwisko, email, telefon).</p>
        <p><strong>Co zostaje zachowane:</strong> rekordy zamówień, płatności i przesyłek — bez danych osobowych — przez 5 lat od wystawienia faktury, zgodnie z art. 74 ustawy o rachunkowości i art. 86 Ordynacji podatkowej.</p>
        <p><strong>Ograniczenie prawa:</strong> usunięcie nie jest możliwe, gdy istnieje nierozliczone zamówienie (PENDING_PAYMENT, PAID, PROCESSING). W takim przypadku prosimy najpierw o anulowanie zamówienia.</p>
      </section>

      <section>
        <h2>6. Pliki cookie</h2>
        <p>Sklep używa plików cookie do:</p>
        <ul>
          <li>Utrzymania sesji użytkownika i koszyka (niezbędne — nie wymagają zgody).</li>
          <li>Zapamiętania preferencji (funkcjonalne — za Twoją zgodą).</li>
        </ul>
        <p>Możesz w każdej chwili zmienić ustawienia przeglądarki dotyczące plików cookie lub cofnąć zgodę klikając przycisk w belce cookie.</p>
      </section>

      <section>
        <h2>7. Kontakt</h2>
        <p>W sprawach związanych z ochroną danych osobowych prosimy kontaktować się pod adresem: <strong>{{ s.rodoEmail }}</strong></p>
      </section>
    </div>
  `,
  styles: [`
    .legal-page { max-width: 740px; margin: 0 auto; padding: 32px 0; }
    h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
    .version { font-size: 13px; color: var(--color-secondary); margin-bottom: 40px; }
    section { margin-bottom: 32px; }
    h2 { font-size: 17px; font-weight: 700; margin-bottom: 12px; border-bottom: 1px solid var(--color-border); padding-bottom: 6px; }
    p { font-size: 14px; line-height: 1.7; margin-bottom: 10px; color: #333; }
    ul { padding-left: 20px; margin-bottom: 10px; }
    li { font-size: 14px; line-height: 1.7; margin-bottom: 6px; color: #333; }
    a { color: var(--color-primary); text-decoration: underline; }
  `],
})
export class PrivacyComponent {
  readonly s = environment.seller;
}
