"use strict";

const { ZStackAdapter } = require("zigbee-herdsman/dist/adapter/z-stack/adapter/zStackAdapter");
const { Queue } = require("zigbee-herdsman/dist/utils/queue");
const { Touchlink } = require("zigbee-herdsman/dist/controller/touchlink");
const { Subsystem } = require("zigbee-herdsman/dist/adapter/z-stack/unpi/constants");

const CHANNELS = [11, 15, 20, 25, 12, 13, 14, 16, 17, 18, 19, 21, 22, 23, 24, 26];

class ZStackCoordinator {
  constructor(path) {
    this.adapter = new ZStackAdapter({}, { path, baudRate: 115200, rtscts: false }, "", {});
    this.adapter.queue = new Queue(1);
    this.opened = false;
    this.touchlink = null;
  }

  async open() {
    this.opened = true;
    await this.adapter.znp.open();
    const version = await this.adapter.znp.requestWithReply(Subsystem.SYS, "version", {});
    this.adapter.version = version.payload;
    const endpoint = require("zigbee-herdsman/dist/adapter/z-stack/adapter/endpoints").Endpoints.find((item) => item.endpoint === 12);
    if (!endpoint) throw new Error("The Zigbee adapter library could not register its Touchlink endpoint.");
    await this.adapter.znp.request(Subsystem.AF, "register", endpoint);
    this.touchlink = new Touchlink(this.adapter);
  }

  async sweep(frame, onChannel) {
    for (const [index, channel] of CHANNELS.entries()) {
      onChannel(channel, index, CHANNELS.length);
      await this.touchlink.setChannelInterPAN(channel);
      await this.adapter.sendZclFrameInterPANBroadcast(frame, 10000, true);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  async close(note) {
    if (this.touchlink) {
      try {
        await this.touchlink.restoreChannelInterPAN();
        note("Restored the coordinator's Zigbee channel.");
      } catch (error) {
        note(`Could not restore the Inter-PAN channel: ${error.message}`);
      }
    }
    if (this.opened) {
      this.opened = false;
      await this.adapter.znp.close();
      note("Closed the coordinator connection.");
    }
  }
}

module.exports = { ZStackCoordinator };
