# Delivering the login code

`SmsSender` is a **transport**. It receives a code Fayr generated and hashed, and
its only job is to put that code on a phone. Everything that protects the login —
the per-number cooldown, the 5-attempt lock, the per-IP throttle, the block check
— lives in `AuthService`, **above** this layer. Changing provider therefore cannot
change security behaviour, and `security-parity.spec.ts` exists to keep it that way.

## Where we stand — one honest table

| Provider | Status | Free allowance | What blocks it today |
|---|---|---|---|
| **Message Central** | Authenticates, **cannot send** | n/a | Their `/verification/v3/send` returns 400 *"Support for Old MessageNow/VerifyNow-WA is discontinued"*. Their published docs still document that endpoint. No public docs for the "new platform". |
| **2Factor** | **Built, never tested** | ₹ trial credit | No API key yet — their anti-abuse system temporarily banned the signup after a second OTP request seconds after the first. Not permanent. |
| **Twilio** | **Built, never tested** | 100 messages, 30 days | Needs an account. Recipient must be in **Verified Caller IDs** (max 5), and **India must be enabled in Geo Permissions**. Fails 21608 and 21408 respectively. |
| **Fast2SMS** | **Built, never tested** | ₹50 ≈ **10 messages** | Needs an account. Their code 999 may also require one ₹100 wallet transaction before the API works at all. |
| **Dev (console)** | Working | unlimited | Sends nothing. **Refused under NODE_ENV=production.** |

**Four providers, so one vendor's signup can never block the demo again.** Not one of
them has actually delivered a message yet — the only end-to-end proof is
`npm run sms:test`, and it has so far only proved Message Central is dead.

### The standing gap, in plain terms

**None of these is DLT-registered.** Every one of them is on an international or
"quick" route, which means all four are:

- valid for **genuinely user-triggered OTP only**;
- **suspendable or filterable without notice**, with no recourse from our side;
- limited to **small free quotas** (100 Twilio messages, ~10 Fast2SMS messages);
- delivering from a **random numeric sender**, not a Fayr-branded header.

**A DLT-registered Indian route is required before we have real users.** That is a
legal action in the company's name — PAN, GSTIN, TAN, CIN, a director's authorisation
letter, about ₹5,000 + GST, roughly 3–7 working days. Deliberately not started. This
is a **known gap**, listed as one in the security document.

## Which sender is live

Set by `SMS_PROVIDER` in `backend/.env`:

| Value | Sender | Behaviour |
|---|---|---|
| unset / `dev` | `DevSmsSender` | Prints the code in the terminal. **No SMS.** Refused in production. |
| `twilio` | `TwilioSmsSender` | Programmable Messaging, our own body. |
| `fast2sms` | `Fast2SmsSender` | Quick route (`route=q`), no DLT. |
| `2factor` | `TwoFactorSmsSender` | `SMS/{phone}/{otp}` route, our own code. |
| `messagecentral` | `MessageCentralSmsSender` | **Non-functional — see the table above.** |

One line is printed at boot naming the active sender (`BOOT_LINE` in
`sms.provider.ts`). That line is the only reliable way to know which one is live.

**There is no fallback.** A named provider with missing or malformed credentials
**refuses to boot**, naming the exact variable. Falling back to the console sender
would produce a process that looks healthy, an app that says "code sent", and no
text — the failure mode most likely to be discovered in front of an audience.

## Message Central: authentication works, sending is discontinued

**Tested live on 2026-08-19 with real credentials**, using `npm run sms:test`:

```
1⇒ GET  /auth/v1/authentication/token  → 200, a valid JWT
2⇒ POST /verification/v3/send          → 400
   {"responseCode": null,
    "message": "Support for Old MessageNow/VerifyNow-WA is discontinued.
                Please move to our new platform",
    "data": null}
```

So the account and the credentials are **correct** — authentication succeeds and
returns a usable token. The **send endpoint has been retired.**

**Their published API docs still document `/verification/v3/send` on
`cpaas.messagecentral.com`**, so their documentation is stale relative to their own
live service. There is **no public documentation for the "new platform"** they refer
to, and nothing in signup or their console said plain SMS needed approval first.
Plain SMS on this account is effectively gated behind an undocumented platform.

**The class is deliberately KEPT, not deleted.** Every part of it except the send
URL is proven working — auth, token caching, redaction, the failure paths. If they
publish the new endpoint it becomes a config change, not a rewrite. Do not delete
work a vendor might un-break.

**Two docs errors found while implementing it, worth remembering if we return:**
their documented token response is a copy-paste of the *send* response and contains
no token field at all (we accept `token` or `data.token`); and `messageType`
defaults to `OTP`, a mode whose `otpLength` parameter suggests it generates its own
code — which would never match the hash we stored. We default to `TRANSACTION`.

## The one rule every provider must pass: we supply the code

Both vendors offer a mode that generates the OTP for you, and both are refused:

| Provider | Mode we use | Mode we refuse | Why |
|---|---|---|---|
| Message Central | MessageNow (our text) | VerifyNow | It generates AND verifies its own OTP |
| 2Factor | `SMS/{phone}/{otp}` | `AUTOGEN` | It invents the code |
| Twilio | Programmable Messaging | Twilio Verify | It generates AND verifies its own OTP |
| Fast2SMS | Quick route (`route=q`) | their OTP route | It templates a code it controls |

