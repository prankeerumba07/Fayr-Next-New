# The design, and what the app actually has

Every screen in `fayr-design.browser.jsx`, next to what the React Native app in
`src/` has for it today.

**Written before any code was changed.** This is the plan for everything that
follows it.

## How this was produced, so it can be checked and redone

- The list of screens is the design's own `const screens = {}` map, read out of
  the file. Sixty one screens. Nothing here was chosen by hand.
- The order is that map's order, which is also the order in the master prompt.
- The design's own titles, headings, buttons and navigation targets were read out
  of each screen's function body in the same file.
- The React Native side was read from `src/`, from `App.js`, and from
  `src/walkthrough/catalogue.js`, which already maps design keys to real screens
  and is checked against the design file by a test.
- The backend column was checked against the actual route list in
  `backend/src/**/*.controller.ts`.

**What was not done, and should not be assumed:** no screen was compared pixel by
pixel or line by line against a rendered design. The SAME / DIFFERENT / MISSING
column is a structural judgement: does a React Native screen exist for this, and
does it present the same things in the same shape. Where the difference is stated
specifically, it was verified. Where it is stated generally, it was not, and that
is said so in the row.

## The counts

Two columns, because the point of this document is the direction of travel. "When
first written" is the morning of 1 September 2026, before any of Phase B landed.

| | when first written | now |
|---|---|---|
| Screens in the design | **61** | **61** |
| Screens with a React Native screen of their own, in their own file, under the design's own key | **0** | **27** |
| Screens reachable in the app in some form | 41 | 50 |
| Screens with nothing at all behind them | 20 | 11 |
| Design screens still folded into a shared file | **28** across 6 files | **23** across 11 files |
| Further screen files that are not in the design at all | 6 | 6 |

The gap the master prompt names was real, and it was worse than a count of files
suggested. Nineteen files carried forty one design screens, so the average built
file was doing the work of two. The largest single case was
`src/journey/JourneyScreen.js`, one file carrying eleven design screens as ten
interior pages. **That file is now the journey's router and draws none of them.**

**Thirty four to go.** `src/screens/keys.js` holds the register and
`STILL_TO_SPLIT_CEILING` is the ratchet: `src/screens/keys.test.mjs` fails if that
number ever goes up, and fails again if the ceiling is left more than two above the
real figure, so it cannot be quietly parked.

---

## The table

Key to the fourth column:

- **SAME** — a React Native screen exists and presents the same things in the
  same shape.
- **DIFFERENT** — a React Native screen exists but is not the design's screen:
  folded into another screen, reordered, reworded, or missing parts.
- **MISSING** — nothing at all.

