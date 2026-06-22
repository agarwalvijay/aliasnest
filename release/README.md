# AliasNest · release prep

Everything you need to file the app under Google Play (Android) and the App Store (iOS). Nothing here is loaded by the app at runtime; this folder is for store submission.

```
release/
├── README.md                  · this file
├── store-listing/             · short/long descriptions, keywords, subtitle, promo text
├── icons/                     · store-required icon sizes (512, 1024)
├── feature-graphic/           · Play Store 1024×500 landscape banner (svg + png)
├── screenshots/
│   ├── phone/                 · you fill this (see SHOTS.md)
│   ├── tablet/                · you fill this (see SHOTS.md, optional)
│   └── SHOTS.md               · the shot list, captions, and capture instructions
└── policy/
    └── privacy-policy.md      · starter privacy policy — fill in the bracketed sections and host at a stable URL
```


## TL;DR for each store

### Google Play

1. Create the app in the Play Console with package name **`com.aliasnest.aliasnest`** (already set in `mobile/app.json`).
2. Build the signed AAB: `cd mobile && eas build --platform android --profile production`. EAS will host the `.aab` for download.
3. Upload it to Production → Releases. Skip internal/closed testing tracks if you want a direct production launch (or use them as a soft-launch step — recommended).
4. Fill in the **Main store listing** with the files in `store-listing/`:
   - **App name**: `AliasNest`
   - **Short description**: `store-listing/short-description.txt`
   - **Full description**: `store-listing/long-description.txt`
   - **App icon**: `icons/icon-512.png`
   - **Feature graphic**: `feature-graphic/feature-graphic.png`
   - **Phone screenshots**: at least 2 from `screenshots/phone/` (see SHOTS.md)
   - **Category**: Communication
   - **Tags**: Email, Privacy
   - **Content rating questionnaire**: answer truthfully → almost certainly **Everyone**.
   - **Data safety form**: see the "Data safety" section below.
   - **Privacy policy URL**: the public URL where you host `policy/privacy-policy.md`.
5. **Closed testing first**: before going live, create a closed track with ~5 testers and let it bake for 14 days. Google enforces this for new personal Play accounts.

### Apple App Store

1. Create the app in App Store Connect with bundle ID **`com.aliasnest.app`** (already set in `mobile/app.json`).
2. Build the signed IPA: `cd mobile && eas build --platform ios --profile production`. EAS will prompt for Apple credentials on the first run.
3. Submit it: `eas submit --platform ios --latest`. This uploads to App Store Connect; from there, attach the build to a version and submit to review.
4. Fill in the App Store Connect listing:
   - **App name**: `AliasNest` (30 char max)
   - **Subtitle**: `store-listing/subtitle.txt` (30 char max)
   - **Promotional text**: `store-listing/promo-text.txt` (170 char max, editable post-launch without re-review)
   - **Description**: `store-listing/long-description.txt`
   - **Keywords**: `store-listing/keywords.txt` (100 char max)
   - **App icon**: pulled automatically from your build's bundled 1024 PNG (already produced from `mobile/assets/icon.svg`). The same image is also at `icons/icon-1024.png` for reference.
   - **Screenshots**: 6.7" Display required, see SHOTS.md.
   - **Primary category**: Productivity (or Utilities — both defensible)
   - **Support URL & Marketing URL**: a public page on aliasnest.com or atsumilabs.com
   - **Privacy policy URL**: the public URL where you host `policy/privacy-policy.md`.
   - **App Privacy questionnaire**: see "App privacy" below.


## Data safety (Play Console) cheat sheet

The Play Console asks a long form; here's how to answer based on what the app actually does:

| Question | Answer |
|---|---|
| Does your app collect or share user data? | **Yes** |
| Is data collected only for app functionality? | **Yes** |
| Are you a third-party data broker? | **No** |
| Is data encrypted in transit? | **Yes** (TLS) |
| Can users request data deletion? | **Yes** — account deletion deletes data within 30 days |
| Categories collected | **Email address** (Account info), **Email messages** (Messages), **Device IDs** (push token, optional) |
| Categories shared | **None** |
| Why each category is collected | App functionality |


