# Screenshot shot list

> **Status (2026-06-22):** The five files currently in `phone/` are *web-app captures driven by Playwright at iPhone 14 Pro Max viewport (1290×2796)*, not native iOS captures. They are accurate for the design and copy review and can be used as placeholder assets for Play Store soft-launch, but Apple expects screenshots of the actual native app on submission. Plan to replace them with iOS Simulator captures from an EAS simulator build before the App Store submission. The shot list below describes what each file shows and what the *native* recapture should match.



Capture these screens with realistic-looking content. Don't show real personal email; use a demo account with hand-crafted messages.

## Demo content to seed before shooting

Create these masks in a demo account ahead of time so the captures look natural:

- `mira` (default domain) — labelled "family"-style stripe
- `signups` — for newsletters / 2FA codes
- `shopping-1` — for online orders
- `travel` — for airline / hotel confirmations
- `finance` — for invoices / billing

Then send these test messages **to those addresses** (use the SMTP tester in the README or any external sender):

1. From **United Airlines** → `travel@aliasnest.com`, subject *"Confirmation: SFO → NRT, Oct 12"*, HTML body with the trip summary.
2. From **Notion** → `signups@aliasnest.com`, subject *"Your login code is 491820"*.
3. From **Mira Chen** → `mira@aliasnest.com`, subject *"thinking about your last note"*, plain text 2-3 sentences.
4. From **The New York Times** → `signups@aliasnest.com`, subject *"What we know about the storm in Mumbai"*.
5. From **Anthropic** → `finance@aliasnest.com`, subject *"Your invoice for May is ready"*.
6. From **REI Co-op** → `shopping-1@aliasnest.com`, subject *"Your order has shipped"*.

## Phone shots (required)

Number them in the order you want them displayed in the store listing. Both stores read top-to-bottom in the order of upload.

| # | Screen | State | Caption (overlay this in the store listing form) |
|---|--------|-------|--------------------------------------------------|
| 1 | Inbox (All) | All six demo messages visible, top one unread (vermilion dot) | **A private inbox for every alias you create.** |
| 2 | Reading a message | Open the United confirmation — shows the full editorial header + body + the "travel" stamp at top right | **Read in calm. No ads. No tracking.** |
| 3 | Forward composer | Forwarding the United message to `mira@gmail.com`, with the *"thought you'd want the details"* note | **Forward — send from the alias, not your real address.** |
| 4 | Inbox filtered by an alias | Tap the menu, pick "signups" — show two unread items | **Compartmentalize. One alias per service.** |
| 5 | Settings → Aliases | Show 4-5 aliases with the alias address, unread count, pause/edit/delete affordances | **Pause or delete a leak the moment you spot it.** |
| 6 | Settings → Custom Domains | Show one verified domain + DNS records pending for a second | **Bring your own domain. Verified in minutes.** |
| 7 (optional) | Compose / New | Composing a fresh message from `mira@aliasnest.com` | **Compose new mail from any alias.** |
| 8 (optional) | Login / cold open | The login screen with the seal and "private mail · sealed" tagline | **AliasNest by atsumilabs.** |

### Aspect ratio targets

- **Play Store**: 1080 × 1920 portrait (9:16). Up to 8 shots.
- **App Store · 6.7" Display** (iPhone 15 Pro Max / 16 Pro Max): **1290 × 2796** portrait. **Required.**
- **App Store · 6.5" Display** (iPhone 11 Pro Max / 13 Pro Max): 1242 × 2688 portrait. Required if you support older devices.

### How to capture

- **iOS**: run `eas build --platform ios --profile simulator` (or use the published preview if you have one). In the iOS Simulator, use `File → Open Recent → iPhone 16 Pro Max`, log in to the demo account, and use `Cmd+S` per screen — saves a PNG to your Desktop at the correct native resolution.
- **Android**: run the app on an emulator (`Pixel 8 Pro · API 34` is a good baseline), then `Ctrl+S` in the emulator menu bar, or use the camera icon in the side controls.

## Tablet shots (optional — see README for the iPad-support decision)

Only relevant if you're keeping `ios.supportsTablet: true` and want a polished iPad listing. The current UI is single-column phone-first, so on iPad the inbox sits in the center with paper on either side. It works but isn't tablet-optimized.

If you ship as-is, capture:

| # | Screen | Caption |
|---|--------|---------|
| 1 | Inbox · landscape iPad | **A private inbox, anywhere you sign in.** |
| 2 | Reading · landscape iPad | **Editorial reading on every screen.** |
| 3 | Compose · landscape iPad | **Reply or forward through the alias.** |

### Aspect ratio targets

- **App Store · iPad 13"** (M4 / Pro 12.9"): **2064 × 2752** portrait or 2752 × 2064 landscape. Required if `supportsTablet` is true.
- **Play Store · 7" tablet**: 1080 × 1920 portrait (or matching landscape). Optional.
- **Play Store · 10" tablet**: 1200 × 1920 portrait or larger. Optional.

If you'd rather skip the tablet burden, set `ios.supportsTablet: false` in `mobile/app.json` and rebuild. iPad users can still install the iPhone version from the "iPhone Apps" tab.

## File naming convention

When you save the captures, put them in this folder structure so the store-listing forms are easy to fill:

```
release/screenshots/
├── phone/
│   ├── 01-inbox-all.png
│   ├── 02-reading.png
│   ├── 03-forward.png
│   ├── 04-inbox-filtered.png
│   ├── 05-aliases.png
│   ├── 06-domains.png
│   ├── 07-compose.png        (optional)
│   └── 08-login.png          (optional)
└── tablet/
    ├── 01-inbox.png          (only if shipping iPad)
    ├── 02-reading.png
    └── 03-compose.png
```

Capture each shot at both phone resolutions if you're listing on both stores. iOS Simulator's "iPhone 16 Pro Max" device gives you the 6.7" size; "iPhone 15 Plus" gives 6.5".
