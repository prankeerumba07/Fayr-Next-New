# Delivering the login code

`SmsSender` is a **transport**. It receives a code Fayr generated and hashed, and
its only job is to put that code on a phone. Everything that protects the login —
the per-number cooldown, the 5-attempt lock, the per-IP throttle, the block check
— lives in `AuthService`, **above** this layer. Changing provider therefore cannot
change security behaviour, and `security-parity.spec.ts` exists to keep it that way.

## Which sender is live

Set by `SMS_PROVIDER` in `backend/.env`:

| Value | Sender | Behaviour |
|---|---|---|
| unset / `dev` | `DevSmsSender` | Prints the code in the server terminal. **No SMS.** |
| `messagecentral` | `MessageCentralSmsSender` | Real SMS via Message Central MessageNow. |

One line is printed at boot naming the active sender (`BOOT_LINE` in
`sms.provider.ts`). That line is the only reliable way to know which one is live.

**There is no fallback.** A named provider with missing or malformed credentials
**refuses to boot**, naming the exact variable. Falling back to the console sender
would produce a process that looks healthy, an app that says "code sent", and no
text — the failure mode most likely to be discovered in front of an audience.

## Why MessageNow and not VerifyNow

Message Central sells two products. **VerifyNow** generates its own OTP and
verifies it through its own endpoint; we would never see the code, so our cooldown
and attempt lock would be bypassed and the provider would become the identity
authority. **MessageNow** takes our text carrying our code. We use MessageNow.

The same test applies to any future provider: if it wants to generate the code, it
does not fit this interface, and the interface does not bend to accommodate it.

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
