# CV Guide: IT Professional (Programmer) Without Commercial Experience

*Research based on 12 sources — May 2025*

---

## TL;DR

A junior programmer CV without commercial experience should be **exactly 1 page**, with a Projects section as its centerpiece. The biggest differentiator isn't skills listed — it's demonstrated, quantified work with a clean GitHub. ATS kills 75% of resumes before a human sees them, so formatting and keyword discipline are non-negotiable.

---

## 1. Page Count

| Experience level | Target | Hard cap |
|---|---|---|
| 0–5 years (no commercial XP) | **1 page — strictly** | 1 page |
| 5–10 years | 1 page, 2 acceptable | 2 pages |
| 10+ years | 2 pages norm | 2 pages |

Padding to 2 pages at the junior level signals lack of focus. Every line must earn its space.

---

## 2. Formatting — Exact Numbers

### Margins (A4)

- Standard: **2.54 cm (1 inch)** on all four sides — safe default
- Minimum: **1.27 cm (0.5 inch)** — absolute floor, never go below
- Abnormal margins (too wide or too narrow) cause ATS parsing failures

### Font

| Use | Font options | Size |
|---|---|---|
| Your name | Calibri, Arial, Roboto | **18–24 pt** |
| Section headers | same family | **14–16 pt** |
| Body text | same family | **10–12 pt (11 pt sweet spot)** |

Never go below 10 pt — it degrades both ATS parsing and print output. Stick to **one font throughout**. Good choices: Calibri, Arial, Helvetica, Georgia. For a modern tech feel: **Roboto** or **Ubuntu**.

### Line Spacing

- Within a section / between bullet points: **1.0–1.15**
- Between job/project entries within a section: **1.5 or 6–8 pt extra space**
- Between section blocks (before each section header): **12–18 pt**

### Layout

- **Single column — always**, for any document submitted online or through ATS
- Two-column layouts cause ATS (Greenhouse, Workday, iCIMS) to scramble text across columns
- If you want a two-column version for direct email or in-person: left rail max 40% width, no tables, no text boxes — keep it as a separate file

---

## 3. Section Structure (Ordered by Priority)

For a candidate with no commercial experience, this is the optimal section order:

1. **Contact header** — Name, phone (with country code), professional email, LinkedIn, GitHub URL (`github.com/username`), portfolio URL if exists
2. **Professional Summary** — 3 lines max: target role + 2 strongest skills + one project hook
3. **Skills** — Grouped by category, comma-separated
4. **Projects** — Your 2–3 best, with quantified impact bullets *(most important section)*
5. **Open Source Contributions** — If any — massive differentiator, separate from Projects
6. **Education** — Degree, relevant coursework, GPA if above 3.5/4.0
7. **Certifications**
8. **Other Experience** — Non-IT jobs, keep brief, shows reliability

### What to Omit Entirely

- Birth date, home address, marital status
- "Personal qualities" sections ("hardworking," "team player") — prove it through project bullets instead
- Progress bars, star ratings, skill meters — ATS ignores graphics entirely
- Generic email addresses (e.g. `cooldev99@...`)
- Tables in any section — ATS cannot read table cell content

---

## 4. The Projects Section — Most Important for Juniors

This replaces work experience. Format each entry like a job role:

```
Project Name | Tech Stack | [GitHub link] [Live demo link]
• Built [X] using [Y] that [achieved Z — quantify it]
• Designed [architecture decision] to handle [scale/constraint]
• Integrated [third-party API/service] reducing [metric] by [X%]
```

### Rules

- Case-study framing: **problem → approach → your contribution → measurable result**
- Quantify even for side projects: "reduced initial load time by 40% via lazy loading," "handled 500 concurrent users in stress testing"
- Use action verbs: `Built`, `Designed`, `Integrated`, `Deployed`, `Optimized`, `Refactored` — never "Worked on" or "Helped with"
- Recruiters in 2025 ask: "how did you build it and what was your specific contribution," not just "what did you build"
- A single completed, well-documented project beats five abandoned ones

---

## 5. Skills Section Format

Grouped by category beats a flat list — both for ATS accuracy and human scannability.

```
Languages:     TypeScript, JavaScript, Python, SQL
Frontend:      Angular, React, HTML5, CSS3, Tailwind CSS
Backend:       Node.js, NestJS, Express
Databases:     PostgreSQL, Redis, Prisma ORM
DevOps/Tools:  Git, Docker, GitHub Actions, CI/CD
Methodologies: REST APIs, Agile/Scrum
```

**Hard rule:** Only list what you can speak to in an interview. "5 solid skills beat 20 vague ones" — recruiters flag buzzword salads negatively.

---

## 6. ATS Optimization — Keyword Strategy

- **99.7% of companies** use ATS filters; **75% of software engineer resumes** are rejected before a human reads them
- Including the **exact job title** from the posting makes you **10.6x more likely** to get an interview
- Mirror the JD's exact wording: if it says "React.js," don't write "React"
- Target **8–12 direct keyword matches** against the specific posting (average JD lists 11–15 required skills)
- Contact info must be in the document body — not in headers/footers (invisible to parsers)
- Submit as **text-based PDF** (not scanned/image PDF)
- Name the file: `Firstname_Lastname_CV.pdf`

### Must-Have Keywords for Junior Devs in 2025

`RESTful API`, `Git`, `Docker`, `CI/CD`, `TypeScript`, `JavaScript`, `SQL`, `React` / `Angular` / `Vue` (whichever applies), `Node.js`

### 2025 Bonus Keywords Actively Searched by Recruiters

`prompt engineering`, `AI-assisted development`, `LLM integration`