A provider-generated code never matches the hash we stored, so the cooldown, the
5-attempt lock and the block check would all be bypassed and the provider would
become the identity authority. **The interface does not bend to accommodate a
provider** — a provider that insists on generating the code does not fit it.

## 2Factor specifics worth knowing before debugging one

- **HTTP status means nothing.** Every documented failure — invalid key, disabled
  account, expired account, low balance, unapproved sender ID — arrives as
  `{"Status":"Error","Details":"…"}`, and they document no status codes at all.
  `Status` is the only authority, and an unreadable body is a failure.
- **A named template must already be approved** in their dashboard. Leaving
  `TWOFACTOR_TEMPLATE_NAME` blank uses the account's default approved template,
  which is a working setting, not a missing one.
- **Both secrets are in the URL path**, not the query string: the API key and the
  code. `scrubUrlForLog` redacts credential-shaped path segments and is also handed
  the key as a literal. Never log a raw 2Factor URL.
- **No retry, ever.** There is no token to refresh, so no retry could be safe.

## Known limits of the current route — open, not solved

The free international route we are on today:

- is valid for **genuinely user-triggered OTP only**;
- **can be filtered or suspended without notice**, with no recourse from our side;
- has a **small free quota**;
- delivers from a **random numeric sender**, not a Fayr-branded header.

**A DLT-registered Indian route is required before we have real users.** That
registration is a legal action in the company's name (PAN, GSTIN, TAN, CIN, a
director's authorisation letter, ~₹5,000 + GST, roughly 3–7 working days). It is
deliberately not started yet. This is a **known gap**, and it is listed as one in
the security document.

## SMS Retriever autofill

**Do not depend on it.** A random numeric sender means Android's SMS Retriever will
not fire, so typing the code by hand must work perfectly on every screen, every
time.

When we later move to a DLT-registered route and want autofill back, the
11-character app hash embedded in the message must be the hash of the
**Play-signed release key**, not the local debug key. Play App Signing re-signs the
upload, so a debug hash works on the developer's machine and silently fails for
every real user — invisible until launch.

## Never in a log

- **Never the code.** Not on success, not in an error, not inside a provider
  response body — providers echo the request back.
- **Never a full phone number.** `maskMobile` keeps the last two digits so support
  can still match a report to a user; `scrubForLog` masks digit runs in arbitrary
  provider text before it is logged.

## What the user sees when delivery fails

One plain sentence, with no provider name, status code or internal enum:

> We could not send your code just now. Please wait a moment and try again.

Note that the challenge row is written **before** the send, so the 30-second
cooldown applies even to a failed attempt. "Wait a moment" is therefore literally
accurate, and deliberately worded that way.

## Twilio and Fast2SMS specifics worth knowing before debugging one

**Twilio — a 201 is not delivery.** `status` can be `failed` or `undelivered`, and
`error_code` can be set on an otherwise-successful create. Both are checked. The two
trial failures are translated into instructions rather than left as numbers:

| Code | What it really means |
|---|---|
| **21608** | The number is not in **Verified Caller IDs**. Console → Phone Numbers → Manage → Verified Caller IDs. Max 5 on a trial. |
| **21408** | **Geo Permissions** disabled for the region. Console → Messaging → Settings → Geo Permissions, enable India, accept the high-risk dialog. |
| 21606 | The From number cannot send SMS. |
| 21610 | The recipient replied STOP and is unsubscribed. |
| 20003 | Credentials rejected — check `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`. |

**Twilio and DLT.** India's DLT registration applies to the **domestic** route. A
non-Indian account reaching +91 goes over the international (ILDO) route, which is
outside DLT — at the cost of a random numeric sender, higher price and poorer
deliverability. Confirmed against current guidance 2026-08-19.

**Fast2SMS — their failure body shape is NOT published.** The error-code *list* is
(27 codes, every one a test case), but no example failure body is documented anywhere
we could find. So `return === true` is the **only** success signal, checked strictly —
`'true'`, `1` and a missing field are all failures. Inverting that is exactly how a
failure gets reported as a delivered code.

Two Fast2SMS codes an OTP flow will genuinely meet:
- **995** — repeated sends to the same number. **An OTP resend can trip this.**
- **999** — they may require one ₹100 wallet transaction before the API works at all,
  which the free credit alone may not satisfy.

## Credentials never reach a log

Each provider hides its secrets somewhere different, and each needed its own handling:

| Provider | Where the secret is | How it is kept out of logs |
|---|---|---|
| Message Central | `key` **query param**; the token is **in the response body** | `scrubUrlForLog` drops the param; `scrubBodyForLog` drops JWTs and secret-named keys |
| 2Factor | API key and code in the **URL path** | `scrubUrlForLog` hides credential-shaped path segments |
| Twilio | **Basic auth header** (never in the URL) | header only; the token is passed to `scrubBodyForLog` as a literal, because hex has no digit runs |
| Fast2SMS | **`authorization` header** | we POST rather than GET so it never enters a URL |

A response body can *be* the credential — Message Central's token endpoint returns it,
and a JWT contains no runs of four digits, so digit masking alone left it intact. That
was a real leak, found by an adversarial review, and it is why `scrubBodyForLog` exists.
