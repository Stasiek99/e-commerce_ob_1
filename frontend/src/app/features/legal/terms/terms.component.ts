import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-terms',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="legal-page">
      <h1>Regulamin sklepu</h1>
      <p class="version">Wersja 1.0 &mdash; obowiązuje od 2026-04-09</p>

      <section>
        <h2>§1. Postanowienia ogólne</h2>
        <p>Sklep internetowy Fragrance Store, dostępny pod adresem fragrance-store.pl (dalej: <strong>Sklep</strong>), prowadzony jest przez&nbsp;[Nazwa spółki], z&nbsp;siedzibą w&nbsp;[Adres], wpisaną do rejestru&nbsp;[KRS/CEIDG], NIP: [NIP], REGON: [REGON].</p>
        <p>Niniejszy regulamin określa zasady i&nbsp;warunki korzystania ze Sklepu, składania zamówień, realizacji dostawy, płatności, prawa do&nbsp;odstąpienia od&nbsp;umowy oraz trybu składania reklamacji.</p>
        <p>Kupującym może być wyłącznie osoba fizyczna, która ukończyła 18&nbsp;lat lub osoba prawna.</p>
      </section>

      <section>
        <h2>§2. Rejestracja i konto klienta</h2>
        <p>Dokonywanie zakupów nie wymaga rejestracji. Rejestracja konta jest dobrowolna i pozwala na śledzenie historii zamówień, zarządzanie adresami dostawy oraz szybsze składanie kolejnych zamówień.</p>
        <p>Klient jest zobowiązany do podania prawdziwych i aktualnych danych. Hasło do konta powinno być przechowywane w tajemnicy.</p>
      </section>

      <section>
        <h2>§3. Zamówienia</h2>
        <p>Zamówienia można składać 24 godziny na dobę, 7 dni w tygodniu poprzez stronę internetową Sklepu.</p>
        <p>Złożenie zamówienia stanowi ofertę zawarcia umowy sprzedaży. Umowa zostaje zawarta z chwilą potwierdzenia przyjęcia zamówienia do realizacji, co Sklep potwierdza drogą e-mail.</p>
        <p>Sklep zastrzega sobie prawo do odmowy realizacji zamówienia w przypadku błędnych danych kontaktowych lub braku dostępności produktu.</p>
      </section>

      <section>
        <h2>§4. Ceny i płatności</h2>
        <p>Wszystkie ceny podane w Sklepie są cenami brutto (zawierają podatek VAT) wyrażonymi w złotych polskich (PLN).</p>
        <p>Sklep obsługuje płatności elektroniczne za pośrednictwem serwisu <strong>Stripe</strong> (Stripe Payments Europe Ltd.). Dostępne metody płatności obejmują karty płatnicze, BLIK, Przelewy24 oraz Apple Pay / Google Pay.</p>
        <p>Zamówienie jest realizowane po zaksięgowaniu wpłaty.</p>
      </section>

      <section>
        <h2>§5. Dostawa</h2>
        <p>Zamówienia wysyłamy na terenie Polski za pośrednictwem InPost (paczkomat), DHL lub GLS.</p>
        <p>Koszt dostawy jest podany przy wyborze metody dostawy w trakcie składania zamówienia.</p>
        <p>Czas realizacji zamówienia wynosi od 1 do 3 dni roboczych od momentu potwierdzenia płatności.</p>
      </section>

      <section>
        <h2>§6. Prawo do odstąpienia od umowy</h2>
        <p>Konsument ma prawo odstąpić od umowy zawartej na odległość bez podania przyczyny w terminie <strong>14 dni</strong> od dnia otrzymania towaru.</p>
        <p>Szczegółowe informacje dotyczące prawa do odstąpienia od umowy oraz wzór formularza odstąpienia dostępne są na stronie
          <a routerLink="/legal/withdrawal">Prawo odstąpienia</a>.
        </p>
      </section>

      <section>
        <h2>§7. Reklamacje</h2>
        <p>Sklep odpowiada za wady fizyczne i prawne sprzedanego towaru na zasadach określonych w ustawie z dnia 23 kwietnia 1964 r. – Kodeks cywilny (rękojmia).</p>
        <p>Reklamacje można zgłaszać drogą e-mail na adres: <strong>kontakt&#64;fragrance-store.pl</strong> lub pisemnie na adres siedziby Sprzedawcy.</p>
        <p>Reklamacja powinna zawierać: imię i nazwisko, numer zamówienia, opis wady oraz oczekiwany sposób rozwiązania sprawy. Sklep rozpatruje reklamacje w terminie 14 dni roboczych.</p>
      </section>

      <section>
        <h2>§8. Ochrona danych osobowych</h2>
        <p>Administratorem danych osobowych jest [Nazwa spółki]. Zasady przetwarzania danych osobowych opisano w <a routerLink="/legal/privacy">Polityce prywatności</a>.</p>
      </section>

      <section>
        <h2>§9. Pozasądowe metody rozwiązywania sporów</h2>
        <p>Konsument ma prawo skorzystać z pozasądowych metod rozpatrywania reklamacji i dochodzenia roszczeń, w tym z mediacji prowadzonej przez Inspekcję Handlową. Platforma ODR Komisji Europejskiej dostępna jest pod adresem: <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener noreferrer">ec.europa.eu/consumers/odr</a>.</p>
      </section>

      <section>
        <h2>§10. Postanowienia końcowe</h2>
        <p>W sprawach nieuregulowanych niniejszym regulaminem zastosowanie mają przepisy prawa polskiego, w szczególności Kodeksu cywilnego oraz ustawy z dnia 30 maja 2014 r. o prawach konsumenta.</p>
        <p>Sklep zastrzega sobie prawo do zmiany regulaminu. O każdej zmianie zarejestrowani Klienci zostaną poinformowani drogą e-mail z 14-dniowym wyprzedzeniem.</p>
      </section>
    </div>
  `,
  styles: [`
    .legal-page { max-width: 740px; margin: 0 auto; padding: 40px 0; }
    h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
    .version { font-size: 13px; color: var(--color-secondary); margin-bottom: 40px; }
    section { margin-bottom: 32px; }
    h2 { font-size: 17px; font-weight: 700; margin-bottom: 12px; border-bottom: 1px solid var(--color-border); padding-bottom: 6px; }
    p { font-size: 14px; line-height: 1.7; margin-bottom: 10px; color: #333; }
    a { color: var(--color-primary); text-decoration: underline; }
  `],
})
export class TermsComponent {}
