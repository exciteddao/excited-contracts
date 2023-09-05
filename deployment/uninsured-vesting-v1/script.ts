import { deploy } from "@defi.org/web3-candies/dist/hardhat";
import { config } from "./config";
import BN from "bignumber.js";

export const deployUninsuredVestingV1 = async (maxFeePerGas: BN, maxPriorityFeePerGas: BN) => {
  if (config[0].match(/^0x0+$/)) {
    throw new Error("XCTD address cannot be zero");
  }

  if (config[1] !== 63_072_000) {
    throw new Error("Duration must be 2 years");
  }

  if (config.length > 2) {
    throw new Error("Too many arguments");
  }

  await deploy({
    contractName: "UninsuredVestingV1",
    args: config,
    maxFeePerGas: maxFeePerGas,
    maxPriorityFeePerGas: maxPriorityFeePerGas,
  });
};
