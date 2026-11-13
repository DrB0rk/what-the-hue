# Hue Serial Reset app guide

This app sends the Philips manufacturer-specific serial-number Touchlink reset used to recover a Hue bulb that will not reset through its usual power-cycle sequence.

## Before you start

- Home Assistant OS or Supervised, with the Supervisor app store.
- A loaded ZHA integration using one Z-Stack coordinator.
- The selected coordinator must be available to the app. The app uses the same serial adapter directly only during a reset.
- The bulb must be powered on and within 10 cm of the coordinator.
- Find the six hexadecimal characters printed on the bulb, for example `92F796`.

Supported coordinators include the TI CC2652-based Sonoff Zigbee 3.0 USB Dongle Plus (Dongle-P). The Silicon Labs Ember-based Dongle-E is not supported by this Z-Stack adapter.

## Install and configure

1. Add `https://github.com/DrB0rk/hue-serial-reset` under **Settings → Apps → App store → Repositories**.
2. Install **Hue Serial Reset**.
3. Open the app's **Configuration** tab and select the same USB serial coordinator configured in ZHA.
4. Save the configuration and start the app.
5. Open **Open Web UI**.

The app checks that ZHA is loaded and the configured serial device is present before enabling the reset button.

## Reset one bulb

1. Enter the bulb's six-character serial number.
2. Type the same number into the confirmation field.
3. Turn the bulb on and place it within 10 cm of the coordinator.
4. Check the proximity confirmation and select **Send reset to this bulb**.
5. Keep the bulb and coordinator powered while the app sweeps the Zigbee channels. This takes about 20 seconds.
6. Wait for **ZHA is loaded again** in the operation log.
7. In Home Assistant, open **Settings → Devices & services → ZHA → Add device** to pair the bulb.

The serial number is encoded into a command addressed to that bulb. The app does not open network joining or send a general factory reset to all nearby devices.

## What the app does

1. Requests a ZHA network backup in memory and reads only its extended PAN ID.
2. Temporarily disables the loaded ZHA config entry so its coordinator port is released.
3. Uses the Zigbee-herdsman Z-Stack adapter to send the Philips reset on channels 11–26.
4. Restores the coordinator's Inter-PAN state, closes the serial port, and re-enables ZHA.

If an error occurs after ZHA was paused, the app still attempts to re-enable it. Do not stop the app or unplug the coordinator during a reset. Avoid running another ZHA coordinator control tool at the same time.

## Permissions and data

The app needs `homeassistant_api: true` so it can request a ZHA backup and temporarily unload/reload ZHA. Home Assistant gives this app an administrator-level Core API token. The token stays in the app container and is never sent to the browser or logged.

The app does not save the network backup, network key, or bulb serial number to disk. The serial is held in memory for the operation and is shown only in the authenticated Home Assistant app panel and app log.

The app's web server is available through Home Assistant Ingress only. It rejects requests that do not come through the Ingress proxy.

## Troubleshooting

### The coordinator is not selected

Open the app configuration, choose the same stable `/dev/serial/by-id/...` entry used by ZHA, save, and restart the app.

### ZHA is not loaded

Start or reload ZHA, confirm its coordinator is working, and refresh the Hue Serial Reset page. The app will not use the radio if it cannot find exactly one loaded ZHA entry.

### The bulb does not react

Check the serial number on the bulb label, confirm the bulb is on, and move it closer to the dongle. Some bulbs have poor radio reception through a fixture or enclosure. Run the reset once more if needed.

### ZHA did not resume

Open **Settings → Devices & services → ZHA** and reload the integration. If it remains unavailable, restart Home Assistant. Do not start a second process that opens the coordinator while ZHA is recovering.

### Home Assistant reports the adapter is unsupported

This app uses the Z-Stack coordinator protocol. It does not work with Silicon Labs Ember coordinators or other adapter families.

## Source and license

Source: [github.com/DrB0rk/hue-serial-reset](https://github.com/DrB0rk/hue-serial-reset). Licensed under MIT.
