# AliasNest Privacy Policy

_Last updated: REPLACE-WITH-DATE_

AliasNest is an email-aliasing service operated by **atsumilabs**. This page explains what data we collect and how we use it. The store-listings link here.

> **Reminder before publishing**: fill in the bracketed sections, host this page at a stable HTTPS URL (e.g. `https://aliasnest.com/privacy`), and put that URL in the Play Console and App Store Connect submission forms.

## 1. What we collect

To run the service, we store the following:

- **Account**: your email address (used as login), a salted password hash, and your selected timezone.
- **Aliases**: the alias addresses you create and their associated metadata (display name, paused state).
- **Messages**: every email sent to one of your aliases is stored on our server (sender, recipient, headers, subject, body, attachments) until you delete it.
- **Outbound copies**: when you reply, forward, or compose from an alias, we store a copy of the outbound message alongside the inbound thread.
- **Device push tokens**: if you grant notification permission in the mobile app, we store the FCM (Android) or APNs (iOS) push token to deliver new-mail notifications. The token can be revoked by signing out or by disabling notifications in OS settings.
- **Service logs**: HTTP request logs (IP, timestamp, path) are retained for [INSERT NUMBER] days for abuse and reliability monitoring.

We do **not** collect analytics, behavioural tracking, ad identifiers, or device fingerprints.

## 2. How we use it

- To deliver inbound mail to your alias inbox.
- To send outbound mail (replies, forwards, compose) from your alias.
- To send push notifications when new mail arrives, if you opt in.
- To diagnose abuse, downtime, and bugs from the request logs above.

We do not sell, share, or transfer your data to third parties. We do not use your mail, address book, or replies to train AI/ML models, ours or anyone else's.

## 3. Sub-processors

- **Hosting**: [REPLACE WITH HOSTING PROVIDER, e.g. "Google Cloud Compute Engine"]
- **Outbound SMTP relay**: [REPLACE WITH OUTBOUND PROVIDER, e.g. "Amazon SES"]
- **Push notifications**: Firebase Cloud Messaging (Android), Apple Push Notification service (iOS)

These providers process the data necessary to deliver mail and notifications. They do not have access to your account contents beyond what is strictly necessary for delivery.

## 4. Encryption

- Mail in transit between your device and our server, and between our server and other mail servers, is protected by TLS where the other endpoint supports it.
- Mail at rest on our server is **not** encrypted with a per-user key. We can read the messages we host on your behalf. Treat AliasNest the way you would treat any other ordinary mail service — not the way you'd treat end-to-end encrypted messaging.
- Passwords are stored as salted hashes (bcrypt-equivalent) and are never logged.

## 5. Retention and deletion

- Messages remain on our server until you delete them. Deleted messages are removed from the database immediately and from on-disk message files within 24 hours.
- Aliases you delete are removed immediately, along with all messages received on that alias.
- If you delete your account, your account record, aliases, push tokens, and all stored messages are deleted within 30 days. Service logs containing the IP of your past requests roll off within their normal log retention window above.

## 6. Children

AliasNest is not directed to children under 13 (or the relevant minimum age in your jurisdiction). We do not knowingly collect data from children.

## 7. Changes to this policy

If we make material changes we'll post the update here and bump the date at the top. If the change requires your re-consent, we'll prompt you in-app.

## 8. Contact

Questions, concerns, or data requests: **[REPLACE WITH CONTACT EMAIL, e.g. privacy@atsumilabs.com]**
