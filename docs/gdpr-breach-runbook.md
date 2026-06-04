# GDPR Art. 33 — Breach Notification Runbook

**Scope:** Personal data breach at Aromaterie (aromaterie.pl).  
**Legal basis:** RODO Art. 33 (72-hour UODO notification), Art. 34 (individual notification where high risk).  
**Owner:** Administrator danych / DPO contact: rodo@aromaterie.pl

---

## What counts as a breach

Any accidental or unlawful destruction, loss, alteration, unauthorised disclosure of, or access to personal data. Includes:

- Database dump leaked or accessed without authorisation
- Payment-adjacent data exposed (order records, addresses)
- JWT / session tokens exposed in logs or responses
- Stripe webhook secret committed to a public repo
- Supabase service role key leaked
- Email addresses exposed in Sentry scope tags (see prior fix)

---

## Decision tree — do we notify UODO?

```
Breach confirmed?
  └─ No  → document internally, no notification needed
  └─ Yes → is personal data involved?
              └─ No  → document internally
              └─ Yes → is risk to rights and freedoms UNLIKELY?
                          └─ Yes (e.g. encrypted backup tape lost,
                                  key not compromised)
                                → document internally (Art. 33(1) exception)
                          └─ No → NOTIFY UODO within 72 hours
```

Default: when in doubt, notify. Failure to notify when required is a separate infringement.

---

## 72-hour clock

The clock starts when the **processor or any staff member** first becomes aware that a breach has occurred — not when the root cause is confirmed.

| T + 0 h | Breach detected (alert, customer report, pen test finding, log anomaly) |
| T + 4 h | Internal triage complete — scope and data categories confirmed |
| T + 24 h | Preliminary notification drafted |
| T + 72 h | **UODO notification submitted** |

If full facts are not known at T+72h, submit what is known and supplement later (Art. 33(4) allows phased notification).

---

## UODO notification — required fields (Art. 33(3))

Submit via: https://uodo.gov.pl/pl/83/153 (electronic form, requires qualified e-signature or ePUAP)

| Field | What to provide |
|---|---|
| Nature of the breach | e.g. "Unauthorised access to order database — names, addresses, email addresses of approx. N customers" |
| Categories and approximate number of data subjects | e.g. "Customers who placed orders between [date] and [date] — approx. N records" |
| Categories and approximate number of personal data records | Order records, email addresses, delivery addresses |
| Name and contact details of DPO | rodo@aromaterie.pl |
| Likely consequences | e.g. "Risk of phishing, identity theft" |
| Measures taken | e.g. "Session tokens revoked, Supabase keys rotated, affected users notified" |

---

## Individual notification (Art. 34) — high risk

Notify affected data subjects directly (email from rodo@aromaterie.pl) when the breach is **likely to result in high risk** — e.g. financial data, health-adjacent data (fragrance sensitivities), or data enabling identity theft.

Template subject line: `[Aromaterie] Ważna informacja dotycząca Twoich danych`

Required content:
1. Plain-language description of what happened
2. Likely consequences
3. Steps taken by the controller
4. Contact for questions: rodo@aromaterie.pl

---

## Immediate technical response checklist

- [ ] Identify scope: which tables / S3 paths / logs were exposed
- [ ] Revoke all active JWT refresh tokens (`DELETE FROM refresh_tokens`)
- [ ] Rotate: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`
- [ ] Invalidate all active Stripe webhook endpoints and re-register
- [ ] Force password reset for affected users if credentials exposed
- [ ] Preserve evidence: export relevant logs to secure storage before rotating
- [ ] Patch the vulnerability before re-enabling affected endpoints

---

## Internal documentation (always required — Art. 33(5))

Maintain a breach register at: `docs/breach-register.md` (private, not checked in to public repo).

Fields per incident:
- Date/time detected
- Date/time notified to UODO (or reason for no notification)
- Nature, categories, approximate number of records
- Measures taken
- Outcome

---

## Contacts

| Role | Contact |
|---|---|
| Data Protection (RODO) | rodo@aromaterie.pl |
| Security incidents | security@aromaterie.pl |
| UODO (Polish DPA) | https://uodo.gov.pl — ul. Stawki 2, 00-193 Warszawa |
| Stripe security (if payment data involved) | https://stripe.com/docs/security |