| # | design key | what it is for | React Native file today | match | what differs | backend or scraping it needs | does that exist |
|---|---|---|---|---|---|---|---|
| 1 | `splash` | The logo, while the app wakes up and decides where to send you. | `src/firstrun/SplashScreen.js` | SAME | Own file, own key in the first run sequence. Uses the design's own logo mark and wordmark. | none | not needed |
| 2 | `forceupdate` | Tells somebody this version of the app can no longer be used. | NOT BUILT | MISSING | Whole screen absent, and so is the version check that would decide to show it. | a version check the app can ask on start | **no** |
| 3 | `maintenance` | Says Fayr is deliberately down and their money is safe. | NOT BUILT | MISSING | Whole screen absent. A planned outage currently reads to the user as their own phone being broken. | a health answer the app can tell apart from a network failure | `GET /health/ready` exists but the app never asks it |
| 4 | `onboard` | Three short animations introducing Fayr before sign in. | `src/firstrun/OnboardingScreen.js` | SAME | Own file. Three slides, matching the design's three. | none | not needed |
| 5 | `authlanding` | Shop. Review. Earn. The choice of how to sign in. | `src/firstrun/AuthLandingScreen.js` | DIFFERENT | The design offers two ways in, mobile number and Truecaller. The app offers one, because Truecaller is not built. | none | not needed |
| 6 | `truecaller` | Sign in with one tap using a Truecaller verified name and number. | NOT BUILT | MISSING | Whole screen absent. | a way to accept a Truecaller token and mint a session | **no** |
| 7 | `phone` | Typing your mobile number. | `src/firstrun/PhoneEntryScreen.js` | SAME | Own file. Same heading and same single field. | `POST /auth/otp/request` | yes |
| 8 | `otp` | Typing the six digit code. | `src/firstrun/OtpScreen.js` | DIFFERENT | Correct as a screen, but the same file also carries screens 9 and 10 as interior states. | `POST /auth/otp/verify` | yes |
| 9 | `otplocked` | Too many wrong codes, entry paused. | `src/firstrun/OtpScreen.js` (a state) | DIFFERENT | Not its own screen. Reachable only by getting a real code wrong five times, or through the walk through's `showAs` prop. | the lock the backend already applies | yes |
| 10 | `blocked` | This account is restricted, with an appeal route. | `src/firstrun/OtpScreen.js` (a state) | DIFFERENT | Not its own screen. The design offers Submit an appeal and Contact support; the app offers neither. | somewhere for an appeal to go | **no** |
| 11 | `newdevice` | Extra check when signing in on a new phone with money in the wallet. | NOT BUILT | MISSING | Whole screen absent, and nothing recognises a new device. | a device record on the session | **no** |
| 12 | `setupintro` | Welcome to setting up your profile. | `src/setup/SetupFlow.js` (a step) | DIFFERENT | Not its own screen. One file carries screens 12, 14, 15, 16 and 17. | `GET /me` | yes |
| 13 | `setupintrolegacy` | An earlier setting up welcome the design itself replaced. | NOT BUILT | MISSING | Absent, and should probably be deleted from the design rather than built. | none | not needed |
| 14 | `setup` | Age and gender, then categories, then marketplaces. | `src/setup/SetupFlow.js` (a step) | DIFFERENT | Not its own screen. Three questions inside one step, as the design has it, but folded in with four other design screens. | `PATCH /me` | yes |
| 15 | `namelast` | What shall we call you. | `src/setup/SetupFlow.js` (a step) | DIFFERENT | Not its own screen. | `PATCH /me` | yes |
| 16 | `buildfeed` | A moment showing the feed being built for you. | `src/setup/SetupFlow.js` (a step) | DIFFERENT | Not its own screen, and cannot be arrived at directly at all: the step chooser never returns it. | none | not needed |
| 17 | `howfayr` | How Fayr works, and the terms, before the first claim. | `src/setup/SetupFlow.js` (a step) | DIFFERENT | Not its own screen. Also records consent, which the design's screen does. | `PATCH /me` with the consent fields | yes |
| 18 | `home` | The offer feed, with the wallet and the claims in progress. | `src/HomeScreen.js` | DIFFERENT | The design's home carries a hero carousel, banners, a card deck by chapter, a rotating status card and a notification bell. The app's home carries a plain list. Not compared item by item. | `GET /campaigns`, `GET /tasks`, `GET /me/wallet` | yes |
| 19 | `howworks` | A forty five second how it works video. | NOT BUILT | MISSING | Whole screen absent. The design itself leaves the video as a marked space. | somewhere to host a video | **no** |
| 20 | `allcampaigns` | Every live offer on one page, grouped into chapters. | NOT BUILT | MISSING | Whole screen absent. Offers can only be reached by scrolling the feed. | `GET /campaigns` | yes |
| 21 | `detail` | One offer in full: price, refund, seats, rules, and the claim button. | `src/DetailScreen.js` | DIFFERENT | Both are long screens and both carry the design's language. The design's version has a three dimensional hero model and a frequently asked questions block; the app's does not. Not compared item by item. | `GET /campaigns/:id` | yes |
| 22 | `claimedsheet` | Product claimed, now go and buy it. | `src/ClaimOutcomeScreens.js` → `ClaimedScreen` | DIFFERENT | Not its own file. The same component also serves screen 29. | `POST /tasks` | yes |
| 23 | `redirect` | A pause naming the shop while it hands you over. | NOT BUILT | MISSING | Whole screen absent. The app goes straight to the shop. | none | not needed |
| 24 | `confirm` | Confirming what a claim costs before spending tickets. | **REMOVED FROM THE APP** | REMOVED | **The owner ordered this screen removed on 2 September 2026.** His words: "WHEN HE SAYS REMOVE, YOU DELETE. Not hide, not mark, not leave off a path. Delete the file, the key and the route. This replaces the earlier rule in this project that no design screen is ever deleted. That rule is withdrawn." **Why:** the claim happens on the product page now, where the box you tick to accept the terms is, so a separate page asking somebody to confirm the thing they had just confirmed was one tap that added no new information. **What it carried did not vanish:** the ticket cost, the tickets left afterwards and the refund are on the product page directly above the tick box, and how long there is to buy is said at the slot reserved moment, on the connect page and on the before you go page. There is a check for each of the four. `src/screens/confirm.js`, its key in `src/screens/keys.js` and its route in `App.js` were all deleted, and every check that read that file went with it. The register still knows the design has sixty one screens and now says the app has sixty, with this one named as the difference. | none any more | not needed |
| 25 | `insufficient` | You need more tickets than you have. | `src/ClaimOutcomeScreens.js` → `NotEnoughTicketsScreen` | DIFFERENT | Not its own file. | `GET /me/wallet` | yes |
| 26 | `linkaccount` | Connect your marketplace account, with what Fayr can and cannot see. | `src/journey/JourneyScreen.js` (a page) | DIFFERENT | **This is the screen the master prompt is most specific about.** It is one page inside the journey screen. It does not open the marketplace's own login page, does not return you to Fayr on success, does not offer Go to Amazon Now, and does not check that the connected account matches the one signed in on the phone. | the marketplace login WebView in `src/ConnectScreen.js` and `src/platforms.js`; an account identity to store and compare | WebView **yes**; account identity and match check **no** |
| 27 | `seatlost` | Somebody took the last place. | `src/ClaimOutcomeScreens.js` → `JoinFailedScreen` | DIFFERENT | Not its own screen. Shown as the generic failure with the server's reason printed. The design's Join the waitlist button has nothing behind it. | `POST /tasks` refusing with a reason | yes |
| 28 | `enrollfailed` | The claim did not go through, no tickets used. | `src/ClaimOutcomeScreens.js` → `JoinFailedScreen` | DIFFERENT | Not its own file. Shares a component with screen 27. | `POST /tasks` | yes |
| 29 | `enrollsuccess` | You are in. Buy now. | `src/ClaimOutcomeScreens.js` → `ClaimedScreen` | DIFFERENT | Not its own screen. Shares a component with screen 22. | `POST /tasks` | yes |
| 30 | `notifprime` | Asking permission to send reminders. | NOT BUILT | MISSING | Whole screen absent. | notifications of any kind | **no** |
| 31 | `waitlisted` | You are on the waiting list for a place. | NOT BUILT | MISSING | Whole screen absent, and there is no waiting list. This is the only case where a screen that IS built offers a button that goes nowhere. | a waiting list | **no** |
| 32 | `buyinterstitial` | Before you go: buy exactly this one. | `src/journey/JourneyScreen.js` (a page) | DIFFERENT | Not its own screen. Does not copy the product name to the clipboard. | none, plus the clipboard | clipboard **no** |
| 33 | `returncatch` | Did you buy it? Asked on the way back from the shop. | NOT BUILT | MISSING | **Named in the master prompt.** Whole screen absent. The journey works the answer out from the server instead of asking. | none | not needed |
| 34 | `proofprimer` | What the order screenshot has to show. | `src/journey/JourneyScreen.js` (a page) | DIFFERENT | Not its own screen. The design's version offers the inbox route as an alternative; the app's does not, because the inbox route does not exist. | none | not needed |
| 35 | `emailconnect` | Connect your inbox so orders and deliveries are tracked for you. | NOT BUILT | MISSING | **This is the page the owner asked about by name.** Whole screen absent, and so is everything behind it. | an inbox connection, and reading signed order emails | **no** |
| 36 | `emailcode` | The code sent to that inbox, to prove it is yours. | NOT BUILT | MISSING | Whole screen absent. | sending and checking an inbox code | **no** |
| 37 | `proofupload` | Choosing and sending the order screenshot. | `src/ProofUploadScreen.js` | DIFFERENT | Exists as its own file, which is right. One file serves three kinds: order, delivery and review, so it also carries screen 42. | `POST /tasks/:id/screenshot`, `GET /tasks/:id/screenshots` | yes |
| 38 | `ocrconfirm` | Are these the order details we read? Confirm or correct them. | `src/journey/JourneyScreen.js` (a page) | DIFFERENT | Not its own screen, and it does not do the job the master prompt describes: it shows a general result rather than order number, amount, date, product name and marketplace each matched or not. | reading the screenshot, and reading the order history to compare | reading the screenshot **yes**; the field by field comparison **no** |
| 39 | `orderverified` | Order confirmed, refund tracked as pending. | NOT BUILT | MISSING | Whole screen absent. | `GET /tasks/:id` | yes |
| 40 | `imagesuploaded` | Your pictures were received. | NOT BUILT | MISSING | Whole screen absent. | none | not needed |
| 41 | `taskstatus` | Where this claim stands, with its timeline and its money. | `src/TaskScreen.js` | DIFFERENT | Exists as its own file and is the closest match in the app. The same file also serves screen 49. Not compared item by item. | `GET /tasks/:id` | yes |
| 42 | `deliverycheck` | Reading your delivery confirmation from your inbox. | NOT BUILT | MISSING | Whole screen absent, with the inbox route. | the inbox connection | **no** |
| 43 | `deliveryupload` | Sending the delivery screenshot. | `src/ProofUploadScreen.js` (a kind) | DIFFERENT | Not its own screen. Reached by switching kind inside the upload screen, not as a step of its own. | `POST /tasks/:id/screenshot` with kind DELIVERY | yes |
| 44 | `underreview` | Waiting while something is checked, with an expected time. | `src/journey/JourneyScreen.js` (a page) | DIFFERENT | Not its own screen. Shares one page with screens 38 and 49. | `GET /tasks/:id` | yes |
| 45 | `delivery` | Has it arrived? | `src/journey/JourneyScreen.js` (a page) | DIFFERENT | Not its own screen. Saying yes does not run the delivery check the master prompt describes. | the scraper in `src/verify.js`, then `POST /tasks/:id/evidence` | scraper **yes**; wired to this button **no** |
| 46 | `deliverydelayed` | The parcel is late, wrong, or lost, with three different answers. | NOT BUILT | MISSING | Whole screen absent. Somebody in this position writes to support today. | a way to record each of the three outcomes | **no** |
| 47 | `honesty` | One star or five, the money is the same. | NOT BUILT | MISSING | Whole screen absent. The words appear on the review page instead. | none | not needed |
| 48 | `reviewguide` | How to write the review, and what it must contain. | `src/journey/JourneyScreen.js` (a page) | DIFFERENT | Not its own screen. | `GET /campaigns/:id` for the rules | yes |
| 49 | `reviewproof` | Prove the review is posted. | `src/journey/JourneyScreen.js` (a page) | DIFFERENT | Not its own screen. The design offers a link or a screenshot; the app offers a screenshot. | `POST /tasks/:id/screenshot` kind REVIEW | yes |
| 50 | `verifywait` | Your review is being checked, about two days. | `src/TaskScreen.js` | DIFFERENT | Not its own screen. The design has a separate waiting screen with its own wording and expected time. | `GET /tasks/:id` | yes |
| 51 | `returnwindow` | Waiting for the return window to close before the refund. | `src/journey/JourneyScreen.js` (a page) | DIFFERENT | Not its own screen. | `GET /tasks/:id` | yes |
| 52 | `reward` | The refund is yours. | `src/RewardScreen.js` | DIFFERENT | Exists as its own file, which is right. The journey screen ALSO has a refund page, so this screen has two implementations. | `GET /tasks/:id`, `GET /me/wallet` | yes |
| 53 | `myproducts` | Everything you have claimed, by stage. | `src/MyProductsScreen.js` | DIFFERENT | Exists as its own file. Also serves screen 55, which is correct because the design uses one component for both keys. Not compared item by item. | `GET /tasks`, `GET /campaigns` | yes |
| 54 | `notifcenter` | Every update, gathered into one timeline. | NOT BUILT | MISSING | Whole screen absent, and there are no notifications to gather. | notifications | **no** |
| 55 | `campaigns` | The same as screen 53, under an older key. | `src/MyProductsScreen.js` | DIFFERENT | Correctly shares one screen, because the design shares one component. | `GET /tasks` | yes |
| 56 | `insights` | Your profile with the numbers on it. | `src/ProfileScreen.js` | DIFFERENT | Not its own screen. Shares one file with screen 60, which the design keeps apart. | `GET /me`, `GET /me/wallet` | yes |
| 57 | `earnings` | What you have earned and what is still coming. | `src/EarningsScreen.js` | DIFFERENT | Exists as its own file. Not compared item by item. | `GET /me/wallet`, `GET /withdrawals` | yes |
| 58 | `withdraw` | Taking money out, and where to pay it. | `src/WalletScreen.js` | DIFFERENT | Exists as its own file, but under a different name from the design's key. | `POST /withdrawals`, `/me/payout-methods` | yes |
| 59 | `tickets` | Your tickets, and how they come back. | NOT BUILT | MISSING | Whole screen absent. The profile shows a count on a line that does not open. The design's own words here say twenty to start where Fayr gives fifteen. | a ticket history for one person | ticket balance **yes**; history **no** |
| 60 | `profile` | Your account, and the way into help and settings. | `src/ProfileScreen.js` | DIFFERENT | Shares one file with screen 56. Also carries rows the design does not have: chat, help, terms, privacy, the staff offer check and the walk through. | `GET /me` | yes |
| 61 | `verifier` | The on device reader, showing what it can read from a shop. | `src/ConnectScreen.js` | DIFFERENT | Exists, and is the frozen marketplace WebView rather than the design's read out. | `src/verify.js`, `src/extract.js`, `src/session.js`, `src/platforms.js` | yes, and frozen |

