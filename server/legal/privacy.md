<!-- DRAFT 2026-11-12. Not lawyer-reviewed. Page: /privacy. Written to match the code as it is today:
     visits table (IP, GeoIP, device, referrer, time on page, scroll), localStorage mm_vid, cookie mm_session,
     SQLite on Railway, Mailjet, Stripe, DeepSeek-based AI pipeline, reports public by link.
     [DECIDE] items change the text: analytics consent / mm_vid, retention periods, EU/UK representative, Malaysian DPO. -->

# Privacy Notice

Last updated: [DATE]

## In short

- We keep your **email address, orders and invoices** so you can sign in and receive your reports.
- We **log visits to our site**, including your IP address, approximate location and device.
- **Stripe** takes your payment. We never see or store your card number.
- We make reports about **businesses** from free public sources. These can include the **names and roles of people** linked to a business. Reports can be opened by anyone with the link.
- You can ask us to see, correct or delete your data, and you can object to being named in a report: [privacy@mirrormirror.cloud](mailto:privacy@mirrormirror.cloud).

## 1. Who is responsible

**MirrorMirror.cloud**, operated by [OWNER FULL LEGAL NAME], sole proprietor, [SSM NO.], [ADDRESS], Malaysia, is responsible for your personal data (the "controller"). Contact: [privacy@mirrormirror.cloud](mailto:privacy@mirrormirror.cloud).
[DECIDE, with lawyer: Malaysian data protection officer details; EU and UK representative if we target EU/UK residents.]

This notice covers three groups of people:

- **A. Visitors and customers**: people who use our site, sign in or order.
- **B. People named in reports**: directors, owners, staff and reviewers connected to a business we report on. They are usually not our customers.
- **C. Business contacts we email**: people at businesses we contact about a free preview.

## 2. Visitors and customers (group A)

| What we use it for | Data | Why we may (legal basis) | How long we keep it |
|---|---|---|---|
| Your account and sign-in | Email address; sign-in links and session (stored only as scrambled codes); the devices you signed in from | To provide the service you ask for (contract) | While your account is open, then [12 months] |
| Orders and invoices | Email, company ordered, amount, date, invoice number, Stripe payment reference | Contract; legal duty to keep business records | [7 years], as tax law requires |
| Payment | Stripe collects your card and billing details on its own page. We receive the payment status, amount and reference only | Contract | Our part: as for invoices. Stripe's part: see Stripe's privacy policy |
| Emails we send you | Email address; a log of each email (type, time, delivered or failed) | Contract | [24 months] |
| Free preview requests | Company name, who it is for (your company, a competitor, a supplier), country, website | Contract | While your account is open |
| Site analytics and security | IP address; approximate location (country, region, city) worked out from the IP; browser, operating system and device type; the page, the page you came from, time on page and how far you scrolled; screen size, language and time zone; a random visitor id stored in your browser; your account, if you are signed in | Our legitimate interest in running, securing and improving the site. The browser id, and the screen size, language and time zone sent with it, only with **your consent** if you are in the EU, EEA, UK or Switzerland (section 7) | [13 months] [DECIDE] |
| Abuse limits | Email and IP address of sign-in attempts | Legitimate interest in preventing abuse | [30 days] |

**We do not** sell your data, use advertising trackers, or share your data for advertising. We **never tell a company who ordered a report about it.**

## 3. People named in reports (group B)

We make reports about **businesses**, not about private individuals. To describe a business, a report can include personal data that is already public, such as:

- names and roles of directors, owners and officers, from company registries and the company's own websites;
- names of staff, and business phone numbers or email addresses, where they appear on the company's websites, listings or social media; [CONFIRM what the reports really show]
- reviewers' names or initials, review text and dates, from public review sites.

**Sources:** company registries, Google Maps and review sites, the company's websites and social media, business directories and news.

**Why (legal basis):** our legitimate interest, and our customers', in understanding how a business presents itself in public. We limit the personal data to what describes the business. If we find staff contact details exposed in a way that may harm the people concerned, we show it only as a private warning, and we never use it to sell.