## App privacy (App Store Connect) cheat sheet

App Store Connect asks for "Data Linked to You / Not Linked / Used to Track":

| Data type | Used to Track? | Linked to user? | Purpose |
|---|---|---|---|
| Email address | No | **Linked** | App functionality (login) |
| Other user content (mail body, headers, attachments) | No | **Linked** | App functionality |
| Device ID (FCM/APNs push token) | No | **Linked** | App functionality (push notifications) |

Apple's "track" definition refers to cross-app/cross-website tracking for ads. You don't do that, so every "track" answer is No.


## Tablet (iPad / large-screen Android)

**Honest assessment**: the app is single-column, phone-first. It runs on tablets but doesn't reflow into a multi-pane layout. On a 13" iPad the inbox sits in the center of a wide paper field — not bad, but not optimized.

**Two paths**:

1. **Phone-only first launch (recommended)**:
   - Open `mobile/app.json` and set `ios.supportsTablet` to `false`.
   - Rebuild iOS and submit. No iPad screenshots needed.
   - iPad users can still install via the App Store's "iPhone Apps" tab.
   - Android automatically supports tablets; you can skip the optional 7"/10" tablet screenshots in Play Console without penalty.

2. **Ship with tablet support as-is**:
   - Leave `ios.supportsTablet: true`.
   - Capture iPad screenshots per `screenshots/SHOTS.md` (3 shots is enough).
   - Listing quality is fine; the app just looks like a wide phone on iPad.

I'd take path #1 for the first release and revisit a true tablet layout (master/detail split, wider read pane, etc.) before claiming iPad as a first-class platform.


## Pre-flight checklist

Before you hit submit on either store:

- [ ] Replace bracketed sections in `policy/privacy-policy.md` and publish it at a stable HTTPS URL.
- [ ] Decide tablet path (see above) and update `mobile/app.json` accordingly.
- [ ] Capture all phone screenshots into `screenshots/phone/` per `SHOTS.md`.
- [ ] (If keeping iPad) Capture tablet screenshots into `screenshots/tablet/`.
- [ ] Build production binaries: `eas build --platform all --profile production`.
- [ ] Self-test the production build on a real device — log in to a fresh account, create a mask, send/receive a message, reply, forward, delete.
- [ ] Push notifications: confirm the notification icon shows the seal (the kanji silhouette) in the Android status bar, not a generic dot.
- [ ] Verify `app.atsumilabs.com` / `aliasnest.com` is reachable over HTTPS from outside your network.
- [ ] Update version + buildNumber in `mobile/app.json` before each submitted build.
- [ ] Submit Android (Play Console) and iOS (App Store Connect / `eas submit`).


## What's been done in this folder

- ✅ Store icons regenerated from the new seal SVG at 512 and 1024.
- ✅ Play Store feature graphic designed (`feature-graphic/feature-graphic.svg`, rasterized to PNG).
- ✅ Short description, long description, subtitle, promo text, keywords drafted in `store-listing/`.
- ✅ Screenshot shot list with demo content seeding + per-shot captions written in `screenshots/SHOTS.md`.
- ✅ Privacy policy starter in `policy/privacy-policy.md` — fill in the bracketed sections, host it, and link the URL.
- ✅ Notification icon (`mobile/assets/notification-icon.png`, 96×96 white-on-transparent) and `app.json` updated to use it with the seal red tint on Android.

## What still needs hands-on work from you

- 📸 Capturing the actual screenshots (you, on a simulator/emulator).
- 🌐 Publishing the privacy policy at a real URL.
- 🎟️ Apple Developer Program enrollment ($99/yr) if not already.
- 🪪 Google Play Console developer account ($25 one-time) if not already.
- 🔐 First-time iOS code-signing credentials in EAS (interactive prompts on first `eas build --platform ios --profile production`).
- 🧪 Closed-testing track on Play Console (14-day soak for new personal accounts).