---

## The four lists the master prompt asked for

### 1. Design screens with no React Native screen at all — twenty

In the design's order:

| design key | what is missing behind it as well as the screen |
|---|---|
| `forceupdate` | a version check |
| `maintenance` | the app never asks the health route it already has |
| `truecaller` | a second way to sign in |
| `setupintrolegacy` | nothing; the design replaced this itself |
| `howworks` | somewhere to host a video |
| `allcampaigns` | nothing; the offers route already exists |
| `redirect` | nothing |
| `notifprime` | notifications |
| `waitlisted` | a waiting list |
| `returncatch` | nothing |
| **`emailconnect`** | **the whole inbox route. Named by the owner.** |
| **`emailcode`** | **the whole inbox route** |
| `orderverified` | nothing; the task route already exists |
| `imagesuploaded` | nothing |
| **`deliverycheck`** | **the whole inbox route** |
| `deliverydelayed` | a way to record late, wrong or lost |
| `honesty` | nothing |
| `notifcenter` | notifications |
| `tickets` | a ticket history for one person |
| `newdevice` | a device record on the session |

**Eight of these twenty need nothing new from the backend.** They are screens the
app simply does not have: `allcampaigns`, `redirect`, `returncatch`,
`orderverified`, `imagesuploaded`, `honesty`, `setupintrolegacy`, `howworks`
without its video. Those are the cheapest to build and three of them are on the
purchase path the owner wants to test.

