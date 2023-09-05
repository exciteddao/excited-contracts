import { ConfigTuple, _config } from "./config";
import BN from "bignumber.js";
import { DeployParams } from "@defi.org/web3-candies/dist/hardhat";

export const deployInsuredVestingV1 = async (deploy: (params: DeployParams) => Promise<string>, maxFeePerGas: BN, maxPriorityFeePerGas: BN) => {
  const config: ConfigTuple = [_config.usdcAddress, _config.xctdAddress, _config.projectAddress, _config.usdcToXctdRate, _config.durationSeconds];

  await deploy({
    contractName: "InsuredVestingV1",
    args: config,
    maxFeePerGas: maxFeePerGas,
    maxPriorityFeePerGas: maxPriorityFeePerGas,
  });
};
