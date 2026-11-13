# Adding device and coordinator support

The reset operation has two boundaries. `what_the_hue/lib/methods/hue-serial.js` builds the Philips serial-number frame. `what_the_hue/lib/coordinators/zstack.js` owns the radio connection and sends that frame. Home Assistant connection, ZHA pause and recovery, and operation status remain in `server.js`.

To add a coordinator, implement an object with `open()`, `sweep(frame, onChannel)`, and `close(note)`. `close` must tolerate a partially failed `open` and attempt to restore the original radio channel before releasing the port. Wire the implementation into the server only after confirming its firmware and Inter-PAN behavior. The present selection is hard-coded to Z-Stack; adding a selection also requires configuration validation and UI documentation.

To add a reset method, place its frame construction and any method-specific validation in `lib/methods`. Add explicit selection and confirmation to the API and UI before exposing it. Methods that need scanning or a different transport may require extending the coordinator contract; do not assume Philips serial-number commands work for other manufacturers.

Changes to radio handling need verification with the relevant physical coordinator and product, including interruption and ZHA recovery. Never start a coordinator against an active ZHA connection. Do not claim compatibility based solely on matching a chipset or a successful build.