### 2. React Native screens that exist and are NOT in the design — six

Listed, not deleted, as instructed.

| file | what it is | what to do with it |
|---|---|---|
| `src/journey/JourneyScreen.js` | One screen with ten interior pages covering eleven design screens. | **This is the largest departure from the design in the app.** The owner requires every page separate. Phase B splits it; this file then has no reason to exist. |
| `src/ChatScreen.js` | Chat with us. | The owner asks for it to be fixed, not removed. It is not in the design, so the design has no screen for it. Keep, and note that the design needs one. |
| `src/SupportScreen.js` | Raise a question with a person. | Not in the design. Reached only from the profile. Keep for now; it is where a handed over conversation goes. |
| `src/PolicyScreen.js` | The terms and the privacy policy. | Not in the design as its own screen; the design shows terms inside `howfayr`. Keep, because consent needs a document to point at. |
| `src/LiveCheckScreen.js` | Staff tool: open every offer page and see if it still works. | Not in the design and not for shoppers. Phase G puts it behind a development flag with the walk through. |
| `src/walkthrough/WalkthroughScreen.js` and `src/walkthrough/OneScreen.js` | The walk through built on 31 August. | Not in the design. **Phase G removes its entry point from the normal journey.** The owner has seen it in Expo Go and does not want it there. |

