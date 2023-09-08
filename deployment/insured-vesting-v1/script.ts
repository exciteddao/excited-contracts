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

  // TODO: check real DAO address
  if (config[2] === "0x0000000000000000000000000000000000000000") {
    throw new Error("DAO address cannot be zero");
  }

  // TODO: check real project address
  if (config[3] === "0x0000000000000000000000000000000000000000") {
    throw new Error("Project address cannot be zero");
  }

  if (config[4].toString() !== "20000000") {
    throw new Error("Wrong XCTD to USDC rate");
  }

  if (config[5] !== 63_072_000) {
    throw new Error("Wrong vesting duration");
  }

  await deploy({
    contractName: "InsuredVestingV1",
    args: config,
    maxFeePerGas: maxFeePerGas,
    maxPriorityFeePerGas: maxPriorityFeePerGas,
  });
};