---

## 7. GitHub — How to Present It

- GitHub URL goes in the **contact header**, not buried in the body
- **Pin 3–6 repositories** — mix of solo projects and open-source contributions
- Every pinned repo must have:
  - A README with: what the project does, why it exists, setup instructions, screenshots or demo GIF, tech stack
  - Meaningful commit history (feature branches, descriptive messages, PRs if collaborative)
  - No 100-commits-in-one-day dumps
- Clean up or make private abandoned tutorials and half-finished repos — recruiters click through
- Create a **profile README** (`github.com/username/username` repo) — treat it as a live mini-portfolio
- Daily green streaks are a myth — consistent, meaningful activity is what signals discipline

---

## 8. Open Source Contributions — The Biggest Differentiator

**78% of hiring managers** say open source activity positively influences their interview decision.

- Create a **separate section** from Projects — it signals real collaboration skills toy projects can't
- Title the entry: "Open Source Contributor" or "Core Contributor" — not "user of"
- Prioritize contributions to **high-visibility repos** (10k+ stars) in your target stack
- Even a well-documented bug fix or one merged PR to a known project beats most solo projects
- Format: `Repository Name (★ stars) | [link] — brief description of your contribution`

---

## 9. Certifications Worth Getting

| Cert | Provider | Impact |
|---|---|---|
| AWS Cloud Practitioner (CLF-C02) | Amazon | High — entry-level cloud signal |
| Azure AZ-900 | Microsoft | High — Azure ecosystem |
| Google Associate Cloud Engineer | Google | High — GCP |
| Meta Frontend Developer | Coursera/Meta | Good for frontend roles |
| MongoDB Developer | MongoDB | Good for fullstack |
| Scrum PSM I | Scrum.org | Shows process awareness |

97% of hiring managers say certified candidates add value — but "a good project beats a PDF certificate every time." Certs supplement, not replace, demonstrated work.

---

## 10. Photo, Cover Letter, GDPR

### Photo

- **Poland:** photo is traditionally expected — include a professional headshot
- **UK / US / Canada:** explicitly discouraged, can be a legal liability — omit it

### Cover Letter

- Write one for every role you genuinely want — one company reported 1,500 applications in the first week; a tailored letter differentiates
- Format: 3 paragraphs max:
  1. Why this specific company
  2. One concrete project proving the key skill they need
  3. A clear ask
- Skip only if: the application explicitly forbids it, or you have a personal referral
- AI-generated generic text is detectable and signals low interest

### GDPR Clause (EU / Poland Submissions)

Add this line at the bottom of the CV document:

> *Wyrażam zgodę na przetwarzanie moich danych osobowych dla potrzeb niezbędnych do realizacji procesu rekrutacji (zgodnie z Ustawą z dnia 29 sierpnia 1997 roku o Ochronie Danych Osobowych; tekst jednolity: Dz. U. 2016 r. poz. 922).*

Without it, your CV is technically non-compliant in Poland and some companies discard it automatically.

---

## 11. Verification Status

| Claim | Sources | Confidence |
|---|---|---|
| 1 page strictly for juniors | 5/12 sources | HIGH |
| 1 inch (2.54 cm) margins standard | 6/12 sources | HIGH |
| 10–12 pt body, 11 pt sweet spot | 6/12 sources | HIGH |
| Single column for ATS | 7/12 sources | HIGH |
| 75% of resumes rejected by ATS | 2/12 sources | MEDIUM |
| 78% of HMs value open source | 1/12 sources (AlgoCademy survey) | MEDIUM — verify independently |
| Photo expected in Poland | 2/12 sources | MEDIUM — regional norm |
| Cover letter "optional is not optional" | 3/12 sources | MEDIUM — some sources disagree |

---

## Sources

1. [LeanCode — How to make your CV stand out as a junior developer](https://leancode.co/blog/how-to-make-your-cv-stand-out-as-a-junior-developer)
2. [MindLabs — What recruiters look for in junior developers 2025](https://mindlabssys.com/blog/what-recruiters-look-in-junior-developers-2025/)
3. [StandOut CV — Junior software developer CV examples](https://standout-cv.com/cv-examples/junior/junior-software-developer-cv)
4. [TechDoor — How to write a CV for a junior programmer](https://techdoor.md/en/how-to-write-a-resume-for-a-junior-programmer/)
5. [airesume.guru — Resume margins, fonts, spacing (ATS)](https://airesume.guru/blog/resume-margins-fonts-spacing)
6. [Enhancv — A4 CV margins in cm (EU)](https://enhancv.com/uk/blog/cv-margins/)
7. [Jobscan — ATS-friendly resume templates & what breaks parsing](https://www.jobscan.co/blog/20-ats-friendly-resume-templates/)
8. [GitHub Docs — Using your GitHub profile to enhance your resume](https://docs.github.com/en/account-and-profile/tutorials/using-your-github-profile-to-enhance-your-resume)
9. [AlgoCademy — Open source contributions on resume](https://algocademy.com/blog/why-you-should-include-open-source-contributions-on-your-resume/)
10. [DEV Community — Junior dev resume in the age of AI (2025)](https://dev.to/dhruvjoshi9/junior-dev-resume-portfolio-in-the-age-of-ai-what-recruiters-care-about-in-2025-26c7)
11. [Tufts Career Center — Cover letters for engineering/tech roles](https://careers.tufts.edu/blog/2025/10/08/do-i-need-to-write-a-cover-letter-engineering-and-tech-addition/)
12. [Northcoders — Writing the perfect junior developer CV](https://northcoders.com/company/blog/writing-the-perfect-junior-developer-cv)