`src/ui/BottomNav.js` is not on this list: the design has a bottom navigation of
its own.

### 3. Where two or more design screens were folded into one React Native screen

Twenty six design screens are folded into six files. The owner requires them
separate, so every row here is Phase B work.

| React Native file | design screens folded into it | how many |
|---|---|---|
| `src/journey/JourneyScreen.js` | `confirm`, `linkaccount`, `buyinterstitial`, `proofprimer`, `ocrconfirm`, `underreview`, `delivery`, `reviewguide`, `reviewproof`, `returnwindow`, `reward` | **11** |

> **Since then:** all eleven were split out into their own files on 1 September
> 2026, and `confirm` was then removed from the app altogether on 2 September
> 2026 by the owner's order. See row 24. This table is the state before that work.
| `src/setup/SetupFlow.js` | `setupintro`, `setup`, `namelast`, `buildfeed`, `howfayr` | 5 |
| `src/ClaimOutcomeScreens.js` | `claimedsheet`, `enrollsuccess`, `insufficient`, `enrollfailed`, `seatlost` | 5 |
| `src/firstrun/OtpScreen.js` | `otp`, `otplocked`, `blocked` | 3 |
| `src/ProfileScreen.js` | `insights`, `profile` | 2 |
| `src/TaskScreen.js` | `taskstatus`, `verifywait` | 2 |
| | | **28** |

