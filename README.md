# What the Hue

A Home Assistant app for sending a Philips Hue serial-number Touchlink reset through a Z-Stack Zigbee coordinator. It is intended for bulbs that cannot be reset with their normal power-cycle sequence.

The app pauses ZHA briefly, sends the reset only to the entered six-character bulb serial, and restores ZHA. It reads the active Zigbee extended PAN ID from a ZHA network backup; it does not ask for or store the network key.

## Install

1. In Home Assistant, open **Settings → Apps → App store → Repositories**.
2. Add `https://github.com/DrB0rk/what-the-hue`.
3. Install **What the Hue**.
4. In the app configuration, select the same serial coordinator used by ZHA, then start the app.
5. Open the app's web interface, enter the bulb serial printed on the label, confirm it, and check that the bulb is powered on close to the coordinator.

When the reset finishes and ZHA is loaded again, open **Settings → Devices & services → ZHA → Add device** to pair the bulb.

## Compatibility

This app uses the Zigbee-herdsman Z-Stack adapter. It is for Z-Stack coordinators such as the TI CC2652-based Sonoff Zigbee 3.0 USB Dongle Plus (Dongle-P). It does not support Silicon Labs Ember coordinators such as the Dongle-E.

## Safety and privacy

- The app is idle until you submit a reset.
- It requires the Home Assistant Core API so it can pause and restore ZHA. Treat this permission like an administrator credential.
- It temporarily unloads the one loaded ZHA config entry and opens the selected serial device directly. Do not stop the app or unplug the coordinator while a reset is running.
- The entered serial number is validated and must be typed twice. The Zigbee network backup is held in memory only; its network key is neither stored nor logged.
- Keep the bulb powered on and within 10 cm of the coordinator for the reset.

See [the app guide](what_the_hue/DOCS.md) for setup and recovery details.
