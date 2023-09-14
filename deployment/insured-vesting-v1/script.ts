import { ConfigTuple, _config } from "./config";
import BN from "bignumber.js";
import { DeployParams } from "@defi.org/web3-candies/dist/hardhat";

export const deployInsuredVestingV1 = async (
  deploy: (params: DeployParams) => Promise<string>,
  config: ConfigTuple,
  maxFeePerGas: BN,
  maxPriorityFeePerGas: BN
) => {
  if (config[0] !== "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48") {
    throw new Error("Wrong USDC address");
  }
  // TODO: check real XCTD address
  if (config[1] === "0x0000000000000000000000000000000000000000") {
    throw new Error("XCTD address cannot be zero");
  }

  if (config[2] !== 63_072_000) {
    throw new Error("Wrong vesting duration");
  }

  if (config[3].toString() !== "200000") {
    throw new Error("Wrong USDC amount in");
  }

  if (config[4].toString() !== "1000000000000000000") {
    throw new Error("Wrong XCTD amount out");
  }

  // TODO: check real project wallet address
  if (config[5] === "0x0000000000000000000000000000000000000000") {
    throw new Error("Project wallet address cannot be zero");
  }

  await deploy({
    contractName: "InsuredVestingV1",
    args: config,
    maxFeePerGas: maxFeePerGas,
    maxPriorityFeePerGas: maxPriorityFeePerGas,
  });
};