`src/MyProductsScreen.js` carrying both `myproducts` and `campaigns` is **not**
on this list: the design itself points both keys at one component, so keeping
them together follows the design rather than departing from it.

Two design screens have the opposite problem — **two implementations each**,
because the journey screen duplicated a screen that already existed:

| design key | its own file | and also |
|---|---|---|
| `confirm` | `src/ConfirmJoinScreen.js` | the journey's join page |
| `reward` | `src/RewardScreen.js` | the journey's refund page |

This is the defect class where one thing is produced by two different routes.
Splitting the journey removes both duplicates.

> **Since then:** both duplicates are gone. `reward` has one implementation. And
> `confirm` has none: the owner ordered that screen removed on 2 September 2026,
> so neither copy exists. See row 24.

### 4. What the design needs that the backend does not have

Everything else in the design can be built against routes that already exist.
These cannot:

| what is missing | which design screens need it | how big |
|---|---|---|
| **Connecting an inbox, and reading signed order and delivery emails** | `emailconnect`, `emailcode`, `deliverycheck`, and the alternative offered on `proofprimer` | Large. This is the strongest evidence Fayr can hold, because the shop signs its own email and a person cannot forge one. |
| **A field by field comparison of a screenshot against the order history** | `ocrconfirm` | Medium. The screenshot reading exists and the scraper exists; nothing puts order number, amount, date, product name and marketplace side by side and reports each. |
| **Storing which marketplace account is connected, and checking it matches** | `linkaccount` | Medium. Named by the owner. Nothing records an account identity today. |
| Notifications of any kind | `notifprime`, `notifcenter` | Large |
| A waiting list | `waitlisted`, and the button on `seatlost` | Medium |
| A ticket history for one person | `tickets` | Small; the entries are already recorded, nothing reads them back |
| A version check the app asks on start | `forceupdate` | Small |
| Somewhere for an appeal to go | `blocked` | Small |
| A device record on the session | `newdevice` | Medium |
| Recording a late, wrong or lost parcel | `deliverydelayed` | Medium |
| A way to sign in with Truecaller | `truecaller` | Medium |

Two things the master prompt asks for are **not backend work at all** and are
missing purely on the phone:

- **Copying the product name to the clipboard** when the user is sent to the
  shop. Phase E.
- **Opening the marketplace's own installed app** by its deep link, falling back
  to the browser. Phase C.

---

## Where the design itself is wrong, and what the app does instead

Added 1 September 2026, on the owner's instruction.

**The design file is not to be changed. Not for any of this.** It is the
authority on what a screen looks like and what it says, and it stays clean. Where
it states a number that is wrong, or forgets one of its own screens, the app reads
the real number from the backend and the discrepancy is written down here.

### The design states numbers Fayr does not use

