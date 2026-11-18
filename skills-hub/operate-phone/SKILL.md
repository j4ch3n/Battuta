---
name: operate-phone
description: Use when a commissioned task needs the Android phone: waking it, reading what is on screen, tapping, typing, launching apps, or recovering when the screen looks wrong or a screenshot comes back black.
---

# Operate the phone

## Objective

Do commissioned work on the phone reliably by reading screen state as text,
acting on named elements, and confirming each step's effect. Use screenshots
as a last resort.

## Capabilities and boundaries

The phone is controlled over ADB through the `android_*` tools. This skill is
usage guidance only. It grants no authority to post, reply, message, sign in,
create accounts, install apps, or change settings; the assignment decides
that. Never type credentials or enter a lock code. If a sign-in or lock screen
you cannot pass appears, stop and report it as a blocker.

## Workflow

1. **Ready the device.** At the start of phone work, and after any idle gap,
   call `android_ensure_ready`, then `android_preflight`. It wakes the screen
   and swipes up once, which is enough for this phone's swipe-only lock. It
   acts only when the screen is off, so a dimmed screen needs nothing.
   Other tools never wake the phone.
2. **Check state, not pixels.** Read in this order and stop at the first that
   answers the question:
   1. `android_screen_state`: foreground app, activity, orientation, lock state
      (cheapest).
   2. `android_look`: labeled list of on-screen elements.
   3. `android_ui_dump`: full element tree, for hidden or nested elements.
   4. `android_ocr`: text the tree misses, such as web views or images.
   5. `android_screenshot`: only when the above disagree with what you expect
      or you need to diagnose a failure.
3. **Act on names, not coordinates.** Prefer `android_tap` with `text` or a
   resource id over x,y. Use `android_find_and_tap` or `android_scroll_find`
   for targets below the fold. Use `android_type` for text and `clear_first`
   when replacing. Unicode and Chinese text need ADBKeyboard; if typed text
   comes out wrong or empty, report it rather than retrying blindly. Dismiss
   the keyboard with `android_key` back when it covers the target.
4. **Wait for the result.** After a launch or tap that changes screens, use
   `android_wait_activity` or `android_wait` for the expected element instead
   of fixed pauses, then re-read state. Never assume a tap worked.
5. **Confirm and report.** Back each claim with state you read (app, activity,
   element text). Report what you observed, not what you intended.

## When a screenshot is black

A black screenshot is not proof the phone is off or broken. Tell the causes apart:

- **Screen off.** `android_screen_state` shows the lock or no focus. Run
  `android_ensure_ready` and read again.
- **Protected window.** Apps can mark a screen secure (FLAG_SECURE), typically
  sign-in, password, payment and some sensitive screens. Screenshots and
  recordings of it are black by design. If `android_look` or `android_ui_dump`
  still lists elements, the screen is fine: keep working from them. Do not try
  to bypass the protection.
- **Nothing to read.** If the element tree is also empty or errors with a null
  root, the app is mid-transition, behind a dialog, or fully protected. Wait a
  moment, re-read once, press `android_key` back once if a dialog may be open,
  then report a blocker with the foreground app and activity if it persists.
- **Device quirks.** Some manufacturers black out sensitive content on newer
  Android versions. Note the device and Android version in the blocker.

## Example

Good: `android_ensure_ready`, launch the app, `android_wait_activity`, read
`android_look`, tap the search box by `text`, type the query, read
`android_look` again and report the first result titles as text.

Bad: tap fixed coordinates from an old screenshot, take a screenshot after
every step, and conclude the phone is broken when one comes back black.
