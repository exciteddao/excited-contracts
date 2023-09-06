import { ConfigTuple } from "./config";
import BN from "bignumber.js";
import { DeployParams } from "@defi.org/web3-candies/dist/hardhat";

export const deployVestingV1 = async (deploy: (params: DeployParams) => Promise<string>, config: ConfigTuple, maxFeePerGas: BN, maxPriorityFeePerGas: BN) => {
  // TODO: check real XCTD address
  if (config[0] === "0x0000000000000000000000000000000000000000") {
    throw new Error("XCTD address cannot be zero");
  }

  if (config[1] !== 63_072_000) {
    throw new Error("Duration must be 2 years");
  }

  await deploy({
    contractName: "VestingV1",
    args: config,
    maxFeePerGas: maxFeePerGas,
    maxPriorityFeePerGas: maxPriorityFeePerGas,
  });
};
