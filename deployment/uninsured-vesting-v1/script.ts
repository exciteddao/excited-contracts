import { ConfigTuple } from "./config";
import BN from "bignumber.js";
import { zeroAddress } from "@defi.org/web3-candies";
import { DeployParams } from "@defi.org/web3-candies/dist/hardhat";

export const deployUninsuredVestingV1 = async (
  deploy: (params: DeployParams) => Promise<string>,
  config: ConfigTuple,
  maxFeePerGas: BN,
  maxPriorityFeePerGas: BN
) => {
  if (config[0] === zeroAddress) {
    throw new Error("XCTD address cannot be zero");
  }

  if (config[1] !== 63_072_000) {
    throw new Error("Duration must be 2 years");
  }

  await deploy({
    contractName: "UninsuredVestingV1",
    args: config,
    maxFeePerGas: maxFeePerGas,
    maxPriorityFeePerGas: maxPriorityFeePerGas,
  });
};
