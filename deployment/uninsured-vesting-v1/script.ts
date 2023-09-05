import { ConfigTuple, _config } from "./config";
import BN from "bignumber.js";
import { DeployParams } from "@defi.org/web3-candies/dist/hardhat";

export const deployUninsuredVestingV1 = async (deploy: (params: DeployParams) => Promise<string>, maxFeePerGas: BN, maxPriorityFeePerGas: BN) => {
  const config: ConfigTuple = [_config.xctdAddress, _config.durationSeconds];

  await deploy({
    contractName: "UninsuredVestingV1",
    args: config,
    maxFeePerGas: maxFeePerGas,
    maxPriorityFeePerGas: maxPriorityFeePerGas,
  });
};