**Who can see it:** reports can be opened by **anyone who has the link** (our customer and anyone they share it with). Reports are not listed by search engines.

**How long:** while the report exists [CONFIRM: e.g. up to 3 years], or until you ask us to remove your data.

**Your choices:** you can object, or ask us to correct or remove your personal data from a report, at any time: [corrections@mirrormirror.cloud](mailto:corrections@mirrormirror.cloud) or our [Corrections page](/corrections). We publish this section instead of writing to each person named, because we usually have no way to contact them.

## 4. Business contacts we email (group C)

We find business email addresses published on company websites and directories, and may email a business once about its free preview. We use the business name, website, email address and any public business details.

**Why:** our legitimate interest in offering a business a free report about itself. Where the law requires consent first, we ask for it or do not send.
**Your choice:** every such email has an **unsubscribe link**. After you unsubscribe we keep your address on a do-not-contact list only, so we never email you again.
**How long:** until you unsubscribe, or [24 months] after our last email if you never reply.

## 5. Who receives data

We share data only with service providers who work for us, under contract, and only what each one needs:

| Provider (type) | What they receive | Where |
|---|---|---|
| Stripe (payments) | Your email and the order; Stripe collects card and billing details directly | USA and others |
| Mailjet (email delivery) | Your email address and the email we send | EU |
| Railway (hosting of our site and database) | All data held by the site | USA |
| AI model provider (writes and checks reports) | Public information about the business being reported on, which can include the names in section 3. **Not** your account, email or payment data | [COUNTRY: confirm where the provider processes data and whether it keeps prompts] |
| Report database host | The reports and the public information behind them | [COUNTRY] |

We may also disclose data if the law requires it, or to protect our rights.

## 6. International transfers

We are based in Malaysia, and our providers process data in other countries, including the USA [and the AI provider's country]. Where the law requires it, we use contract terms or other lawful safeguards for these transfers.

<a id="cookies"></a>
## 7. Cookies and similar storage

| Name | Type | What it does | How long |
|---|---|---|---|
| `mm_session` | Cookie, essential | Keeps you signed in | 30 days |
| `mm_consent` | Browser storage (localStorage), essential | Remembers your answer to our privacy question ("yes" or "no") | Until you clear your browser data |
| `mm_vid` | Browser storage (localStorage), analytics | A random id that groups your visits from one browser | Until you clear your browser data |
| Office cookie | Cookie, essential | Staff access only | 30 days |

**If you are in the EU, EEA, UK or Switzerland** (or we cannot tell your country from your IP address), we ask before storing `mm_vid`. Until you choose **Allow**, your browser keeps no id and sends us only the time you spent on the page, how far you scrolled and the page title. If you choose **No thanks**, we remove any id already stored and respect that choice wherever you are. The page works the same either way.

**Elsewhere**, we store `mm_vid` without asking, and you can say no at any time.

You can change your choice at any time with **Cookie choices** at the bottom of every page, or by clearing your browser data. Either way, our server still records each page you open (section 2), because that is how the site counts visits and keeps itself secure.

## 8. Your rights

Depending on where you live, you can ask us to:

- tell you what data we hold about you and give you a copy;
- correct it;
- delete it;
- stop or limit using it, or object to our use of it (including being named in a report);
- give it to you in a common file format;
- withdraw consent you gave.

Write to [privacy@mirrormirror.cloud](mailto:privacy@mirrormirror.cloud). We reply within **30 days**. We may ask you to confirm the request from the email address the data is linked to, or for something that shows the data is about you.

You can also complain to a regulator: in Malaysia, the **Personal Data Protection Commissioner**; in the UK, the **ICO**; in the EU, the data protection authority of your country. **USA (e.g. California):** we do not sell or share personal data for cross-context advertising, and you have the rights above.

## 9. Security

Sign-in links and sessions are stored only as scrambled (hashed) codes. Session cookies cannot be read by page scripts. Access to staff pages needs a separate key. No system is perfectly secure; if a breach affects you, we will tell you and the regulator where the law requires.

## 10. Children

The service is for businesses and is not meant for anyone under 18.

## 11. Changes

We will post changes here with a new date, and email account holders about important changes.