| where in the design | what the design says | what Fayr actually does | what the app does |
|---|---|---|---|
| `tickets`, "The loop" card (line 4180) | "Start with **20** → joining locks a few → completing returns them" | Everybody starts with **15**. A claim costs **5**. **10** come back after a completed withdrawal. | Reads the balance and the cost from the backend. The sentence is rewritten with the real figures, not with 20. |
| `confirm`, the Deadline card (line 2403) | "within **48 hours** of joining — by **6 Jul, 6:00 PM**" | The backend expires a claim after its own claim window, **thirty minutes** by default since 1 September 2026. | Already fixed. `src/ui/confirmJoin.js` states the length the server sends and no clock time, and the card is left out entirely if the server sent none. |
| `claimedsheet` (line 2192, 2201) | "yours for the next **2 hours**", counting down from **25m 35s** | Same claim window as above, and it is neither two hours nor twenty five minutes. | The claim outcome screen states the server's own window and counts down to the task's own deadline. No number is invented. |
| `detail`, the claim hint (line 2185) | "Claiming reserves your slot for **48 hours**" | The real slot is the claim window, thirty minutes by default. | The app's hint carries no number at all, so there is nothing to go stale. |
| `returnwindow` (line 3083, 3088) | a ring reading "**5 DAYS**", and "closes on **11 Jul**" | The return window is per category and comes from the campaign. | The screen reads the campaign's own return window. Where the exact date is not known it is not stated. |
| `ocrconfirm` (line 2900) | Order ID **1269146612**, Order Date **2 Jul 2026** | These are whatever the screenshot and the order say. | Every row is filled from the real reading and the real order. Nothing is written into the file. |
| `emailcode` (line 2709) | resend countdown starting at **41** seconds | The backend decides how long a code lasts. | The countdown is handed in, and when nothing hands one in the line says so. |
| `otplocked` (line 766) | a countdown written in as **14:32** | The server sends how long the pause is. | Already fixed. `src/screens/otplocked.js` takes the seconds and says "You can try again shortly" when it has none. |
| `maintenance` (line 530) | "Expected back by **6:00 PM**" | Nothing knows when an outage ends. | Already fixed. `src/screens/maintenance.js` says "We do not have a time yet" when nobody hands a time in. |
| `truecaller` (line 631) | **a real person's name and a real, only partly masked, mobile number** | Neither belongs in the app. | Already fixed. `src/screens/truecaller.js` takes both as parameters and masks the number to its last three digits. Nothing is copied from the design. |

### The design's own list forgets five of its own screens

The design keeps two lists of itself. `const screens = {}` (line 4609) can draw
**sixty one**. `const FLOW_GROUPS` (line 4590) groups **fifty six** of them into
the seven groups the app follows. Five screens the design can draw have no button
in its own list:

    setupintrolegacy    insufficient    deliverycheck    underreview    campaigns

Both counts were read out of the file rather than typed. `src/screens/keys.js`
holds all **sixty one**, because "every page in the design" means every page, and
`src/screens/keys.test.mjs` reads the design file and fails if the two ever
disagree. The walk through carries the five under a group of its own that says
plainly they are missing from the design's own list.

---

## What this means for the phases that follow

- **Phase B is the largest piece of work in the whole prompt.** Forty two new
  screen files: twenty for screens that do not exist, and twenty two to split the
  six folded files apart. Every one of them has to be registered under the
  design's own key and wired into the design's own flow.
- **Phase C, D and F cannot be finished without new backend work.** The inbox
  route, the field by field comparison and the account match check are all
  missing. The screens can be built and wired first; the parts that need the
  backend will be marked plainly on screen rather than faked.
- **Phase G is small and can be done at any point.** It removes an entry point.
- **Phase H is backend work with no new screens.** The chat screen exists.

## A note on the walk through built on 31 August

`src/walkthrough/` already holds a machine readable version of part of this
audit: every design key, whether a real screen exists, and the design's own words
for the ones that do not. A test reads the design file and fails if a screen is
added there and not added to the catalogue.

**That catalogue must be kept in step through Phase B.** As each design screen
gets its own file, its catalogue entry changes from "not built yet" to a real
screen, and the count on the walk through's own first page moves. If the two ever
disagree, the catalogue is the one that is checked by a test and this document is
not, so the catalogue wins.
