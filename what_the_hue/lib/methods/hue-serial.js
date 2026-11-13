"use strict";

const Zcl = require("zigbee-herdsman/dist/zspec/zcl");

function makeResetFrame(serialNumber, extendedPanId) {
  const manufacturerCode = Zcl.ManufacturerCode.SIGNIFY_NETHERLANDS_B_V;
  const clusters = {
    manuSpecificPhilipsPairing: {
      name: "manuSpecificPhilipsPairing",
      ID: 0x1000,
      manufacturerCode,
      attributes: {},
      commands: {
        hueResetRequest: {
          name: "hueResetRequest",
          ID: 0,
          parameters: [
            { name: "extendedPanId", type: Zcl.DataType.IEEE_ADDR },
            { name: "serialCount", type: Zcl.DataType.UINT8 },
            { name: "serialNumbers", type: Zcl.BuffaloZclDataType.LIST_UINT32 },
          ],
        },
      },
      commandsResponse: {},
    },
  };

  return Zcl.Frame.create(
    Zcl.FrameType.SPECIFIC,
    Zcl.Direction.CLIENT_TO_SERVER,
    true,
    manufacturerCode,
    0,
    "hueResetRequest",
    "manuSpecificPhilipsPairing",
    {
      extendedPanId: `0x${extendedPanId}`,
      serialCount: 1,
      serialNumbers: [Number.parseInt(serialNumber, 16)],
    },
    clusters,
  );
}

module.exports = { makeResetFrame };
